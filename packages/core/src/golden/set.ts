import { Workload, type TaskShape } from '../schema/workload.js';
import type { Verdict } from '../assess/suitability.js';
import { SUPPORT_TRIAGE, INVOICE_LOOKUP, CONTENT_DRAFTING } from '../fixtures.js';

/**
 * Golden set — labelled workloads the engine is scored against.
 *
 * Labels are the verdict a sceptical engineer would give after reading the
 * rubric in docs/02-scoring-methodology.md, *not* a dump of whatever the
 * current code returns. A disagreement is a finding against the weights or
 * the label, and it is written down rather than silently "fixed" by changing
 * the expected value to match the implementation.
 *
 * Kill criterion (roadmap Phase 1): if undocumented disagreements exceed
 * ~30%, stop shipping surfaces and rebuild the rubric.
 */

export interface GoldenCase {
  id: string;
  expected: Verdict;
  /** Why a human using the published rubric would land here. */
  note: string;
  workload: Workload;
}

const defaults = {
  actor: 'employee' as const,
  description: '',
  volume: { unitsPerMonth: 2_000, unitLabel: 'task', variability: 'steady' as const },
  input: { modality: ['text' as const], avgTokens: 800, sourceSystems: [] as string[], requiresExternalKnowledge: false },
  output: { modality: ['text' as const], avgTokens: 300, mustBeStructured: false },
  determinism: 'tolerant' as const,
  errorTolerance: 'medium' as const,
  multiStep: false,
  dataClasses: ['internal'] as const,
  actions: [] as Workload['actions'],
  autonomy: 'suggest' as const,
  latencyBudgetMs: 10_000,
  regulated: ['none'] as const,
  dataResidency: 'any' as const,
  current: { minutesPerUnit: 8, fullyLoadedHourlyUsd: 55 },
  team: { engineers: 2, hasMlExperience: false, hasSecurityReview: true, canOperate247: false },
};

function g(
  id: string,
  expected: Verdict,
  note: string,
  patch: Partial<Workload> & { name: string; task: TaskShape[] },
): GoldenCase {
  return {
    id,
    expected,
    note,
    workload: Workload.parse({ ...defaults, id, ...patch }),
  };
}

