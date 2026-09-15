import Link from 'next/link';

const audiences = ['Writing', 'Summaries', 'Triage', 'Lookups', 'Team work'];

const steps = [
  {
    title: '1. Answer six questions',
    body: 'One specific task. About a minute. No account, no email.',
  },
  {
    title: '2. Get a straight verdict',
    body: 'The same five-rung ladder as the team product — including “don’t use AI for this.”',
  },
  {
    title: '3. Copy the link',
    body: 'Nothing is stored. Your answers live in the URL, which is why you can send it.',
  },
];

export default function Landing() {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-[-8rem] h-80 w-80 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-48 -left-24 h-72 w-72 rounded-full bg-accent blur-3xl"
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12">
        <section className="space-y-6">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">For one specific task</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Should you use AI for this.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Pick one thing you do over and over. Answer six questions about it. You will get a straight answer,
            including when the answer is no.
          </p>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Brand new to this or already using AI at work? Switch between <strong>Simple</strong> and{' '}
            <strong>Detailed</strong> anytime with the toggle at the top. About a minute · free · no sign-up ·
            nothing stored.
          </p>
          <div className="flex flex-wrap gap-2">
            {audiences.map((label) => (
              <span key={label} className="rounded-full bg-secondary px-3 py-1 text-sm text-secondary-foreground">
                {label}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/assess"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Find my fit
            </Link>
            <Link
              href="/example"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-background px-5 text-sm font-medium text-foreground transition hover:bg-muted/50"
            >
              See an example
            </Link>
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="space-y-4">
          <h2 id="how-it-works" className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            How it works
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step, i) => (
              <article key={step.title} className="h-full rounded-xl border border-border bg-card p-5 shadow-panel">
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-base font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <ValueCard title="It can say no">
            Looking up a number or doing arithmetic has one correct result. A language model is the wrong tool, and
            this one will tell you that instead of selling you something.
          </ValueCard>
          <ValueCard title="The link is the result">
            Nothing is written to a server. Anyone you send the link to can read what you typed — that is the trade
            for having nothing stored.
          </ValueCard>
          <ValueCard title="A guess never looks measured">
            Every figure carries a label for what it rests on. If you run this at work and want those labels to say
            measured, that is what the team version and ARK Control are for.
          </ValueCard>
        </section>
      </div>
    </div>
  );
}

function ValueCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-panel">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </article>
  );
}
