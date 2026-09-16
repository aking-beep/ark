import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ArkIngest } from '@ark/sdk';
import { emitTelemetry } from './telemetry.js';
import { fakeAdapter } from './fake.js';
import { RuntimeRequest } from './types.js';

function capturingIngest(posted: unknown[], opts: { fail?: boolean; hang?: boolean } = {}): ArkIngest {
  return new ArkIngest({
    baseUrl: 'http://control.test',
    orgId: 'org_demo',
    timeoutMs: 30,
    fetch: (async (_url, init) => {
      if (opts.hang) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      if (opts.fail) throw new Error('control down');
      posted.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          accepted: 1, tracesClosed: 1, priced: 1, unpriced: 0, alerts: 0, circuitBreaks: [],
        }),
        { status: 202 },
      );
    }) as typeof fetch,
  });
}

const request = RuntimeRequest.parse({
  messages: [{ role: 'user', content: 'secret prompt should not be posted' }],
  workloadId: 'wl_runtime',
});

describe('telemetry', () => {
  test('posts the ingest contract without a prompt sample', async () => {
    const posted: unknown[] = [];
    const adapter = fakeAdapter({ id: 'ollama', residency: 'local' });
    const completion = await adapter.complete({ messages: request.messages });
    const out = await emitTelemetry({
      ingest: capturingIngest(posted),
      request,
      completion,
      adapter,
      attempts: [{ adapterId: 'ollama', ok: true, latencyMs: 5 }],
      outcome: 'success',
    });
    assert.equal(out.ok, true);
    const body = posted[0] as {
      events: { sample?: string; provider: string; modelId: string; application?: string }[];
      traces: { outcome: string }[];
    };
    assert.equal(body.events[0]!.sample, undefined);
    assert.equal(JSON.stringify(body).includes('secret prompt'), false);
    assert.equal(body.events[0]!.provider, 'local');
    assert.equal(body.traces[0]!.outcome, 'success');
  });

  test('ingest failure is returned, not thrown', async () => {
    const adapter = fakeAdapter({ id: 'ollama', residency: 'local' });
    const completion = await adapter.complete({ messages: request.messages });
    const out = await emitTelemetry({
      ingest: capturingIngest([], { fail: true }),
      request,
      completion,
      adapter,
      attempts: [{ adapterId: 'ollama', ok: true, latencyMs: 5 }],
      outcome: 'success',
    });
    assert.equal(out.attempted, true);
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /control down/);
  });

  test('ingest timeout is returned, not thrown', async () => {
    const adapter = fakeAdapter({ id: 'ollama', residency: 'local' });
    const completion = await adapter.complete({ messages: request.messages });
    const out = await emitTelemetry({
      ingest: capturingIngest([], { hang: true }),
      request,
      completion,
      adapter,
      attempts: [{ adapterId: 'ollama', ok: true, latencyMs: 5 }],
      outcome: 'success',
    });
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /timed out/i);
  });
});
