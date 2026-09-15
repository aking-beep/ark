import Link from 'next/link';
import { assessConsumer, fetchCalibration, byId, type Verdict } from '@ark/core';
import { Panel, Badge, BasisTag, Callout, DimensionList, fmt, type Tone } from '@ark/ui';
import { decodeIntake } from '@/lib/encode';

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

  // Prefer measured priors when a Control instance is reachable. When it is
  // not, the assessment still runs and every figure says "heuristic".
  const calibration = await fetchCalibration({ days: 30 });
  const a = assessConsumer(intake, { calibration });

  const v = VERDICT[a.suitability.verdict];
  const hoursPerMonth = (intake.timesPerMonth * intake.minutesEach) / 60;
  const model = byId(a.model.primary.id);
  const monthly = a.cost.perMonth.value;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs text-ink-500">{intake.name}</p>
        <h1 className={'mt-2 text-3xl font-semibold leading-tight ' + toneText(v.tone)}>{v.label}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-300">{v.line}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">{a.suitability.headline}</p>
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

      {a.suitability.verdict !== 'not-ai' && (
        <Panel title="What it would cost you" subtitle="Rough, and labelled honestly.">
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <p className="text-2xs uppercase tracking-wider text-ink-400">Per month</p>
              <p className="mt-1 font-mono text-2xl text-ink-100">{fmt.usd(monthly, 2)}</p>
              <p className="mt-1 text-2xs text-ink-500">
                {fmt.int(intake.timesPerMonth)} times &times; {fmt.usd(a.cost.perUnit.value)} each
              </p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wider text-ink-400">Your time today</p>
              <p className="mt-1 font-mono text-2xl text-ink-100">{hoursPerMonth.toFixed(1)}h</p>
              <p className="mt-1 text-2xs text-ink-500">per month on this task</p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-wider text-ink-400">Suggested model</p>
              <p className="mt-1 text-sm text-ink-100">{model?.displayName ?? a.model.primary.id}</p>
              <p className="mt-1 text-2xs leading-relaxed text-ink-500">{a.model.rationale}</p>
            </div>
          </div>

          <div className="mt-5 border-t border-ink-700 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <BasisTag
                basis={a.cost.perMonth.basis}
                source={a.cost.perMonth.source}
                sampleSize={a.cost.perMonth.sampleSize}
              />
              {a.trust.calibrated && <Badge tone="good">calibrated against real telemetry</Badge>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-400">{a.trust.caveat}</p>
          </div>

          {a.cost.wastedOnFailures.value > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-ink-400">
              About <span className="font-mono text-warn">{fmt.usd(a.cost.wastedOnFailures.value, 2)}</span> of
              that is spent on attempts that fail and get retried. Every tool that quotes you a price per
              question is leaving this out.
            </p>
          )}
        </Panel>
      )}

      {(intake.involvesPersonalData || intake.involvesMoneyOrLegal) && (
        <Callout tone="warn" title="Before you paste anything in">
          {intake.involvesPersonalData && (
            <p className="mb-2">
              You said this involves other people&apos;s personal details. Those people did not agree to have
              their information sent to an AI company. Check whether the service you use trains on your input —
              most consumer tiers do by default, and most business tiers do not.
            </p>
          )}
          {intake.involvesMoneyOrLegal && (
            <p>
              You said money or legal matters are involved. A language model will produce a fluent, confident,
              plausible answer whether or not it is correct, and it does not know your jurisdiction, your
              contract, or your balance. Treat anything it says as a draft for a person to check.
            </p>
          )}
        </Callout>
      )}

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
