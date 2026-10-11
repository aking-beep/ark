import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import {
  type IngestBody,
  type EventInput,
  type ActionInput,
  type EvidenceInput,
  priceEvent,
  sensitiveLabels,
  redactEvidence,
  budgetAction,
  strictestAction,
  COMPLETED_OUTCOMES,
  type BudgetEnforcement,
} from '@ark/core';
import { raw } from './queries.js';
import { periodWindow, type PeriodWindow } from './budget-period.js';

export interface IngestAlert {
  id?: string;
  kind: string;
  severity: string;
  workloadId: string | null;
  message: string;
}

export interface CircuitBreak {
  traceId: string;
  reason: string;
}

export interface ApplyIngestOpts {
  allowlist: string[];
  turnCeiling: number;
  traceCostCeiling: number;
  /** Quality-regression floor. Below this many samples we do not alert. */
  qualityMinSamples?: number;
  client?: Client;
  /** Injected clock for tests. Defaults to Date.now(). */
  now?: number;
}

export interface IngestResult {
  /** Model events stored by this call. A retried id is not counted again. */
  accepted: number;
  /** Rows across every grain that were already stored, and so were ignored. */
  duplicates: number;
  tracesClosed: number;
  actionsAccepted: number;
  qualityAccepted: number;
  evidenceAccepted: number;
  /** Metadata keys dropped before the INSERT, by name. Never the values. */
  evidenceRedacted: string[];
  priced: number;
  unpriced: number;
  /** Alerts newly stored by this call. */
  alerts: number;
  circuitBreaks: CircuitBreak[];
  /** The alerts this call stored — and therefore the only ones to deliver. */
  alertRecords?: IngestAlert[];
}

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '');

/** True when the statement stored a row; false when INSERT OR IGNORE ignored it. */
const inserted = (r: { rowsAffected: number }) => r.rowsAffected === 1;

const TRACE_INSERT = `INSERT OR IGNORE INTO traces (id, org_id, workload_id, started_at, outcome, total_cost_usd, total_turns, retries, escalated_to_human)
            VALUES (?,?,?,?,'pending',0,0,0,0)`;

/**
 * Persist a batch and run detection. This is the service the ingest route
 * calls — the route itself only authorises and parses.
 *
 * `orgId` is the org the caller authenticated as, passed separately from the
 * body on purpose: `body.orgId` is a client claim (optional; the route
 * rejects a mismatch) and is never read here. Every row is written under,
 * and every lookup filtered by, the authenticated org.
 *
 * Retries are safe: every grain is INSERT OR IGNORE on (org_id, id), and the
 * trace rollups, counters and alerts only move when the INSERT stored a row.
 */
