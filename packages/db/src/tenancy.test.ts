import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-tenancy-'));
// `queries.ts` opens one lazy client against this URL; set it before import
// so calibration() reads the file the tests write.
process.env.ARK_DATABASE_URL = `file:${path.join(dir, 'test.db')}`;

const { createClient } = await import('@libsql/client');
const { DDL, pushSchema } = await import('./sql.js');
const { applyIngest } = await import('./ingest.js');
const { calibration } = await import('./queries.js');
const { periodWindow } = await import('./budget-period.js');
const { IngestBody } = await import('@ark/core');

const client = createClient({ url: process.env.ARK_DATABASE_URL! });
const opts = { client, allowlist: ['anthropic'], turnCeiling: 50, traceCostCeiling: 100 };

const event = (over: Record<string, unknown>) => ({
  provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0, inputTokens: 10, outputTokens: 5, ...over,
});

async function workload(orgId: string, id: string, pattern = 'bounded-agent') {
  await client.execute({
    sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, orgId, `${orgId} ${id}`, pattern, '{}', null, 'live', Date.now()],
  });
}

before(async () => {
  for (const stmt of DDL) await client.execute(stmt);
  for (const org of ['org_a', 'org_b']) {
    await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: [org, org, Date.now()] });
    await workload(org, 'wl_shared');
  }
});

describe('two orgs, one id space', () => {
  test('the same trace and event ids in two orgs are two rows, each costed to its own org', async () => {
    const a = await applyIngest('org_a', IngestBody.parse({
      events: [event({ id: 'ev_shared', traceId: 'tr_shared', workloadId: 'wl_shared', costUsd: 0.1 })],
    }), opts);
    const b = await applyIngest('org_b', IngestBody.parse({
      events: [event({ id: 'ev_shared', traceId: 'tr_shared', workloadId: 'wl_shared', costUsd: 0.2 })],
    }), opts);
    assert.equal(a.accepted, 1);
    assert.equal(b.accepted, 1, 'org_b’s event is not swallowed as a duplicate of org_a’s');
    assert.equal(b.duplicates, 0);

    const traces = await client.execute(`SELECT org_id, total_cost_usd FROM traces WHERE id='tr_shared' ORDER BY org_id`);
    assert.deepEqual(traces.rows.map((r) => [String(r.org_id), Number(r.total_cost_usd)]), [['org_a', 0.1], ['org_b', 0.2]]);
    const events = await client.execute(`SELECT org_id FROM events WHERE id='ev_shared' ORDER BY org_id`);
    assert.deepEqual(events.rows.map((r) => String(r.org_id)), ['org_a', 'org_b']);
  });

  test('closing a trace id only closes the caller’s trace', async () => {
    const r = await applyIngest('org_b', IngestBody.parse({
      traces: [{ traceId: 'tr_shared', workloadId: 'wl_shared', outcome: 'failure', retries: 3 }],
    }), opts);
    assert.equal(r.tracesClosed, 1);
    const rows = await client.execute(`SELECT org_id, outcome, retries FROM traces WHERE id='tr_shared' ORDER BY org_id`);
    assert.deepEqual(rows.rows.map((x) => [String(x.org_id), String(x.outcome), Number(x.retries)]), [
      ['org_a', 'pending', 0],
      ['org_b', 'failure', 3],
    ]);
  });

  test('closing a trace another org owns is a no-op', async () => {
    await applyIngest('org_a', IngestBody.parse({
      events: [event({ id: 'ev_only_a', traceId: 'tr_only_a', workloadId: 'wl_shared' })],
    }), opts);
    const r = await applyIngest('org_b', IngestBody.parse({
      traces: [{ traceId: 'tr_only_a', workloadId: 'wl_shared', outcome: 'failure' }],
    }), opts);
    assert.equal(r.tracesClosed, 0);
    const row = await client.execute(`SELECT outcome FROM traces WHERE org_id='org_a' AND id='tr_only_a'`);
    assert.equal(String(row.rows[0]?.outcome), 'pending');
  });

  test('a deterministic alert id raised in one org does not suppress it in another', async () => {
    const action = {
      id: 'ac_shared', traceId: 'tr_act', workloadId: 'wl_shared',
      name: 'Delete account', system: 'CRM', blastRadius: 'irreversible',
    };
    const a = await applyIngest('org_a', IngestBody.parse({ actions: [action] }), opts);
    const b = await applyIngest('org_b', IngestBody.parse({ actions: [action] }), opts);
    assert.equal(a.actionsAccepted, 1);
    assert.equal(b.actionsAccepted, 1);
    assert.equal(a.alerts, 1);
    assert.equal(b.alerts, 1, 'org_b gets its own unapproved_action alert');
    const rows = await client.execute(`SELECT org_id FROM alerts WHERE id='al_unap_ac_shared' ORDER BY org_id`);
    assert.deepEqual(rows.rows.map((r) => String(r.org_id)), ['org_a', 'org_b']);
  });

  test('the orgId inside the body is ignored; the authenticated org is used', async () => {
    const body = IngestBody.parse({
      orgId: 'org_a',
      events: [event({ id: 'ev_claim', traceId: 'tr_claim', workloadId: 'wl_shared' })],
    });
    await applyIngest('org_b', body, opts);
    const rows = await client.execute(`SELECT org_id FROM events WHERE id='ev_claim'`);
    assert.deepEqual(rows.rows.map((r) => String(r.org_id)), ['org_b']);
  });

  test('a quality threshold is read from the caller’s workload, not a namesake', async () => {
    await workload('org_a', 'wl_q');
    await client.execute({
      sql: `UPDATE workloads SET assessment=? WHERE org_id='org_a' AND id='wl_q'`,
      args: [JSON.stringify({ evaluation: { metrics: [{ name: 'accuracy', threshold: '>= 10%' }] } })],
    });
    await workload('org_b', 'wl_q');
    const samples = Array.from({ length: 4 }, (_, i) => ({
      id: `qs_t_${i}`, workloadId: 'wl_q', correct: i === 0, judgedBy: 'human' as const,
    }));
    // 25% accuracy: above org_a's 10% bar, below the 93% default that applies to org_b.
    const r = await applyIngest('org_b', IngestBody.parse({ qualitySamples: samples }), { ...opts, qualityMinSamples: 4 });
    assert.ok(r.alertRecords?.some((x) => x.kind === 'quality_regression'));
  });
});

