import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIFit — should you use AI for this?',
  description: 'A straight answer about one specific thing you do, including when the answer is no.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-ink-800">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-semibold text-signal">AIFit</span>
              <span className="text-2xs text-ink-500">by ARK</span>
            </Link>
            <Link href="/assess" className="text-xs text-ink-400 hover:text-ink-200">
              Start over
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
        <footer className="mx-auto max-w-3xl px-6 pb-12 text-2xs leading-relaxed text-ink-500">
          Nothing you type here is stored. Your answers are encoded into the results link and the assessment is
          recalculated each time it is opened.
        </footer>
      </body>
    </html>
  );
}
