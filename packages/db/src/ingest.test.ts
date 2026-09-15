import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DDL } from './sql.js';
import { applyIngest } from './ingest.js';
import { IngestBody } from '@ark/core';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-ingest-'));
const url = `file:${path.join(dir, 'test.db')}`;
const client = createClient({ url });

const opts = {
  client,
  allowlist: ['anthropic', 'openai'],
  turnCeiling: 5,
  traceCostCeiling: 0.5,
  qualityMinSamples: 20,
};

async function setup() {
  for (const stmt of DDL) await client.execute(stmt);
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: ['org_demo', 'Test', Date.now()],
  });
  await client.execute({
    sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      'wl_test', 'org_demo', 'Test', 'bounded-agent', '{}',
      JSON.stringify({ evaluation: { metrics: [{ name: 'Task accuracy on the golden set', threshold: '>= 93%' }] } }),
      'live', Date.now(),
    ],
  });
  await client.execute({
    sql: `INSERT INTO budgets (id,org_id,scope,scope_id,period,limit_usd,warn_at_pct,enforcement,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: ['bg_test', 'org_demo', 'org', null, 'month', 0.01, 50, 'warn', Date.now()],
  });
}

before(setup);

describe('applyIngest', () => {
  test('rejects an empty body at the schema boundary', () => {
    const parsed = IngestBody.safeParse({ orgId: 'org_demo' });
    assert.equal(parsed.success, false);
  });

  test('unknown model is stored, flagged, not dropped', async () => {
    const body = IngestBody.parse({
      events: [{
        id: 'ev_unknown', traceId: 'tr_unknown', workloadId: 'wl_test',
        provider: 'anthropic', modelId: 'definitely-not-a-model', turn: 0,
        inputTokens: 10, outputTokens: 5,
      }],
    });
    const r = await applyIngest(body, opts);
    assert.equal(r.accepted, 1);
    assert.equal(r.unpriced, 1);
    const alerts = await client.execute(`SELECT kind FROM alerts WHERE message LIKE '%definitely-not-a-model%'`);
    assert.ok(alerts.rows.some((x) => String(x.kind) === 'stale_pricing'));
    const ev = await client.execute({ sql: 'SELECT id FROM events WHERE id=?', args: ['ev_unknown'] });
    assert.equal(ev.rows.length, 1);
  });

  test('a 19-turn trace against a low ceiling emits loop_runaway', async () => {
    const events = Array.from({ length: 8 }, (_, t) => ({
      id: `ev_loop_${t}`, traceId: 'tr_loop', workloadId: 'wl_test',
      provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: t,
      inputTokens: 10, outputTokens: 5, costUsd: 0.001,
    }));
    const r = await applyIngest(IngestBody.parse({ events }), opts);
    assert.ok(r.circuitBreaks.some((b) => b.traceId === 'tr_loop'));
    const alerts = await client.execute(`SELECT kind FROM alerts WHERE message LIKE '%tr_loop%'`);
    assert.ok(alerts.rows.some((x) => String(x.kind) === 'loop_runaway'));
  });

  test('irreversible action with no approver emits unapproved_action', async () => {
    const r = await applyIngest(IngestBody.parse({
      actions: [{
        id: 'ac_bad', traceId: 'tr_act', workloadId: 'wl_test',
        name: 'Delete account', system: 'CRM', blastRadius: 'irreversible',
      }],
    }), opts);
    assert.equal(r.actionsAccepted, 1);
    const alerts = await client.execute({ sql: 'SELECT kind FROM alerts WHERE id=?', args: ['al_unap_ac_bad'] });
    assert.equal(String(alerts.rows[0]?.kind), 'unapproved_action');
  });

  test('quality samples below threshold emit quality_regression', async () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({
      id: `qs_${i}`, workloadId: 'wl_test', correct: i < 10, judgedBy: 'human' as const,
    }));
    const r = await applyIngest(IngestBody.parse({ qualitySamples: samples }), opts);
    assert.equal(r.qualityAccepted, 20);
    const alerts = await client.execute(`SELECT kind FROM alerts WHERE kind='quality_regression'`);
    assert.ok(alerts.rows.length >= 1);
  });

  test('spend past a tiny budget emits budget_warn or budget_breach', async () => {
    const r = await applyIngest(IngestBody.parse({
      events: [{
        id: 'ev_budget', traceId: 'tr_budget', workloadId: 'wl_test',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0,
        inputTokens: 1000, outputTokens: 1000, costUsd: 1,
      }],
    }), opts);
    assert.ok(r.alerts >= 1);
    const kinds = await client.execute(`SELECT kind FROM alerts WHERE kind IN ('budget_warn','budget_breach')`);
    assert.ok(kinds.rows.length >= 1);
  });

  test('a blocked budget refuses a follow-up event', async () => {
    await client.execute({
      sql: `INSERT INTO workloads (id,org_id,name,pattern,spec,assessment,status,created_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: ['wl_block', 'org_demo', 'Block', 'bounded-agent', '{}', null, 'live', Date.now()],
    });
    await client.execute({
      sql: `INSERT INTO budgets (id,org_id,scope,scope_id,period,limit_usd,warn_at_pct,enforcement,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: ['bg_block', 'org_demo', 'workload', 'wl_block', 'month', 0.0001, 50, 'block', Date.now()],
    });
    const first = await applyIngest(IngestBody.parse({
      orgId: 'org_demo',
      events: [{
        id: 'ev_block_1', traceId: 'tr_block', workloadId: 'wl_block',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0, costUsd: 1,
      }],
    }), opts);
    assert.equal(first.accepted, 1);
    const second = await applyIngest(IngestBody.parse({
      orgId: 'org_demo',
      events: [{
        id: 'ev_block_2', traceId: 'tr_block_2', workloadId: 'wl_block',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0, costUsd: 1,
      }],
    }), opts);
    assert.equal(second.accepted, 0);
    assert.ok(second.circuitBreaks.some((b) => b.reason === 'budget_block'));
    const stored = await client.execute({ sql: 'SELECT id FROM events WHERE id=?', args: ['ev_block_2'] });
    assert.equal(stored.rows.length, 0);
  });

  test('sample is not stored', async () => {
    await applyIngest(IngestBody.parse({
      events: [{
        id: 'ev_pii', traceId: 'tr_pii', workloadId: 'wl_test',
        provider: 'anthropic', modelId: 'claude-haiku-4.5', turn: 0,
        sample: 'reach me at ada@example.com',
      }],
    }), opts);
    const ev = await client.execute({ sql: 'SELECT sensitive_matches FROM events WHERE id=?', args: ['ev_pii'] });
    assert.match(String(ev.rows[0]?.sensitive_matches), /email/);
    const cols = await client.execute('PRAGMA table_info(events)');
    assert.ok(!cols.rows.some((c) => String(c.name) === 'sample'));
  });
});
