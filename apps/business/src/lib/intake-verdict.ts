import { DETERMINISTIC_SHAPES, type TaskShape } from '@ark/core';

/**
 * The provisional verdict the intake shows after "The job".
 *
 * Only one of the three cases is a decision. When every selected shape is
 * deterministic, `assessSuitability` returns `not-ai` before it reads anything
 * else, so the strip may say so and offer the report straight away. The other
 * two cases are leanings: the strip names which later answers decide them and
 * claims nothing more. Using the engine's own DETERMINISTIC_SHAPES is what keeps
 * the strip and the report from disagreeing; `intake-verdict.test.ts` checks it
 * against `assess()` for every shape combination.
 */

export type ProvisionalKind = 'not-ai' | 'split' | 'candidate';

export interface ProvisionalVerdict {
  kind: ProvisionalKind;
  /** True only when nothing later in the form can change the verdict. */
  decided: boolean;
  title: string;
  body: string;
}

const isDeterministic = (t: TaskShape) => DETERMINISTIC_SHAPES.includes(t);

/** Every selected shape is deterministic: the engine's not-ai short-circuit. */
export function decidedNotAi(task: readonly TaskShape[]): boolean {
  return task.length > 0 && task.every(isDeterministic);
}

export function provisionalVerdict(task: readonly TaskShape[]): ProvisionalVerdict | null {
  if (task.length === 0) return null;
  if (decidedNotAi(task)) {
    return {
      kind: 'not-ai',
      decided: true,
      title: 'Do not use a model for this',
      body:
        'Calculating and looking up have one right answer that a query or a rule computes every time. ' +
        'This is decided by the shape of the work, and nothing later in the form changes it.',
    };
  }
  if (task.some(isDeterministic)) {
    return {
      kind: 'split',
      decided: false,
      title: 'Leaning: split it — rules for the exact part, a model for the rest',
      body:
        'Part of this job is deterministic and part is not. The final verdict depends on Correctness ' +
        '(section 4) and Volume (section 2).',
    };
  }
  return {
    kind: 'candidate',
    decided: false,
    title: 'Candidate for AI — the verdict is decided by Correctness, Volume and Data',
    body:
      'The work is linguistic or judgement-based, the shape models handle. Correctness (section 4) ' +
      'usually decides it; Volume (section 2) and Data and actions (section 5) can still block it.',
  };
}