export async function applyIngest(orgId: string, body: IngestBody, opts: ApplyIngestOpts): Promise<IngestResult> {
  const c = opts.client ?? raw();
  const now = opts.now ?? Date.now();
  const { events, traces, actions, qualitySamples, evidence } = body;
  const qualityMin = opts.qualityMinSamples ?? 20;
  const alerts: IngestAlert[] = [];
  const breakers: CircuitBreak[] = [];
  let priced = 0;
  let unpriced = 0;
  let accepted = 0;
  let duplicates = 0;
  const budgets = events.length > 0 ? await loadBudgets(c, orgId, now) : [];
  const touched = new Set<string>();
  const stalePricing = new Set<string>();

  for (const e of events) {
    // Spend is advanced as the batch is applied, so a batch of a thousand
    // events cannot all be admitted against the spend from before the batch.
    // The event that crosses a block limit is the last one admitted.
    const act = strictestAction(
      applicableBudgets(budgets, e.workloadId).map((b) => budgetAction(b.spent, b.limit, b.enforcement)),
    );
    if (act === 'block') {
      pushBreak(breakers, e.traceId, 'budget_block');
      continue;
    }
    if (act === 'throttle') {
      pushBreak(breakers, e.traceId, 'budget_throttle');
    }

    const ts = e.ts ?? now;
    const { costUsd, priced: wasPriced } = priceEvent(e);
    const matches = sensitiveLabels(e);
    const offAllowlist = !opts.allowlist.includes(e.provider);

    const ins = await c.execute({
      sql: `INSERT OR IGNORE INTO events
              (id, org_id, trace_id, workload_id, ts, provider, model_id, turn,
               input_tokens, output_tokens, cached_input_tokens, cost_usd, latency_ms,
               status, error_kind, sensitive_matches, off_allowlist, user_id, application, agent_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        e.id, orgId, e.traceId, e.workloadId, ts, e.provider, e.modelId, e.turn,
        e.inputTokens, e.outputTokens, e.cachedInputTokens, costUsd, e.latencyMs,
        e.status, e.errorKind ?? null,
        matches.length ? JSON.stringify(matches) : null,
        offAllowlist ? 1 : 0,
        e.userId ?? null, e.application ?? null, e.agentId ?? null,
      ],
    });
    if (!inserted(ins)) {
      // A retry of an event already stored. Its cost is already on the trace
      // and its alerts already raised; counting it again is how a flaky
      // network doubles a dashboard.
      duplicates++;
      continue;
    }
    wasPriced ? priced++ : unpriced++;

    await c.execute({ sql: TRACE_INSERT, args: [e.traceId, orgId, e.workloadId, ts] });
    await c.execute({
      sql: `UPDATE traces SET total_cost_usd = total_cost_usd + ?, total_turns = MAX(total_turns, ?)
            WHERE org_id = ? AND id = ?`,
      args: [costUsd, e.turn + 1, orgId, e.traceId],
    });
    for (const b of applicableBudgets(budgets, e.workloadId)) b.spent += costUsd;
    touched.add(e.traceId);

    for (const a of eventAlerts(e, { costUsd, wasPriced, matches, offAllowlist })) {
      if (a.kind === 'stale_pricing') {
        // One finding per model, not one per call: five hundred calls to an
        // unknown model are one missing rate card. The id holds it to one per
        // model per UTC day across batches as well.
        if (stalePricing.has(e.modelId)) continue;
        stalePricing.add(e.modelId);
        a.id = `al_stale_${new Date(now).toISOString().slice(0, 10)}_${e.modelId}`;
      }
      alerts.push(a);
    }
    accepted++;
  }

  for (const traceId of touched) {
    const r = await c.execute({
      sql: 'SELECT workload_id, total_turns, total_cost_usd FROM traces WHERE org_id = ? AND id = ?',
      args: [orgId, traceId],
    });
    const row = r.rows[0];
    if (!row) continue;
    const turns = n(row.total_turns);
    const cost = n(row.total_cost_usd);
    const wid = row.workload_id ? s(row.workload_id) : null;

    if (turns > opts.turnCeiling) {
      breakers.push({ traceId, reason: `turn ceiling ${opts.turnCeiling} exceeded (${turns})` });
      alerts.push({
        kind: 'loop_runaway', severity: 'warn', workloadId: wid,
        message: `Trace ${traceId} has run ${turns} turns against a ceiling of ${opts.turnCeiling} and has spent $${cost.toFixed(2)} on one unit of work.`,
      });
    }
    if (cost > opts.traceCostCeiling) {
      breakers.push({ traceId, reason: `trace cost ceiling $${opts.traceCostCeiling} exceeded ($${cost.toFixed(2)})` });
      alerts.push({
        kind: 'circuit_break', severity: 'critical', workloadId: wid,
        message: `Trace ${traceId} cost $${cost.toFixed(2)} against a per-trace ceiling of $${opts.traceCostCeiling.toFixed(2)}.`,
      });
    }
  }

  let tracesClosed = 0;
  for (const t of traces) {
    const r = await c.execute({
      sql: `UPDATE traces SET outcome = ?, retries = ?, escalated_to_human = ?, ended_at = ?, actor_id = COALESCE(?, actor_id)
            WHERE org_id = ? AND id = ?`,
      args: [t.outcome, t.retries, t.escalatedToHuman ? 1 : 0, t.endedAt ?? now, t.actorId ?? null, orgId, t.traceId],
    });
    if (r.rowsAffected > 0) tracesClosed++;
  }

  let actionsAccepted = 0;
  for (const a of actions) {
    const ts = a.ts ?? now;
    await c.execute({ sql: TRACE_INSERT, args: [a.traceId, orgId, a.workloadId ?? 'unknown', ts] });
    const ins = await c.execute({
      sql: `INSERT OR IGNORE INTO actions (id, org_id, trace_id, ts, name, system, blast_radius, value_usd, approved_by, required_approval, credential_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        a.id, orgId, a.traceId, ts, a.name, a.system, a.blastRadius,
        a.valueUsd ?? null, a.approvedBy ?? null, a.requiredApproval ? 1 : 0, a.credentialId ?? null,
      ],
    });
    if (!inserted(ins)) {
      duplicates++;
      continue;
    }
    actionsAccepted++;
    const unapproved = (a.blastRadius === 'irreversible' || a.requiredApproval) && !a.approvedBy;
    if (unapproved) {
      alerts.push({
        id: `al_unap_${a.id}`,
        kind: 'unapproved_action',
        severity: 'critical',
        workloadId: a.workloadId ?? null,
        message: `"${a.name}" executed in ${a.system} with no approval record. SEC-05 requires a human gate.`,
      });
    }
  }

  let qualityAccepted = 0;
  const qualityWorkloads = new Set<string>();
  for (const q of qualitySamples) {
    const ts = q.ts ?? now;
    const ins = await c.execute({
      sql: `INSERT OR IGNORE INTO quality_samples (id, org_id, workload_id, trace_id, ts, correct, judged_by, note)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [q.id, orgId, q.workloadId, q.traceId ?? null, ts, q.correct ? 1 : 0, q.judgedBy, q.note ?? null],
    });
    if (!inserted(ins)) {
      duplicates++;
      continue;
    }
    qualityAccepted++;
    qualityWorkloads.add(q.workloadId);
  }

  for (const wid of qualityWorkloads) {
    const qreg = await qualityRegressionAlert(c, orgId, wid, qualityMin, now);
    if (qreg) alerts.push(qreg);
  }

  let evidenceAccepted = 0;
  const evidenceRedacted = new Set<string>();
  for (const raw of evidence) {
    // Redact again on this side of the wire. The SDK already did it, but a
    // hand-rolled POST did not, and this is the last place before the INSERT
    // where a payload can still be stopped.
    const { evidence: e, redacted, classes } = redactEvidence(raw);
    for (const key of redacted) evidenceRedacted.add(key);
    const ts = e.ts ?? now;

    if (e.traceId) {
      // Same as actions: an observation that names a trace makes that trace
      // real, so the cross-grain view on /workloads/[id] can find it. The row
      // stays `pending` and carries no cost until model events arrive.
      await c.execute({ sql: TRACE_INSERT, args: [e.traceId, orgId, e.workloadId ?? 'unknown', ts] });
    }

    const ins = await c.execute({
      sql: `INSERT OR IGNORE INTO protocol_evidence
              (id, org_id, trace_id, workload_id, ts, protocol, protocol_version, kind, operation,
               actor, target, outcome, latency_ms, value_usd, currency,
               required_approval, approved_by, risk, evidence_ref, metadata)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        e.id, orgId, e.traceId ?? null, e.workloadId ?? null, ts,
        e.protocol, e.protocolVersion ?? null, e.kind, e.operation,
        e.actor ?? null, e.target ?? null, e.outcome, e.latencyMs ?? null,
        e.valueUsd ?? null, e.currency ?? null,
        e.requiredApproval ? 1 : 0, e.approvedBy ?? null, e.risk, e.evidenceRef ?? null,
        Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : null,
      ],
    });
    if (!inserted(ins)) {
      duplicates++;
      continue;
    }
    evidenceAccepted++;

    if (classes.length > 0) alerts.push(redactionAlert(e, classes, redacted.length));
    const missing = approvalMissingAlert(e);
    if (missing) alerts.push(missing);
  }

  if (accepted > 0) {
    alerts.push(...budgetAlerts(budgets));
  }

  // Only alerts whose INSERT stored a row are reported and delivered. A
  // deterministic id that already exists — a retried batch, a breach already
  // raised this period — is the same finding, not a new page.
  const stored: IngestAlert[] = [];
  for (const a of alerts) {
    const id = a.id ?? `al_${now}_${randomUUID()}`;
    const r = await c.execute({
      sql: `INSERT OR IGNORE INTO alerts (id, org_id, ts, kind, severity, workload_id, message, detail, acknowledged_at)
            VALUES (?,?,?,?,?,?,?,NULL,NULL)`,
      args: [id, orgId, now, a.kind, a.severity, a.workloadId, a.message],
    });
    if (inserted(r)) stored.push({ ...a, id });
  }

  return {
    accepted,
    duplicates,
    tracesClosed,
    actionsAccepted,
    qualityAccepted,
    evidenceAccepted,
    evidenceRedacted: [...evidenceRedacted].sort(),
    priced,
    unpriced,
    alerts: stored.length,
    circuitBreaks: breakers,
    alertRecords: stored,
  };
}

