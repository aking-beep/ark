import { byId, costOfCall } from '@ark/core';
import { ArkIngest } from '@ark/sdk';
import type { EvalReport } from '@ark/evals';
import type { NormalizedCompletion, ProviderAdapter } from '@ark/providers';
import { catalogModelId } from './catalog.js';
import {
  INGEST_ERROR_KINDS,
  type Attempt,
  type IngestErrorKind,
  type RuntimeRequest,
} from './types.js';

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

const KIND_SET = new Set<string>(INGEST_ERROR_KINDS);

function closedErrorKind(kind?: string): IngestErrorKind {
  if (kind && KIND_SET.has(kind)) return kind as IngestErrorKind;
  return 'unknown';
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
 *
 * One event per adapter attempt. Fallback retries share turn 0: they are
 * retries of the same business turn, not a new agent turn. Policy refusal
 * is not a model call, so it is not ingested.
 */
export async function emitTelemetry(input: TelemetryInput): Promise<TelemetryOutcome> {
  if (input.refused) {
    return { attempted: false, ok: false, error: 'policy refusal — no model call, not ingested' };
  }
  if (!input.ingest) return { attempted: false, ok: false, error: 'no ingest client' };
  try {
    const handle = input.ingest.trace(input.request.workloadId);
    const application = input.request.application ?? 'ark-runtime';
    const retries = Math.max(0, input.attempts.filter((a) => !a.ok).length);

    for (const attempt of input.attempts) {
      if (attempt.ok && input.completion && input.completion.adapterId === attempt.adapterId) {
        const costUsd = input.adapter ? optionalCostUsd(input.completion, input.adapter) : undefined;
        handle.event({
          provider: input.completion.catalogProvider,
          modelId: input.completion.modelId,
          inputTokens: input.completion.inputTokens,
          outputTokens: input.completion.outputTokens,
          latencyMs: input.completion.latencyMs,
          status: 'ok',
          application,
          turn: 0,
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
        continue;
      }
      if (attempt.ok) {
        handle.event({
          provider: attempt.catalogProvider,
          modelId: attempt.modelId,
          latencyMs: attempt.latencyMs,
          status: 'ok',
          application,
          turn: 0,
        });
        continue;
      }
      const errorKind = closedErrorKind(attempt.errorKind);
      handle.event({
        provider: attempt.catalogProvider,
        modelId: attempt.modelId,
        latencyMs: attempt.latencyMs,
        status: errorKind === 'timeout' ? 'timeout' : 'error',
        errorKind,
        application,
        turn: 0,
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
