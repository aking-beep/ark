import { createClient, type Client } from '@libsql/client';
import { databaseUrl } from './client.js';
import {
  buildCalibration, findSubstitutions, byId, blendedRate,
  type CalibrationSet, type Substitution, type OutcomeRow,
} from '@ark/core';

let _c: Client | null = null;
export function raw(): Client {
  if (!_c) _c = createClient({ url: databaseUrl(), authToken: process.env.ARK_DATABASE_AUTH_TOKEN });
  return _c;
}

const since = (days: number) => Date.now() - days * 864e5;
const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '');

export interface SpendSummary {
  totalUsd: number;
  traces: number;
  successfulTraces: number;
  /** The headline number. Not cost per call. */
  costPerSuccessfulOutcomeUsd: number;
  /** Spend that bought nothing: failed traces plus retry overhead. */
  wastedUsd: number;
  wastedPct: number;
  byWorkload: { workloadId: string; name: string; costUsd: number; traces: number; costPerOutcome: number; successRate: number }[];
  byModel: { modelId: string; costUsd: number; calls: number; share: number }[];
  daily: { day: string; costUsd: number }[];
}

export async function spendSummary(orgId: string, days = 30): Promise<SpendSummary> {
  const c = raw();
  const from = since(days);

  const totals = await c.execute({
    sql: `SELECT COALESCE(SUM(total_cost_usd),0) total, COUNT(*) traces,
                 SUM(CASE WHEN outcome='success' THEN 1 ELSE 0 END) ok,
                 COALESCE(SUM(CASE WHEN outcome<>'success' THEN total_cost_usd ELSE 0 END),0) wasted
          FROM traces WHERE org_id=? AND started_at>=?`,
    args: [orgId, from],
  });
  const t = totals.rows[0]!;
  const total = n(t.total), traces = n(t.traces), ok = n(t.ok), wasted = n(t.wasted);

  const byWorkload = await c.execute({
    sql: `SELECT t.workload_id id, w.name, COALESCE(SUM(t.total_cost_usd),0) cost, COUNT(*) cnt,
                 SUM(CASE WHEN t.outcome='success' THEN 1 ELSE 0 END) ok
          FROM traces t JOIN workloads w ON w.id=t.workload_id
          WHERE t.org_id=? AND t.started_at>=? GROUP BY t.workload_id ORDER BY cost DESC`,
    args: [orgId, from],
  });

  const byModel = await c.execute({
    sql: `SELECT model_id, COALESCE(SUM(cost_usd),0) cost, COUNT(*) calls
          FROM events WHERE org_id=? AND ts>=? GROUP BY model_id ORDER BY cost DESC`,
    args: [orgId, from],
  });

  const daily = await c.execute({
    sql: `SELECT date(ts/1000,'unixepoch') day, COALESCE(SUM(cost_usd),0) cost
          FROM events WHERE org_id=? AND ts>=? GROUP BY day ORDER BY day`,
    args: [orgId, from],
  });

  return {
    totalUsd: total,
    traces,
    successfulTraces: ok,
    costPerSuccessfulOutcomeUsd: ok > 0 ? total / ok : 0,
    wastedUsd: wasted,
    wastedPct: total > 0 ? (wasted / total) * 100 : 0,
    byWorkload: byWorkload.rows.map((r) => ({
      workloadId: s(r.id), name: s(r.name), costUsd: n(r.cost), traces: n(r.cnt),
      costPerOutcome: n(r.ok) > 0 ? n(r.cost) / n(r.ok) : 0,
      successRate: n(r.cnt) > 0 ? n(r.ok) / n(r.cnt) : 0,
    })),
    byModel: byModel.rows.map((r) => ({
      modelId: s(r.model_id), costUsd: n(r.cost), calls: n(r.calls),
      share: total > 0 ? (n(r.cost) / total) * 100 : 0,
    })),
    daily: daily.rows.map((r) => ({ day: s(r.day), costUsd: n(r.cost) })),
  };
}

