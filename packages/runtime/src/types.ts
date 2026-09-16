import { z } from 'zod';
import { ChatMessage } from '@ark/providers';
import { ADAPTER_IDS } from '@ark/providers';
import type { AdapterId, NormalizedCompletion } from '@ark/providers';
import type { Basis, Estimate, Provider } from '@ark/core';
import type { EvalReport } from '@ark/evals';

/** Closed set posted to Control. Never a provider HTTP body. */
export const INGEST_ERROR_KINDS = ['timeout', 'http', 'network', 'parse', 'config', 'unknown'] as const;
export type IngestErrorKind = (typeof INGEST_ERROR_KINDS)[number];

export const RuntimeConstraints = z.object({
  privacy: z.enum(['any', 'local-only']).default('any'),
  capabilities: z
    .array(
      z.enum([
        'text',
        'vision',
        'audio',
        'structured_output',
        'tool_use',
        'long_context',
        'reasoning',
        'batch',
        'caching',
      ]),
    )
    .optional(),
  maxCostUsd: z.number().min(0).optional(),
  maxLatencyMs: z.number().int().positive().optional(),
  allowedProviders: z.array(z.enum(ADAPTER_IDS)).optional(),
});
export type RuntimeConstraints = z.infer<typeof RuntimeConstraints>;

export const RuntimeRequest = z.object({
  workloadId: z.string().min(1).max(128).default('wl_runtime'),
  messages: z.array(ChatMessage).min(1),
  model: z.string().min(1).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
  temperature: z.number().min(0).max(2).optional(),
  constraints: RuntimeConstraints.default({}),
  /** Extra adapters to try after the primary. 0 means no fallback. Capped at 3. */
  maxFallbacks: z.number().int().min(0).max(3).default(1),
  application: z.string().max(128).optional(),
  expected: z
    .object({
      contains: z.string().optional(),
      equals: z.string().optional(),
    })
    .optional(),
});
export type RuntimeRequest = z.infer<typeof RuntimeRequest>;

export interface Exclusion {
  id: AdapterId;
  reason: string;
}

export interface RouteDecision {
  selected: AdapterId | null;
  fallbacks: AdapterId[];
  eligible: AdapterId[];
  excluded: Exclusion[];
  rationale: string[];
  basis: Basis;
  source: string;
}

export interface Attempt {
  adapterId: AdapterId;
  catalogProvider: Provider;
  modelId: string;
  ok: boolean;
  /** In-process diagnostic. Must not be copied into Control ingest. */
  error?: string;
  errorKind?: IngestErrorKind;
  latencyMs: number;
}

export interface RuntimeResult {
  text: string;
  modelId: string;
  adapterId: AdapterId;
  catalogProvider: NormalizedCompletion['catalogProvider'];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: NormalizedCompletion['finishReason'];
  routing: RouteDecision;
  cost: Estimate<number>;
  latency: Estimate<number>;
  evaluation: EvalReport;
  attempts: Attempt[];
  telemetry: { attempted: boolean; ok: boolean; error?: string };
}

export class PolicyError extends Error {
  constructor(
    message: string,
    readonly routing: RouteDecision,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}
