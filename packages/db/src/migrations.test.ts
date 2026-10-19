import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { DDL, MIGRATIONS, isBenignMigrationError, pushSchema, type Migration } from './sql.js';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-migrations-'));
let n = 0;
const freshDb = (): Client => createClient({ url: `file:${path.join(dir, `m${n++}.db`)}` });

async function recorded(client: Client): Promise<string[]> {
  const r = await client.execute('SELECT id FROM schema_migrations ORDER BY id');
  return r.rows.map((row) => String(row.id));
}

async function tableExists(client: Client, name: string): Promise<boolean> {
  const r = await client.execute({ sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, args: [name] });
  return r.rows.length > 0;
}

const allIds = MIGRATIONS.map((m) => m.id).sort();

describe('MIGRATIONS', () => {
  test('ids are unique', () => {
    assert.equal(new Set(allIds).size, MIGRATIONS.length);
  });
});

describe('pushSchema migration tracking', () => {
  test('a fresh database records every migration once', async () => {
    const db = freshDb();
    await pushSchema(db);
    assert.deepEqual(await recorded(db), allIds);
  });

  test('a second push is a no-op that records nothing new', async () => {
    const db = freshDb();
    await pushSchema(db);
    const first = (await db.execute('SELECT id, applied_at FROM schema_migrations ORDER BY id')).rows;
    await pushSchema(db);
    const second = (await db.execute('SELECT id, applied_at FROM schema_migrations ORDER BY id')).rows;
    assert.deepEqual(second, first);
  });

  test('a pre-tracking database whose columns already exist is backfilled without error', async () => {
    const db = freshDb();
    // The shape a database had before schema_migrations: every table and column, no history.
    for (const stmt of DDL) {
      if (!stmt.includes('schema_migrations')) await db.execute(stmt);
    }
    assert.equal(await tableExists(db, 'schema_migrations'), false);
    await pushSchema(db);
    assert.deepEqual(await recorded(db), allIds);
  });

  test('a failing migration rejects with its id and leaves later migrations unapplied', async () => {
    const db = freshDb();
    const injected: Migration[] = [
      ...MIGRATIONS,
      { id: '9001_broken_index', sql: 'CREATE INDEX IF NOT EXISTS broken_idx ON no_such_table(x)' },
      { id: '9002_after_broken', sql: 'CREATE TABLE after_broken (x TEXT)' },
    ];
    await assert.rejects(pushSchema(db, injected), (err: Error) => {
      assert.match(err.message, /9001_broken_index/);
      assert.match(err.message, /no such table: (main\.)?no_such_table/);
      return true;
    });
    assert.equal(await tableExists(db, 'after_broken'), false, 'later migration did not run');
    const ids = await recorded(db);
    assert.deepEqual(ids, allIds, 'earlier ones recorded; the failing one and later ones not');
  });

  test('a non-benign error on an ALTER TABLE is not swallowed', async () => {
    const db = freshDb();
    const injected: Migration[] = [
      ...MIGRATIONS,
      { id: '9003_alter_missing_table', sql: 'ALTER TABLE no_such_table ADD COLUMN x TEXT' },
    ];
    await assert.rejects(pushSchema(db, injected), /migration 9003_alter_missing_table failed: .*no such table/);
    assert.ok(!(await recorded(db)).includes('9003_alter_missing_table'));
  });

  test('the legacy rebuild pass uses the same tolerance rule', async () => {
    const db = freshDb();
    // A legacy single-id events table that already has agent_id (benign on re-add).
    await db.execute(`CREATE TABLE events (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, ts INTEGER NOT NULL,
      provider TEXT NOT NULL, model_id TEXT NOT NULL, agent_id TEXT)`);
    await db.execute(`INSERT INTO events (id, org_id, ts, provider, model_id) VALUES ('e1', 'org_a', 1, 'p', 'm')`);
    const injected: Migration[] = [
      ...MIGRATIONS,
      // NOT NULL without a default cannot be added to an existing table: a real failure.
      { id: '9004_events_bad_column', sql: 'ALTER TABLE events ADD COLUMN bad TEXT NOT NULL' },
    ];
    await assert.rejects(pushSchema(db, injected), /migration 9004_events_bad_column failed/);
    const pk = (await db.execute('PRAGMA table_info(events)')).rows.filter((r) => Number(r.pk) > 0);
    assert.equal(pk.length, 1, 'rebuild did not run after the failure');
  });
});

describe('isBenignMigrationError', () => {
  const dup = 'SQLITE_ERROR: duplicate column name: agent_id';
  const exists = 'SQLITE_ERROR: index events_agent_idx already exists';

  test('tolerates duplicate column only on ALTER TABLE ... ADD COLUMN', () => {
    assert.equal(isBenignMigrationError('ALTER TABLE events ADD COLUMN agent_id TEXT', dup), true);
    assert.equal(isBenignMigrationError('CREATE INDEX IF NOT EXISTS i ON events(a)', dup), false);
    assert.equal(isBenignMigrationError('ALTER TABLE events RENAME TO x', dup), false);
  });

  test('tolerates already exists only on CREATE INDEX IF NOT EXISTS', () => {
    assert.equal(isBenignMigrationError('CREATE INDEX IF NOT EXISTS i ON events(a)', exists), true);
    assert.equal(isBenignMigrationError('ALTER TABLE events ADD COLUMN agent_id TEXT', exists), false);
    assert.equal(isBenignMigrationError('CREATE TABLE t (x TEXT)', exists), false);
  });

  test('anything else is a real failure', () => {
    for (const msg of [
      'SQLITE_ERROR: no such table: events',
      'SQLITE_BUSY: database is locked',
      'SQLITE_FULL: database or disk is full',
      'SQLITE_READONLY: attempt to write a readonly database',
      'SQLITE_ERROR: near "ADDD": syntax error',
    ]) {
      assert.equal(isBenignMigrationError('ALTER TABLE events ADD COLUMN agent_id TEXT', msg), false, msg);
      assert.equal(isBenignMigrationError('CREATE INDEX IF NOT EXISTS i ON events(a)', msg), false, msg);
    }
  });
});
