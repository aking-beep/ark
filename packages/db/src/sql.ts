import type { Client } from '@libsql/client';

/**
 * Plain DDL rather than drizzle-kit: one fewer dependency, and the repo has to
 * run from a clean clone with no generation step.
 *
 * Exported so ingest tests can push a temporary database without running push.ts
 * as a script (that script binds to ARK_DATABASE_URL at import time).
 */
export const DDL: string[] = [
// Every table whose id a client chooses (ingest ids, workload ids) is keyed
// (org_id, id), like `agents`. A global `id TEXT PRIMARY KEY` let one tenant
// claim an id first and make another tenant's INSERT OR IGNORE a silent no-op —
// or worse, let the UPDATE that follows land on the first tenant's row.
`CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS workloads (
  id TEXT NOT NULL, org_id TEXT NOT NULL, name TEXT NOT NULL, pattern TEXT NOT NULL,
  spec TEXT NOT NULL, assessment TEXT, status TEXT NOT NULL DEFAULT 'proposed',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, id))`,

`CREATE TABLE IF NOT EXISTS traces (
  id TEXT NOT NULL, org_id TEXT NOT NULL, workload_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL DEFAULT 'pending',
  actor_id TEXT, total_cost_usd REAL NOT NULL DEFAULT 0, total_turns INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0, escalated_to_human INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS traces_workload_idx ON traces(org_id, workload_id, started_at)`,
`CREATE INDEX IF NOT EXISTS traces_outcome_idx ON traces(outcome)`,

`CREATE TABLE IF NOT EXISTS events (
  id TEXT NOT NULL, org_id TEXT NOT NULL, trace_id TEXT, workload_id TEXT, ts INTEGER NOT NULL,
  provider TEXT NOT NULL, model_id TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', error_kind TEXT,
  sensitive_matches TEXT, off_allowlist INTEGER NOT NULL DEFAULT 0,
  user_id TEXT, application TEXT, agent_id TEXT,
  cost_source TEXT,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS events_trace_idx ON events(org_id, trace_id)`,
`CREATE INDEX IF NOT EXISTS events_ts_idx ON events(org_id, ts)`,
`CREATE INDEX IF NOT EXISTS events_model_idx ON events(model_id)`,
`CREATE INDEX IF NOT EXISTS events_agent_idx ON events(org_id, agent_id)`,

`CREATE TABLE IF NOT EXISTS actions (
  id TEXT NOT NULL, org_id TEXT NOT NULL, trace_id TEXT NOT NULL, ts INTEGER NOT NULL,
  name TEXT NOT NULL, system TEXT NOT NULL, blast_radius TEXT NOT NULL, value_usd REAL,
  approved_by TEXT, required_approval INTEGER NOT NULL DEFAULT 0, credential_id TEXT, agent_id TEXT,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS actions_trace_idx ON actions(org_id, trace_id)`,

// Fourth grain, beside events, actions and traces. No column here can hold a
// tool argument, a message body, a rendered data model or a signed mandate.
// See packages/db/src/schema.ts for the reasoning and ADR-0007 for the decision.
`CREATE TABLE IF NOT EXISTS protocol_evidence (
  id TEXT NOT NULL, org_id TEXT NOT NULL, trace_id TEXT, workload_id TEXT, ts INTEGER NOT NULL,
  protocol TEXT NOT NULL, protocol_version TEXT,
  kind TEXT NOT NULL, operation TEXT NOT NULL,
  actor TEXT, target TEXT,
  outcome TEXT NOT NULL DEFAULT 'ok', latency_ms INTEGER,
  value_usd REAL, currency TEXT,
  required_approval INTEGER NOT NULL DEFAULT 0, approved_by TEXT,
  risk TEXT NOT NULL DEFAULT 'low',
  evidence_ref TEXT, metadata TEXT, agent_id TEXT,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS protocol_evidence_ts_idx ON protocol_evidence(org_id, ts)`,
`CREATE INDEX IF NOT EXISTS protocol_evidence_protocol_idx ON protocol_evidence(protocol, ts)`,
`CREATE INDEX IF NOT EXISTS protocol_evidence_trace_idx ON protocol_evidence(org_id, trace_id)`,
`CREATE INDEX IF NOT EXISTS protocol_evidence_workload_idx ON protocol_evidence(org_id, workload_id, ts)`,

`CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT,
  period TEXT NOT NULL DEFAULT 'month', limit_usd REAL NOT NULL,
  warn_at_pct INTEGER NOT NULL DEFAULT 80, enforcement TEXT NOT NULL DEFAULT 'warn',
  created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS alerts (
  id TEXT NOT NULL, org_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  severity TEXT NOT NULL, workload_id TEXT, message TEXT NOT NULL, detail TEXT,
  acknowledged_at INTEGER,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS alerts_ts_idx ON alerts(org_id, ts)`,

`CREATE TABLE IF NOT EXISTS quality_samples (
  id TEXT NOT NULL, org_id TEXT NOT NULL, workload_id TEXT NOT NULL, trace_id TEXT,
  ts INTEGER NOT NULL, correct INTEGER NOT NULL, judged_by TEXT NOT NULL, note TEXT,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS quality_samples_workload_idx ON quality_samples(org_id, workload_id, ts)`,

`CREATE TABLE IF NOT EXISTS calibration_snapshots (
  id TEXT PRIMARY KEY, org_id TEXT, generated_at INTEGER NOT NULL, window_days INTEGER NOT NULL,
  basis TEXT NOT NULL, payload TEXT NOT NULL)`,

`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (user_id, org_id))`,

`CREATE TABLE IF NOT EXISTS org_tokens (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS alert_destinations (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS alert_deliveries (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, destination_id TEXT NOT NULL, alert_kind TEXT NOT NULL,
  ts INTEGER NOT NULL, ok INTEGER NOT NULL, status INTEGER, error TEXT)`,

`CREATE TABLE IF NOT EXISTS agents (
  id TEXT NOT NULL, org_id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT,
  environment TEXT NOT NULL DEFAULT 'unknown', status TEXT NOT NULL DEFAULT 'discovered',
  risk_level TEXT NOT NULL DEFAULT 'unknown', manifest TEXT NOT NULL,
  source_repository TEXT, source_commit TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, id))`,
`CREATE INDEX IF NOT EXISTS agents_org_idx ON agents(org_id, updated_at)`,

`CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, repository TEXT NOT NULL, branch TEXT NOT NULL,
  commit_sha TEXT, started_at INTEGER NOT NULL, completed_at INTEGER, status TEXT NOT NULL DEFAULT 'running',
  result TEXT)`,
`CREATE INDEX IF NOT EXISTS discovery_runs_org_idx ON discovery_runs(org_id, started_at)`,

`CREATE TABLE IF NOT EXISTS assurance_runs (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, status TEXT NOT NULL, report TEXT NOT NULL)`,
`CREATE INDEX IF NOT EXISTS assurance_runs_agent_idx ON assurance_runs(org_id, agent_id, created_at)`,
];

