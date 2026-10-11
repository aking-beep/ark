/**
 * HMAC-signed session cookie. Verified without a database round-trip so a
 * stolen cookie that has been tampered with never becomes an org id.
 *
 * Uses Web Crypto so the same module can run in Node tests and (if needed)
 * Edge middleware. The Control UI verifies it from a server component.
 */
export interface SessionPayload {
  userId: string;
  orgId: string;
  email: string;
  orgName: string;
  exp: number;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = new TextDecoder().decode(fromB64url(body));
    const payload = JSON.parse(json) as Partial<SessionPayload> | null;
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.userId !== 'string' || !payload.userId) return null;
    if (typeof payload.orgId !== 'string' || !payload.orgId) return null;
    // A missing or non-numeric exp must fail closed. `undefined < Date.now()`
    // is false, so the old check let a token without exp live forever.
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Twelve hours: a working day, not a week of standing access from one stolen cookie. */
export const SESSION_TTL_MS = 12 * 3600 * 1000;
