import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_LOOKUP, SUPPORT_TRIAGE } from '@ark/core';
import { ArkIngest } from '@ark/sdk';
import { ProviderError, type ProviderAdapter } from '@ark/providers';
import {
  MEASURE_TIMEOUT_MS,
  measureGate,
  measureWorkload,
  sampleModelId,
  sampleRequestFor,
  sampleWorkloadId,
} from './measure.ts';
import { MEASURE_CLIENT_TIMEOUT_MS, MEASURE_TIMEOUT_MS as CLIENT_COPY_MS } from './measure-timeout.ts';
import { RateLimiter, clientIp, readJsonBody } from './request-guard.ts';

function fakeLocal(complete: ProviderAdapter['complete']): ProviderAdapter {
  return {
    id: 'ollama',
    catalogProvider: 'local',
    residency: 'local',
    capabilities: ['text'],
    latencyClass: 'fast',
    configured: () => true,
    defaultModel: () => 'llama3.2',
    complete,
  };
}

function capturingIngest(posted: unknown[]): ArkIngest {
  return new ArkIngest({
    baseUrl: 'http://control.test',
    orgId: 'org_demo',
    timeoutMs: 50,
    fetch: (async (_url, init) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          accepted: 1,
          tracesClosed: 1,
          priced: 1,
          unpriced: 0,
          alerts: 0,
          circuitBreaks: [],
        }),
        { status: 202 },
      );
    }) as typeof fetch,
  });
}

describe('sampleRequestFor', () => {
  test('never puts the workload description in the prompt', () => {
    const req = sampleRequestFor(SUPPORT_TRIAGE, 'llama3.2');
    const text = req.messages.map((m) => m.content).join(' ');
    assert.equal(text.includes(SUPPORT_TRIAGE.description), false);
    assert.match(text, /wl_support_triage/);
    assert.match(text, /classify/);
    assert.equal(req.maxTokens, 64);
    assert.equal(req.application, 'my-ai-for-teams');
  });

  test('on-prem residency forces local-only', () => {
    const req = sampleRequestFor({ ...SUPPORT_TRIAGE, dataResidency: 'on_prem' });
    assert.equal(req.constraints.privacy, 'local-only');
  });

  test('omits model when none is passed so the adapter default applies', () => {
    const req = sampleRequestFor(SUPPORT_TRIAGE);
    assert.equal(req.model, undefined);
  });
});

describe('sampleModelId', () => {
  test('reads ARK_OLLAMA_MODEL and ignores empty', () => {
    assert.equal(sampleModelId({ ARK_OLLAMA_MODEL: 'smollm2:135m' }), 'smollm2:135m');
    assert.equal(sampleModelId({ ARK_OLLAMA_MODEL: '  ' }), undefined);
    assert.equal(sampleModelId({}), undefined);
  });
});

