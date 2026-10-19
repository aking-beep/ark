// Evidence probe for tracked-migrations. Run from the repo root after
// `npm run build:packages`:  node evidence/tracked-migrations/probe.mjs
// Uses the built @ark/db (packages/db/dist/sql.js) against libSQL files in a temp dir.
// Works against both shapes of MIGRATIONS: string[] (before) and {id, sql}[] (after).
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MIGRATIONS, pushSchema } from '../../packages/db/dist/sql.js';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-tracked-migrations-'));
const db = (name) => createClient({ url: `file:${path.join(dir, name)}` });

async function migrationRows(client) {
  try {
    const r = await client.execute('SELECT COUNT(*) AS n FROM schema_migrations');
    return String(r.rows[0].n);
  } catch (err) {
    return `n/a (${err.message})`;
  }
}

console.log(`node ${process.version}; MIGRATIONS has ${MIGRATIONS.length} entries`);

// 1. A deliberately broken migration appended: a statement naming a missing table.
const brokenSql = 'ALTER TABLE no_such_table ADD COLUMN x TEXT';
const broken = typeof MIGRATIONS[0] === 'string' ? brokenSql : { id: '9999_broken_probe', sql: brokenSql };
MIGRATIONS.push(broken);
const a = db('broken.db');
try {
  await pushSchema(a);
  console.log(`[broken migration] pushSchema RESOLVED - "${brokenSql}" was swallowed silently`);
} catch (err) {
  console.log(`[broken migration] pushSchema REJECTED: ${err.message}`);
} finally {
  MIGRATIONS.pop();
}
console.log(`[broken migration] schema_migrations rows: ${await migrationRows(a)}`);

// 2. A fresh database pushed twice.
const b = db('fresh.db');
await pushSchema(b);
console.log(`[fresh, push 1] schema_migrations rows: ${await migrationRows(b)}`);
await pushSchema(b);
console.log(`[fresh, push 2] schema_migrations rows: ${await migrationRows(b)}`);
