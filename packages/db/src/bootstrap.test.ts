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
