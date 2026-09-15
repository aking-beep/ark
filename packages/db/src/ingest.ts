import type { Client } from '@libsql/client';
import {
  type IngestBody,
  type EventInput,
  type ActionInput,
  priceEvent,
  sensitiveLabels,
  budgetAction,
  strictestAction,
  type BudgetEnforcement,
  type BudgetAction,
} from '@ark/core';
import { raw } from './queries.js';

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
}

export interface IngestResult {
  accepted: number;
  tracesClosed: number;
  actionsAccepted: number;
  qualityAccepted: number;
  priced: number;
  unpriced: number;
  alerts: number;
  circuitBreaks: CircuitBreak[];
  alertRecords?: IngestAlert[];
}

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '');

/**
 * Persist a batch and run detection. This is the service the ingest route
 * calls — the route itself only authorises and parses.
 */
export async function applyIngest(body: IngestBody, opts: ApplyIngestOpts): Promise<IngestResult> {
  const c = opts.client ?? raw();
  const { orgId, events, traces, actions, qualitySamples } = body;
  const qualityMin = opts.qualityMinSamples ?? 20;
  const alerts: IngestAlert[] = [];
  const breakers: CircuitBreak[] = [];
  let priced = 0;
  let unpriced = 0;
  let accepted = 0;
  const actionByWorkload = new Map<string, BudgetAction>();

  for (const e of events) {
    const act = await workloadBudgetAction(c, orgId, e.workloadId, actionByWorkload);
    if (act === 'block') {
      pushBreak(breakers, e.traceId, 'budget_block');
      continue;
    }
    if (act === 'throttle') {
      pushBreak(breakers, e.traceId, 'budget_throttle');
    }

    const ts = e.ts ?? Date.now();
    const { costUsd, priced: wasPriced } = priceEvent(e);
    wasPriced ? priced++ : unpriced++;
    const matches = sensitiveLabels(e);
    const offAllowlist = !opts.allowlist.includes(e.provider);

    await c.execute({
      sql: `INSERT OR IGNORE INTO events
              (id, org_id, trace_id, workload_id, ts, provider, model_id, turn,
               input_tokens, output_tokens, cached_input_tokens, cost_usd, latency_ms,
               status, error_kind, sensitive_matches, off_allowlist, user_id, application)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        e.id, orgId, e.traceId, e.workloadId, ts, e.provider, e.modelId, e.turn,
        e.inputTokens, e.outputTokens, e.cachedInputTokens, costUsd, e.latencyMs,
        e.status, e.errorKind ?? null,
        matches.length ? JSON.stringify(matches) : null,
        offAllowlist ? 1 : 0,
        e.userId ?? null, e.application ?? null,
      ],
    });

    await c.execute({
      sql: `INSERT OR IGNORE INTO traces (id, org_id, workload_id, started_at, outcome, total_cost_usd, total_turns, retries, escalated_to_human)
            VALUES (?,?,?,?,'pending',0,0,0,0)`,
      args: [e.traceId, orgId, e.workloadId, ts],
    });
    await c.execute({
      sql: `UPDATE traces SET total_cost_usd = total_cost_usd + ?, total_turns = MAX(total_turns, ?) WHERE id = ?`,
      args: [costUsd, e.turn + 1, e.traceId],
    });

    alerts.push(...eventAlerts(e, { costUsd, wasPriced, matches, offAllowlist }));
    accepted++;
  }

  const touched = [...new Set(events.filter((e) => {
    const act = actionByWorkload.get(e.workloadId);
    return act !== 'block';
  }).map((e) => e.traceId))];
  for (const traceId of touched) {
    const r = await c.execute({
      sql: 'SELECT workload_id, total_turns, total_cost_usd FROM traces WHERE id = ?',
      args: [traceId],
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

  for (const t of traces) {
    await c.execute({
      sql: `UPDATE traces SET outcome = ?, retries = ?, escalated_to_human = ?, ended_at = ?, actor_id = COALESCE(?, actor_id)
            WHERE id = ?`,
      args: [t.outcome, t.retries, t.escalatedToHuman ? 1 : 0, t.endedAt ?? Date.now(), t.actorId ?? null, t.traceId],
    });
  }

  for (const a of actions) {
    const ts = a.ts ?? Date.now();
    await c.execute({
      sql: `INSERT OR IGNORE INTO traces (id, org_id, workload_id, started_at, outcome, total_cost_usd, total_turns, retries, escalated_to_human)
            VALUES (?,?,?,?,'pending',0,0,0,0)`,
      args: [a.traceId, orgId, a.workloadId ?? 'unknown', ts],
    });
    await c.execute({
      sql: `INSERT OR IGNORE INTO actions (id, org_id, trace_id, ts, name, system, blast_radius, value_usd, approved_by, required_approval, credential_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        a.id, orgId, a.traceId, ts, a.name, a.system, a.blastRadius,
        a.valueUsd ?? null, a.approvedBy ?? null, a.requiredApproval ? 1 : 0, a.credentialId ?? null,
      ],
    });
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

  for (const q of qualitySamples) {
    const ts = q.ts ?? Date.now();
    await c.execute({
      sql: `INSERT OR IGNORE INTO quality_samples (id, org_id, workload_id, trace_id, ts, correct, judged_by, note)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [q.id, orgId, q.workloadId, q.traceId ?? null, ts, q.correct ? 1 : 0, q.judgedBy, q.note ?? null],
    });
  }

  const qualityWorkloads = [...new Set(qualitySamples.map((q) => q.workloadId))];
  for (const wid of qualityWorkloads) {
    const qreg = await qualityRegressionAlert(c, orgId, wid, qualityMin);
    if (qreg) alerts.push(qreg);
  }

  if (accepted > 0) {
    alerts.push(...(await budgetAlerts(c, orgId)));
  }

  let seq = 0;
  for (const a of alerts) {
    const id = a.id ?? `al_${Date.now()}_${seq++}`;
    await c.execute({
      sql: `INSERT OR IGNORE INTO alerts (id, org_id, ts, kind, severity, workload_id, message, detail, acknowledged_at)
            VALUES (?,?,?,?,?,?,?,NULL,NULL)`,
      args: [id, orgId, Date.now(), a.kind, a.severity, a.workloadId, a.message],
    });
  }

  return {
    accepted,
    tracesClosed: traces.length,
    actionsAccepted: actions.length,
    qualityAccepted: qualitySamples.length,
    priced,
    unpriced,
    alerts: alerts.length,
    circuitBreaks: breakers,
    alertRecords: alerts,
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

async function qualityRegressionAlert(
  c: Client,
  orgId: string,
  workloadId: string,
  minSamples: number,
): Promise<IngestAlert | null> {
  const from = Date.now() - 30 * 864e5;
  const r = await c.execute({
    sql: `SELECT COUNT(*) n, SUM(correct) ok FROM quality_samples WHERE org_id=? AND workload_id=? AND ts>=?`,
    args: [orgId, workloadId, from],
  });
  const samples = n(r.rows[0]?.n);
  if (samples < minSamples) return null;
  const accuracy = n(r.rows[0]?.ok) / samples;
  const threshold = await accuracyThreshold(c, workloadId);
  if (accuracy >= threshold) return null;
  const day = new Date().toISOString().slice(0, 10);
  return {
    id: `al_qreg_${workloadId}_${day}`,
    kind: 'quality_regression',
    severity: 'critical',
    workloadId,
    message: `Accuracy ${(accuracy * 100).toFixed(1)}% on ${samples} judged samples is below the ${(threshold * 100).toFixed(0)}% threshold this workload committed to.`,
  };
}

/** Read the stored evaluation plan's accuracy threshold, or the rubric default. */
async function accuracyThreshold(c: Client, workloadId: string): Promise<number> {
  const r = await c.execute({ sql: 'SELECT assessment FROM workloads WHERE id=?', args: [workloadId] });
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

async function budgetAlerts(c: Client, orgId: string): Promise<IngestAlert[]> {
  const rows = await c.execute({ sql: 'SELECT * FROM budgets WHERE org_id=?', args: [orgId] });
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const periodKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const out: IngestAlert[] = [];

  for (const b of rows.rows) {
    const scope = s(b.scope);
    const scopeId = b.scope_id ? s(b.scope_id) : null;
    const where = scope === 'workload' ? 'AND workload_id=?' : '';
    const args: Array<string | number> = [orgId, start.getTime()];
    if (scope === 'workload') args.push(scopeId ?? '');
    const spentR = await c.execute({
      sql: `SELECT COALESCE(SUM(cost_usd),0) spent FROM events WHERE org_id=? AND ts>=? ${where}`,
      args,
    });
    const spent = n(spentR.rows[0]?.spent);
    const limit = n(b.limit_usd);
    if (limit <= 0) continue;
    const pct = (spent / limit) * 100;
    const warnAt = n(b.warn_at_pct);
    const id = s(b.id);
    const workloadId = scope === 'workload' ? scopeId : null;

    if (pct >= 100) {
      out.push({
        id: `al_budget_${id}_${periodKey}_breach`,
        kind: 'budget_breach',
        severity: 'critical',
        workloadId,
        message: `Budget breached: $${spent.toFixed(2)} against a $${limit.toFixed(2)} ${s(b.period)} ceiling. Enforcement is set to "${s(b.enforcement)}".`,
      });
    } else if (pct >= warnAt) {
      out.push({
        id: `al_budget_${id}_${periodKey}_warn`,
        kind: 'budget_warn',
        severity: 'warn',
        workloadId,
        message: `Budget at ${pct.toFixed(0)}% with days left in the period. Projected to overrun.`,
      });
    }
  }
  return out;
}

function pushBreak(breakers: CircuitBreak[], traceId: string, reason: string) {
  if (breakers.some((b) => b.traceId === traceId && b.reason === reason)) return;
  breakers.push({ traceId, reason });
}

function monthStartMs(): number {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

async function workloadBudgetAction(
  c: Client,
  orgId: string,
  workloadId: string,
  cache: Map<string, BudgetAction>,
): Promise<BudgetAction> {
  const hit = cache.get(workloadId);
  if (hit) return hit;
  const rows = await c.execute({ sql: 'SELECT * FROM budgets WHERE org_id=?', args: [orgId] });
  const actions: BudgetAction[] = [];
  const from = monthStartMs();
  for (const b of rows.rows) {
    const scope = s(b.scope);
    const scopeId = b.scope_id ? s(b.scope_id) : null;
    if (scope === 'workload' && scopeId !== workloadId) continue;
    if (scope !== 'org' && scope !== 'workload') continue;
    const where = scope === 'workload' ? 'AND workload_id=?' : '';
    const args: Array<string | number> = [orgId, from];
    if (scope === 'workload') args.push(scopeId ?? '');
    const spentR = await c.execute({
      sql: `SELECT COALESCE(SUM(cost_usd),0) spent FROM events WHERE org_id=? AND ts>=? ${where}`,
      args,
    });
    actions.push(budgetAction(n(spentR.rows[0]?.spent), n(b.limit_usd), s(b.enforcement) as BudgetEnforcement));
  }
  const act = strictestAction(actions);
  cache.set(workloadId, act);
  return act;
}

export type { ActionInput };
