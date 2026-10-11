import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Client } from '@libsql/client';
import { raw } from './queries.js';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export interface Caller {
  orgId: string;
  via: 'token' | 'env' | 'open';
}

/**
 * Resolve the org a bearer token is allowed to write.
 *
 * An empty token is accepted ("open" mode) only when the database has no
 * org_tokens yet, no ARK_INGEST_TOKEN is configured, and this is not a
 * production process — a fresh production database must never accept
 * anonymous writes into an org it guessed. After seed, ingest is closed.
 */
export async function orgFromBearer(
  token: string | undefined,
  opts: { client?: Client; envToken?: string; envOrgId?: string; production?: boolean } = {},
): Promise<Caller | null> {
  const c = opts.client ?? raw();
  const production = opts.production ?? process.env.NODE_ENV === 'production';
  const envToken = opts.envToken ?? process.env.ARK_INGEST_TOKEN;
  const trimmed = token?.trim() ?? '';
  if (trimmed) {
    const hash = hashSecret(trimmed);
    const row = await c.execute({
      sql: 'SELECT org_id FROM org_tokens WHERE token_hash=?',
      args: [hash],
    });
    const orgId = row.rows[0]?.org_id;
    if (orgId) return { orgId: String(orgId), via: 'token' };
    if (envToken && secretEquals(envToken, trimmed)) {
      return { orgId: opts.envOrgId ?? process.env.ARK_ORG_ID ?? 'org_demo', via: 'env' };
    }
    return null;
  }

  if (production || envToken) return null;
  const n = await c.execute('SELECT COUNT(*) n FROM org_tokens');
  const tokens = Number(n.rows[0]?.n ?? 0);
  if (tokens === 0) return { orgId: 'org_demo', via: 'open' };
  return null;
}

/**
 * Constant-time comparison that does not leak length: both sides are hashed
 * to fixed-size digests first, so timingSafeEqual never sees unequal lengths.
 */
export function secretEquals(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/**
 * Burned on an unknown email so a miss costs the same scrypt as a wrong
 * password. Without it, response time says which emails have accounts.
 */
let dummyHash: string | null = null;
function dummyPasswordHash(): string {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

export async function authenticateUser(
  email: string,
  password: string,
  opts: { client?: Client } = {},
): Promise<{ userId: string; orgId: string; orgName: string; email: string } | null> {
  const c = opts.client ?? raw();
  // A user in several orgs signs into the oldest membership, deterministically.
  // Without the ORDER BY, SQLite returns whichever row the plan happens to
  // reach first, and the same login can land in a different tenant tomorrow.
  const u = await c.execute({
    sql: `SELECT u.id, u.email, u.password_hash, m.org_id, o.name
          FROM users u JOIN memberships m ON m.user_id=u.id JOIN orgs o ON o.id=m.org_id
          WHERE u.email=?
          ORDER BY o.created_at ASC, m.org_id ASC
          LIMIT 1`,
    args: [email.trim().toLowerCase()],
  });
  const row = u.rows[0];
  if (!row) {
    verifyPassword(password, dummyPasswordHash());
    return null;
  }
  if (!verifyPassword(password, String(row.password_hash))) return null;
  return {
    userId: String(row.id),
    orgId: String(row.org_id),
    orgName: String(row.name),
    email: String(row.email),
  };
}

/**
 * Whether a user still belongs to an org. A session cookie is verified by
 * signature alone; this is the database half, so removing a membership ends
 * access before the cookie expires.
 */
export async function hasMembership(
  userId: string,
  orgId: string,
  opts: { client?: Client } = {},
): Promise<boolean> {
  const c = opts.client ?? raw();
  const r = await c.execute({
    sql: 'SELECT 1 FROM memberships WHERE user_id=? AND org_id=? LIMIT 1',
    args: [userId, orgId],
  });
  return r.rows.length > 0;
}

export function bearerFrom(req: { headers: { get(name: string): string | null } }): string | undefined {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return undefined;
  return header.slice(7);
}
