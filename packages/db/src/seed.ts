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
    'quality_samples', 'alerts', 'actions', 'events', 'traces', 'budgets', 'workloads',
    'calibration_snapshots', 'orgs',
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

  console.log(`Seeded ${row.e} events across ${row.t} traces, ${row.a} alerts, ${budgets.length} budgets, 1 calibration snapshot.`);

  await seedSecondOrg(client, now);
  await seedAuth(client, now);
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

