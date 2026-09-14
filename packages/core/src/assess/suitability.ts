import { Workload, DETERMINISTIC_SHAPES } from '../schema/workload.js';
import { Estimate, estimate } from '../schema/provenance.js';

/**
 * Suitability.
 *
 * The design constraint that matters most here: this function must be able to
 * return "no". An assessment tool that always finds a way to recommend AI is
 * a lead-generation form, not an assessment tool. The `blockers` path below is
 * the reason anyone would trust the rest of the report.
 */

export type Verdict =
  | 'not-ai'          // a deterministic system is the right answer
  | 'not-yet'         // could work, but something must change first
  | 'assisted'        // AI helps a human who stays in charge
  | 'automate-bounded'// AI runs the job inside hard limits
  | 'automate';       // AI runs the job

export interface Dimension {
  key: string;
  label: string;
  score: number;      // 0..100
  weight: number;
  reasoning: string;
}

export interface Suitability {
  verdict: Verdict;
  headline: string;
  score: Estimate;
  dimensions: Dimension[];
  blockers: string[];
  /** Things that would move the verdict up a rung, in priority order. */
  unlocks: string[];
}

export function assessSuitability(w: Workload): Suitability {
  const dims: Dimension[] = [];
  const blockers: string[] = [];
  const unlocks: string[] = [];

  // --- 1. Task fit -----------------------------------------------------
  const onlyDeterministic = w.task.every((t) => DETERMINISTIC_SHAPES.includes(t));
  const hasDeterministic = w.task.some((t) => DETERMINISTIC_SHAPES.includes(t));
  const taskFit = onlyDeterministic ? 5 : hasDeterministic ? 55 : 85;
  dims.push({
    key: 'taskFit', label: 'Task fit', score: taskFit, weight: 0.22,
    reasoning: onlyDeterministic
      ? 'This is lookup and arithmetic. A query and a rule engine do it correctly, every time, for approximately nothing. A language model would do it probabilistically and charge you for the privilege.'
      : hasDeterministic
        ? 'Part of this job is deterministic. Split it: rules for the exact part, a model only for the ambiguous remainder.'
        : 'The work is genuinely linguistic or judgment-based — the shape language models handle well.',
  });
  if (onlyDeterministic) {
    blockers.push('The task as described has one correct answer that can be computed. Build the deterministic version first; if it turns out ambiguity exists, come back.');
  }

  // --- 2. Determinism demand ------------------------------------------
  const detScore = w.determinism === 'exact' ? 15 : w.determinism === 'tolerant' ? 80 : 90;
  dims.push({
    key: 'determinism', label: 'Tolerance for variation', score: detScore, weight: 0.16,
    reasoning: w.determinism === 'exact'
      ? 'You need the same input to produce the same verifiable answer every time. Models do not promise that. If you proceed, you need a deterministic verifier on the output — which usually means you could have written the verifier alone.'
      : w.determinism === 'tolerant'
        ? 'A band of acceptable answers exists. Good fit, provided you write down what the band is.'
        : 'Quality is judgment-based, which is where models are strongest and where evaluation is hardest.',
  });

  // --- 3. Error tolerance ---------------------------------------------
  const errScore = { none: 20, low: 45, medium: 78, high: 92 }[w.errorTolerance];
  dims.push({
    key: 'errorTolerance', label: 'Cost of being wrong', score: errScore, weight: 0.16,
    reasoning: w.errorTolerance === 'none'
      ? 'You have said errors are unacceptable. Nothing that involves a model is error-free — and neither are the humans doing it now. The workable version keeps a human on every output.'
      : `Stated tolerance is ${w.errorTolerance}. That sets the evaluation thresholds rather than ruling the project out.`,
  });
  if (w.errorTolerance === 'none' && w.autonomy !== 'suggest' && w.autonomy !== 'approve') {
    blockers.push('Zero error tolerance combined with autonomous action. Pick one: accept a defect rate, or keep a human in the approval path.');
  }

  // --- 4. Data readiness ----------------------------------------------
  const needsRetrieval = w.input.requiresExternalKnowledge;
  const sources = w.input.sourceSystems.length;
  const dataScore = !needsRetrieval ? 85 : sources === 0 ? 30 : sources <= 3 ? 72 : 55;
  dims.push({
    key: 'data', label: 'Data readiness', score: dataScore, weight: 0.14,
    reasoning: !needsRetrieval
      ? 'Everything the model needs arrives in the request. No retrieval layer to build.'
      : sources === 0
        ? 'The job needs knowledge the model will not have, but no source system was named. That gap is the project.'
        : `${sources} source system${sources === 1 ? '' : 's'} to integrate, index and keep fresh. This is where most of the build cost and most of the schedule slip lives.`,
  });
  if (needsRetrieval && sources === 0) {
    unlocks.push('Name the systems of record this work depends on. Until they are identified, any cost or timeline figure is fiction.');
  }

  // --- 5. Volume economics --------------------------------------------
  const units = w.volume.unitsPerMonth;
  const volScore = units >= 10_000 ? 95 : units >= 2_000 ? 82 : units >= 400 ? 62 : units >= 50 ? 38 : 15;
  dims.push({
    key: 'volume', label: 'Volume economics', score: volScore, weight: 0.14,
    reasoning: units < 50
      ? `${units} units a month will not repay an engineering project. If the work matters, do it by hand or with an off-the-shelf tool.`
      : units < 400
        ? `${units.toLocaleString()} a month is thin. Buy something before you build something.`
        : `${units.toLocaleString()} a month is enough repetition for automation to compound.`,
  });
  if (units < 50 && w.actor !== 'self') {
    blockers.push('Volume is too low to justify a custom build. This is a buy-or-do-manually decision.');
  }

  // --- 6. Value density ------------------------------------------------
  const mins = w.current.minutesPerUnit;
  const valScore = mins === undefined ? 50 : mins >= 20 ? 95 : mins >= 5 ? 80 : mins >= 2 ? 60 : 35;
  dims.push({
    key: 'value', label: 'Value per unit', score: valScore, weight: 0.10,
    reasoning: mins === undefined
      ? 'No baseline time per unit was supplied, so the upside is unmeasured. This is the single most useful number you could go and collect.'
      : mins < 2
        ? `At ${mins} minutes each, you are automating something that barely costs anything. The savings will not survive the maintenance burden.`
        : `${mins} minutes per unit across ${units.toLocaleString()} units is ${Math.round((mins * units) / 60).toLocaleString()} hours a month of addressable time.`,
  });
  if (mins === undefined) {
    unlocks.push('Time ten real examples end-to-end. One afternoon of stopwatch work converts this report from a guess into an argument.');
  }

  // --- 7. Risk load ----------------------------------------------------
  const sensitive = w.dataClasses.filter((d) =>
    ['pii', 'sensitive_pii', 'phi', 'pci', 'financial', 'credentials', 'trade_secret', 'minors'].includes(d));
  const writes = w.actions.filter((a) => a.write);
  const irreversible = w.actions.filter((a) => a.blastRadius === 'irreversible');
  let riskScore = 90;
  riskScore -= sensitive.length * 9;
  riskScore -= writes.length * 7;
  riskScore -= irreversible.length * 20;
  if (w.autonomy === 'full') riskScore -= 20;
  if (w.autonomy === 'bounded') riskScore -= 8;
  riskScore = Math.max(0, Math.min(100, riskScore));
  dims.push({
    key: 'risk', label: 'Risk load', score: riskScore, weight: 0.08,
    reasoning: sensitive.length === 0 && writes.length === 0
      ? 'Read-only over non-sensitive data. The easiest possible security posture — start here if you can.'
      : `${sensitive.length} sensitive data class${sensitive.length === 1 ? '' : 'es'} and ${writes.length} write action${writes.length === 1 ? '' : 's'} in scope. Not disqualifying, but it sets the controls in the security section.`,
  });
  if (irreversible.length > 0 && (w.autonomy === 'full' || w.autonomy === 'bounded')) {
    blockers.push(`Autonomous execution of irreversible actions (${irreversible.map((a) => a.name).join(', ')}). Put a human gate on these before anything else.`);
  }
  if (w.dataClasses.includes('credentials')) {
    blockers.push('Credentials are in the data flow. Redact or vault them before a prompt is ever constructed.');
  }

  // --- Weighted score --------------------------------------------------
  const raw = dims.reduce((sum, d) => sum + d.score * d.weight, 0);
  const total = Math.round(raw);

  const verdict = decideVerdict(w, total, blockers, onlyDeterministic);
  return {
    verdict,
    headline: headlineFor(verdict, w),
    score: estimate(total, 'heuristic',
      'ARK suitability rubric v0.1 — seven weighted dimensions. Not validated against outcome data yet; treat as a structured argument, not a measurement.'),
    dimensions: dims,
    blockers,
    unlocks: dedupe([...unlocks, ...unlockSuggestions(w, dims)]),
  };
}