export const GOLDEN: GoldenCase[] = [
  {
    id: 'fixture-invoice',
    expected: 'not-ai',
    note: 'Lookup + calculate only. Deterministic shapes short-circuit to not-ai.',
    workload: INVOICE_LOOKUP,
  },
  {
    id: 'fixture-support',
    expected: 'automate-bounded',
    note: 'Consequential refunds under bounded autonomy. Risky actions cap at automate-bounded.',
    workload: SUPPORT_TRIAGE,
  },
  {
    id: 'fixture-content',
    expected: 'automate-bounded',
    note: 'Linguistic work at decent volume, medium tolerance, no write actions. Fall-through is bounded, not full automate.',
    workload: CONTENT_DRAFTING,
  },

  g('na-lookup-status', 'not-ai', 'Pure lookup.', {
    name: 'Look up order status by id', task: ['lookup'],
    determinism: 'exact', errorTolerance: 'none',
    input: { ...defaults.input, sourceSystems: ['OMS'], requiresExternalKnowledge: true },
  }),
  g('na-calculate-tax', 'not-ai', 'Pure calculate.', {
    name: 'Compute payroll tax from a table', task: ['calculate'],
    determinism: 'exact', errorTolerance: 'none',
  }),
  g('na-lookup-balance', 'not-ai', 'Pure lookup of a known record.', {
    name: 'Read back a customer balance', task: ['lookup'],
    determinism: 'exact', errorTolerance: 'none',
    input: { ...defaults.input, sourceSystems: ['Ledger'], requiresExternalKnowledge: true },
  }),
  g('na-fx', 'not-ai', 'Arithmetic.', {
    name: 'Convert an amount between currencies', task: ['calculate'],
    determinism: 'exact', errorTolerance: 'none',
  }),
  g('na-sku', 'not-ai', 'Keyed fetch.', {
    name: 'Fetch a SKU price', task: ['lookup'],
    determinism: 'exact', errorTolerance: 'none',
  }),
  g('na-shipping', 'not-ai', 'Deterministic rate table.', {
    name: 'Calculate shipping from a rate table', task: ['calculate', 'lookup'],
    determinism: 'exact', errorTolerance: 'none',
  }),
  g('na-invoice-total', 'not-ai', 'Lookup plus arithmetic.', {
    name: 'Add line items and return the invoice total', task: ['lookup', 'calculate'],
    determinism: 'exact', errorTolerance: 'none',
  }),
  g('na-vat', 'not-ai', 'Tax table.', {
    name: 'Apply VAT to a net amount', task: ['calculate'],
    determinism: 'exact', errorTolerance: 'none',
  }),

  g('ny-credentials', 'not-yet', 'Credentials in the prompt path are a hard blocker.', {
    name: 'Draft replies that include API keys in context', task: ['generate'],
    dataClasses: ['internal', 'credentials'],
    volume: { unitsPerMonth: 5_000, unitLabel: 'draft', variability: 'steady' },
  }),
  g('ny-irreversible-bounded', 'not-yet', 'Irreversible action under bounded autonomy.', {
    name: 'Delete customer accounts from chat', task: ['act', 'decide'],
    multiStep: true,
    autonomy: 'bounded',
    actions: [{ name: 'Delete account', system: 'CRM', write: true, blastRadius: 'irreversible' }],
    volume: { unitsPerMonth: 800, unitLabel: 'request', variability: 'steady' },
  }),
  g('ny-irreversible-full', 'not-yet', 'Irreversible + full autonomy.', {
    name: 'Autonomous wire transfers', task: ['act', 'decide'],
    multiStep: true,
    autonomy: 'full',
    errorTolerance: 'low',
    actions: [{ name: 'Send wire', system: 'Bank', write: true, blastRadius: 'irreversible', valueCeilingUsd: 50_000 }],
    dataClasses: ['financial'],
    volume: { unitsPerMonth: 400, unitLabel: 'transfer', variability: 'steady' },
  }),
  g('ny-volume-20', 'not-yet', 'Employee workload under 50/month is buy-or-do-manually.', {
    name: 'Quarterly board-deck polish', task: ['generate', 'summarize'],
    volume: { unitsPerMonth: 20, unitLabel: 'deck', variability: 'seasonal' },
    current: { minutesPerUnit: 180, fullyLoadedHourlyUsd: 120 },
  }),
  g('ny-volume-10', 'not-yet', 'Trivial volume, employee actor.', {
    name: 'Monthly vendor scorecard', task: ['classify', 'summarize'],
    volume: { unitsPerMonth: 10, unitLabel: 'vendor', variability: 'steady' },
  }),
  g('ny-zero-error-bounded', 'not-yet', 'Zero error tolerance plus autonomy past approve.', {
    name: 'Approve medical claims without a reviewer', task: ['classify', 'decide', 'act'],
    errorTolerance: 'none',
    autonomy: 'bounded',
    dataClasses: ['phi', 'pii'],
    actions: [{ name: 'Approve claim', system: 'Claims', write: true, blastRadius: 'costly' }],
    volume: { unitsPerMonth: 4_000, unitLabel: 'claim', variability: 'steady' },
  }),
  g('ny-zero-error-full', 'not-yet', 'Zero error + full autonomy.', {
    name: 'Auto-file tax returns', task: ['extract', 'calculate', 'act'],
    errorTolerance: 'none',
    autonomy: 'full',
    determinism: 'exact',
    actions: [{ name: 'Submit return', system: 'HMRC', write: true, blastRadius: 'costly' }],
    volume: { unitsPerMonth: 2_000, unitLabel: 'return', variability: 'seasonal' },
  }),
  g('ny-volume-49', 'not-yet', 'Just under the custom-build floor.', {
    name: 'Specialist legal memo first drafts', task: ['generate'],
    volume: { unitsPerMonth: 49, unitLabel: 'memo', variability: 'steady' },
    current: { minutesPerUnit: 90, fullyLoadedHourlyUsd: 180 },
  }),
  g('ny-credentials-classify', 'not-yet', 'Credentials blocker fires even on otherwise easy work.', {
    name: 'Tag support tickets that contain secrets', task: ['classify'],
    dataClasses: ['credentials', 'pii'],
    volume: { unitsPerMonth: 8_000, unitLabel: 'ticket', variability: 'bursty' },
  }),
  g('ny-irreversible-refund-full', 'not-yet', 'Irreversible money movement at full autonomy.', {
    name: 'Issue refunds with no human gate', task: ['classify', 'act'],
    multiStep: true,
    autonomy: 'full',
    actions: [{ name: 'Issue refund', system: 'Billing', write: true, blastRadius: 'irreversible', valueCeilingUsd: 500 }],
    dataClasses: ['financial', 'pii'],
    volume: { unitsPerMonth: 3_000, unitLabel: 'refund', variability: 'steady' },
  }),

  g('as-zero-error-suggest', 'assisted', 'Errors unacceptable, human stays in the path.', {
    name: 'Draft clinical letters for a doctor to sign', task: ['generate'],
    errorTolerance: 'none',
    autonomy: 'suggest',
    dataClasses: ['phi', 'pii'],
    volume: { unitsPerMonth: 3_000, unitLabel: 'letter', variability: 'steady' },
    current: { minutesPerUnit: 12, fullyLoadedHourlyUsd: 90 },
  }),
  g('as-zero-error-approve', 'assisted', 'Approve-path, zero tolerance → assisted, not blocked.', {
    name: 'Prepare refunds for a lead to click yes', task: ['extract', 'decide'],
    errorTolerance: 'none',
    autonomy: 'approve',
    dataClasses: ['financial', 'pii'],
    volume: { unitsPerMonth: 2_500, unitLabel: 'refund', variability: 'steady' },
  }),
  g('as-exact-thin-volume', 'assisted', 'Exact answers + modest volume pulls the score into assisted.', {
    name: 'Extract fields from messy invoices', task: ['extract'],
    determinism: 'exact',
    volume: { unitsPerMonth: 400, unitLabel: 'invoice', variability: 'steady' },
    input: { ...defaults.input, requiresExternalKnowledge: false },
  }),
  g('as-customer-none', 'assisted', 'Customer-facing, no defect rate accepted.', {
    name: 'Answer logged-in billing questions', task: ['converse', 'lookup'],
    actor: 'customer',
    errorTolerance: 'none',
    autonomy: 'suggest',
    dataClasses: ['financial', 'pii'],
    volume: { unitsPerMonth: 12_000, unitLabel: 'chat', variability: 'bursty' },
  }),
  g('as-exact-summaries', 'assisted', 'Exact + medium volume.', {
    name: 'Summarise contracts to a checklist', task: ['summarize', 'extract'],
    determinism: 'exact',
    volume: { unitsPerMonth: 300, unitLabel: 'contract', variability: 'steady' },
    current: { minutesPerUnit: 40, fullyLoadedHourlyUsd: 95 },
  }),
  g('as-low-score-retrieval-gap', 'assisted', 'Needs retrieval but names no source — score should not clear automate.', {
    name: 'Answer questions about “our docs”', task: ['search', 'generate'],
    input: { modality: ['text'], avgTokens: 1200, sourceSystems: [], requiresExternalKnowledge: true },
    volume: { unitsPerMonth: 600, unitLabel: 'question', variability: 'steady' },
    determinism: 'exact',
  }),
  g('as-classify-exact', 'assisted', 'Classification that must be exact at moderate volume.', {
    name: 'Code incoming mail as one of 12 types', task: ['classify'],
    determinism: 'exact',
    volume: { unitsPerMonth: 500, unitLabel: 'message', variability: 'steady' },
  }),
  g('as-generate-exact-400', 'assisted', 'Exact drafting, 400/month.', {
    name: 'Write first-pass change notes', task: ['generate'],
    determinism: 'exact',
    volume: { unitsPerMonth: 400, unitLabel: 'note', variability: 'steady' },
  }),

  g('ab-generate-default', 'automate-bounded', 'Healthy linguistic work, medium tolerance — default is bounded.', {
    name: 'Draft internal status updates', task: ['generate'],
    volume: { unitsPerMonth: 2_000, unitLabel: 'update', variability: 'steady' },
  }),
  g('ab-costly-action', 'automate-bounded', 'Costly write keeps it inside limits even if the score is high.', {
    name: 'Tag tickets and post a credit', task: ['classify', 'act'],
    multiStep: true,
    actions: [{ name: 'Post credit', system: 'Billing', write: true, blastRadius: 'costly', valueCeilingUsd: 50 }],
    dataClasses: ['financial', 'pii'],
    volume: { unitsPerMonth: 8_000, unitLabel: 'ticket', variability: 'bursty' },
    errorTolerance: 'high',
  }),
  g('ab-autonomy-bounded', 'automate-bounded', 'Bounded autonomy is a verdict gate of its own.', {
    name: 'Route and reply to inbound email', task: ['classify', 'generate', 'act'],
    multiStep: true,
    autonomy: 'bounded',
    errorTolerance: 'high',
    actions: [{ name: 'Send reply', system: 'Gmail', write: true, blastRadius: 'reversible' }],
    volume: { unitsPerMonth: 20_000, unitLabel: 'email', variability: 'bursty' },
    current: { minutesPerUnit: 6, fullyLoadedHourlyUsd: 40 },
  }),
  g('ab-rag', 'automate-bounded', 'RAG-shaped, medium tolerance, no writes.', {
    name: 'Answer from the policy wiki', task: ['search', 'summarize'],
    input: { modality: ['text'], avgTokens: 2_000, sourceSystems: ['Notion', 'Drive'], requiresExternalKnowledge: true },
    volume: { unitsPerMonth: 4_000, unitLabel: 'question', variability: 'steady' },
  }),
  g('ab-workflow', 'automate-bounded', 'Multi-step without actions → workflow, still not full automate.', {
    name: 'Research, outline, then draft a brief', task: ['search', 'generate'],
    multiStep: true,
    input: { modality: ['text'], avgTokens: 3_000, sourceSystems: ['Web'], requiresExternalKnowledge: true },
    volume: { unitsPerMonth: 600, unitLabel: 'brief', variability: 'steady' },
    current: { minutesPerUnit: 45, fullyLoadedHourlyUsd: 70 },
  }),
  g('ab-extract-medium', 'automate-bounded', 'Extraction at volume, medium tolerance.', {
    name: 'Pull fields from intake forms', task: ['extract'],
    output: { modality: ['structured'], avgTokens: 120, mustBeStructured: true },
    volume: { unitsPerMonth: 6_000, unitLabel: 'form', variability: 'steady' },
  }),
  g('ab-decide-medium', 'automate-bounded', 'Decision support, not autonomy.', {
    name: 'Recommend a queue for a ticket', task: ['classify', 'decide'],
    volume: { unitsPerMonth: 9_000, unitLabel: 'ticket', variability: 'bursty' },
  }),
  g('ab-summarize-medium', 'automate-bounded', 'Summaries at volume, medium tolerance.', {
    name: 'Summarise call transcripts for CRM', task: ['summarize'],
    volume: { unitsPerMonth: 5_000, unitLabel: 'call', variability: 'steady' },
    current: { minutesPerUnit: 15, fullyLoadedHourlyUsd: 45 },
  }),

  g('au-classify-high', 'automate', 'Pure classify, high tolerance, huge volume, no writes.', {
    name: 'Label inbound emails as spam or not', task: ['classify'],
    errorTolerance: 'high',
    determinism: 'tolerant',
    volume: { unitsPerMonth: 80_000, unitLabel: 'email', variability: 'bursty' },
    current: { minutesPerUnit: 1, fullyLoadedHourlyUsd: 28 },
  }),
  g('au-generate-subjective', 'automate', 'Subjective drafting, high tolerance, high volume.', {
    name: 'First-pass social captions', task: ['generate'],
    determinism: 'subjective',
    errorTolerance: 'high',
    volume: { unitsPerMonth: 12_000, unitLabel: 'caption', variability: 'steady' },
    current: { minutesPerUnit: 20, fullyLoadedHourlyUsd: 50 },
  }),
  g('au-summarize-high', 'automate', 'Summaries nobody ships unread? Still high tolerance, high volume.', {
    name: 'Compress meeting notes for the team wiki', task: ['summarize'],
    errorTolerance: 'high',
    determinism: 'subjective',
    volume: { unitsPerMonth: 10_000, unitLabel: 'meeting', variability: 'steady' },
    current: { minutesPerUnit: 25, fullyLoadedHourlyUsd: 60 },
  }),
  g('au-converse-high', 'automate', 'Practice dialogue, high tolerance.', {
    name: 'Language-practice chatbot', task: ['converse'],
    errorTolerance: 'high',
    determinism: 'subjective',
    actor: 'customer',
    dataClasses: ['public'],
    volume: { unitsPerMonth: 40_000, unitLabel: 'session', variability: 'steady' },
    current: { minutesPerUnit: 30, fullyLoadedHourlyUsd: 20 },
  }),
  g('au-extract-high', 'automate', 'Extraction, high tolerance, huge volume, structured.', {
    name: 'Pull dates from public press releases', task: ['extract'],
    errorTolerance: 'high',
    output: { modality: ['structured'], avgTokens: 80, mustBeStructured: true },
    dataClasses: ['public'],
    volume: { unitsPerMonth: 50_000, unitLabel: 'article', variability: 'steady' },
    current: { minutesPerUnit: 5, fullyLoadedHourlyUsd: 35 },
  }),
];

export const GOLDEN_KILL_RATE = 0.3;
