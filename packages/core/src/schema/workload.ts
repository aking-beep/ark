import { z } from 'zod';

/**
 * A Workload is the unit of analysis for all of ARK.
 *
 * Not "a company" and not "a use case" — a specific repeating job that
 * currently consumes human time, described precisely enough to reason about.
 * Both AIFit surfaces produce one of these; ARK Control attributes cost to one.
 */

export const TaskShape = z.enum([
  'classify',    // route, tag, triage, score
  'extract',     // pull structured fields out of unstructured input
  'summarize',   // compress
  'generate',    // draft new prose, code, images
  'converse',    // multi-turn dialogue with a person
  'search',      // find relevant material in a corpus
  'decide',      // choose among options with consequences
  'act',         // take an action in an external system
  'calculate',   // deterministic arithmetic or logic
  'lookup',      // fetch a known record by key
]);
export type TaskShape = z.infer<typeof TaskShape>;

/** Task shapes an LLM is a poor tool for, when they appear alone. */
export const DETERMINISTIC_SHAPES: TaskShape[] = ['calculate', 'lookup'];

export const DataClass = z.enum([
  'public',
  'internal',
  'pii',          // names, emails, addresses
  'sensitive_pii',// government ID, biometrics
  'phi',          // health
  'pci',          // cardholder data
  'financial',    // account balances, transactions
  'credentials',  // keys, tokens, passwords
  'trade_secret',
  'minors',       // data concerning people under 18
]);
export type DataClass = z.infer<typeof DataClass>;

/** How much damage a single wrong action does. Drives the security posture. */
export const BlastRadius = z.enum(['none', 'reversible', 'costly', 'irreversible']);
export type BlastRadius = z.infer<typeof BlastRadius>;

export const ActionSpec = z.object({
  name: z.string(),
  system: z.string(),
  write: z.boolean().default(false),
  blastRadius: BlastRadius.default('reversible'),
  /** Monetary ceiling a single invocation can move, where applicable. */
  valueCeilingUsd: z.number().nonnegative().optional(),
});
export type ActionSpec = z.infer<typeof ActionSpec>;

export const Autonomy = z.enum([
  'suggest',  // proposes, human does the work
  'approve',  // prepares, human clicks yes
  'bounded',  // acts alone inside hard limits
  'full',     // acts alone
]);
export type Autonomy = z.infer<typeof Autonomy>;

/** How wrong the output is allowed to be. */
export const Determinism = z.enum([
  'exact',      // one right answer, verifiable — AI is usually the wrong tool
  'tolerant',   // a band of acceptable answers
  'subjective', // quality is a matter of judgment
]);
export type Determinism = z.infer<typeof Determinism>;

export const ErrorTolerance = z.enum(['none', 'low', 'medium', 'high']);
export type ErrorTolerance = z.infer<typeof ErrorTolerance>;

