import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError } from '@ark/providers';
import { runFallback } from './fallback.js';
import { fakeAdapter } from './fake.js';

const request = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('bounded fallback', () => {
  test('a failing primary yields to the next adapter in the chain', async () => {
    let secondary = 0;
    const primary = fakeAdapter({
      id: 'ollama',
      residency: 'local',
      complete: async () => {
        throw new ProviderError('http', 'down', 'ollama');
      },
    });
    const next = fakeAdapter({
      id: 'bedrock',
      residency: 'cloud',
      complete: async () => {
        secondary++;
        return {
          text: 'from-bedrock',
          modelId: 'amazon.nova-lite-v1:0',
          adapterId: 'bedrock',
          catalogProvider: 'bedrock',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 9,
          finishReason: 'stop',
        };
      },
    });
    const out = await runFallback({ chain: [primary, next], request });
    assert.equal(out.completion?.text, 'from-bedrock');
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0]!.ok, false);
    assert.equal(out.attempts[1]!.ok, true);
    assert.equal(secondary, 1);
  });

  test('the chain is the bound — a provider not in the chain is never called', async () => {
    let cloud = 0;
    const local = fakeAdapter({
      id: 'ollama',
      residency: 'local',
      complete: async () => {
        throw new ProviderError('timeout', 'slow', 'ollama');
      },
    });
    const cloudAdapter = fakeAdapter({
      id: 'bedrock',
      residency: 'cloud',
      complete: async () => {
        cloud++;
        throw new Error('should not run');
      },
    });
    const out = await runFallback({ chain: [local], request });
    assert.equal(out.completion, undefined);
    assert.equal(cloud, 0);
    assert.equal(out.attempts.length, 1);
    // cloudAdapter exists only to prove it was not passed in
    assert.equal(cloudAdapter.id, 'bedrock');
  });
});
