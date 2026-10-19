import { z } from 'zod';
import { byId } from '../models/catalog.js';
import { costOfCall } from '../economics/tokens.js';
import { detectSensitive } from './sensitive.js';
import { EvidenceInput } from './evidence.js';
import { IngestTimestamp, TokenCount, LatencyMs, CallCostUsd, ValueUsd } from './limits.js';

/**
 * The ingest contract. Shared by Control (who persists it) and @ark/sdk
 * (who produces it) so a hand-rolled payload and the SDK cannot drift.
 */

/** Sample text is scanned and discarded; 8 KB is plenty to find a leak and bounds the regex work. */
export const EVENT_SAMPLE_MAX_CHARS = 8 * 1024;
/** Events per ingest batch. */
export const INGEST_MAX_EVENTS = 500;
/** Traces, actions, quality samples and evidence rows per ingest batch. */
export const INGEST_MAX_ROWS = 500;

export const EventInput = z.object({
  /** Client-supplied idempotency key. Re-posting the same id is a no-op. */
  id: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  workloadId: z.string().min(1).max(128),
  ts: IngestTimestamp.optional(),

  provider: z.string().min(1).max(64),
  modelId: z.string().min(1).max(200),
  turn: z.number().int().min(0).max(100_000).default(0),

  /**
   * Input tokens billed at the full input rate — i.e. NOT including the
   * cache reads counted in `cachedInputTokens`. `priceEvent` adds the two.
   */
  inputTokens: TokenCount.default(0),
  outputTokens: TokenCount.default(0),
  cachedInputTokens: TokenCount.default(0),

  /** Omit and Control prices the call from the catalog. */
  costUsd: CallCostUsd.optional(),
  latencyMs: LatencyMs.default(0),

  status: z.enum(['ok', 'error', 'timeout', 'refused', 'filtered']).default('ok'),
  errorKind: z.string().max(120).optional(),

  /**
   * Optional. Scanned for sensitive patterns, then DISCARDED — Control stores
   * the labels, never the prompt. Callers who prefer to scan on their own side
   * can send `sensitiveMatches` directly and omit this.
   */
  sample: z.string().max(EVENT_SAMPLE_MAX_CHARS).optional(),
  /**
   * Detector labels (`email`, `api_key`, …), not text: the shape is a label's
   * shape so a caller cannot smuggle the matched value in as a "label".
   */
  sensitiveMatches: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)).max(16).optional(),

  userId: z.string().max(128).optional(),
  application: z.string().max(128).optional(),
  /** Registered Agent Manifest id. Optional — omit and the event still ingests. */
  agentId: z.string().min(1).max(128).optional(),
});
export type EventInput = z.infer<typeof EventInput>;

export const TraceClose = z.object({
  traceId: z.string().min(1),
  workloadId: z.string().min(1),
  outcome: z.enum(['success', 'failure', 'escalated', 'abandoned', 'pending']),
  retries: z.number().int().min(0).max(1_000).default(0),
  escalatedToHuman: z.boolean().default(false),
  actorId: z.string().max(128).optional(),
  endedAt: IngestTimestamp.optional(),
});
export type TraceClose = z.infer<typeof TraceClose>;

export const ActionInput = z.object({
  id: z.string().min(1).max(128),
  traceId: z.string().min(1).max(128),
  workloadId: z.string().min(1).max(128).optional(),
  ts: IngestTimestamp.optional(),
  name: z.string().min(1).max(200),
  system: z.string().min(1).max(200),
  blastRadius: z.enum(['none', 'reversible', 'costly', 'irreversible']),
  valueUsd: ValueUsd.optional(),
  /** Null/omitted when no approval record exists — the condition SEC-05 alerts on. */
  approvedBy: z.string().max(128).nullable().optional(),
  requiredApproval: z.boolean().default(false),
  credentialId: z.string().max(128).optional(),
  /** Registered Agent Manifest id. Optional — omit and the action still ingests. */
  agentId: z.string().min(1).max(128).optional(),
});
export type ActionInput = z.infer<typeof ActionInput>;

export const QualitySampleInput = z.object({
  id: z.string().min(1).max(128),
  workloadId: z.string().min(1).max(128),
  traceId: z.string().max(128).optional(),
  ts: IngestTimestamp.optional(),
  correct: z.boolean(),
  judgedBy: z.enum(['human', 'eval', 'heuristic']),
  note: z.string().max(2000).optional(),
});
export type QualitySampleInput = z.infer<typeof QualitySampleInput>;

export const IngestBody = z
  .object({
    /**
     * Optional, and never defaulted. The authenticated token decides tenancy;
     * Control rejects a body whose orgId is present and names a different org,
     * and uses the token's org when it is absent. Persistence takes the org
     * from the route, never from here.
     */
    orgId: z.string().min(1).max(128).optional(),
    events: z.array(EventInput).max(INGEST_MAX_EVENTS).default([]),
    traces: z.array(TraceClose).max(INGEST_MAX_ROWS).default([]),
    actions: z.array(ActionInput).max(INGEST_MAX_ROWS).default([]),
    qualitySamples: z.array(QualitySampleInput).max(INGEST_MAX_ROWS).default([]),
    evidence: z.array(EvidenceInput).max(INGEST_MAX_ROWS).default([]),
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
export type CostSource = 'reported' | 'catalog' | 'unpriced';

/**
 * `source` records where the dollars came from, because the two are not the
 * same claim: a caller-reported cost is what the provider charged (`measured`),
 * while a catalog price is observed tokens times a list rate (`calibrated`).
 */
export function priceEvent(e: EventInput): { costUsd: number; priced: boolean; source: CostSource } {
  if (e.costUsd != null) return { costUsd: e.costUsd, priced: true, source: 'reported' };
  const model = byId(e.modelId);
  if (!model) return { costUsd: 0, priced: false, source: 'unpriced' };
  const total = e.inputTokens + e.cachedInputTokens;
  const cost = costOfCall(model, {
    inputTokens: total,
    outputTokens: e.outputTokens,
    cacheHitRate: total > 0 ? e.cachedInputTokens / total : 0,
  });
  return { costUsd: cost, priced: true, source: 'catalog' };
}

/**
 * The caller's labels, unioned with what the server finds in the sample.
 *
 * A client's labels are additive, never authoritative: sending
 * `sensitiveMatches: []` alongside a sample must not switch the server-side
 * scan off. De-duplicated so a label reported by both sides is stored once.
 */
export function sensitiveLabels(e: EventInput): string[] {
  return [...new Set([...(e.sensitiveMatches ?? []), ...detectSensitive(e.sample)])];
}