/** Observed call shape per workload — the input to both substitution and calibration. */
export async function observedShape(orgId: string, workloadId: string, days = 30) {
  const c = raw();
  const r = await c.execute({
    sql: `SELECT AVG(input_tokens) inp, AVG(output_tokens) outp,
                 COALESCE(SUM(cached_input_tokens),0)*1.0/NULLIF(SUM(input_tokens),0) cache,
                 COUNT(*) calls
          FROM events WHERE org_id=? AND workload_id=? AND ts>=? AND turn=0`,
    args: [orgId, workloadId, since(days)],
  });
  const tr = await c.execute({
    // NOTE the denominator on `retries`. Successful traces carry 0 retries, so
    // AVG(retries) over every trace is retries per *trace*, not per *failure* —
    // a number smaller by exactly the success rate. Getting this wrong
    // understates cost per outcome and, worse, disagrees with the figure the
    // calibration endpoint exports, which is the one thing in this system that
    // must never happen: two surfaces showing different values for the same
    // named quantity.
    sql: `SELECT AVG(total_turns) turns, COUNT(*) cnt,
                 SUM(CASE WHEN outcome<>'success' THEN 1 ELSE 0 END) failed,
                 SUM(retries) retries_total
          FROM traces WHERE org_id=? AND workload_id=? AND started_at>=?`,
    args: [orgId, workloadId, since(days)],
  });
  const g = await c.execute({
    // Growth is (last turn − first turn) / gaps, NOT (max − min) / gaps.
    // Token counts are noisy, so max and min are order statistics that drift
    // apart with sample size: on a flat workload they report growth where
    // there is none, and on a growing one they overstate it. Turn 0 and turn
    // MAX are the two points the definition actually refers to. This is also
    // the formula packages/core uses, and the two must not disagree.
    sql: `SELECT AVG(growth) g FROM (
            SELECT (MAX(CASE WHEN turn = mt THEN input_tokens END)
                  - MAX(CASE WHEN turn = 0  THEN input_tokens END)) * 1.0 / mt AS growth
            FROM (
              SELECT trace_id, turn, input_tokens,
                     MAX(turn) OVER (PARTITION BY trace_id) AS mt
              FROM events WHERE org_id=? AND workload_id=? AND ts>=?
            )
            GROUP BY trace_id, mt HAVING mt > 0)`,
    args: [orgId, workloadId, since(days)],
  });

  const a = r.rows[0]!, b = tr.rows[0]!;
  const cnt = n(b.cnt);
  const failed = n(b.failed);
  return {
    inputTokens: Math.round(n(a.inp)),
    outputTokens: Math.round(n(a.outp)),
    cacheHitRate: n(a.cache),
    turnsPerOutcome: n(b.turns),
    contextGrowthPerTurn: Math.round(n(g.rows[0]?.g)),
    failureRate: cnt > 0 ? failed / cnt : 0,
    retriesPerFailure: failed > 0 ? n(b.retries_total) / failed : 0,
    sampleSize: cnt,
  };
}

export interface Opportunity extends Substitution {
  workloadId: string;
  workloadName: string;
  annualisedSavingUsd: number;
}

/**
 * The page that justifies the product. Walks each workload, takes its OBSERVED
 * call shape, and asks whether a cheaper model would plausibly do.
 */
export async function substitutionOpportunities(orgId: string, days = 30): Promise<Opportunity[]> {
  const c = raw();
  const workloads = await c.execute({
    sql: `SELECT w.id, w.name, w.spec, e.model_id, COUNT(*) calls
          FROM workloads w JOIN events e ON e.workload_id=w.id
          WHERE w.org_id=? AND e.ts>=? GROUP BY w.id, e.model_id ORDER BY calls DESC`,
    args: [orgId, since(days)],
  });

  const seen = new Set<string>();
  const out: Opportunity[] = [];

  for (const row of workloads.rows) {
    const wid = s(row.id);
    if (seen.has(wid)) continue;          // dominant model only
    seen.add(wid);

    const spec = JSON.parse(s(row.spec));
    const shape = await observedShape(orgId, wid, days);
    if (shape.sampleSize < 20) continue;

    const caps: string[] = ['text'];
    if (spec.output?.mustBeStructured) caps.push('structured_output');
    if (spec.actions?.length) caps.push('tool_use');
    if (spec.input?.modality?.includes('image')) caps.push('vision');

    const monthly = (shape.sampleSize / days) * 30;
    const subs = findSubstitutions(s(row.model_id), shape, monthly, caps as any, shape.sampleSize);

    for (const sub of subs.slice(0, 2)) {
      out.push({
        ...sub,
        workloadId: wid,
        workloadName: s(row.name),
        annualisedSavingUsd: Math.round(sub.monthlySavingUsd * 12 * 100) / 100,
      });
    }
  }
  return out.sort((a, b) => b.monthlySavingUsd - a.monthlySavingUsd);
}

