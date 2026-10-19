import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneFor } from './tone.ts';

test('heuristic and benchmark figures are never coloured as verdicts', () => {
  for (const basis of ['heuristic', 'benchmark'] as const) {
    for (const t of ['good', 'warn', 'danger'] as const) {
      assert.equal(toneFor({ basis }, t), 'neutral', `${basis}/${t}`);
    }
  }
});

test('calibrated and measured figures keep their tone', () => {
  for (const basis of ['calibrated', 'measured'] as const) {
    for (const t of ['good', 'warn', 'danger'] as const) assert.equal(toneFor({ basis }, t), t);
  }
});

test('a missing figure is neutral, and non-judgement tones pass through', () => {
  assert.equal(toneFor(null, 'good'), 'neutral');
  assert.equal(toneFor(undefined, 'danger'), 'neutral');
  assert.equal(toneFor({ basis: 'heuristic' }, 'signal'), 'signal');
  assert.equal(toneFor({ basis: 'heuristic' }, 'neutral'), 'neutral');
});
