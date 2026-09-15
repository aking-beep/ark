import { redirect } from 'next/navigation';
import { getSession } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect('/dashboard');
  const q = await searchParams;
  return (
    <div className="mx-auto max-w-sm py-16">
      <p className="font-mono text-sm font-semibold tracking-tight text-signal">ARK Control</p>
      <h1 className="mt-2 text-xl font-semibold text-ink-100">Sign in</h1>
      <p className="mt-2 text-sm text-ink-400">
        Each account is bound to one org. Ingest uses a separate bearer token, not this password.
      </p>
      {q.error && (
        <p className="mt-4 text-sm text-danger">That email and password did not match.</p>
      )}
      <form method="post" action="/api/session" className="mt-6 space-y-3">
        <label className="block text-2xs uppercase tracking-wide text-ink-500">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            defaultValue="dana@riverbend.example"
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
      <p className="mt-6 text-2xs leading-relaxed text-ink-500">
        Local demo: <span className="font-mono">dana@riverbend.example</span> / <span className="font-mono">riverbend-demo</span>
        {' '}(Demo Co) or <span className="font-mono">sam@northwind.example</span> / <span className="font-mono">northwind-demo</span>
        {' '}(Northwind — empty until <span className="font-mono">npm run ingest:live</span>).
      </p>
    </div>
  );
}
