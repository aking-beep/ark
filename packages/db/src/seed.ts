import { createClient } from '@libsql/client';
import { databaseUrl } from './client.js';
import { byId, assess, SUPPORT_TRIAGE, INVOICE_LOOKUP, CONTENT_DRAFTING, costOfCall } from '@ark/core';
import { hashPassword, hashSecret } from './auth.js';
import { NW_ORG, NORTHWIND_CLAIMS, NORTHWIND_BLOCKED_ID } from './northwind.js';

/**
 * Seeds ~45 days of plausible telemetry.
 *
 * Deliberately seeded with three findable problems, because a dashboard that
 * shows nothing wrong teaches you nothing:
 *   1. A frontier model doing classification work (large, obvious saving).
 *   2. An agent loop with a long tail burning turns on failed traces.
 *   3. PII reaching a provider that is not on the allow-list.
 */

const ORG = 'org_demo';
const DAYS = 45;
const now = Date.now();
const rnd = mulberry32(20260914);

const client = createClient({ url: databaseUrl(), authToken: process.env.ARK_DATABASE_AUTH_TOKEN });

async function run() {
  for (const t of [
    'alert_deliveries', 'alert_destinations', 'org_tokens', 'memberships', 'users',
    'quality_samples', 'alerts', 'actions', 'protocol_evidence', 'events', 'traces',
    'budgets', 'workloads', 'calibration_snapshots', 'orgs',
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }

  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: [ORG, 'Demo Co', now - DAYS * 864e5],
  });

  const defs = [
    { w: SUPPORT_TRIAGE, status: 'live',     tracesPerDay: 40, primary: 'claude-sonnet-5', leak: 'claude-opus-5', leakShare: 0.28 },
    { w: CONTENT_DRAFTING, status: 'assisted', tracesPerDay: 6, primary: 'gemini-3.8-flash', leak: null, leakShare: 0 },
    // The deliberate anti-pattern: a frontier model doing a lookup.
    { w: INVOICE_LOOKUP, status: 'shadow',   tracesPerDay: 14, primary: 'gpt-6-astra', leak: null, leakShare: 0 },
  ];

  const alerts: any[][] = [];
  let evSeq = 0, trSeq = 0, acSeq = 0, qsSeq = 0;

  for (const def of defs) {
    const a = assess(def.w);
    await client.execute({
      sql: 'INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [def.w.id, ORG, def.w.name, a.architecture.pattern, JSON.stringify(def.w),
             JSON.stringify(a),
             def.status, now - DAYS * 864e5],
    });

    const shape = a.architecture.callShape;

    for (let d = DAYS; d >= 0; d--) {
      const dayStart = now - d * 864e5;
      const weekday = new Date(dayStart).getDay();
      const volume = Math.round(def.tracesPerDay * (weekday === 0 || weekday === 6 ? 0.25 : 1) * (0.8 + rnd() * 0.4));

      for (let i = 0; i < volume; i++) {
        const traceId = `tr_${++trSeq}`;
        const startedAt = dayStart + Math.floor(rnd() * 864e5);
        const failed = rnd() < shape.failureRate;

        // Long tail: ~4% of traces burn far more turns than the mean.
        const runaway = def.w.id === SUPPORT_TRIAGE.id && rnd() < 0.04;
        const turns = Math.max(1, runaway
          ? Math.round(shape.turnsPerOutcome * (3 + rnd() * 4))
          : Math.round(shape.turnsPerOutcome * (0.7 + rnd() * 0.6)));

        const modelId = def.leak && rnd() < def.leakShare ? def.leak : def.primary;
        const model = byId(modelId)!;

        let traceCost = 0;
        for (let t = 0; t < turns; t++) {
          const inputTokens = Math.round((def.w.input.avgTokens + shape.contextGrowthPerTurn * t) * (0.85 + rnd() * 0.3));
          const outputTokens = Math.round(def.w.output.avgTokens * (0.8 + rnd() * 0.4));
          const cacheHit = shape.cacheHitRate * (0.7 + rnd() * 0.6);
          const cached = Math.round(inputTokens * Math.min(0.95, cacheHit));
          const cost = costOfCall(model, { inputTokens, outputTokens, cacheHitRate: cached / Math.max(1, inputTokens) });
          traceCost += cost;

          const isLastTurn = t === turns - 1;
          const status = failed && isLastTurn ? (rnd() < 0.5 ? 'error' : 'timeout') : 'ok';

          // Seeded security signal: PII reaching an off-allow-list provider.
          const sensitive = def.w.id === SUPPORT_TRIAGE.id && rnd() < 0.015;
          const off = sensitive && rnd() < 0.4;

          await client.execute({
            sql: `INSERT INTO events (id,org_id,trace_id,workload_id,ts,provider,model_id,turn,
                  input_tokens,output_tokens,cached_input_tokens,cost_usd,latency_ms,status,error_kind,
                  sensitive_matches,off_allowlist,user_id,application)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [`ev_${++evSeq}`, ORG, traceId, def.w.id, startedAt + t * 1200,
                   model.provider, model.id, t, inputTokens, outputTokens, cached,
                   cost, Math.round(400 + rnd() * 2600), status, status === 'ok' ? null : 'upstream',
                   sensitive ? JSON.stringify(['email', 'order_id']) : null, off ? 1 : 0,
                   `user_${1 + Math.floor(rnd() * 40)}`, def.w.name],
          });

          if (off) {
            alerts.push([`al_pii_${evSeq}`, ORG, startedAt, 'off_allowlist', 'critical', def.w.id,
              `PII detected in a request to ${model.provider} (${model.id}), which is not on the approved allow-list.`,
              JSON.stringify({ traceId, modelId: model.id })]);
          }
        }

        const outcome = failed ? (rnd() < 0.6 ? 'escalated' : 'failure') : 'success';
        await client.execute({
          sql: `INSERT INTO traces (id,org_id,workload_id,started_at,ended_at,outcome,actor_id,
                total_cost_usd,total_turns,retries,escalated_to_human) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          args: [traceId, ORG, def.w.id, startedAt, startedAt + turns * 1400, outcome,
                 `user_${1 + Math.floor(rnd() * 40)}`, traceCost, turns,
                 failed ? Math.round(shape.retriesPerFailure) : 0, outcome === 'escalated' ? 1 : 0],
        });

        if (runaway) {
          alerts.push([`al_loop_${traceId}`, ORG, startedAt, 'loop_runaway', 'warn', def.w.id,
            `Trace ran ${turns} turns against a mean of ${shape.turnsPerOutcome} — $${traceCost.toFixed(2)} on one unit of work.`,
            JSON.stringify({ traceId, turns })]);
        }

        // Actions, with a slice that executed without the required approval.
        if (def.w.actions.length && outcome === 'success' && rnd() < 0.3) {
          const act = def.w.actions[Math.floor(rnd() * def.w.actions.length)]!;
          const needsApproval = act.blastRadius === 'costly' || act.blastRadius === 'irreversible';
          const approved = needsApproval ? rnd() > 0.06 : true;
          await client.execute({
            sql: `INSERT INTO actions (id,org_id,trace_id,ts,name,system,blast_radius,value_usd,
                  approved_by,required_approval,credential_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            args: [`ac_${++acSeq}`, ORG, traceId, startedAt + turns * 1400, act.name, act.system,
                   act.blastRadius, act.valueCeilingUsd ? Math.round(rnd() * act.valueCeilingUsd * 100) / 100 : null,
                   approved ? `user_${1 + Math.floor(rnd() * 12)}` : null, needsApproval ? 1 : 0,
                   `svc_${act.system.toLowerCase()}`],
          });
          if (needsApproval && !approved) {
            alerts.push([`al_appr_${acSeq}`, ORG, startedAt, 'unapproved_action', 'critical', def.w.id,
              `"${act.name}" executed in ${act.system} with no approval record. SEC-05 requires a human gate.`,
              JSON.stringify({ traceId, action: act.name })]);
          }
        }

        // Sparse human quality judgements — enough to compute an accuracy rate.
        if (rnd() < 0.05) {
          await client.execute({
            sql: `INSERT INTO quality_samples (id,org_id,workload_id,trace_id,ts,correct,judged_by,note)
                  VALUES (?,?,?,?,?,?,?,?)`,
            args: [`qs_${++qsSeq}`, ORG, def.w.id, traceId, startedAt,
                   rnd() < (def.w.id === INVOICE_LOOKUP.id ? 0.88 : 0.94) ? 1 : 0, 'human', null],
          });
        }
      }
    }
  }

  // Budgets are set relative to observed month-to-date spend so the demo always
  // shows a live mix of ok / warn / breached rather than four flat zeroes.
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const mtd = async (workloadId?: string) => {
    const r = await client.execute({
      sql: `SELECT COALESCE(SUM(cost_usd),0) c FROM events WHERE org_id=? AND ts>=?${workloadId ? ' AND workload_id=?' : ''}`,
      args: workloadId ? [ORG, monthStart.getTime(), workloadId] : [ORG, monthStart.getTime()],
    });
    return Math.max(1, Number(r.rows[0]!.c));
  };

  const budgets: [string, string, string, string | null, string, number, number, string][] = [
    ['bg_org',     ORG, 'org',      null,                  'month', round2((await mtd()) / 0.62),                  80, 'warn'],
    ['bg_support', ORG, 'workload', SUPPORT_TRIAGE.id,     'month', round2((await mtd(SUPPORT_TRIAGE.id)) / 0.88),  75, 'throttle'],
    ['bg_content', ORG, 'workload', CONTENT_DRAFTING.id,   'month', round2((await mtd(CONTENT_DRAFTING.id)) / 0.34), 80, 'warn'],
    // Deliberately breached: a frontier model doing lookups blew a tight ceiling.
    ['bg_invoice', ORG, 'workload', INVOICE_LOOKUP.id,     'month', round2((await mtd(INVOICE_LOOKUP.id)) / 1.24),  70, 'block'],
  ];
  for (const b of budgets) {
    await client.execute({
      sql: 'INSERT INTO budgets (id,org_id,scope,scope_id,period,limit_usd,warn_at_pct,enforcement,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      args: [...b, now - DAYS * 864e5] as any,
    });
    if (b[4] === 'month') {
      const spent = await mtd(b[3] ?? undefined);
      const pct = (spent / b[5]) * 100;
      if (pct >= 100) {
        alerts.unshift([`al_budget_${b[0]}`, ORG, now - 36e5, 'budget_breach', 'critical', b[3],
          `Budget breached: $${spent.toFixed(2)} against a $${b[5].toFixed(2)} monthly ceiling. Enforcement is set to "${b[7]}".`,
          JSON.stringify({ budgetId: b[0], spent, limit: b[5] })]);
      } else if (pct >= b[6]) {
        alerts.unshift([`al_budget_${b[0]}`, ORG, now - 72e5, 'budget_warn', 'warn', b[3],
          `Budget at ${pct.toFixed(0)}% with days left in the period. Projected to overrun.`,
          JSON.stringify({ budgetId: b[0], spent, limit: b[5] })]);
      }
    }
  }

  for (const a of alerts.slice(0, 200)) {
    await client.execute({
      sql: 'INSERT INTO alerts (id,org_id,ts,kind,severity,workload_id,message,detail) VALUES (?,?,?,?,?,?,?,?)',
      args: a as any,
    });
  }

  await seedProtocolEvidence(client, rnd);

  const counts = await client.execute('SELECT (SELECT COUNT(*) FROM events) e, (SELECT COUNT(*) FROM traces) t, (SELECT COUNT(*) FROM alerts) a');
  const row = counts.rows[0]!;

  // Versioned snapshot of the priors this seed actually produced. Never
  // overwrite — the next GET /api/v1/calibration inserts another row.
  const { calibration } = await import('./queries.js');
  const set = await calibration(ORG, 30);
  await client.execute({
    sql: `INSERT INTO calibration_snapshots (id, org_id, generated_at, window_days, basis, payload)
          VALUES (?,?,?,?,?,?)`,
    args: [`cal_seed_${now}`, ORG, now, 30, set.basis, JSON.stringify(set)],
  });

  const pe = await client.execute('SELECT COUNT(*) n FROM protocol_evidence');
  console.log(`Seeded ${row.e} events across ${row.t} traces, ${pe.rows[0]!.n} protocol observations, ${row.a} alerts, ${budgets.length} budgets, 1 calibration snapshot.`);

  await seedSecondOrg(client, now);
  await seedAuth(client, now);
}

/**
 * Protocol evidence on the traces that already exist.
 *
 * Attached to real trace ids rather than invented ones, because the thing
 * worth demonstrating is the correlation: a support trace whose model cost is
 * in `events`, whose CRM lookup is in `protocol_evidence`, whose refund is in
 * `actions`, and whose verdict is in `traces` — four grains, one unit of work.
 * Invented trace ids would show six protocol counters and prove nothing.
 *
 * Posted through `applyIngest` rather than INSERTed, so the `approval_missing`
 * detection produces the demo's governance alerts by actually running, and the
 * seed cannot drift from the ingest path it is supposed to represent.
 */
async function seedProtocolEvidence(client: ReturnType<typeof createClient>, rnd: () => number) {
  const { applyIngest } = await import('./ingest.js');
  const { IngestBody } = await import('@ark/core');
  const { mcpEvidence, a2aEvidence, agUiEvidence, a2uiEvidence, ucpEvidence, ap2Evidence } =
    await import('@ark/protocols');

  const wl = SUPPORT_TRIAGE.id;
  const traces = await client.execute({
    sql: `SELECT id, started_at, outcome FROM traces
          WHERE org_id=? AND workload_id=? AND started_at>=?
          ORDER BY started_at DESC LIMIT 120`,
    args: [ORG, wl, now - 14 * 864e5],
  });
  if (traces.rows.length === 0) return;

  const rows: unknown[] = [];
  let seq = 0;
  const on = (traceId: string, ts: number, o: object) =>
    rows.push({ ...o, id: `pe_${++seq}`, traceId, workloadId: wl, ts });

  for (const t of traces.rows) {
    const traceId = String(t.id);
    const at = Number(t.started_at);
    const failed = String(t.outcome) !== 'success';

    // Every support trace reads the CRM. Some of those reads fail, which is
    // what makes the error counter on the Protocols page a real number.
    const toolFailed = rnd() < 0.08;
    on(traceId, at + 900, mcpEvidence({
      method: 'tools/call', name: 'search_customer',
      client: 'support-agent', server: 'crm-mcp', transport: 'streamable-http',
      latencyMs: Math.round(40 + rnd() * 160),
      ...(toolFailed ? { isError: true, errorKind: 'timeout' } : {}),
    }));

    if (rnd() < 0.3) {
      on(traceId, at + 1500, mcpEvidence({
        method: 'resources/read', name: 'crm://tickets/recent',
        client: 'support-agent', server: 'crm-mcp', transport: 'streamable-http',
        latencyMs: Math.round(20 + rnd() * 60),
      }));
    }

    // A third of tickets need the refund specialist.
    if (rnd() < 0.34) {
      on(traceId, at + 2400, a2aEvidence({
        operation: 'delegate', agent: 'support-agent', peerAgent: 'refund-agent',
        taskId: `task_${traceId.slice(3)}`, contextId: `ctx_${traceId.slice(3)}`,
        taskState: failed ? 'TASK_STATE_FAILED' : 'TASK_STATE_COMPLETED',
        protocolBinding: 'JSONRPC', artifactCount: failed ? 0 : 1,
        latencyMs: Math.round(600 + rnd() * 2400),
      }));

      // Which, above a threshold, asks a person.
      if (rnd() < 0.55) {
        const waited = Math.round(20_000 + rnd() * 400_000);
        on(traceId, at + 3000, agUiEvidence({
          eventType: 'approval.requested', agent: 'refund-agent', surface: 'support-console',
          runId: `run_${traceId.slice(3)}`, threadId: `th_${traceId.slice(3)}`,
        }));
        const denied = rnd() < 0.12;
        on(traceId, at + 3000 + waited, agUiEvidence({
          eventType: denied ? 'approval.denied' : 'approval.approved',
          agent: 'refund-agent', surface: 'support-console',
          runId: `run_${traceId.slice(3)}`, timeToApprovalMs: waited,
          approvedBy: denied ? null : `user_${1 + Math.floor(rnd() * 12)}`,
        }));
      }
    }

    if (rnd() < 0.22) {
      on(traceId, at + 4200, a2uiEvidence({
        operation: 'updateComponents', agent: 'refund-agent', surfaceId: 'refund_confirm',
        catalogId: 'basic', components: ['Card', 'Text', 'Button'], componentCount: 3,
        policy: rnd() < 0.06 ? 'blocked' : 'rendered',
      }));
    }

    // A minority of refunds are settled rather than credited, which is where
    // commerce and payment evidence comes from. Approved by a person, because
    // that is the case worth contrasting with the unapproved one below.
    if (rnd() < 0.14 && !failed) {
      const amount = Math.round((18 + rnd() * 160) * 100) / 100;
      const approver = `user_${1 + Math.floor(rnd() * 12)}`;
      const ref = traceId.slice(3);
      on(traceId, at + 5000, ucpEvidence({
        operation: 'checkout:create', agent: 'support-agent', merchant: 'merchant.example',
        reference: `co_${ref}`, transport: 'mcp', amount, currency: 'USD', status: 'pending',
        latencyMs: Math.round(120 + rnd() * 300),
      }));
      on(traceId, at + 5400, ucpEvidence({
        operation: 'checkout:complete', agent: 'support-agent', merchant: 'merchant.example',
        reference: `co_${ref}`, capability: 'https://ucp.dev/capabilities/shopping/checkout.json',
        transport: 'mcp', amount, currency: 'USD', status: 'completed',
        latencyMs: Math.round(200 + rnd() * 500),
      }));
      on(traceId, at + 5800, ap2Evidence({
        operation: 'payment_mandate', agent: 'support-agent', merchant: 'merchant.example',
        mandateType: 'mandate.payment.1', mandateRef: `mandate_${ref}`,
        amount, currency: 'USD', presence: 'direct', status: 'Success',
        approvedBy: approver, latencyMs: Math.round(150 + rnd() * 250),
      }));
      on(traceId, at + 6200, ap2Evidence({
        operation: 'payment_receipt', agent: 'support-agent', merchant: 'merchant.example',
        receiptRef: `receipt_${ref}`, amount, currency: 'USD', status: 'Success',
      }));
    }
  }

  // The hero trace: one unit of work that crosses all six protocols, so
  // /workloads/[id] has a story to tell rather than a list of MCP calls.
  const hero = traces.rows.find((t) => String(t.outcome) === 'success');
  if (hero) {
    const traceId = String(hero.id);
    const at = Number(hero.started_at);
    const waited = 84_000;
    for (const row of rows.slice()) {
      // Clear whatever the loop above happened to attach, so the story reads
      // as one deliberate sequence rather than two overlaid ones.
      if ((row as { traceId: string }).traceId === traceId) rows.splice(rows.indexOf(row), 1);
    }
    on(traceId, at + 800, mcpEvidence({
      method: 'tools/call', name: 'search_customer',
      client: 'support-agent', server: 'crm-mcp', transport: 'streamable-http', latencyMs: 84,
    }));
    on(traceId, at + 1600, a2aEvidence({
      operation: 'delegate', agent: 'support-agent', peerAgent: 'refund-agent',
      taskId: 'task_829', contextId: 'ctx_829', taskState: 'TASK_STATE_COMPLETED',
      protocolBinding: 'JSONRPC', artifactCount: 1, latencyMs: 1_240,
    }));
    on(traceId, at + 2400, agUiEvidence({
      eventType: 'approval.requested', agent: 'refund-agent', surface: 'support-console',
      runId: 'run_829', threadId: 'th_829',
    }));
    on(traceId, at + 2400 + waited, agUiEvidence({
      eventType: 'approval.approved', agent: 'refund-agent', surface: 'support-console',
      runId: 'run_829', timeToApprovalMs: waited, approvedBy: 'user_12',
    }));
    on(traceId, at + 3200 + waited, a2uiEvidence({
      operation: 'createSurface', agent: 'refund-agent', surfaceId: 'refund_confirm_829',
      catalogId: 'basic', components: ['Card', 'Text', 'Button'], componentCount: 3,
      policy: 'rendered',
    }));
    on(traceId, at + 4000 + waited, ucpEvidence({
      operation: 'checkout:complete', agent: 'support-agent', merchant: 'merchant.example',
      reference: 'co_829', capability: 'https://ucp.dev/capabilities/shopping/checkout.json',
      transport: 'mcp', amount: 89.5, currency: 'USD', status: 'completed', latencyMs: 410,
    }));
    on(traceId, at + 4800 + waited, ap2Evidence({
      operation: 'payment_mandate', agent: 'support-agent', merchant: 'merchant.example',
      mandateType: 'mandate.payment.1', mandateRef: 'mandate_829',
      amount: 89.5, currency: 'USD', presence: 'direct', status: 'Success',
      approvedBy: 'user_12', latencyMs: 260,
    }));
    on(traceId, at + 5200 + waited, ap2Evidence({
      operation: 'payment_receipt', agent: 'support-agent', merchant: 'merchant.example',
      receiptRef: 'receipt_829', amount: 89.5, currency: 'USD', status: 'Success',
    }));
  }

  // The governance case, deliberately: a procurement agent authorising $475
  // with nobody's signature on it. This is the row `approval_missing` exists
  // for, and the one an operator should find on the dashboard.
  const unapproved = traces.rows[3] ?? traces.rows[0]!;
  {
    const traceId = String(unapproved.id);
    const at = Number(unapproved.started_at);
    on(traceId, at + 6000, ucpEvidence({
      operation: 'checkout:create', agent: 'procurement-agent', merchant: 'aws',
      reference: 'co_4471', transport: 'rest', amount: 475, currency: 'USD', status: 'pending',
    }));
    on(traceId, at + 6400, ap2Evidence({
      operation: 'payment_mandate', agent: 'procurement-agent', merchant: 'aws',
      mandateType: 'mandate.payment.1', mandateRef: 'mandate_4471',
      amount: 475, currency: 'USD', presence: 'autonomous', status: 'Success',
      // No approvedBy. An autonomous agent committed $475 and no human signed.
    }));
  }

  // One approval still in flight, so the dashboard shows that `pending` is a
  // state and not a finding — the counter it does not appear in is the point.
  const inFlight = traces.rows[1] ?? traces.rows[0]!;
  on(String(inFlight.id), Number(inFlight.started_at) + 7000, ap2Evidence({
    operation: 'checkout_mandate', agent: 'procurement-agent', merchant: 'datadog',
    mandateType: 'mandate.checkout.1', mandateRef: 'mandate_4472',
    amount: 1_200, currency: 'USD', presence: 'autonomous', status: 'Pending',
  }));

  // And one priced in a currency ARK will not convert, so the "value acted on"
  // headline can say what it excluded rather than quietly guessing a rate.
  on(String(inFlight.id), Number(inFlight.started_at) + 7400, ucpEvidence({
    operation: 'checkout:complete', agent: 'shopping-agent', merchant: 'merchant.de',
    reference: 'co_4480', transport: 'rest', amount: 240, currency: 'EUR', status: 'completed',
  }));

  const result = await applyIngest(
    IngestBody.parse({ orgId: ORG, evidence: rows }),
    { client, allowlist: [], turnCeiling: 1e9, traceCostCeiling: 1e9 },
  );
  if (result.evidenceRedacted.length) {
    throw new Error(`seed evidence carried payload keys: ${result.evidenceRedacted.join(', ')}`);
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

await run();

async function seedSecondOrg(client: ReturnType<typeof createClient>, now: number) {
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: [NW_ORG, 'Northwind Logistics', now],
  });
  const a = assess(NORTHWIND_CLAIMS);
  await client.execute({
    sql: 'INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
    args: [
      NORTHWIND_CLAIMS.id, NW_ORG, NORTHWIND_CLAIMS.name, a.architecture.pattern,
      JSON.stringify(NORTHWIND_CLAIMS), JSON.stringify(a), 'live', now,
    ],
  });
  await client.execute({
    sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [NORTHWIND_BLOCKED_ID, NW_ORG, 'Blocked canary', 'bounded-agent', '{}', null, 'shadow', now],
  });
  await client.execute({
    sql: 'INSERT INTO budgets (id,org_id,scope,scope_id,period,limit_usd,warn_at_pct,enforcement,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    args: ['bg_nw_live', NW_ORG, 'workload', NORTHWIND_CLAIMS.id, 'month', 10_000, 80, 'observe', now],
  });
  await client.execute({
    sql: 'INSERT INTO budgets (id,org_id,scope,scope_id,period,limit_usd,warn_at_pct,enforcement,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    args: ['bg_nw_block', NW_ORG, 'workload', NORTHWIND_BLOCKED_ID, 'month', 0.0001, 50, 'block', now],
  });
  const hook = process.env.ARK_WEBHOOK_URL;
  if (hook) {
    await client.execute({
      sql: 'INSERT INTO alert_destinations (id,org_id,kind,url,created_at) VALUES (?,?,?,?,?)',
      args: ['dest_nw_hook', NW_ORG, 'webhook', hook, now],
    });
  }
  const slack = process.env.ARK_SLACK_WEBHOOK_URL;
  if (slack) {
    await client.execute({
      sql: 'INSERT INTO alert_destinations (id,org_id,kind,url,created_at) VALUES (?,?,?,?,?)',
      args: ['dest_nw_slack', NW_ORG, 'slack', slack, now],
    });
  }
  console.log('Seeded org_northwind with zero events (live ingest is npm run ingest:live).');
}

async function seedAuth(client: ReturnType<typeof createClient>, now: number) {
  const demoEmail = (process.env.ARK_DEMO_EMAIL ?? 'dana@riverbend.example').toLowerCase();
  const demoPassword = process.env.ARK_DEMO_PASSWORD ?? 'riverbend-demo';
  const nwEmail = (process.env.ARK_NORTHWIND_EMAIL ?? 'sam@northwind.example').toLowerCase();
  const nwPassword = process.env.ARK_NORTHWIND_PASSWORD ?? 'northwind-demo';
  const demoToken = process.env.ARK_INGEST_TOKEN_DEMO ?? 'ark_dev_ingest_org_demo';
  const nwToken = process.env.ARK_INGEST_TOKEN_NORTHWIND ?? 'ark_dev_ingest_org_northwind';

  await client.execute({
    sql: 'INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)',
    args: ['user_dana', demoEmail, hashPassword(demoPassword), now],
  });
  await client.execute({
    sql: 'INSERT INTO memberships (user_id,org_id,role) VALUES (?,?,?)',
    args: ['user_dana', ORG, 'owner'],
  });
  await client.execute({
    sql: 'INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)',
    args: ['user_sam', nwEmail, hashPassword(nwPassword), now],
  });
  await client.execute({
    sql: 'INSERT INTO memberships (user_id,org_id,role) VALUES (?,?,?)',
    args: ['user_sam', NW_ORG, 'owner'],
  });
  await client.execute({
    sql: 'INSERT INTO org_tokens (id,org_id,name,token_hash,created_at) VALUES (?,?,?,?,?)',
    args: ['tok_demo', ORG, 'demo ingest', hashSecret(demoToken), now],
  });
  await client.execute({
    sql: 'INSERT INTO org_tokens (id,org_id,name,token_hash,created_at) VALUES (?,?,?,?,?)',
    args: ['tok_nw', NW_ORG, 'northwind ingest', hashSecret(nwToken), now],
  });
}

