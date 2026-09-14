import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'ARK Control',
  description: 'What your AI actually costs, what it bought, and what it was allowed to do.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-6 pb-10 pt-4 text-2xs text-ink-500">
          Figures are computed from ingested traces, not from provider invoices. Reconcile monthly.
        </footer>
      </body>
    </html>
  );
}
