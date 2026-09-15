import { NextResponse } from 'next/server';
import { authenticateUser, signSession, SESSION_TTL_MS } from '@ark/db';
import { COOKIE, sessionSecret } from '@/lib/org';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let email = '';
  let password = '';
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = await req.json() as { email?: string; password?: string };
      email = String(body.email ?? '');
      password = String(body.password ?? '');
    } else {
      const form = await req.formData();
      email = String(form.get('email') ?? '');
      password = String(form.get('password') ?? '');
    }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const user = await authenticateUser(email, password);
  if (!user) {
    if (contentType.includes('application/json')) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login?error=1', req.url), { status: 303 });
  }

  const token = await signSession({
    userId: user.userId,
    orgId: user.orgId,
    email: user.email,
    orgName: user.orgName,
    exp: Date.now() + SESSION_TTL_MS,
  }, sessionSecret());

  const res = contentType.includes('application/json')
    ? NextResponse.json({ ok: true, orgId: user.orgId })
    : NextResponse.redirect(new URL('/dashboard', req.url), { status: 303 });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