function eventAlerts(
  e: EventInput,
  x: { costUsd: number; wasPriced: boolean; matches: string[]; offAllowlist: boolean },
): IngestAlert[] {
  const out: IngestAlert[] = [];
  if (!x.wasPriced) {
    out.push({
      kind: 'stale_pricing', severity: 'warn', workloadId: e.workloadId,
      message: `No rate card for "${e.modelId}". Its spend is recorded as $0 and is therefore invisible in every total on this dashboard.`,
    });
  }
  if (x.matches.length && x.offAllowlist) {
    out.push({
      kind: 'off_allowlist', severity: 'critical', workloadId: e.workloadId,
      message: `${x.matches.join(', ')} detected in a request to ${e.provider} (${e.modelId}), which is not on the approved provider allowlist.`,
    });
  } else if (x.matches.length) {
    out.push({
      kind: 'sensitive_data', severity: 'warn', workloadId: e.workloadId,
      message: `${x.matches.join(', ')} detected in a request to ${e.provider}. Confirm this workload is cleared to send it.`,
    });
  } else if (x.offAllowlist) {
    out.push({
      kind: 'off_allowlist', severity: 'warn', workloadId: e.workloadId,
      message: `Traffic to unapproved provider "${e.provider}". Add it to ARK_PROVIDER_ALLOWLIST or route it elsewhere.`,
    });
  }
  return out;
}