describe('retries', () => {
  const batch = () => IngestBody.parse({
    events: [
      event({ id: 'ev_retry_0', traceId: 'tr_retry', workloadId: 'wl_shared', turn: 0, costUsd: 0.05 }),
      event({ id: 'ev_retry_1', traceId: 'tr_retry', workloadId: 'wl_shared', turn: 1, costUsd: 0.05 }),
    ],
    actions: [{ id: 'ac_retry', traceId: 'tr_retry', workloadId: 'wl_shared', name: 'x', system: 'y', blastRadius: 'none' }],
    qualitySamples: [{ id: 'qs_retry', workloadId: 'wl_shared', traceId: 'tr_retry', correct: true, judgedBy: 'human' }],
    evidence: [{ id: 'pe_retry', traceId: 'tr_retry', protocol: 'mcp', kind: 'tool', operation: 'tools/call:noop' }],
  });

  test('a re-posted batch is not counted, costed or alerted twice', async () => {
    const first = await applyIngest('org_a', batch(), opts);
    assert.equal(first.accepted, 2);
    assert.equal(first.duplicates, 0);
    const before = await client.execute(`SELECT total_cost_usd FROM traces WHERE org_id='org_a' AND id='tr_retry'`);

    const second = await applyIngest('org_a', batch(), opts);
    assert.equal(second.accepted, 0);
    assert.equal(second.actionsAccepted, 0);
    assert.equal(second.qualityAccepted, 0);
    assert.equal(second.evidenceAccepted, 0);
    assert.equal(second.duplicates, 5);
    assert.equal(second.alerts, 0);
    assert.deepEqual(second.alertRecords, []);

    const after = await client.execute(`SELECT total_cost_usd FROM traces WHERE org_id='org_a' AND id='tr_retry'`);
    assert.equal(Number(after.rows[0]?.total_cost_usd), Number(before.rows[0]?.total_cost_usd));
    assert.ok(Math.abs(Number(after.rows[0]?.total_cost_usd) - 0.1) < 1e-9);
  });

  test('stale_pricing is one alert per model per batch, and not re-raised the same day', async () => {
    const unknown = (id: string) => event({ id, traceId: 'tr_stale', workloadId: 'wl_shared', modelId: 'no-such-model-x' });
    const first = await applyIngest('org_a', IngestBody.parse({
      events: [unknown('ev_st_0'), unknown('ev_st_1'), unknown('ev_st_2')],
    }), opts);
    assert.equal(first.unpriced, 3);
    assert.equal(first.alertRecords?.filter((a) => a.kind === 'stale_pricing').length, 1);
    const second = await applyIngest('org_a', IngestBody.parse({ events: [unknown('ev_st_3')] }), opts);
    assert.equal(second.alertRecords?.filter((a) => a.kind === 'stale_pricing').length, 0);
  });
});

