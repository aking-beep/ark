import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootstrap } from './bootstrap.js';
import { seedGuard } from './seed-guard.js';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-bootstrap-'));
const fresh = (name: string) => createClient({ url: `file:${path.join(dir, `${name}.db`)}` });
const quiet = () => {};

const REAL = {
  ARK_DEMO_PASSWORD: 'a-real-long-password-1',
  ARK_NORTHWIND_PASSWORD: 'a-real-long-password-2',
  ARK_INGEST_TOKEN_DEMO: 'tok_9f8e7d6c5b4a39281706f5e4',
  ARK_INGEST_TOKEN_NORTHWIND: 'tok_0a1b2c3d4e5f60718293a4b5',
};

describe('seedGuard', () => {
  test('anything goes outside production', () => {
    assert.equal(seedGuard({ NODE_ENV: 'development' }).ok, true);
    assert.equal(seedGuard({}).ok, true);
  });

  test('production refuses without ARK_ALLOW_SEED=1', () => {
    const g = seedGuard({ NODE_ENV: 'production', ...REAL });
    assert.equal(g.ok, false);
    assert.match(g.problems[0]!, /ARK_ALLOW_SEED/);
  });

  test('production refuses the published defaults and missing values', () => {
    const g = seedGuard({
      NODE_ENV: 'production', ARK_ALLOW_SEED: '1',
      ARK_DEMO_PASSWORD: 'riverbend-demo',
      ARK_INGEST_TOKEN_DEMO: 'ark_dev_ingest_custom_but_still_dev',
      ARK_INGEST_TOKEN_NORTHWIND: REAL.ARK_INGEST_TOKEN_NORTHWIND,
    });
    assert.equal(g.ok, false);
    const text = g.problems.join('\n');
    assert.match(text, /ARK_DEMO_PASSWORD is a published default/);
    assert.match(text, /ARK_NORTHWIND_PASSWORD must be set/);
    assert.match(text, /ARK_INGEST_TOKEN_DEMO is a published default/);
    assert.doesNotMatch(text, /riverbend-demo/, 'never echoes the value');
  });

  test('production with ARK_ALLOW_SEED=1 and real values passes', () => {
    assert.equal(seedGuard({ NODE_ENV: 'production', ARK_ALLOW_SEED: '1', ...REAL }).ok, true);
  });
});

