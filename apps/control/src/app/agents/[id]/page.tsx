import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getAgent,
  latestAssuranceForAgent,
  agentObservations,
} from '@ark/db';
import { Panel, Grid, Stat, Badge, Table, Td, Callout, fmt, type Tone } from '@ark/ui';
import { requireOrg, WINDOW_DAYS } from '@/lib/org';
import { runAssuranceAction } from '../../discover/actions';
import { AgentGraph } from './graph';

export const dynamic = 'force-dynamic';

const TONE: Record<string, Tone> = {
  pass: 'good',
  warn: 'warn',
  fail: 'danger',
  unknown: 'neutral',
  production: 'good',
  registered: 'signal',
};

export default async function AgentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireOrg();
  const agent = await getAgent(orgId, decodeURIComponent(id));
  if (!agent) notFound();
  const [assurance, obs] = await Promise.all([
    latestAssuranceForAgent(orgId, agent.id),
    agentObservations(orgId, agent.id, WINDOW_DAYS),
  ]);
  const m = agent.manifest;
  const report = assurance?.report;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/agents" className="text-2xs text-ink-500 hover:text-ink-300">
            ← Agents
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-ink-100">{agent.name}</h1>
          <p className="mt-1 max-w-2xl font-mono text-xs text-ink-500">{agent.id}</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
            {m.purpose || m.description || 'Purpose unknown — not invented.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[agent.status] ?? 'neutral'}>{agent.status}</Badge>
          <Badge>{agent.environment}</Badge>
          <Badge tone={agent.riskLevel === 'high' || agent.riskLevel === 'critical' ? 'danger' : 'neutral'}>
            {agent.riskLevel}
          </Badge>
          <form action={runAssuranceAction}>
            <input type="hidden" name="agentId" value={agent.id} />
            <button type="submit" className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-ink-950">
              Run Assurance
            </button>
          </form>
        </div>
      </header>

      <Panel title="Infrastructure" subtitle="Drawn from the registered manifest. No invented edges.">
        <AgentGraph manifest={m} />
      </Panel>

      <Grid cols={4}>
        <Stat label="Owner" value={agent.owner ?? 'unknown'} hint="Unknown until someone records it." />
        <Stat label="Models" value={fmt.int(m.models.length)} />
        <Stat label="Tools / MCP" value={`${fmt.int(m.tools.length)} / ${fmt.int(m.mcpServers.length)}`} />
        <Stat
          label="Latest assurance"
          value={report?.overallStatus ?? 'not run'}
          tone={report ? TONE[report.overallStatus] : 'neutral'}
        />
      </Grid>

      <Section title="Overview">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <KV k="Team" v={m.team ?? 'unknown'} />
          <KV k="Status" v={agent.status} />
          <KV k="Environment" v={agent.environment} />
          <KV k="Risk" v={agent.riskLevel} />
        </dl>
      </Section>

      <Section title="Source">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <KV k="Repository" v={m.source?.repository ?? 'unknown'} />
          <KV k="Branch" v={m.source?.branch ?? 'unknown'} />
          <KV k="Commit" v={m.source?.commitSha ?? 'unknown'} />
          <KV k="Discovery method" v={m.source?.discoveryMethod ?? 'unknown'} />
        </dl>
      </Section>

      <Section title="Models">
        {m.models.length === 0 ? (
          <Unknown>No models recorded.</Unknown>
        ) : (
          <Table head={['Provider', 'Model', 'Purpose']}>
            {m.models.map((x) => (
              <tr key={`${x.provider}:${x.modelId}`}>
                <Td align="left">{x.provider}</Td>
                <Td align="left" mono>{x.modelId}</Td>
                <Td align="left">{x.purpose ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Tools">
        {m.tools.length === 0 ? (
          <Unknown>No tools recorded.</Unknown>
        ) : (
          <Table head={['Name', 'Type', 'Risk']}>
            {m.tools.map((t) => (
              <tr key={t.name}>
                <Td align="left">{t.name}</Td>
                <Td align="left">{t.type}</Td>
                <Td align="left">{t.riskLevel}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="MCP servers">
        {m.mcpServers.length === 0 ? (
          <Unknown>No MCP servers recorded.</Unknown>
        ) : (
          <Table head={['Name', 'Transport', 'Source']}>
            {m.mcpServers.map((s) => (
              <tr key={s.name}>
                <Td align="left">{s.name}</Td>
                <Td align="left">{s.transport}</Td>
                <Td align="left" mono>{s.source ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Integrations">
        {m.integrations.length === 0 ? (
          <Unknown>No integrations recorded.</Unknown>
        ) : (
          <Table head={['Name', 'Type', 'System', 'Direction']}>
            {m.integrations.map((i) => (
              <tr key={i.name}>
                <Td align="left">{i.name}</Td>
                <Td align="left">{i.type}</Td>
                <Td align="left">{i.system ?? '—'}</Td>
                <Td align="left">{i.direction}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Permissions">
        {m.permissions ? (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {(['read', 'write', 'execute', 'financial', 'destructive', 'wildcard'] as const).map((k) => (
              <KV key={k} k={k} v={m.permissions?.[k] === undefined ? 'unknown' : String(m.permissions[k])} />
            ))}
          </dl>
        ) : (
          <Unknown>Permissions were not recorded. They are not inferred.</Unknown>
        )}
      </Section>

      <Section title="Data access">
        {m.dataAccess ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <KV k="Classes" v={(m.dataAccess.dataClasses ?? []).join(', ') || 'none'} />
            <KV k="PII" v={flag(m.dataAccess.containsPII)} />
            <KV k="Financial" v={flag(m.dataAccess.containsFinancial)} />
            <KV k="Health" v={flag(m.dataAccess.containsHealth)} />
            <KV k="External" v={flag(m.dataAccess.externalData)} />
          </dl>
        ) : (
          <Unknown>Data access was not recorded. It is not inferred.</Unknown>
        )}
      </Section>

      <Section title="Policies">
        {(m.governance?.policyRefs?.length ?? 0) === 0 ? (
          <Unknown>No policy references.</Unknown>
        ) : (
          <ul className="font-mono text-xs text-ink-200">
            {m.governance!.policyRefs.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Evaluations">
        {(m.governance?.evaluationRefs?.length ?? 0) === 0 ? (
          <Unknown>No evaluation references.</Unknown>
        ) : (
          <ul className="font-mono text-xs text-ink-200">
            {m.governance!.evaluationRefs.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Assurance"
        right={
          report ? (
            <Badge tone={TONE[report.overallStatus]}>{report.overallStatus}</Badge>
          ) : undefined
        }
      >
        {!report ? (
          <p className="text-sm text-ink-400">Not run. Use Run Assurance — checks are deterministic, not an LLM judge.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-ink-400">
              {fmt.int(report.summary.pass)} pass · {fmt.int(report.summary.warn)} warn ·{' '}
              {fmt.int(report.summary.fail)} fail · {fmt.int(report.summary.unknown)} unknown. No numeric score.
            </p>
            <Table head={['Check', 'Group', 'Status', 'Detail']}>
              {report.checks.map((c) => (
                <tr key={c.id}>
                  <Td align="left">{c.title}</Td>
                  <Td align="left">{c.group}</Td>
                  <Td align="left">
                    <Badge tone={TONE[c.status]}>{c.status}</Badge>
                  </Td>
                  <Td align="left">{c.detail}</Td>
                </tr>
              ))}
            </Table>
            {report.findings.length > 0 && (
              <Callout tone={report.overallStatus === 'fail' ? 'danger' : 'warn'} title="Findings">
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {report.findings.map((f) => (
                    <li key={f.checkId}>
                      <span className="font-mono text-2xs">{f.severity}</span> — {f.message}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>
        )}
      </Section>

      <Section title="Runtime observations" subtitle={`Last ${WINDOW_DAYS} days, joined by agentId on events.`}>
        <Grid cols={4}>
          <Stat label="Calls" value={fmt.int(obs.calls)} />
          <Stat label="Traces" value={fmt.int(obs.traces)} />
          <Stat label="Spend" value={fmt.usd(obs.spendUsd, 2)} />
          <Stat label="Errors" value={fmt.int(obs.errors)} tone={obs.errors ? 'warn' : 'good'} />
        </Grid>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <KV k="Actions on those traces" v={fmt.int(obs.actions)} />
          <KV k="Protocol observations" v={fmt.int(obs.protocolEvents)} />
        </dl>
        {obs.recentCalls.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No runtime events carry this agent id yet. Pass{' '}
            <code className="font-mono text-signal">agentId</code> to{' '}
            <code className="font-mono text-signal">execute()</code> or{' '}
            <code className="font-mono text-signal">ArkIngest.run()</code>.
          </p>
        ) : (
          <Table head={['Time', 'Model', 'Status', 'Cost', 'Trace']}>
            {obs.recentCalls.map((e) => (
              <tr key={e.id}>
                <Td mono>{fmt.when(e.ts)}</Td>
                <Td align="left" mono>{e.modelId}</Td>
                <Td align="left">{e.status}</Td>
                <Td mono>{fmt.usd(e.costUsd, 4)}</Td>
                <Td mono>{e.traceId ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel title={title} subtitle={subtitle} right={right}>
      {children}
    </Panel>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-ink-500">{k}</dt>
      <dd className="mt-0.5 text-ink-200">{v}</dd>
    </div>
  );
}

function Unknown({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-500">{children}</p>;
}

function flag(v: boolean | undefined): string {
  if (v === undefined) return 'unknown';
  return v ? 'yes' : 'no';
}
