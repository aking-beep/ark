import { z } from 'zod';
import {
  ActionSpec,
  Autonomy,
  DataClass,
  Determinism,
  ErrorTolerance,
  TaskShape,
  Workload,
} from '@ark/core';

/**
 * The intake's state, and the only place it becomes a Workload.
 *
 * Every answer that sizes the workload starts empty and stays empty until the
 * person gives it. The old form opened on 2,000 tickets, 1,200/400 tokens,
 * two engineers and a ten-second latency budget nobody chose, and the report
 * then priced that invention. An empty field here is `''` or an unselected
 * choice; `blockedReason` refuses to advance past it. The defaults that remain
 * are the honest null answers, and they are visibly selected: an employee is
 * the reader, the load is steady, the model only suggests, data may be
 * processed anywhere, and no regime is known.
 *
 * Pure and storage-agnostic so it runs under `node --test`; the component owns
 * `window.sessionStorage` and passes it in.
 */

export type Blank = '';
export type Actor = 'employee' | 'customer' | 'system';
export type Variability = 'steady' | 'bursty' | 'seasonal';
export type Residency = 'any' | 'us' | 'eu' | 'on_prem';
export type Regime = Workload['regulated'][number];
export type Action = ActionSpec;

/** The four latency budgets the form offers. Nothing else may be stored. */
export const LATENCY_OPTIONS = [1_000, 5_000, 30_000, 600_000] as const;
export type LatencyMs = (typeof LATENCY_OPTIONS)[number];

export const SECTIONS = [
  'The job',
  'Volume',
  'Input and output',
  'Correctness',
  'Data and actions',
  'Constraints',
  'Today',
  'Your team',
] as const;
export const LAST_STEP = SECTIONS.length - 1;

export interface IntakeState {
  // 1. the job
  name: string;
  description: string;
  actor: Actor;
  task: TaskShape[];
  // 2. volume
  unitsPerMonth: number | Blank;
  unitLabel: string;
  variability: Variability;
  // 3. input and output
  inTokens: number | Blank;
  outTokens: number | Blank;
  promptPaste: string;
  sourceSystems: string;
  requiresExternalKnowledge: boolean;
  mustBeStructured: boolean;
  // 4. correctness
  determinism: Determinism | Blank;
  errorTolerance: ErrorTolerance | Blank;
  multiStep: boolean;
  // 5. data and actions
  dataClasses: DataClass[];
  actions: Action[];
  autonomy: Autonomy;
  // 6. constraints
  latencyBudgetMs: LatencyMs | Blank;
  regulated: Regime[];
  dataResidency: Residency;
  // 7. today — optional, blank means unknown
  minutesPerUnit: number | Blank;
  hourlyUsd: number | Blank;
  /** Percent, 0–100. The Workload stores a fraction. */
  humanErrorRate: number | Blank;
  // 8. team
  engineers: number | Blank;
  hasMlExperience: boolean;
  hasSecurityReview: boolean;
  canOperate247: boolean;
}

export function emptyIntake(): IntakeState {
  return {
    name: '',
    description: '',
    actor: 'employee',
    task: [],
    unitsPerMonth: '',
    unitLabel: '',
    variability: 'steady',
    inTokens: '',
    outTokens: '',
    promptPaste: '',
    sourceSystems: '',
    requiresExternalKnowledge: false,
    mustBeStructured: false,
    determinism: '',
    errorTolerance: '',
    multiStep: false,
    dataClasses: [],
    actions: [],
    autonomy: 'suggest',
    latencyBudgetMs: '',
    regulated: ['none'],
    dataResidency: 'any',
    minutesPerUnit: '',
    hourlyUsd: '',
    humanErrorRate: '',
    engineers: '',
    hasMlExperience: false,
    hasSecurityReview: false,
    canOperate247: false,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const positive = (n: number | Blank) => n !== '' && n > 0;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function joinMissing(parts: string[]): string | null {
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1]!;
  const sentence = parts.length === 1 ? last : `${parts.slice(0, -1).join(', ')} and ${last}`;
  return `${capitalise(sentence)}.`;
}

/**
 * Why Next is disabled on `step`, or null when the step is complete. The text
 * is shown beside the disabled button, so it is an instruction, not an error.
 */
export function blockedReason(step: number, s: IntakeState): string | null {
  const missing: string[] = [];
  switch (step) {
    case 0:
      if (s.name.trim().length < 2) missing.push('name the job');
      if (s.task.length === 0) missing.push('pick at least one shape');
      break;
    case 1:
      if (!positive(s.unitsPerMonth)) missing.push('enter how many units arrive a month (at least 1)');
      if (s.unitLabel.trim().length === 0) missing.push('say what a unit is called');
      break;
    case 2:
      if (!positive(s.inTokens)) missing.push('enter input tokens per unit');
      if (!positive(s.outTokens)) missing.push('enter output tokens per unit');
      break;
    case 3:
      if (s.determinism === '') missing.push('choose how exact the answer must be');
      if (s.errorTolerance === '') missing.push('choose what happens when it is wrong');
      break;
    case 4:
      if (s.dataClasses.length === 0) missing.push('pick at least one data class');
      break;
    case 5:
      if (s.latencyBudgetMs === '') missing.push('choose a latency budget');
      break;
    case 7:
      if (s.engineers === '') missing.push('enter how many engineers could work on this (0 is an answer)');
      break;
  }
  return joinMissing(missing);
}

/** The first step that is not complete, or null when every step is. */
export function firstIncompleteStep(s: IntakeState): number | null {
  for (let i = 0; i <= LAST_STEP; i++) if (blockedReason(i, s) !== null) return i;
  return null;
}

/** `step=N` from the URL, 0-based. Anything unparseable is ignored. */
export function parseStep(raw: string | string[] | undefined | null): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n <= LAST_STEP ? n : null;
}

