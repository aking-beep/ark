import { Workload, DETERMINISTIC_SHAPES } from '../schema/workload.js';
import { Verdict } from './suitability.js';

export type Pattern =
  | 'deterministic-automation'
  | 'classifier'
  | 'llm-single-shot'
  | 'rag'
  | 'llm-workflow'
  | 'bounded-agent'
  | 'autonomous-agent'
  | 'hybrid-human-loop';

export interface ArchitectureRecommendation {
  pattern: Pattern;
  label: string;
  summary: string;
  components: string[];
  rejected: { pattern: Pattern; why: string }[];
  /** Assumed call shape for this pattern — feeds the cost model. */
  callShape: {
    turnsPerOutcome: number;
    contextGrowthPerTurn: number;
    failureRate: number;
    retriesPerFailure: number;
    cacheHitRate: number;
  };
}

const LABEL: Record<Pattern, string> = {
  'deterministic-automation': 'Deterministic automation (no model)',
  'classifier': 'Small-model classifier',
  'llm-single-shot': 'Single-shot LLM call',
  'rag': 'Retrieval-augmented generation',
  'llm-workflow': 'Deterministic workflow with LLM nodes',
  'bounded-agent': 'Bounded agent with tool allow-list',
  'autonomous-agent': 'Autonomous agent',
  'hybrid-human-loop': 'Human-in-the-loop hybrid',
};

export function recommendArchitecture(w: Workload, verdict: Verdict): ArchitectureRecommendation {
  const rejected: { pattern: Pattern; why: string }[] = [];
  const onlyDeterministic = w.task.every((t) => DETERMINISTIC_SHAPES.includes(t));

  const pattern: Pattern = choose();

  function choose(): Pattern {
    if (onlyDeterministic || verdict === 'not-ai') {
      rejected.push({ pattern: 'llm-single-shot', why: 'The task has a computable right answer; a model adds cost and variance for no gain.' });
      return 'deterministic-automation';
    }
    if (verdict === 'assisted') {
      rejected.push({ pattern: 'bounded-agent', why: 'A person is reviewing every output, so autonomy buys nothing and adds failure modes.' });
      return 'hybrid-human-loop';
    }
    if (w.task.length === 1 && w.task[0] === 'classify' && !w.input.requiresExternalKnowledge) {
      rejected.push({ pattern: 'llm-single-shot', why: 'Pure classification at volume is cheaper and more stable as a small dedicated model.' });
      return 'classifier';
    }
    if (w.actions.length > 0 && w.multiStep) {
      if (w.autonomy === 'full' && w.actions.every((a) => a.blastRadius === 'none' || a.blastRadius === 'reversible')) {
        return 'autonomous-agent';
      }
      rejected.push({ pattern: 'autonomous-agent', why: 'Consequential actions in scope. Constrain the tool surface and gate the dangerous calls.' });
      return 'bounded-agent';
    }
    if (w.multiStep) {
      rejected.push({ pattern: 'bounded-agent', why: 'The steps are known in advance. Encode them as a graph — it is cheaper, testable, and it cannot loop.' });
      return 'llm-workflow';
    }
    if (w.input.requiresExternalKnowledge) {
      rejected.push({ pattern: 'llm-single-shot', why: 'The answer depends on material the model has not seen. Retrieval is required for correctness, not polish.' });
      return 'rag';
    }
    rejected.push({ pattern: 'rag', why: 'Everything needed is already in the request — a retrieval layer would be cost and latency you do not need.' });
    return 'llm-single-shot';
  }

  return {
    pattern,
    label: LABEL[pattern],
    summary: SUMMARY[pattern],
    components: componentsFor(pattern, w),
    rejected,
    callShape: CALL_SHAPE[pattern],
  };
}

