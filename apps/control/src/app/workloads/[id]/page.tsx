import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listWorkloads, spendSummary, observedShape, actionAudit, qualityByWorkload } from '@ark/db';
import { Panel, Grid, Stat, Badge, BasisTag, Table, Td, Callout, fmt } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function WorkloadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireOrg();

  const [workloads, spend, shape, actions, quality] = await Promise.all([
    listWorkloads(orgId),
    spendSummary(orgId, WINDOW_DAYS),
    observedShape(orgId, id, WINDOW_DAYS),
    actionAudit(orgId, WINDOW_DAYS),
    qualityByWorkload(orgId, WINDOW_DAYS),
  ]);

  const w = workloads.find((x) => x.id === id);
  if (!w) notFound();

  const s = spend.byWorkload.find((x) => x.workloadId === id);
  const q = quality.find((x) => x.workloadId === id);
  const a = w.assessment as any | null;

  // The whole point of Control: what AIFit predicted against what happened.
  const predictedPerUnit: number | null = a?.cost?.perUnit?.value ?? null;
  const actualPerUnit = s?.costPerOutcome ?? null;
  const drift =
    predictedPerUnit != null && actualPerUnit != null && predictedPerUnit > 0
      ? ((actualPerUnit - predictedPerUnit) / predictedPerUnit) * 100
      : null;

  const predictedTurns: number | null = a?.architecture?.callShape?.turnsPerOutcome ?? null;
  const predictedFailure: number | null = a?.architecture?.callShape?.failureRate ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/workloads" className="text-2xs text-ink-500 hover:text-ink-300">
            ← Workloads
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-ink-100">{w.name}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-400">{w.spec?.description}</p>
        </div>
        <div className="flex gap-2">
          <Badge tone="info">{w.pattern}</Badge>
          <Badge>{w.status}</Badge>
        </div>
      </header>

      <Grid cols={4}>
        <Stat label="Spend" value={fmt.usd(s?.costUsd ?? 0, 2)} hint={`Last ${WINDOW_DAYS} days.`} />
        <Stat
          label="Cost per outcome"
          value={fmt.usd(actualPerUnit ?? 0)}
          tone="signal"
          footer={<BasisTag basis="measured" source="control-telemetry" sampleSize={shape.sampleSize} />}
        />
        <Stat
          label="Turns per outcome"
          value={shape.turnsPerOutcome.toFixed(1)}
          tone={predictedTurns != null && shape.turnsPerOutcome > predictedTurns * 1.5 ? 'warn' : 'neutral'}
          hint={predictedTurns != null ? `Assessment assumed ${predictedTurns.toFixed(1)}.` : undefined}
        />
        <Stat
          label="Failure rate"
          value={fmt.pct(shape.failureRate * 100, 1)}
          tone={shape.failureRate > 0.1 ? 'danger' : shape.failureRate > 0.05 ? 'warn' : 'good'}
          hint={predictedFailure != null ? `Assessment assumed ${fmt.pct(predictedFailure * 100, 1)}.` : undefined}
        />
      </Grid>

      {drift != null && (
        <Callout
          tone={Math.abs(drift) < 20 ? 'good' : Math.abs(drift) < 60 ? 'warn' : 'danger'}
          title={`Estimate drift: ${drift > 0 ? '+' : ''}${drift.toFixed(0)}%`}
        >
          AIFit estimated <span className="font-mono text-ink-100">{fmt.usd(predictedPerUnit!)}</span> per unit
          before this shipped. It is actually costing{' '}
          <span className="font-mono text-ink-100">{fmt.usd(actualPerUnit!)}</span>.{' '}
          {Math.abs(drift) < 20
            ? 'Close enough that the heuristic priors were doing their job.'
            : 'This gap is the reason the estimate carried a basis label. The observed shape now feeds back into the calibration set, so the next estimate for this pattern starts from measurement rather than a rule of thumb.'}
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Observed call shape" subtitle="What gets exported to AIFit as calibration.">
          <Table head={['Signal', 'Observed', 'Assumed']}>
            <Row label="Input tokens (first turn)" observed={fmt.int(shape.inputTokens)} assumed={w.spec?.input?.avgTokens ? fmt.int(w.spec.input.avgTokens) : '—'} />
            <Row label="Output tokens" observed={fmt.int(shape.outputTokens)} assumed={w.spec?.output?.avgTokens ? fmt.int(w.spec.output.avgTokens) : '—'} />
            <Row label="Cache hit rate" observed={fmt.pct(shape.cacheHitRate * 100, 1)} assumed={a?.architecture?.callShape?.cacheHitRate != null ? fmt.pct(a.architecture.callShape.cacheHitRate * 100, 1) : '—'} />
            <Row label="Context growth per turn" observed={`${fmt.int(shape.contextGrowthPerTurn)} tok`} assumed={a?.architecture?.callShape?.contextGrowthPerTurn != null ? `${fmt.int(a.architecture.callShape.contextGrowthPerTurn)} tok` : '—'} />
            <Row label="Turns per outcome" observed={shape.turnsPerOutcome.toFixed(2)} assumed={predictedTurns?.toFixed(2) ?? '—'} />
            <Row label="Failure rate" observed={fmt.pct(shape.failureRate * 100, 1)} assumed={predictedFailure != null ? fmt.pct(predictedFailure * 100, 1) : '—'} />
            <Row label="Retries per failure" observed={shape.retriesPerFailure.toFixed(2)} assumed={a?.architecture?.callShape?.retriesPerFailure?.toFixed(2) ?? '—'} />
          </Table>
          <p className="mt-3 text-2xs leading-relaxed text-ink-500">
            Sample size {fmt.int(shape.sampleSize)}. Calibration needs at least 30 traces per pattern before it
            overrides a prior; below that the estimate stays heuristic on purpose.
          </p>
        </Panel>

        <div className="space-y-6">
          <Panel title="Quality" subtitle="Cost without accuracy is half a number.">
            {q ? (
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-3xl text-ink-100">{fmt.pct(q.accuracy * 100, 1)}</span>
                <div className="text-xs leading-relaxed text-ink-400">
                  <p>{fmt.int(q.sampleSize)} human-judged samples in the window.</p>
                  <p className="mt-0.5">
                    Effective cost per <em>correct</em> outcome:{' '}
                    <span className="font-mono text-ink-200">
                      {fmt.usd((actualPerUnit ?? 0) / Math.max(0.01, q.accuracy))}
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-400">
                No quality samples. This workload&apos;s cost figures are trustworthy and its value figures are
                not — there is no evidence here that the output is correct.
              </p>
            )}
          </Panel>

          <Panel title="Actions taken" subtitle="What the system was allowed to do in the real world.">
            {actions.length ? (
              <Table head={['Action', 'System', 'Count', 'Unapproved']}>
                {actions.map((x) => (
                  <tr key={`${x.name}-${x.system}`}>
                    <Td align="left">
                      {x.name}
                      <span className="ml-2 font-mono text-2xs text-ink-500">{x.blastRadius}</span>
                    </Td>
                    <Td align="left"><span className="font-mono text-2xs text-ink-300">{x.system}</span></Td>
                    <Td mono>{fmt.int(x.count)}</Td>
                    <Td mono className={x.unapproved > 0 ? 'text-danger' : 'text-ink-500'}>
                      {fmt.int(x.unapproved)}
                    </Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-sm text-ink-400">This workload takes no actions. It only produces text.</p>
            )}
          </Panel>
        </div>
      </div>

      {a?.security?.controls?.length ? (
        <Panel
          title="Security controls"
          subtitle="Each control names how Control verifies it at runtime. A control nobody can verify is a paragraph."
        >
          <Table head={['ID', 'Requirement', 'Verified by', 'Blocking']}>
            {a.security.controls.map((c: any) => (
              <tr key={c.id}>
                <Td align="left"><span className="font-mono text-2xs text-ink-300">{c.id}</span></Td>
                <Td align="left" className="max-w-md">
                  {c.requirement}
                  <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">{c.why}</p>
                </Td>
                <Td align="left" className="max-w-xs text-xs text-ink-400">{c.verifiedBy}</Td>
                <Td>{c.blocking ? <Badge tone="danger">blocking</Badge> : <Badge>advisory</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
    </div>
  );
}

function Row({ label, observed, assumed }: { label: string; observed: string; assumed: string }) {
  return (
    <tr>
      <Td align="left">{label}</Td>
      <Td mono className="text-ink-100">{observed}</Td>
      <Td mono className="text-ink-500">{assumed}</Td>
    </tr>
  );
}
