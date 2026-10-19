'use server';

import { redirect } from 'next/navigation';
import {
  parseGithubRepoUrl,
  fetchGithubSnapshot,
  discoverRepository,
  materializeAgentManifests,
  runAssurance,
  AgentEnvironment,
  AgentManifest,
} from '@ark/core';
import {
  createDiscoveryRun,
  getDiscoveryRun,
  upsertAgent,
  getAgent,
  createAssuranceRun,
} from '@ark/db';
import { requireOrg } from '@/lib/org';

export async function discoverRepo(formData: FormData) {
  const { orgId } = await requireOrg();
  const url = String(formData.get('repository') ?? '');
  const branchRaw = String(formData.get('branch') ?? '').trim();
  const parsed = parseGithubRepoUrl(url);
  if (!parsed) redirect('/discover?error=' + encodeURIComponent('Use a github.com/owner/repo URL.'));

  const token = process.env.ARK_GITHUB_TOKEN;
  let runId = '';
  let fail = '';
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
    fail = err instanceof Error ? err.message.slice(0, 180) : 'Discovery failed.';
  }
  if (fail) redirect('/discover?error=' + encodeURIComponent(fail));
  redirect(`/discover?run=${runId}`);
}

export async function registerCandidate(formData: FormData) {
  const { orgId } = await requireOrg();
  const runId = String(formData.get('runId') ?? '');
  const candidateId = String(formData.get('candidateId') ?? '');
  const ownerRaw = String(formData.get('owner') ?? '').trim();
  let owner: string | undefined;
  if (ownerRaw) {
    const ownerParsed = AgentManifest.shape.owner.safeParse(ownerRaw);
    if (!ownerParsed.success) {
      redirect(`/discover?run=${encodeURIComponent(runId)}&error=` + encodeURIComponent('Owner is invalid or too long.'));
    }
    owner = ownerParsed.data;
  }
  const envParsed = AgentEnvironment.safeParse(String(formData.get('environment') ?? 'unknown'));
  const environment = envParsed.success ? envParsed.data : 'unknown';

  const run = await getDiscoveryRun(orgId, runId);
  if (!run?.result) redirect('/discover?error=' + encodeURIComponent('Discovery run not found.'));

  const candidates = materializeAgentManifests(run.result, { discoveryMethod: 'github' });
  const hit = candidates.find((c) => c.manifest.id === candidateId);
  if (!hit) redirect(`/discover?run=${runId}&error=` + encodeURIComponent('Candidate not in this run.'));

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
