import { assess, Workload, type Verdict } from '@ark/core';
import {
  PolicyError,
  RuntimeRequest,
  createRuntime,
  execute,
  type ExecuteDeps,
  type RuntimeResult,
} from '@ark/runtime';

export const MEASURE_TIMEOUT_MS = 15_000;

export type MeasureFailureReason = 'not-ai' | 'timeout' | 'no_provider' | 'execution_failed';

export type MeasureResult =
  | { ok: true; result: RuntimeResult; verdict: Verdict }
  | { ok: false; reason: MeasureFailureReason; message: string; verdict?: Verdict };

/**
 * One synthetic Runtime request for a teams workload. The prompt carries the
 * id and task shapes so Control can attribute the sample — never the free-text
 * description, which is where PII would live if it lived anywhere.
 */
export function sampleRequestFor(workload: Workload, model?: string) {
  const privacy = workload.dataResidency === 'on_prem' ? 'local-only' : 'any';
  return RuntimeRequest.parse({
    workloadId: workload.id,
    application: 'my-ai-for-teams',
    ...(model ? { model } : {}),
    maxTokens: 64,
    maxFallbacks: 1,
    constraints: { privacy, maxCostUsd: 0.05 },
    messages: [
      {
        role: 'user',
        content: `Synthetic ARK sample. id=${workload.id}. tasks=${workload.task.join(',')}. Reply OK.`,
      },
    ],
  });
}

export async function measureWorkload(
  workload: Workload,
  deps?: ExecuteDeps,
  timeoutMs = MEASURE_TIMEOUT_MS,
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

  const run = (async (): Promise<MeasureResult> => {
    try {
      const result = await execute(
        sampleRequestFor(workload, assessment.model.primary.id),
        deps ?? createRuntime(),
      );
      return { ok: true, result, verdict };
    } catch (err) {
      if (err instanceof PolicyError) {
        return { ok: false, reason: 'no_provider', verdict, message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: 'execution_failed', verdict, message: message.slice(0, 400) };
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<MeasureResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          reason: 'timeout',
          verdict,
          message: `measure timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([run, timed]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
