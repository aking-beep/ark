import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { observeLlmCall, isControlIngestUrl } from './instrument.js';
import { ArkIngest } from './index.js';
import { EventInput, byId, priceEvent } from '@ark/core';

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
        // prompt_tokens (11) includes the 2 cache reads; inputTokens is the
        // full-rate remainder so priceEvent does not bill the 2 twice.
        inputTokens: 9,
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

describe('token accounting matches what the provider bills', () => {
  test('a fully cached OpenAI prompt prices at the cache-read rate, not twice', () => {
    const draft = observeLlmCall({
      url: 'https://api.openai.com/v1/chat/completions',
      requestBody: JSON.stringify({ model: 'gpt-5.6-terra' }),
      responseBody: JSON.stringify({
        usage: { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1_000_000 } },
      }),
      latencyMs: 1,
    });
    assert.equal(draft?.inputTokens, 0);
    assert.equal(draft?.cachedInputTokens, 1_000_000);
    const e = EventInput.parse({ ...draft, id: 'e', traceId: 't', workloadId: 'w' });
    const model = byId('gpt-5.6-terra')!;
    const { costUsd } = priceEvent(e);
    assert.ok(Math.abs(costUsd - (model.cachedInputPer1M ?? model.inputPer1M * 0.1)) < 1e-9, `priced ${costUsd}`);
  });

  test('Anthropic cache writes are billed input; cache reads are cached input', () => {
    const draft = observeLlmCall({
      url: 'https://api.anthropic.com/v1/messages',
      requestBody: JSON.stringify({ model: 'claude-haiku-4.5' }),
      responseBody: JSON.stringify({
        usage: { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000, output_tokens: 7 },
      }),
      latencyMs: 1,
    });
    assert.equal(draft?.inputTokens, 510);
    assert.equal(draft?.cachedInputTokens, 2000);
    assert.equal(draft?.outputTokens, 7);
  });
});

describe('streamed responses', () => {
  const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';

  test('OpenAI include_usage: usage comes from the final chunk', () => {
    const draft = observeLlmCall({
      url: 'https://api.openai.com/v1/chat/completions',
      requestBody: JSON.stringify({ model: 'gpt-4.1-mini', stream: true }),
      responseBody: sse([
        { model: 'gpt-4.1-mini', choices: [{ delta: { content: 'hel' } }], usage: null },
        { model: 'gpt-4.1-mini', choices: [{ delta: { content: 'lo' } }], usage: null },
        { model: 'gpt-4.1-mini', choices: [], usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 5 } } },
      ]),
      contentType: 'text/event-stream; charset=utf-8',
      latencyMs: 3,
    });
    assert.equal(draft?.inputTokens, 15);
    assert.equal(draft?.cachedInputTokens, 5);
    assert.equal(draft?.outputTokens, 4);
    assert.ok(!JSON.stringify(draft).includes('hel'));
  });

  test('Anthropic: input from message_start, output from the last message_delta', () => {
    const body = [
      'event: message_start',
      `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-haiku-4.5', usage: { input_tokens: 12, cache_read_input_tokens: 100, output_tokens: 1 } } })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'secret' } })}`,
      '',
      'event: message_delta',
      `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 42 } })}`,
      '',
    ].join('\n');
    const draft = observeLlmCall({
      url: 'https://api.anthropic.com/v1/messages',
      responseBody: body,
      contentType: 'text/event-stream',
      latencyMs: 3,
    });
    assert.equal(draft?.modelId, 'claude-haiku-4.5');
    assert.equal(draft?.inputTokens, 12);
    assert.equal(draft?.cachedInputTokens, 100);
    assert.equal(draft?.outputTokens, 42);
  });

  test('a stream with no usage is skipped silently', () => {
    const draft = observeLlmCall({
      url: 'https://api.openai.com/v1/chat/completions',
      requestBody: JSON.stringify({ model: 'gpt-4.1-mini', stream: true }),
      responseBody: sse([{ choices: [{ delta: { content: 'x' } }] }]),
      contentType: 'text/event-stream',
      latencyMs: 3,
    });
    assert.equal(draft, null);
  });

  test('instrumentFetch hands back the Response before the stream ends, and still records it', async () => {
    const posted: { events: { inputTokens: number; outputTokens: number }[] }[] = [];
    const enc = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ model: 'gpt-4.1-mini', usage: null })}\n\n`));
            await gate;
            c.enqueue(enc.encode(`data: ${JSON.stringify({ usage: { prompt_tokens: 8, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`));
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_u, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response('{"accepted":1,"tracesClosed":1,"priced":1,"unpriced":0,"alerts":0,"circuitBreaks":[]}', { status: 202 });
      }) as typeof fetch,
    });
    const wrapped = client.instrumentFetch(slow);
    await client.run('wl_stream', async () => {
      const res = await wrapped('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4.1-mini', stream: true }),
      });
      // Reaching this line at all means the Response was not held back.
      assert.equal(res.status, 200);
      release();
      await res.text();
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.events.length, 1);
    assert.equal(posted[0]!.events[0]!.inputTokens, 8);
    assert.equal(posted[0]!.events[0]!.outputTokens, 3);
  });
});
