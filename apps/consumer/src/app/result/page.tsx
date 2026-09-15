import Link from 'next/link';
import { assessConsumer, type Verdict } from '@ark/core';
import { Panel, BasisTag, Callout, DimensionList, type Tone } from '@ark/ui';
import { decodeIntake } from '@/lib/encode';
import { CopyResultLink } from '@/components/copy-result-link';

export const dynamic = 'force-dynamic';

const VERDICT: Record<Verdict, { tone: Tone; label: string; line: string }> = {
  'not-ai': {
    tone: 'danger',
    label: 'Don\u2019t use AI for this',
    line: 'This task has one correct answer that a computer can work out exactly. A language model will get it right most of the time and be confidently wrong the rest, which is worse than a tool that simply works.',
  },
  'not-yet': {
    tone: 'warn',
    label: 'Not yet',
    line: 'The idea is reasonable but something about how you described it makes this a bad first thing to hand over. The fixes are below.',
  },
  assisted: {
    tone: 'signal',
    label: 'Yes \u2014 with you reading every result',
    line: 'This is a good fit as a drafting assistant. It is not a good fit as something that runs on its own.',
  },
  'automate-bounded': {
    tone: 'good',
    label: 'Yes \u2014 within limits',
    line: 'You could let this run with light supervision, as long as you keep the limits described below.',
  },
  automate: {
    tone: 'good',
    label: 'Yes',
    line: 'Repetitive, tolerant of the occasional miss, and high enough volume to be worth setting up.',
  },
};

export default async function Result({
  searchParams,
}: {
  searchParams: Promise<{ i?: string }>;
}) {
  const { i } = await searchParams;
  const intake = i ? decodeIntake(i) : null;

  if (!intake) {
    return (
      <Panel title="That link didn't work">
        <p className="text-sm leading-relaxed text-ink-300">
          Results are stored in the link itself, so a truncated or edited link cannot be recovered.{' '}
          <Link href="/assess" className="text-signal underline underline-offset-2">Start again</Link> — it takes a minute.
        </p>
      </Panel>
    );
  }

  // Consumer does not fetch calibration. The six questions do not collect
  // volume or token shape, so a measured cost figure would still be a guess
  // wearing someone else's telemetry. The engine is synchronous and local.
  const a = assessConsumer(intake);
  const v = VERDICT[a.suitability.verdict];

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs text-ink-500">{intake.name}</p>
        <h1 className={'mt-2 text-3xl font-semibold leading-tight ' + toneText(v.tone)}>{v.label}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-300">{v.line}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">{a.suitability.headline}</p>
        <CopyResultLink />
      </section>

      {a.suitability.blockers.length > 0 && (
        <Callout tone="danger" title="Reasons to stop here">
          <ul className="space-y-2">
            {a.suitability.blockers.map((b, n) => (
              <li key={n} className="flex gap-2">
                <span className="text-danger">&middot;</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Panel
        title="What it would look like"
        subtitle={a.architecture.label}
        right={<BasisTag basis="heuristic" source="ARK architecture rubric" />}
      >
        <p className="text-sm leading-relaxed text-ink-300">{a.architecture.summary}</p>
        <ul className="mt-4 space-y-1.5">
          {a.architecture.components.map((c, n) => (
            <li key={n} className="flex gap-2 text-xs leading-relaxed text-ink-400">
              <span className="text-ink-600">&middot;</span>
              {c}
            </li>
          ))}
        </ul>
      </Panel>

      {a.suitability.unlocks.length > 0 && (
        <Panel title="What would change this answer">
          <ol className="space-y-3">
            {a.suitability.unlocks.map((u, n) => (
              <li key={n} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 font-mono text-2xs text-ink-400">
                  {n + 1}
                </span>
                <span className="text-sm leading-relaxed text-ink-300">{u}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="How it scored" subtitle="Seven things, weighted. The weakest one usually decides the answer.">
        <div className="mb-4">
          <BasisTag
            basis={a.suitability.score.basis}
            source={a.suitability.score.source}
          />
        </div>
        <DimensionList dimensions={a.suitability.dimensions} spacing="tight" />
      </Panel>

      {a.trust.unknowns.length > 0 && (
        <Panel title="What this does not know">
          <ul className="space-y-2">
            {a.trust.unknowns.map((u, n) => (
              <li key={n} className="text-xs leading-relaxed text-ink-400">
                &middot; {u}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="rounded-xl border border-ink-800 bg-ink-850 p-5">
        <h2 className="text-sm font-semibold text-ink-100">Doing this at work?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          The same engine runs a longer version for teams: which architecture to build, what the security
          controls have to be, how to prove it works before it ships, and what the whole thing costs to run and
          to build. It asks about thirty questions instead of six.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={process.env.ARK_BUSINESS_URL ?? 'http://localhost:3001'}
            className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-ink-100 transition hover:border-ink-500 hover:bg-ink-800"
          >
            AIFit for teams
          </Link>
          <Link href="/assess" className="px-2 py-2 text-sm text-ink-400 transition hover:text-ink-200">
            Check another task
          </Link>
        </div>
      </section>
    </div>
  );
}

function toneText(t: Tone): string {
  return {
    neutral: 'text-ink-100', good: 'text-good', warn: 'text-warn',
    danger: 'text-danger', info: 'text-info', signal: 'text-signal',
  }[t];
}