const SUMMARY: Record<Pattern, string> = {
  'deterministic-automation':
    'Rules, queries and a scheduled job. Correct by construction, testable, and effectively free to run. Revisit only if real ambiguity shows up in the data.',
  'classifier':
    'One small model doing one narrow job, with a confidence threshold that routes the uncertain tail to a person or a larger model. The cheapest durable pattern in production.',
  'llm-single-shot':
    'One prompt, one response, a structured output schema and a validator. Resist adding an agent until this demonstrably fails.',
  'rag':
    'Retrieve relevant material, then generate grounded in it. Most of the work is the index and the freshness, not the prompt.',
  'llm-workflow':
    'A deterministic graph where individual nodes call a model. You keep control of sequencing, retries and cost ceilings; the model only handles the linguistic parts.',
  'bounded-agent':
    'The model chooses among an explicit allow-list of tools, inside a turn cap, a spend cap, and an approval gate on anything consequential.',
  'autonomous-agent':
    'The model plans and acts without step-level supervision. Justified only when every available action is cheap to undo.',
  'hybrid-human-loop':
    'The model drafts, a person decides. Ships fastest, carries the least risk, and produces the labelled data that makes a later automation defensible.',
};

function componentsFor(p: Pattern, w: Workload): string[] {
  const base: string[] = [];
  if (p === 'deterministic-automation') {
    return ['Rules engine or SQL', 'Scheduler', 'Exception queue for genuine ambiguity', 'Audit log'];
  }
  base.push('Request gateway with per-workload budget and rate limits');
  if (w.dataClasses.some((d) => d !== 'public' && d !== 'internal')) {
    base.push('PII redaction / tokenisation before the prompt is constructed');
  }
  if (p === 'rag' || w.input.requiresExternalKnowledge) {
    base.push('Ingestion + chunking pipeline', 'Vector or hybrid index', 'Freshness/reindex job', 'Retrieval eval set');
  }
  if (p === 'classifier') base.push('Confidence threshold + escalation path', 'Labelled holdout set');
  if (p === 'llm-workflow') base.push('Workflow orchestrator', 'Per-node retry and timeout policy');
  if (p === 'bounded-agent' || p === 'autonomous-agent') {
    base.push('Tool allow-list with scoped credentials', 'Turn cap and spend circuit breaker', 'Action audit trail');
  }
  if (p === 'bounded-agent') base.push('Approval gate for consequential actions');
  if (p === 'hybrid-human-loop') base.push('Review queue UI', 'Accept/edit/reject capture (this is your training data)');
  if (w.output.mustBeStructured) base.push('Output schema validation with a reject-and-retry path');
  base.push('ARK Control telemetry hook (token, cost, latency, outcome)');
  return base;
}

/**
 * Assumed call shapes per pattern. These are rules of thumb and are labelled
 * as such everywhere they surface — Control replaces them with measurement.
 */
const CALL_SHAPE: Record<Pattern, ArchitectureRecommendation['callShape']> = {
  'deterministic-automation': { turnsPerOutcome: 0, contextGrowthPerTurn: 0, failureRate: 0, retriesPerFailure: 0, cacheHitRate: 0 },
  'classifier':               { turnsPerOutcome: 1, contextGrowthPerTurn: 0, failureRate: 0.03, retriesPerFailure: 1, cacheHitRate: 0.3 },
  'llm-single-shot':          { turnsPerOutcome: 1, contextGrowthPerTurn: 0, failureRate: 0.05, retriesPerFailure: 1, cacheHitRate: 0.4 },
  'rag':                      { turnsPerOutcome: 1, contextGrowthPerTurn: 0, failureRate: 0.08, retriesPerFailure: 1, cacheHitRate: 0.2 },
  'llm-workflow':             { turnsPerOutcome: 3, contextGrowthPerTurn: 300, failureRate: 0.10, retriesPerFailure: 1, cacheHitRate: 0.35 },
  'bounded-agent':            { turnsPerOutcome: 7, contextGrowthPerTurn: 900, failureRate: 0.15, retriesPerFailure: 1.5, cacheHitRate: 0.45 },
  'autonomous-agent':         { turnsPerOutcome: 14, contextGrowthPerTurn: 1200, failureRate: 0.22, retriesPerFailure: 2, cacheHitRate: 0.5 },
  'hybrid-human-loop':        { turnsPerOutcome: 1, contextGrowthPerTurn: 0, failureRate: 0.04, retriesPerFailure: 1, cacheHitRate: 0.35 },
};

export { CALL_SHAPE, LABEL as PATTERN_LABEL };