/** Additive statements for databases created before this column existed. */
export const MIGRATIONS: string[] = [
  `ALTER TABLE events ADD COLUMN agent_id TEXT`,
  `CREATE INDEX IF NOT EXISTS events_agent_idx ON events(org_id, agent_id)`,
  // 'reported' | 'catalog' | 'unpriced'. NULL on rows ingested before it existed,
  // which Control reads as "not shown to be reported".
  `ALTER TABLE events ADD COLUMN cost_source TEXT`,
  `ALTER TABLE actions ADD COLUMN agent_id TEXT`,
  `CREATE INDEX IF NOT EXISTS actions_agent_idx ON actions(org_id, agent_id)`,
  `ALTER TABLE protocol_evidence ADD COLUMN agent_id TEXT`,
  `CREATE INDEX IF NOT EXISTS protocol_evidence_agent_idx ON protocol_evidence(org_id, agent_id)`,
];

/**
 * Tables that used to be keyed by a global `id` and are now keyed (org_id, id).
 * A database pushed before the change still has the old key, and
 * `CREATE TABLE IF NOT EXISTS` will not touch it, so `pushSchema` rebuilds it.
 */
export const ORG_SCOPED_TABLES = [
  'workloads', 'traces', 'events', 'actions', 'protocol_evidence', 'alerts', 'quality_samples',
] as const;

function createStatementFor(table: string): string {
  const stmt = DDL.find((d) => new RegExp(`^CREATE TABLE IF NOT EXISTS ${table} \\(`).test(d));
  if (!stmt) throw new Error(`no DDL for ${table}`);
  return stmt;
}

/** True when `table` exists and its primary key is not (org_id, id). */
async function hasLegacyKey(client: Client, table: string): Promise<boolean> {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  if (info.rows.length === 0) return false;
  const pk = info.rows
    .filter((r) => Number(r.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((r) => String(r.name));
  return !(pk.length === 2 && pk[0] === 'org_id' && pk[1] === 'id');
}

/**
 * Copy a legacy single-key table into the composite-key shape. Columns are
 * the intersection of old and new, so a table that predates `agent_id` still
 * copies. Runs as one write transaction: either the table is rebuilt or it is
 * left exactly as it was.
 */
async function rebuildWithOrgKey(client: Client, table: string): Promise<void> {
  const legacy = `${table}__legacy_pk`;
  const oldCols = (await client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
  const tx = await client.transaction('write');
  try {
    await tx.execute(`DROP TABLE IF EXISTS ${legacy}`);
    await tx.execute(`ALTER TABLE ${table} RENAME TO ${legacy}`);
    await tx.execute(createStatementFor(table));
    const newCols = (await tx.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name));
    const cols = newCols.filter((c) => oldCols.includes(c)).join(', ');
    await tx.execute(`INSERT OR IGNORE INTO ${table} (${cols}) SELECT ${cols} FROM ${legacy}`);
    // Dropping the legacy table drops its indexes, so the CREATE INDEX IF NOT
    // EXISTS statements in DDL recreate them against the new table.
    await tx.execute(`DROP TABLE ${legacy}`);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

/**
 * Idempotent schema push: rebuild legacy-keyed tables, apply DDL, then the
 * additive migrations. Safe to run on every boot (deploy/entrypoint.sh does).
 */
export async function pushSchema(client: Client): Promise<{ rebuilt: string[] }> {
  const rebuilt: string[] = [];
  for (const table of ORG_SCOPED_TABLES) {
    if (await hasLegacyKey(client, table)) {
      // Older DBs may lack columns the new DDL indexes, so add those first.
      for (const stmt of MIGRATIONS) {
        if (!stmt.startsWith(`ALTER TABLE ${table} `)) continue;
        try { await client.execute(stmt); } catch { /* already present */ }
      }
      await rebuildWithOrgKey(client, table);
      rebuilt.push(table);
    }
  }
  for (const stmt of DDL) await client.execute(stmt);
  for (const stmt of MIGRATIONS) {
    try {
      await client.execute(stmt);
    } catch {
      // Duplicate column on an already-migrated file. Fresh DBs already have it in DDL.
    }
  }
  return { rebuilt };
}
