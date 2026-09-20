import Link from 'next/link';
import { protocolSummary, recentEvidence, type ProtocolRollup, type EvidenceRow } from '@ark/db';
import { PROTOCOL_LABELS, PROTOCOL_DESCRIPTIONS, PROTOCOL_SPEC_VERSIONS } from '@ark/protocols';
import { Panel, Grid, Stat, Badge, Table, Td, Callout, fmt, type Tone } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';

export const dynamic = 'force-dynamic';

/** Rendered in this order whether or not the org speaks them, so a protocol
 *  nobody has instrumented reads as "silent" rather than as "does not exist". */
const ORDER = ['mcp', 'a2a', 'ag-ui', 'a2ui', 'ucp', 'ap2'] as const;

export default async function Protocols() {
  const { orgId } = await requireOrg();
  const [summary, evidence] = await Promise.all([
    protocolSummary(orgId, WINDOW_DAYS),
    recentEvidence(orgId, 40, WINDOW_DAYS),
  ]);

  if (summary.total === 0) return <Empty />;

  const byProtocol = new Map(summary.byProtocol.map((p) => [p.protocol, p]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-100">Protocols</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
            Last {WINDOW_DAYS} days &middot; {fmt.int(summary.total)} normalised observations from the
            protocols your agents speak. ARK records what happened — which tool, which agent, which
            approval, how much money — and never the arguments, the message bodies or the credentials.
          </p>
        </div>
        {summary.missingApprovals > 0 && (
          <Badge tone="danger">
            {summary.missingApprovals} missing {summary.missingApprovals === 1 ? 'approval' : 'approvals'}
          </Badge>
        )}
      </header>

      <Grid cols={4}>
        <Stat
          label="Protocol events"
          value={fmt.int(summary.total)}
          hint={`${byProtocol.size === ORDER.length ? 'All six' : `${byProtocol.size} of six`} protocols active. Each observation is one thing an agent did over a protocol.`}
        />
        <Stat
          label="Blocked or denied"
          value={fmt.int(summary.blockedOrDenied)}
          tone={summary.blockedOrDenied > 0 ? 'warn' : 'good'}
          hint="Operations a policy, a peer or a human refused. These are the control plane working, not failing."
        />
        <Stat
          label="Missing approvals"
          value={fmt.int(summary.missingApprovals)}
          tone={summary.missingApprovals > 0 ? 'danger' : 'good'}
          hint={`Of ${fmt.int(summary.approvalsRequired)} operations that required a human signature, this many completed without one.`}
        />
        <Stat
          label="Value acted on"
          value={fmt.usd(summary.valueUsd, 2)}
          tone="signal"
          hint={
            'Counted once per unit of work: a checkout, its mandate and its receipt are three observations of one amount.' +
            (summary.nonUsdEvents > 0
              ? ` USD only — ${fmt.int(summary.nonUsdEvents)} ${summary.nonUsdEvents === 1 ? 'observation was' : 'observations were'} in another currency and ${summary.nonUsdEvents === 1 ? 'is' : 'are'} excluded rather than converted at a rate nobody chose.`
              : '')
          }
        />
      </Grid>

      {summary.missingApprovals > 0 && (
        <Callout tone="danger" title="Operations completed with nobody accountable">
          {fmt.int(summary.missingApprovals)}{' '}
          {summary.missingApprovals === 1 ? 'operation' : 'operations'} that required a human signature ran to
          completion without one. An approval still pending is not counted here — this is work that already
          happened.{' '}
          <Link href="/budgets" className="text-signal underline underline-offset-2">
            See the approval_missing alerts
          </Link>
          .
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((p) => (
          <ProtocolCard key={p} protocol={p} rollup={byProtocol.get(p) ?? null} />
        ))}
      </div>

      <Panel
        title="Recent evidence"
        subtitle="One row per normalised observation. Nothing here is a payload — every field is a name, a reference, a count or an amount."
        right={<span className="font-mono">{fmt.int(evidence.length)} shown</span>}
      >
        <Table head={['Protocol', 'Operation', 'Actor → Target', 'Outcome', 'Approval', 'Value', 'Time']}>
          {evidence.map((e) => (
            <EvidenceTr key={e.id} e={e} />
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function ProtocolCard({ protocol, rollup }: { protocol: keyof typeof PROTOCOL_LABELS; rollup: ProtocolRollup | null }) {
  const label = PROTOCOL_LABELS[protocol];
  const description = PROTOCOL_DESCRIPTIONS[protocol];
  const builtAgainst = PROTOCOL_SPEC_VERSIONS[protocol];

  if (!rollup) {
    return (
      <div className="rounded-xl border border-dashed border-ink-700 bg-ink-850/40 px-5 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-sm font-semibold text-ink-400">{label}</span>
          <span className="text-2xs text-ink-600">silent</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{description}</p>
        <p className="mt-2.5 border-t border-ink-800 pt-2.5 font-mono text-2xs text-ink-600">
          adapter built against spec {builtAgainst}
        </p>
      </div>
    );
  }

  const trouble = rollup.missingApprovals > 0 ? 'danger' : rollup.errors + rollup.blocked > 0 ? 'warn' : 'good';

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-5 py-4 shadow-panel">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-ink-100">{label}</span>
        <Badge tone={trouble as Tone}>{fmt.int(rollup.events)} events</Badge>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{description}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
        <Cell term="Operations" value={fmt.int(rollup.operations)} />
        <Cell term="Median latency" value={rollup.medianLatencyMs > 0 ? `${fmt.int(rollup.medianLatencyMs)} ms` : '—'} />
        <Cell term="Errors" value={fmt.int(rollup.errors)} tone={rollup.errors > 0 ? 'warn' : undefined} />
        <Cell term="Blocked" value={fmt.int(rollup.blocked)} tone={rollup.blocked > 0 ? 'warn' : undefined} />
        <Cell term="Approvals required" value={fmt.int(rollup.approvalsRequired)} />
        <Cell
          term="Missing approvals"
          value={fmt.int(rollup.missingApprovals)}
          tone={rollup.missingApprovals > 0 ? 'danger' : undefined}
        />
        <Cell term="Value seen here" value={rollup.valueUsd > 0 ? fmt.usd(rollup.valueUsd, 2) : '—'} />
        <Cell term="Pending" value={fmt.int(rollup.pending)} />
      </dl>

      <p className="mt-2.5 border-t border-ink-800 pt-2.5 font-mono text-2xs text-ink-600">
        {rollup.protocolVersion ? `observed ${rollup.protocolVersion}` : 'version not declared'} &middot; adapter{' '}
        {builtAgainst} &middot; last {fmt.when(rollup.lastSeen)}
      </p>
    </div>
  );
}

function Cell({ term, value, tone }: { term: string; value: string; tone?: Tone }) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-200';
  return (
    <>
      <dt className="text-ink-500">{term}</dt>
      <dd className={`text-right font-mono tabular-nums ${colour}`}>{value}</dd>
    </>
  );
}

const OUTCOME_TONE: Record<string, Tone> = {
  ok: 'good',
  approved: 'good',
  pending: 'info',
  error: 'danger',
  blocked: 'warn',
  denied: 'warn',
};

function EvidenceTr({ e }: { e: EvidenceRow }) {
  const label = PROTOCOL_LABELS[e.protocol as keyof typeof PROTOCOL_LABELS] ?? e.protocol.toUpperCase();
  const missing = e.requiredApproval && !e.approvedBy && (e.outcome === 'ok' || e.outcome === 'approved');

  return (
    <tr className="hover:bg-ink-800/40">
      <Td align="left">
        <span className="font-mono text-2xs text-ink-300">{label}</span>
        <span className="ml-2 text-2xs text-ink-600">{e.kind}</span>
      </Td>
      <Td align="left">
        <span className="font-mono text-xs text-ink-100">{e.operation}</span>
        {e.evidenceRef && <span className="ml-2 font-mono text-2xs text-ink-600">{e.evidenceRef}</span>}
      </Td>
      <Td align="left">
        {e.actor || e.target ? (
          <span className="font-mono text-2xs text-ink-300">
            {e.actor ?? '—'} <span className="text-ink-600">→</span> {e.target ?? '—'}
          </span>
        ) : (
          <span className="text-2xs text-ink-600">—</span>
        )}
      </Td>
      <Td>
        <Badge tone={OUTCOME_TONE[e.outcome] ?? 'neutral'}>{e.outcome}</Badge>
        {e.latencyMs != null && <span className="ml-2 font-mono text-2xs text-ink-600">{fmt.int(e.latencyMs)}ms</span>}
      </Td>
      <Td>
        {!e.requiredApproval ? (
          <span className="text-2xs text-ink-600">not required</span>
        ) : missing ? (
          <Badge tone="danger">missing</Badge>
        ) : e.approvedBy ? (
          <span className="font-mono text-2xs text-good">{e.approvedBy}</span>
        ) : (
          <span className="text-2xs text-ink-400">awaiting</span>
        )}
      </Td>
      <Td mono>
        {e.valueUsd != null ? (
          fmt.usd(e.valueUsd, 2)
        ) : e.currency ? (
          <span className="text-ink-500" title="Observed in this currency and left in it. Converting at ingest would turn an observation into an estimate.">
            {typeof e.metadata.amount === 'number' ? `${fmt.int(e.metadata.amount)} ` : ''}
            {e.currency}
          </span>
        ) : (
          <span className="text-ink-600">—</span>
        )}
      </Td>
      <Td mono className="text-ink-500">
        {fmt.when(e.ts)}
      </Td>
    </tr>
  );
}

function Empty() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Protocols</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          Evidence from the protocols your agents speak to each other and to their surfaces.
        </p>
      </header>

      <Panel title="No protocol evidence yet">
        <p className="text-sm leading-relaxed text-ink-300">
          This organisation has model telemetry but no protocol observations. Normalise them with{' '}
          <code className="font-mono text-signal">@ark/protocols</code> and record them on the trace they
          happened in:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-4 font-mono text-2xs leading-relaxed text-ink-300">
{`import { mcpEvidence } from '@ark/protocols';

const trace = ark.trace('wl_support_triage');
trace.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5' });
trace.evidence(mcpEvidence({
  method: 'tools/call', name: 'search_customer',
  client: 'support-agent', server: 'crm-mcp', latencyMs: 84,
}));
await trace.close('success');`}
        </pre>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">
          The adapters build their output from an allowlist of safe fields, so the tool arguments, the message
          bodies and the payment credentials have no path into this database — see{' '}
          <code className="font-mono text-signal">docs/07-protocol-evidence.md</code>. To see the six protocols
          with seeded data, run <code className="font-mono text-signal">npm run db:seed</code>.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((p) => (
          <ProtocolCard key={p} protocol={p} rollup={null} />
        ))}
      </div>
    </div>
  );
}
