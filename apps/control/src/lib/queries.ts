import { raw } from '@ark/db';
import type { CostProvenance } from './basis';

/**
 * Read-only queries the Control pages need and @ark/db does not export yet.
 * Every one is scoped by org_id.
 */

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '');

/**
 * How the dollars in the window were priced. Ingest records `cost_source` per
 * event: 'reported' when the caller sent what the provider charged, 'catalog'
 * when ARK priced observed tokens at a list rate. Rows from before the column
 * existed are NULL and count as not reported, so a figure is only `measured`
 * when every event in the window is shown to carry a reported cost.
 */
export async function costProvenance(orgId: string, days: number): Promise<CostProvenance> {
  const r = await raw().execute({
    sql: `SELECT COUNT(*) n, SUM(CASE WHEN cost_source='reported' THEN 1 ELSE 0 END) reported
          FROM events WHERE org_id=? AND ts>=?`,
    args: [orgId, Date.now() - days * 864e5],
  });
  return { events: n(r.rows[0]?.n), reportedCostEvents: n(r.rows[0]?.reported) };
}

export interface DiscoveryRunRow {
  id: string;
  repository: string;
  branch: string;
  status: string;
  completedAt: number | null;
  startedAt: number;
  candidates: number;
}

/** Recent runs, newest first, so a run is reachable without its URL. */
export async function recentDiscoveryRuns(orgId: string, limit = 8): Promise<DiscoveryRunRow[]> {
  const r = await raw().execute({
    sql: `SELECT id, repository, branch, status, started_at, completed_at,
                 json_array_length(json_extract(result, '$.candidates')) candidates
          FROM discovery_runs WHERE org_id=? ORDER BY started_at DESC LIMIT ?`,
    args: [orgId, limit],
  });
  return r.rows.map((x) => ({
    id: s(x.id),
    repository: s(x.repository),
    branch: s(x.branch),
    status: s(x.status),
    startedAt: n(x.started_at),
    completedAt: x.completed_at == null ? null : n(x.completed_at),
    candidates: n(x.candidates),
  }));
}

export interface ShadowAgent {
  agentId: string;
  /** Model calls carrying this id. */
  calls: number;
  /** Protocol observations naming it as the actor. */
  protocolEvents: number;
  lastSeen: number;
}

/**
 * Agents seen acting in runtime that nobody registered: the id on an event,
 * or the actor on a protocol observation, with no row in `agents`. These are
 * the ones a registry built only from repositories never finds.
 */
export async function shadowAgents(orgId: string, days: number): Promise<ShadowAgent[]> {
  const from = Date.now() - days * 864e5;
  const r = await raw().execute({
    sql: `SELECT agent_id, SUM(calls) calls, SUM(proto) proto, MAX(last) last FROM (
            SELECT agent_id, COUNT(*) calls, 0 proto, MAX(ts) last FROM events
            WHERE org_id=? AND ts>=? AND agent_id IS NOT NULL GROUP BY agent_id
            UNION ALL
            SELECT actor agent_id, 0 calls, COUNT(*) proto, MAX(ts) last FROM protocol_evidence
            WHERE org_id=? AND ts>=? AND actor IS NOT NULL GROUP BY actor
          )
          WHERE agent_id NOT IN (SELECT id FROM agents WHERE org_id=?)
          GROUP BY agent_id ORDER BY last DESC LIMIT 50`,
    args: [orgId, from, orgId, from, orgId],
  });
  return r.rows.map((x) => ({
    agentId: s(x.agent_id),
    calls: n(x.calls),
    protocolEvents: n(x.proto),
    lastSeen: n(x.last),
  }));
}
