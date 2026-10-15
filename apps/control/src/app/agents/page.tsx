import Link from 'next/link';
import {
  listAgents,
  latestAssuranceByAgent,
  agentObservations,
  agentInfrastructureSummary,
} from '@ark/db';
import { Panel, Table, Td, Badge, fmt, type Tone } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';
import { shadowAgents } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, Tone> = {
  unknown: 'neutral',
  discovered: 'info',
  registered: 'signal',
  shadow: 'info',
  production: 'good',
  retired: 'neutral',
  pass: 'good',
  warn: 'warn',
  fail: 'danger',
};

export default async function AgentsPage() {
  const { orgId } = await requireOrg();
  const [agents, assurance, summary, shadows] = await Promise.all([
    listAgents(orgId),
    latestAssuranceByAgent(orgId),
    agentInfrastructureSummary(orgId),
    shadowAgents(orgId, WINDOW_DAYS),
  ]);

  const observations = await Promise.all(
    agents.map(async (a) => [a.id, await agentObservations(orgId, a.id, WINDOW_DAYS)] as const),
  );
  const obsBy = new Map(observations);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-100">Agents</h1>
          <p className="mt-1 text-sm text-ink-400">
            Registered Agent Manifests for this organisation. Discovery is on{' '}
            <Link href="/discover" className="text-signal underline underline-offset-2">
              Discover
            </Link>
            ; assurance is a check against the manifest, not a score.
          </p>
        </div>
        <Link
          href="/discover"
          className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-ink-950"
        >
          Discover a repository
        </Link>
      </header>

      <Panel>
        {agents.length === 0 ? (
          <p className="text-sm text-ink-400">
            No agents registered yet. {summary.registered === 0
              ? 'Start from a GitHub repository, or the bundled sample, on Discover.'
              : null}
          </p>
        ) : (
          <Table head={['Agent', 'Owner', 'Environment', 'Status', 'Risk', 'Models', 'Tools', 'MCP', 'Latest assurance', 'Observed']} align={['left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'left', 'right']}>
            {agents.map((a) => {
              const ass = assurance.get(a.id);
              const obs = obsBy.get(a.id);
              return (
                <tr key={a.id} className="hover:bg-ink-800/40">
                  <Td align="left">
                    <Link href={`/agents/${a.id}`} className="text-ink-100 hover:text-signal">
                      {a.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-2xs text-ink-500">{a.id}</p>
                  </Td>
                  <Td align="left">{a.owner ?? <span className="text-ink-500">unknown</span>}</Td>
                  <Td align="left">{a.environment}</Td>
                  <Td align="left">
                    <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
                  </Td>
                  <Td align="left">{a.riskLevel}</Td>
                  <Td mono>{fmt.int(a.manifest.models.length)}</Td>
                  <Td mono>{fmt.int(a.manifest.tools.length)}</Td>
                  <Td mono>{fmt.int(a.manifest.mcpServers.length)}</Td>
                  <Td align="left">
                    {ass ? (
                      <Badge tone={STATUS_TONE[ass.status] ?? 'neutral'}>{ass.status}</Badge>
                    ) : (
                      <span className="text-ink-500">not run</span>
                    )}
                  </Td>
                  <Td mono>
                    {obs && obs.calls > 0 ? `${fmt.int(obs.calls)} calls` : <span className="text-ink-500">none</span>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <Panel
        title="Observed, not registered"
        subtitle={`Seen acting in the last ${WINDOW_DAYS} days — on a model call or as the actor on a protocol observation — with no manifest. A repository scan cannot find these; runtime can.`}
      >
        {shadows.length === 0 ? (
          <p className="text-sm text-ink-400">
            Every agent seen in runtime is registered.
          </p>
        ) : (
          <Table head={['Agent id', 'Model calls', 'Protocol observations', 'Last seen']}>
            {shadows.map((x) => (
              <tr key={x.agentId}>
                <Td align="left">
                  <span className="font-mono text-ink-100">{x.agentId}</span>
                  <Badge tone="warn" className="ml-2">unregistered</Badge>
                </Td>
                <Td mono>{fmt.int(x.calls)}</Td>
                <Td mono>{fmt.int(x.protocolEvents)}</Td>
                <Td mono>{fmt.when(x.lastSeen)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {shadows.length > 0 && (
          <p className="mt-3 text-2xs leading-relaxed text-ink-400">
            Nobody owns these, so nothing checks them. Find the repository and register it from{' '}
            <Link href="/discover" className="text-signal underline underline-offset-2">Discover</Link>, or
            find out who is running it.
          </p>
        )}
      </Panel>
    </div>
  );
}
