import type { AdapterId, CompletionRequest, NormalizedCompletion, ProviderAdapter } from '@ark/providers';
import { ProviderError } from '@ark/providers';
import type { Attempt } from './types.js';

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
    try {
      const completion = await adapter.complete(input.request);
      attempts.push({ adapterId: adapter.id, ok: true, latencyMs: Date.now() - started });
      return { completion, attempts };
    } catch (err) {
      attempts.push({
        adapterId: adapter.id,
        ok: false,
        error: describeError(err, adapter.id),
        latencyMs: Date.now() - started,
      });
    }
  }
  return { attempts };
}

function describeError(err: unknown, adapterId: AdapterId): string {
  if (err instanceof ProviderError) return `${adapterId}: ${err.kind}: ${err.message}`;
  if (err instanceof Error) return `${adapterId}: ${err.message}`;
  return `${adapterId}: ${String(err)}`;
}
