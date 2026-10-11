/**
 * Request guards for the Control route handlers.
 *
 * Kept free of Next imports so they run under `node --test` directly (see
 * guards.test.ts) — the routes are thin, and these are the parts with logic.
 */

/** Ingest body ceiling. Big enough for 500 events with samples; small enough to refuse a memory bomb. */
export const MAX_INGEST_BYTES = 2 * 1024 * 1024;

/** Mirrors the per-batch cap in @ark/core's IngestBody, checked before parsing. */
export const MAX_EVENTS_PER_BATCH = 500;

export type CappedBody =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Read a request body as text, refusing anything over `maxBytes`.
 *
 * Content-Length is checked first so an honest oversize request costs
 * nothing, then the stream is counted as it is read, because the header is
 * optional (chunked encoding) and can lie.
 */
export async function readBodyCapped(
  req: { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<CappedBody> {
  const declared = req.headers.get('content-length');
  if (declared != null && declared !== '') {
    const len = Number(declared);
    if (!Number.isFinite(len) || len < 0) return { ok: false, status: 400, error: 'invalid content-length' };
    if (len > maxBytes) return { ok: false, status: 413, error: 'payload too large' };
  }
  if (!req.body) return { ok: true, text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, error: 'payload too large' };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

/**
 * Cheap pre-parse check on the batch size, so a 2 MB array of tiny events is
 * refused before zod walks it. The schema enforces the same cap.
 */
export function tooManyEvents(body: unknown, max = MAX_EVENTS_PER_BATCH): boolean {
  if (!body || typeof body !== 'object') return false;
  const events = (body as { events?: unknown }).events;
  return Array.isArray(events) && events.length > max;
}

/**
 * Same-origin check for state-changing browser requests (login, logout).
 *
 * Browsers send Origin on every cross-origin POST/DELETE and on same-origin
 * ones too, so a present Origin must name this host. A request with no Origin
 * is not from a browser form or fetch on another site — unless Sec-Fetch-Site
 * says it is, which modern browsers also send.
 */
export function sameOrigin(
  headers: { get(name: string): string | null },
  /** Extra origins to accept, e.g. the public URL when a proxy rewrites Host. */
  allowedOrigins: string[] = [],
): boolean {
  const origin = headers.get('origin');
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0]!.trim().toLowerCase();
  if (origin) {
    if (origin === 'null') return false;
    try {
      const u = new URL(origin);
      if (allowedOrigins.some((o) => o.replace(/\/+$/, '').toLowerCase() === u.origin.toLowerCase())) return true;
      return host !== '' && u.host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  const site = headers.get('sec-fetch-site');
  return site == null || site === 'same-origin' || site === 'none';
}

/** First hop of X-Forwarded-For, else X-Real-IP, else a shared bucket. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Fixed-window counter, in memory. Per process: behind several replicas the
 * effective limit is N times this, which is still a ceiling on guessing.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Records a hit and says whether it is allowed. */
  take(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const hit = this.hits.get(key);
    if (!hit || hit.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    hit.count++;
    const retryAfterSec = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
    return { allowed: hit.count <= this.limit, retryAfterSec };
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    // Still full of live windows: drop the oldest rather than grow without bound.
    while (this.hits.size >= this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }
}

/**
 * `?days=` for the calibration endpoint: an integer in 1..365, or the
 * default. `Number('abc')` is NaN and `Math.min(365, NaN)` is NaN, which is
 * how the old parse reached SQL.
 */
export function parseDays(raw: string | null, fallback: number): number {
  const base = Number.isFinite(fallback) ? Math.trunc(fallback) : 30;
  const parsed = raw == null || raw.trim() === '' ? NaN : Number.parseInt(raw, 10);
  const days = Number.isFinite(parsed) ? parsed : base;
  return Math.min(365, Math.max(1, days));
}
