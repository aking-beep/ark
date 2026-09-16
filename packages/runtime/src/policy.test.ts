import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolicy } from './policy.js';
import { fakeAdapter, trio } from './fake.js';

const request = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('privacy policy', () => {
  test('local-only drops every cloud adapter, including ones that would be cheaper', () => {
    const decision = applyPolicy({
      adapters: [trio.ollama(), trio.bedrock(), trio.frontier()],
      constraints: { privacy: 'local-only' },
      request,
    });
    assert.deepEqual(decision.eligible.map((a) => a.id), ['ollama']);
    assert.ok(decision.excluded.some((e) => e.id === 'bedrock' && /local-only/.test(e.reason)));
    assert.ok(decision.excluded.some((e) => e.id === 'openai-compatible' && /local-only/.test(e.reason)));
    assert.ok(decision.rationale.some((r) => /hard constraint/.test(r)));
  });

  test('local-only with only cloud adapters leaves none eligible', () => {
    const decision = applyPolicy({
      adapters: [trio.bedrock(), trio.frontier()],
      constraints: { privacy: 'local-only' },
      request,
    });
    assert.equal(decision.eligible.length, 0);
    assert.equal(decision.excluded.length, 2);
  });

  test('unconfigured adapters are excluded before ranking', () => {
    const decision = applyPolicy({
      adapters: [fakeAdapter({ id: 'ollama', residency: 'local', configured: false }), trio.bedrock()],
      constraints: { privacy: 'any' },
      request,
    });
    assert.deepEqual(decision.eligible.map((a) => a.id), ['bedrock']);
    assert.equal(decision.excluded[0]?.reason, 'not configured');
  });

  test('capability and allow-list filters apply on top of privacy', () => {
    const vision = fakeAdapter({
      id: 'bedrock',
      residency: 'cloud',
      capabilities: ['text', 'vision'],
    });
    const local = fakeAdapter({ id: 'ollama', residency: 'local', capabilities: ['text'] });
    const decision = applyPolicy({
      adapters: [local, vision],
      constraints: { privacy: 'any', capabilities: ['vision'] },
      request,
    });
    assert.deepEqual(decision.eligible.map((a) => a.id), ['bedrock']);
  });
});
