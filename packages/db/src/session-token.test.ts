import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from './session-token.js';

const secret = 'test-session-secret-not-for-prod';

describe('session token', () => {
  test('round-trips a payload', async () => {
    const token = await signSession({
      userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp: Date.now() + 60_000,
    }, secret);
    const got = await verifySession(token, secret);
    assert.equal(got?.orgId, 'org_a');
    assert.equal(got?.email, 'a@x.test');
  });

  test('rejects a truncated or flipped token', async () => {
    const token = await signSession({
      userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp: Date.now() + 60_000,
    }, secret);
    assert.equal(await verifySession(token.slice(0, -2) + 'ab', secret), null);
    assert.equal(await verifySession(undefined, secret), null);
  });

  test('rejects an expired payload', async () => {
    const token = await signSession({
      userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp: Date.now() - 1,
    }, secret);
    assert.equal(await verifySession(token, secret), null);
  });
});
