import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assess, assessConsumer } from './assess/index.js';
import { SUPPORT_TRIAGE, INVOICE_LOOKUP, CONTENT_DRAFTING } from './fixtures.js';
import { costPerSuccessfulOutcome, costOfCall, costPerAttempt } from './economics/tokens.js';
import { byId, cheapestMeeting, staleEntries, CATALOG } from './models/catalog.js';
import { findSubstitutions } from './models/routing.js';
import { buildCalibration, resolveCallShape } from './calibration/priors.js';
import { BASIS_RANK, weakestBasis, estimate } from './schema/provenance.js';

describe('the engine can say no', () => {
  test('a pure lookup + calculate workload is told not to use AI', () => {
    const r = assess(INVOICE_LOOKUP);
    assert.equal(r.suitability.verdict, 'not-ai');
    assert.equal(r.architecture.pattern, 'deterministic-automation');
    assert.match(r.suitability.headline, /Don't use AI/);
  });

  test('not-ai workloads get a single build-the-rules phase with a kill criterion', () => {
    const r = assess(INVOICE_LOOKUP);
    assert.equal(r.phases.length, 1);
    assert.ok(r.phases[0]!.killCriteria.length > 0);
  });

  test('irreversible autonomous actions raise a blocker', () => {
    const r = assess({
      ...SUPPORT_TRIAGE,
      autonomy: 'full',
      actions: [{ name: 'Delete account', system: 'CRM', write: true, blastRadius: 'irreversible' }],
    });
    assert.equal(r.suitability.verdict, 'not-yet');
    assert.ok(r.suitability.blockers.some((b) => /irreversible/i.test(b)));
  });

  test('credentials in the data flow always block', () => {
    const r = assess({ ...SUPPORT_TRIAGE, dataClasses: ['credentials'] });
    assert.ok(r.suitability.blockers.some((b) => /[Cc]redentials/.test(b)));
  });

  test('trivial volume is a buy-or-do-manually decision', () => {
    const r = assess({ ...CONTENT_DRAFTING, volume: { ...CONTENT_DRAFTING.volume, unitsPerMonth: 20 } });
    assert.ok(r.suitability.blockers.some((b) => /[Vv]olume is too low/.test(b)));
  });
});

describe('architecture selection', () => {
  test('multi-step work with consequential actions gets a bounded agent, not autonomy', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.equal(r.architecture.pattern, 'bounded-agent');
    assert.ok(r.architecture.rejected.some((x) => x.pattern === 'autonomous-agent'));
  });

  test('external knowledge without multi-step gets RAG', () => {
    const r = assess(CONTENT_DRAFTING);
    assert.equal(r.architecture.pattern, 'rag');
  });

  test('every pattern includes the Control telemetry hook', () => {
    for (const w of [SUPPORT_TRIAGE, CONTENT_DRAFTING]) {
      assert.ok(assess(w).architecture.components.some((c) => /ARK Control/.test(c)));
    }
  });
});

describe('token economics', () => {
  test('cache hits reduce the bill', () => {
    const m = byId('claude-sonnet-5')!;
    const cold = costOfCall(m, { inputTokens: 10_000, outputTokens: 500 });
    const warm = costOfCall(m, { inputTokens: 10_000, outputTokens: 500, cacheHitRate: 0.9 });
    assert.ok(warm < cold);
  });

  test('batch halves the bill where supported', () => {
    const m = byId('claude-sonnet-5')!;
    const normal = costOfCall(m, { inputTokens: 1000, outputTokens: 1000 });
    const batched = costOfCall(m, { inputTokens: 1000, outputTokens: 1000, batch: true });
    assert.ok(Math.abs(batched - normal / 2) < 1e-9);
  });

  test('agent context growth compounds across turns', () => {
    const m = byId('claude-sonnet-5')!;
    const flat = costPerAttempt(m, { inputTokens: 1000, outputTokens: 200, turnsPerOutcome: 8 });
    const growing = costPerAttempt(m, { inputTokens: 1000, outputTokens: 200, turnsPerOutcome: 8, contextGrowthPerTurn: 1000 });
    assert.ok(growing > flat * 2, 'growing context should dominate the bill');
  });

  test('cost per SUCCESSFUL outcome exceeds cost per attempt when calls fail', () => {
    const m = byId('claude-sonnet-5')!;
    const shape = { inputTokens: 1000, outputTokens: 300, failureRate: 0.3, retriesPerFailure: 2 };
    assert.ok(costPerSuccessfulOutcome(m, shape) > costPerAttempt(m, shape));
  });

  test('a zero failure rate makes the two identical', () => {
    const m = byId('gpt-5-nano')!;
    const shape = { inputTokens: 500, outputTokens: 100, failureRate: 0 };
    assert.ok(Math.abs(costPerSuccessfulOutcome(m, shape) - costPerAttempt(m, shape)) < 1e-12);
  });
});

