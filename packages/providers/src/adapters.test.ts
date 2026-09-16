import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BedrockAdapter } from './bedrock.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import type { CompletionRequest } from './types.js';

const req: CompletionRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 8,
  temperature: 0,
};

describe('adapters over mocked HTTP', () => {
  test('Ollama POSTs /api/chat and returns normalized text', async () => {
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      model: 'llama3.2',
      fetch: (async (url, init) => {
        assert.equal(String(url), 'http://ollama.test/api/chat');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'llama3.2');
        assert.equal(body.stream, false);
        assert.deepEqual(body.messages, req.messages);
        return new Response(
          JSON.stringify({
            model: 'llama3.2',
            message: { role: 'assistant', content: 'pong' },
            prompt_eval_count: 3,
            eval_count: 1,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const out = await adapter.complete(req);
    assert.equal(out.text, 'pong');
    assert.equal(out.catalogProvider, 'local');
  });

  test('Ollama rewrites huggingface.co Hub paths to hf.co', async () => {
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      model: 'llama3.2',
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF');
        return new Response(
          JSON.stringify({
            model: body.model,
            message: { role: 'assistant', content: 'ok' },
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const out = await adapter.complete({
      ...req,
      model: 'huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
    });
    assert.equal(out.modelId, 'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF');
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
