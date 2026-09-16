import { byId, costOfCall, estimate } from '@ark/core';
import { evaluate } from '@ark/evals';
import { adaptersFromEnv, type ProviderAdapter } from '@ark/providers';
import type { ArkIngest } from '@ark/sdk';
import { catalogModelId, completionFrom } from './catalog.js';
import { runFallback } from './fallback.js';
import { byIdMap } from './policy.js';
import { route } from './router.js';
import { emitTelemetry, ingestFromEnv } from './telemetry.js';
import { PolicyError, RuntimeRequest, type RuntimeResult } from './types.js';

export interface ExecuteDeps {
  adapters: ProviderAdapter[];
  ingest?: ArkIngest;
}

export function createRuntime(opts: {
  adapters?: ProviderAdapter[];
  ingest?: ArkIngest;
  env?: NodeJS.Dict<string>;
  fetch?: typeof fetch;
} = {}): ExecuteDeps {
  const env = opts.env ?? process.env;
  return {
    adapters: opts.adapters ?? adaptersFromEnv({ env, fetch: opts.fetch }),
    ingest: opts.ingest ?? ingestFromEnv(env, opts.fetch),
  };
}

export async function execute(raw: unknown, deps: ExecuteDeps): Promise<RuntimeResult> {
  const request = RuntimeRequest.parse(raw);
  const routing = route({
    adapters: deps.adapters,
    constraints: request.constraints,
    request,
    maxFallbacks: request.maxFallbacks,
  });

  const adaptersById = byIdMap(deps.adapters);
  const chain = [routing.selected, ...routing.fallbacks]
    .filter((id): id is NonNullable<typeof id> => id !== null)
    .map((id) => adaptersById.get(id))
    .filter((a): a is ProviderAdapter => a !== undefined);

  if (chain.length === 0) {
    await emitTelemetry({
      ingest: deps.ingest,
      request,
      attempts: [],
      outcome: 'failure',
      refused: true,
    });
    throw new PolicyError(`no eligible provider: ${routing.rationale.join(' ')}`, routing);
  }

  const completionReq = completionFrom(request);
  const { completion, attempts } = await runFallback({ chain, request: completionReq });

  if (!completion) {
    await emitTelemetry({
      ingest: deps.ingest,
      request,
      adapter: chain[0],
      attempts,
      outcome: 'failure',
    });
    const last = attempts[attempts.length - 1]?.error ?? 'all providers failed';
    throw new Error(`runtime execution failed: ${last}`);
  }

  const adapter = adaptersById.get(completion.adapterId) ?? chain[0]!;
  const catalogId = byId(completion.modelId) ? completion.modelId : catalogModelId(adapter, completion.modelId);
  const model = byId(catalogId);
  const cost = model
    ? estimate(
        costOfCall(model, { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens }),
        'benchmark',
        `catalog ${model.id} asOf ${model.asOf}`,
      )
    : estimate(0, 'heuristic', `model ${completion.modelId} is not in the catalog — unpriced`);
  const latency = estimate(completion.latencyMs, 'measured', 'wall clock around provider complete()');
  const evaluation = evaluate({
    text: completion.text,
    modelId: catalogId,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    latencyMs: completion.latencyMs,
    finishReason: completion.finishReason,
    maxLatencyMs: request.constraints.maxLatencyMs,
    maxCostUsd: request.constraints.maxCostUsd,
    expected: request.expected,
  });

  const telemetry = await emitTelemetry({
    ingest: deps.ingest,
    request,
    completion,
    adapter,
    evaluation,
    attempts,
    outcome: 'success',
  });

  return {
    text: completion.text,
    modelId: completion.modelId,
    adapterId: completion.adapterId,
    catalogProvider: completion.catalogProvider,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    latencyMs: completion.latencyMs,
    finishReason: completion.finishReason,
    routing,
    cost,
    latency,
    evaluation,
    attempts,
    telemetry,
  };
}
