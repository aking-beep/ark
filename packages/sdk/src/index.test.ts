import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ArkIngest } from './index.js';

describe('ArkIngest', () => {
  test('assigns a trace id and monotonic turn indices', async () => {
    const posted: unknown[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      orgId: 'org_demo',
      fetch: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 2, tracesClosed: 1, priced: 2, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }) as typeof fetch,
    });

    const t = client.trace('wl_support_triage');
    t.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5', inputTokens: 10, outputTokens: 4 });
    t.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5', inputTokens: 20, outputTokens: 4 });
    const res = await t.close('success');

    assert.equal(res.accepted, 2);
    const body = posted[0] as { events: { turn: number; traceId: string }[]; traces: { traceId: string }[] };
    assert.equal(body.events[0]!.turn, 0);
    assert.equal(body.events[1]!.turn, 1);
    assert.equal(body.events[0]!.traceId, t.traceId);
    assert.equal(body.traces[0]!.traceId, t.traceId);
    assert.match(t.traceId, /^tr_/);
  });

  test('does not depend on a caller supplying turn, and will not go backwards', async () => {
    const posted: unknown[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 2, tracesClosed: 0, priced: 2, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }) as typeof fetch,
    });
    const t = client.trace('wl_x', 'tr_fixed');
    t.event({ provider: 'openai', modelId: 'gpt-5-nano', turn: 4 });
    t.event({ provider: 'openai', modelId: 'gpt-5-nano' });
    await t.flush();
    const events = (posted[0] as { events: { turn: number }[] }).events;
    assert.equal(events[0]!.turn, 4);
    assert.equal(events[1]!.turn, 5);
  });

  test('scans a sample locally and drops the text before POST', async () => {
    const posted: unknown[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 1, tracesClosed: 0, priced: 1, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }) as typeof fetch,
    });
    const t = client.trace('wl_x', 'tr_pii');
    t.event({
      provider: 'anthropic', modelId: 'claude-haiku-4.5',
      sample: 'email me at ada@example.com',
    });
    await t.flush();
    const ev = (posted[0] as { events: { sample?: string; sensitiveMatches?: string[] }[] }).events[0]!;
    assert.equal(ev.sample, undefined);
    assert.ok(ev.sensitiveMatches?.includes('email'));
  });

  test('ingest fails closed when Control does not answer', async () => {
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      timeoutMs: 30,
      fetch: ((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })) as typeof fetch,
    });
    await assert.rejects(
      () => client.ingest({
        events: [{ id: 'e1', traceId: 't1', workloadId: 'w1', provider: 'anthropic', modelId: 'claude-haiku-4.5' }],
      }),
      /timed out/,
    );
  });
});