/**
 * English for each class `redactMetadata` can report. A fixed table, because
 * the point of the class vocabulary is that everything written here is ours.
 */
const REDACTION_CLASS_LABELS: Record<string, string> = {
  payload_name: 'a field named as a payload or a credential',
  non_scalar: 'a nested object or array',
  email: 'an email address',
  us_ssn: 'a national insurance or social security number',
  credit_card: 'a card number',
  us_phone: 'a phone number',
  api_key: 'an API key',
  iban: 'a bank account number',
};

/**
 * Something reached ingest that the SDK should already have stripped, which
 * means a sender is mis-integrated. Raised per observation, so it names the
 * workload that actually carried the field rather than whichever row in the
 * batch happened to have a workload id.
 *
 * What it must not do is repeat the caller's key names. They are free text of
 * up to 64 characters and a key can be the sensitive value itself —
 * `bob@example.com_token` is both a key name and an email address — so an
 * alert that quoted them would make this control the very leak it exists to
 * report. The names go back to the sender in the ingest response, which is not
 * stored; what is stored is the class, drawn from a table this file owns. The
 * identifying fields below (`id`, `operation`) are columns on the evidence row
 * itself, so naming them here adds no channel that the row did not already
 * open.
 */
function redactionAlert(e: EvidenceInput, classes: string[], fields: number): IngestAlert {
  const what = classes.map((c) => REDACTION_CLASS_LABELS[c] ?? c).join(', ');
  return {
    // Derived from the evidence id, like the alert below, so a retried batch
    // reports the finding once.
    id: `al_redact_${e.id}`,
    kind: 'sensitive_data',
    severity: 'warn',
    workloadId: e.workloadId ?? null,
    message: `Protocol evidence "${e.operation}" arrived with ${fields} metadata ${fields === 1 ? 'field' : 'fields'} that could not be stored: ${what}. They were dropped before storage — ARK records normalised evidence, not protocol payloads. The field names are in the ingest response rather than here, because a key name can itself be the sensitive value. Normalise with @ark/protocols; see docs/07-protocol-evidence.md.`,
  };
}

