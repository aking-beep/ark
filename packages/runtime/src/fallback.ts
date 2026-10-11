import type { AdapterId, CompletionRequest, NormalizedCompletion, ProviderAdapter } from '@ark/providers';
import { ProviderError } from '@ark/providers';
import { requestForAdapter } from './catalog.js';
import type { Attempt, IngestErrorKind } from './types.js';

export interface FallbackInput {
  chain: ProviderAdapter[];
  request: CompletionRequest;
  /** Caller cancellation. Once aborted, no further adapter is tried. */
  signal?: AbortSignal;
}

export interface FallbackOutput {
  completion?: NormalizedCompletion;
  attempts: Attempt[];
  aborted?: boolean;
}

/**
 * Try adapters in order. Stops at the first success. The chain is already
 * policy-filtered; this function will not widen it.
 */
export async function runFallback(input: FallbackInput): Promise<FallbackOutput> {
  const attempts: Attempt[] = [];
  for (const adapter of input.chain) {
    if (input.signal?.aborted) return { attempts, aborted: true };
    const started = Date.now();
    const req = requestForAdapter(adapter, input.request);
    const modelId = req.model ?? adapter.defaultModel();
    try {
      const completion = await adapter.complete(req, input.signal ? { signal: input.signal } : undefined);
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
  if (input.signal?.aborted) return { attempts, aborted: true };
  return { attempts };
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
