'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/start', label: 'Connect' },
  { href: '/discover', label: 'Discover' },
  { href: '/agents', label: 'Agents' },
  { href: '/assurance', label: 'Assurance' },
  { href: '/actions', label: 'Actions' },
  { href: '/dashboard', label: 'Spend' },
  { href: '/workloads', label: 'Workloads' },
  { href: '/protocols', label: 'Protocols' },
  { href: '/optimize', label: 'Optimise' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/calibration', label: 'Calibration' },
];

export function Nav({ orgName, email }: { orgName: string; email: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold tracking-tight text-signal">ARK</span>
          <span className="text-sm font-medium text-ink-100">Control</span>
        </Link>
        {/* Below lg the links get their own full-width row; min-w-0 lets it scroll
            rather than push the page wider than the phone. */}
        <nav aria-label="Control" className="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto lg:order-none lg:w-auto lg:flex-1">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + '/');
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={
                  'inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-2.5 text-sm transition ' +
                  (active ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200')
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3 text-2xs text-ink-500">
          <span className="hidden 2xl:inline">{email}</span>
          <span className="font-mono text-ink-300">{orgName}</span>
          <Logout />
        </div>
      </div>
    </header>
  );
}

function Logout() {
  return (
    <button
      type="button"
      className="inline-flex min-h-10 items-center px-1 text-ink-400 hover:text-ink-200"
      onClick={async () => {
        await fetch('/api/session', { method: 'DELETE' });
        window.location.href = '/login';
      }}
    >
      Sign out
    </button>
  );
}
