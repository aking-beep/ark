import { z } from 'zod';
import { byId } from '../models/catalog.js';
import { costOfCall } from '../economics/tokens.js';
import { detectSensitive } from './sensitive.js';
import { EvidenceInput } from './evidence.js';

/**
 * The ingest contract. Shared by Control (who persists it) and @ark/sdk
 * (who produces it) so a hand-rolled payload and the SDK cannot drift.
 */

export const EventInput = z.object({
  /** Client-supplied idempotency key. Re-posting the same id is a no-op. */
  id: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  workloadId: z.string().min(1).max(128),
  ts: z.number().int().optional(),

  provider: z.string().min(1),
  modelId: z.string().min(1),
  turn: z.number().int().min(0).default(0),

  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  cachedInputTokens: z.number().int().min(0).default(0),

  /** Omit and Control prices the call from the catalog. */
  costUsd: z.number().min(0).optional(),
  latencyMs: z.number().int().min(0).default(0),

  status: z.enum(['ok', 'error', 'timeout', 'refused', 'filtered']).default('ok'),
  errorKind: z.string().max(120).optional(),

  /**
   * Optional. Scanned for sensitive patterns, then DISCARDED — Control stores
   * the labels, never the prompt. Callers who prefer to scan on their own side
   * can send `sensitiveMatches` directly and omit this.
   */
  sample: z.string().max(200_000).optional(),
  sensitiveMatches: z.array(z.string()).optional(),

  userId: z.string().max(128).optional(),
  application: z.string().max(128).optional(),
});
export type EventInput = z.infer<typeof EventInput>;

export const TraceClose = z.object({
  traceId: z.string().min(1),
  workloadId: z.string().min(1),
  outcome: z.enum(['success', 'failure', 'escalated', 'abandoned', 'pending']),
  retries: z.number().int().min(0).default(0),
  escalatedToHuman: z.boolean().default(false),
  actorId: z.string().max(128).optional(),
  endedAt: z.number().int().optional(),
});
export type TraceClose = z.infer<typeof TraceClose>;

export const ActionInput = z.object({
  id: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  workloadId: z.string().min(1).max(128).optional(),
  ts: z.number().int().optional(),
  name: z.string().min(1).max(200),
  system: z.string().min(1).max(200),
  blastRadius: z.enum(['none', 'reversible', 'costly', 'irreversible']),
  valueUsd: z.number().min(0).optional(),
  /** Null/omitted when no approval record exists — the condition SEC-05 alerts on. */
  approvedBy: z.string().max(128).nullable().optional(),
  requiredApproval: z.boolean().default(false),
  credentialId: z.string().max(128).optional(),
});
export type ActionInput = z.infer<typeof ActionInput>;

export const QualitySampleInput = z.object({
  id: z.string().min(1).max(128),
  workloadId: z.string().min(1).max(128),
  traceId: z.string().max(128).optional(),
  ts: z.number().int().optional(),
  correct: z.boolean(),
  judgedBy: z.enum(['human', 'eval', 'heuristic']),
  note: z.string().max(2000).optional(),
});
export type QualitySampleInput = z.infer<typeof QualitySampleInput>;

export const IngestBody = z
  .object({
    orgId: z.string().min(1).default('org_demo'),
    events: z.array(EventInput).max(1000).default([]),
    traces: z.array(TraceClose).max(500).default([]),
    actions: z.array(ActionInput).max(500).default([]),
    qualitySamples: z.array(QualitySampleInput).max(500).default([]),
    evidence: z.array(EvidenceInput).max(1000).default([]),
  })
  /**
   * Arrays default to empty so a caller can post events without traces or
   * traces without events. All five empty is a different thing: it means the
   * body had none of the keys, or had them under the wrong names, and the
   * only reason it parsed is that the defaults filled in for it.
   *
   * Accepting that with a 202 would tell a broken integration it is working.
   */
  .refine(
    (b) =>
      b.events.length > 0 ||
      b.traces.length > 0 ||
      b.actions.length > 0 ||
      b.qualitySamples.length > 0 ||
      b.evidence.length > 0,
    {
      message:
        'Body contained no events, traces, actions, qualitySamples or evidence. Expected at least one of those keys — see GET /api/v1/events for the shape.',
    },
  );
export type IngestBody = z.infer<typeof IngestBody>;

/**
 * Price a call from the catalog when the caller did not. Returns null when the
 * model is unknown, which is itself a finding — you cannot govern spend on a
 * model you do not have a rate card for.
 */
export function priceEvent(e: EventInput): { costUsd: number; priced: boolean } {
  if (e.costUsd != null) return { costUsd: e.costUsd, priced: true };
  const model = byId(e.modelId);
  if (!model) return { costUsd: 0, priced: false };
  const total = e.inputTokens + e.cachedInputTokens;
  const cost = costOfCall(model, {
    inputTokens: total,
    outputTokens: e.outputTokens,
    cacheHitRate: total > 0 ? e.cachedInputTokens / total : 0,
  });
  return { costUsd: cost, priced: true };
}

/** Scan a sample unless the caller already sent labels. */
export function sensitiveLabels(e: EventInput): string[] {
  return e.sensitiveMatches ?? detectSensitive(e.sample);
}
