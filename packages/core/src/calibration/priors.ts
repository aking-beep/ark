import { z } from 'zod';
import { Pattern } from '../assess/architecture.js';
import { Estimate, estimate, Basis } from '../schema/provenance.js';

/**
 * The feedback loop. This module is why Control is built before AIFit.
 *
 * AIFit ships with rules of thumb for how many turns a pattern takes, how
 * often calls fail, how much context an agent accumulates. Those are guesses.
 * ARK Control observes the same quantities in production and emits a
 * CalibrationSet. AIFit then prefers observed values over its own priors, and
 * re-labels the resulting estimates from `heuristic` to `calibrated` or
 * `measured`.
 *
 * The practical consequence: the assessment product gets more accurate as the
 * telemetry product collects more data, and nothing else in the market has
 * that loop closed. Without it, AIFit is a well-organised opinion.
 */

export const PatternPrior = z.object({
  pattern: z.string(),
  turnsPerOutcome: z.number(),
  contextGrowthPerTurn: z.number(),
  failureRate: z.number(),
  retriesPerFailure: z.number(),
  cacheHitRate: z.number(),
  /** Observed cost per successful outcome, USD. */
  costPerOutcomeUsd: z.number().optional(),
  sampleSize: z.number(),
  /** p50/p95 spread, so AIFit can show a range rather than a false point. */
  p95TurnsPerOutcome: z.number().optional(),
});
export type PatternPrior = z.infer<typeof PatternPrior>;

export const CalibrationSet = z.object({
  /** 'measured' when from this org's own data; 'calibrated' when from the fleet. */
  basis: z.enum(['measured', 'calibrated']),
  generatedAt: z.string(),
  windowDays: z.number(),
  orgId: z.string().optional(),
  patterns: z.array(PatternPrior),
  /** Observed build-cost actuals, if the org records delivery effort. */
  buildCostActualsUsd: z.record(z.string(), z.number()).optional(),
});
export type CalibrationSet = z.infer<typeof CalibrationSet>;

export interface CallShapePrior {
  turnsPerOutcome: number;
  contextGrowthPerTurn: number;
  failureRate: number;
  retriesPerFailure: number;
  cacheHitRate: number;
  basis: Basis;
  sampleSize?: number;
  source: string;
}

/**
 * Resolve the call shape for a pattern, preferring observation over rubric.
 * `fallback` is the hard-coded prior from architecture.ts.
 */
export function resolveCallShape(
  pattern: Pattern,
  fallback: Omit<CallShapePrior, 'basis' | 'source' | 'sampleSize'>,
  calibration?: CalibrationSet | null,
  minSample = 30,
): CallShapePrior {
  const observed = calibration?.patterns.find((p) => p.pattern === pattern);

  if (!observed || observed.sampleSize < minSample) {
    return {
      ...fallback,
      basis: 'heuristic',
      source: observed
        ? `ARK rubric — only ${observed.sampleSize} observations for "${pattern}", below the ${minSample} needed to trust them`
        : 'ARK rubric v0.1 — no telemetry for this pattern yet. Connect ARK Control to replace this with measurement.',
    };
  }

  return {
    turnsPerOutcome: observed.turnsPerOutcome,
    contextGrowthPerTurn: observed.contextGrowthPerTurn,
    failureRate: observed.failureRate,
    retriesPerFailure: observed.retriesPerFailure,
    cacheHitRate: observed.cacheHitRate,
    basis: calibration!.basis,
    sampleSize: observed.sampleSize,
    source: `ARK Control, ${calibration!.windowDays}-day window, ${observed.sampleSize.toLocaleString()} outcomes`,
  };
}

/** Promote an estimate's basis when the shape behind it was observed. */
export function withPriorBasis<T>(e: Estimate<T>, prior: CallShapePrior): Estimate<T> {
  if (prior.basis === 'heuristic') return e;
  return estimate(e.value, prior.basis, prior.source, {
    low: e.low,
    high: e.high,
    sampleSize: prior.sampleSize,
    asOf: e.asOf,
  });
}

/**
 * Build a CalibrationSet from raw outcome rows. Control calls this; the shape
 * is defined here so both sides agree on the contract.
 */
export interface OutcomeRow {
  pattern: string;
  turns: number;
  inputTokensFirstTurn: number;
  inputTokensLastTurn: number;
  succeeded: boolean;
  retries: number;
  cachedInputTokens: number;
  totalInputTokens: number;
  costUsd: number;
}

export function buildCalibration(
  rows: OutcomeRow[],
  opts: { basis: 'measured' | 'calibrated'; windowDays: number; orgId?: string },
): CalibrationSet {
  const byPattern = new Map<string, OutcomeRow[]>();
  for (const r of rows) {
    const list = byPattern.get(r.pattern) ?? [];
    list.push(r);
    byPattern.set(r.pattern, list);
  }

  const patterns: PatternPrior[] = [];
  for (const [pattern, rs] of byPattern) {
    const n = rs.length;
    const successes = rs.filter((r) => r.succeeded);
    const turns = rs.map((r) => r.turns).sort((a, b) => a - b);
    const growth = rs
      .filter((r) => r.turns > 1)
      .map((r) => (r.inputTokensLastTurn - r.inputTokensFirstTurn) / (r.turns - 1));

    patterns.push({
      pattern,
      turnsPerOutcome: mean(rs.map((r) => r.turns)),
      contextGrowthPerTurn: growth.length ? mean(growth) : 0,
      failureRate: n ? (n - successes.length) / n : 0,
      retriesPerFailure: (() => {
        const failed = rs.filter((r) => !r.succeeded);
        return failed.length ? mean(failed.map((r) => r.retries)) : 0;
      })(),
      cacheHitRate: (() => {
        const tot = sum(rs.map((r) => r.totalInputTokens));
        return tot ? sum(rs.map((r) => r.cachedInputTokens)) / tot : 0;
      })(),
      costPerOutcomeUsd: successes.length ? sum(rs.map((r) => r.costUsd)) / successes.length : undefined,
      sampleSize: n,
      p95TurnsPerOutcome: turns.length ? turns[Math.min(turns.length - 1, Math.floor(turns.length * 0.95))] : undefined,
    });
  }

  return {
    basis: opts.basis,
    generatedAt: new Date().toISOString(),
    windowDays: opts.windowDays,
    orgId: opts.orgId,
    patterns,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
