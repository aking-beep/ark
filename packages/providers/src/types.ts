import { z } from 'zod';
import type { Capability, Provider } from '@ark/core';

/**
 * The request every adapter accepts. Provider-specific JSON is an adapter
 * concern; callers never branch on vendor shape.
 */
export const ChatMessage = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const CompletionRequest = z.object({
  messages: z.array(ChatMessage).min(1),
  model: z.string().min(1).optional(),
  maxTokens: z.number().int().positive().max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type CompletionRequest = z.infer<typeof CompletionRequest>;

export const ADAPTER_IDS = ['ollama', 'bedrock', 'openai-compatible'] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

export type Residency = 'local' | 'cloud';

export interface NormalizedCompletion {
  text: string;
  modelId: string;
  adapterId: AdapterId;
  /** Maps onto @ark/core Provider so Control ingest stays on the catalog vocabulary. */
  catalogProvider: Provider;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: 'stop' | 'length' | 'error';
}

export class ProviderError extends Error {
  constructor(
    readonly kind: 'timeout' | 'http' | 'network' | 'parse' | 'config',
    message: string,
    readonly adapterId: AdapterId,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderError';
  }
}

export interface ProviderAdapter {
  readonly id: AdapterId;
  readonly catalogProvider: Provider;
  readonly residency: Residency;
  readonly capabilities: Capability[];
  readonly latencyClass: 'fast' | 'standard' | 'slow';
  configured(): boolean;
  defaultModel(): string;
  complete(req: CompletionRequest): Promise<NormalizedCompletion>;
}

export type FetchFn = typeof fetch;
