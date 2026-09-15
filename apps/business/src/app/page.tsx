import Link from 'next/link';

export default function Landing() {
  return (
    <div className="space-y-12">
      <section className="max-w-3xl">
        <p className="font-mono text-2xs uppercase tracking-widest text-signal">AIFit for teams</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-ink-100">
          Should your team build this, and what happens when it runs?
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink-300">
          Describe one repeating job — not a strategy, a job. In about fifteen minutes you get a verdict, an
          architecture with the rejected alternatives written down, a model recommendation with priced
          alternatives, the security controls the data class actually requires, an evaluation plan with a
          launch threshold, a build and run cost, and a phased roadmap where every phase has a kill
          criterion.
        </p>
        <p className="mt-4 text-base leading-relaxed text-ink-400">
          It is built to be able to say no. Roughly a quarter of the workloads people bring here should be a
          query and a scheduled job, and the report will say so instead of proposing an agent.
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

      <section className="rounded-xl border border-ink-800 bg-ink-850 p-6">
        <h2 className="text-base font-semibold text-ink-100">Where the labels come from</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">
          On its own, this tool reasons from published model prices and a rubric — honest, but{' '}
          <span className="font-mono text-warn">heuristic</span> on the two numbers that move the cost most:
          turns per outcome and failure rate. Point it at a running{' '}
          <span className="text-ink-200">ARK Control</span> instance and those become{' '}
          <span className="font-mono text-good">measured</span>, drawn from your own traces. That is the
          whole design: the estimator does not get more confident, it gets more informed, and it tells you
          which one just happened.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">
          Control also closes the loop the other way. Once the workload ships, it compares what this report
          predicted against what the thing actually costs, and shows you the drift.
        </p>
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
