import { budgetStatus, recentAlerts, actionAudit } from '@ark/db';
import { Panel, Badge, Meter, Table, Td, Callout, fmt, type Tone } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

const STATE_TONE: Record<string, Tone> = { ok: 'good', warn: 'warn', breached: 'danger' };

const ENFORCEMENT_MEANING: Record<string, string> = {
  observe: 'Records only. Nothing stops.',
  warn: 'Raises an alert. Calls continue.',
  throttle: 'Queues or downgrades to a cheaper model at the ceiling.',
  block: 'Refuses further calls for the period.',
};

export default async function Budgets() {
  const { orgId } = await requireOrg();
  const [budgets, alerts, actions] = await Promise.all([
    budgetStatus(orgId),
    recentAlerts(orgId, 40),
    actionAudit(orgId, WINDOW_DAYS),
  ]);

  const unapproved = actions.filter((a) => a.unapproved > 0);
  const observeOnly = budgets.filter((b) => b.enforcement === 'observe' || b.enforcement === 'warn');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Budgets &amp; alerts</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          A budget with no enforcement mode is a wish. Each ceiling below states what actually happens when it
          is reached.
        </p>
      </header>

      {observeOnly.length > 0 && (
        <Callout tone="warn" title="Ceilings that do not stop anything">
          {observeOnly.length} of {budgets.length} budgets are set to observe or warn. They will tell you after
          the money is gone. Set at least the runaway-prone workloads to throttle or block.
        </Callout>
      )}

      <Panel title="Ceilings" subtitle="Projection is month-to-date spend extrapolated over the full month.">
        <div className="space-y-5">
          {budgets.map((b) => (
            <div key={b.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink-100">{b.label}</span>
                  <Badge tone="neutral">{b.scope}</Badge>
                  <Badge tone={STATE_TONE[b.state] ?? 'neutral'}>{b.state}</Badge>
                </div>
                <span className="font-mono text-xs text-ink-400">
                  {fmt.usd(b.spentUsd, 2)} / {fmt.usd(b.limitUsd, 2)} &middot; {fmt.pct(b.pct, 0)}
                </span>
              </div>
              <Meter
                pct={b.pct}
                tone={STATE_TONE[b.state] ?? 'neutral'}
                className="mt-2"
                markerPct={(b.projectedUsd / Math.max(b.limitUsd, 1e-9)) * 100}
              />
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-500">
                <span className="font-mono text-ink-400">{b.enforcement}</span> —{' '}
                {ENFORCEMENT_MEANING[b.enforcement] ?? ''} Projected{' '}
                <span className={b.projectedUsd > b.limitUsd ? 'font-mono text-danger' : 'font-mono text-ink-400'}>
                  {fmt.usd(b.projectedUsd, 2)}
                </span>{' '}
                by month end (tick mark).
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {unapproved.length > 0 && (
        <Panel
          title="Actions taken without the approval they required"
          subtitle="SEC-05. This is the finding that ends a pilot, and it is invisible in a cost report."
        >
          <Table head={['Action', 'System', 'Blast radius', 'Executed', 'Unapproved', 'Value moved']}>
            {unapproved.map((a) => (
              <tr key={`${a.name}-${a.system}`}>
                <Td align="left" className="text-ink-100">{a.name}</Td>
                <Td align="left"><span className="font-mono text-2xs text-ink-300">{a.system}</span></Td>
                <Td align="left">
                  <Badge tone={a.blastRadius === 'irreversible' ? 'danger' : a.blastRadius === 'costly' ? 'warn' : 'neutral'}>
                    {a.blastRadius}
                  </Badge>
                </Td>
                <Td mono>{fmt.int(a.count)}</Td>
                <Td mono className="text-danger">{fmt.int(a.unapproved)}</Td>
                <Td mono>{a.valueUsd ? fmt.usd(a.valueUsd, 2) : '—'}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel title="Alert log" subtitle={`${alerts.length} most recent.`}>
        <Table head={['When', 'Kind', 'Severity', 'Workload', 'Message']}>
          {alerts.map((a) => (
            <tr key={a.id}>
              <Td align="left"><span className="whitespace-nowrap font-mono text-2xs text-ink-500">{fmt.when(a.ts)}</span></Td>
              <Td align="left"><span className="font-mono text-2xs text-ink-300">{a.kind}</span></Td>
              <Td align="left">
                <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warn' ? 'warn' : 'neutral'}>
                  {a.severity}
                </Badge>
              </Td>
              <Td align="left" className="text-xs text-ink-400">{a.workloadName ?? '—'}</Td>
              <Td align="left" className="max-w-xl text-xs leading-relaxed text-ink-200">{a.message}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
