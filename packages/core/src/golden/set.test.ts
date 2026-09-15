import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../assess/index.js';
import { GOLDEN, GOLDEN_KILL_RATE } from './set.js';

describe('golden set', () => {
  test('has about 40 labelled workloads', () => {
    assert.ok(GOLDEN.length >= 35, `expected ~40, got ${GOLDEN.length}`);
    assert.ok(GOLDEN.length <= 50, `set is drifting past a size a human can read (${GOLDEN.length})`);
  });

  test('ids are unique', () => {
    const ids = GOLDEN.map((c) => c.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  test('disagreements with labelled verdicts stay under the kill rate', () => {
    const disagreements: { id: string; expected: string; actual: string; note: string }[] = [];
    for (const c of GOLDEN) {
      const actual = assess(c.workload).suitability.verdict;
      if (actual !== c.expected) {
        disagreements.push({ id: c.id, expected: c.expected, actual, note: c.note });
      }
    }

    const rate = disagreements.length / GOLDEN.length;
    if (disagreements.length) {
      console.log(
        `golden disagreements ${disagreements.length}/${GOLDEN.length} (${(rate * 100).toFixed(1)}%):\n` +
          disagreements.map((d) => `  ${d.id}: expected ${d.expected}, engine ${d.actual} — ${d.note}`).join('\n'),
      );
    }

    assert.ok(
      rate <= GOLDEN_KILL_RATE,
      `kill criterion: ${(rate * 100).toFixed(1)}% of the golden set disagrees with labelled judgement (cap ${(GOLDEN_KILL_RATE * 100).toFixed(0)}%). Rebuild the rubric, do not retune labels to match the code.`,
    );
  });
});
