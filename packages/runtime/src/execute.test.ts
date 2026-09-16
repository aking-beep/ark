import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError } from '@ark/providers';
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

  test('the same request schema runs across all three adapters', async () => {
    const req = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 16 };
    for (const adapter of [trio.ollama(), trio.bedrock(), trio.frontier()]) {
      const result = await execute(req, { adapters: [adapter] });
      assert.equal(result.adapterId, adapter.id);
      assert.ok(result.text.startsWith('ok:'));
    }
  });
});
