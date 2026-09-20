import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

/**
 * SQLite so the repo runs with no external services. The schema is
 * deliberately Postgres-portable — no SQLite-specific types — so the move is
 * a driver swap. See docs/adr/0004-sqlite-first.md.
 */

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** A workload is the unit everything attributes to. Mirrors @ark/core Workload. */
export const workloads = sqliteTable('workloads', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id),
  name: text('name').notNull(),
  /** Architecture pattern, so calibration can group by it. */
  pattern: text('pattern').notNull(),
  /** Full @ark/core Workload as JSON. */
  spec: text('spec', { mode: 'json' }).notNull(),
  /** Latest assessment JSON, if one has been run. */
  assessment: text('assessment', { mode: 'json' }),
  status: text('status', { enum: ['proposed', 'shadow', 'assisted', 'live', 'retired'] }).notNull().default('proposed'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/**
 * A trace is one unit of business work — one ticket, one brief, one refund.
 * An agent may burn 14 model calls inside a single trace. Attributing cost to
 * traces rather than calls is the entire point of the schema.
 */
export const traces = sqliteTable('traces', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  workloadId: text('workload_id').notNull().references(() => workloads.id),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  /** Did this produce the business outcome it was supposed to? */
  outcome: text('outcome', { enum: ['success', 'failure', 'escalated', 'abandoned', 'pending'] })
    .notNull().default('pending'),
  /** Who or what initiated it. */
  actorId: text('actor_id'),
  /** Denormalised rollups so the dashboard is not aggregating on every load. */
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  totalTurns: integer('total_turns').notNull().default(0),
  retries: integer('retries').notNull().default(0),
  escalatedToHuman: integer('escalated_to_human', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  byWorkload: index('traces_workload_idx').on(t.workloadId, t.startedAt),
  byOutcome: index('traces_outcome_idx').on(t.outcome),
}));

/** One model call. The raw ingest record. */
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  traceId: text('trace_id').references(() => traces.id),
  workloadId: text('workload_id'),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),

  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  /** Turn index within the trace. Reveals agent loops. */
  turn: integer('turn').notNull().default(0),

  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),

  costUsd: real('cost_usd').notNull().default(0),
  latencyMs: integer('latency_ms').notNull().default(0),

  status: text('status', { enum: ['ok', 'error', 'timeout', 'refused', 'filtered'] }).notNull().default('ok'),
  errorKind: text('error_kind'),

  /** Security signals captured at ingest. */
  sensitiveMatches: text('sensitive_matches', { mode: 'json' }).$type<string[]>(),
  offAllowlist: integer('off_allowlist', { mode: 'boolean' }).notNull().default(false),

  userId: text('user_id'),
  application: text('application'),
}, (t) => ({
  byTrace: index('events_trace_idx').on(t.traceId),
  byTs: index('events_ts_idx').on(t.orgId, t.ts),
  byModel: index('events_model_idx').on(t.modelId),
}));

/** Actions an agent actually took, and whether they were approved. */
export const actions = sqliteTable('actions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  traceId: text('trace_id').notNull().references(() => traces.id),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  name: text('name').notNull(),
  system: text('system').notNull(),
  blastRadius: text('blast_radius', { enum: ['none', 'reversible', 'costly', 'irreversible'] }).notNull(),
  valueUsd: real('value_usd'),
  /** Null when no approval record exists — the condition SEC-05 alerts on. */
  approvedBy: text('approved_by'),
  requiredApproval: integer('required_approval', { mode: 'boolean' }).notNull().default(false),
  credentialId: text('credential_id'),
}, (t) => ({ byTrace: index('actions_trace_idx').on(t.traceId) }));

/**
 * One normalised observation from an agent protocol.
 *
 * A fourth grain, beside events (one model call), actions (one side effect)
 * and traces (one unit of business work). Folding protocol observations into
 * `events` would break the one number the whole schema exists to compute:
 * cost per outcome is `SUM(events.cost) / COUNT(DISTINCT traces)`, and an MCP
 * tool call has no cost and is not a call to a model.
 *
 * Every column here is a label, an identifier or a measurement. There is no
 * column a tool argument, a message body, a rendered data model or a signed
 * mandate could be written to, which is the point — see ADR-0007 and
 * docs/07-protocol-evidence.md.
 */
