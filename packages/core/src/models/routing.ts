import { Workload, TaskShape } from '../schema/workload.js';
import {
  CATALOG, ModelEntry, Capability, Tier, Provider,
  byId, cheapestMeeting, tierRank, blendedRate,
} from './catalog.js';
import { Estimate, estimate } from '../schema/provenance.js';
import { costPerSuccessfulOutcome, OutcomeShape } from '../economics/tokens.js';

/**
 * Tier demanded by the hardest thing in the workload.
 *
 * The prevailing failure in the field is sending everything to a frontier
 * model because it is the one people have heard of. Most production token
 * volume is classification and extraction, which a small model does at a
 * fraction of the price.
 */
const TASK_MIN_TIER: Record<TaskShape, Tier> = {
  lookup: 'nano',
  calculate: 'nano',
  classify: 'nano',
  extract: 'small',
  search: 'small',
  summarize: 'small',
  converse: 'mid',
  generate: 'mid',
  decide: 'mid',
  act: 'mid',
};

export interface Requirements {
  tier: Tier;
  capabilities: Capability[];
  minContext: number;
  excludeProviders: Provider[];
  rationale: string[];
}

export function requirementsFor(w: Workload): Requirements {
  const rationale: string[] = [];

  let tier = w.task
    .map((t) => TASK_MIN_TIER[t])
    .reduce<Tier>((hi, t) => (tierRank(t) > tierRank(hi) ? t : hi), 'nano');
  rationale.push(`Hardest task shape (${w.task.join(', ')}) sets a floor of ${tier}.`);

  if (w.determinism === 'subjective' && tierRank(tier) < tierRank('mid')) {
    tier = 'mid';
    rationale.push('Subjective quality bar raises the floor to mid.');
  }
  if (w.errorTolerance === 'none' && tierRank(tier) < tierRank('mid')) {
    tier = 'mid';
    rationale.push('Zero error tolerance raises the floor to mid — though see the suitability verdict first.');
  }
  if (w.multiStep && w.actions.length > 0 && tierRank(tier) < tierRank('mid')) {
    tier = 'mid';
    rationale.push('Multi-step tool use needs reliable function calling; floor raised to mid.');
  }
  if (w.actions.some((a) => a.blastRadius === 'irreversible') && tierRank(tier) < tierRank('frontier')) {
    tier = 'frontier';
    rationale.push('An irreversible action is in scope. Frontier tier — and a human gate, per the security plan.');
  }

  const capabilities: Capability[] = ['text'];
  if (w.input.modality.includes('image') || w.input.modality.includes('video')) capabilities.push('vision');
  if (w.input.modality.includes('audio')) capabilities.push('audio');
  if (w.output.mustBeStructured) capabilities.push('structured_output');
  if (w.actions.length > 0) capabilities.push('tool_use');
  if (w.multiStep && w.determinism === 'subjective') capabilities.push('reasoning');

  const minContext = Math.ceil((w.input.avgTokens * 3 + w.output.avgTokens) / 1000) * 1000;
  if (minContext > 100_000) rationale.push(`Long inputs require at least a ${minContext.toLocaleString()}-token window.`);

  const excludeProviders: Provider[] = [];
  if (w.dataResidency === 'on_prem') {
    excludeProviders.push('anthropic', 'openai', 'google', 'bedrock');
    rationale.push('On-premise residency requirement eliminates every hosted API. Local weights only.');
  }
  if (w.dataClasses.includes('credentials')) {
    rationale.push('Credentials in scope — the real fix is redaction before the call, not model choice.');
  }

  return { tier, capabilities, minContext, excludeProviders, rationale };
}

export interface ModelRecommendation {
  primary: ModelEntry;
  /** Cheaper model to route the easy majority to, when the split is worth it. */
  fallbackFast?: ModelEntry;
  /** Escalation target for the hard minority. */
  escalateTo?: ModelEntry;
  requirements: Requirements;
  /** Alternatives across providers so nobody is locked in by default. */
  alternatives: ModelEntry[];
  rationale: string[];
}

