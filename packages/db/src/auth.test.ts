import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DDL } from './sql.js';
import { hashPassword, hashSecret, orgFromBearer, authenticateUser, hasMembership, secretEquals } from './auth.js';

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

  test('matches the env token, and only the env token', async () => {
    const opts = { client, envToken: 'env-token-xyz', envOrgId: 'org_b' };
    assert.deepEqual(await orgFromBearer('env-token-xyz', opts), { orgId: 'org_b', via: 'env' });
    assert.equal(await orgFromBearer('env-token-xy', opts), null);
    assert.equal(await orgFromBearer('env-token-xyzz', opts), null);
  });

  test('secretEquals compares without regard to length', () => {
    assert.equal(secretEquals('abc', 'abc'), true);
    assert.equal(secretEquals('abc', 'abcd'), false);
    assert.equal(secretEquals('', 'a'), false);
  });
});

describe('open ingest mode', () => {
  const empty = createClient({ url: `file:${path.join(dir, 'empty.db')}` });
  before(async () => {
    for (const stmt of DDL) await empty.execute(stmt);
  });

  test('a database with no tokens accepts anonymous ingest in development', async () => {
    const c = await orgFromBearer(undefined, { client: empty, envToken: '', production: false });
    assert.deepEqual(c, { orgId: 'org_demo', via: 'open' });
  });

  test('is refused in production', async () => {
    assert.equal(await orgFromBearer(undefined, { client: empty, envToken: '', production: true }), null);
  });

  test('is refused in production read from NODE_ENV', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal(await orgFromBearer(undefined, { client: empty, envToken: '' }), null);
    } finally {
      process.env.NODE_ENV = prev;
    }
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

  test('an unknown email still pays for a scrypt', async () => {
    const t0 = performance.now();
    await authenticateUser('a@x.test', 'nope', { client });
    const known = performance.now() - t0;
    const t1 = performance.now();
    assert.equal(await authenticateUser('nobody@x.test', 'nope', { client }), null);
    const unknown = performance.now() - t1;
    // Same order of magnitude, not a precise timing claim: without the dummy
    // hash the unknown path is a single indexed SELECT, orders faster.
    assert.ok(unknown > known / 5, `unknown ${unknown.toFixed(1)}ms vs known ${known.toFixed(1)}ms`);
  });

  test('a user in two orgs always signs into the oldest one', async () => {
    await client.execute({
      sql: 'INSERT INTO orgs (id,name,created_at) VALUES (?,?,?)',
      args: ['org_0_newer', 'Newer', Date.now() + 1000],
    });
    await client.execute({
      sql: 'INSERT INTO memberships (user_id,org_id,role) VALUES (?,?,?)',
      args: ['u_a', 'org_0_newer', 'member'],
    });
    for (let i = 0; i < 3; i++) {
      const u = await authenticateUser('a@x.test', 'secret-a', { client });
      assert.equal(u?.orgId, 'org_a');
    }
  });
});

describe('hasMembership', () => {
  test('is true for a member and false otherwise', async () => {
    assert.equal(await hasMembership('u_a', 'org_a', { client }), true);
    assert.equal(await hasMembership('u_a', 'org_b', { client }), false);
    assert.equal(await hasMembership('u_ghost', 'org_a', { client }), false);
  });
});
