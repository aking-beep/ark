import type { AdapterId, CompletionRequest, NormalizedCompletion, ProviderAdapter } from '@ark/providers';
import { ProviderError } from '@ark/providers';
import { hintAdapter } from './catalog.js';
import type { Attempt, IngestErrorKind } from './types.js';

export interface FallbackInput {
  chain: ProviderAdapter[];
  request: CompletionRequest;
}

export interface FallbackOutput {
  completion?: NormalizedCompletion;
  attempts: Attempt[];
}

/**
 * Try adapters in order. Stops at the first success. The chain is already
 * policy-filtered; this function will not widen it.
 */
export async function runFallback(input: FallbackInput): Promise<FallbackOutput> {
  const attempts: Attempt[] = [];
  for (const adapter of input.chain) {
    const started = Date.now();
    const req = requestFor(adapter, input.request);
    const modelId = req.model ?? adapter.defaultModel();
    try {
      const completion = await adapter.complete(req);
      attempts.push({
        adapterId: adapter.id,
        catalogProvider: adapter.catalogProvider,
        modelId: completion.modelId,
        ok: true,
        latencyMs: Date.now() - started,
      });
      return { completion, attempts };
    } catch (err) {
      attempts.push({
        adapterId: adapter.id,
        catalogProvider: adapter.catalogProvider,
        modelId,
        ok: false,
        error: describeError(err, adapter.id),
        errorKind: classifyError(err),
        latencyMs: Date.now() - started,
      });
    }
  }
  return { attempts };
}

/** A model hint is for ranking. Do not send gpt-* to Ollama on fallback. */
function requestFor(adapter: ProviderAdapter, request: CompletionRequest): CompletionRequest {
  const hinted = hintAdapter(request.model);
  if (request.model && hinted && hinted !== adapter.id) {
    const { model: _ignored, ...rest } = request;
    return rest;
  }
  return request;
}

function describeError(err: unknown, adapterId: AdapterId): string {
  if (err instanceof ProviderError) return `${adapterId}: ${err.kind}: ${err.message}`;
  if (err instanceof Error) return `${adapterId}: ${err.message}`;
  return `${adapterId}: ${String(err)}`;
}

function classifyError(err: unknown): IngestErrorKind {
  if (err instanceof ProviderError) return err.kind;
  return 'unknown';
}