describe('measureWorkload', () => {
  test('refuses not-ai without calling a provider', async () => {
    let called = 0;
    const adapter = fakeLocal(async () => {
        called++;
        throw new Error('should not run');
      });
    const out = await measureWorkload(INVOICE_LOOKUP, { adapters: [adapter] });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.reason, 'not-ai');
      assert.equal(out.verdict, 'not-ai');
    }
    assert.equal(called, 0);
  });

  test('does not send the catalog estimate id as the sample model', async () => {
    let seen: string | undefined = 'unset';
    const adapter = fakeLocal(async (req) => {
      seen = req.model;
      return {
        text: 'OK',
        modelId: req.model ?? 'llama3.2',
        adapterId: 'ollama',
        catalogProvider: 'local',
        inputTokens: 8,
        outputTokens: 2,
        latencyMs: 3,
        finishReason: 'stop' as const,
      };
    });
    const out = await measureWorkload(SUPPORT_TRIAGE, { adapters: [adapter] }, 15_000, {});
    assert.equal(out.ok, true);
    assert.notEqual(seen, 'local-70b');
    assert.equal(seen, undefined);
  });

  test('uses ARK_OLLAMA_MODEL when set', async () => {
    let seen: string | undefined;
    const adapter = fakeLocal(async (req) => {
      seen = req.model;
      return {
        text: 'OK',
        modelId: req.model ?? 'missing',
        adapterId: 'ollama',
        catalogProvider: 'local',
        inputTokens: 8,
        outputTokens: 2,
        latencyMs: 3,
        finishReason: 'stop' as const,
      };
    });
    const out = await measureWorkload(
      SUPPORT_TRIAGE,
      { adapters: [adapter] },
      15_000,
      { ARK_OLLAMA_MODEL: 'smollm2:135m' },
    );
    assert.equal(out.ok, true);
    assert.equal(seen, 'smollm2:135m');
  });

  test('runs a support sample and posts ingest', async () => {
    const posted: unknown[] = [];
    let called = 0;
    const adapter = fakeLocal(async (req) => {
        called++;
        const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
        assert.equal(String(user).includes('40 agents'), false);
        return {
          text: 'OK',
          modelId: 'llama3.2',
          adapterId: 'ollama',
          catalogProvider: 'local',
          inputTokens: 12,
          outputTokens: 2,
          latencyMs: 4,
          finishReason: 'stop' as const,
        };
      });
    const out = await measureWorkload(SUPPORT_TRIAGE, {
      adapters: [adapter],
      ingest: capturingIngest(posted),
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.result.telemetry.ok, true);
      assert.equal(out.result.telemetry.attempted, true);
    }
    assert.equal(called, 1);
    assert.equal(posted.length, 1);
  });

  test('no eligible adapter is no_provider, not a throw', async () => {
    const out = await measureWorkload(SUPPORT_TRIAGE, { adapters: [] });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'no_provider');
  });

  test('timeout wins over a hung adapter', async () => {
    const adapter = fakeLocal(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  text: 'late',
                  modelId: 'llama3.2',
                  adapterId: 'ollama',
                  catalogProvider: 'local',
                  inputTokens: 1,
                  outputTokens: 1,
                  latencyMs: 200,
                  finishReason: 'stop' as const,
                }),
              200,
            );
          }),
      );
    const out = await measureWorkload(SUPPORT_TRIAGE, { adapters: [adapter] }, 30);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'timeout');
  });

  test('timeout aborts the provider call and ingests nothing', async () => {
    const posted: unknown[] = [];
    let aborted = false;
    const adapter = fakeLocal(
      (_req, opts) =>
        new Promise((resolve, reject) => {
          const late = setTimeout(
            () =>
              resolve({
                text: 'late', modelId: 'llama3.2', adapterId: 'ollama', catalogProvider: 'local',
                inputTokens: 1, outputTokens: 1, latencyMs: 200, finishReason: 'stop' as const,
              }),
            200,
          );
          opts?.signal?.addEventListener('abort', () => {
            aborted = true;
            clearTimeout(late);
            reject(new ProviderError('aborted', 'aborted', 'ollama'));
          });
        }),
    );
    const out = await measureWorkload(
      SUPPORT_TRIAGE,
      { adapters: [adapter], ingest: capturingIngest(posted) },
      30,
    );
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'timeout');
    // Let any straggling work settle, then confirm nothing reached Control.
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(aborted, true);
    assert.equal(posted.length, 0);
  });

  test('provider error text is logged, not returned', async () => {
    const logged: string[] = [];
    const adapter = fakeLocal(async () => {
      throw new ProviderError('http', 'ollama HTTP 500: LEAK_SENTINEL internal body', 'ollama');
    });
    const out = await measureWorkload(
      SUPPORT_TRIAGE,
      { adapters: [adapter] },
      15_000,
      {},
      (m) => logged.push(m),
    );
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.reason, 'execution_failed');
      assert.equal(out.message.includes('LEAK_SENTINEL'), false);
    }
    assert.ok(logged.some((m) => m.includes('LEAK_SENTINEL')));
  });

  test('no_provider message does not echo routing internals', async () => {
    const out = await measureWorkload(SUPPORT_TRIAGE, { adapters: [] }, 15_000, {}, () => {});
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(/rationale|not configured|no eligible provider:/.test(out.message), false);
  });

  test('ingested sample uses the teams_sample_ workload namespace', async () => {
    const posted: unknown[] = [];
    const adapter = fakeLocal(async () => ({
      text: 'OK', modelId: 'llama3.2', adapterId: 'ollama', catalogProvider: 'local',
      inputTokens: 1, outputTokens: 1, latencyMs: 1, finishReason: 'stop' as const,
    }));
    const out = await measureWorkload(SUPPORT_TRIAGE, { adapters: [adapter], ingest: capturingIngest(posted) });
    assert.equal(out.ok, true);
    const json = JSON.stringify(posted);
    assert.match(json, /"workloadId":"teams_sample_wl_support_triage"/);
    assert.equal(/"workloadId":"wl_support_triage"/.test(json), false);
  });
});

