import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { adaptersFromEnv } from './from-env.js';

describe('adaptersFromEnv DeepSeek', () => {
  test('DEEPSEEK_API_KEY configures api.deepseek.com, not api.openai.com', async () => {
    let postedUrl = '';
    const adapters = adaptersFromEnv({
      env: { DEEPSEEK_API_KEY: 'sk-test' },
      fetch: (async (url) => {
        postedUrl = String(url);
        return new Response(
          JSON.stringify({
            model: 'deepseek-chat',
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const frontier = adapters.find((a) => a.id === 'openai-compatible')!;
    const ollama = adapters.find((a) => a.id === 'ollama')!;
    assert.equal(frontier.configured(), true);
    assert.equal(frontier.defaultModel(), 'deepseek-chat');
    assert.equal(ollama.configured(), false);
    await frontier.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });
    assert.equal(postedUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(postedUrl.includes('api.openai.com'), false);
  });

  test('ARK_FRONTIER_* wins over DEEPSEEK_API_KEY', () => {
    const adapters = adaptersFromEnv({
      env: {
        DEEPSEEK_API_KEY: 'sk-ds',
        ARK_FRONTIER_API_KEY: 'sk-fr',
        ARK_FRONTIER_BASE_URL: 'https://together.example/v1',
        ARK_FRONTIER_MODEL: 'meta-llama/Llama-3-8b',
      },
    });
    const frontier = adapters.find((a) => a.id === 'openai-compatible')!;
    assert.equal(frontier.defaultModel(), 'meta-llama/Llama-3-8b');
  });

  test('empty env leaves Ollama and frontier unconfigured', () => {
    const adapters = adaptersFromEnv({ env: {} });
    assert.equal(adapters.find((a) => a.id === 'ollama')!.configured(), false);
    assert.equal(adapters.find((a) => a.id === 'openai-compatible')!.configured(), false);
  });

  test('HF_TOKEN configures router.huggingface.co, not api.openai.com', async () => {
    let postedUrl = '';
    const adapters = adaptersFromEnv({
      env: { HF_TOKEN: 'hf-test' },
      fetch: (async (url) => {
        postedUrl = String(url);
        return new Response(
          JSON.stringify({
            model: 'Qwen/Qwen3-8B',
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const frontier = adapters.find((a) => a.id === 'openai-compatible')!;
    assert.equal(frontier.configured(), true);
    assert.equal(frontier.defaultModel(), 'Qwen/Qwen3-8B');
    await frontier.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 });
    assert.equal(postedUrl, 'https://router.huggingface.co/v1/chat/completions');
    assert.equal(postedUrl.includes('api.openai.com'), false);
  });

  test('DEEPSEEK_API_KEY wins over HF_TOKEN', () => {
    const adapters = adaptersFromEnv({
      env: { HF_TOKEN: 'hf-test', DEEPSEEK_API_KEY: 'sk-test' },
    });
    const frontier = adapters.find((a) => a.id === 'openai-compatible')!;
    assert.equal(frontier.defaultModel(), 'deepseek-chat');
  });

  test('ARK_OLLAMA_PULL=1 POSTs a missing tag without requiring inventory', async () => {
    let tags = 0;
    let posted = '';
    const adapters = adaptersFromEnv({
      env: { ARK_OLLAMA_URL: 'http://ollama.test', ARK_OLLAMA_PULL: '1' },
      fetch: (async (url, init) => {
        const path = new URL(String(url), 'http://ollama.test').pathname;
        if (path.endsWith('/api/tags')) {
          tags++;
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }
        posted = JSON.parse(String(init?.body)).model;
        return new Response(
          JSON.stringify({
            model: posted,
            message: { role: 'assistant', content: 'ok' },
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const ollama = adapters.find((a) => a.id === 'ollama')!;
    await ollama.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-r1', maxTokens: 8 });
    assert.equal(tags, 0);
    assert.equal(posted, 'deepseek-r1');
  });
});
