import { z } from 'zod';

/**
 * Bounds on the numbers a client can put into ingest.
 *
 * Every one of these lands in a SUM somewhere — spend per workload, tokens per
 * trace, p95 latency — and a single `1e308` or a timestamp from the year 2200
 * poisons that aggregate for every reader. The ceilings are far above anything
 * an honest caller sends and far below what would break the arithmetic.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back an observation may be dated. Matches the longest window Control queries. */
export const INGEST_TS_MAX_AGE_MS = 400 * DAY_MS;
/** How far ahead — clock skew, not scheduling. */
export const INGEST_TS_MAX_FUTURE_MS = 1 * DAY_MS;

/** Tokens in one call. The largest context windows are ~1–2M; this is 50x that. */
export const INGEST_MAX_TOKENS = 100_000_000;
/** Cost of one model call, USD. */
export const INGEST_MAX_CALL_COST_USD = 100_000;
/** Value of one action or protocol transaction, USD. */
export const INGEST_MAX_VALUE_USD = 1_000_000_000;
/** One day. A call that took longer than this is not a latency, it is an outage. */
export const INGEST_MAX_LATENCY_MS = DAY_MS;

/**
 * True when `ts` (epoch milliseconds) falls in
 * `[now - INGEST_TS_MAX_AGE_MS, now + INGEST_TS_MAX_FUTURE_MS]`.
 *
 * Exported so the ingest schema, the database layer and the tests all agree on
 * one window rather than each inventing their own.
 */
export function isPlausibleTimestamp(ts: number, now = Date.now()): boolean {
  return Number.isFinite(ts) && ts >= now - INGEST_TS_MAX_AGE_MS && ts <= now + INGEST_TS_MAX_FUTURE_MS;
}

/** An epoch-ms timestamp in the window above, checked against the clock at parse time. */
export const IngestTimestamp = z
  .number()
  .int()
  .refine((ts) => isPlausibleTimestamp(ts), {
    message: 'ts must be epoch milliseconds within the last 400 days and no more than 1 day ahead',
  });

export const TokenCount = z.number().int().min(0).max(INGEST_MAX_TOKENS);
export const LatencyMs = z.number().int().min(0).max(INGEST_MAX_LATENCY_MS);
export const CallCostUsd = z.number().finite().min(0).max(INGEST_MAX_CALL_COST_USD);
export const ValueUsd = z.number().finite().min(0).max(INGEST_MAX_VALUE_USD);