describe('budget periods', () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const yesterday = Date.UTC(2026, 9, 14, 12);

  before(async () => {
    await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: ['org_budget', 'B', now] });
    for (const wl of ['wl_day', 'wl_month']) {
      await workload('org_budget', wl);
      // Spend from yesterday: inside this month, outside today.
      await client.execute({
        sql: `INSERT INTO events (id,org_id,trace_id,workload_id,ts,provider,model_id,cost_usd) VALUES (?,?,?,?,?,?,?,?)`,
        args: [`ev_prior_${wl}`, 'org_budget', `tr_prior_${wl}`, wl, yesterday, 'anthropic', 'claude-haiku-4.5', 5],
      });
    }
    for (const [id, wl, period] of [['bg_day', 'wl_day', 'day'], ['bg_month', 'wl_month', 'month']]) {
      await client.execute({
        sql: `INSERT INTO budgets (id,org_id,scope,scope_id,period,limit_usd,warn_at_pct,enforcement,created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [id!, 'org_budget', 'workload', wl!, period!, 1, 80, 'block', now],
      });
    }
  });

  test('a daily budget ignores yesterday’s spend; a monthly one does not', async () => {
    const day = await applyIngest('org_budget', IngestBody.parse({
      events: [event({ id: 'ev_day_0', traceId: 'tr_day_0', workloadId: 'wl_day', costUsd: 0.5 })],
    }), { ...opts, now });
    assert.equal(day.accepted, 1);
    const month = await applyIngest('org_budget', IngestBody.parse({
      events: [event({ id: 'ev_month_0', traceId: 'tr_month_0', workloadId: 'wl_month', costUsd: 0.5 })],
    }), { ...opts, now });
    assert.equal(month.accepted, 0);
    assert.ok(month.circuitBreaks.some((b) => b.reason === 'budget_block'));
  });

  test('spend is tracked within a batch, so one large batch cannot run through a block', async () => {
    // 0.5 already spent today against a 1.00 block.
    const r = await applyIngest('org_budget', IngestBody.parse({
      events: [1, 2, 3, 4].map((i) => event({ id: `ev_day_${i}`, traceId: `tr_day_${i}`, workloadId: 'wl_day', costUsd: 0.6 })),
    }), { ...opts, now });
    assert.equal(r.accepted, 1, 'the event that crosses the limit is the last one admitted');
    assert.ok(r.circuitBreaks.some((b) => b.reason === 'budget_block'));
    const spent = await client.execute(`SELECT SUM(cost_usd) s FROM events WHERE org_id='org_budget' AND workload_id='wl_day' AND ts>=${periodWindow('day', now).startMs}`);
    assert.ok(Math.abs(Number(spent.rows[0]?.s) - 1.1) < 1e-9);
  });

  test('period windows are UTC and week starts Monday', () => {
    const w = periodWindow('week', Date.UTC(2026, 9, 11, 23, 30)); // a Sunday
    assert.equal(new Date(w.startMs).toISOString(), '2026-10-05T00:00:00.000Z');
    assert.equal(w.key, 'W2026-10-05');
    assert.equal(periodWindow('day', now).key, '2026-10-15');
    assert.equal(periodWindow('month', now).key, '2026-10');
    assert.equal(periodWindow('nonsense', now).period, 'month');
  });
});

describe('fleet calibration', () => {
  async function otherOrgTraces(org: string) {
    await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: [org, org, Date.now()] });
    await workload(org, 'wl_fleet');
    for (let i = 0; i < 3; i++) {
      await client.execute({
        sql: `INSERT INTO traces (id,org_id,workload_id,started_at,outcome,total_cost_usd,total_turns)
              VALUES (?,?,?,?,?,?,?)`,
        args: [`tr_fleet_${i}`, org, 'wl_fleet', Date.now() - 3600_000, 'success', 0.01, 1],
      });
    }
  }

  test('fleet priors need at least three other orgs behind them', async () => {
    await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: ['org_new', 'New', Date.now()] });
    // org_a, org_b and org_budget already hold traces; scrub them so the
    // count starts from zero for this test.
    await client.execute(`DELETE FROM traces WHERE org_id IN ('org_a','org_b','org_budget')`);
    await otherOrgTraces('org_f1');
    await otherOrgTraces('org_f2');
    assert.equal((await calibration('org_new', 30)).basis, 'measured', 'two orgs is not a fleet');
    await otherOrgTraces('org_f3');
    assert.equal((await calibration('org_new', 30)).basis, 'calibrated');
  });
});

describe('pushSchema', () => {
  test('re-keys a legacy single-id table and keeps its rows', async () => {
    const legacy = createClient({ url: `file:${path.join(dir, 'legacy.db')}` });
    await legacy.execute(`CREATE TABLE events (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, trace_id TEXT, workload_id TEXT, ts INTEGER NOT NULL,
      provider TEXT NOT NULL, model_id TEXT NOT NULL, turn INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', error_kind TEXT,
      sensitive_matches TEXT, off_allowlist INTEGER NOT NULL DEFAULT 0,
      user_id TEXT, application TEXT)`);
    await legacy.execute(`CREATE INDEX events_trace_idx ON events(trace_id)`);
    await legacy.execute(`INSERT INTO events (id, org_id, ts, provider, model_id, cost_usd) VALUES ('ev_old', 'org_a', 1, 'anthropic', 'm', 0.3)`);

    const { rebuilt } = await pushSchema(legacy);
    assert.ok(rebuilt.includes('events'));
    const pk = (await legacy.execute('PRAGMA table_info(events)')).rows
      .filter((r) => Number(r.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((r) => String(r.name));
    assert.deepEqual(pk, ['org_id', 'id']);
    const kept = await legacy.execute(`SELECT org_id, cost_usd, agent_id FROM events WHERE id='ev_old'`);
    assert.equal(String(kept.rows[0]?.org_id), 'org_a');
    assert.equal(Number(kept.rows[0]?.cost_usd), 0.3);
    await legacy.execute(`INSERT INTO events (id, org_id, ts, provider, model_id) VALUES ('ev_old', 'org_b', 1, 'anthropic', 'm')`);

    const again = await pushSchema(legacy);
    assert.deepEqual(again.rebuilt, [], 'idempotent');
  });
});
