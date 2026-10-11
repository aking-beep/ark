import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, hasMembership, type SessionPayload } from '@ark/db';
import { resolveSessionSecret } from './config';

export const WINDOW_DAYS = Number(process.env.ARK_WINDOW_DAYS ?? 30);
export const COOKIE = 'ark_session';

/** See resolveSessionSecret: production refuses a missing, published or short secret. */
export function sessionSecret(): string {
  return resolveSessionSecret(process.env);
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return verifySession(token, sessionSecret());
}

/**
 * The signed cookie proves who the user was when they signed in; the
 * membership lookup proves they still belong to the org. One indexed SELECT
 * per page, and removing a membership ends access immediately rather than at
 * cookie expiry.
 */
export async function getActiveSession(): Promise<SessionPayload | null> {
  const s = await getSession();
  if (!s) return null;
  return (await hasMembership(s.userId, s.orgId)) ? s : null;
}

export async function requireOrg(): Promise<SessionPayload> {
  const s = await getActiveSession();
  if (!s) redirect('/login');
  return s;
}
