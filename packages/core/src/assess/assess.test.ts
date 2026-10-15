import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  assess, SUITABILITY_RUBRIC, taskFit, shapesDecideNotAi, DETERMINISTIC_COST_SOURCE, GOLDEN_SET_RULE,
} from './index.js';
import { SUPPORT_TRIAGE, INVOICE_LOOKUP, CONTENT_DRAFTING, FIXTURES } from '../fixtures.js';
import { Workload, TaskShape } from '../schema/workload.js';
import { buildCalibration } from '../calibration/priors.js';

/** The neutral placeholders the intake uses for a verdict-only link. */
function placeholder(task: TaskShape[], name = 'Placeholder job'): Workload {
  return Workload.parse({
    id: 'wl_placeholder', name, task,
    volume: { unitsPerMonth: 1, unitLabel: 'unit' },
    input: { avgTokens: 1 }, output: { avgTokens: 1 },
    dataClasses: ['internal'],
  });
}

const ALL_SHAPES = TaskShape.options;

function subsets<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
  return out;
}

describe('suitability rubric is the single source of labels and weights', () => {
  test('weights sum to 1 and keys are unique', () => {
    const sum = SUITABILITY_RUBRIC.reduce((s, r) => s + r.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
    assert.equal(new Set(SUITABILITY_RUBRIC.map((r) => r.key)).size, SUITABILITY_RUBRIC.length);
  });

  test('every dimension the engine emits is in the rubric with the same label and weight', () => {
    const variants = [
      ...FIXTURES,
      { ...CONTENT_DRAFTING, current: {} },
      { ...SUPPORT_TRIAGE, determinism: 'exact' as const, errorTolerance: 'none' as const },
      placeholder(['lookup']),
    ];
    for (const w of variants) {
      const dims = assess(w).suitability.dimensions;
      assert.equal(dims.length, SUITABILITY_RUBRIC.length);
      for (const d of dims) {
        const r = SUITABILITY_RUBRIC.find((x) => x.key === d.key);
        assert.ok(r, `${d.key} missing from rubric`);
        assert.equal(d.label, r.label);
        assert.equal(d.weight, r.weight);
      }
    }
  });

  test('every rubric entry says what moves it', () => {
    for (const r of SUITABILITY_RUBRIC) assert.ok(r.movedBy.length > 40, r.key);
  });
});

describe('the shapes alone decide not-ai', () => {
  test('for every shape combination, shapesDecideNotAi agrees with the engine on placeholders', () => {
    for (const task of subsets(ALL_SHAPES)) {
      const a = assess(placeholder(task));
      if (shapesDecideNotAi(task)) assert.equal(a.suitability.verdict, 'not-ai', task.join(','));
      assert.deepEqual(taskFit(task).dimension, a.suitability.dimensions.find((d) => d.key === 'taskFit'));
    }
  });

  test('only calculate and lookup decide it', () => {
    assert.equal(shapesDecideNotAi(['lookup']), true);
    assert.equal(shapesDecideNotAi(['calculate', 'lookup']), true);
    assert.equal(shapesDecideNotAi(['lookup', 'summarize']), false);
    assert.equal(shapesDecideNotAi([]), false);
  });

  test('what a verdict-only report shows does not depend on the placeholders', () => {
    const a = assess(placeholder(['lookup', 'calculate']));
    const b = assess({ ...INVOICE_LOOKUP, name: 'Placeholder job' });
    assert.deepEqual(a.architecture.rejected, b.architecture.rejected);
    assert.deepEqual(a.architecture.components, b.architecture.components);
    assert.equal(a.architecture.summary, b.architecture.summary);
    assert.deepEqual(a.phases, b.phases);
    assert.equal(a.suitability.headline, b.suitability.headline);
    assert.equal(taskFit(['lookup', 'calculate']).blocker, a.suitability.blockers[0]);
  });
});

describe('not-ai does not recommend a model', () => {
  const r = assess(INVOICE_LOOKUP);

  test('no model, and no model price in the cost', () => {
    assert.equal(r.model, null);
    assert.equal(r.cost.modelId, null);
    assert.equal(r.cost.perUnit.value, 0);
    assert.equal(r.cost.perMonth.value, 0);
    assert.equal(r.cost.wastedOnFailures.value, 0);
    assert.equal(r.cost.perUnit.source, DETERMINISTIC_COST_SOURCE);
    assert.equal(r.value.spendPerDollarOfValue, null);
  });

  test('evaluation is a deterministic test plan, not a golden set', () => {
    assert.equal(r.evaluation.kind, 'deterministic');
    assert.equal(r.evaluation.goldenSetSize, null);
    for (const m of r.evaluation.metrics) {
      assert.doesNotMatch(m.name, /golden|accuracy/i);
      assert.doesNotMatch(m.measuredHow, /golden set|ARK Control measures/i);
    }
    assert.ok(r.evaluation.metrics.some((m) => /property/i.test(m.name)));
    assert.doesNotMatch(r.evaluation.regressionPolicy, /golden set/i);
  });

  test('model-call controls are dropped', () => {
    const ids = r.security.controls.map((c) => c.id);
    for (const gone of ['SEC-01', 'SEC-02', 'SEC-03', 'SEC-06', 'SEC-07', 'SEC-08']) {
      assert.ok(!ids.includes(gone), `${gone} should not apply to a deterministic build`);
    }
    for (const c of r.security.controls) {
      assert.doesNotMatch(`${c.requirement} ${c.verifiedBy}`, /prompt|model call|\bControl\b/i);
    }
    assert.ok(ids.includes('SEC-11'), 'the audit log still applies');
    assert.ok(r.security.drivers.every((d) => !/prompt/.test(d)));
  });

  test('unknowns do not talk about a call shape that does not exist', () => {
    assert.ok(r.trust.unknowns.every((u) => !/Call shape/.test(u)));
  });
});

describe('the AI path keeps its model, golden set and controls', () => {
  test('support triage', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.ok(r.model);
    assert.equal(r.cost.modelId, r.model.primary.id);
    assert.equal(r.evaluation.kind, 'golden-set');
    assert.ok((r.evaluation.goldenSetSize ?? 0) >= 120);
    assert.ok(r.security.controls.some((c) => c.id === 'SEC-07'));
    assert.match(GOLDEN_SET_RULE, /120/);
  });

  test('the call shape used is exposed with its basis', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.equal(r.callShape.basis, 'heuristic');
    assert.equal(r.callShape.turnsPerOutcome, r.architecture.callShape.turnsPerOutcome);

    const rows = Array.from({ length: 40 }, () => ({
      pattern: 'bounded-agent', turns: 11, inputTokensFirstTurn: 1000, inputTokensLastTurn: 6000,
      succeeded: true, retries: 0, cachedInputTokens: 0, totalInputTokens: 1000, costUsd: 0.1,
    }));
    const cal = buildCalibration(rows, { basis: 'measured', windowDays: 30 });
    const m = assess(SUPPORT_TRIAGE, { calibration: cal });
    assert.equal(m.callShape.basis, 'measured');
    assert.equal(m.callShape.turnsPerOutcome, 11);
    assert.equal(m.callShape.sampleSize, 40);
    // Derived dollars are priced at list rates, so they stop at calibrated.
    assert.equal(m.cost.perUnit.basis, 'calibrated');
  });
});

test('a tiny spend-per-dollar ratio stays non-zero', async () => {
  const { valueModel } = await import('../economics/value.js');
  const { estimate } = await import('../schema/provenance.js');
  const { SUPPORT_TRIAGE } = await import('../fixtures.js');
  const w = { ...SUPPORT_TRIAGE, current: { minutesPerUnit: 6, fullyLoadedHourlyUsd: 62 } };
  const v = valueModel(w, estimate(0.000045, 'heuristic', 'test'), 10_000, 0.6);
  assert.ok(v.spendPerDollarOfValue && v.spendPerDollarOfValue.value > 0);
});
