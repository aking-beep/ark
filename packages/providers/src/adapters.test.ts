import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BedrockAdapter } from './bedrock.js';
import { OllamaAdapter, resolveOllamaTag } from './ollama.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { ProviderError, type CompletionRequest } from './types.js';

const req: CompletionRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 8,
  temperature: 0,
};

function ollamaFetch(
  installed: string[],
  onChat?: (model: string, url: string) => void,
): typeof fetch {
  return (async (url, init) => {
    const path = new URL(String(url), 'http://ollama.test').pathname;
    const method = String(init?.method || 'GET').toUpperCase();
    if (method === 'GET' && path.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: installed.map((name) => ({ name, model: name })) }), {
        status: 200,
      });
    }
    const body = JSON.parse(String(init?.body));
    onChat?.(body.model, String(url));
    return new Response(
      JSON.stringify({
        model: body.model,
        message: { role: 'assistant', content: 'pong' },
        prompt_eval_count: 3,
        eval_count: 1,
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

describe('adapters over mocked HTTP', () => {
  test('Ollama lists tags then POSTs /api/chat and returns normalized text', async () => {
    let postedUrl = '';
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      model: 'llama3.2',
      fetch: ollamaFetch(['llama3.2'], (model, url) => {
        postedUrl = url;
        assert.equal(model, 'llama3.2');
      }),
    });
    const out = await adapter.complete(req);
    assert.equal(postedUrl, 'http://ollama.test/api/chat');
    assert.equal(out.text, 'pong');
    assert.equal(out.catalogProvider, 'local');
  });

  test('Ollama rewrites huggingface.co Hub paths to hf.co when installed', async () => {
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      model: 'llama3.2',
      fetch: ollamaFetch(['hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF'], (model) => {
        assert.equal(model, 'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF');
      }),
    });
    const out = await adapter.complete({
      ...req,
      model: 'huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
    });
    assert.equal(out.modelId, 'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF');
  });

  test('Ollama resolves a unique family prefix to the installed tag', async () => {
    let posted = '';
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetch: ollamaFetch(['smollm2:135m'], (model) => {
        posted = model;
      }),
    });
    const out = await adapter.complete({ ...req, model: 'smollm2' });
    assert.equal(posted, 'smollm2:135m');
    assert.equal(out.modelId, 'smollm2:135m');
  });

  test('Ollama refuses a missing tag without POSTing /api/chat', async () => {
    let chat = 0;
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetch: ollamaFetch(['smollm2:135m'], () => {
        chat++;
      }),
    });
    await assert.rejects(
      () => adapter.complete({ ...req, model: 'deepseek-r1' }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.kind, 'config');
        assert.match(err.message, /deepseek-r1/);
        assert.match(err.message, /smollm2:135m/);
        return true;
      },
    );
    assert.equal(chat, 0);
  });

  test('Ollama refuses an empty inventory without POSTing /api/chat', async () => {
    let chat = 0;
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetch: ollamaFetch([], () => {
        chat++;
      }),
    });
    await assert.rejects(
      () => adapter.complete({ ...req, model: 'llama3.2' }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.kind, 'config');
        return true;
      },
    );
    assert.equal(chat, 0);
  });

  test('Ollama allowPull skips inventory and POSTs the requested id', async () => {
    let posted = '';
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      allowPull: true,
      fetch: ollamaFetch([], (model) => {
        posted = model;
      }),
    });
    await adapter.complete({ ...req, model: 'deepseek-r1' });
    assert.equal(posted, 'deepseek-r1');
  });

  test('resolveOllamaTag matches exact, latest, unique family; not a different family', () => {
    assert.equal(resolveOllamaTag('smollm2:135m', ['smollm2:135m']), 'smollm2:135m');
    assert.equal(resolveOllamaTag('llama3.2', ['llama3.2:latest']), 'llama3.2:latest');
    assert.equal(resolveOllamaTag('llama3.2:latest', ['llama3.2']), 'llama3.2');
    assert.equal(resolveOllamaTag('smollm2', ['smollm2:135m']), 'smollm2:135m');
    assert.equal(resolveOllamaTag('smollm2', ['smollm2:135m', 'smollm2:360m']), null);
    assert.equal(resolveOllamaTag('llama3.2', ['smollm2:135m']), null);
    assert.equal(
      resolveOllamaTag('huggingface.co/org/repo', ['hf.co/org/repo']),
      'hf.co/org/repo',
    );
  });

  test('OpenAI-compatible POSTs /v1/chat/completions with Bearer auth', async () => {
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      model: 'gpt-5-nano',
      fetch: (async (url, init) => {
        assert.equal(String(url), 'https://api.example.com/v1/chat/completions');
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('authorization'), 'Bearer k');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'gpt-5-nano');
        return new Response(
          JSON.stringify({
            model: 'gpt-5-nano',
            choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const out = await adapter.complete(req);
    assert.equal(out.text, 'pong');
    assert.equal(out.catalogProvider, 'openai');
  });

  test('Bedrock signs Converse and POSTs to bedrock-runtime', async () => {
    const adapter = new BedrockAdapter({
      region: 'us-east-1',
      modelId: 'amazon.nova-lite-v1:0',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      fetch: (async (url, init) => {
        assert.match(String(url), /^https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\/model\/amazon\.nova-lite-v1%3A0\/converse$/);
        const headers = new Headers(init?.headers);
        assert.match(headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 /);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.messages[0].role, 'user');
        return new Response(
          JSON.stringify({
            output: { message: { content: [{ text: 'pong' }] } },
            usage: { inputTokens: 2, outputTokens: 1 },
            stopReason: 'end_turn',
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const out = await adapter.complete(req);
    assert.equal(out.text, 'pong');
    assert.equal(out.catalogProvider, 'bedrock');
    assert.equal(out.modelId, 'amazon.nova-lite-v1:0');
  });
});
