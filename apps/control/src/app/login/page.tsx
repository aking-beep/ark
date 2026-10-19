import { redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/org';
import { showDemoLogin } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getActiveSession()) redirect('/dashboard');
  const q = await searchParams;
  // Published demo credentials are shown only off production, or on a hosted
  // demo that opted in with ARK_SHOW_DEMO_LOGIN=1.
  const demo = showDemoLogin();
  // The same variables the seed read, so a hosted demo shows logins that work.
  const demoEmail = process.env.ARK_DEMO_EMAIL ?? 'dana@riverbend.example';
  const demoPassword = process.env.ARK_DEMO_PASSWORD ?? 'riverbend-demo';
  const nwEmail = process.env.ARK_NORTHWIND_EMAIL ?? 'sam@northwind.example';
  const nwPassword = process.env.ARK_NORTHWIND_PASSWORD ?? 'northwind-demo';
  return (
    <div className="mx-auto max-w-sm py-16">
      <p className="font-mono text-sm font-semibold tracking-tight text-signal">ARK Control</p>
      <h1 className="mt-2 text-xl font-semibold text-ink-100">Sign in</h1>
      <p className="mt-2 text-sm text-ink-400">
        Each account is bound to one org. Ingest uses a separate bearer token, not this password.
      </p>
      {q.error === 'rate' ? (
        <p className="mt-4 text-sm text-danger">Too many sign-in attempts. Wait a minute and try again.</p>
      ) : q.error ? (
        <p className="mt-4 text-sm text-danger">That email and password did not match.</p>
      ) : null}
      <form method="post" action="/api/session" className="mt-6 space-y-3">
        <label className="block text-2xs uppercase tracking-wide text-ink-500">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            defaultValue={demo ? demoEmail : undefined}
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100"
          />
        </label>
        <label className="block text-2xs uppercase tracking-wide text-ink-500">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-signal px-3 py-2 text-sm font-medium text-ink-950"
        >
          Sign in
        </button>
      </form>
      {demo && (
      <p className="mt-6 text-2xs leading-relaxed text-ink-500">
        Demo logins:{' '}
        <span className="font-mono">{demoEmail}</span> / <span className="font-mono">{demoPassword}</span>
        {' '}(Demo Co) or <span className="font-mono">{nwEmail}</span> / <span className="font-mono">{nwPassword}</span>
        {' '}(Northwind — empty until AI Fit Teams <span className="font-mono">POST /api/measure</span>
        {' '}with <span className="font-mono">ARK_CONTROL_URL</span> / <span className="font-mono">ARK_CONTROL_TOKEN</span>,
        {' '}or <span className="font-mono">npm run ingest:live</span>).
      </p>
      )}
    </div>
  );
}
