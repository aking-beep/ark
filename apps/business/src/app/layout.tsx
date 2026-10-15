import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Fit Teams — should you build this?',
  description:
    'A defensible assessment of one workload: whether to use AI at all, what to build, what it costs to run, what has to be true before it ships.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-signal focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink-950"
        >
          Skip to content
        </a>
        <header className="border-b border-ink-800">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2 sm:px-6 sm:py-3">
            <Link href="/" className="inline-flex min-h-10 items-baseline gap-2 py-2">
              <span className="font-mono text-sm font-semibold text-signal">AI Fit Teams</span>
              {/* Dropped at phone width, where it would collide with the nav. */}
              <span className="hidden text-2xs text-ink-400 sm:inline">a separate product</span>
            </Link>
            <Nav controlUrl={process.env.ARK_CONTROL_URL ?? 'http://localhost:3002'} />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-10 outline-none sm:px-6">
          {children}
        </main>
        <footer className="mx-auto max-w-5xl px-4 pb-12 text-2xs leading-relaxed text-ink-400 sm:px-6">
          Nothing you enter is stored. The intake is encoded into the report link and the assessment is
          recalculated each time it is opened. Every figure carries a tag saying what it rests on.
        </footer>
      </body>
    </html>
  );
}