/* ------------------------------------------------------------------ */
/* State → Workload                                                    */
/* ------------------------------------------------------------------ */

function common(s: IntakeState) {
  return {
    name: s.name.trim(),
    description: s.description.trim(),
    actor: s.actor,
    task: s.task,
    sourceSystems: s.sourceSystems.split(',').map((x) => x.trim()).filter(Boolean),
    current: {
      ...(s.minutesPerUnit === '' ? {} : { minutesPerUnit: s.minutesPerUnit }),
      ...(s.hourlyUsd === '' ? {} : { fullyLoadedHourlyUsd: s.hourlyUsd }),
      ...(s.humanErrorRate === '' ? {} : { humanErrorRate: s.humanErrorRate / 100 }),
    },
  };
}

/**
 * The full Workload, or null while any step is incomplete. There is no
 * fallback for a missing answer; that is the point.
 */
export function workloadFromState(s: IntakeState, now = Date.now()): Workload | null {
  if (firstIncompleteStep(s) !== null) return null;
  const c = common(s);
  return {
    id: `w_${now.toString(36)}`,
    name: c.name,
    description: c.description,
    actor: c.actor,
    task: c.task,
    volume: { unitsPerMonth: s.unitsPerMonth as number, unitLabel: s.unitLabel.trim(), variability: s.variability },
    input: {
      modality: ['text'],
      avgTokens: s.inTokens as number,
      sourceSystems: c.sourceSystems,
      requiresExternalKnowledge: s.requiresExternalKnowledge,
    },
    output: { modality: ['text'], avgTokens: s.outTokens as number, mustBeStructured: s.mustBeStructured },
    determinism: s.determinism as Determinism,
    errorTolerance: s.errorTolerance as ErrorTolerance,
    multiStep: s.multiStep,
    dataClasses: s.dataClasses,
    actions: s.actions,
    autonomy: s.autonomy,
    latencyBudgetMs: s.latencyBudgetMs as LatencyMs,
    regulated: s.regulated.length ? s.regulated : ['none'],
    dataResidency: s.dataResidency,
    current: c.current,
    team: {
      engineers: s.engineers as number,
      hasMlExperience: s.hasMlExperience,
      hasSecurityReview: s.hasSecurityReview,
      canOperate247: s.canOperate247,
    },
  };
}

/* ------------------------------------------------------------------ */
/* The short-circuit workload (contract with the report, scope=verdict) */
/* ------------------------------------------------------------------ */

/**
 * Fields the short-circuit may fill with a placeholder, and the placeholder.
 * The report renders `scope=verdict` without any value derived from these.
 */
export const PLACEHOLDERS = {
  unitsPerMonth: 1,
  unitLabel: 'unit',
  inTokens: 1,
  outTokens: 1,
  determinism: 'tolerant',
  errorTolerance: 'medium',
  dataClasses: ['internal'],
  latencyBudgetMs: 30_000,
  engineers: 0,
} as const satisfies Partial<Record<keyof IntakeState, unknown>>;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;

/**
 * Short-circuit ids record which fields were placeholders, so that "Continue
 * the full assessment" (`/assess?w=…&step=1`) reopens them empty instead of
 * presenting `1 unit a month` as if the person had said it. The id is never
 * displayed; it exists so a Workload can say where it came from.
 */
