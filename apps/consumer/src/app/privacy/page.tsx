import Link from 'next/link';

export const metadata = {
  title: 'Privacy — Fit',
  description: 'Nothing you type in Fit is stored. Answers live in the result link.',
};

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">Privacy</p>
      <h1 className="text-3xl font-semibold tracking-tight">Nothing is stored</h1>
      <p className="text-muted-foreground">
        This consumer app does not have an account, a database, or a session. The six answers are encoded into the
        result URL and the verdict is recalculated each time that link is opened. If you close the tab without copying
        the link, the answers are gone.
      </p>
      <p className="text-muted-foreground">
        Anyone who has the link can read what you typed. That is the trade for having nothing on a server. Do not put
        secrets, personal data you would not put in an email, or anything you cannot share into the questions.
      </p>
      <p className="text-muted-foreground">
        Two choices stay in this browser only: Simple / Detailed, and light / dark. They live in{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">localStorage</code> under keys that never leave the
        device. They are not answers.
      </p>
      <p className="text-sm text-muted-foreground">
        <Link href="/assess" className="text-primary underline underline-offset-2">
          Back to the questions
        </Link>
      </p>
    </div>
  );
}
