import { createClient } from '@libsql/client';
import { databaseUrl } from './client.js';

/**
 * Plain DDL rather than drizzle-kit: one fewer dependency, and the repo has to
 * run from a clean clone with no generation step.
 */
const DDL = [
`CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS workloads (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, pattern TEXT NOT NULL,
  spec TEXT NOT NULL, assessment TEXT, status TEXT NOT NULL DEFAULT 'proposed',
  created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, workload_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL DEFAULT 'pending',
  actor_id TEXT, total_cost_usd REAL NOT NULL DEFAULT 0, total_turns INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0, escalated_to_human INTEGER NOT NULL DEFAULT 0)`,
`CREATE INDEX IF NOT EXISTS traces_workload_idx ON traces(workload_id, started_at)`,
`CREATE INDEX IF NOT EXISTS traces_outcome_idx ON traces(outcome)`,

`CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, trace_id TEXT, workload_id TEXT, ts INTEGER NOT NULL,
  provider TEXT NOT NULL, model_id TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', error_kind TEXT,
  sensitive_matches TEXT, off_allowlist INTEGER NOT NULL DEFAULT 0,
  user_id TEXT, application TEXT)`,
`CREATE INDEX IF NOT EXISTS events_trace_idx ON events(trace_id)`,
`CREATE INDEX IF NOT EXISTS events_ts_idx ON events(org_id, ts)`,
`CREATE INDEX IF NOT EXISTS events_model_idx ON events(model_id)`,

`CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, trace_id TEXT NOT NULL, ts INTEGER NOT NULL,
  name TEXT NOT NULL, system TEXT NOT NULL, blast_radius TEXT NOT NULL, value_usd REAL,
  approved_by TEXT, required_approval INTEGER NOT NULL DEFAULT 0, credential_id TEXT)`,
`CREATE INDEX IF NOT EXISTS actions_trace_idx ON actions(trace_id)`,

`CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT,
  period TEXT NOT NULL DEFAULT 'month', limit_usd REAL NOT NULL,
  warn_at_pct INTEGER NOT NULL DEFAULT 80, enforcement TEXT NOT NULL DEFAULT 'warn',
  created_at INTEGER NOT NULL)`,

`CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
  severity TEXT NOT NULL, workload_id TEXT, message TEXT NOT NULL, detail TEXT,
  acknowledged_at INTEGER)`,
`CREATE INDEX IF NOT EXISTS alerts_ts_idx ON alerts(org_id, ts)`,

`CREATE TABLE IF NOT EXISTS quality_samples (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, workload_id TEXT NOT NULL, trace_id TEXT,
  ts INTEGER NOT NULL, correct INTEGER NOT NULL, judged_by TEXT NOT NULL, note TEXT)`,

`CREATE TABLE IF NOT EXISTS calibration_snapshots (
  id TEXT PRIMARY KEY, org_id TEXT, generated_at INTEGER NOT NULL, window_days INTEGER NOT NULL,
  basis TEXT NOT NULL, payload TEXT NOT NULL)`,
];

const url = databaseUrl();
const client = createClient({ url, authToken: process.env.ARK_DATABASE_AUTH_TOKEN });
for (const stmt of DDL) await client.execute(stmt);
console.log(`Schema pushed to ${url}`);