export const VERDICT_ID_PREFIX = 'w_verdict_';

function isUnanswered(key: PlaceholderKey, s: IntakeState): boolean {
  const v = s[key];
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  return key === 'engineers' ? false : !positive(v as number);
}

/**
 * A Workload that passes the core schema from the first step alone, for
 * `/report?w=…&scope=verdict`. Answered fields are kept; unanswered ones get
 * PLACEHOLDERS and are listed in the id. Null unless the job is named.
 */
export function shortCircuitWorkload(s: IntakeState, now = Date.now()): Workload | null {
  if (s.name.trim().length === 0 || s.task.length === 0) return null;
  const blanks = (Object.keys(PLACEHOLDERS) as PlaceholderKey[]).filter((k) => isUnanswered(k, s));
  const pick = (k: PlaceholderKey): unknown => (blanks.includes(k) ? PLACEHOLDERS[k] : s[k]);
  const c = common(s);
  return {
    id: `${VERDICT_ID_PREFIX}${now.toString(36)}__${blanks.join('.')}`,
    name: c.name,
    description: c.description,
    actor: c.actor,
    task: c.task,
    volume: { unitsPerMonth: pick('unitsPerMonth') as number, unitLabel: (pick('unitLabel') as string).trim(), variability: s.variability },
    input: {
      modality: ['text'],
      avgTokens: pick('inTokens') as number,
      sourceSystems: c.sourceSystems,
      requiresExternalKnowledge: s.requiresExternalKnowledge,
    },
    output: { modality: ['text'], avgTokens: pick('outTokens') as number, mustBeStructured: s.mustBeStructured },
    determinism: pick('determinism') as Determinism,
    errorTolerance: pick('errorTolerance') as ErrorTolerance,
    multiStep: s.multiStep,
    dataClasses: [...(pick('dataClasses') as readonly DataClass[])],
    actions: s.actions,
    autonomy: s.autonomy,
    latencyBudgetMs: pick('latencyBudgetMs') as number,
    regulated: s.regulated.length ? s.regulated : ['none'],
    dataResidency: s.dataResidency,
    current: c.current,
    team: {
      engineers: pick('engineers') as number,
      hasMlExperience: s.hasMlExperience,
      hasSecurityReview: s.hasSecurityReview,
      canOperate247: s.canOperate247,
    },
  };
}

/** The placeholder fields a short-circuit id records, or [] for any other id. */
export function placeholderKeysFromId(id: string): PlaceholderKey[] {
  if (!id.startsWith(VERDICT_ID_PREFIX)) return [];
  const tail = id.split('__')[1] ?? '';
  return tail.split('.').filter((k): k is PlaceholderKey => k in PLACEHOLDERS);
}

/* ------------------------------------------------------------------ */
/* Workload → State (the "Edit answers" link)                          */
/* ------------------------------------------------------------------ */

const isLatency = (n: number): n is LatencyMs => (LATENCY_OPTIONS as readonly number[]).includes(n);

/**
 * Prefill from a decoded Workload. Placeholder fields from a short-circuit
 * come back empty, and a latency budget that is not one of the four options
 * (old links carried an unchosen 10,000 ms) comes back unselected rather than
 * being rounded to a choice the person never made.
 */
export function stateFromWorkload(w: Workload): IntakeState {
  const blank = new Set<PlaceholderKey>(placeholderKeysFromId(w.id));
  const keep = <T>(k: PlaceholderKey, v: T): T | Blank => (blank.has(k) ? '' : v);
  return {
    name: w.name,
    description: w.description,
    actor: w.actor === 'self' ? 'employee' : w.actor,
    task: [...w.task],
    unitsPerMonth: keep('unitsPerMonth', w.volume.unitsPerMonth),
    unitLabel: keep('unitLabel', w.volume.unitLabel),
    variability: w.volume.variability,
    inTokens: keep('inTokens', w.input.avgTokens),
    outTokens: keep('outTokens', w.output.avgTokens),
    promptPaste: '',
    sourceSystems: w.input.sourceSystems.join(', '),
    requiresExternalKnowledge: w.input.requiresExternalKnowledge,
    mustBeStructured: w.output.mustBeStructured,
    determinism: keep('determinism', w.determinism),
    errorTolerance: keep('errorTolerance', w.errorTolerance),
    multiStep: w.multiStep,
    dataClasses: blank.has('dataClasses') ? [] : [...w.dataClasses],
    actions: w.actions.map((a) => ({ ...a })),
    autonomy: w.autonomy,
    latencyBudgetMs: blank.has('latencyBudgetMs') || !isLatency(w.latencyBudgetMs) ? '' : w.latencyBudgetMs,
    regulated: w.regulated.length ? [...w.regulated] : ['none'],
    dataResidency: w.dataResidency,
    minutesPerUnit: w.current.minutesPerUnit ?? '',
    hourlyUsd: w.current.fullyLoadedHourlyUsd ?? '',
    humanErrorRate:
      w.current.humanErrorRate === undefined ? '' : Math.round(w.current.humanErrorRate * 1000) / 10,
    engineers: keep('engineers', w.team.engineers),
    hasMlExperience: w.team.hasMlExperience,
    hasSecurityReview: w.team.hasSecurityReview,
    canOperate247: w.team.canOperate247,
  };
}

