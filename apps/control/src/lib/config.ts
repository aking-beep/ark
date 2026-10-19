/**
 * Environment-derived settings with rules worth testing. No Next imports, so
 * config.test.ts runs under plain `node --test`.
 */

type Env = Record<string, string | undefined>;

/** Values that have appeared in this repo or its docs, and so are not secret. */
export const KNOWN_WEAK_SESSION_SECRETS = ['change-me-in-production', 'dev-insecure-session-secret'];
export const MIN_SESSION_SECRET_LENGTH = 32;
const DEV_SESSION_SECRET = 'dev-insecure-session-secret';

/**
 * The HMAC key for session cookies. In production a missing, published or
 * short secret is a hard error: anyone who knows the key can mint a cookie
 * for any org, so "it booted" is not an acceptable outcome.
 */
export function resolveSessionSecret(env: Env = process.env): string {
  const s = env.ARK_SESSION_SECRET?.trim() ?? '';
  if (env.NODE_ENV !== 'production') return s || DEV_SESSION_SECRET;
  if (!s) throw new Error('ARK_SESSION_SECRET is required in production');
  if (KNOWN_WEAK_SESSION_SECRETS.includes(s)) {
    throw new Error('ARK_SESSION_SECRET is a published placeholder; generate a real one (openssl rand -hex 32)');
  }
  if (s.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(`ARK_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in production`);
  }
  return s;
}

/**
 * Whether the login page prints the demo accounts. Off in production unless
 * a hosted demo opts in deliberately with ARK_SHOW_DEMO_LOGIN=1.
 */
export function showDemoLogin(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ARK_SHOW_DEMO_LOGIN === '1';
}
