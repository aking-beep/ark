import { NextResponse } from 'next/server';
import { authenticateUser, signSession, SESSION_TTL_MS } from '@ark/db';
import { COOKIE, sessionSecret } from '@/lib/org';
import { RateLimiter, clientIp, readBodyCapped, sameOrigin } from '@/lib/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ten attempts a minute per IP and email: enough for a typo, not for a guess list. */
const loginLimiter = new RateLimiter(10, 60_000);
/** Twenty a minute per email whatever the address, so rotating it does not widen a guess list. */
const emailLimiter = new RateLimiter(20, 60_000);

const MAX_LOGIN_BYTES = 8 * 1024;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});

function allowedOrigins(): string[] {
  return (process.env.ARK_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Relative Location on purpose: behind `next start` or a proxy, req.url carries
 * the server's own host (often localhost), which sent the browser — and the
 * session cookie — to the wrong origin. RFC 9110 allows a relative reference.
 */
function seeOther(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

function crossSite() {
  return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
}

export async function POST(req: Request) {
  // Login CSRF: without this, another site can post its own credentials here
  // and sign the victim into the attacker's org.
  if (!sameOrigin(req.headers, allowedOrigins())) return crossSite();

  let email = '';
  let password = '';
  const contentType = req.headers.get('content-type') ?? '';
  const json = contentType.includes('application/json');
  try {
    const body = await readBodyCapped(req, MAX_LOGIN_BYTES);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    if (json) {
      const parsed = JSON.parse(body.text) as { email?: unknown; password?: unknown };
      email = String(parsed?.email ?? '');
      password = String(parsed?.password ?? '');
    } else {
      // Re-wrap the capped text so urlencoded and multipart both parse as before.
      const form = await new Response(body.text, { headers: { 'content-type': contentType } }).formData();
      email = String(form.get('email') ?? '');
      password = String(form.get('password') ?? '');
    }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const perClient = loginLimiter.take(`${clientIp(req.headers)}|${normalized}`);
  const perEmail = emailLimiter.take(normalized);
  const limit = perClient.allowed ? perEmail : perClient;
  if (!limit.allowed) {
    if (json) {
      return NextResponse.json(
        { error: 'too many attempts' },
        { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
      );
    }
    return seeOther('/login?error=rate');
  }

  const user = await authenticateUser(email, password);
  if (!user) {
    if (json) {
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }
    return seeOther('/login?error=1');
  }

  const token = await signSession({
    userId: user.userId,
    orgId: user.orgId,
    email: user.email,
    orgName: user.orgName,
    exp: Date.now() + SESSION_TTL_MS,
  }, sessionSecret());

  const res = json
    ? NextResponse.json({ ok: true, orgId: user.orgId })
    : seeOther('/dashboard');
  res.cookies.set(COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS / 1000 });
  return res;
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req.headers, allowedOrigins())) return crossSite();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  return res;
}
