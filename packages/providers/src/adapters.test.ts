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

  test('a per-request model is enough when the adapter has no default', async () => {
    let posted: { url: string; body: Record<string, unknown> } | null = null;
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
      fetch: (async (url, init) => {
        posted = { url: String(url), body: JSON.parse(String(init?.body)) };
        return new Response(
          JSON.stringify({
            model: 'gpt-4o-mini',
            choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    assert.equal(adapter.configured(), true);
    const out = await adapter.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4o-mini',
      maxTokens: 8,
    });
    assert.equal(out.text, 'pong');
    assert.equal(posted!.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(posted!.body.model, 'gpt-4o-mini');
    assert.equal(posted!.body.max_tokens, 8);
  });

  test('GPT-5 and o-series send the fields those models accept', async () => {
    const seen: Record<string, unknown>[] = [];
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
      fetch: (async (_url, init) => {
        seen.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await adapter.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-5-nano',
      maxTokens: 16,
      temperature: 0,
    });
    await adapter.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'o3-mini',
      maxTokens: 16,
      temperature: 0,
    });
    assert.equal(seen[0]!.max_completion_tokens, 16);
    assert.equal(seen[0]!.max_tokens, undefined);
    assert.equal(seen[1]!.max_completion_tokens, 16);
    assert.equal(Object.prototype.hasOwnProperty.call(seen[1]!, 'temperature'), false);
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
