import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolicy } from './policy.js';
import { fakeAdapter, trio } from './fake.js';
import { estimateCostUsd } from './catalog.js';

const request = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('cost policy', () => {
  test('prices each adapter with the model it will actually send, not the caller hint', () => {
    // gpt-5-nano hints to the frontier adapter; Bedrock drops the hint and
    // sends its own default (an expensive model).
    const bedrock = fakeAdapter({ id: 'bedrock', residency: 'cloud', model: 'claude-opus-5' });
    const frontier = fakeAdapter({ id: 'openai-compatible', residency: 'cloud', model: 'gpt-5-nano' });
    const req = { ...request, model: 'gpt-5-nano', maxTokens: 256 };
    const asSent = estimateCostUsd(bedrock, req)!;
    const asHinted = estimateCostUsd(frontier, req)!;
    assert.ok(asSent > asHinted, 'bedrock must be priced as claude-opus-5');
    const cap = (asSent + asHinted) / 2;
    const decision = applyPolicy({
      adapters: [bedrock, frontier],
      constraints: { privacy: 'any', maxCostUsd: cap },
      request: req,
    });
    assert.deepEqual(decision.eligible.map((a) => a.id), ['openai-compatible']);
    const why = decision.excluded.find((e) => e.id === 'bedrock')?.reason ?? '';
    assert.match(why, /exceeds maxCostUsd/);
    assert.match(why, /claude-opus-5/);
  });

  test('unknown cost under maxCostUsd is excluded (fail closed) with a rationale', () => {
    const frontier = fakeAdapter({ id: 'openai-compatible', residency: 'cloud', model: 'vendor/unpriced-model' });
    const decision = applyPolicy({
      adapters: [trio.ollama(), frontier],
      constraints: { privacy: 'any', maxCostUsd: 1 },
      request,
    });
    assert.deepEqual(decision.eligible.map((a) => a.id), ['ollama']);
    const why = decision.excluded.find((e) => e.id === 'openai-compatible')?.reason ?? '';
    assert.match(why, /cost unknown/);
    assert.match(why, /vendor\/unpriced-model/);
    assert.match(why, /fail closed/);
  });

  test('unknown cost without maxCostUsd stays eligible', () => {
    const frontier = fakeAdapter({ id: 'openai-compatible', residency: 'cloud', model: 'vendor/unpriced-model' });
    const decision = applyPolicy({ adapters: [frontier], constraints: { privacy: 'any' }, request });
    assert.deepEqual(decision.eligible.map((a) => a.id), ['openai-compatible']);
  });
});

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
