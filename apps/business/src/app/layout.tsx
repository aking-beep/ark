import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIFit for teams — should you build this?',
  description:
    'A defensible assessment of one workload: whether to use AI at all, what to build, what it costs to run, what has to be true before it ships.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-ink-800">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-semibold text-signal">AIFit</span>
              <span className="text-2xs text-ink-500">for teams &middot; by ARK</span>
            </Link>
            <nav className="flex items-center gap-5 text-xs text-ink-400">
              <Link href="/assess" className="hover:text-ink-200">
                New assessment
              </Link>
              <Link href="/methodology" className="hover:text-ink-200">
                Methodology
              </Link>
              <a
                href={process.env.ARK_CONTROL_URL ?? 'http://localhost:3002'}
                className="hover:text-ink-200"
              >
                ARK Control
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-6 pb-12 text-2xs leading-relaxed text-ink-500">
          Nothing you enter is stored. The intake is encoded into the report link and the assessment is
          recalculated each time it is opened. Every figure carries a tag saying what it rests on.
        </footer>
      </body>
    </html>
  );
}
