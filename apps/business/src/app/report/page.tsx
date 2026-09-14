import Link from 'next/link';
import {
  assess,
  fetchCalibration,
  byId,
  PATTERN_LABEL,
  type Verdict,
  type RiskLevel,
} from '@ark/core';
import {
  Panel, Grid, Stat, Badge, BasisTag, Callout, Meter, Table, Td, fmt, type Tone,
} from '@ark/ui';
import { decodeWorkload } from '@/lib/encode';

export const dynamic = 'force-dynamic';

const VERDICT: Record<Verdict, { tone: Tone; label: string; line: string }> = {
  'not-ai': {
    tone: 'danger',
    label: 'Do not use a model for this',
    line: 'As described, this workload has a computable right answer. A deterministic implementation is correct by construction, testable, and costs approximately nothing to run. A language model would be probabilistic about something that does not need to be.',
  },
  'not-yet': {
    tone: 'warn',
    label: 'Not yet',
    line: 'The workload is plausible but something in the description makes this a poor first thing to automate. The unlocks below are in priority order.',
  },
  assisted: {
    tone: 'signal',
    label: 'Yes — with a human in the loop',
    line: 'Ship this as a drafting aid with a review queue. It is the fastest path to production, it carries the least risk, and the accept/edit/reject data it generates is what would later justify removing the human.',
  },
  'automate-bounded': {
    tone: 'good',
    label: 'Yes — inside hard limits',
    line: 'This can run with light supervision provided the limits below are real controls rather than intentions.',
  },
  automate: {
    tone: 'good',
    label: 'Yes',
    line: 'Repetitive, tolerant of a miss rate, and high enough volume that the build pays back. Automate it.',
  },
};

const RISK_TONE: Record<RiskLevel, Tone> = {
  low: 'good', moderate: 'info', high: 'warn', severe: 'danger',
};