/**
 * An operation that required a human signature, completed anyway, and has no
 * signature on it.
 *
 * Three conditions, and the third is the one that is easy to get wrong.
 * `pending` is not a finding — an approval that has been requested and not yet
 * answered is the system working, and alerting on it would mean every
 * in-flight request pages somebody. Neither are `error`, `blocked` or
 * `denied`: nothing happened, so nothing needed approving. The finding is an
 * operation that *went through* with nobody accountable for it, which is the
 * same shape as `unapproved_action` on the actions table and for the same
 * reason.
 *
 * Severity follows the risk the observer attached, because a missing signature
 * on a $475 payment mandate and one on a read-only tool call are not the same
 * page at 3am.
 */
function approvalMissingAlert(e: EvidenceInput): IngestAlert | null {
  if (!e.requiredApproval) return null;
  if (e.approvedBy) return null;
  if (!COMPLETED_OUTCOMES.includes(e.outcome)) return null;

  const severity = e.risk === 'critical' || e.risk === 'high' ? 'critical' : e.risk === 'medium' ? 'warn' : 'info';
  const where = [e.actor, e.target].filter(Boolean).join(' → ');
  const value = e.valueUsd != null ? ` It acted on $${e.valueUsd.toFixed(2)}.` : '';

  return {
    // Derived from the evidence id, so re-posting the same observation does
    // not accumulate alerts. Matches `al_unap_` on actions.
    id: `al_apprmiss_${e.id}`,
    kind: 'approval_missing',
    severity,
    workloadId: e.workloadId ?? null,
    message: `${e.protocol.toUpperCase()} "${e.operation}"${where ? ` (${where})` : ''} completed with no approval record, and this operation requires one.${value} Risk was recorded as ${e.risk}.`,
  };
}


async function qualityRegressionAlert(
  c: Client,
  orgId: string,
  workloadId: string,
  minSamples: number,
  now: number,
): Promise<IngestAlert | null> {
  const from = now - 30 * 864e5;
  const r = await c.execute({
    sql: `SELECT COUNT(*) n, SUM(correct) ok FROM quality_samples WHERE org_id=? AND workload_id=? AND ts>=?`,
    args: [orgId, workloadId, from],
  });
  const samples = n(r.rows[0]?.n);
  if (samples < minSamples) return null;
  const accuracy = n(r.rows[0]?.ok) / samples;
  const threshold = await accuracyThreshold(c, orgId, workloadId);
  if (accuracy >= threshold) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    id: `al_qreg_${workloadId}_${day}`,
    kind: 'quality_regression',
    severity: 'critical',
    workloadId,
    message: `Accuracy ${(accuracy * 100).toFixed(1)}% on ${samples} judged samples is below the ${(threshold * 100).toFixed(0)}% threshold this workload committed to.`,
  };
}

/**
 * Read the stored evaluation plan's accuracy threshold, or the rubric default.
 * Org-scoped: the workload id is caller input, and another tenant's plan must
 * not set this tenant's bar.
 */
