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
import { CalibrationSet, resolveCallShape, withPriorBasis, type CallShapePrior } from '../calibration/priors.js';
import { byId } from '../models/catalog.js';

export * from './suitability.js';
export * from './architecture.js';
export * from './security.js';
export * from './evaluation.js';
export * from './roadmap.js';

/** Depth is the ONLY difference between the consumer and business surfaces. */
export type Depth = 'consumer' | 'business';

/**
 * Limits on `POST /api/assess`, here so the route that enforces them and the
 * methodology page that documents them read one number. A batch is a backlog
 * scored in CI, not a bulk-export channel.
 */
export const ASSESS_API_LIMITS = { maxWorkloads: 20, maxBodyBytes: 256 * 1024 } as const;

/** Monthly cost, with no model id on the not-ai path because no model runs. */
export type AssessmentCost = Omit<MonthlyCost, 'modelId'> & { modelId: string | null };

/** Source string for the not-ai cost figures. */
export const DETERMINISTIC_COST_SOURCE =
  'deterministic implementation — no model calls, so run cost is compute and storage you already pay for: approximately nothing';

export interface Assessment {
  depth: Depth;
  workload: Workload;
  suitability: Suitability;
  architecture: ArchitectureRecommendation;
  /**
   * Null when the verdict is not-ai. A report that refuses a model must not
   * then name one, so the engine does not produce one to name.
   */
  model: ModelRecommendation | null;
  cost: AssessmentCost;
  /**
   * The call shape the cost was computed from, with its basis: the rubric
   * prior, or Control's observed shape once the pattern clears the sample
   * floor. `architecture.callShape` is always the rubric; this is what was used.
   */
  callShape: CallShapePrior;
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
  const notAi = suitability.verdict === 'not-ai';
  const model = notAi ? null : recommendModel(w);
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

  let cost: AssessmentCost;
  if (model) {
    const rawCost = monthlyCost(model.primary.id, shape, w.volume.unitsPerMonth, prior.source);
    cost = {
      modelId: rawCost.modelId,
      perUnit: withPriorBasis(rawCost.perUnit, prior),
      perMonth: withPriorBasis(rawCost.perMonth, prior),
      wastedOnFailures: withPriorBasis(rawCost.wastedOnFailures, prior),
    };
  } else {
    const zero = estimate(0, 'heuristic', DETERMINISTIC_COST_SOURCE);
    cost = { modelId: null, perUnit: zero, perMonth: zero, wastedOnFailures: zero };
  }

  const buildCost = estimateBuildCost(w, architecture.pattern);
  const modelled = valueModel(w, cost.perUnit, buildCost.value, opts.displacementFactor ?? 0.6);
  // Inference spend per dollar of value has no meaning without inference.
  const value: ValueModel = notAi ? { ...modelled, spendPerDollarOfValue: null } : modelled;

  const all: Estimate<unknown>[] = [
    suitability.score, cost.perUnit, cost.perMonth, buildCost,
    ...(value.netPerMonth ? [value.netPerMonth] : []),
  ];
  const weakest = weakestBasis(all);

  const unknowns = [...value.unknowns];
  if (!notAi && prior.basis === 'heuristic') {
    unknowns.push(
      `Call shape for "${architecture.pattern}" is a rule of thumb, not a measurement. Turns per outcome and failure rate are the two numbers that most move the cost figure, and neither is observed here.`,
    );
  }
  const staleModel = model ? byId(model.primary.id) : undefined;
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
    callShape: prior,
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
export function assessConsumer(intake: unknown, opts: AssessOptions = {}): Assessment {
  return assess(fromConsumerIntake(ConsumerIntake.parse(intake)), { ...opts, depth: 'consumer' });
}
