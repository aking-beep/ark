import { Workload, ConsumerIntake, fromConsumerIntake } from '../schema/workload.js';
import { Estimate, estimate, weakestBasis, describeBasis, Basis } from '../schema/provenance.js';
import { assessSuitability, Suitability } from './suitability.js';
import { recommendArchitecture, ArchitectureRecommendation } from './architecture.js';
import { assessSecurity, SecurityAssessment } from './security.js';
import { evaluationPlan, EvaluationPlan } from './evaluation.js';
import { roadmap, Phase } from './roadmap.js';
import { recommendModel, ModelRecommendation } from '../models/routing.js';
import { monthlyCost, MonthlyCost } from '../economics/tokens.js';
import { valueModel, ValueModel, estimateBuildCost } from '../economics/value.js';
import { CalibrationSet, resolveCallShape, withPriorBasis } from '../calibration/priors.js';
import { byId } from '../models/catalog.js';

export * from './suitability.js';
export * from './architecture.js';
export * from './security.js';
export * from './evaluation.js';
export * from './roadmap.js';

/** Depth is the ONLY difference between the consumer and business surfaces. */
export type Depth = 'consumer' | 'business';

export interface Assessment {
  depth: Depth;
  workload: Workload;
  suitability: Suitability;
  architecture: ArchitectureRecommendation;
  model: ModelRecommendation;
  cost: MonthlyCost;
  value: ValueModel;
  buildCost: Estimate;
  security: SecurityAssessment;
  evaluation: EvaluationPlan;
  phases: Phase[];
  /** The honesty layer: what this report rests on, and what it does not know. */
  trust: {
    weakestBasis: Basis;
    caveat: string;
    calibrated: boolean;
    unknowns: string[];
  };
}

export interface AssessOptions {
  depth?: Depth;
  calibration?: CalibrationSet | null;
  /** Share of the human task AI actually removes. */
  displacementFactor?: number;
}

/**
 * One engine, two surfaces.
 *
 * The consumer app and the business app call this same function. They differ
 * in how much they ask for and how much they render — not in how they reason.
 * That is deliberate: it means the B2C product is a genuine on-ramp to the
 * B2B one rather than a separate toy, and there is only ever one scoring
 * methodology to defend.
 */
export function assess(input: Workload, opts: AssessOptions = {}): Assessment {
  const depth = opts.depth ?? (input.actor === 'self' ? 'consumer' : 'business');
  const w = Workload.parse(input);

  const suitability = assessSuitability(w);
  const architecture = recommendArchitecture(w, suitability.verdict);
  const model = recommendModel(w);
  const security = assessSecurity(w, architecture.pattern);
  const evaluation = evaluationPlan(w, architecture.pattern);
  const phases = roadmap(w, architecture.pattern, suitability.verdict);

  // Prefer observed call shapes over rubric priors where telemetry exists.
  const prior = resolveCallShape(architecture.pattern, architecture.callShape, opts.calibration);

  const shape = {
    inputTokens: w.input.avgTokens,
    outputTokens: w.output.avgTokens,
    turnsPerOutcome: prior.turnsPerOutcome,
    contextGrowthPerTurn: prior.contextGrowthPerTurn,
    failureRate: prior.failureRate,
    retriesPerFailure: prior.retriesPerFailure,
    cacheHitRate: prior.cacheHitRate,
  };

  const rawCost = monthlyCost(model.primary.id, shape, w.volume.unitsPerMonth, prior.source);
  const cost: MonthlyCost = {
    modelId: rawCost.modelId,
    perUnit: withPriorBasis(rawCost.perUnit, prior),
    perMonth: withPriorBasis(rawCost.perMonth, prior),
    wastedOnFailures: withPriorBasis(rawCost.wastedOnFailures, prior),
  };

  const buildCost = estimateBuildCost(w, architecture.pattern);
  const value = valueModel(w, cost.perUnit, buildCost.value, opts.displacementFactor ?? 0.6);

  const all: Estimate<unknown>[] = [
    suitability.score, cost.perUnit, cost.perMonth, buildCost,
    ...(value.netPerMonth ? [value.netPerMonth] : []),
  ];
  const weakest = weakestBasis(all);

  const unknowns = [...value.unknowns];
  if (prior.basis === 'heuristic') {
    unknowns.push(
      `Call shape for "${architecture.pattern}" is a rule of thumb, not a measurement. Turns per outcome and failure rate are the two numbers that most move the cost figure, and neither is observed here.`,
    );
  }
  const staleModel = byId(model.primary.id);
  if (staleModel?.priceExpiresOn && new Date(staleModel.priceExpiresOn) > new Date()) {
    unknowns.push(
      `${staleModel.displayName} is on a promotional rate that changes on ${staleModel.priceExpiresOn}. Budget past that date at the post-promotional price.`,
    );
  }

  return {
    depth,
    workload: w,
    suitability,
    architecture,
    model,
    cost,
    value,
    buildCost,
    security,
    evaluation,
    phases,
    trust: {
      weakestBasis: weakest,
      caveat: describeBasis({ ...cost.perUnit, basis: weakest } as Estimate<number>),
      calibrated: prior.basis !== 'heuristic',
      unknowns,
    },
  };
}

/** Consumer entry point. Same engine, narrower intake. */
export function assessConsumer(intake: ConsumerIntake, opts: AssessOptions = {}): Assessment {
  return assess(fromConsumerIntake(intake), { ...opts, depth: 'consumer' });
}
