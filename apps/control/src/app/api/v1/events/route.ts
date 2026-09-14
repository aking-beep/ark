import { NextResponse } from 'next/server';
import { raw } from '@ark/db';
import { IngestBody, priceEvent, detectSensitive, allowlist, authorize } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Above this many turns in a single trace, something is looping. */
const TURN_CEILING = Number(process.env.ARK_TURN_CEILING ?? 25);
/** Above this cost for a single unit of work, stop and look. */
const TRACE_COST_CEILING = Number(process.env.ARK_TRACE_COST_CEILING ?? 1.0);

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = IngestBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 422 });
  }

  const { orgId, events, traces } = parsed.data;
  const c = raw();
  const approved = allowlist();
  const alerts: { kind: string; severity: string; workloadId: string | null; message: string }[] = [];

  let priced = 0;
  let unpriced = 0;

  for (const e of events) {
    const ts = e.ts ?? Date.now();
    const { costUsd, priced: wasPriced } = priceEvent(e);
    wasPriced ? priced++ : unpriced++;

    // Scan locally, persist labels only. The sample never touches the database.
    const matches = e.sensitiveMatches ?? detectSensitive(e.sample);
    const offAllowlist = !approved.includes(e.provider);

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

    // Open the trace lazily so callers never have to post a "start" record.
    await c.execute({
      sql: `INSERT OR IGNORE INTO traces (id, org_id, workload_id, started_at, outcome, total_cost_usd, total_turns, retries, escalated_to_human)
            VALUES (?,?,?,?,'pending',0,0,0,0)`,
      args: [e.traceId, orgId, e.workloadId, ts],
    });
    await c.execute({
      sql: `UPDATE traces SET total_cost_usd = total_cost_usd + ?, total_turns = MAX(total_turns, ?) WHERE id = ?`,
      args: [costUsd, e.turn + 1, e.traceId],
    });

    if (!wasPriced) {
      alerts.push({
        kind: 'stale_pricing', severity: 'warn', workloadId: e.workloadId,
        message: `No rate card for "${e.modelId}". Its spend is recorded as $0 and is therefore invisible in every total on this dashboard.`,
      });
    }
    if (matches.length && offAllowlist) {
      alerts.push({
        kind: 'off_allowlist', severity: 'critical', workloadId: e.workloadId,
        message: `${matches.join(', ')} detected in a request to ${e.provider} (${e.modelId}), which is not on the approved provider allowlist.`,
      });
    } else if (matches.length) {
      alerts.push({
        kind: 'sensitive_data', severity: 'warn', workloadId: e.workloadId,
        message: `${matches.join(', ')} detected in a request to ${e.provider}. Confirm this workload is cleared to send it.`,
      });
    } else if (offAllowlist) {
      alerts.push({
        kind: 'off_allowlist', severity: 'warn', workloadId: e.workloadId,
        message: `Traffic to unapproved provider "${e.provider}". Add it to ARK_PROVIDER_ALLOWLIST or route it elsewhere.`,
      });
    }
  }

  // Circuit-breaker checks: run once per touched trace, not once per event.
  const touched = [...new Set(events.map((e) => e.traceId))];
  const breakers: { traceId: string; reason: string }[] = [];
  for (const traceId of touched) {
    const r = await c.execute({
      sql: 'SELECT workload_id, total_turns, total_cost_usd FROM traces WHERE id = ?',
      args: [traceId],
    });
    const row = r.rows[0];
    if (!row) continue;
    const turns = Number(row.total_turns ?? 0);
    const cost = Number(row.total_cost_usd ?? 0);
    const wid = row.workload_id ? String(row.workload_id) : null;

    if (turns > TURN_CEILING) {
      breakers.push({ traceId, reason: `turn ceiling ${TURN_CEILING} exceeded (${turns})` });
      alerts.push({
        kind: 'loop_runaway', severity: 'warn', workloadId: wid,
        message: `Trace ${traceId} has run ${turns} turns against a ceiling of ${TURN_CEILING} and has spent $${cost.toFixed(2)} on one unit of work.`,
      });
    }
    if (cost > TRACE_COST_CEILING) {
      breakers.push({ traceId, reason: `trace cost ceiling $${TRACE_COST_CEILING} exceeded ($${cost.toFixed(2)})` });
      alerts.push({
        kind: 'circuit_break', severity: 'critical', workloadId: wid,
        message: `Trace ${traceId} cost $${cost.toFixed(2)} against a per-trace ceiling of $${TRACE_COST_CEILING.toFixed(2)}.`,
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

  let seq = 0;
  for (const a of alerts) {
    await c.execute({
      sql: `INSERT OR IGNORE INTO alerts (id, org_id, ts, kind, severity, workload_id, message, detail, acknowledged_at)
            VALUES (?,?,?,?,?,?,?,NULL,NULL)`,
      args: [`al_${Date.now()}_${seq++}`, orgId, Date.now(), a.kind, a.severity, a.workloadId, a.message],
    });
  }

  return NextResponse.json(
    {
      accepted: events.length,
      tracesClosed: traces.length,
      priced,
      unpriced,
      alerts: alerts.length,
      /**
       * The caller is expected to act on this. Control can observe a runaway
       * loop but it cannot reach into your process and stop it — the SDK that
       * posts events is what enforces the break.
       */
      circuitBreaks: breakers,
    },
    { status: 202 },
  );
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/v1/events',
    auth: process.env.ARK_INGEST_TOKEN ? 'Bearer token required' : 'open (set ARK_INGEST_TOKEN to require one)',
    body: {
      orgId: 'org_demo',
      events: [{
        id: 'ev_1', traceId: 'tr_1', workloadId: 'wl_support_triage',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0,
        inputTokens: 2400, outputTokens: 180, cachedInputTokens: 1800,
        latencyMs: 820, status: 'ok',
      }],
      traces: [{ traceId: 'tr_1', workloadId: 'wl_support_triage', outcome: 'success', retries: 0 }],
    },
    notes: [
      'costUsd is optional. Omit it and Control prices the call from its own rate card.',
      'sample is scanned for sensitive patterns and then discarded. It is never stored.',
      'Posting the same event id twice is a no-op, so retries are safe.',
    ],
  });
}
