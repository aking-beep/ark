import type { Client } from '@libsql/client';
import type { AgentManifest, AssuranceReport, DiscoveryResult } from '@ark/core';
import { raw } from './queries.js';

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '');

function db(client?: Client): Client {
  return client ?? raw();
}

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface StoredAgent {
  id: string;
  orgId: string;
  name: string;
  owner: string | null;
  environment: string;
  status: string;
  riskLevel: string;
  manifest: AgentManifest;
  sourceRepository: string | null;
  sourceCommit: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToAgent(x: Record<string, unknown>): StoredAgent {
  return {
    id: s(x.id),
    orgId: s(x.org_id),
    name: s(x.name),
    owner: x.owner == null ? null : s(x.owner),
    environment: s(x.environment),
    status: s(x.status),
    riskLevel: s(x.risk_level),
    manifest: JSON.parse(s(x.manifest)) as AgentManifest,
    sourceRepository: x.source_repository == null ? null : s(x.source_repository),
    sourceCommit: x.source_commit == null ? null : s(x.source_commit),
    createdAt: n(x.created_at),
    updatedAt: n(x.updated_at),
  };
}

export async function listAgents(orgId: string, client?: Client): Promise<StoredAgent[]> {
  const r = await db(client).execute({
    sql: `SELECT * FROM agents WHERE org_id=? ORDER BY name`,
    args: [orgId],
  });
  return r.rows.map((x) => rowToAgent(x as Record<string, unknown>));
}

export async function getAgent(orgId: string, agentId: string, client?: Client): Promise<StoredAgent | null> {
  const r = await db(client).execute({
    sql: `SELECT * FROM agents WHERE org_id=? AND id=?`,
    args: [orgId, agentId],
  });
  const row = r.rows[0];
  return row ? rowToAgent(row as Record<string, unknown>) : null;
}

export async function upsertAgent(
  orgId: string,
  manifest: AgentManifest,
  extra: { owner?: string; environment?: string; status?: string } = {},
  client?: Client,
): Promise<StoredAgent> {
  const now = Date.now();
  const owner = extra.owner ?? manifest.owner ?? null;
  const environment = extra.environment ?? manifest.environment ?? 'unknown';
  const status = extra.status ?? (manifest.status === 'discovered' ? 'registered' : manifest.status);
  const stored: AgentManifest = {
    ...manifest,
    owner: owner ?? undefined,
    environment: environment as AgentManifest['environment'],
    status: status as AgentManifest['status'],
  };
  await db(client).execute({
    sql: `INSERT INTO agents (
            id, org_id, name, owner, environment, status, risk_level, manifest,
            source_repository, source_commit, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(org_id, id) DO UPDATE SET
            name=excluded.name, owner=excluded.owner, environment=excluded.environment,
            status=excluded.status, risk_level=excluded.risk_level, manifest=excluded.manifest,
            source_repository=excluded.source_repository, source_commit=excluded.source_commit,
            updated_at=excluded.updated_at`,
    args: [
      stored.id, orgId, stored.name, owner, environment, status, stored.riskLevel,
      JSON.stringify(stored),
      stored.source?.repository ?? null,
      stored.source?.commitSha ?? null,
      now, now,
    ],
  });
  const row = await getAgent(orgId, stored.id, client);
  if (!row) throw new Error('upsertAgent failed to read back');
  return row;
}

export interface StoredDiscoveryRun {
  id: string;
  orgId: string;
  repository: string;
  branch: string;
  commitSha: string | null;
  startedAt: number;
  completedAt: number | null;
  status: string;
  result: DiscoveryResult | null;
}

export async function createDiscoveryRun(
  orgId: string,
  input: {
    repository: string;
    branch: string;
    commitSha?: string;
    status: string;
    result?: DiscoveryResult;
    startedAt?: number;
    completedAt?: number;
  },
  client?: Client,
): Promise<StoredDiscoveryRun> {
  const id = nid('dr');
  const startedAt = input.startedAt ?? Date.now();
  const completedAt = input.completedAt ?? (input.status === 'complete' || input.status === 'error' ? Date.now() : null);
  await db(client).execute({
    sql: `INSERT INTO discovery_runs
            (id, org_id, repository, branch, commit_sha, started_at, completed_at, status, result)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      id, orgId, input.repository, input.branch, input.commitSha ?? null,
      startedAt, completedAt, input.status,
      input.result ? JSON.stringify(input.result) : null,
    ],
  });
  const row = await getDiscoveryRun(orgId, id, client);
  if (!row) throw new Error('createDiscoveryRun failed to read back');
  return row;
}

export async function getDiscoveryRun(
  orgId: string,
  runId: string,
  client?: Client,
): Promise<StoredDiscoveryRun | null> {
  const r = await db(client).execute({
    sql: `SELECT * FROM discovery_runs WHERE org_id=? AND id=?`,
    args: [orgId, runId],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: s(x.id),
    orgId: s(x.org_id),
    repository: s(x.repository),
    branch: s(x.branch),
    commitSha: x.commit_sha == null ? null : s(x.commit_sha),
    startedAt: n(x.started_at),
    completedAt: x.completed_at == null ? null : n(x.completed_at),
    status: s(x.status),
    result: x.result ? (JSON.parse(s(x.result)) as DiscoveryResult) : null,
  };
}

export interface StoredAssuranceRun {
  id: string;
  orgId: string;
  agentId: string;
  createdAt: number;
  status: string;
  report: AssuranceReport;
}

export async function createAssuranceRun(
  orgId: string,
  agentId: string,
  report: AssuranceReport,
  client?: Client,
): Promise<StoredAssuranceRun> {
  const id = nid('ar');
  const createdAt = report.timestamp || Date.now();
  await db(client).execute({
    sql: `INSERT INTO assurance_runs (id, org_id, agent_id, created_at, status, report)
          VALUES (?,?,?,?,?,?)`,
    args: [id, orgId, agentId, createdAt, report.overallStatus, JSON.stringify(report)],
  });
  return { id, orgId, agentId, createdAt, status: report.overallStatus, report };
}

export async function latestAssuranceForAgent(
  orgId: string,
  agentId: string,
  client?: Client,
): Promise<StoredAssuranceRun | null> {
  const r = await db(client).execute({
    sql: `SELECT * FROM assurance_runs WHERE org_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 1`,
    args: [orgId, agentId],
  });
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: s(x.id),
    orgId: s(x.org_id),
    agentId: s(x.agent_id),
    createdAt: n(x.created_at),
    status: s(x.status),
    report: JSON.parse(s(x.report)) as AssuranceReport,
  };
}

export async function listAssuranceRuns(orgId: string, client?: Client): Promise<StoredAssuranceRun[]> {
  const r = await db(client).execute({
    sql: `SELECT * FROM assurance_runs WHERE org_id=? ORDER BY created_at DESC LIMIT 100`,
    args: [orgId],
  });
  return r.rows.map((x) => ({
    id: s(x.id),
    orgId: s(x.org_id),
    agentId: s(x.agent_id),
    createdAt: n(x.created_at),
    status: s(x.status),
    report: JSON.parse(s(x.report)) as AssuranceReport,
  }));
}

export interface AgentObservations {
  calls: number;
  traces: number;
  spendUsd: number;
  errors: number;
  actions: number;
  protocolEvents: number;
  recentCalls: {
    id: string;
    ts: number;
    modelId: string;
    provider: string;
    status: string;
    costUsd: number;
    traceId: string | null;
  }[];
}

export async function agentObservations(
  orgId: string,
  agentId: string,
  days = 30,
  client?: Client,
): Promise<AgentObservations> {
  const c = db(client);
  const from = Date.now() - days * 864e5;
  const stats = await c.execute({
    sql: `SELECT COUNT(*) calls,
                 COUNT(DISTINCT trace_id) traces,
                 COALESCE(SUM(cost_usd),0) spend,
                 SUM(CASE WHEN status<>'ok' THEN 1 ELSE 0 END) errors
          FROM events WHERE org_id=? AND agent_id=? AND ts>=?`,
    args: [orgId, agentId, from],
  });
  const actions = await c.execute({
    sql: `SELECT COUNT(*) cnt FROM actions
          WHERE org_id=? AND ts>=? AND trace_id IN (
            SELECT DISTINCT trace_id FROM events WHERE org_id=? AND agent_id=? AND trace_id IS NOT NULL)`,
    args: [orgId, from, orgId, agentId],
  });
  const proto = await c.execute({
    sql: `SELECT COUNT(*) cnt FROM protocol_evidence
          WHERE org_id=? AND ts>=? AND trace_id IN (
            SELECT DISTINCT trace_id FROM events WHERE org_id=? AND agent_id=? AND trace_id IS NOT NULL)`,
    args: [orgId, from, orgId, agentId],
  });
  const recent = await c.execute({
    sql: `SELECT id, ts, model_id, provider, status, cost_usd, trace_id
          FROM events WHERE org_id=? AND agent_id=? AND ts>=?
          ORDER BY ts DESC LIMIT 20`,
    args: [orgId, agentId, from],
  });
  const t = stats.rows[0]!;
  return {
    calls: n(t.calls),
    traces: n(t.traces),
    spendUsd: n(t.spend),
    errors: n(t.errors),
    actions: n(actions.rows[0]?.cnt),
    protocolEvents: n(proto.rows[0]?.cnt),
    recentCalls: recent.rows.map((x) => ({
      id: s(x.id),
      ts: n(x.ts),
      modelId: s(x.model_id),
      provider: s(x.provider),
      status: s(x.status),
      costUsd: n(x.cost_usd),
      traceId: x.trace_id == null ? null : s(x.trace_id),
    })),
  };
}

export interface AgentInfrastructureSummary {
  registered: number;
  production: number;
  failingAssurance: number;
  observedInRuntime: number;
  recentCriticalFindings: { agentId: string; agentName: string; message: string; createdAt: number }[];
}

export async function agentInfrastructureSummary(
  orgId: string,
  client?: Client,
): Promise<AgentInfrastructureSummary> {
  const c = db(client);
  const counts = await c.execute({
    sql: `SELECT COUNT(*) n,
                 SUM(CASE WHEN environment='production' THEN 1 ELSE 0 END) prod
          FROM agents WHERE org_id=?`,
    args: [orgId],
  });
  const failing = await c.execute({
    sql: `SELECT COUNT(*) n FROM agents a
          WHERE a.org_id=? AND EXISTS (
            SELECT 1 FROM assurance_runs r
            WHERE r.org_id=a.org_id AND r.agent_id=a.id AND r.status='fail'
              AND r.created_at = (
                SELECT MAX(created_at) FROM assurance_runs r2
                WHERE r2.org_id=a.org_id AND r2.agent_id=a.id
              )
          )`,
    args: [orgId],
  });
  const observed = await c.execute({
    sql: `SELECT COUNT(DISTINCT e.agent_id) n FROM events e
          WHERE e.org_id=? AND e.agent_id IS NOT NULL AND e.agent_id IN (
            SELECT id FROM agents WHERE org_id=?)`,
    args: [orgId, orgId],
  });
  const findings = await c.execute({
    sql: `SELECT a.id, a.name, r.created_at, r.report FROM agents a
          JOIN assurance_runs r ON r.org_id=a.org_id AND r.agent_id=a.id
          WHERE a.org_id=? AND r.status IN ('fail','warn')
          ORDER BY r.created_at DESC LIMIT 8`,
    args: [orgId],
  });
  const recentCriticalFindings: AgentInfrastructureSummary['recentCriticalFindings'] = [];
  for (const row of findings.rows) {
    let report: AssuranceReport | null = null;
    try {
      report = JSON.parse(s(row.report)) as AssuranceReport;
    } catch {
      continue;
    }
    const hit = (report.findings ?? []).find((f) => f.severity === 'fail') ?? (report.findings ?? [])[0];
    if (!hit) continue;
    recentCriticalFindings.push({
      agentId: s(row.id),
      agentName: s(row.name),
      message: hit.message,
      createdAt: n(row.created_at),
    });
  }
  return {
    registered: n(counts.rows[0]?.n),
    production: n(counts.rows[0]?.prod),
    failingAssurance: n(failing.rows[0]?.n),
    observedInRuntime: n(observed.rows[0]?.n),
    recentCriticalFindings,
  };
}

export async function latestAssuranceByAgent(
  orgId: string,
  client?: Client,
): Promise<Map<string, StoredAssuranceRun>> {
  const runs = await listAssuranceRuns(orgId, client);
  const map = new Map<string, StoredAssuranceRun>();
  for (const r of runs) {
    if (!map.has(r.agentId)) map.set(r.agentId, r);
  }
  return map;
}
