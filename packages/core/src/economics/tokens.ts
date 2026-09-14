import { ModelEntry, byId } from '../models/catalog.js';
import { Estimate, estimate } from '../schema/provenance.js';

export interface CallShape {
  inputTokens: number;
  outputTokens: number;
  /** Portion of input served from prompt cache, 0..1. */
  cacheHitRate?: number;
  /** Batch API halves the bill across the major providers. */
  batch?: boolean;
}

/** Cost of a single call, in USD. */
export function costOfCall(model: ModelEntry, shape: CallShape): number {
  const hit = clamp01(shape.cacheHitRate ?? 0);
  const cachedRate = model.cachedInputPer1M ?? model.inputPer1M * 0.1;

  const cachedIn = shape.inputTokens * hit;
  const freshIn = shape.inputTokens * (1 - hit);

  let cost =
    (freshIn / 1e6) * model.inputPer1M +
    (cachedIn / 1e6) * cachedRate +
    (shape.outputTokens / 1e6) * model.outputPer1M;

  if (shape.batch && model.capabilities.includes('batch')) cost *= 0.5;
  return cost;
}

/**
 * The number that actually matters.
 *
 * A workload does not cost you one call per unit of work. It costs you the
 * successful calls, plus the failed calls you paid for anyway, plus the
 * retries, plus — if there is an agent loop — every intermediate turn that
 * produced no user-visible output. Dashboards that report tokens hide all of
 * this. This function refuses to.
 */
export interface OutcomeShape extends CallShape {
  /** Fraction of attempts that fail and are retried, 0..1. */
  failureRate?: number;
  /** Mean retries per failure. */
  retriesPerFailure?: number;
  /** Model turns per unit of work. 1 for single-shot; higher for agents. */
  turnsPerOutcome?: number;
  /**
   * Agent loops re-send growing context each turn. This is the single largest
   * source of surprise in agent bills, so it is modelled explicitly.
   */
  contextGrowthPerTurn?: number;
}

export function costPerAttempt(model: ModelEntry, s: OutcomeShape): number {
  const turns = Math.max(1, s.turnsPerOutcome ?? 1);
  const growth = s.contextGrowthPerTurn ?? 0;

  let total = 0;
  for (let t = 0; t < turns; t++) {
    const inputTokens = s.inputTokens + growth * t;
    total += costOfCall(model, {
      inputTokens,
      outputTokens: s.outputTokens,
      cacheHitRate: s.cacheHitRate,
      batch: s.batch,
    });
  }
  return total;
}

/** Cost per SUCCESSFUL outcome — retries and dead-end attempts included. */
export function costPerSuccessfulOutcome(model: ModelEntry, s: OutcomeShape): number {
  const fail = clamp01(s.failureRate ?? 0);
  const retries = s.retriesPerFailure ?? 1;
  const attempt = costPerAttempt(model, s);

  // Expected attempts to land one success, plus the paid-for failures.
  const successRate = Math.max(1e-6, 1 - fail);
  const attemptsPerSuccess = 1 + fail * retries / successRate;
  return attempt * attemptsPerSuccess;
}

export interface MonthlyCost {
  perUnit: Estimate;
  perMonth: Estimate;
  wastedOnFailures: Estimate;
  modelId: string;
}

export function monthlyCost(
  modelId: string,
  s: OutcomeShape,
  unitsPerMonth: number,
  basisSource = 'catalog pricing + heuristic call shape',
): MonthlyCost {
  const model = byId(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  const perUnit = costPerSuccessfulOutcome(model, s);
  const ideal = costPerAttempt(model, s);
  const waste = (perUnit - ideal) * unitsPerMonth;

  return {
    modelId,
    perUnit: estimate(round(perUnit, 6), 'heuristic', basisSource, {
      low: round(ideal, 6),
      high: round(perUnit * 1.6, 6),
      asOf: model.asOf,
    }),
    perMonth: estimate(round(perUnit * unitsPerMonth, 2), 'heuristic', basisSource, {
      low: round(ideal * unitsPerMonth, 2),
      high: round(perUnit * unitsPerMonth * 1.6, 2),
      asOf: model.asOf,
    }),
    wastedOnFailures: estimate(round(Math.max(0, waste), 2), 'heuristic',
      'retry and failure overhead at the assumed failure rate'),
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, dp: number) => Number(n.toFixed(dp));
