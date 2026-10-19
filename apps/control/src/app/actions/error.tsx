'use client';

/**
 * The /actions error boundary. In production Next replaces a server error's
 * message with a generic one, so this says what failed in words and shows the
 * digest (which matches the server log) rather than the raw message.
 */
export default function ActionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-2xl space-y-3 rounded-xl border border-ink-700 bg-ink-850 px-5 py-4">
      <h1 className="text-xl font-semibold text-ink-100">Actions could not be loaded</h1>
      <p className="text-sm leading-relaxed text-ink-300">
        ARK could not read this org&apos;s action receipts. Nothing about the actions themselves changed; this page
        failed to show them. Try again, and if it keeps failing, check that the database is reachable and its schema
        is up to date (<span className="font-mono">npm run db:bootstrap</span>).
      </p>
      {error.digest && <p className="font-mono text-2xs text-ink-500">Error reference: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="inline-flex min-h-10 items-center rounded-md border border-ink-600 px-3 text-sm text-ink-100 hover:border-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal/60"
      >
        Try again
      </button>
    </div>
  );
}