describe('value model refuses to invent numbers', () => {
  test('no baseline means no ROI, and the gap is stated', () => {
    const r = assess({ ...CONTENT_DRAFTING, current: {} });
    assert.equal(r.value.netPerMonth, null);
    assert.equal(r.value.paybackMonths, null);
    assert.ok(r.value.unknowns.some((u) => /ROI cannot be computed/.test(u)));
  });

  test('a supplied baseline produces a payback figure', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.ok(r.value.netPerMonth !== null);
    assert.ok(r.value.humanCostPerUnit !== null);
  });

  test('missing human error rate is called out', () => {
    const r = assess({ ...SUPPORT_TRIAGE, current: { minutesPerUnit: 7, fullyLoadedHourlyUsd: 38 } });
    assert.ok(r.value.unknowns.some((u) => /baseline error rate/.test(u)));
  });
});

describe('provenance', () => {
  test('an uncalibrated report is labelled heuristic', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.equal(r.trust.calibrated, false);
    assert.equal(r.trust.weakestBasis, 'heuristic');
    assert.ok(r.trust.unknowns.some((u) => /rule of thumb/i.test(u)));
  });

  test('telemetry promotes the basis from heuristic to measured', () => {
    const rows = Array.from({ length: 200 }, () => ({
      pattern: 'bounded-agent',
      turns: 9, inputTokensFirstTurn: 900, inputTokensLastTurn: 6000,
      succeeded: true, retries: 0, cachedInputTokens: 2000, totalInputTokens: 5000, costUsd: 0.04,
    }));
    const cal = buildCalibration(rows, { basis: 'measured', windowDays: 30, orgId: 'acme' });
    const r = assess(SUPPORT_TRIAGE, { calibration: cal });
    assert.equal(r.trust.calibrated, true);
    assert.equal(r.cost.perUnit.basis, 'measured');
    assert.equal(r.cost.perUnit.sampleSize, 200);
  });

  test('a thin sample is rejected and stays heuristic', () => {
    const rows = Array.from({ length: 5 }, () => ({
      pattern: 'bounded-agent', turns: 9, inputTokensFirstTurn: 900, inputTokensLastTurn: 6000,
      succeeded: true, retries: 0, cachedInputTokens: 0, totalInputTokens: 5000, costUsd: 0.04,
    }));
    const cal = buildCalibration(rows, { basis: 'measured', windowDays: 30 });
    const shape = resolveCallShape('bounded-agent',
      { turnsPerOutcome: 7, contextGrowthPerTurn: 900, failureRate: 0.15, retriesPerFailure: 1.5, cacheHitRate: 0.45 },
      cal);
    assert.equal(shape.basis, 'heuristic');
    assert.match(shape.source, /below the 30 needed/);
  });

  test('weakestBasis returns the softest input', () => {
    assert.equal(weakestBasis([
      estimate(1, 'measured', 'a'), estimate(2, 'heuristic', 'b'), estimate(3, 'calibrated', 'c'),
    ]), 'heuristic');
    assert.ok(BASIS_RANK.measured > BASIS_RANK.heuristic);
  });
});

