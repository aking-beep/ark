import { Workload } from '../schema/workload.js';
import { Estimate, estimate } from '../schema/provenance.js';

/**
 * AI unit economics.
 *
 * The argument this module exists to make: "34M tokens" is not a business
 * fact. "$1.82 per completed workflow against $6.10 of labour displaced" is.
 * Where the inputs to compute that are missing, we return null rather than
 * inventing a denominator — a fabricated ROI is worse than no ROI.
 */

export interface ValueModel {
  /** Human cost of one unit today. Null when the caller did not tell us. */
  humanCostPerUnit: Estimate | null;
  aiCostPerUnit: Estimate;
  /** Positive = AI is cheaper per unit. */
  netPerUnit: Estimate | null;
  netPerMonth: Estimate | null;
  /** Months to repay the build. Null when we cannot know. */
  paybackMonths: Estimate | null;
  /** The ratio in the doc: inference spend per dollar of value produced. */
  spendPerDollarOfValue: Estimate | null;
  unknowns: string[];
}

export function valueModel(
  w: Workload,
  aiCostPerUnit: Estimate,
  buildCostUsd: number,
  /** Share of the task AI actually removes. Rarely 1.0, and assuming so is the classic error. */
  displacementFactor = 0.6,
): ValueModel {
  const unknowns: string[] = [];
  const { minutesPerUnit, fullyLoadedHourlyUsd, costPerUnitUsd } = w.current;

  let humanCost: number | null = null;
  if (costPerUnitUsd !== undefined && costPerUnitUsd > 0) {
    humanCost = costPerUnitUsd;
  } else if (minutesPerUnit !== undefined && fullyLoadedHourlyUsd) {
    humanCost = (minutesPerUnit / 60) * fullyLoadedHourlyUsd;
  } else {
    unknowns.push(
      'No current cost per unit and no (minutes × loaded hourly rate). ROI cannot be computed — only spend can.',
    );
  }

  const humanEst = humanCost === null ? null
    : estimate(round(humanCost, 4), 'heuristic', 'stated time and loaded labour rate');

  if (w.current.humanErrorRate === undefined) {
    unknowns.push(
      'No human baseline error rate supplied. Without it, "AI is 94% accurate" has nothing to be compared against.',
    );
  }

  const units = w.volume.unitsPerMonth;
  let net: number | null = null;
  let netMonth: number | null = null;
  let payback: number | null = null;
  let ratio: number | null = null;

  if (humanCost !== null) {
    const displaced = humanCost * clamp01(displacementFactor);
    net = displaced - aiCostPerUnit.value;
    netMonth = net * units;
    ratio = displaced > 0 ? aiCostPerUnit.value / displaced : null;
    payback = netMonth > 0 ? buildCostUsd / netMonth : null;
    if (payback === null && buildCostUsd > 0) {
      unknowns.push('Monthly saving is zero or negative, so the build never pays back at this volume.');
    }
  }

  const src = 'unit economics from stated baseline and modelled inference cost';
  return {
    humanCostPerUnit: humanEst,
    aiCostPerUnit,
    netPerUnit: net === null ? null : estimate(round(net, 4), 'heuristic', src),
    netPerMonth: netMonth === null ? null : estimate(round(netMonth, 2), 'heuristic', src),
    paybackMonths: payback === null ? null : estimate(round(payback, 1), 'heuristic', src),
    spendPerDollarOfValue: ratio === null ? null : estimate(round(ratio, 3), 'heuristic', src),
    unknowns,
  };
}

/**
 * Rough build cost. Deliberately crude and labelled as such — the point is to
 * stop people comparing a $40/month inference bill against zero engineering.
 */
export function estimateBuildCost(w: Workload, pattern: string): Estimate {
  const base: Record<string, number> = {
    'deterministic-automation': 6_000,
    'classifier': 12_000,
    'llm-single-shot': 8_000,
    'rag': 28_000,
    'llm-workflow': 35_000,
    'bounded-agent': 60_000,
    'autonomous-agent': 110_000,
    'hybrid-human-loop': 30_000,
  };
  let cost = base[pattern] ?? 25_000;

  cost += w.input.sourceSystems.length * 4_000;
  cost += w.actions.filter((a) => a.write).length * 6_000;
  if (w.dataClasses.some((d) => ['phi', 'pci', 'sensitive_pii', 'credentials', 'minors'].includes(d))) cost *= 1.4;
  if (w.regulated.some((r) => r !== 'none')) cost *= 1.3;
  if (!w.team.hasMlExperience) cost *= 1.25;
  if (w.team.engineers === 0) cost *= 1.5;

  return estimate(Math.round(cost / 500) * 500, 'heuristic',
    'parametric build-cost rubric — replace with your own delivery actuals as soon as you have two projects to compare');
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, dp: number) => Number(n.toFixed(dp));
