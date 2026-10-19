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

// One row per entry in MIGRATIONS that has been applied. See pushSchema.
`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
];

export interface Migration {
  /** Stable and never reused: once shipped, an id means this statement forever. */
  id: string;
  sql: string;
}

/**
 * Additive statements for databases created before a column existed. Applied in
 * order, each at most once, and recorded in `schema_migrations`. Append only.
 */
export const MIGRATIONS: Migration[] = [
  { id: '0001_events_agent_id', sql: `ALTER TABLE events ADD COLUMN agent_id TEXT` },
  { id: '0002_events_agent_idx', sql: `CREATE INDEX IF NOT EXISTS events_agent_idx ON events(org_id, agent_id)` },
  // 'reported' | 'catalog' | 'unpriced'. NULL on rows ingested before it existed,
  // which Control reads as "not shown to be reported".
  { id: '0003_events_cost_source', sql: `ALTER TABLE events ADD COLUMN cost_source TEXT` },
  { id: '0004_actions_agent_id', sql: `ALTER TABLE actions ADD COLUMN agent_id TEXT` },
  { id: '0005_actions_agent_idx', sql: `CREATE INDEX IF NOT EXISTS actions_agent_idx ON actions(org_id, agent_id)` },
  { id: '0006_protocol_evidence_agent_id', sql: `ALTER TABLE protocol_evidence ADD COLUMN agent_id TEXT` },
  { id: '0007_protocol_evidence_agent_idx', sql: `CREATE INDEX IF NOT EXISTS protocol_evidence_agent_idx ON protocol_evidence(org_id, agent_id)` },
];

/**
 * The only errors a migration may hit and still count as applied: the column or
 * index is already there, because the DDL created it or the untracked loop that
 * predates `schema_migrations` added it. Each message is tolerated only for the
 * statement kind that can produce it; everything else is a real failure.
 */
export function isBenignMigrationError(sql: string, message: string): boolean {
  if (/^ALTER TABLE \w+ ADD COLUMN /.test(sql)) return /duplicate column name/i.test(message);
  if (/^CREATE INDEX IF NOT EXISTS /.test(sql)) return /already exists/i.test(message);
  return false;
}

/**
 * Run one migration, and record it in the same write when `record` is set. A
 * benign error still records it; any other error, including one recording a
 * tolerated statement, throws naming the migration.
 */
async function applyMigration(client: Client, m: Migration, record: boolean): Promise<void> {
  // OR IGNORE: a replica booting against the same database may have recorded it first.
  const mark = { sql: 'INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)', args: [m.id, Date.now()] };
  const failed = (err: unknown, message: string) =>
    new Error(`migration ${m.id} failed: ${message}`, { cause: err });
  try {
    await client.batch(record ? [m.sql, mark] : [m.sql], 'write');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isBenignMigrationError(m.sql, message)) throw failed(err, message);
    if (!record) return;
    try {
      await client.execute(mark);
    } catch (markErr) {
      throw failed(markErr, markErr instanceof Error ? markErr.message : String(markErr));
    }
  }
}

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
 * Idempotent schema push: rebuild legacy-keyed tables, apply DDL, then each
 * migration not yet recorded in `schema_migrations`. Safe to run on every boot
 * (deploy/entrypoint.sh does). A migration that fails for any reason other than
 * `isBenignMigrationError` rejects the push and nothing after it runs.
 *
 * `migrations` is a parameter only so tests can inject a failing one.
 */
export async function pushSchema(
  client: Client,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<{ rebuilt: string[] }> {
  const rebuilt: string[] = [];
  for (const table of ORG_SCOPED_TABLES) {
    if (await hasLegacyKey(client, table)) {
      // Older DBs may lack columns the new DDL indexes, so add those first.
      // Not recorded here: the pass below records them once the table exists.
      for (const m of migrations) {
        if (m.sql.startsWith(`ALTER TABLE ${table} `)) await applyMigration(client, m, false);
      }
      await rebuildWithOrgKey(client, table);
      rebuilt.push(table);
    }
  }
  for (const stmt of DDL) await client.execute(stmt);
  const applied = new Set(
    (await client.execute('SELECT id FROM schema_migrations')).rows.map((r) => String(r.id)),
  );
  for (const m of migrations) {
    if (!applied.has(m.id)) await applyMigration(client, m, true);
  }
  return { rebuilt };
}
