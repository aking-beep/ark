'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Spend' },
  { href: '/workloads', label: 'Workloads' },
  { href: '/optimize', label: 'Optimise' },
  { href: '/budgets', label: 'Budgets & alerts' },
  { href: '/calibration', label: 'Calibration' },
];

export function Nav({ orgName, email }: { orgName: string; email: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        <Link href="/dashboard" className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold tracking-tight text-signal">ARK</span>
          <span className="text-sm font-medium text-ink-100">Control</span>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + '/');
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ' +
                  (active ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200')
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-2xs text-ink-500">
          <span className="hidden sm:inline">{email}</span>
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
      className="text-ink-400 hover:text-ink-200"
      onClick={async () => {
        await fetch('/api/session', { method: 'DELETE' });
        window.location.href = '/login';
      }}
    >
      Sign out
    </button>
  );
}
