import { byId, costOfCall } from '@ark/core';
import { ArkIngest } from '@ark/sdk';
import type { EvalReport } from '@ark/evals';
import type { NormalizedCompletion, ProviderAdapter } from '@ark/providers';
import { catalogModelId } from './catalog.js';
import type { Attempt, RuntimeRequest } from './types.js';

export interface TelemetryInput {
  ingest?: ArkIngest;
  request: RuntimeRequest;
  completion?: NormalizedCompletion;
  adapter?: ProviderAdapter;
  evaluation?: EvalReport;
  attempts: Attempt[];
  outcome: 'success' | 'failure';
  refused?: boolean;
}

export interface TelemetryOutcome {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

function optionalCostUsd(completion: NormalizedCompletion, adapter: ProviderAdapter): number | undefined {
  const catalogId = byId(completion.modelId) ? completion.modelId : catalogModelId(adapter, completion.modelId);
  const model = byId(catalogId);
  if (!model) return undefined;
  return costOfCall(model, {
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  });
}

/**
 * Best-effort Control ingest. Failures are returned, never thrown — a hung
 * or missing Control must not fail the completion. Prompts are not attached.
 */
export async function emitTelemetry(input: TelemetryInput): Promise<TelemetryOutcome> {
  if (!input.ingest) return { attempted: false, ok: false, error: 'no ingest client' };
  try {
    const workloadId = input.request.workloadId;
    const handle = input.ingest.trace(workloadId);
    const retries = Math.max(0, input.attempts.filter((a) => !a.ok).length);
    if (input.completion && input.adapter) {
      const costUsd = optionalCostUsd(input.completion, input.adapter);
      handle.event({
        provider: input.completion.catalogProvider,
        modelId: input.completion.modelId,
        inputTokens: input.completion.inputTokens,
        outputTokens: input.completion.outputTokens,
        latencyMs: input.completion.latencyMs,
        status: 'ok',
        application: input.request.application ?? 'ark-runtime',
        ...(costUsd !== undefined ? { costUsd } : {}),
      });
    } else {
      const last = input.attempts[input.attempts.length - 1];
      handle.event({
        provider: input.adapter?.catalogProvider ?? 'local',
        modelId: input.adapter?.defaultModel() ?? 'none',
        status: input.refused ? 'refused' : 'error',
        errorKind: last?.error?.slice(0, 120) ?? (input.refused ? 'policy' : 'provider_error'),
        application: input.request.application ?? 'ark-runtime',
        latencyMs: last?.latencyMs ?? 0,
      });
    }
    if (input.evaluation) {
      handle.qualitySample({
        correct: input.evaluation.quality.pass && input.evaluation.reliability.pass,
        judgedBy: 'eval',
        note: [
          input.evaluation.quality.detail,
          input.evaluation.latency.detail,
          input.evaluation.cost.detail,
          input.evaluation.reliability.detail,
        ].join('; '),
      });
    }
    await handle.close(input.outcome, { retries });
    return { attempted: true, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { attempted: true, ok: false, error: message.slice(0, 400) };
  }
}

export function ingestFromEnv(
  env: NodeJS.Dict<string> = process.env,
  fetchFn?: typeof fetch,
): ArkIngest | undefined {
  const baseUrl = env.ARK_CONTROL_URL;
  if (!baseUrl) return undefined;
  return new ArkIngest({
    baseUrl,
    token: env.ARK_CONTROL_TOKEN,
    orgId: env.ARK_ORG_ID,
    fetch: fetchFn,
    timeoutMs: 2500,
    scanLocally: true,
  });
}
