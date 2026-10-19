import Link from 'next/link';
import {
  GITHUB_FETCH_LIMITS,
  materializeAgentManifests,
  isSampleRepository,
  type DiscoveryResult,
} from '@ark/core';
import { getDiscoveryRun, listAgents } from '@ark/db';
import { Panel, Table, Td, Badge, Callout, fmt } from '@ark/ui';
import { requireOrg } from '@/lib/org';
import { discoverErrorMessage } from '@/lib/discover';
import { recentDiscoveryRuns } from '@/lib/queries';
import { discoverRepo, discoverSample, registerCandidate } from './actions';

export const dynamic = 'force-dynamic';

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; error?: string }>;
}) {
  const { orgId } = await requireOrg();
  const q = await searchParams;
  // A fixed code mapped to fixed copy. The parameter itself is never
  // rendered: a link can put any text in it.
  const errorMessage = discoverErrorMessage(q.error);
  const [run, runs, agents] = await Promise.all([
    q.run ? getDiscoveryRun(orgId, q.run) : null,
    recentDiscoveryRuns(orgId),
    listAgents(orgId),
  ]);
  const result = run?.result ?? null;
  const registered = new Map(agents.map((a) => [a.id, a] as const));

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

      {errorMessage && (
        <Callout tone="danger" title="Discovery did not complete">
          {errorMessage}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="No GitHub to hand?"
          subtitle="A bundled sample repository, run through the same scanner. No network, no token."
        >
          <p className="text-sm leading-relaxed text-ink-300">
            A small support desk: a triage agent and a refund agent over a CRM MCP server. Nothing about
            it is hand-written discovery output — the page shows what the scanner finds in the files.
          </p>
          <form action={discoverSample} className="mt-3">
            <button
              type="submit"
              className="min-h-10 rounded-md border border-signal/60 px-3 py-2 text-sm font-medium text-signal hover:bg-signal/10"
            >
              Try the sample repository
            </button>
          </form>
        </Panel>

        <Panel title="Recent discovery runs" subtitle="Newest first. Open one to register its candidates.">
          {runs.length === 0 ? (
            <p className="text-sm text-ink-400">No runs yet.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <Link
                    href={`/discover?run=${encodeURIComponent(r.id)}`}
                    aria-current={run?.id === r.id ? 'page' : undefined}
                    className="min-w-0 break-all font-mono text-xs text-ink-100 hover:text-signal"
                  >
                    {r.repository}
                  </Link>
                  <span className="font-mono text-2xs text-ink-400">
                    {fmt.int(r.candidates)} {r.candidates === 1 ? 'candidate' : 'candidates'} &middot; {r.status}{' '}
                    &middot; {fmt.when(r.completedAt ?? r.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {result && run && <DiscoveryView runId={run.id} result={result} registered={registered} />}
    </div>
  );
}

function DiscoveryView({
  runId,
  result,
  registered,
}: {
  runId: string;
  result: DiscoveryResult;
  registered: Map<string, { owner: string | null; environment: string }>;
}) {
  const sample = isSampleRepository(result.repository);
  const candidates = materializeAgentManifests(result, { discoveryMethod: sample ? 'snapshot' : 'github' });

  return (
    <div className="space-y-6">
      {sample && (
        <Callout tone="info" title="Sample repository">
          This run scanned the bundled sample, not a fetched repository. Registering a candidate writes a
          real Agent Manifest for this organisation, with the sample as its source.
        </Callout>
      )}
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
                  {registered.has(c.manifest.id) ? (
                    <Link href={`/agents/${encodeURIComponent(c.manifest.id)}`} className="text-xs text-signal underline underline-offset-2">
                      Registered — open agent →
                    </Link>
                  ) : (
                    <Badge tone="info">discovered</Badge>
                  )}
                </div>
                <p className="mt-2 font-mono text-2xs text-ink-500">
                  {c.manifest.discovery?.evidencePaths.slice(0, 8).join(' · ') || 'no paths'}
                </p>
                {/* Prefilled from an existing registration, so updating one
                    never quietly resets its owner or environment to unknown. */}
                <form action={registerCandidate} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="runId" value={runId} />
                  <input type="hidden" name="candidateId" value={c.manifest.id} />
                  <label className="text-2xs uppercase tracking-wide text-ink-500">
                    Owner (optional)
                    <input
                      name="owner"
                      defaultValue={registered.get(c.manifest.id)?.owner ?? ''}
                      placeholder="leave unknown"
                      className="mt-1 block rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
                    />
                  </label>
                  <label className="text-2xs uppercase tracking-wide text-ink-500">
                    Environment
                    <select
                      name="environment"
                      defaultValue={registered.get(c.manifest.id)?.environment ?? 'unknown'}
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
                    className="min-h-10 rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-ink-950"
                  >
                    {registered.has(c.manifest.id) ? 'Update registration' : 'Register'}
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
        <Table head={['Path', 'Kind', 'Detail']} align={['left', 'left', 'left']}>
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
