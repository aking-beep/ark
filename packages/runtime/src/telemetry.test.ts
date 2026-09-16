import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ArkIngest } from '@ark/sdk';
import { emitTelemetry } from './telemetry.js';
import { fakeAdapter } from './fake.js';
import { INGEST_ERROR_KINDS, RuntimeRequest, type Attempt } from './types.js';

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

const okAttempt: Attempt = {
  adapterId: 'ollama',
  catalogProvider: 'local',
  modelId: 'llama3.2',
  ok: true,
  latencyMs: 5,
};

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
      attempts: [okAttempt],
      outcome: 'success',
    });
    assert.equal(out.ok, true);
    const body = posted[0] as {
      events: { sample?: string; provider: string; modelId: string; application?: string; turn?: number }[];
      traces: { outcome: string }[];
    };
    assert.equal(body.events[0]!.sample, undefined);
    assert.equal(JSON.stringify(body).includes('secret prompt'), false);
    assert.equal(body.events[0]!.provider, 'local');
    assert.equal(body.events[0]!.turn, 0);
    assert.equal(body.traces[0]!.outcome, 'success');
  });

  test('one event per attempt; fallback stays on turn 0', async () => {
    const posted: unknown[] = [];
    const adapter = fakeAdapter({ id: 'openai-compatible', residency: 'cloud' });
    const completion = await adapter.complete({ messages: request.messages });
    const out = await emitTelemetry({
      ingest: capturingIngest(posted),
      request,
      completion,
      adapter,
      attempts: [
        {
          adapterId: 'ollama',
          catalogProvider: 'local',
          modelId: 'llama3.2',
          ok: false,
          error: 'ollama: http: HTTP 404: LEAK_SENTINEL',
          errorKind: 'http',
          latencyMs: 4,
        },
        {
          adapterId: 'openai-compatible',
          catalogProvider: 'openai',
          modelId: completion.modelId,
          ok: true,
          latencyMs: 6,
        },
      ],
      outcome: 'success',
    });
    assert.equal(out.ok, true);
    const body = posted[0] as {
      events: { status: string; turn: number; errorKind?: string; provider: string }[];
      traces: { outcome: string; retries: number }[];
    };
    assert.equal(body.events.length, 2);
    assert.deepEqual(body.events.map((e) => e.turn), [0, 0]);
    assert.equal(body.events[0]!.status, 'error');
    assert.equal(body.events[0]!.errorKind, 'http');
    assert.equal(body.events[0]!.provider, 'local');
    assert.equal(body.events[1]!.status, 'ok');
    assert.equal(body.traces[0]!.outcome, 'success');
    assert.equal(body.traces[0]!.retries, 1);
    assert.equal(JSON.stringify(body).includes('LEAK_SENTINEL'), false);
  });

  test('errorKind is the closed enum, never the provider body', async () => {
    const posted: unknown[] = [];
    const out = await emitTelemetry({
      ingest: capturingIngest(posted),
      request,
      attempts: [
        {
          adapterId: 'ollama',
          catalogProvider: 'local',
          modelId: 'llama3.2',
          ok: false,
          error: 'ollama: http: HTTP 500: LEAK_SENTINEL sk-secret-body',
          errorKind: 'http',
          latencyMs: 9,
        },
      ],
      outcome: 'failure',
    });
    assert.equal(out.ok, true);
    const body = posted[0] as { events: { status: string; errorKind?: string }[] };
    assert.equal(body.events[0]!.status, 'error');
    assert.equal(body.events[0]!.errorKind, 'http');
    assert.ok((INGEST_ERROR_KINDS as readonly string[]).includes(body.events[0]!.errorKind!));
    const blob = JSON.stringify(body);
    assert.equal(blob.includes('LEAK_SENTINEL'), false);
    assert.equal(blob.includes('sk-secret-body'), false);
  });

  test('timeout attempts ingest status=timeout', async () => {
    const posted: unknown[] = [];
    await emitTelemetry({
      ingest: capturingIngest(posted),
      request,
      attempts: [
        {
          adapterId: 'ollama',
          catalogProvider: 'local',
          modelId: 'llama3.2',
          ok: false,
          errorKind: 'timeout',
          error: 'timed out after 30000ms',
          latencyMs: 30_000,
        },
      ],
      outcome: 'failure',
    });
    const body = posted[0] as { events: { status: string; errorKind?: string }[] };
    assert.equal(body.events[0]!.status, 'timeout');
    assert.equal(body.events[0]!.errorKind, 'timeout');
  });

  test('policy refusal is not ingested', async () => {
    const posted: unknown[] = [];
    const out = await emitTelemetry({
      ingest: capturingIngest(posted),
      request,
      attempts: [],
      outcome: 'failure',
      refused: true,
    });
    assert.equal(out.attempted, false);
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /policy refusal/);
    assert.equal(posted.length, 0);
  });

  test('ingest failure is returned, not thrown', async () => {
    const adapter = fakeAdapter({ id: 'ollama', residency: 'local' });
    const completion = await adapter.complete({ messages: request.messages });
    const out = await emitTelemetry({
      ingest: capturingIngest([], { fail: true }),
      request,
      completion,
      adapter,
      attempts: [okAttempt],
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
      attempts: [okAttempt],
      outcome: 'success',
    });
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /timed out/i);
  });
});
