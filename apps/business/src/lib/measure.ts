import { assess, Workload, type Verdict } from '@ark/core';
import {
  ExecutionAbortedError,
  PolicyError,
  RuntimeRequest,
  createRuntime,
  execute,
  type ExecuteDeps,
  type RuntimeResult,
} from '@ark/runtime';
// Type-only: erased under --experimental-strip-types, so no extension needed.
import type { RateLimiter } from './request-guard';

/** Keep in sync with `measure-timeout.ts` (client-safe copy; this file pulls Runtime). */
export const MEASURE_TIMEOUT_MS = 15_000;

/** Every sample lands in this workload namespace so it can never overwrite a real workload's traces. */
export const SAMPLE_WORKLOAD_PREFIX = 'teams_sample_';

export type MeasureFailureReason = 'not-ai' | 'timeout' | 'no_provider' | 'execution_failed';

export type MeasureResult =
  | { ok: true; result: RuntimeResult; verdict: Verdict }
  | { ok: false; reason: MeasureFailureReason; message: string; verdict?: Verdict };

/**
 * Fixed caller-facing copy. Provider and Control error bodies stay on the
 * server (logged), never in the response.
 */
export const MEASURE_MESSAGES: Record<Exclude<MeasureFailureReason, 'not-ai'>, string> = {
  no_provider: 'No eligible provider is configured for this sample (see the operator env vars).',
  execution_failed: 'The sample run failed. The operator can find the provider error in the server log.',
  timeout: `The sample did not finish within ${MEASURE_TIMEOUT_MS / 1000}s and was cancelled.`,
};

/** `/api/measure` is off unless the operator turns it on: it spends model tokens. */
export function measureEnabled(env: NodeJS.Dict<string> = process.env): boolean {
  return env.ARK_MEASURE_ENABLED?.trim() === '1';
}

export interface GateRefusal {
  status: 404 | 429;
  body: { ok: false; reason: 'disabled' | 'rate_limited'; message: string };
  headers: Record<string, string>;
}

/**
 * Checks that run before a body is read or a model is touched: the feature
 * flag (C6) and the per-client rate limit. null = proceed.
 */
export function measureGate(
  clientKey: string,
  limiter: RateLimiter,
  env: NodeJS.Dict<string> = process.env,
  globalLimiter?: RateLimiter,
): GateRefusal | null {
  if (!measureEnabled(env)) {
    return {
      status: 404,
      body: {
        ok: false,
        reason: 'disabled',
        message: 'Measuring is disabled on this deployment (ARK_MEASURE_ENABLED=1 enables it).',
      },
      headers: { 'cache-control': 'no-store' },
    };
  }
  // The global ceiling caps spend even when a caller rotates its address.
  // Only a call the client's own bucket admits counts against the global one, so
  // a client hammering past its 429s does not use up everyone else's slots.
  const own = limiter.take(clientKey);
  const retryMs = own > 0 ? own : globalLimiter?.take('*') ?? 0;
  if (retryMs > 0) {
    return {
      status: 429,
      body: { ok: false, reason: 'rate_limited', message: 'Too many samples. Try again in a minute.' },
      headers: { 'cache-control': 'no-store', 'retry-after': String(Math.ceil(retryMs / 1000)) },
    };
  }
  return null;
}

/** Map any client-supplied id into the sample namespace, with a safe charset and length. */
export function sampleWorkloadId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128 - SAMPLE_WORKLOAD_PREFIX.length);
  const bare = safe.startsWith(SAMPLE_WORKLOAD_PREFIX) ? safe.slice(SAMPLE_WORKLOAD_PREFIX.length) : safe;
  return `${SAMPLE_WORKLOAD_PREFIX}${bare || 'unnamed'}`;
}

/**
 * Operator-configured Ollama tag for a synthetic sample.
 * Catalog estimate ids (`local-70b`) are cost rows, not installed tags — never
 * pass those as RuntimeRequest.model.
 */
export function sampleModelId(env: NodeJS.Dict<string> = process.env): string | undefined {
  const configured = env.ARK_OLLAMA_MODEL?.trim();
  return configured || undefined;
}

/**
 * One synthetic Runtime request for a teams workload. The prompt carries the
 * id and task shapes so Control can attribute the sample — never the free-text
 * description, which is where PII would live if it lived anywhere.
 */
export function sampleRequestFor(workload: Workload, model?: string) {
  const privacy = workload.dataResidency === 'on_prem' ? 'local-only' : 'any';
  const workloadId = sampleWorkloadId(workload.id);
  return RuntimeRequest.parse({
    workloadId,
    application: 'my-ai-for-teams',
    ...(model ? { model } : {}),
    maxTokens: 64,
    maxFallbacks: 1,
    constraints: { privacy, maxCostUsd: 0.05 },
    messages: [
      {
        role: 'user',
        content: `Synthetic ARK sample. id=${workloadId}. tasks=${workload.task.join(',')}. Reply OK.`,
      },
    ],
  });
}

export async function measureWorkload(
  workload: Workload,
  deps?: ExecuteDeps,
  timeoutMs = MEASURE_TIMEOUT_MS,
  env: NodeJS.Dict<string> = process.env,
  log: (msg: string) => void = (m) => console.error(m),
): Promise<MeasureResult> {
  const assessment = assess(workload, { depth: 'business' });
  const verdict = assessment.suitability.verdict;
  if (verdict === 'not-ai') {
    return {
      ok: false,
      reason: 'not-ai',
      verdict,
      message: 'This workload was scored not-ai. Measuring it with a model would be the thing the report just refused.',
    };
  }

  // The timer aborts the run itself, not only the wait: the provider call is
  // cancelled and Runtime ingests nothing for a timed-out sample.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const timedOut = new Promise<MeasureResult>((resolve) => {
    ac.signal.addEventListener(
      'abort',
      () => resolve({ ok: false, reason: 'timeout', verdict, message: MEASURE_MESSAGES.timeout }),
      { once: true },
    );
  });

  const run = (async (): Promise<MeasureResult> => {
    try {
      const result = await execute(
        sampleRequestFor(workload, sampleModelId(env)),
        deps ?? createRuntime({ env }),
        { signal: ac.signal },
      );
      return { ok: true, result, verdict };
    } catch (err) {
      if (err instanceof ExecutionAbortedError || ac.signal.aborted) {
        return { ok: false, reason: 'timeout', verdict, message: MEASURE_MESSAGES.timeout };
      }
      const detail = err instanceof Error ? err.message : String(err);
      log(`[measure] ${workload.id}: ${detail.slice(0, 2000)}`);
      if (err instanceof PolicyError) {
        return { ok: false, reason: 'no_provider', verdict, message: MEASURE_MESSAGES.no_provider };
      }
      return { ok: false, reason: 'execution_failed', verdict, message: MEASURE_MESSAGES.execution_failed };
    }
  })();

  try {
    return await Promise.race([run, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
