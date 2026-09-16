import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { route } from './router.js';
import { trio } from './fake.js';

const request = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('router', () => {
  test('explains why it selected a provider', () => {
    const decision = route({
      adapters: [trio.ollama(), trio.bedrock(), trio.frontier()],
      constraints: { privacy: 'any' },
      request,
      maxFallbacks: 1,
    });
    assert.equal(decision.selected, 'ollama');
    assert.equal(decision.basis, 'heuristic');
    assert.ok(decision.rationale.some((r) => /selected ollama/.test(r)));
    assert.ok(decision.rationale.some((r) => /ranked remaining/.test(r)));
  });

  test('local-only never lists cloud adapters as fallbacks', () => {
    const decision = route({
      adapters: [trio.ollama(), trio.bedrock(), trio.frontier()],
      constraints: { privacy: 'local-only' },
      request,
      maxFallbacks: 3,
    });
    assert.equal(decision.selected, 'ollama');
    assert.deepEqual(decision.fallbacks, []);
    assert.ok(decision.excluded.every((e) => e.id !== 'ollama'));
    assert.ok(decision.excluded.some((e) => e.id === 'bedrock'));
  });

  test('a model hint that is still eligible wins over cheaper rank', () => {
    const decision = route({
      adapters: [trio.ollama(), trio.frontier()],
      constraints: { privacy: 'any' },
      request: { ...request, model: 'gpt-5-nano' },
      maxFallbacks: 1,
    });
    assert.equal(decision.selected, 'openai-compatible');
    assert.ok(decision.rationale.some((r) => /model hint/.test(r)));
    assert.deepEqual(decision.fallbacks, ['ollama']);
  });

  test('maxFallbacks=0 records no fallback chain', () => {
    const decision = route({
      adapters: [trio.ollama(), trio.frontier()],
      constraints: { privacy: 'any' },
      request,
      maxFallbacks: 0,
    });
    assert.deepEqual(decision.fallbacks, []);
    assert.ok(decision.rationale.some((r) => /maxFallbacks=0/.test(r)));
  });
});
