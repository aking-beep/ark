import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DDL } from './sql.js';
import { hashPassword, hashSecret, orgFromBearer, authenticateUser } from './auth.js';

const dir = mkdtempSync(path.join(tmpdir(), 'ark-auth-'));
const client = createClient({ url: `file:${path.join(dir, 'test.db')}` });

before(async () => {
  for (const stmt of DDL) await client.execute(stmt);
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: ['org_a', 'A', Date.now()],
  });
  await client.execute({
    sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
    args: ['org_b', 'B', Date.now()],
  });
  await client.execute({
    sql: 'INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)',
    args: ['u_a', 'a@x.test', hashPassword('secret-a'), Date.now()],
  });
  await client.execute({
    sql: 'INSERT INTO memberships (user_id,org_id,role) VALUES (?,?,?)',
    args: ['u_a', 'org_a', 'owner'],
  });
  await client.execute({
    sql: 'INSERT INTO org_tokens (id,org_id,name,token_hash,created_at) VALUES (?,?,?,?,?)',
    args: ['tok_a', 'org_a', 'ingest', hashSecret('token-a'), Date.now()],
  });
});

describe('orgFromBearer', () => {
  test('maps a hashed token to its org', async () => {
    const c = await orgFromBearer('token-a', { client });
    assert.equal(c?.orgId, 'org_a');
    assert.equal(c?.via, 'token');
  });

  test('rejects an unknown token', async () => {
    assert.equal(await orgFromBearer('token-b', { client }), null);
  });

  test('rejects a missing token once tokens exist', async () => {
    assert.equal(await orgFromBearer(undefined, { client }), null);
  });
});

describe('authenticateUser', () => {
  test('returns the membership org on a correct password', async () => {
    const u = await authenticateUser('a@x.test', 'secret-a', { client });
    assert.equal(u?.orgId, 'org_a');
  });

  test('fails closed on a wrong password', async () => {
    assert.equal(await authenticateUser('a@x.test', 'nope', { client }), null);
  });
});
