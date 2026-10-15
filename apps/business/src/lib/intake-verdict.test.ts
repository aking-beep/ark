import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, TaskShape, Workload } from '@ark/core';
import { decidedNotAi, provisionalVerdict } from './intake-verdict.ts';
import { emptyIntake, shortCircuitWorkload } from './intake-state.ts';

const ALL = TaskShape.options;

/** Every non-empty subset of the ten shapes: 1,023 combinations. */
function* combinations(): Generator<TaskShape[]> {
  for (let mask = 1; mask < 1 << ALL.length; mask++) {
    yield ALL.filter((_, i) => mask & (1 << i));
  }
}

describe('provisional verdict', () => {
  test('nothing selected shows nothing', () => {
    assert.equal(provisionalVerdict([]), null);
    assert.equal(decidedNotAi([]), false);
  });

  test('calculate and lookup alone are decided not-ai', () => {
    for (const task of [['calculate'], ['lookup'], ['calculate', 'lookup']] as TaskShape[][]) {
      const v = provisionalVerdict(task)!;
      assert.equal(v.kind, 'not-ai');
      assert.equal(v.decided, true);
      assert.match(v.title, /Do not use a model/);
      assert.match(v.body, /nothing later in the form changes it/);
    }
  });

  test('mixed shapes lean towards a split and are not decided', () => {
    const v = provisionalVerdict(['lookup', 'summarize'])!;
    assert.equal(v.kind, 'split');
    assert.equal(v.decided, false);
    assert.match(v.title, /split it/);
    assert.match(v.body, /Correctness/);
    assert.match(v.body, /Volume/);
  });

  test('purely linguistic shapes are a candidate and point at the deciding sections', () => {
    const v = provisionalVerdict(['classify', 'generate'])!;
    assert.equal(v.kind, 'candidate');
    assert.equal(v.decided, false);
    assert.match(v.title, /Correctness, Volume and Data/);
    assert.match(v.body, /section 4/);
  });

  test("the strip's not-ai claim matches the engine for every shape combination", () => {
    let checked = 0;
    for (const task of combinations()) {
      // Only the first step answered: everything else is the short-circuit placeholder.
      const w = shortCircuitWorkload({ ...emptyIntake(), name: 'Job', task })!;
      assert.ok(Workload.safeParse(w).success, `placeholder workload must parse for ${task.join('+')}`);
      const engine = assess(w).suitability.verdict;
      const strip = provisionalVerdict(task)!;
      assert.equal(
        strip.kind === 'not-ai',
        engine === 'not-ai',
        `${task.join('+')}: strip says ${strip.kind}, engine says ${engine}`,
      );
      checked++;
    }
    assert.equal(checked, 1023);
  });
});
