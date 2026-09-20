import Link from 'next/link';
import { spendSummary, wasteBreakdown, recentAlerts, qualityByWorkload } from '@ark/db';
import { Panel, Grid, Stat, Badge, Table, Td, Sparkline, Callout, Meter, fmt } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const { orgId } = await requireOrg();
  const [spend, waste, alerts, quality] = await Promise.all([
    spendSummary(orgId, WINDOW_DAYS),
    wasteBreakdown(orgId, WINDOW_DAYS),
    recentAlerts(orgId, 8),
    qualityByWorkload(orgId, WINDOW_DAYS),
  ]);

  if (spend.traces === 0) return <Empty />;

  const qualityBy = new Map(quality.map((q) => [q.workloadId, q]));
  const critical = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-100">Spend</h1>
          <p className="mt-1 text-sm text-ink-400">
            Last {WINDOW_DAYS} days &middot; {fmt.int(spend.traces)} units of work &middot;{' '}
            {fmt.int(spend.byModel.reduce((s, m) => s + m.calls, 0))} model calls
          </p>
        </div>
        {critical > 0 && (
          <Badge tone="danger">
            {critical} critical {critical === 1 ? 'alert' : 'alerts'}
          </Badge>
        )}
      </header>

      <Grid cols={4}>
        <Stat
          label="Cost per successful outcome"
          value={fmt.usd(spend.costPerSuccessfulOutcomeUsd)}
          tone="signal"
          hint="Total spend divided by units of work that actually succeeded. Failed attempts and retries are in the numerator."
        />
        <Stat
          label="Total spend"
          value={fmt.usd(spend.totalUsd, 2)}
          hint={`Cost per call would read ${fmt.usd(
            spend.totalUsd / Math.max(1, spend.byModel.reduce((s, m) => s + m.calls, 0)),
          )} — a number that hides the loops.`}
        />
        <Stat
          label="Bought nothing"
          value={fmt.usd(waste.failedUsd + waste.escalatedUsd + waste.abandonedUsd, 2)}
          tone={spend.wastedPct > 12 ? 'danger' : spend.wastedPct > 6 ? 'warn' : 'good'}
          hint={`${fmt.pct(spend.wastedPct, 1)} of spend went to work that failed, escalated or was abandoned.`}
          footer={<Meter pct={spend.wastedPct} tone={spend.wastedPct > 12 ? 'danger' : 'warn'} />}
        />
        <Stat
          label="Success rate"
          value={fmt.pct((spend.successfulTraces / Math.max(1, spend.traces)) * 100, 1)}
          tone="neutral"
          hint={`${fmt.int(spend.traces - spend.successfulTraces)} of ${fmt.int(spend.traces)} units did not land.`}
        />
      </Grid>

      {waste.runawayTraces > 0 && (
        <Callout tone="danger" title="Runaway loops">
          {fmt.int(waste.runawayTraces)} traces ran more than three times the mean turn count and cost{' '}
          <span className="font-mono text-ink-100">{fmt.usd(waste.runawayUsd, 2)}</span> between them. Agent loops
          are the single largest source of surprise in an AI bill, and they are invisible on a per-call cost
          report. <Link href="/budgets" className="text-signal underline underline-offset-2">Set a turn ceiling</Link>.
        </Callout>
      )}

      <Panel
        title="Daily spend"
        subtitle="Watch for step changes, not slopes — they usually mean a prompt or model changed."
        right={<span className="font-mono">{fmt.usd(spend.daily.at(-1)?.costUsd ?? 0, 2)} today</span>}
      >
        <Sparkline points={spend.daily.map((d) => d.costUsd)} height={72} />
        <div className="mt-2 flex justify-between font-mono text-2xs text-ink-500">
          <span>{spend.daily[0]?.day}</span>
          <span>{spend.daily.at(-1)?.day}</span>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel
          title="By workload"
          subtitle="Cost per outcome is the comparable number. Total spend is not."
          className="lg:col-span-2"
        >
          <Table head={['Workload', 'Spend', 'Units', 'Per outcome', 'Success', 'Accuracy']}>
            {spend.byWorkload.map((w) => {
              const q = qualityBy.get(w.workloadId);
              return (
                <tr key={w.workloadId} className="hover:bg-ink-800/40">
                  <Td align="left">
                    <Link href={`/workloads/${w.workloadId}`} className="text-ink-100 hover:text-signal">
                      {w.name}
                    </Link>
                  </Td>
                  <Td mono>{fmt.usd(w.costUsd, 2)}</Td>
                  <Td mono>{fmt.int(w.traces)}</Td>
                  <Td mono className="text-ink-100">{fmt.usd(w.costPerOutcome)}</Td>
                  <Td mono>
                    <span className={w.successRate < 0.9 ? 'text-warn' : 'text-ink-300'}>
                      {fmt.pct(w.successRate * 100, 1)}
                    </span>
                  </Td>
                  <Td mono>
                    {q ? (
                      <span className={q.accuracy < 0.9 ? 'text-warn' : 'text-ink-300'}>
                        {fmt.pct(q.accuracy * 100, 1)}
                        <span className="ml-1 text-ink-500">n={q.sampleSize}</span>
                      </span>
                    ) : (
                      <span className="text-ink-600">unsampled</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-2xs leading-relaxed text-ink-500">
            A workload with no accuracy column is one where cost is known and quality is not. Those are the
            dangerous ones — you can optimise them to zero and never notice the output got worse.
          </p>
        </Panel>

        <div className="space-y-6">
          <Panel title="By model" subtitle="Share of spend, not share of calls.">
            <ul className="space-y-3">
              {spend.byModel.slice(0, 6).map((m) => (
                <li key={m.modelId}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-xs text-ink-200">{m.modelId}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-400">{fmt.pct(m.share, 1)}</span>
                  </div>
                  <Meter pct={m.share} className="mt-1.5" tone={m.share > 40 ? 'warn' : 'signal'} />
                  <p className="mt-1 font-mono text-2xs text-ink-500">
                    {fmt.usd(m.costUsd, 2)} &middot; {fmt.int(m.calls)} calls
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Recent alerts" right={<Link href="/budgets" className="hover:text-ink-200">All →</Link>}>
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span
                    className={
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' +
                      (a.severity === 'critical' ? 'bg-danger' : a.severity === 'warn' ? 'bg-warn' : 'bg-ink-500')
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-xs leading-relaxed text-ink-200">{a.message}</p>
                    <p className="mt-0.5 font-mono text-2xs text-ink-500">
                      {a.kind} &middot; {fmt.when(a.ts)}
                      {a.workloadName ? ` · ${a.workloadName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
              {alerts.length === 0 && <p className="text-sm text-ink-500">Nothing to report.</p>}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <Panel
      title="No telemetry yet"
      right={
        <Link href="/start" className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-ink-950">
          Connect a workload
        </Link>
      }
    >
      <p className="text-sm leading-relaxed text-ink-300">
        This organisation has no traces yet. The fastest path is to wrap the client you already have —{' '}
        <Link href="/start" className="text-signal underline underline-offset-2">Connect</Link>
        {' '}shows the five-minute snippet using{' '}
        <code className="font-mono text-signal">instrumentFetch</code> and{' '}
        <code className="font-mono text-signal">run()</code>.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-400">
        The first-party path is still MY AI for teams{' '}
        <code className="font-mono text-signal">POST /api/measure</code> on port 3001, pointed at this
        Control with <code className="font-mono text-signal">ARK_CONTROL_URL</code> and{' '}
        <code className="font-mono text-signal">ARK_CONTROL_TOKEN</code> (set in the environment, never
        pasted into this page). Until a pattern clears 30 traces, MY AI for teams keeps labelling cost
        figures <span className="font-mono text-warn">heuristic</span>. That is the correct behaviour, not
        a bug.
      </p>
    </Panel>
  );
}
