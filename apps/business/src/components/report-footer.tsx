import Link from 'next/link';
import { CopyReportLink, PrintButton } from './report-actions';

const SECONDARY =
  'inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal';

/**
 * One next action for the planning meeting, then the ways back in.
 *
 * `edit` is the intake link for these exact answers: "Edit answers" on a full
 * report, "Continue the full assessment" on a verdict-only one.
 */
export function ReportFooter({ edit }: { edit: { href: string; label: string } }) {
  return (
    <section className="border-t border-ink-800 pt-6 print:hidden" aria-label="What to do with this report">
      <CopyReportLink />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <PrintButton />
        <Link href={edit.href} className={SECONDARY}>
          {edit.label}
        </Link>
        <Link href="/assess" className={SECONDARY}>
          Assess another workload
        </Link>
        <Link href="/methodology" className={SECONDARY}>
          How this was scored
        </Link>
      </div>
    </section>
  );
}

/**
 * Print is the other way a report reaches a meeting. Chrome, buttons and the
 * skip link go; the dark page stays, so the PDF reads like the screen.
 * Scoped to the report routes by being rendered only there.
 */
export function ReportPrintStyles() {
  return (
    <style>{`
      @media print {
        body > header, body > footer, body > a[href="#main"], nav { display: none !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `}</style>
  );
}

export function intakeHref(encoded: string, step?: number): string {
  const w = encodeURIComponent(encoded);
  return step === undefined ? `/assess?w=${w}` : `/assess?w=${w}&step=${step}`;
}
