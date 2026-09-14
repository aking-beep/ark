import Link from 'next/link';

export default function Landing() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold leading-tight text-ink-100">
          Should you use AI for this?
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-300">
          Pick one specific thing you do over and over. Answer six questions about it. You will get a straight
          answer, a rough monthly cost, and a plain warning if the thing you described is a bad idea to hand to
          a chatbot.
        </p>
        <p className="mt-4 text-base leading-relaxed text-ink-400">
          Sometimes the answer is no. Looking up a number, doing arithmetic, anything that has exactly one
          correct result — a language model is the wrong tool and will occasionally be confidently wrong at it.
          This tool will tell you that instead of selling you something.
        </p>
        <Link
          href="/assess"
          className="mt-7 inline-flex rounded-lg bg-signal px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-signal-glow"
        >
          Check one task
        </Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Point title="Six questions">
          No account, no email. The whole thing takes about a minute.
        </Point>
        <Point title="Real prices">
          Costs are computed from current published model rates, and every figure says where it came from.
        </Point>
        <Point title="It can say no">
          Roughly one task in four that people bring here should not go near a language model.
        </Point>
      </section>

      <section className="rounded-xl border border-ink-800 bg-ink-850 p-5">
        <h2 className="text-sm font-semibold text-ink-100">Why the numbers carry labels</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          Most tools like this produce a confident number with nothing behind it. Every figure here is tagged
          with what it rests on — a rule of thumb, a published benchmark, or something actually measured in a
          running system. A guess and a measurement should never look the same on screen.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">
          If you run this at work and want those labels to say <span className="font-mono text-good">measured</span>{' '}
          instead of <span className="font-mono text-warn">heuristic</span>, that is what the business version
          and ARK Control are for.
        </p>
      </section>
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-850 p-4">
      <h3 className="text-sm font-medium text-ink-100">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}
