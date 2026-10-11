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

  test('bindAgent copies agentId onto events; omitting it stays compatible', async () => {
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
    const plain = client.trace('wl_x', 'tr_plain');
    plain.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    await plain.flush();
    assert.equal((posted[0] as { events: { agentId?: string }[] }).events[0]!.agentId, undefined);

    const tagged = client.trace('wl_x', 'tr_tagged').bindAgent('support-agent');
    tagged.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    await tagged.flush();
    assert.equal((posted[1] as { events: { agentId?: string }[] }).events[0]!.agentId, 'support-agent');
  });

  test('correlates protocol evidence to the same trace and workload', async () => {
    const posted: unknown[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 1, tracesClosed: 1, evidenceAccepted: 2,
          priced: 1, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }) as typeof fetch,
    });

    const t = client.trace('wl_support_triage', 'tr_refund_829');
    t.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5', inputTokens: 10, outputTokens: 4 });
    t.evidence({
      protocol: 'mcp', kind: 'tool', operation: 'tools/call:search_customer',
      actor: 'support-agent', target: 'crm-mcp', outcome: 'ok', latencyMs: 84,
    });
    t.evidence({
      protocol: 'a2a', kind: 'delegation', operation: 'message/send',
      actor: 'support-agent', target: 'refund-agent',
    });
    const res = await t.close('success');

    assert.equal(res.evidenceAccepted, 2);
    const body = posted[0] as {
      events: { traceId: string }[];
      evidence: { id: string; traceId: string; workloadId: string; protocol: string }[];
    };
    assert.equal(body.evidence.length, 2);
    for (const row of body.evidence) {
      assert.equal(row.traceId, 'tr_refund_829');
      assert.equal(row.workloadId, 'wl_support_triage');
      assert.match(row.id, /^pe_/);
    }
    assert.equal(body.evidence[0]!.traceId, body.events[0]!.traceId);
    assert.deepEqual(body.evidence.map((r) => r.protocol), ['mcp', 'a2a']);
  });

  test('redacts evidence metadata before the POST', async () => {
    const posted: unknown[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 0, tracesClosed: 0, evidenceAccepted: 1,
          priced: 0, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }) as typeof fetch,
    });

    const t = client.trace('wl_x', 'tr_leak');
    t.evidence({
      protocol: 'mcp', kind: 'tool', operation: 'tools/call:search_customer',
      metadata: {
        toolArguments: 'customerEmail=person@example.com',
        note: 'reach ada@example.com',
        transport: 'http',
      },
    });
    await t.flush();

    const serialised = JSON.stringify(posted[0]);
    assert.ok(!serialised.includes('person@example.com'));
    assert.ok(!serialised.includes('ada@example.com'));
    assert.ok(serialised.includes('http'));
  });

  test('an observation cannot re-point itself at another trace', async () => {
    const posted: unknown[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_url, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          accepted: 0, tracesClosed: 0, evidenceAccepted: 1,
          priced: 0, unpriced: 0, alerts: 0, circuitBreaks: [],
        }), { status: 202 });
      }) as typeof fetch,
    });

    const t = client.trace('wl_support_triage', 'tr_real');
    t.evidence({
      // An adapter result reused from an earlier trace, or a copied literal.
      // The handle decides, exactly as it does for event() and action().
      traceId: 'tr_somewhere_else',
      workloadId: 'wl_other',
      protocol: 'a2a', kind: 'delegation', operation: 'message/send',
    });
    await t.flush();

    const body = posted[0] as { evidence: { traceId: string; workloadId: string }[] };
    assert.equal(body.evidence[0]!.traceId, 'tr_real');
    assert.equal(body.evidence[0]!.workloadId, 'wl_other', 'the workload may still be overridden');
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

describe('flush', () => {
  const ok = () =>
    new Response(JSON.stringify({ accepted: 1, tracesClosed: 0, priced: 1, unpriced: 0, alerts: 0, circuitBreaks: [] }), {
      status: 202,
    });

  test('an empty trace is not posted', async () => {
    let calls = 0;
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async () => {
        calls++;
        return ok();
      }) as typeof fetch,
    });
    const res = await client.trace('w').flush();
    assert.equal(calls, 0);
    assert.equal(res.accepted, 0);
  });

  test('a failed POST puts the batch back for the next flush', async () => {
    const posted: { events: { id: string }[] }[] = [];
    let fail = true;
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_u, init) => {
        if (fail) throw new Error('control down');
        posted.push(JSON.parse(String(init?.body)));
        return ok();
      }) as typeof fetch,
    });
    const t = client.trace('w', 'tr_retry');
    t.event({ id: 'ev_1', provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    await assert.rejects(() => t.flush(), /control down/);
    fail = false;
    t.event({ id: 'ev_2', provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    await t.flush();
    assert.deepEqual(posted[0]!.events.map((e) => e.id), ['ev_1', 'ev_2']);
  });

  test('a batch past the ingest cap is sent in chunks, with the close on the last', async () => {
    const posted: { events: unknown[]; traces: unknown[] }[] = [];
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      fetch: (async (_u, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return ok();
      }) as typeof fetch,
    });
    const t = client.trace('w', 'tr_big');
    for (let i = 0; i < 501; i++) t.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    const res = await t.close('success');
    assert.equal(posted.length, 2);
    assert.equal(posted[0]!.events.length, 500);
    assert.equal(posted[0]!.traces.length, 0);
    assert.equal(posted[1]!.events.length, 1);
    assert.equal(posted[1]!.traces.length, 1);
    assert.equal(res.accepted, 2);
  });

  test('the response body is read inside the timeout', async () => {
    const client = new ArkIngest({
      baseUrl: 'http://control.test',
      timeoutMs: 30,
      fetch: (async (_u, init) =>
        new Response(
          new ReadableStream({
            start(c) {
              init?.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            },
          }),
          { status: 202 },
        )) as typeof fetch,
    });
    await assert.rejects(
      () => client.ingest({ events: [{ id: 'e1', traceId: 't1', workloadId: 'w1', provider: 'a', modelId: 'm' }] }),
      /timed out/,
    );
  });
});

describe('tenancy', () => {
  test('orgId is omitted unless configured — the token decides', async () => {
    const posted: Record<string, unknown>[] = [];
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response('{"accepted":1,"tracesClosed":0,"priced":1,"unpriced":0,"alerts":0,"circuitBreaks":[]}', { status: 202 });
    }) as typeof fetch;
    const t = new ArkIngest({ baseUrl: 'http://control.test', fetch: fetchFn }).trace('w');
    t.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    await t.flush();
    assert.equal(Object.hasOwn(posted[0]!, 'orgId'), false);

    const t2 = new ArkIngest({ baseUrl: 'http://control.test', fetch: fetchFn, orgId: 'org_acme' }).trace('w');
    t2.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5' });
    await t2.flush();
    assert.equal(posted[1]!.orgId, 'org_acme');
  });
});

describe('evidence from an adapter is never rejected by the SDK', () => {
  test('an over-long or non-identifier metadata key is dropped, not thrown', () => {
    const client = new ArkIngest({ baseUrl: 'http://control.test', fetch: (async () => new Response('{}')) as typeof fetch });
    assert.doesNotThrow(() =>
      client.trace('w').evidence({
        protocol: 'mcp',
        kind: 'tool',
        operation: 'tools/call',
        metadata: { ['k'.repeat(70)]: 1, 'bob@example.com': true, transport: 'stdio' },
      }),
    );
  });
});