describe('bootstrap', () => {
  test('pushes the schema and seeds an empty database once', async () => {
    const client = fresh('once');
    let seeds = 0;
    const seed = async () => {
      seeds++;
      await client.execute({ sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)', args: ['org_x', 'X', 1] });
    };
    assert.equal(await bootstrap({ client, env: {}, seed, log: quiet }), 'seeded');
    assert.equal(await bootstrap({ client, env: {}, seed, log: quiet }), 'already-seeded');
    assert.equal(seeds, 1, 'a database with an org is never re-seeded');
  });

  test('an empty production database without ARK_ALLOW_SEED stays empty but boots', async () => {
    const client = fresh('prod-skip');
    let seeds = 0;
    const r = await bootstrap({ client, env: { NODE_ENV: 'production' }, seed: async () => { seeds++; }, log: quiet });
    assert.equal(r, 'seed-skipped');
    assert.equal(seeds, 0);
    const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='orgs'`);
    assert.equal(tables.rows.length, 1, 'schema was still pushed');
  });

  test('production that asks to seed with default credentials fails loudly', async () => {
    const client = fresh('prod-default');
    await assert.rejects(
      bootstrap({ client, env: { NODE_ENV: 'production', ARK_ALLOW_SEED: '1' }, seed: async () => {}, log: quiet }),
      /Seed refused/,
    );
  });
});

describe('bootstrap with the real seed', () => {
  // The seed binds its own client (and queries.ts its lazy one) from
  // ARK_DATABASE_URL at import, so point both at this file before bootstrap
  // first imports seed.js. ~20s: it writes the full demo telemetry.
  const file = path.join(dir, 'real-seed.db');
  process.env.ARK_DATABASE_URL = `file:${file}`;
  const client = createClient({ url: `file:${file}` });
  const rows = async (sql: string) => (await client.execute(sql)).rows;
  const count = async (sql: string) => Number((await rows(sql))[0]!.n);

  test('a fresh database seeds, and Demo Co can walk Discover → Register → Assure', async () => {
    assert.equal(await bootstrap({ client, env: {}, log: quiet }), 'seeded');

    const runs = await rows(`SELECT repository, status, result FROM discovery_runs WHERE org_id='org_demo'`);
    assert.equal(runs.length, 1, 'one completed discovery run');
    assert.equal(runs[0]!.status, 'complete');
    assert.equal(runs[0]!.repository, 'ark-sample://support-desk');
    const result = JSON.parse(String(runs[0]!.result)) as { candidates: { id: string }[] };
    assert.deepEqual(result.candidates.map((c) => c.id).sort(), ['refund-agent', 'support-agent']);

    const agents = await rows(`SELECT id, owner, environment, source_repository FROM agents WHERE org_id='org_demo' ORDER BY id`);
    assert.deepEqual(agents.map((a) => a.id), ['refund-agent', 'support-agent']);
    for (const a of agents) {
      assert.equal(a.environment, 'production');
      assert.ok(a.owner, 'registered with an owner');
      assert.equal(a.source_repository, 'ark-sample://support-desk');
    }

    const assurance = await rows(`SELECT agent_id FROM assurance_runs WHERE org_id='org_demo'`);
    assert.deepEqual(assurance.map((r) => r.agent_id), ['support-agent']);

    const { agentInfrastructureSummary } = await import('./agents.js');
    const summary = await agentInfrastructureSummary('org_demo', client);
    assert.equal(summary.registered, 2);
    assert.equal(summary.observedInRuntime, 2, 'both registered agents have events carrying their id');
    assert.ok(summary.recentCriticalFindings.length > 0, 'the stored assurance run has findings to show');
  });

  test('procurement-agent is observed but never registered — the shadow-agent case', async () => {
    assert.ok(await count(`SELECT COUNT(*) n FROM protocol_evidence WHERE org_id='org_demo' AND actor='procurement-agent'`) > 0);
    assert.equal(await count(`SELECT COUNT(*) n FROM agents WHERE org_id='org_demo' AND id='procurement-agent'`), 0);
  });

  test('Northwind stays empty of agents, runs and telemetry', async () => {
    for (const t of ['agents', 'discovery_runs', 'assurance_runs', 'events', 'traces']) {
      assert.equal(await count(`SELECT COUNT(*) n FROM ${t} WHERE org_id='org_northwind'`), 0, t);
    }
  });

  test('Demo Co has the guard demo scenarios as receipts; Northwind has none', async () => {
    const demo = await rows(
      `SELECT resource_id, decision, execution_status, reason_code, sender_reported_approval, policy_id, created_at
       FROM action_receipts WHERE org_id='org_demo' ORDER BY created_at, id`,
    );
    // Produced by guardTool running the PR-3 scenarios, in scenario order.
    assert.deepEqual(
      demo.map((r) => [r.resource_id, r.decision, r.execution_status, r.reason_code, Number(r.sender_reported_approval)]),
      [
        ['ord_1001', 'allow', 'completed', 'rule_matched', 0],
        ['ord_1002', 'require_approval', 'not_attempted', 'rule_matched', 0],
        ['ord_1003', 'deny', 'not_attempted', 'rule_matched', 0],
        ['ord_1004', 'unknown', 'not_attempted', 'no_matching_policy', 0],
        ['ord_1006', 'require_approval', 'not_attempted', 'rule_matched', 1],
        ['ord_1001', 'allow', 'not_attempted', 'idempotency_replay', 0],
        ['ord_1007', 'allow', 'outcome_unknown', 'rule_matched', 0],
      ],
    );
    for (const r of demo) assert.ok(Number(r.created_at) <= Date.now(), 'never dated in the future');
    assert.equal(await count(`SELECT COUNT(*) n FROM action_receipts WHERE org_id='org_northwind'`), 0);
    // The cross-tenant scenario's receipt lands under the context's org, not Demo Co's.
    assert.equal(await count(`SELECT COUNT(*) n FROM action_receipts WHERE org_id='org_other' AND resource_id='ord_1005'`), 1);
  });

  test('a second boot never re-seeds', async () => {
    assert.equal(await bootstrap({ client, env: {}, log: quiet }), 'already-seeded');
    assert.equal(await count(`SELECT COUNT(*) n FROM discovery_runs`), 1);
  });
});
