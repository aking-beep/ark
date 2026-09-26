import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { observeLlmCall, isControlIngestUrl } from './instrument.js';
import { ArkIngest } from './index.js';

describe('observeLlmCall', () => {
  test('reads OpenAI chat completions usage and not the prompt', () => {
    const draft = observeLlmCall({
      url: 'https://api.openai.com/v1/chat/completions',
      requestBody: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'secret ada@example.com' }],
      }),
      responseBody: JSON.stringify({
        model: 'gpt-4.1-mini',
        usage: { prompt_tokens: 11, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } },
        choices: [{ message: { content: 'hello' } }],
      }),
      latencyMs: 42,
      status: 200,
    });
    assert.deepEqual(
      { ...draft, latencyMs: 42 },
      {
        provider: 'openai',
        modelId: 'gpt-4.1-mini',
        inputTokens: 11,
        outputTokens: 5,
        cachedInputTokens: 2,
        latencyMs: 42,
        status: 'ok',
      },
    );
    assert.ok(!JSON.stringify(draft).includes('secret'));
    assert.ok(!JSON.stringify(draft).includes('@'));
  });

  test('reads Anthropic messages usage', () => {
    const draft = observeLlmCall({
      url: 'https://api.anthropic.com/v1/messages',
      requestBody: JSON.stringify({ model: 'claude-haiku-4.5', messages: [{ role: 'user', content: 'hi' }] }),
      responseBody: JSON.stringify({
        model: 'claude-haiku-4.5',
        usage: { input_tokens: 9, output_tokens: 3, cache_read_input_tokens: 0 },
      }),
      latencyMs: 10,
      status: 200,
    });
    assert.equal(draft?.provider, 'anthropic');
    assert.equal(draft?.modelId, 'claude-haiku-4.5');
    assert.equal(draft?.inputTokens, 9);
    assert.equal(draft?.outputTokens, 3);
  });

  test('does not treat Control ingest as a model call', () => {
    assert.equal(isControlIngestUrl('http://localhost:3002/api/v1/events'), true);
    assert.equal(
      observeLlmCall({
        url: 'http://localhost:3002/api/v1/events',
        responseBody: JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'x' }),
        latencyMs: 1,
      }),
      null,
    );
  });

  test('ignores a path it does not know, rather than throwing', () => {
    assert.equal(
      observeLlmCall({
        url: 'https://api.openai.com/v1/images/generations',
        responseBody: JSON.stringify({ data: [] }),
        latencyMs: 1,
      }),
      null,
    );
  });
});

describe('ArkIngest.run + instrumentFetch', () => {
  function llmThenIngest() {
    const ingestPosts: unknown[] = [];
    const inner: typeof fetch = async (url, init) => {
      const href = String(url);
      if (href.includes('/api/v1/events')) {
        ingestPosts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 2, tracesClosed: 1, priced: 2, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }
      return new Response(JSON.stringify({
        model: 'gpt-4.1-mini',
        usage: { prompt_tokens: 11, completion_tokens: 5 },
        choices: [{ message: { content: 'hello ada@example.com' } }],
      }), { status: 200 });
    };
    const client = new ArkIngest({ baseUrl: 'http://control.test', fetch: inner });
    return { client, ingestPosts, wrapped: client.instrumentFetch(inner) };
  }

  test('two completions inside run() are two turns on one trace', async () => {
    const { client, ingestPosts, wrapped } = llmThenIngest();
    await client.run('wl_probe', async () => {
      await wrapped('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'secret prompt ada@example.com' }] }),
      });
      await wrapped('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'turn two' }] }),
      });
    });
    const events = (ingestPosts[0] as { events: { turn: number; traceId: string; workloadId: string }[] }).events;
    assert.equal(events.length, 2);
    assert.equal(events[0]!.turn, 0);
    assert.equal(events[1]!.turn, 1);
    assert.equal(events[0]!.traceId, events[1]!.traceId);
    assert.equal(events[0]!.workloadId, 'wl_probe');
  });

  test('the prompt never leaves the process', async () => {
    const { client, ingestPosts, wrapped } = llmThenIngest();
    await client.run('wl_probe', async () => {
      await wrapped('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'secret prompt ada@example.com' }] }),
      });
    });
    const serialised = JSON.stringify(ingestPosts);
    assert.ok(!serialised.includes('secret prompt'));
    assert.ok(!serialised.includes('ada@example.com'));
  });

  test('a completion outside run() does not invent a trace', async () => {
    const { ingestPosts, wrapped } = llmThenIngest();
    await wrapped('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
    });
    assert.equal(ingestPosts.length, 0);
  });

  test('concurrent run()s do not share a trace', async () => {
    const { client, ingestPosts, wrapped } = llmThenIngest();
    await Promise.all([
      client.run('wl_a', async () => {
        await wrapped('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
        });
      }),
      client.run('wl_b', async () => {
        await wrapped('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
        });
      }),
    ]);
    const traces = ingestPosts.map((p) => (p as { events: { traceId: string; workloadId: string }[] }).events[0]!);
    assert.equal(traces.length, 2);
    assert.notEqual(traces[0]!.traceId, traces[1]!.traceId);
    assert.deepEqual(new Set(traces.map((t) => t.workloadId)), new Set(['wl_a', 'wl_b']));
  });

  test('ingest failure inside run() does not fail the work', async () => {
    const inner: typeof fetch = async (url) => {
      if (String(url).includes('/api/v1/events')) throw new Error('control down');
      return new Response(JSON.stringify({
        model: 'gpt-4.1-mini', usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200 });
    };
    const client = new ArkIngest({ baseUrl: 'http://control.test', fetch: inner });
    const wrapped = client.instrumentFetch(inner);
    const result = await client.run('wl_x', async () => {
      await wrapped('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' });
      return 7;
    });
    assert.equal(result, 7);
  });
});
