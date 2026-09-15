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
 * Resolve the org a bearer token is allowed to write. An empty token is
 * accepted only when the database has no org_tokens yet (pre-seed local).
 * After seed, ingest is closed.
 */
export async function orgFromBearer(
  token: string | undefined,
  opts: { client?: Client; envToken?: string; envOrgId?: string } = {},
): Promise<Caller | null> {
  const c = opts.client ?? raw();
  const trimmed = token?.trim() ?? '';
  if (trimmed) {
    const hash = hashSecret(trimmed);
    const row = await c.execute({
      sql: 'SELECT org_id FROM org_tokens WHERE token_hash=?',
      args: [hash],
    });
    const orgId = row.rows[0]?.org_id;
    if (orgId) return { orgId: String(orgId), via: 'token' };
    const envToken = opts.envToken ?? process.env.ARK_INGEST_TOKEN;
    if (envToken && envToken.length === trimmed.length) {
      let diff = 0;
      for (let i = 0; i < envToken.length; i++) diff |= envToken.charCodeAt(i) ^ trimmed.charCodeAt(i);
      if (diff === 0) {
        return { orgId: opts.envOrgId ?? process.env.ARK_ORG_ID ?? 'org_demo', via: 'env' };
      }
    }
    return null;
  }

  const n = await c.execute('SELECT COUNT(*) n FROM org_tokens');
  const tokens = Number(n.rows[0]?.n ?? 0);
  const envToken = opts.envToken ?? process.env.ARK_INGEST_TOKEN;
  if (tokens === 0 && !envToken) return { orgId: 'org_demo', via: 'open' };
  return null;
}

export async function authenticateUser(
  email: string,
  password: string,
  opts: { client?: Client } = {},
): Promise<{ userId: string; orgId: string; orgName: string; email: string } | null> {
  const c = opts.client ?? raw();
  const u = await c.execute({
    sql: `SELECT u.id, u.email, u.password_hash, m.org_id, o.name
          FROM users u JOIN memberships m ON m.user_id=u.id JOIN orgs o ON o.id=m.org_id
          WHERE u.email=?`,
    args: [email.trim().toLowerCase()],
  });
  const row = u.rows[0];
  if (!row) return null;
  if (!verifyPassword(password, String(row.password_hash))) return null;
  return {
    userId: String(row.id),
    orgId: String(row.org_id),
    orgName: String(row.name),
    email: String(row.email),
  };
}

export function bearerFrom(req: { headers: { get(name: string): string | null } }): string | undefined {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return undefined;
  return header.slice(7);
}
