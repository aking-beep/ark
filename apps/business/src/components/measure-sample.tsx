'use client';

import { useState } from 'react';
import type { Workload } from '@ark/core';

type State =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; modelId: string; latencyMs: number; ingestOk: boolean }
  | { kind: 'err'; message: string };

export function MeasureSample({ workload }: { workload: Workload }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function send() {
    setState({ kind: 'pending' });
    try {
      const res = await fetch('/api/measure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workload),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        message?: string;
        reason?: string;
        modelId?: string;
        latencyMs?: number;
        telemetry?: { ok?: boolean };
      };
      if (!res.ok || !body.ok) {
        setState({
          kind: 'err',
          message: body.message ?? body.reason ?? `measure failed (${res.status})`,
        });
        return;
      }
      setState({
        kind: 'ok',
        modelId: body.modelId ?? 'unknown',
        latencyMs: body.latencyMs ?? 0,
        ingestOk: Boolean(body.telemetry?.ok),
      });
    } catch (err) {
      setState({
        kind: 'err',
        message: err instanceof Error ? err.message : 'measure failed',
      });
    }
  }

  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-4">
      <p className="text-sm font-medium text-ink-100">Measure a sample in ARK Control</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Runs one synthetic completion through Runtime (id and task shapes only — not your
        description) and posts the trace to Control when{' '}
        <span className="font-mono">ARK_CONTROL_URL</span> and{' '}
        <span className="font-mono">ARK_CONTROL_TOKEN</span> are set. One sample does not
        clear the 30-trace calibration floor.
      </p>
      <button
        type="button"
        onClick={send}
        disabled={state.kind === 'pending'}
        className="mt-3 rounded-lg bg-signal px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-signal-glow disabled:opacity-50"
      >
        {state.kind === 'pending' ? 'Measuring…' : 'Send measured sample'}
      </button>
      {state.kind === 'ok' && (
        <p className="mt-2 text-xs text-ink-300">
          {state.modelId} in {state.latencyMs}ms.{' '}
          {state.ingestOk
            ? 'Control accepted the trace.'
            : 'Completion ran; Control ingest did not (check ARK_CONTROL_URL / ARK_CONTROL_TOKEN).'}
        </p>
      )}
      {state.kind === 'err' && <p className="mt-2 text-xs text-danger">{state.message}</p>}
    </div>
  );
}
