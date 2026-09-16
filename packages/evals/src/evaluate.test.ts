import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './evaluate.js';

describe('evaluate', () => {
  test('quality is heuristic-pass when there is no oracle, measured when there is', () => {
    const none = evaluate({
      text: 'hello', modelId: 'local-8b', inputTokens: 4, outputTokens: 1, latencyMs: 10, finishReason: 'stop',
    });
    assert.equal(none.quality.estimate.basis, 'heuristic');
    assert.equal(none.pass, true);

    const hit = evaluate({
      text: 'hello world', modelId: 'local-8b', inputTokens: 4, outputTokens: 2, latencyMs: 10, finishReason: 'stop',
      expected: { contains: 'hello' },
    });
    assert.equal(hit.quality.pass, true);
    assert.equal(hit.quality.estimate.basis, 'measured');

    const miss = evaluate({
      text: 'nope', modelId: 'local-8b', inputTokens: 4, outputTokens: 1, latencyMs: 10, finishReason: 'stop',
      expected: { equals: 'yes' },
    });
    assert.equal(miss.quality.pass, false);
    assert.equal(miss.pass, false);
  });

  test('latency is measured and fails the budget when over', () => {
    const r = evaluate({
      text: 'x', modelId: 'local-8b', inputTokens: 1, outputTokens: 1, latencyMs: 5000, finishReason: 'stop',
      maxLatencyMs: 100,
    });
    assert.equal(r.latency.pass, false);
    assert.equal(r.latency.estimate.basis, 'measured');
    assert.equal(r.latency.estimate.value, 5000);
  });

  test('cost uses catalog benchmark pricing when the model is known', () => {
    const r = evaluate({
      text: 'x', modelId: 'local-8b', inputTokens: 1_000_000, outputTokens: 0, latencyMs: 1, finishReason: 'stop',
      maxCostUsd: 0.000001,
    });
    assert.equal(r.cost.estimate.basis, 'benchmark');
    assert.equal(typeof r.cost.estimate.value, 'number');
    assert.equal(r.cost.pass, false);
  });

  test('unknown models are unpriced heuristics and do not fail a cost ceiling', () => {
    const r = evaluate({
      text: 'x', modelId: 'mystery-model', inputTokens: 10, outputTokens: 10, latencyMs: 1, finishReason: 'stop',
      maxCostUsd: 0,
    });
    assert.equal(r.cost.estimate.basis, 'heuristic');
    assert.equal(r.cost.pass, true);
  });

  test('empty text fails reliability', () => {
    const r = evaluate({
      text: '  ', modelId: 'local-8b', inputTokens: 1, outputTokens: 0, latencyMs: 1, finishReason: 'stop',
    });
    assert.equal(r.reliability.pass, false);
  });
});
