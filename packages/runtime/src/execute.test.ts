import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaAdapter, ProviderError } from '@ark/providers';
import { ArkIngest } from '@ark/sdk';
import { execute } from './execute.js';
import { PolicyError } from './types.js';
import { fakeAdapter, trio } from './fake.js';

function failingIngest(): ArkIngest {
  return new ArkIngest({
    baseUrl: 'http://control.test',
    fetch: (async () => {
      throw new Error('control down');
    }) as typeof fetch,
  });
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
          accepted: 1, tracesClosed: 1, priced: 1, unpriced: 0, alerts: 0, circuitBreaks: [],
        }),
        { status: 202 },
      );
    }) as typeof fetch,
  });
}

describe('execute', () => {
  test('local-only never calls a cloud adapter, even when local is missing', async () => {
    let cloud = 0;
    const bedrock = fakeAdapter({
      id: 'bedrock',
      residency: 'cloud',
      complete: async () => {
        cloud++;
        throw new Error('cloud ran');
      },
    });
    await assert.rejects(
      () =>
        execute(
          { messages: [{ role: 'user', content: 'hi' }], constraints: { privacy: 'local-only' } },
          { adapters: [bedrock] },
        ),
      (err: unknown) => {
        assert.ok(err instanceof PolicyError);
        assert.match(err.message, /no eligible provider/);
        assert.equal(err.routing.selected, null);
        return true;
      },
    );
    assert.equal(cloud, 0);
  });

  test('allowed provider failure falls back and returns the secondary completion', async () => {
    const ollama = fakeAdapter({
      id: 'ollama',
      residency: 'local',
      complete: async () => {
        throw new ProviderError('http', 'ollama down', 'ollama');
      },
    });
    const frontier = trio.frontier();
    const result = await execute(
      { messages: [{ role: 'user', content: 'hi' }], constraints: { privacy: 'any' }, maxFallbacks: 1 },
      { adapters: [ollama, frontier] },
    );
    assert.equal(result.adapterId, 'openai-compatible');
    assert.equal(result.text, 'ok:openai-compatible');
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]!.errorKind, 'http');
    assert.equal(result.routing.basis, 'heuristic');
    assert.equal(result.latency.basis, 'measured');
    assert.ok(result.cost.basis === 'benchmark' || result.cost.basis === 'heuristic');
  });

  test('telemetry failure does not fail inference', async () => {
    const result = await execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { adapters: [trio.ollama()], ingest: failingIngest() },
    );
    assert.equal(result.text, 'ok:ollama');
    assert.equal(result.telemetry.ok, false);
    assert.equal(result.telemetry.attempted, true);
  });

  test('fallback ingest is one event per attempt on turn 0', async () => {
    const posted: unknown[] = [];
    const ollama = fakeAdapter({
      id: 'ollama',
      residency: 'local',
      complete: async () => {
        throw new ProviderError('http', 'ollama HTTP 404: LEAK_SENTINEL', 'ollama');
      },
    });
    const result = await execute(
      { messages: [{ role: 'user', content: 'secret prompt' }], constraints: { privacy: 'any' }, maxFallbacks: 1 },
      { adapters: [ollama, trio.frontier()], ingest: capturingIngest(posted) },
    );
    assert.equal(result.adapterId, 'openai-compatible');
    const body = posted[0] as {
      events: { status: string; turn: number; errorKind?: string }[];
      traces: { outcome: string; retries: number }[];
    };
    assert.equal(body.events.length, 2);
    assert.deepEqual(body.events.map((e) => e.turn), [0, 0]);
    assert.equal(body.events[0]!.status, 'error');
    assert.equal(body.events[0]!.errorKind, 'http');
    assert.equal(body.events[1]!.status, 'ok');
    assert.equal(body.traces[0]!.retries, 1);
    assert.equal(JSON.stringify(body).includes('LEAK_SENTINEL'), false);
  });

  test('policy refusal does not post a trace', async () => {
    const posted: unknown[] = [];
    await assert.rejects(
      () =>
        execute(
          { messages: [{ role: 'user', content: 'hi' }], constraints: { privacy: 'local-only' } },
          { adapters: [trio.bedrock()], ingest: capturingIngest(posted) },
        ),
      PolicyError,
    );
    assert.equal(posted.length, 0);
  });

  test('the same request schema runs across all three adapters', async () => {
    const req = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 16 };
    for (const adapter of [trio.ollama(), trio.bedrock(), trio.frontier()]) {
      const result = await execute(req, { adapters: [adapter] });
      assert.equal(result.adapterId, adapter.id);
      assert.ok(result.text.startsWith('ok:'));
    }
  });

  test('execute forwards an open-weight model id to Ollama, not the env default', async () => {
    let postedModel = '';
    const ollama = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      model: 'llama3.2',
      fetch: (async (_url, init) => {
        postedModel = JSON.parse(String(init?.body)).model;
        return new Response(
          JSON.stringify({
            model: postedModel,
            message: { role: 'assistant', content: 'ok' },
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const result = await execute(
      { messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-r1', maxTokens: 8 },
      { adapters: [ollama] },
    );
    assert.equal(postedModel, 'deepseek-r1');
    assert.equal(result.adapterId, 'ollama');
    assert.equal(result.modelId, 'deepseek-r1');
  });

  test('a closed-source hint is stripped when falling back to Ollama', async () => {
    let postedModel = '';
    const ollama = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      model: 'llama3.2',
      fetch: (async (_url, init) => {
        postedModel = JSON.parse(String(init?.body)).model;
        return new Response(
          JSON.stringify({
            model: postedModel,
            message: { role: 'assistant', content: 'ok' },
            prompt_eval_count: 1,
            eval_count: 1,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    const frontier = fakeAdapter({
      id: 'openai-compatible',
      residency: 'cloud',
      complete: async () => {
        throw new ProviderError('http', 'frontier down', 'openai-compatible');
      },
    });
    await execute(
      {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'gpt-4o',
        maxFallbacks: 1,
        constraints: { privacy: 'any' },
      },
      { adapters: [frontier, ollama] },
    );
    assert.equal(postedModel, 'llama3.2');
  });
});
