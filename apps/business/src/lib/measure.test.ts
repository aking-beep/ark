import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_LOOKUP, SUPPORT_TRIAGE } from '@ark/core';
import { ArkIngest } from '@ark/sdk';
import type { ProviderAdapter } from '@ark/providers';
import { measureWorkload, sampleRequestFor } from './measure.ts';

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
});
