import { Workload } from './schema/workload.js';

/**
 * Example workloads used by the seed data, the tests and the demo mode.
 * Each is chosen to exercise a different verdict, so the engine's ability to
 * say "no" is visible in the demo rather than buried in a unit test.
 */

export const SUPPORT_TRIAGE: Workload = Workload.parse({
  id: 'wl_support_triage',
  name: 'Support ticket triage and refund handling',
  description: '40 agents read inbound tickets, check Salesforce, and issue refunds where warranted.',
  actor: 'employee',
  task: ['classify', 'extract', 'decide', 'act'],
  volume: { unitsPerMonth: 12_000, unitLabel: 'ticket', variability: 'bursty' },
  input: { modality: ['text'], avgTokens: 900, sourceSystems: ['Zendesk', 'Salesforce'], requiresExternalKnowledge: true },
  output: { modality: ['structured'], avgTokens: 250, mustBeStructured: true },
  determinism: 'tolerant',
  errorTolerance: 'low',
  multiStep: true,
  dataClasses: ['pii', 'financial'],
  actions: [
    { name: 'Tag and route ticket', system: 'Zendesk', write: true, blastRadius: 'reversible' },
    { name: 'Issue refund', system: 'Salesforce', write: true, blastRadius: 'costly', valueCeilingUsd: 100 },
  ],
  autonomy: 'bounded',
  latencyBudgetMs: 8_000,
  regulated: ['ccpa'],
  dataResidency: 'us',
  current: { minutesPerUnit: 7, fullyLoadedHourlyUsd: 38, humanErrorRate: 0.04 },
  team: { engineers: 3, hasMlExperience: false, hasSecurityReview: true, canOperate247: false },
});

/** Exists to prove the engine will tell you not to use AI. */
export const INVOICE_LOOKUP: Workload = Workload.parse({
  id: 'wl_invoice_lookup',
  name: 'Look up invoice totals for account queries',
  description: 'Staff look up an invoice by number and read back the total.',
  actor: 'employee',
  task: ['lookup', 'calculate'],
  volume: { unitsPerMonth: 3_000, unitLabel: 'query' },
  input: { modality: ['text'], avgTokens: 120, sourceSystems: ['NetSuite'], requiresExternalKnowledge: true },
  output: { modality: ['structured'], avgTokens: 60, mustBeStructured: true },
  determinism: 'exact',
  errorTolerance: 'none',
  dataClasses: ['financial'],
  autonomy: 'suggest',
  current: { minutesPerUnit: 3, fullyLoadedHourlyUsd: 32 },
  team: { engineers: 2, hasMlExperience: false, hasSecurityReview: true },
});

export const CONTENT_DRAFTING: Workload = Workload.parse({
  id: 'wl_content_drafting',
  name: 'Draft first-pass client SEO briefs',
  description: 'Strategists write a brief per target keyword before handing to writers.',
  actor: 'employee',
  task: ['generate', 'summarize', 'search'],
  volume: { unitsPerMonth: 600, unitLabel: 'brief' },
  input: { modality: ['text'], avgTokens: 3_500, sourceSystems: ['Ahrefs', 'GSC'], requiresExternalKnowledge: true },
  output: { modality: ['text'], avgTokens: 1_400, mustBeStructured: false },
  determinism: 'subjective',
  errorTolerance: 'medium',
  dataClasses: ['internal'],
  autonomy: 'suggest',
  current: { minutesPerUnit: 45, fullyLoadedHourlyUsd: 55, humanErrorRate: 0.1 },
  team: { engineers: 1, hasMlExperience: false, hasSecurityReview: false },
});

export const FIXTURES = [SUPPORT_TRIAGE, INVOICE_LOOKUP, CONTENT_DRAFTING];