describe('model catalog and routing', () => {
  test('every catalog entry carries an asOf date', () => {
    for (const m of CATALOG) assert.match(m.asOf, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('on-prem residency eliminates hosted providers', () => {
    const r = assess({ ...CONTENT_DRAFTING, dataResidency: 'on_prem' });
    assert.equal(r.model.primary.provider, 'local');
  });

  test('vision requirement filters to vision-capable models', () => {
    const m = cheapestMeeting('small', ['text', 'vision']);
    assert.ok(m && m.capabilities.includes('vision'));
  });

  test('substitution analysis finds cheaper models and states the risk', () => {
    const subs = findSubstitutions('claude-opus-5', { inputTokens: 2000, outputTokens: 500 }, 50_000, ['text']);
    assert.ok(subs.length > 0);
    assert.ok(subs[0]!.monthlySavingUsd > 0);
    assert.ok(subs[0]!.risk.length > 0);
    assert.equal(subs[0]!.confidence.basis, 'heuristic');
  });

  test('substitutions are marked measured when a sample size is supplied', () => {
    const subs = findSubstitutions('claude-opus-5', { inputTokens: 2000, outputTokens: 500 }, 50_000, ['text'], 4200);
    assert.equal(subs[0]!.confidence.basis, 'measured');
  });

  test('stale pricing detection works against a future date', () => {
    const stale = staleEntries(new Date('2027-06-01'));
    assert.ok(stale.length > 0, 'promotional rates should have lapsed by mid-2027');
  });
});

describe('consumer surface uses the same engine', () => {
  test('a personal workload produces a consumer-depth assessment', () => {
    const r = assessConsumer({
      id: 'c1', name: 'Summarise long emails', description: '',
      task: ['summarize'], timesPerMonth: 60, minutesEach: 4,
      involvesPersonalData: false, involvesMoneyOrLegal: false,
      needsExactAnswer: false, needsCurrentInfo: false, wouldNoticeIfWrong: 'eventually',
    });
    assert.equal(r.depth, 'consumer');
    assert.equal(r.workload.actor, 'self');
    assert.ok(r.evaluation.metrics.length <= 2, 'consumer eval plan stays short');
    assert.equal(r.evaluation.goldenSetSize, 10);
  });

  test('needing an exact answer routes a consumer away from AI too', () => {
    const r = assessConsumer({
      id: 'c2', name: 'Work out my exact tax owed', description: '',
      task: ['calculate'], timesPerMonth: 4, minutesEach: 30,
      involvesPersonalData: true, involvesMoneyOrLegal: true,
      needsExactAnswer: true, needsCurrentInfo: false, wouldNoticeIfWrong: 'never',
    });
    assert.equal(r.suitability.verdict, 'not-ai');
  });

  test('personal data raises security drivers even at consumer depth', () => {
    const r = assessConsumer({
      id: 'c3', name: 'Sort through my medical bills', description: '',
      task: ['extract', 'classify'], timesPerMonth: 20, minutesEach: 10,
      involvesPersonalData: true, involvesMoneyOrLegal: true,
      needsExactAnswer: false, needsCurrentInfo: false, wouldNoticeIfWrong: 'eventually',
    });
    assert.ok(r.security.drivers.length > 0);
    assert.ok(r.security.controls.some((c) => c.id === 'SEC-01'));
  });
});

describe('security and evaluation', () => {
  test('write actions require scoped credentials', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.ok(r.security.controls.some((c) => c.id === 'SEC-04' && c.blocking));
  });

  test('costly actions get a human approval gate', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.ok(r.security.controls.some((c) => c.id === 'SEC-05'));
  });

  test('every control names how Control verifies it', () => {
    for (const c of assess(SUPPORT_TRIAGE).security.controls) {
      assert.ok(c.verifiedBy.length > 10, `${c.id} needs a verification hook`);
    }
  });

  test('agentic patterns require an injection test suite', () => {
    const r = assess(SUPPORT_TRIAGE);
    assert.ok(r.evaluation.metrics.some((m) => /injection/i.test(m.name)));
    assert.ok(r.evaluation.metrics.some((m) => /[Uu]nauthorised action/.test(m.name)));
  });

  test('accuracy threshold tightens as error tolerance falls', () => {
    const strict = assess({ ...CONTENT_DRAFTING, errorTolerance: 'none' });
    const loose = assess({ ...CONTENT_DRAFTING, errorTolerance: 'high' });
    assert.ok(strict.evaluation.metrics[0]!.threshold > loose.evaluation.metrics[0]!.threshold);
  });

  test('every roadmap phase has a kill criterion', () => {
    for (const p of assess(SUPPORT_TRIAGE).phases) {
      assert.ok(p.killCriteria.length > 10, `${p.name} needs a kill criterion`);
    }
  });

  test('teams without security review get a review phase inserted', () => {
    const r = assess({ ...SUPPORT_TRIAGE, team: { ...SUPPORT_TRIAGE.team, hasSecurityReview: false } });
    assert.ok(r.phases.some((p) => /Security review/.test(p.name)));
  });
});
