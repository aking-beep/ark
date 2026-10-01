import Link from 'next/link';
import { listAgents, listAssuranceRuns, latestAssuranceByAgent } from '@ark/db';
import { Panel, Grid, Stat, Badge, Table, Td, fmt, type Tone } from '@ark/ui';
import { requireOrg } from '@/lib/org';
import { runAssuranceAction } from '../discover/actions';

export const dynamic = 'force-dynamic';

const TONE: Record<string, Tone> = {
  pass: 'good',
  warn: 'warn',
  fail: 'danger',
  unknown: 'neutral',
};

export default async function AssurancePage() {
  const { orgId } = await requireOrg();
  const [agents, runs, latest] = await Promise.all([
    listAgents(orgId),
    listAssuranceRuns(orgId),
    latestAssuranceByAgent(orgId),
  ]);

  const assessed = [...latest.values()];
  const pass = assessed.filter((r) => r.status === 'pass').length;
  const warn = assessed.filter((r) => r.status === 'warn').length;
  const fail = assessed.filter((r) => r.status === 'fail').length;
  const unknown = assessed.filter((r) => r.status === 'unknown').length;
  const findings = runs.flatMap((r) =>
    (r.report.findings ?? []).slice(0, 3).map((f) => ({
      agentId: r.agentId,
      createdAt: r.createdAt,
      ...f,
    })),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Assurance</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          Deterministic checks against a registered Agent Manifest. ARK Assurance is a capability
          of Control, not a separate product, and it does not use an LLM as judge.
        </p>
      </header>

      <Grid cols={4}>
        <Stat label="Agents assessed" value={fmt.int(assessed.length)} hint={`${fmt.int(agents.length)} registered.`} />
        <Stat label="Pass / Warn" value={`${fmt.int(pass)} / ${fmt.int(warn)}`} tone={warn ? 'warn' : 'good'} />
        <Stat label="Fail" value={fmt.int(fail)} tone={fail ? 'danger' : 'good'} />
        <Stat label="Unknown" value={fmt.int(unknown)} hint="Unknown means the field was not recorded, not that it passed." />
      </Grid>

      <Panel title="Agents" subtitle="Latest run per agent. Re-run from the agent page or here.">
        <Table head={['Agent', 'Environment', 'Latest status', 'Pass', 'Warn', 'Fail', 'Unknown', '']}>
          {agents.map((a) => {
            const r = latest.get(a.id);
            return (
              <tr key={a.id} className="hover:bg-ink-800/40">
                <Td align="left">
                  <Link href={`/agents/${a.id}`} className="text-ink-100 hover:text-signal">
                    {a.name}
                  </Link>
                </Td>
                <Td align="left">{a.environment}</Td>
                <Td align="left">
                  {r ? <Badge tone={TONE[r.status] ?? 'neutral'}>{r.status}</Badge> : <span className="text-ink-600">not run</span>}
                </Td>
                <Td mono>{r ? fmt.int(r.report.summary.pass) : '—'}</Td>
                <Td mono>{r ? fmt.int(r.report.summary.warn) : '—'}</Td>
                <Td mono>{r ? fmt.int(r.report.summary.fail) : '—'}</Td>
                <Td mono>{r ? fmt.int(r.report.summary.unknown) : '—'}</Td>
                <Td>
                  <form action={runAssuranceAction}>
                    <input type="hidden" name="agentId" value={a.id} />
                    <button type="submit" className="text-xs text-signal hover:underline">
                      Run
                    </button>
                  </form>
                </Td>
              </tr>
            );
          })}
        </Table>
        {agents.length === 0 && (
          <p className="text-sm text-ink-400">
            Register an agent from{' '}
            <Link href="/discover" className="text-signal underline underline-offset-2">
              Discover
            </Link>{' '}
            first.
          </p>
        )}
      </Panel>

      <Panel title="Recent findings">
        {findings.length === 0 ? (
          <p className="text-sm text-ink-500">No findings yet.</p>
        ) : (
          <Table head={['When', 'Agent', 'Severity', 'Finding']}>
            {findings.slice(0, 40).map((f, i) => (
              <tr key={`${f.agentId}-${f.checkId}-${i}`}>
                <Td mono>{fmt.when(f.createdAt)}</Td>
                <Td align="left">
                  <Link href={`/agents/${f.agentId}`} className="hover:text-signal">
                    {f.agentId}
                  </Link>
                </Td>
                <Td align="left">
                  <Badge tone={TONE[f.severity] ?? 'neutral'}>{f.severity}</Badge>
                </Td>
                <Td align="left">{f.message}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}
