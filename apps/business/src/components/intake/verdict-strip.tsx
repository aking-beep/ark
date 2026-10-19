'use client';

import type { ProvisionalVerdict } from '@/lib/intake-verdict';

/**
 * The provisional verdict, above the form from "The job" onwards.
 *
 * Neutral colours on purpose: this is a statement about the shape of the work,
 * not a figure, and it must not look like a result the later sections earned.
 * The only decided case offers the report straight away; "Continue the full assessment"
 * shrinks the strip but never hides it, because the verdict does not change.
 */
export function VerdictStrip({
  verdict, compact, canShortCircuit, onReportNow, onContinue,
}: {
  verdict: ProvisionalVerdict;
  compact: boolean;
  /** False until the job has a name; the report needs one to title itself. */
  canShortCircuit: boolean;
  onReportNow: () => void;
  onContinue: () => void;
}) {
  const decided = verdict.kind === 'not-ai';
  return (
    <section
      aria-label="Provisional verdict"
      aria-live="polite"
      className={
        'mb-8 rounded-xl border bg-ink-850 ' +
        (decided ? 'border-ink-500' : 'border-ink-700') +
        (compact ? ' px-4 py-3' : ' p-5')
      }
    >
      <p className="font-mono text-2xs uppercase tracking-widest text-ink-400">
        {decided ? 'Verdict · decided by the shape of the work' : 'Provisional verdict · not decided yet'}
      </p>
      <p className={'mt-1 font-medium text-ink-100 ' + (compact ? 'text-sm' : 'text-base')}>{verdict.title}</p>
      {!compact && <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-300">{verdict.body}</p>}
      {decided && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={onReportNow}
            aria-disabled={!canShortCircuit}
            aria-describedby={canShortCircuit ? undefined : 'verdict-needs-name'}
            className={
              'inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-medium transition ' +
              (canShortCircuit
                ? 'bg-signal text-ink-950 hover:bg-signal-glow'
                : 'cursor-not-allowed bg-ink-700 text-ink-300')
            }
          >
            See the report now
          </button>
          {!compact && (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex min-h-10 items-center px-1 text-sm text-ink-300 transition hover:text-ink-100"
            >
              Continue the full assessment
            </button>
          )}
          {!canShortCircuit && (
            <p id="verdict-needs-name" className="text-2xs text-ink-300">
              Name the job first; the report is titled with it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
