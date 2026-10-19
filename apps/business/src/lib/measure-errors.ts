/**
 * Measure failures in planning English.
 *
 * The person pressing the button is usually in a planning meeting, not on the
 * box that runs the model, so every outcome is one plain line for them and one
 * recovery step for whoever operates the deployment. Adapter dialect ("no
 * eligible adapter remains after policy") never reaches the screen: the raw
 * message stays in the API response for the operator who wants it.
 *
 * Client-safe: no Runtime imports.
 */

export interface MeasureMessage {
  /** What happened, for anyone in the room. */
  line: string;
  /** What the operator does about it. */
  recovery: string;
}

/** Every reason the client can see: the API's own, plus the client-side ones. */
export type MeasureFailureKind =
  | 'no_provider'
  | 'disabled'
  | 'rate_limited'
  | 'timeout'
  | 'not-ai'
  | 'execution_failed'
  | 'invalid_workload'
  | 'network'
  | 'unknown';

const MESSAGES: Record<MeasureFailureKind, MeasureMessage> = {
  no_provider: {
    line: 'This deployment has no model configured to take a sample, so nothing was sent.',
    recovery: 'Set ARK_OLLAMA_URL and ARK_OLLAMA_MODEL (an installed model tag) on this app, or configure another Runtime provider, then send again.',
  },
  disabled: {
    line: 'Sampling is switched off on this deployment.',
    recovery: 'Set ARK_MEASURE_ENABLED=1 on this app if this deployment should send samples to ARK Control. It is off by default because each sample spends model tokens.',
  },
  rate_limited: {
    line: 'Too many samples from here in a short time. Nothing is wrong with the workload.',
    recovery: 'Wait a minute and send again. One sample per workload is all this step needs.',
  },
  timeout: {
    line: 'The model did not answer in time, so no sample was recorded.',
    recovery: 'Check the model host is running and warm. A cold local model can take longer than the 15-second limit on its first request.',
  },
  'not-ai': {
    line: 'This workload was scored not-ai, so there is nothing to sample. Running a model on it is what the report advises against.',
    recovery: 'Nothing to fix. Build the deterministic version.',
  },
  execution_failed: {
    line: 'The model host was reached, but the sample did not complete.',
    recovery: 'Check the model host’s logs. The request was a 64-token synthetic prompt carrying only the workload id and task shapes.',
  },
  invalid_workload: {
    line: 'This report link does not describe a complete workload, so it cannot be sampled.',
    recovery: 'Re-run the assessment to mint a fresh link.',
  },
  network: {
    line: 'This page could not reach its own measure endpoint.',
    recovery: 'Check the connection and send again. If it persists, check that the app’s server is running.',
  },
  unknown: {
    line: 'The sample did not complete.',
    recovery: 'The JSON response from POST /api/measure carries the detail.',
  },
};

/** Map an API `reason` (or HTTP status when there is none) to a kind. */
export function measureFailureKind(reason: string | undefined, status?: number): MeasureFailureKind {
  switch (reason) {
    case 'no_provider':
    case 'disabled':
    case 'rate_limited':
    case 'timeout':
    case 'execution_failed':
      return reason;
    case 'not-ai':
    case 'not_ai':
    case 'unsuitable':
      return 'not-ai';
  }
  if (reason) return 'unknown';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'invalid_workload';
  if (status === 504) return 'timeout';
  return 'unknown';
}

export function describeMeasureFailure(reason: string | undefined, status?: number): MeasureMessage {
  return MESSAGES[measureFailureKind(reason, status)];
}

export function describeClientFailure(kind: 'timeout' | 'network'): MeasureMessage {
  return MESSAGES[kind];
}

/**
 * The sample ran; whether Control received it is a separate fact. A sample
 * that never reached Control is still a failure of the step, and is said so.
 */
export function describeTelemetry(
  telemetry: { attempted?: boolean; ok?: boolean } | undefined,
): MeasureMessage | null {
  if (telemetry?.ok) return null;
  if (!telemetry?.attempted) {
    return {
      line: 'This app is not connected to ARK Control, so the trace went nowhere.',
      recovery: 'Set ARK_CONTROL_URL and ARK_CONTROL_TOKEN on this app, then send again.',
    };
  }
  return {
    line: 'ARK Control did not accept the trace.',
    recovery: 'Check that ARK_CONTROL_TOKEN matches an active org token in Control and that Control is reachable from this app.',
  };
}