/* ------------------------------------------------------------------ */
/* Session persistence                                                 */
/* ------------------------------------------------------------------ */

/** The subset of Storage this needs, so tests can pass a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'ark.teams.intake.v1';

export interface Saved {
  step: number;
  state: IntakeState;
}

const numOrBlank = z.union([z.number().finite().nonnegative(), z.literal('')]);

/**
 * The shape a saved draft must have. Every field falls back to its empty value
 * on its own, so one bad key loses one answer rather than the whole draft, and
 * a saved draft can never smuggle a default back in.
 */
const SavedState = z.object({
  name: z.string().catch(''),
  description: z.string().catch(''),
  actor: z.enum(['employee', 'customer', 'system']).catch('employee'),
  task: z.array(TaskShape).catch([]),
  unitsPerMonth: numOrBlank.catch(''),
  unitLabel: z.string().catch(''),
  variability: z.enum(['steady', 'bursty', 'seasonal']).catch('steady'),
  inTokens: numOrBlank.catch(''),
  outTokens: numOrBlank.catch(''),
  promptPaste: z.string().catch(''),
  sourceSystems: z.string().catch(''),
  requiresExternalKnowledge: z.boolean().catch(false),
  mustBeStructured: z.boolean().catch(false),
  determinism: z.union([Determinism, z.literal('')]).catch(''),
  errorTolerance: z.union([ErrorTolerance, z.literal('')]).catch(''),
  multiStep: z.boolean().catch(false),
  dataClasses: z.array(DataClass).catch([]),
  actions: z.array(ActionSpec).catch([]),
  autonomy: Autonomy.catch('suggest'),
  latencyBudgetMs: z
    .union([z.literal(''), z.number().refine(isLatency)])
    .catch('') as z.ZodType<LatencyMs | Blank>,
  regulated: z.array(Workload.shape.regulated.removeDefault().element).catch(['none']),
  dataResidency: z.enum(['any', 'us', 'eu', 'on_prem']).catch('any'),
  minutesPerUnit: numOrBlank.catch(''),
  hourlyUsd: numOrBlank.catch(''),
  humanErrorRate: numOrBlank.catch(''),
  engineers: numOrBlank.catch(''),
  hasMlExperience: z.boolean().catch(false),
  hasSecurityReview: z.boolean().catch(false),
  canOperate247: z.boolean().catch(false),
});

/**
 * Read the saved intake. Malformed JSON, a missing state, or a store that
 * throws (private windows, blocked site data) all read as nothing saved.
 */
export function loadSaved(store: KeyValueStore | null): Saved | null {
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { step?: unknown; state?: unknown };
    if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.state !== 'object') return null;
    const state: IntakeState = SavedState.parse(parsed.state);
    const step =
      typeof parsed.step === 'number' && Number.isInteger(parsed.step) && parsed.step >= 0 && parsed.step <= LAST_STEP
        ? parsed.step
        : 0;
    return { step, state };
  } catch {
    return null;
  }
}

/** Nothing answered and nothing moved: there is no draft to keep or restore. */
export function isPristine(saved: Saved): boolean {
  return saved.step === 0 && JSON.stringify(saved.state) === JSON.stringify(emptyIntake());
}

/** Save a draft; a pristine one clears instead, so a blank form is never "restored". */
export function save(store: KeyValueStore | null, saved: Saved): void {
  if (!store) return;
  if (isPristine(saved)) return clearSaved(store);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Quota or blocked storage: the form still works, it just will not survive a refresh.
  }
}

export function clearSaved(store: KeyValueStore | null): void {
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
