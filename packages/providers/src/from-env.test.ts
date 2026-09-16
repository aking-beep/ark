import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { adaptersFromEnv } from './from-env.js';

describe('adaptersFromEnv OpenAI aliases', () => {
  test('OPENAI_API_KEY alone configures the official Chat Completions host', async () => {
    let postedUrl = '';
    const adapters = adaptersFromEnv({
      env: { OPENAI_API_KEY: 'sk-test' },
      fetch: (async (url) => {
        postedUrl = String(url);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const openai = adapters.find((a) => a.id === 'openai-compatible');
    assert.ok(openai);
    assert.equal(openai!.configured(), true);
    assert.equal(openai!.defaultModel(), '');
    await openai!.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' });
    assert.equal(postedUrl, 'https://api.openai.com/v1/chat/completions');
  });

  test('ARK_FRONTIER_* wins over OPENAI_*', () => {
    const adapters = adaptersFromEnv({
      env: {
        OPENAI_API_KEY: 'sk-openai',
        ARK_FRONTIER_API_KEY: 'sk-frontier',
        ARK_FRONTIER_BASE_URL: 'https://groq.example/v1',
        ARK_FRONTIER_MODEL: 'llama-3.1-8b',
      },
    });
    const openai = adapters.find((a) => a.id === 'openai-compatible')!;
    assert.equal(openai.configured(), true);
    assert.equal(openai.defaultModel(), 'llama-3.1-8b');
  });

  test('no key and no URL leaves the adapter unconfigured', () => {
    const adapters = adaptersFromEnv({ env: {} });
    const openai = adapters.find((a) => a.id === 'openai-compatible')!;
    assert.equal(openai.configured(), false);
  });
});