describe('sample workload namespace', () => {
  test('forces every id under teams_sample_ with a safe charset and length', () => {
    assert.equal(sampleWorkloadId('wl_support_triage'), 'teams_sample_wl_support_triage');
    assert.equal(sampleWorkloadId('teams_sample_x'), 'teams_sample_x');
    assert.equal(sampleWorkloadId('../evil id'), 'teams_sample_.._evil_id');
    assert.equal(sampleWorkloadId(''), 'teams_sample_unnamed');
    assert.ok(sampleWorkloadId('x'.repeat(500)).length <= 128);
    assert.equal(sampleRequestFor(SUPPORT_TRIAGE).workloadId, 'teams_sample_wl_support_triage');
  });
});

describe('measure gate (C6)', () => {
  test('disabled unless ARK_MEASURE_ENABLED=1', () => {
    const limiter = new RateLimiter(5, 60_000);
    assert.equal(measureGate('1.2.3.4', limiter, {})?.status, 404);
    assert.equal(measureGate('1.2.3.4', limiter, { ARK_MEASURE_ENABLED: 'true' })?.status, 404);
    assert.equal(measureGate('1.2.3.4', limiter, { ARK_MEASURE_ENABLED: '1' }), null);
  });

  test('rate limits to 5 per minute per client', () => {
    const limiter = new RateLimiter(5, 60_000);
    const env = { ARK_MEASURE_ENABLED: '1' };
    for (let i = 0; i < 5; i++) assert.equal(measureGate('1.2.3.4', limiter, env), null);
    const refused = measureGate('1.2.3.4', limiter, env);
    assert.equal(refused?.status, 429);
    assert.ok(Number(refused?.headers['retry-after']) > 0);
    assert.equal(measureGate('5.6.7.8', limiter, env), null);
  });

  test('a rotating client address cannot escape the global ceiling', () => {
    const limiter = new RateLimiter(5, 60_000);
    const global = new RateLimiter(3, 60_000);
    const env = { ARK_MEASURE_ENABLED: '1' };
    for (let i = 0; i < 3; i++) assert.equal(measureGate(`10.0.0.${i}`, limiter, env, global), null);
    assert.equal(measureGate('10.0.0.99', limiter, env, global)?.status, 429);
  });

  test('rate limiter window resets', () => {
    const limiter = new RateLimiter(1, 1000);
    assert.equal(limiter.take('a', 0), 0);
    assert.ok(limiter.take('a', 10) > 0);
    assert.equal(limiter.take('a', 1000), 0);
  });

  test('client timeout is the server budget plus 5s', () => {
    assert.equal(CLIENT_COPY_MS, MEASURE_TIMEOUT_MS);
    assert.equal(MEASURE_CLIENT_TIMEOUT_MS, MEASURE_TIMEOUT_MS + 5_000);
  });

  test('clientIp takes the right-most forwarded address, not one the client wrote', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } });
    assert.equal(clientIp(req), '10.0.0.1');
    assert.equal(clientIp(new Request('http://x/')), 'unknown');
  });
});

describe('readJsonBody', () => {
  test('parses a small JSON body', async () => {
    const out = await readJsonBody(new Request('http://x/', { method: 'POST', body: '{"a":1}' }));
    assert.deepEqual(out, { ok: true, value: { a: 1 } });
  });

  test('refuses a declared content-length over the cap without reading', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': String(300 * 1024) },
    });
    const out = await readJsonBody(req);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.status, 413);
  });

  test('cuts off a streamed body over the cap', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
        if (pulled > 100) controller.close();
      },
    });
    const req = new Request('http://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const out = await readJsonBody(req, 256 * 1024);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.status, 413);
    assert.ok(pulled < 10);
  });

  test('invalid JSON is 400', async () => {
    const out = await readJsonBody(new Request('http://x/', { method: 'POST', body: '{nope' }));
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.status, 400);
  });
});
