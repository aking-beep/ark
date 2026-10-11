/**
 * Small, dependency-free guards for the public API routes. No Next imports
 * here so `node --experimental-strip-types --test` can exercise them.
 */

export const MAX_BODY_BYTES = 256 * 1024;

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Read a JSON body with a hard byte cap. A declared content-length over the
 * cap is refused before reading; a body without one (or lying about it) is
 * counted while streaming and cut off at the cap.
 */
export async function readJsonBody(req: Request, maxBytes = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0) return { ok: false, status: 400, error: 'Invalid content-length.' };
    if (n > maxBytes) return { ok: false, status: 413, error: `Body exceeds ${maxBytes} bytes.` };
  }
  if (!req.body) return { ok: false, status: 400, error: 'Body must be JSON.' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: `Body exceeds ${maxBytes} bytes.` };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Body could not be read.' };
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buf)) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'Body must be JSON.' };
  }
}

/**
 * Fixed-window in-memory limiter. Per process — good enough to stop one
 * client looping on a route that spends model tokens; not a distributed quota.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  readonly limit: number;
  readonly windowMs: number;
  private readonly maxKeys: number;

  // Plain fields, not parameter properties: strip-types cannot run those.
  constructor(limit: number, windowMs: number, maxKeys = 10_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Returns 0 when allowed, else the ms until the window resets. */
  take(key: string, now = Date.now()): number {
    const cur = this.hits.get(key);
    if (!cur || now - cur.windowStart >= this.windowMs) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      this.hits.set(key, { windowStart: now, count: 1 });
      return 0;
    }
    if (cur.count >= this.limit) return this.windowMs - (now - cur.windowStart);
    cur.count++;
    return 0;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) {
      if (now - v.windowStart >= this.windowMs) this.hits.delete(k);
    }
    // Still full: drop the oldest entries rather than grow without bound.
    while (this.hits.size >= this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first === undefined) break;
      this.hits.delete(first);
    }
  }
}

/** Best-effort client address. Behind a proxy, the left-most x-forwarded-for entry. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