export const Workload = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),

  /** Who or what the output is for. 'self' marks a consumer workload. */
  actor: z.enum(['self', 'employee', 'customer', 'system']).default('employee'),

  task: z.array(TaskShape).min(1),

  volume: z.object({
    unitsPerMonth: z.number().nonnegative(),
    unitLabel: z.string().default('task'),
    /** Peak-to-mean ratio. High variability changes the deployment answer. */
    variability: z.enum(['steady', 'bursty', 'seasonal']).default('steady'),
  }),

  input: z.object({
    modality: z.array(z.enum(['text', 'image', 'audio', 'video', 'tabular', 'code'])).default(['text']),
    avgTokens: z.number().nonnegative().default(800),
    /** Systems the model must read from. Each is an integration and a risk. */
    sourceSystems: z.array(z.string()).default([]),
    /** Does answering require knowledge not in the prompt or the model? */
    requiresExternalKnowledge: z.boolean().default(false),
  }),

  output: z.object({
    modality: z.array(z.enum(['text', 'image', 'audio', 'structured', 'code'])).default(['text']),
    avgTokens: z.number().nonnegative().default(300),
    mustBeStructured: z.boolean().default(false),
  }),

  determinism: Determinism.default('tolerant'),
  errorTolerance: ErrorTolerance.default('medium'),
  /** Does the job require several dependent steps rather than one response? */
  multiStep: z.boolean().default(false),

  dataClasses: z.array(DataClass).default(['internal']),
  actions: z.array(ActionSpec).default([]),
  autonomy: Autonomy.default('suggest'),

  latencyBudgetMs: z.number().positive().default(10_000),
  regulated: z.array(z.enum(['hipaa', 'pci', 'gdpr', 'ccpa', 'sox', 'ferpa', 'glba', 'eu_ai_act', 'none']))
    .default(['none']),
  dataResidency: z.enum(['any', 'us', 'eu', 'on_prem']).default('any'),

  /** Today's economics. Without these, ROI is unknowable and ARK says so. */
  current: z.object({
    minutesPerUnit: z.number().nonnegative().optional(),
    fullyLoadedHourlyUsd: z.number().nonnegative().optional(),
    costPerUnitUsd: z.number().nonnegative().optional(),
    /** How often the humans doing it today get it wrong. The honest baseline. */
    humanErrorRate: z.number().min(0).max(1).optional(),
  }).default({}),

  /** Team that would own it. Small teams change the architecture answer. */
  team: z.object({
    engineers: z.number().nonnegative().default(0),
    hasMlExperience: z.boolean().default(false),
    hasSecurityReview: z.boolean().default(false),
    canOperate247: z.boolean().default(false),
  }).default({}),
});
export type Workload = z.infer<typeof Workload>;

/** Minimal shape the consumer wizard collects; widened to a full Workload. */
export const ConsumerIntake = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(''),
  task: z.array(TaskShape).min(1),
  timesPerMonth: z.number().nonnegative(),
  minutesEach: z.number().nonnegative(),
  involvesPersonalData: z.boolean().default(false),
  involvesMoneyOrLegal: z.boolean().default(false),
  needsExactAnswer: z.boolean().default(false),
  needsCurrentInfo: z.boolean().default(false),
  wouldNoticeIfWrong: z.enum(['immediately', 'eventually', 'never']).default('eventually'),
});
export type ConsumerIntake = z.infer<typeof ConsumerIntake>;

/** Lift a consumer intake into the same Workload the business engine consumes. */
export function fromConsumerIntake(intake: ConsumerIntake): Workload {
  const dataClasses: DataClass[] = ['public'];
  if (intake.involvesPersonalData) dataClasses.push('pii');
  if (intake.involvesMoneyOrLegal) dataClasses.push('financial');

  return Workload.parse({
    id: intake.id,
    name: intake.name,
    description: intake.description,
    actor: 'self',
    task: intake.task,
    volume: { unitsPerMonth: intake.timesPerMonth, unitLabel: 'task', variability: 'steady' },
    input: {
      modality: ['text'],
      avgTokens: 600,
      sourceSystems: [],
      requiresExternalKnowledge: intake.needsCurrentInfo,
    },
    output: { modality: ['text'], avgTokens: 400, mustBeStructured: false },
    determinism: intake.needsExactAnswer ? 'exact' : 'tolerant',
    errorTolerance:
      intake.wouldNoticeIfWrong === 'never' ? 'none'
      : intake.involvesMoneyOrLegal ? 'low'
      : 'medium',
    multiStep: false,
    dataClasses,
    actions: [],
    autonomy: 'suggest',
    latencyBudgetMs: 30_000,
    regulated: ['none'],
    dataResidency: 'any',
    current: { minutesPerUnit: intake.minutesEach, fullyLoadedHourlyUsd: 0 },
    team: { engineers: 0, hasMlExperience: false, hasSecurityReview: false, canOperate247: false },
  });
}
