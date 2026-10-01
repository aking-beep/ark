import {
  GITHUB_FETCH_LIMITS,
  materializeAgentManifests,
  type DiscoveryResult,
} from '@ark/core';
import { getDiscoveryRun } from '@ark/db';
import { Panel, Table, Td, Badge, Callout, fmt } from '@ark/ui';
import { requireOrg } from '@/lib/org';
import { discoverRepo, registerCandidate } from './actions';

export const dynamic = 'force-dynamic';

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; error?: string }>;
}) {
  const { orgId } = await requireOrg();
  const q = await searchParams;
  const run = q.run ? await getDiscoveryRun(orgId, q.run) : null;
  const result = run?.result ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Discover</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-400">
          Point ARK Control at a GitHub repository. The server fetches a bounded snapshot of
          high-signal files, scans them as untrusted input, and returns evidence — not a claim
          that an agent exists without a path to back it up.
        </p>
      </header>

      {q.error && (
        <Callout tone="danger" title="Discovery did not complete">
          {q.error}
        </Callout>
      )}

      <Panel
        title="GitHub repository"
        subtitle="Public repos work without a token. Private repos and higher rate limits need ARK_GITHUB_TOKEN on the server — never in this form, never as NEXT_PUBLIC_."
      >
        <form action={discoverRepo} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <label className="block text-2xs uppercase tracking-wide text-ink-500">
            Repository URL
            <input
              name="repository"
              required
              placeholder="https://github.com/owner/repo"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100"
            />
          </label>
          <label className="block text-2xs uppercase tracking-wide text-ink-500">
            Branch (optional)
            <input
              name="branch"
              placeholder="main"
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-signal px-3 py-2 text-sm font-medium text-ink-950 sm:w-auto"
            >
              Discover
            </button>
          </div>
        </form>
        <p className="mt-4 text-2xs leading-relaxed text-ink-500">
          Fetch limits: at most {fmt.int(GITHUB_FETCH_LIMITS.maxFiles)} high-signal files,{' '}
          {fmt.int(GITHUB_FETCH_LIMITS.maxFileBytes)} bytes each,{' '}
          {fmt.int(GITHUB_FETCH_LIMITS.maxTotalBytes)} bytes total,{' '}
          {fmt.int(GITHUB_FETCH_LIMITS.maxTreeEntries)} tree entries,{' '}
          {fmt.int(GITHUB_FETCH_LIMITS.maxTreeBytes)} byte tree payload,{' '}
          {fmt.int(GITHUB_FETCH_LIMITS.timeoutMs)} ms timeout. Truncated or oversized trees fail
          closed (no files fetched). Source is not executed. Secret values are not stored — only
          environment variable names.
        </p>
      </Panel>

      {result && run && <DiscoveryView runId={run.id} result={result} />}
    </div>
  );
}

function DiscoveryView({ runId, result }: { runId: string; result: DiscoveryResult }) {
  const candidates = materializeAgentManifests(result, { discoveryMethod: 'github' });

  return (
    <div className="space-y-6">
      <Panel title="Repository" subtitle="What was actually fetched.">
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <Item term="Repository" value={result.repository} />
          <Item term="Branch" value={result.branch} />
          <Item term="Commit" value={result.commitSha ?? 'unknown'} />
          <Item term="Confidence" value={result.confidence.toFixed(2)} />
          <Item term="Evidence rows" value={String(result.evidence.length)} />
          <Item term="Env var names" value={result.envVarRefs.length ? result.envVarRefs.join(', ') : 'none'} />
        </dl>
      </Panel>

      <Panel
        title="Detected agent candidates"
        subtitle="Registering writes an Agent Manifest. Owner, policies and data classes stay unknown unless you supply them."
      >
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-400">
            No agent candidates. Discovery will not invent one — models, tools and warnings
            below are still listed when evidence exists.
          </p>
        ) : (
          <ul className="space-y-4">
            {candidates.map((c) => (
              <li key={c.manifest.id} className="rounded-lg border border-ink-800 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-ink-100">{c.manifest.id}</p>
                    <p className="text-sm text-ink-300">{c.manifest.name}</p>
                    {c.manifest.purpose && (
                      <p className="mt-1 text-xs text-ink-500">{c.manifest.purpose}</p>
                    )}
                  </div>
                  <Badge tone="info">discovered</Badge>
                </div>
                <p className="mt-2 font-mono text-2xs text-ink-500">
                  {c.manifest.discovery?.evidencePaths.slice(0, 8).join(' · ') || 'no paths'}
                </p>
                <form action={registerCandidate} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="runId" value={runId} />
                  <input type="hidden" name="candidateId" value={c.manifest.id} />
                  <label className="text-2xs uppercase tracking-wide text-ink-500">
                    Owner (optional)
                    <input
                      name="owner"
                      placeholder="leave unknown"
                      className="mt-1 block rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
                    />
                  </label>
                  <label className="text-2xs uppercase tracking-wide text-ink-500">
                    Environment
                    <select
                      name="environment"
                      defaultValue="unknown"
                      className="mt-1 block rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
                    >
                      <option value="unknown">unknown</option>
                      <option value="development">development</option>
                      <option value="staging">staging</option>
                      <option value="production">production</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-ink-950"
                  >
                    Register
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListPanel title="Models" empty="None observed." rows={result.models.map((m) => `${m.provider} / ${m.modelId}`)} extra={result.models.map((m) => m.evidencePaths[0])} />
        <ListPanel title="Tools" empty="None observed." rows={result.tools.map((t) => `${t.name} (${t.type})`)} extra={result.tools.map((t) => t.evidencePaths[0])} />
        <ListPanel title="MCP servers" empty="None observed." rows={result.mcpServers.map((s) => `${s.name} · ${s.transport}`)} extra={result.mcpServers.map((s) => s.evidencePaths[0])} />
        <ListPanel title="Integrations" empty="None observed." rows={result.integrations.map((i) => `${i.name} (${i.type})`)} extra={result.integrations.map((i) => i.evidencePaths[0])} />
      </div>

      {result.warnings.length > 0 && (
        <Callout tone="warn" title="Warnings">
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Panel title="Evidence paths" subtitle="Every finding traces to a file. Nothing here is a payload.">
        <Table head={['Path', 'Kind', 'Detail']}>
          {result.evidence.slice(0, 80).map((e, i) => (
            <tr key={`${e.path}-${e.kind}-${i}`}>
              <Td align="left" mono>{e.path}</Td>
              <Td align="left">{e.kind}</Td>
              <Td align="left">{e.detail}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function ListPanel({
  title,
  empty,
  rows,
  extra,
}: {
  title: string;
  empty: string;
  rows: string[];
  extra?: (string | undefined)[];
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r} className="text-sm text-ink-200">
              {r}
              {extra?.[i] && <span className="ml-2 font-mono text-2xs text-ink-500">{extra[i]}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-ink-500">{term}</dt>
      <dd className="mt-0.5 font-mono text-xs text-ink-200">{value}</dd>
    </div>
  );
}
