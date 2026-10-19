'use client';

import { useState } from 'react';
import type { Workload } from '@ark/core';
import { MEASURE_CLIENT_TIMEOUT_MS } from '@/lib/measure-timeout';
import {
  describeClientFailure,
  describeMeasureFailure,
  describeTelemetry,
  type MeasureMessage,
} from '@/lib/measure-errors';

type State =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; modelId: string; latencyMs: number; telemetry: MeasureMessage | null }
  | { kind: 'err'; message: MeasureMessage };

export function MeasureSample({
  workload,
  enabled = true,
  controlUrl,
}: {
  workload: Workload;
  enabled?: boolean;
  controlUrl?: string;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function send() {
    setState({ kind: 'pending' });
    try {
      const res = await fetch('/api/measure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workload),
        signal: AbortSignal.timeout(MEASURE_CLIENT_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        modelId?: string;
        latencyMs?: number;
        telemetry?: { attempted?: boolean; ok?: boolean };
      };
      if (!res.ok || !body.ok) {
        setState({ kind: 'err', message: describeMeasureFailure(body.reason, res.status) });
        return;
      }
      setState({
        kind: 'ok',
        modelId: body.modelId ?? 'unknown',
        latencyMs: body.latencyMs ?? 0,
        telemetry: describeTelemetry(body.telemetry),
      });
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === 'TimeoutError') ||
        (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));
      setState({ kind: 'err', message: describeClientFailure(aborted ? 'timeout' : 'network') });
    }
  }

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-4">
      <p className="text-sm font-medium text-ink-100">Once it runs, ARK Control measures it</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        This report estimates. ARK Control replaces the estimates with what your running system actually
        does. To give it a first trace now, send one synthetic sample: it carries the workload id and task
        shapes, never your description. One sample does not calibrate anything; thirty traces for this
        pattern do.
      </p>
      {!enabled && (
        <div className="mt-3 text-xs leading-relaxed" data-testid="measure-disabled">
          <p className="text-ink-300">{describeMeasureFailure('disabled').line}</p>
          <Recovery text={describeMeasureFailure('disabled').recovery} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 print:hidden">
        <button
          type="button"
          onClick={send}
          disabled={!enabled || state.kind === 'pending'}
          className="min-h-10 rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-100 transition hover:border-ink-500 hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
        >
          {state.kind === 'pending' ? 'Sending…' : 'Send one sample'}
        </button>
        {controlUrl && (
          <a href={controlUrl} className="text-xs text-ink-300 underline underline-offset-2 hover:text-ink-100">
            Open ARK Control
          </a>
        )}
      </div>
      <div aria-live="polite">
        {state.kind === 'ok' && (
          <div className="mt-3 text-xs leading-relaxed" data-testid="measure-outcome">
            <p className="text-ink-300">
              Sample answered by <span className="font-mono">{state.modelId}</span> in {state.latencyMs} ms.{' '}
              {state.telemetry ? state.telemetry.line : 'ARK Control accepted the trace.'}
            </p>
            {state.telemetry && <Recovery text={state.telemetry.recovery} />}
          </div>
        )}
        {state.kind === 'err' && (
          <div className="mt-3 text-xs leading-relaxed" data-testid="measure-outcome">
            <p className="text-warn">{state.message.line}</p>
            <Recovery text={state.message.recovery} />
          </div>
        )}
      </div>
    </div>
  );
}

function Recovery({ text }: { text: string }) {
  return (
    <p className="mt-1 text-ink-400">
      <span className="text-ink-300">For the operator:</span> {text}
    </p>
  );
}
