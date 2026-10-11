'use server';

import { redirect } from 'next/navigation';
import {
  parseGithubRepoUrl,
  fetchGithubSnapshot,
  discoverRepository,
  materializeAgentManifests,
  runAssurance,
  AgentEnvironment,
} from '@ark/core';
import {
  createDiscoveryRun,
  getDiscoveryRun,
  upsertAgent,
  getAgent,
  createAssuranceRun,
} from '@ark/db';
import { requireOrg } from '@/lib/org';
import { discoverErrorCode, isPublicRepo, privateDiscoveryAllowed, type DiscoverErrorCode } from '@/lib/discover';

/** Redirect targets carry a fixed code, never message text; see lib/discover.ts. */
function fail(code: DiscoverErrorCode, runId?: string): never {
  redirect(runId ? `/discover?run=${encodeURIComponent(runId)}&error=${code}` : `/discover?error=${code}`);
}

export async function discoverRepo(formData: FormData) {
  const { orgId } = await requireOrg();
  const url = String(formData.get('repository') ?? '');
  const branchRaw = String(formData.get('branch') ?? '').trim();
  const parsed = parseGithubRepoUrl(url);
  if (!parsed) fail('bad_url');

  // The server token is the operator's credential, not this user's. Unless
  // the operator opts in, it is only spent on repositories GitHub reports as
  // public to an anonymous caller, so a tenant cannot use it to read private
  // code the token happens to see.
  const token = process.env.ARK_GITHUB_TOKEN;
  if (token && !privateDiscoveryAllowed() && !(await isPublicRepo(parsed.owner, parsed.repo))) {
    fail('not_public');
  }
  let runId = '';
  let failure: DiscoverErrorCode | null = null;
  try {
    const snap = await fetchGithubSnapshot({
      ref: { owner: parsed.owner, repo: parsed.repo, branch: branchRaw || parsed.branch },
      token,
    });
    const result = discoverRepository({
      repository: snap.repository,
      branch: snap.branch,
      commitSha: snap.commitSha,
      files: snap.files,
    });
    result.warnings = [...snap.warnings, ...result.warnings].slice(0, 40);
    const run = await createDiscoveryRun(orgId, {
      repository: snap.repository,
      branch: snap.branch,
      commitSha: snap.commitSha,
      status: 'complete',
      result,
    });
    runId = run.id;
  } catch (err) {
    failure = discoverErrorCode(err);
  }
  if (failure) fail(failure);
  redirect(`/discover?run=${encodeURIComponent(runId)}`);
}

export async function registerCandidate(formData: FormData) {
  const { orgId } = await requireOrg();
  const runId = String(formData.get('runId') ?? '');
  const candidateId = String(formData.get('candidateId') ?? '');
  const ownerRaw = String(formData.get('owner') ?? '').trim().slice(0, 200);
  const owner = ownerRaw || undefined;
  const envParsed = AgentEnvironment.safeParse(String(formData.get('environment') ?? 'unknown'));
  const environment = envParsed.success ? envParsed.data : 'unknown';

  const run = await getDiscoveryRun(orgId, runId);
  if (!run?.result) fail('run_not_found');

  const candidates = materializeAgentManifests(run.result, { discoveryMethod: 'github' });
  const hit = candidates.find((c) => c.manifest.id === candidateId);
  if (!hit) fail('candidate_not_found', runId);

  const agent = await upsertAgent(orgId, hit.manifest, { owner, environment, status: 'registered' });
  redirect(`/agents/${encodeURIComponent(agent.id)}`);
}

export async function runAssuranceAction(formData: FormData) {
  const { orgId } = await requireOrg();
  const agentId = String(formData.get('agentId') ?? '');
  const agent = await getAgent(orgId, agentId);
  if (!agent) redirect('/agents');
  const report = runAssurance(agent.manifest);
  await createAssuranceRun(orgId, agent.id, report);
  redirect(`/agents/${encodeURIComponent(agent.id)}`);
}