export interface BudgetStatus {
  id: string; scope: string; scopeId: string | null; label: string;
  limitUsd: number; spentUsd: number; pct: number;
  enforcement: string; state: 'ok' | 'warn' | 'breached'; projectedUsd: number;
}

export async function budgetStatus(orgId: string): Promise<BudgetStatus[]> {
  const c = raw();
  const rows = await c.execute({ sql: 'SELECT * FROM budgets WHERE org_id=?', args: [orgId] });
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

  const out: BudgetStatus[] = [];
  for (const b of rows.rows) {
    const scope = s(b.scope), scopeId = b.scope_id ? s(b.scope_id) : null;
    const where = scope === 'workload' ? 'AND workload_id=?' : '';
    const args: any[] = [orgId, start.getTime()];
    if (scope === 'workload') args.push(scopeId);

    const r = await c.execute({
      sql: `SELECT COALESCE(SUM(cost_usd),0) spent FROM events WHERE org_id=? AND ts>=? ${where}`,
      args,
    });
    const spent = n(r.rows[0]?.spent);
    const limit = n(b.limit_usd);
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const projected = dayOfMonth > 0 ? (spent / dayOfMonth) * daysInMonth : spent;

    let label = 'Organisation';
    if (scope === 'workload' && scopeId) {
      const w = await c.execute({ sql: 'SELECT name FROM workloads WHERE id=?', args: [scopeId] });
      label = s(w.rows[0]?.name ?? scopeId);
    }

    out.push({
      id: s(b.id), scope, scopeId, label, limitUsd: limit, spentUsd: spent, pct,
      enforcement: s(b.enforcement),
      state: pct >= 100 ? 'breached' : pct >= n(b.warn_at_pct) ? 'warn' : 'ok',
      projectedUsd: projected,
    });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

export async function recentAlerts(orgId: string, limit = 25) {
  const r = await raw().execute({
    sql: `SELECT a.*, w.name wname FROM alerts a LEFT JOIN workloads w ON w.id=a.workload_id
          WHERE a.org_id=? ORDER BY a.ts DESC LIMIT ?`,
    args: [orgId, limit],
  });
  return r.rows.map((x) => ({
    id: s(x.id), ts: n(x.ts), kind: s(x.kind), severity: s(x.severity),
    workloadName: x.wname ? s(x.wname) : null, message: s(x.message),
    acknowledged: x.acknowledged_at != null,
  }));
}

/** Governance view: actions taken, and which lacked the required approval. */
export async function actionAudit(orgId: string, days = 30) {
  const r = await raw().execute({
    sql: `SELECT a.name, a.system, a.blast_radius, COUNT(*) cnt,
                 SUM(CASE WHEN a.required_approval=1 AND a.approved_by IS NULL THEN 1 ELSE 0 END) unapproved,
                 COALESCE(SUM(a.value_usd),0) value
          FROM actions a WHERE a.org_id=? AND a.ts>=? GROUP BY a.name, a.system ORDER BY unapproved DESC, cnt DESC`,
    args: [orgId, since(days)],
  });
  return r.rows.map((x) => ({
    name: s(x.name), system: s(x.system), blastRadius: s(x.blast_radius),
    count: n(x.cnt), unapproved: n(x.unapproved), valueUsd: n(x.value),
  }));
}

/** Measured accuracy from human judgements — the other half of unit economics. */
export async function qualityByWorkload(orgId: string, days = 30) {
  const r = await raw().execute({
    sql: `SELECT q.workload_id id, w.name, COUNT(*) n, SUM(q.correct) correct
          FROM quality_samples q JOIN workloads w ON w.id=q.workload_id
          WHERE q.org_id=? AND q.ts>=? GROUP BY q.workload_id`,
    args: [orgId, since(days)],
  });
  return r.rows.map((x) => ({
    workloadId: s(x.id), name: s(x.name), sampleSize: n(x.n),
    accuracy: n(x.n) > 0 ? n(x.correct) / n(x.n) : 0,
  }));
}

/**
 * Emit the calibration set that AIFit consumes. This is the join between the
 * two products, and the reason Control is built first.
 */
export async function calibration(orgId: string, days = 30): Promise<CalibrationSet> {
  const c = raw();
  const r = await c.execute({
    sql: `SELECT w.pattern, t.total_turns turns, t.outcome, t.retries, t.total_cost_usd cost,
                 (SELECT input_tokens FROM events e WHERE e.trace_id=t.id ORDER BY turn ASC LIMIT 1) first_in,
                 (SELECT input_tokens FROM events e WHERE e.trace_id=t.id ORDER BY turn DESC LIMIT 1) last_in,
                 (SELECT COALESCE(SUM(cached_input_tokens),0) FROM events e WHERE e.trace_id=t.id) cached,
                 (SELECT COALESCE(SUM(input_tokens),0) FROM events e WHERE e.trace_id=t.id) total_in
          FROM traces t JOIN workloads w ON w.id=t.workload_id
          WHERE t.org_id=? AND t.started_at>=?`,
    args: [orgId, since(days)],
  });

  const rows: OutcomeRow[] = r.rows.map((x) => ({
    pattern: s(x.pattern),
    turns: n(x.turns),
    inputTokensFirstTurn: n(x.first_in),
    inputTokensLastTurn: n(x.last_in),
    succeeded: s(x.outcome) === 'success',
    retries: n(x.retries),
    cachedInputTokens: n(x.cached),
    totalInputTokens: n(x.total_in),
    costUsd: n(x.cost),
  }));

  return buildCalibration(rows, { basis: 'measured', windowDays: days, orgId });
}

export async function listWorkloads(orgId: string) {
  const r = await raw().execute({
    sql: `SELECT id, name, pattern, status, spec, assessment FROM workloads WHERE org_id=? ORDER BY name`,
    args: [orgId],
  });
  return r.rows.map((x) => ({
    id: s(x.id), name: s(x.name), pattern: s(x.pattern), status: s(x.status),
    spec: JSON.parse(s(x.spec)),
    assessment: x.assessment ? JSON.parse(s(x.assessment)) : null,
  }));
}

/** Where the money went that bought nothing. */
export async function wasteBreakdown(orgId: string, days = 30) {
  const c = raw();
  const from = since(days);
  const r = await c.execute({
    sql: `SELECT
            COALESCE(SUM(CASE WHEN outcome='failure' THEN total_cost_usd ELSE 0 END),0) failed,
            COALESCE(SUM(CASE WHEN outcome='escalated' THEN total_cost_usd ELSE 0 END),0) escalated,
            COALESCE(SUM(CASE WHEN outcome='abandoned' THEN total_cost_usd ELSE 0 END),0) abandoned
          FROM traces WHERE org_id=? AND started_at>=?`,
    args: [orgId, from],
  });
  const runaway = await c.execute({
    sql: `SELECT COALESCE(SUM(total_cost_usd),0) cost, COUNT(*) cnt FROM traces
          WHERE org_id=? AND started_at>=? AND total_turns > (
            SELECT AVG(total_turns)*3 FROM traces WHERE org_id=? AND started_at>=?)`,
    args: [orgId, from, orgId, from],
  });
  const x = r.rows[0]!;
  return {
    failedUsd: n(x.failed),
    escalatedUsd: n(x.escalated),
    abandonedUsd: n(x.abandoned),
    runawayUsd: n(runaway.rows[0]?.cost),
    runawayTraces: n(runaway.rows[0]?.cnt),
  };
}

/**
 * Versioned priors. Never UPDATE — when a forecast is wrong we need to know
 * what the system believed at the time, not what it believes now.
 */
export async function persistCalibrationSnapshot(
  orgId: string,
  days: number,
  set: CalibrationSet,
  minIntervalMs = 60_000,
): Promise<{ wrote: boolean }> {
  const last = await raw().execute({
    sql: `SELECT generated_at FROM calibration_snapshots
          WHERE org_id=? AND window_days=? ORDER BY generated_at DESC LIMIT 1`,
    args: [orgId, days],
  });
  const prev = last.rows[0]?.generated_at;
  if (prev != null && Date.now() - Number(prev) < minIntervalMs) {
    return { wrote: false };
  }
  await raw().execute({
    sql: `INSERT INTO calibration_snapshots (id, org_id, generated_at, window_days, basis, payload)
          VALUES (?,?,?,?,?,?)`,
    args: [
      `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orgId,
      Date.now(),
      days,
      set.basis,
      JSON.stringify(set),
    ],
  });
  return { wrote: true };
}