function decideVerdict(w: Workload, score: number, blockers: string[], onlyDeterministic: boolean): Verdict {
  if (onlyDeterministic) return 'not-ai';
  if (blockers.length > 0) return 'not-yet';
  if (score < 40) return 'not-ai';
  if (score < 58) return 'not-yet';
  if (score < 72 || w.errorTolerance === 'none') return 'assisted';

  const risky = w.actions.some((a) => a.blastRadius !== 'reversible' && a.blastRadius !== 'none');
  if (risky || w.autonomy === 'bounded') return 'automate-bounded';
  if (score >= 82 && w.errorTolerance === 'high') return 'automate';
  return 'automate-bounded';
}

function headlineFor(v: Verdict, w: Workload): string {
  switch (v) {
    case 'not-ai':
      return `Don't use AI for "${w.name}". A deterministic system is cheaper, correct, and easier to defend.`;
    case 'not-yet':
      return `"${w.name}" is not ready. Clear the blockers below and this becomes a real candidate.`;
    case 'assisted':
      return `Use AI to assist on "${w.name}", with a person reviewing every output.`;
    case 'automate-bounded':
      return `Automate "${w.name}" inside hard limits, with an approval gate on anything consequential.`;
    case 'automate':
      return `"${w.name}" is a strong automation candidate. Instrument it from day one so the claim stays true.`;
  }
}

function unlockSuggestions(w: Workload, dims: Dimension[]): string[] {
  return dims
    .filter((d) => d.score < 60)
    .sort((a, b) => a.score * a.weight - b.score * b.weight)
    .slice(0, 3)
    .map((d) => {
      switch (d.key) {
        case 'volume': return 'Widen the scope to neighbouring work so one build serves more volume.';
        case 'value': return 'Measure the current time per unit before committing budget.';
        case 'data': return 'Inventory and get access to the systems of record first — treat that as phase zero.';
        case 'determinism': return 'Write down what a correct answer looks like. If you cannot, you cannot evaluate this.';
        case 'errorTolerance': return 'Agree an acceptable defect rate with the business owner, in writing, before building.';
        case 'risk': return 'Reduce blast radius: read-only first, writes behind approval, autonomy last.';
        default: return 'Split the deterministic portion out and handle it with rules.';
      }
    });
}

const dedupe = (xs: string[]) => Array.from(new Set(xs));
