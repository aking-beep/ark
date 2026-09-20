import Link from 'next/link';

const LOOP = [
  {
    n: '1',
    title: 'Assess',
    body: 'Thirty questions about one repeating job. Verdict, architecture, model, controls, eval plan, cost, roadmap — every figure labelled.',
  },
  {
    n: '2',
    title: 'Measure',
    body: 'From the report, send one synthetic sample into Control. It does not sit in production traffic. Cost stays heuristic until thirty real traces land.',
  },
  {
    n: '3',
    title: 'Control',
    body: 'Production traces and protocol evidence. Spend is per outcome. Drift is the estimate versus the bill. A missing approval is an alert, not a paragraph.',
  },
] as const;

const REPORT = [
  'Verdict — including not-ai, with the reason written down',
  'The numbers — cost per successful outcome, labelled',
  'Architecture — the pattern, and the rejected ones',
  'Model — cheapest adequate, with priced alternatives',
  'Security controls — each with how Control verifies it',
  'Evaluation plan — golden-set size and a launch threshold',
  'Roadmap — every phase has a kill criterion',
  'What this report does not know — named, not buried',
] as const;

export default function Landing() {
  return (
    <div className="space-y-12">
      <section className="max-w-3xl">
        <p className="font-mono text-2xs uppercase tracking-widest text-signal">MY AI for teams</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-ink-100">
          Should your team build this, and what happens when it runs?
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-300">
          Describe one repeating job — not a strategy, a job. In about fifteen minutes you get a document
          a planning meeting can argue with. It is built to be able to say no. Roughly a quarter of the
          workloads people bring here should be a query and a scheduled job, and the report will say so
          instead of proposing an agent.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link
            href="/assess"
            className="inline-flex rounded-lg bg-signal px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-signal-glow"
          >
            Assess a workload
          </Link>
          <Link href="/methodology" className="text-sm text-ink-400 transition hover:text-ink-200">
            How the scoring works &rarr;
          </Link>
        </div>
      </section>

      <section aria-labelledby="the-loop">
        <h2 id="the-loop" className="text-sm font-semibold text-ink-100">
          Assess → Measure → Control
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-ink-400">
          The estimator does not get more confident. It gets more informed, and it tells you which one just
          happened. MY AI for teams is the estimator. ARK Control is the measurement. They are the only two
          products that talk to each other.
        </p>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {LOOP.map((step) => (
            <li key={step.n} className="rounded-xl border border-ink-800 bg-ink-850 p-5">
              <p className="font-mono text-2xs uppercase tracking-widest text-ink-500">Step {step.n}</p>
              <h3 className="mt-1 text-sm font-medium text-ink-100">{step.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-100">What you walk out with</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {REPORT.map((item) => (
            <li
              key={item}
              className="rounded-lg border border-ink-800 bg-ink-850 px-4 py-3 text-xs leading-relaxed text-ink-300"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Sized for a small team">
          The intake asks how many engineers you have, whether anyone has shipped ML, and whether you can
          operate overnight. Those answers change the recommendation. A three-person team gets told to build
          the workflow, not the agent.
        </Card>
        <Card title="Cost per successful outcome">
          Not cost per call. Retries, failed attempts and agent loops are priced in, because those are what
          actually arrive on the invoice and they are what every vendor calculator leaves out.
        </Card>
        <Card title="Every number is labelled">
          <span className="font-mono text-warn">heuristic</span>,{' '}
          <span className="font-mono text-info">benchmark</span>,{' '}
          <span className="font-mono text-signal">calibrated</span> or{' '}
          <span className="font-mono text-good">measured</span>. A guess and a measurement never look the
          same on screen.
        </Card>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-850 p-5">
      <h3 className="text-sm font-medium text-ink-100">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}