export function recommendModel(w: Workload): ModelRecommendation {
  const req = requirementsFor(w);
  const rationale = [...req.rationale];

  const primary =
    cheapestMeeting(req.tier, req.capabilities, {
      excludeProviders: req.excludeProviders,
      minContext: req.minContext,
    }) ??
    // Relax context, then capability, rather than failing outright.
    cheapestMeeting(req.tier, req.capabilities, { excludeProviders: req.excludeProviders }) ??
    cheapestMeeting(req.tier, ['text'], { excludeProviders: req.excludeProviders }) ??
    CATALOG.filter((m) => !req.excludeProviders.includes(m.provider)).sort((a, b) => blendedRate(a) - blendedRate(b))[0]!;

  rationale.push(`${primary.displayName} is the cheapest ${req.tier}-tier model meeting every requirement.`);

  // A two-tier split only pays when volume is high and most units are easy.
  const lowerTier: Tier | undefined =
    req.tier === 'frontier' ? 'mid' : req.tier === 'mid' ? 'small' : req.tier === 'small' ? 'nano' : undefined;

  let fallbackFast: ModelEntry | undefined;
  if (lowerTier && w.volume.unitsPerMonth >= 5_000) {
    fallbackFast = cheapestMeeting(lowerTier, req.capabilities, { excludeProviders: req.excludeProviders });
    if (fallbackFast) {
      rationale.push(
        `At ${w.volume.unitsPerMonth.toLocaleString()} units/month, route the easy majority to ${fallbackFast.displayName} and escalate only what fails a confidence check.`,
      );
    }
  }

  const escalateTo =
    w.errorTolerance === 'none' || w.actions.some((a) => a.blastRadius !== 'reversible')
      ? cheapestMeeting('frontier', req.capabilities, { excludeProviders: req.excludeProviders })
      : undefined;

  const alternatives = CATALOG
    .filter((m) => m.tier === req.tier && m.id !== primary.id)
    .filter((m) => !req.excludeProviders.includes(m.provider))
    .filter((m) => req.capabilities.every((c) => m.capabilities.includes(c)))
    .sort((a, b) => blendedRate(a) - blendedRate(b))
    .slice(0, 4);

  return { primary, fallbackFast, escalateTo, requirements: req, alternatives, rationale };
}

/**
 * Substitution analysis — the ARK Control money shot.
 *
 * Given what a workload is ACTUALLY running on, say whether something cheaper
 * would do, and what the swap is worth per month. Requires an observed call
 * shape, which is why this belongs downstream of telemetry, not upstream of it.
 */
export interface Substitution {
  fromModelId: string;
  toModelId: string;
  currentMonthlyUsd: number;
  proposedMonthlyUsd: number;
  monthlySavingUsd: number;
  savingPct: number;
  /** Plain statement of what you are trading away. */
  risk: string;
  confidence: Estimate<string>;
}

export function findSubstitutions(
  currentModelId: string,
  shape: OutcomeShape,
  unitsPerMonth: number,
  requiredCaps: Capability[],
  observedSampleSize?: number,
): Substitution[] {
  const current = byId(currentModelId);
  if (!current) return [];

  const currentCost = costPerSuccessfulOutcome(current, shape) * unitsPerMonth;

  return CATALOG
    .filter((m) => m.id !== current.id)
    .filter((m) => tierRank(m.tier) < tierRank(current.tier))
    .filter((m) => requiredCaps.every((c) => m.capabilities.includes(c)))
    .filter((m) => m.contextWindow >= (shape.inputTokens + shape.outputTokens) * 1.2)
    .map((m) => {
      const proposed = costPerSuccessfulOutcome(m, shape) * unitsPerMonth;
      const saving = currentCost - proposed;
      const tierDrop = tierRank(current.tier) - tierRank(m.tier);
      return {
        fromModelId: current.id,
        toModelId: m.id,
        currentMonthlyUsd: round(currentCost, 2),
        proposedMonthlyUsd: round(proposed, 2),
        monthlySavingUsd: round(saving, 2),
        savingPct: currentCost > 0 ? round((saving / currentCost) * 100, 1) : 0,
        risk:
          tierDrop >= 2
            ? 'Two capability tiers down. Do not ship this without an offline eval on real traffic — the saving is real, the quality drop might be too.'
            : 'One tier down. Shadow-run it against production traffic for a week and compare on your own rubric before switching.',
        confidence: estimate(
          tierDrop >= 2 ? 'speculative' : 'plausible',
          observedSampleSize ? 'measured' : 'heuristic',
          observedSampleSize
            ? `observed call shape over ${observedSampleSize} calls`
            : 'assumed call shape — connect ARK Control to replace this with measurement',
          { sampleSize: observedSampleSize },
        ),
      };
    })
    .filter((s) => s.monthlySavingUsd > 0)
    .sort((a, b) => b.monthlySavingUsd - a.monthlySavingUsd)
    .slice(0, 5);
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));