export default async function Report({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  const { w: encoded } = await searchParams;
  const workload = encoded ? decodeWorkload(encoded) : null;

  if (!workload) {
    return (
      <Panel title="That report link did not resolve">
        <p className="text-sm leading-relaxed text-ink-300">
          Reports are not stored — the intake lives in the link itself, so a truncated or edited link cannot
          be recovered.{' '}
          <Link href="/assess" className="text-signal underline underline-offset-2">
            Run the assessment again
          </Link>
          .
        </p>
      </Panel>
    );
  }

  // Measured priors where a Control instance is reachable; rubric priors where
  // it is not. Either way the basis tag on every figure says which happened.
  const calibration = await fetchCalibration({ days: 30 });
  const a = assess(workload, { depth: 'business', calibration });

  const v = VERDICT[a.suitability.verdict];
  const model = byId(a.model.primary.id);
  const unit = workload.volume.unitLabel;

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-500">{workload.name}</p>
          <Badge tone="neutral">{fmt.int(workload.volume.unitsPerMonth)} {unit}s/mo</Badge>
          <Badge tone={RISK_TONE[a.security.level]}>{a.security.level} risk</Badge>
          {a.trust.calibrated ? (
            <Badge tone="good">calibrated against telemetry</Badge>
          ) : (
            <Badge tone="warn">uncalibrated</Badge>
          )}
        </div>
        <h1 className={'mt-3 text-4xl font-semibold leading-tight ' + toneText(v.tone)}>{v.label}</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-300">{v.line}</p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">{a.suitability.headline}</p>
      </section>

      {a.suitability.blockers.length > 0 && (
        <Callout tone="danger" title="Blockers">
          <ul className="space-y-2">
            {a.suitability.blockers.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-danger">&middot;</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="The numbers"
        subtitle="Each carries a tag saying what it rests on. Read the tag before you quote the number."
      >
        <Grid cols={4}>
          <Stat
            label={`Run cost / ${unit}`}
            value={fmt.usd(a.cost.perUnit.value, 4)}
            hint="Cost per successful outcome — retries and failed attempts included."
            footer={<BasisTag basis={a.cost.perUnit.basis} source={a.cost.perUnit.source} sampleSize={a.cost.perUnit.sampleSize} />}
          />
          <Stat
            label="Run cost / month"
            value={fmt.usd(a.cost.perMonth.value, 2)}
            hint={`At ${fmt.int(workload.volume.unitsPerMonth)} ${unit}s/mo.`}
            footer={<BasisTag basis={a.cost.perMonth.basis} source={a.cost.perMonth.source} sampleSize={a.cost.perMonth.sampleSize} />}
          />
          <Stat
            label="Build cost"
            value={fmt.compactUsd(a.buildCost.value)}
            hint="Engineering to first production traffic, at a loaded rate."
            footer={<BasisTag basis={a.buildCost.basis} source={a.buildCost.source} />}
          />
          <Stat
            label="Payback"
            value={a.value.paybackMonths ? `${a.value.paybackMonths.value.toFixed(1)} mo` : 'unknowable'}
            tone={
              !a.value.paybackMonths ? 'neutral'
                : a.value.paybackMonths.value <= 12 ? 'good'
                : a.value.paybackMonths.value <= 24 ? 'warn' : 'danger'
            }
            hint={a.value.paybackMonths ? 'Months to repay the build from run savings.' : 'You did not supply what this costs today.'}
            footer={a.value.paybackMonths
              ? <BasisTag basis={a.value.paybackMonths.basis} source={a.value.paybackMonths.source} />
              : undefined}
          />
        </Grid>

        <div className="mt-6 border-t border-ink-700 pt-5">
          <p className="text-xs leading-relaxed text-ink-400">{a.trust.caveat}</p>
        </div>

        {a.cost.wastedOnFailures.value > 0 && (
          <Callout tone="warn" title="What the failure rate costs">
            <p>
              About <span className="font-mono text-warn">{fmt.usd(a.cost.wastedOnFailures.value, 2)}</span>{' '}
              a month — {fmt.pct((a.cost.wastedOnFailures.value / Math.max(a.cost.perMonth.value, 1e-9)) * 100)} of
              run cost — is spent on attempts that fail and get retried. This is real spend that produces
              nothing, and it is the line item every per-token calculator omits. It is also the number that
              ARK Control measures directly once this is live.
            </p>
          </Callout>
        )}

        {a.value.humanCostPerUnit && a.value.netPerMonth && (
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            <Line label={`Human cost / ${unit}`} value={fmt.usd(a.value.humanCostPerUnit.value, 3)} />
            <Line label={`AI cost / ${unit}`} value={fmt.usd(a.value.aiCostPerUnit.value, 4)} />
            <Line
              label="Net / month"
              value={fmt.usd(a.value.netPerMonth.value, 0)}
              tone={a.value.netPerMonth.value > 0 ? 'good' : 'danger'}
            />
          </div>
        )}

        {a.value.spendPerDollarOfValue && (
          <p className="mt-5 text-xs leading-relaxed text-ink-400">
            Inference spend per dollar of value produced:{' '}
            <span className="font-mono text-ink-100">
              {fmt.usd(a.value.spendPerDollarOfValue.value, 3)}
            </span>
            . This is the ratio to watch after launch — it degrades quietly when prompts grow, when context
            accumulates, and when someone swaps in a bigger model to fix a quality complaint.
          </p>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="Architecture"
        subtitle="What to build, and what was considered and rejected."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="signal">{a.architecture.label}</Badge>
          <span className="font-mono text-2xs text-ink-600">{a.architecture.pattern}</span>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-300">{a.architecture.summary}</p>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">Components</h3>
            <ul className="mt-2.5 space-y-1.5">
              {a.architecture.components.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="text-ink-600">&middot;</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">
              Rejected, and why
            </h3>
            <ul className="mt-2.5 space-y-3">
              {a.architecture.rejected.map((r, i) => (
                <li key={i}>
                  <p className="font-mono text-2xs text-ink-500">
                    {PATTERN_LABEL[r.pattern] ?? r.pattern}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{r.why}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 border-t border-ink-700 pt-5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">
            Assumed call shape
          </h3>
          <p className="mt-1.5 max-w-3xl text-2xs leading-relaxed text-ink-500">
            These five numbers drive the entire cost figure. Two of them — turns per outcome and failure
            rate — are where estimates go wrong by an order of magnitude, and neither can be known before
            the system runs.
          </p>
          <Grid cols={4}>
            <Stat label="Turns / outcome" value={a.architecture.callShape.turnsPerOutcome.toFixed(1)} />
            <Stat label="Context growth / turn" value={fmt.int(a.architecture.callShape.contextGrowthPerTurn)} unit="tok" />
            <Stat label="Failure rate" value={fmt.pct(a.architecture.callShape.failureRate * 100, 1)} />
            <Stat label="Cache hit rate" value={fmt.pct(a.architecture.callShape.cacheHitRate * 100)} />
          </Grid>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel title="Model" subtitle="A shortlist across providers, so the default is not lock-in.">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="text-2xs uppercase tracking-wider text-ink-400">Primary</p>
            <p className="mt-1 text-lg text-ink-100">{model?.displayName ?? a.model.primary.id}</p>
            <p className="font-mono text-2xs text-ink-600">{a.model.primary.id}</p>
            {model && (
              <p className="mt-2 font-mono text-2xs text-ink-500">
                {fmt.usd(model.inputPer1M, 2)} in / {fmt.usd(model.outputPer1M, 2)} out per 1M tokens
                <span className="ml-2 text-ink-600">priced {model.asOf}</span>
              </p>
            )}
            <ul className="mt-3 space-y-1.5">
              {a.model.rationale.map((r, i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-400">
                  &middot; {r}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            {a.model.fallbackFast && (
              <Route
                label="Route the easy majority to"
                id={a.model.fallbackFast.id}
                name={a.model.fallbackFast.displayName}
                note="A confidence threshold sends the uncertain tail to the primary. This is usually the single largest saving available, and it is a quality decision, not a finance one."
              />
            )}
            {a.model.escalateTo && (
              <Route
                label="Escalate the hard minority to"
                id={a.model.escalateTo.id}
                name={a.model.escalateTo.displayName}
                note="Reserved for inputs the primary flags as low confidence."
              />
            )}
            {a.model.alternatives.length > 0 && (
              <div>
                <p className="text-2xs uppercase tracking-wider text-ink-400">Viable alternatives</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.model.alternatives.map((m) => (
                    <span
                      key={m.id}
                      className="rounded-md border border-ink-700 px-2 py-1 font-mono text-2xs text-ink-400"
                      title={`${m.provider} · ${fmt.usd(m.inputPer1M, 2)} in / ${fmt.usd(m.outputPer1M, 2)} out per 1M tokens`}
                    >
                      {m.displayName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="Security controls"
        subtitle="Derived from the data classes and the action surface you described — not a generic checklist."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={RISK_TONE[a.security.level]}>{a.security.level}</Badge>
          <span className="font-mono text-2xs text-ink-500">risk score {Math.round(a.security.score)}/100</span>
          {a.security.complianceFlags.map((f) => (
            <Badge key={f} tone="info">{f}</Badge>
          ))}
        </div>

        {a.security.drivers.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {a.security.drivers.map((d, i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-400">
                &middot; {d}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <Table head={['', 'Requirement', 'Why', 'How ARK Control verifies it at runtime']}>
            {a.security.controls.map((c) => (
              <tr key={c.id} className="border-t border-ink-800 align-top">
                <Td mono>
                  <span className={c.blocking ? 'text-danger' : 'text-ink-500'}>{c.id}</span>
                </Td>
                <Td align="left" className="pr-4">
                  <span className="text-ink-200">{c.requirement}</span>
                  {c.blocking && (
                    <span className="ml-2 rounded bg-danger/15 px-1.5 py-0.5 text-2xs text-danger">
                      blocks launch
                    </span>
                  )}
                </Td>
                <Td align="left" className="pr-4">
                  <span className="text-xs leading-relaxed text-ink-400">{c.why}</span>
                </Td>
                <Td align="left">
                  <span className="text-xs leading-relaxed text-ink-400">{c.verifiedBy}</span>
                </Td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-2xs leading-relaxed text-ink-500">
            The last column is the point. A control nobody can verify after launch is a paragraph in a
            document, and paragraphs do not stop anything.
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="Evaluation plan"
        subtitle="What has to be true before this is allowed to carry production traffic."
      >
        <Grid cols={3}>
          <Stat label="Golden set" value={fmt.int(a.evaluation.goldenSetSize)} unit="examples" hint="Labelled, held out, never trained or prompted against." />
          <Stat label="Cadence" value={a.evaluation.cadence} />
          <Stat label="Blocking metrics" value={fmt.int(a.evaluation.metrics.filter((m) => m.blocksLaunch).length)} unit={`of ${a.evaluation.metrics.length}`} />
        </Grid>

        <div className="mt-6">
          <Table head={['Metric', 'Threshold', 'Measured how', '']}>
            {a.evaluation.metrics.map((m) => (
              <tr key={m.name} className="border-t border-ink-800 align-top">
                <Td align="left" className="pr-4"><span className="text-ink-200">{m.name}</span></Td>
                <Td mono><span className="text-ink-100">{m.threshold}</span></Td>
                <Td align="left" className="px-4">
                  <span className="text-xs leading-relaxed text-ink-400">{m.measuredHow}</span>
                </Td>
                <Td align="right">
                  {m.blocksLaunch
                    ? <Badge tone="danger">blocks launch</Badge>
                    : <span className="text-2xs text-ink-600">monitored</span>}
                </Td>
              </tr>
            ))}
          </Table>
        </div>

        <Callout tone="info" title="The baseline nobody measures">
          <p>{a.evaluation.humanBaselineNote}</p>
        </Callout>

        <p className="mt-4 text-xs leading-relaxed text-ink-400">
          <span className="text-ink-200">Regression policy.</span> {a.evaluation.regressionPolicy}
        </p>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel title="Roadmap" subtitle="Every phase has a kill criterion. A plan without one is a commitment device.">
        <ol className="space-y-5">
          {a.phases.map((p, i) => (
            <li key={p.name} className="relative border-l border-ink-700 pl-6">
              <span className="absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-ink-700 bg-ink-900 font-mono text-[9px] text-ink-400">
                {i + 1}
              </span>
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-sm font-medium text-ink-100">{p.name}</h3>
                <span className="font-mono text-2xs text-ink-500">
                  {p.durationWeeks} week{p.durationWeeks === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-300">{p.goal}</p>
              <ul className="mt-2.5 space-y-1">
                {p.exitCriteria.map((e, n) => (
                  <li key={n} className="text-2xs leading-relaxed text-ink-400">
                    &#10003; {e}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs leading-relaxed text-danger/80">
                <span className="font-medium">Kill if:</span> {p.killCriteria}
              </p>
            </li>
          ))}
        </ol>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {a.suitability.unlocks.length > 0 && (
        <Panel title="What would move the verdict">
          <ol className="space-y-3">
            {a.suitability.unlocks.map((u, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-800 font-mono text-2xs text-ink-400">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-ink-300">{u}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="How it scored" subtitle="Seven weighted dimensions. The weakest one usually decides the verdict.">
        <ul className="space-y-4">
          {a.suitability.dimensions.map((d) => (
            <li key={d.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink-200">
                  {d.label}
                  <span className="ml-2 font-mono text-2xs text-ink-600">
                    weight {d.weight.toFixed(2)}
                  </span>
                </span>
                <span className="font-mono text-xs text-ink-400">{Math.round(d.score)}</span>
              </div>
              <Meter
                pct={d.score}
                tone={d.score < 40 ? 'danger' : d.score < 65 ? 'warn' : 'good'}
                className="mt-1.5"
              />
              <p className="mt-1.5 max-w-3xl text-2xs leading-relaxed text-ink-500">{d.reasoning}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel title="What this report does not know" subtitle="The section most tools like this leave out.">
        <ul className="space-y-2.5">
          {a.trust.unknowns.map((u, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-400">
              <span className="text-warn">&middot;</span>
              {u}
            </li>
          ))}
          {a.trust.unknowns.length === 0 && (
            <li className="text-xs text-ink-500">
              Nothing material. Every driving figure is calibrated or measured.
            </li>
          )}
        </ul>

        {!a.trust.calibrated && (
          <Callout tone="warn" title="This report is uncalibrated">
            <p>
              Turns per outcome and failure rate are rubric priors, not measurements. They are the two
              numbers that move the cost figure most, so treat the monthly run cost as an order of
              magnitude rather than a budget line. Pointing this app at a running ARK Control instance
              replaces them with your own observed values and re-labels the figures{' '}
              <span className="font-mono text-good">measured</span>.
            </p>
          </Callout>
        )}
      </Panel>

      <section className="flex flex-wrap items-center gap-3 border-t border-ink-800 pt-6">
        <Link
          href="/assess"
          className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-ink-100 transition hover:border-ink-500 hover:bg-ink-800"
        >
          Assess another workload
        </Link>
        <a
          href={process.env.ARK_CONTROL_URL ?? 'http://localhost:3002'}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-signal-glow"
        >
          Open ARK Control
        </a>
        <Link href="/methodology" className="px-2 py-2 text-sm text-ink-400 transition hover:text-ink-200">
          How this was scored
        </Link>
      </section>
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className={'mt-1 font-mono text-lg ' + (tone ? toneText(tone) : 'text-ink-100')}>{value}</p>
    </div>
  );
}

function Route({ label, id, name, note }: { label: string; id: string; name: string; note: string }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-4">
      <p className="text-2xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-sm text-ink-100">{name}</p>
      <p className="font-mono text-2xs text-ink-600">{id}</p>
      <p className="mt-2 text-2xs leading-relaxed text-ink-500">{note}</p>
    </div>
  );
}

function toneText(t: Tone): string {
  return {
    neutral: 'text-ink-100', good: 'text-good', warn: 'text-warn',
    danger: 'text-danger', info: 'text-info', signal: 'text-signal',
  }[t];
}
