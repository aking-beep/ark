import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IngestBody, priceEvent } from './schema.js';
import { detectSensitive } from './sensitive.js';

describe('ingest contract', () => {
  test('an empty body does not parse', () => {
    assert.equal(IngestBody.safeParse({ orgId: 'org_demo' }).success, false);
  });

  test('actions-only and quality-only batches parse', () => {
    assert.equal(
      IngestBody.safeParse({
        actions: [{ id: 'a1', traceId: 't1', name: 'x', system: 'y', blastRadius: 'reversible' }],
      }).success,
      true,
    );
    assert.equal(
      IngestBody.safeParse({
        qualitySamples: [{ id: 'q1', workloadId: 'w1', correct: true, judgedBy: 'human' }],
      }).success,
      true,
    );
  });

  test('unknown models are unpriced, not rejected', () => {
    const p = priceEvent({
      id: 'e', traceId: 't', workloadId: 'w', provider: 'x', modelId: 'nope',
      turn: 0, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, latencyMs: 0, status: 'ok',
    });
    assert.equal(p.priced, false);
    assert.equal(p.costUsd, 0);
  });

  test('detectSensitive returns labels and not the matched text', () => {
    const labels = detectSensitive('write to ada@example.com about 123-45-6789');
    assert.ok(labels.includes('email'));
    assert.ok(labels.includes('us_ssn'));
    assert.ok(!labels.some((l) => l.includes('ada')));
  });
});
