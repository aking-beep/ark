import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession, type SessionPayload } from '@ark/db';

export const WINDOW_DAYS = Number(process.env.ARK_WINDOW_DAYS ?? 30);
export const COOKIE = 'ark_session';

export function sessionSecret(): string {
  const s = process.env.ARK_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARK_SESSION_SECRET is required in production');
  }
  return 'dev-insecure-session-secret';
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return verifySession(token, sessionSecret());
}

export async function requireOrg(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
