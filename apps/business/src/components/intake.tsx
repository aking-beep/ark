'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { encodeWorkloadClient } from '@/lib/encode';
import {
  LAST_STEP,
  SECTIONS,
  blockedReason,
  clearSaved,
  emptyIntake,
  firstIncompleteStep,
  loadSaved,
  save,
  shortCircuitWorkload,
  workloadFromState,
  type IntakeState,
  type KeyValueStore,
} from '@/lib/intake-state';
import { decidedNotAi, provisionalVerdict } from '@/lib/intake-verdict';
import { HEADING_ID } from './intake/primitives';
import { STEPS, type Setter } from './intake/steps';
import { VerdictStrip } from './intake/verdict-strip';

/**
 * The business intake.
 *
 * Eight short sections. The first one alone can decide the verdict — when the
 * work is only calculation and lookup — and the strip above the form says so
 * the moment it is true, with the report one click away. Everything else is
 * asked, not assumed: the sizing fields start empty and Next says what it is
 * waiting for.
 *
 * State lives in sessionStorage so a refresh does not wipe it, unless the page
 * was opened from a report's "Edit answers" link (`?w=`), in which case that
 * link is the source of truth. Nothing leaves the browser until the report.
 */

/** sessionStorage, or null where the accessor itself throws. */
function sessionStore(): KeyValueStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function Intake({
  initial, initialStep, badLink,
}: {
  /** Prefill decoded from `?w=` on the server. */
  initial: IntakeState | null;
  /** `?step=` (0-based), already parsed. */
  initialStep: number | null;
  /** `?w=` was present but did not decode. */
  badLink: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<IntakeState>(() => initial ?? emptyIntake());
  const [step, setStep] = useState(initialStep ?? 0);
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    badLink ? 'That link could not be read, so the form starts blank.' : null,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const mounted = useRef(false);

  // Restore once, after hydration, so the server and first client render agree.
  useEffect(() => {
    const store = sessionStore();
    if (initial) {
      // The link wins. Drop it from the address bar so that a refresh from here
      // restores these edits from storage instead of re-reading the old link.
      save(store, { step: initialStep ?? 0, state: initial });
      window.history.replaceState(null, '', '/assess');
    } else {
      const saved = loadSaved(store);
      if (saved) {
        setState(saved.state);
        setStep(initialStep ?? saved.step);
        setNotice('Restored your answers from this tab.');
      }
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    if (restored) save(sessionStore(), { step, state });
  }, [restored, step, state]);

  // Moving between steps moves focus to the new step's heading.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const h = document.getElementById(HEADING_ID);
    h?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  const set: Setter = useCallback((key, value) => setState((s) => ({ ...s, [key]: value })), []);

  const verdict = provisionalVerdict(state.task);
  const stepOneReason = blockedReason(0, state);
  const showStrip =
    verdict !== null && (step > 0 ? stepOneReason === null : verdict.kind === 'not-ai');

  const isLast = step === LAST_STEP;
  const incomplete = firstIncompleteStep(state);
  const hereReason = blockedReason(step, state);
  // The last step submits everything, so an earlier gap blocks it too.
  const earlierGap = isLast && hereReason === null && incomplete !== null ? incomplete : null;
  const reason =
    hereReason ??
    (earlierGap !== null
      ? `${SECTIONS[earlierGap]} is not finished: ${blockedReason(earlierGap, state)!.replace(/^./, (c) => c.toLowerCase())}`
      : null);
  const canAdvance = reason === null;

  function go(to: number) {
    setStep(Math.max(0, Math.min(LAST_STEP, to)));
  }

  function next() {
    if (!canAdvance) return;
    if (!isLast) return go(step + 1);
    const workload = workloadFromState(state);
    if (!workload) return;
    clearSaved(sessionStore());
    router.push(`/report?w=${encodeWorkloadClient(workload)}`);
  }

  function reportNow() {
    if (!decidedNotAi(state.task)) return;
    const workload = shortCircuitWorkload(state);
    if (!workload) return;
    clearSaved(sessionStore());
    router.push(`/report?w=${encodeWorkloadClient(workload)}&scope=verdict`);
  }

  function continueAnyway() {
    setAcknowledged(true);
    if (step === 0 && stepOneReason === null) go(1);
  }

  function startOver() {
    clearSaved(sessionStore());
    setState(emptyIntake());
    setAcknowledged(false);
    setConfirmReset(false);
    setNotice(null);
    go(0);
  }

  const StepView = STEPS[step]!;
  // The furthest step reachable without skipping an unanswered one.
  const reachable = incomplete ?? LAST_STEP;

  return (
    <div>
      <nav aria-label="Assessment sections">
        <ol className="mb-4 flex flex-wrap gap-x-1 gap-y-1 text-2xs">
          {SECTIONS.map((label, i) => {
            const current = i === step;
            const cls =
              'inline-flex min-h-10 items-center gap-1 rounded-md px-2 ' +
              (current
                ? 'font-medium text-signal'
                : i < step
                  ? 'text-ink-300 hover:text-ink-100'
                  : i <= reachable
                    ? 'text-ink-400 hover:text-ink-200'
                    : 'text-ink-400 opacity-70');
            return (
              <li key={label}>
                {current || i > reachable ? (
                  <span aria-current={current ? 'step' : undefined} className={cls}>
                    <span className="font-mono">{i + 1}.</span> {label}
                  </span>
                ) : (
                  <button type="button" onClick={() => go(i)} className={cls}>
                    <span className="font-mono">{i + 1}.</span> {label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div aria-hidden className="mb-8 flex items-center gap-1.5">
        {SECTIONS.map((label, i) => (
          <div
            key={label}
            className={'h-1 flex-1 rounded-full transition ' + (i <= step ? 'bg-signal' : 'bg-ink-800')}
          />
        ))}
      </div>

      {notice && (
        <p role="status" className="mb-6 flex flex-wrap items-center gap-x-3 text-xs text-ink-300">
          {notice}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="min-h-10 px-1 text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
          >
            Dismiss
          </button>
        </p>
      )}

      {showStrip && verdict && (
        <VerdictStrip
          verdict={verdict}
          compact={acknowledged && verdict.kind === 'not-ai'}
          canShortCircuit={state.name.trim().length > 0}
          onReportNow={reportNow}
          onContinue={continueAnyway}
        />
      )}

      <StepView s={state} set={set} />

      <div className="mt-10 border-t border-ink-800 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <button
            type="button"
            onClick={() => go(step - 1)}
            disabled={step === 0}
            className="min-h-10 px-1 text-sm text-ink-300 transition hover:text-ink-100 disabled:invisible"
          >
            Back
          </button>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <span className="text-2xs text-ink-400">
              {step + 1} of {SECTIONS.length}
            </span>
            <button
              type="button"
              aria-disabled={!canAdvance}
              aria-describedby={canAdvance ? undefined : 'intake-next-reason'}
              onClick={next}
              className={
                // No transition: enabled and disabled must never be mid-fade.
                'min-h-10 rounded-lg px-5 text-sm font-medium ' +
                (canAdvance
                  ? 'bg-signal text-ink-950 hover:bg-signal-glow'
                  : 'cursor-not-allowed bg-ink-700 text-ink-300')
              }
            >
              {isLast ? 'Generate the report' : 'Next'}
            </button>
          </div>
        </div>
        {reason && (
          <p id="intake-next-reason" className="mt-3 text-right text-xs text-ink-300">
            {reason}
            {earlierGap !== null && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => go(earlierGap)}
                  className="text-signal underline-offset-2 hover:underline"
                >
                  Go to {SECTIONS[earlierGap]}
                </button>
              </>
            )}
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-center gap-x-3 text-2xs text-ink-400">
          {confirmReset ? (
            <>
              <span>Clear every answer in this tab?</span>
              <button type="button" onClick={startOver} className="min-h-10 px-1 text-ink-200 hover:text-ink-100">
                Yes, start over
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} className="min-h-10 px-1 hover:text-ink-200">
                Keep my answers
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)} className="min-h-10 px-1 hover:text-ink-200">
              Start over
            </button>
          )}
          <span>Answers are kept in this browser tab until you generate the report.</span>
        </div>
      </div>
    </div>
  );
}
