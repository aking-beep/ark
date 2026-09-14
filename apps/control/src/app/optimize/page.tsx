import Link from 'next/link';
import { substitutionOpportunities, spendSummary, wasteBreakdown } from '@ark/db';
import { Panel, Grid, Stat, Badge, BasisTag, Callout, Table, Td, fmt } from '@ark/ui';
import { byId } from '@ark/core';
import { ORG_ID, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function Optimize() {
  const [opps, spend, waste] = await Promise.all([
    substitutionOpportunities(ORG_ID, WINDOW_DAYS),
    spendSummary(ORG_ID, WINDOW_DAYS),
    wasteBreakdown(ORG_ID, WINDOW_DAYS),
  ]);

  // Only count the best option per workload, or the total double-counts.
  const best = new Map<string, (typeof opps)[number]>();
  for (const o of opps) if (!best.has(o.workloadId)) best.set(o.workloadId, o);
  const headline = [...best.values()].reduce((s, o) => s + o.monthlySavingUsd, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Optimise</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          Every row below is computed from the call shape this workload actually exhibits, not from a vendor
          benchmark. Each one states what you are trading away, because a cheaper model is a quality decision
          wearing a finance costume.
        </p>
      </header>

      <Grid cols={3}>
        <Stat
          label="Identified monthly saving"
          value={fmt.usd(headline, 2)}
          tone="signal"
          hint="Best single substitution per workload. Requires an eval to confirm quality holds."
        />
        <Stat
          label="Annualised"
          value={fmt.usd(headline * 12, 2)}
          hint="Straight-line. Assumes volume holds and prices do not move — both of which they will."
        />
        <Stat
          label="Recoverable waste"
          value={fmt.usd(waste.runawayUsd, 2)}
          tone={waste.runawayUsd > 0 ? 'warn' : 'neutral'}
          hint={`${fmt.int(waste.runawayTraces)} runaway traces. A turn ceiling recovers most of this without touching model choice.`}
        />
      </Grid>

      <Callout tone="warn" title="Read this before acting on any row">
        Model substitution is the easiest lever and the one most likely to quietly degrade output. Run the
        workload&apos;s eval set against the proposed model before switching, and keep sampling accuracy for two
        weeks after. A substitution that saves {fmt.usd(headline, 0)}/mo and drops accuracy three points is
        usually a loss, because the rework lands on a human.
      </Callout>

      <Panel title="Substitution opportunities" subtitle="Ordered by monthly saving.">
        {opps.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-400">
            No substitutions found. Either the routing is already tight, or there is not enough telemetry —
            Control needs at least 20 observed calls per workload before it will suggest anything.
          </p>
        ) : (
          <div className="space-y-4">
            {opps.map((o, i) => {
              const from = byId(o.fromModelId);
              const to = byId(o.toModelId);
              return (
                <div key={`${o.workloadId}-${o.toModelId}-${i}`} className="rounded-lg border border-ink-700 bg-ink-800/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/workloads/${o.workloadId}`} className="text-sm font-medium text-ink-100 hover:text-signal">
                        {o.workloadName}
                      </Link>
                      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-400">
                        <span>{from?.displayName ?? o.fromModelId}</span>
                        <span className="text-ink-600">→</span>
                        <span className="text-signal">{to?.displayName ?? o.toModelId}</span>
                        {to?.tier && <Badge tone="neutral">{to.tier}</Badge>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg text-good">−{fmt.usd(o.monthlySavingUsd, 2)}/mo</p>
                      <p className="font-mono text-2xs text-ink-500">
                        {fmt.usd(o.currentMonthlyUsd, 2)} → {fmt.usd(o.proposedMonthlyUsd, 2)} &middot;{' '}
                        {fmt.pct(o.savingPct, 0)} &middot; {fmt.usd(o.annualisedSavingUsd, 0)}/yr
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 border-t border-ink-700 pt-3 text-sm leading-relaxed text-ink-300">
                    <span className="text-ink-500">Trade-off: </span>
                    {o.risk}
                  </p>
                  <div className="mt-2.5">
                    <BasisTag
                      basis={o.confidence.basis}
                      source={o.confidence.source}
                      sampleSize={o.confidence.sampleSize}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Where the money went that bought nothing" subtitle={`Last ${WINDOW_DAYS} days.`}>
        <Table head={['Category', 'Cost', 'Share of spend', 'Lever']}>
          <WasteRow label="Failed outcomes" usd={waste.failedUsd} total={spend.totalUsd} lever="Eval and prompt work, or a stronger model on the hard slice only." />
          <WasteRow label="Escalated to a human" usd={waste.escalatedUsd} total={spend.totalUsd} lever="Not always waste — escalation can be the correct design. Compare against the human-only baseline." />
          <WasteRow label="Abandoned" usd={waste.abandonedUsd} total={spend.totalUsd} lever="Usually timeouts or user drop-off. Check latency before touching cost." />
          <WasteRow label="Runaway loops" usd={waste.runawayUsd} total={spend.totalUsd} lever="Hard turn ceiling plus a cost-per-trace circuit breaker. Cheapest fix on this page." />
        </Table>
      </Panel>
    </div>
  );
}

function WasteRow({ label, usd, total, lever }: { label: string; usd: number; total: number; lever: string }) {
  const pct = total > 0 ? (usd / total) * 100 : 0;
  return (
    <tr>
      <Td align="left">{label}</Td>
      <Td mono className="text-ink-100">{fmt.usd(usd, 2)}</Td>
      <Td mono className={pct > 10 ? 'text-warn' : 'text-ink-400'}>{fmt.pct(pct, 1)}</Td>
      <Td align="left" className="max-w-md text-xs leading-relaxed text-ink-400">{lever}</Td>
    </tr>
  );
}
