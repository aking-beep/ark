import Link from 'next/link';
import {
  assess,
  fetchCalibration,
  byId,
  shapesDecideNotAi,
  PATTERN_LABEL,
  GOLDEN_SET_RULE,
  type Estimate,
  type Verdict,
} from '@ark/core';
import {
  Panel, Grid, Stat, Badge, BasisTag, Callout, CardTable, DimensionList, fmt, toneFor, type Tone,
} from '@ark/ui';
import { decodeWorkload } from '@/lib/encode';
import { MeasureSample } from '@/components/measure-sample';
import { ReportFooter, ReportPrintStyles, intakeHref } from '@/components/report-footer';
import { VerdictOnlyReport } from '@/components/report-verdict-only';

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

const RISK_SOURCE =
  'ARK security rubric — scored from the data classes, write actions, blast radius and autonomy you described';
const ROADMAP_SOURCE = 'ARK roadmap rubric — phase durations are rules of thumb, not a delivery plan';

export default async function Report({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; scope?: string }>;
}) {
  const { w: encoded, scope } = await searchParams;
  const workload = encoded ? decodeWorkload(encoded) : null;

  if (!workload || !encoded) {
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

  // `scope=verdict` is the intake's short-circuit: every answer after the
  // shapes is a placeholder. Any other value is treated as absent.
  if (scope === 'verdict') {
    if (!shapesDecideNotAi(workload.task)) {
      return (
        <Panel title="This link asks for a verdict the shapes cannot decide">
          <p className="text-sm leading-relaxed text-ink-300">
            A verdict-only report exists for work that is only lookup and calculation. This job includes
            other shapes, so its verdict depends on answers the link does not carry.{' '}
            <Link href={intakeHref(encoded, 1)} className="text-signal underline underline-offset-2">
              Continue the full assessment
            </Link>
            .
          </p>
        </Panel>
      );
    }
    return (
      <>
        <ReportPrintStyles />
        <VerdictOnlyReport workload={workload} encoded={encoded} />
      </>
    );
  }

  // Measured priors where a Control instance is reachable; rubric priors where
  // it is not. Either way the basis tag on every figure says which happened.
  const calibration = await fetchCalibration({ days: 30 });
  const a = assess(workload, { depth: 'business', calibration });
  const controlConfigured = Boolean(process.env.ARK_CONTROL_URL?.trim() && process.env.ARK_CONTROL_TOKEN?.trim());

  const notAi = a.suitability.verdict === 'not-ai';
  const v = VERDICT[a.suitability.verdict];
  const model = a.model ? byId(a.model.primary.id) : undefined;
  const unit = workload.volume.unitLabel;
  const units = plural(unit);
  const controlUrl = process.env.ARK_CONTROL_URL ?? 'http://localhost:3002';
  const shape = a.callShape;
  const paybackWouldBe: Tone = !a.value.paybackMonths ? 'neutral'
    : a.value.paybackMonths.value <= 12 ? 'good'
    : a.value.paybackMonths.value <= 24 ? 'warn' : 'danger';

  return (
    <div className="space-y-10">
      <ReportPrintStyles />
      {/* ---------------------------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-400">{workload.name}</p>
          <Badge tone="neutral" title="Your input">{fmt.int(workload.volume.unitsPerMonth)} {units}/mo</Badge>
          <Badge tone="neutral" title={RISK_SOURCE}>{a.security.level} risk</Badge>
          {!notAi && (a.trust.calibrated ? (
            <Badge tone="good">calibrated against telemetry</Badge>
          ) : (
            <Badge tone="warn">uncalibrated</Badge>
          ))}
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
                <span className="text-danger" aria-hidden>&middot;</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {!notAi && !a.trust.calibrated && (
        <Callout tone="warn" title="This report is uncalibrated">
          <p>
            Treat the run cost as an order of magnitude, not a budget line: turns per outcome and failure
            rate are rubric priors until ARK Control has measured this pattern.
          </p>
          <details className="mt-3 text-xs leading-relaxed text-ink-400">
            <summary className="cursor-pointer text-ink-300 hover:text-ink-100">
              For the operator: connect ARK Control
            </summary>
            <p className="mt-2">
              {controlConfigured && !calibration ? (
                <>
                  <span className="font-mono text-ink-200">ARK_CONTROL_URL</span> is set, but ARK Control did not
                  answer the calibration request, so the rubric prior stands. Check that Control is reachable
                  from this app and that <span className="font-mono text-ink-200">ARK_CONTROL_TOKEN</span> is an
                  active org token.
                </>
              ) : controlConfigured ? (
                <>
                  ARK Control is connected, but it has fewer than 30 observed outcomes for the{' '}
                  <span className="font-mono text-ink-200">{a.architecture.pattern}</span> pattern in the last
                  30 days, so the rubric prior stands.
                </>
              ) : (
                <>
                  Set <span className="font-mono text-ink-200">ARK_CONTROL_URL</span> and{' '}
                  <span className="font-mono text-ink-200">ARK_CONTROL_TOKEN</span> on this app so it can read{' '}
                  <span className="font-mono text-ink-200">GET /api/v1/calibration</span>. Reports then use
                  observed call shapes for any pattern with at least 30 traces in the last 30 days, and the tags
                  change from heuristic to calibrated.
                </>
              )}
            </p>
            <p className="mt-2">
              <span className="font-mono text-ink-200">POST /api/measure</span> on this app sends one synthetic
              Runtime sample on the model in <span className="font-mono text-ink-200">ARK_OLLAMA_MODEL</span>{' '}
              (not the catalog estimate) and posts the trace to Control. It is off unless{' '}
              <span className="font-mono text-ink-200">ARK_MEASURE_ENABLED=1</span>. It is not a gateway and does not sit in
              the path of production traffic. One sample does not clear the 30-trace floor; it is how Control
              stops being empty.
            </p>
          </details>
        </Callout>
      )}

      {!notAi && (
        <MeasureSample
          workload={workload}
          enabled={process.env.ARK_MEASURE_ENABLED?.trim() === '1'}
          controlUrl={controlUrl}
        />
      )}

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="The numbers"
        subtitle="Each carries a tag saying what it rests on. Read the tag before you quote the number."
      >
        {notAi ? (
          <Grid cols={3}>
            <Stat
              label="Run cost / month"
              value="≈ $0"
              hint="A deterministic implementation runs for approximately nothing: no model calls, only compute you already pay for."
              footer={<Tag e={a.cost.perMonth} />}
            />
            <Stat
              label="Build cost"
              value={fmt.compactUsd(a.buildCost.value)}
              hint="Engineering to first production traffic, at a loaded rate."
              footer={<Tag e={a.buildCost} />}
            />
            <Payback a={a} wouldBe={paybackWouldBe} />
          </Grid>
        ) : (
          <Grid cols={4}>
            <Stat
              label={`Run cost / ${unit}`}
              value={fmt.usd(a.cost.perUnit.value, 4)}
              hint="Cost per successful outcome — retries and failed attempts included."
              footer={<Tag e={a.cost.perUnit} />}
            />
            <Stat
              label="Run cost / month"
              value={fmt.usd(a.cost.perMonth.value, 2)}
              hint={`At ${fmt.int(workload.volume.unitsPerMonth)} ${units}/mo (your input).`}
              footer={<Tag e={a.cost.perMonth} />}
            />
            <Stat
              label="Build cost"
              value={fmt.compactUsd(a.buildCost.value)}
              hint="Engineering to first production traffic, at a loaded rate."
              footer={<Tag e={a.buildCost} />}
            />
            <Payback a={a} wouldBe={paybackWouldBe} />
          </Grid>
        )}

        <div className="mt-6 border-t border-ink-700 pt-5">
          <p className="text-xs leading-relaxed text-ink-400">{a.trust.caveat}</p>
        </div>

        {a.cost.wastedOnFailures.value > 0 && (
          <div className="mt-5">
            <Callout tone="warn" title="What the failure rate costs">
              <p>
                About <span className="font-mono text-ink-100">{fmt.usd(a.cost.wastedOnFailures.value, 2)}</span>{' '}
                a month — {fmt.pct((a.cost.wastedOnFailures.value / Math.max(a.cost.perMonth.value, 1e-9)) * 100)} of
                run cost — is spent on attempts that fail and get retried. This is real spend that produces
                nothing, and it is the line item every per-token calculator omits.{' '}
                <Tag e={a.cost.wastedOnFailures} />
              </p>
            </Callout>
          </div>
        )}

        {a.value.humanCostPerUnit && a.value.netPerMonth && (
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            <Line label={`Human cost / ${unit}`} value={fmt.usd(a.value.humanCostPerUnit.value, 3)} e={a.value.humanCostPerUnit} />
            <Line
              label={notAi ? `Run cost / ${unit}` : `AI cost / ${unit}`}
              value={notAi ? '≈ $0' : fmt.usd(a.value.aiCostPerUnit.value, 4)}
              e={a.value.aiCostPerUnit}
            />
            <Line
              label="Net / month"
              value={fmt.usd(a.value.netPerMonth.value, 0)}
              e={a.value.netPerMonth}
              tone={toneFor(a.value.netPerMonth, a.value.netPerMonth.value > 0 ? 'good' : 'danger')}
            />
          </div>
        )}

        {a.value.spendPerDollarOfValue && (
          <p className="mt-5 text-xs leading-relaxed text-ink-400">
            Inference spend per dollar of value produced:{' '}
            <span className="font-mono text-ink-100">
              {fmt.usd(a.value.spendPerDollarOfValue.value, 3)}
            </span>{' '}
            <Tag e={a.value.spendPerDollarOfValue} />. This is the ratio to watch after launch — it degrades
            quietly when prompts grow, when context accumulates, and when someone swaps in a bigger model to
            fix a quality complaint.
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
          <span className="font-mono text-2xs text-ink-500">{a.architecture.pattern}</span>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-300">{a.architecture.summary}</p>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">Components</h3>
            <ul className="mt-2.5 space-y-1.5">
              {a.architecture.components.map((c, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="text-ink-500" aria-hidden>&middot;</span>
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
                  <p className="font-mono text-2xs text-ink-400">
                    {PATTERN_LABEL[r.pattern] ?? r.pattern}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{r.why}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {!notAi && (
          <div className="mt-6 border-t border-ink-700 pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">
                Call shape behind the cost
              </h3>
              <BasisTag basis={shape.basis} source={shape.source} sampleSize={shape.sampleSize} />
            </div>
            <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-400">
              These five numbers drive the entire cost figure. Two of them — turns per outcome and failure
              rate — are where estimates go wrong by an order of magnitude, and neither can be known before
              the system runs.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Turns / outcome" value={shape.turnsPerOutcome.toFixed(1)} />
              <Stat label="Context growth / turn" value={fmt.int(shape.contextGrowthPerTurn)} unit="tok" />
              <Stat label="Failure rate" value={fmt.pct(shape.failureRate * 100, 1)} />
              <Stat label="Retries / failure" value={shape.retriesPerFailure.toFixed(1)} />
              <Stat label="Cache hit rate" value={fmt.pct(shape.cacheHitRate * 100)} />
            </div>
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {a.model && (
        <Panel title="Model" subtitle="A shortlist across providers, so the default is not lock-in.">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-2xs uppercase tracking-wider text-ink-400">Primary</p>
              <p className="mt-1 text-lg text-ink-100">{model?.displayName ?? a.model.primary.id}</p>
              <p className="font-mono text-2xs text-ink-500">{a.model.primary.id}</p>
              {model && (
                <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-2xs text-ink-400">
                  <span>
                    {fmt.usd(model.inputPer1M, 2)} in / {fmt.usd(model.outputPer1M, 2)} out per 1M tokens
                  </span>
                  <BasisTag basis="benchmark" source={`published list price, captured ${model.asOf}`} />
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
                        title={`${m.provider} · ${fmt.usd(m.inputPer1M, 2)} in / ${fmt.usd(m.outputPer1M, 2)} out per 1M tokens (list price)`}
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
      )}

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="Security controls"
        subtitle="Derived from the data classes and the action surface you described — not a generic checklist."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{a.security.level}</Badge>
          <span className="font-mono text-2xs text-ink-400">risk score {Math.round(a.security.score)}/100</span>
          <BasisTag basis="heuristic" source={RISK_SOURCE} />
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
          <CardTable
            columns={[
              { label: 'Control', mono: true },
              { label: 'Requirement', align: 'left', className: 'pr-4' },
              { label: 'Why', align: 'left', className: 'pr-4' },
              { label: notAi ? 'How it is verified' : 'How ARK Control verifies it at runtime', align: 'left' },
            ]}
            rows={a.security.controls.map((c) => ({
              key: c.id,
              cells: [
                <span key="id" className={c.blocking ? 'font-mono text-danger' : 'font-mono text-ink-400'}>{c.id}</span>,
                <span key="req">
                  <span className="text-ink-200">{c.requirement}</span>
                  {c.blocking && (
                    <span className="ml-2 whitespace-nowrap rounded bg-danger/15 px-1.5 py-0.5 text-2xs text-danger">
                      blocks launch
                    </span>
                  )}
                </span>,
                <span key="why" className="text-xs leading-relaxed text-ink-400">{c.why}</span>,
                <span key="how" className="text-xs leading-relaxed text-ink-400">{c.verifiedBy}</span>,
              ],
            }))}
          />
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            The last column is the point. A control nobody can verify after launch is a paragraph in a
            document, and paragraphs do not stop anything.
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel
        title={a.evaluation.kind === 'deterministic' ? 'Test plan' : 'Evaluation plan'}
        subtitle={a.evaluation.kind === 'deterministic'
          ? 'A rule has a right answer, so it is tested like code. There is no golden set to label.'
          : 'What has to be true before this is allowed to carry production traffic.'}
      >
        <Grid cols={3}>
          {a.evaluation.goldenSetSize !== null && (
            <Stat
              label="Golden set"
              value={fmt.int(a.evaluation.goldenSetSize)}
              unit="examples"
              hint="Labelled, held out, never trained or prompted against."
              footer={<BasisTag basis="heuristic" source={GOLDEN_SET_RULE} />}
            />
          )}
          <Stat label="Cadence" value={<span className="font-sans text-sm leading-snug">{a.evaluation.cadence}</span>} />
          <Stat
            label="Blocking metrics"
            value={fmt.int(a.evaluation.metrics.filter((m) => m.blocksLaunch).length)}
            unit={`of ${a.evaluation.metrics.length}`}
          />
        </Grid>

        <div className="mt-6">
          <CardTable
            columns={[
              { label: 'Metric', align: 'left', className: 'pr-4' },
              { label: 'Threshold', mono: true },
              { label: 'Measured how', align: 'left', className: 'px-4' },
              { label: '' },
            ]}
            rows={a.evaluation.metrics.map((m) => ({
              key: m.name,
              cells: [
                <span key="n" className="text-ink-200">{m.name}</span>,
                <span key="t" className="text-ink-100">{m.threshold}</span>,
                <span key="h" className="text-xs leading-relaxed text-ink-400">{m.measuredHow}</span>,
                m.blocksLaunch
                  ? <Badge key="b" tone="danger">blocks launch</Badge>
                  : <span key="b" className="text-2xs text-ink-400">monitored</span>,
              ],
            }))}
          />
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-ink-400">
            {a.evaluation.kind === 'deterministic' ? (
              <>
                <span>The latency budget is your input. The other thresholds are the rubric&apos;s defaults for a rules build:</span>
                <BasisTag basis="heuristic" source="ARK evaluation rubric — deterministic test plan" />
              </>
            ) : (
              <>
                <span>
                  Thresholds restate your error tolerance and latency budget (your input). Turning a tolerance
                  into a percentage is the rubric&apos;s step:
                </span>
                <BasisTag basis="heuristic" source="ARK evaluation rubric — tolerance none 99%, low 97%, medium 93%, high 85%" />
              </>
            )}
          </p>
        </div>

        <div className="mt-5">
          <Callout tone="info" title="The baseline nobody measures">
            <p>{a.evaluation.humanBaselineNote}</p>
          </Callout>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-400">
          <span className="text-ink-200">Regression policy.</span> {a.evaluation.regressionPolicy}
        </p>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel
        title="Roadmap"
        subtitle="Every phase has a kill criterion. A plan without one is a commitment device."
        right={<BasisTag basis="heuristic" source={ROADMAP_SOURCE} />}
      >
        <ol className="space-y-5">
          {a.phases.map((p, i) => (
            <li key={p.name} className="relative border-l border-ink-700 pl-6">
              <span className="absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-ink-700 bg-ink-900 font-mono text-[9px] text-ink-400">
                {i + 1}
              </span>
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="text-sm font-medium text-ink-100">{p.name}</h3>
                <span className="font-mono text-2xs text-ink-400">
                  about {p.durationWeeks} week{p.durationWeeks === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink-300">{p.goal}</p>
              <ul className="mt-2.5 space-y-1">
                {p.exitCriteria.map((e, n) => (
                  <li key={n} className="text-xs leading-relaxed text-ink-400">
                    &#10003; {e}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs leading-relaxed text-danger/90">
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

      <Panel
        title="How it scored"
        subtitle="Seven weighted dimensions. The weakest one usually decides the verdict."
        right={<Tag e={a.suitability.score} />}
      >
        <DimensionList dimensions={a.suitability.dimensions} showWeight />
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <Panel title="What this report does not know" subtitle="The section most tools like this leave out.">
        <ul className="space-y-2.5">
          {a.trust.unknowns.map((u, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-400">
              <span className="text-warn" aria-hidden>&middot;</span>
              {u}
            </li>
          ))}
          {a.trust.unknowns.length === 0 && (
            <li className="text-xs text-ink-400">
              Nothing material. Every driving figure is calibrated or measured.
            </li>
          )}
        </ul>
      </Panel>

      <ReportFooter edit={{ href: intakeHref(encoded), label: 'Edit answers' }} />
    </div>
  );
}

type Assessment = ReturnType<typeof assess>;

function Payback({ a, wouldBe }: { a: Assessment; wouldBe: Tone }) {
  const p = a.value.paybackMonths;
  return (
    <Stat
      label="Payback"
      value={p ? `${p.value.toFixed(1)} mo` : 'unknowable'}
      tone={toneFor(p, wouldBe)}
      hint={p ? 'Months to repay the build from run savings.' : 'You did not supply what this costs today.'}
      footer={p ? <Tag e={p} /> : undefined}
    />
  );
}

function Tag({ e }: { e: Estimate<unknown> }) {
  return <BasisTag basis={e.basis} source={e.source} sampleSize={e.sampleSize} />;
}

function Line({ label, value, e, tone }: { label: string; value: string; e: Estimate<unknown>; tone?: Tone }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className={'mt-1 font-mono text-lg ' + (tone ? toneText(tone) : 'text-ink-100')}>{value}</p>
      <div className="mt-1.5">
        <Tag e={e} />
      </div>
    </div>
  );
}

function Route({ label, id, name, note }: { label: string; id: string; name: string; note: string }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-4">
      <p className="text-2xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-sm text-ink-100">{name}</p>
      <p className="font-mono text-2xs text-ink-500">{id}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">{note}</p>
    </div>
  );
}

/** "query" → "queries", "ticket" → "tickets". English enough for a unit label. */
function plural(unit: string): string {
  if (/[^aeiou]y$/i.test(unit)) return unit.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/i.test(unit)) return unit + 'es';
  return unit + 's';
}

function toneText(t: Tone): string {
  return {
    neutral: 'text-ink-100', good: 'text-good', warn: 'text-warn',
    danger: 'text-danger', info: 'text-info', signal: 'text-signal',
  }[t];
}