export const protocolEvidence = sqliteTable('protocol_evidence', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  /** Correlates to the unit of business work. Null for uncorrelated observation. */
  traceId: text('trace_id'),
  workloadId: text('workload_id'),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),

  protocol: text('protocol', { enum: ['mcp', 'a2a', 'ag-ui', 'a2ui', 'ucp', 'ap2'] }).notNull(),
  /** The protocol's own version string, as observed. Never ARK's. */
  protocolVersion: text('protocol_version'),

  kind: text('kind', {
    enum: ['tool', 'resource', 'prompt', 'discovery', 'delegation', 'task',
           'human_input', 'approval', 'ui', 'commerce', 'payment', 'receipt', 'other'],
  }).notNull(),
  /** The operation in the protocol's vocabulary, e.g. `tools/call:search_customer`. */
  operation: text('operation').notNull(),

  actor: text('actor'),
  target: text('target'),

  outcome: text('outcome', { enum: ['ok', 'error', 'blocked', 'pending', 'approved', 'denied'] })
    .notNull().default('ok'),
  latencyMs: integer('latency_ms'),

  /** Only populated when the observed currency was USD. See `currency`. */
  valueUsd: real('value_usd'),
  currency: text('currency'),

  requiredApproval: integer('required_approval', { mode: 'boolean' }).notNull().default(false),
  /** Null when no approval record exists — the condition `approval_missing` reads. */
  approvedBy: text('approved_by'),

  risk: text('risk', { enum: ['low', 'medium', 'high', 'critical'] }).notNull().default('low'),

  /** A pointer into the system of record — task id, mandate id, receipt id. Never the object. */
  evidenceRef: text('evidence_ref'),

  /** Low-cardinality scalars only. Enforced by @ark/core's EvidenceInput, not by SQLite. */
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, string | number | boolean>>(),
}, (t) => ({
  byTs: index('protocol_evidence_ts_idx').on(t.orgId, t.ts),
  byProtocol: index('protocol_evidence_protocol_idx').on(t.protocol, t.ts),
  byTrace: index('protocol_evidence_trace_idx').on(t.traceId),
  byWorkload: index('protocol_evidence_workload_idx').on(t.workloadId, t.ts),
}));

/** Spend ceilings with an enforcement mode. A budget you cannot enforce is a wish. */
export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  scope: text('scope', { enum: ['org', 'workload', 'application', 'user'] }).notNull(),
  scopeId: text('scope_id'),
  period: text('period', { enum: ['day', 'week', 'month'] }).notNull().default('month'),
  limitUsd: real('limit_usd').notNull(),
  warnAtPct: integer('warn_at_pct').notNull().default(80),
  enforcement: text('enforcement', { enum: ['observe', 'warn', 'throttle', 'block'] }).notNull().default('warn'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  kind: text('kind', {
    enum: ['budget_warn', 'budget_breach', 'circuit_break', 'sensitive_data', 'off_allowlist',
           'unapproved_action', 'loop_runaway', 'quality_regression', 'stale_pricing',
           'approval_missing'],
  }).notNull(),
  severity: text('severity', { enum: ['info', 'warn', 'critical'] }).notNull(),
  workloadId: text('workload_id'),
  message: text('message').notNull(),
  detail: text('detail', { mode: 'json' }),
  acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
}, (t) => ({ byTs: index('alerts_ts_idx').on(t.orgId, t.ts) }));

/** Quality samples — the link between cost and whether it was any good. */
export const qualitySamples = sqliteTable('quality_samples', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  workloadId: text('workload_id').notNull().references(() => workloads.id),
  traceId: text('trace_id').references(() => traces.id),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  /** 1 = correct, 0 = incorrect, judged by a human or a graded eval. */
  correct: integer('correct', { mode: 'boolean' }).notNull(),
  judgedBy: text('judged_by', { enum: ['human', 'eval', 'heuristic'] }).notNull(),
  note: text('note'),
});

/** Snapshots of calibration sets emitted to MY AI for teams. Versioned, not overwritten. */
export const calibrationSnapshots = sqliteTable('calibration_snapshots', {
  id: text('id').primaryKey(),
  orgId: text('org_id'),
  generatedAt: integer('generated_at', { mode: 'timestamp' }).notNull(),
  windowDays: integer('window_days').notNull(),
  basis: text('basis', { enum: ['measured', 'calibrated'] }).notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
});

export type Workload = typeof workloads.$inferSelect;
export type Trace = typeof traces.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Action = typeof actions.$inferSelect;
export type ProtocolEvidence = typeof protocolEvidence.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Alert = typeof alerts.$inferSelect;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const memberships = sqliteTable('memberships', {
  userId: text('user_id').notNull(),
  orgId: text('org_id').notNull(),
  role: text('role').notNull().default('member'),
});

export const orgTokens = sqliteTable('org_tokens', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const alertDestinations = sqliteTable('alert_destinations', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  kind: text('kind', { enum: ['webhook', 'slack'] }).notNull(),
  url: text('url').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const alertDeliveries = sqliteTable('alert_deliveries', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  destinationId: text('destination_id').notNull(),
  alertKind: text('alert_kind').notNull(),
  ts: integer('ts', { mode: 'timestamp' }).notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  status: integer('status'),
  error: text('error'),
});
