import { z } from 'zod';
import { byId, costOfCall } from '@ark/core';

/**
 * Patterns that indicate regulated or sensitive content left the building.
 *
 * Deliberately conservative and deliberately local — detection runs on the
 * ingest host and only the match *labels* are persisted, never the matched
 * text. A control that logs the PII it found in order to warn you about PII is
 * not a control.
 */
const DETECTORS: { label: string; re: RegExp }[] = [
  { label: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { label: 'us_ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: 'credit_card', re: /\b(?:\d[ -]*?){13,16}\b/ },
  { label: 'us_phone', re: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/ },
  { label: 'api_key', re: /\b(sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{16,}\b/ },
  { label: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
];

export function detectSensitive(text: string | undefined | null): string[] {
  if (!text) return [];
  return DETECTORS.filter((d) => d.re.test(text)).map((d) => d.label);
}

/** Providers this org has approved. Anything else is an exfiltration finding. */
export function allowlist(): string[] {
  return (process.env.ARK_PROVIDER_ALLOWLIST ?? 'anthropic,openai,google,local')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

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

export const IngestBody = z
  .object({
    orgId: z.string().min(1).default('org_demo'),
    events: z.array(EventInput).max(1000).default([]),
    traces: z.array(TraceClose).max(500).default([]),
  })
  /**
   * Both arrays default to empty so a caller can post events without traces or
   * traces without events. Both empty is a different thing: it means the body
   * had neither key, or had them under the wrong names, and the only reason it
   * parsed is that the defaults filled in for it.
   *
   * Accepting that with a 202 would tell a broken integration it is working.
   * A telemetry pipeline that reports success while recording nothing is the
   * most expensive possible failure here, because nobody investigates a green
   * light — you find out months later when the calibration endpoint has no
   * sample size and the cost figures never left `heuristic`.
   */
  .refine((b) => b.events.length > 0 || b.traces.length > 0, {
    message:
      'Body contained no events and no traces. Expected { events: [...] } and/or { traces: [...] } — see GET /api/v1/events for the shape.',
  });
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

export function authorize(req: Request): boolean {
  const expected = process.env.ARK_INGEST_TOKEN;
  if (!expected) return true; // local dev: open by default, documented in .env.example
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Length-independent comparison is overkill here; constant-time is not.
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