async function accuracyThreshold(c: Client, orgId: string, workloadId: string): Promise<number> {
  const r = await c.execute({
    sql: 'SELECT assessment FROM workloads WHERE org_id=? AND id=?',
    args: [orgId, workloadId],
  });
  const raw = r.rows[0]?.assessment;
  if (!raw) return 0.93;
  try {
    const a = JSON.parse(String(raw));
    const metric = (a?.evaluation?.metrics ?? []).find((m: { name?: string }) => /accuracy/i.test(m.name ?? ''));
    const m = String(metric?.threshold ?? '').match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return Number(m[1]) / 100;
  } catch {
    /* stub assessments from older seeds */
  }
  return 0.93;
}

interface LoadedBudget {
  id: string;
  scope: 'org' | 'workload';
  scopeId: string | null;
  limit: number;
  warnAt: number;
  enforcement: BudgetEnforcement;
  window: PeriodWindow;
  /** Spend in the current period, advanced as the batch is applied. */
  spent: number;
}

/**
 * The org's enforceable budgets, each with its spend so far in its own UTC
 * period (day, week or month). Loaded once per batch; `applyIngest` advances
 * `spent` for every stored event. Application- and user-scoped budgets are
 * reported on the Budgets page but not enforced here, as before.
 */
async function loadBudgets(c: Client, orgId: string, now: number): Promise<LoadedBudget[]> {
  const rows = await c.execute({ sql: 'SELECT * FROM budgets WHERE org_id=?', args: [orgId] });
  const out: LoadedBudget[] = [];
  for (const b of rows.rows) {
    const scope = s(b.scope);
    if (scope !== 'org' && scope !== 'workload') continue;
    const scopeId = b.scope_id ? s(b.scope_id) : null;
    const window = periodWindow(b.period, now);
    const where = scope === 'workload' ? 'AND workload_id=?' : '';
    const args: Array<string | number> = [orgId, window.startMs];
    if (scope === 'workload') args.push(scopeId ?? '');
    const spentR = await c.execute({
      sql: `SELECT COALESCE(SUM(cost_usd),0) spent FROM events WHERE org_id=? AND ts>=? ${where}`,
      args,
    });
    out.push({
      id: s(b.id),
      scope,
      scopeId,
      limit: n(b.limit_usd),
      warnAt: n(b.warn_at_pct),
      enforcement: s(b.enforcement) as BudgetEnforcement,
      window,
      spent: n(spentR.rows[0]?.spent),
    });
  }
  return out;
}

function applicableBudgets(budgets: LoadedBudget[], workloadId: string): LoadedBudget[] {
  return budgets.filter((b) => b.scope === 'org' || b.scopeId === workloadId);
}

/** Period-keyed ids, so a breach is raised once per budget per period, not per batch. */
function budgetAlerts(budgets: LoadedBudget[]): IngestAlert[] {
  const out: IngestAlert[] = [];
  for (const b of budgets) {
    if (b.limit <= 0) continue;
    const pct = (b.spent / b.limit) * 100;
    const workloadId = b.scope === 'workload' ? b.scopeId : null;
    if (pct >= 100) {
      out.push({
        id: `al_budget_${b.id}_${b.window.key}_breach`,
        kind: 'budget_breach',
        severity: 'critical',
        workloadId,
        message: `Budget breached: $${b.spent.toFixed(2)} against a $${b.limit.toFixed(2)} ${b.window.period} ceiling. Enforcement is set to "${b.enforcement}".`,
      });
    } else if (pct >= b.warnAt) {
      out.push({
        id: `al_budget_${b.id}_${b.window.key}_warn`,
        kind: 'budget_warn',
        severity: 'warn',
        workloadId,
        message: `Budget at ${pct.toFixed(0)}% with time left in the ${b.window.period}. Projected to overrun.`,
      });
    }
  }
  return out;
}

function pushBreak(breakers: CircuitBreak[], traceId: string, reason: string) {
  if (breakers.some((b) => b.traceId === traceId && b.reason === reason)) return;
  breakers.push({ traceId, reason });
}

export type { ActionInput };
