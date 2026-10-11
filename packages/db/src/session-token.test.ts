import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, SESSION_TTL_MS, type SessionPayload } from './session-token.js';

const hmacKey = 'test-session-hmac-not-for-prod';

describe('session token', () => {
  test('round-trips a payload', async () => {
    const token = await signSession({
      userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp: Date.now() + 60_000,
    }, hmacKey);
    const got = await verifySession(token, hmacKey);
    assert.equal(got?.orgId, 'org_a');
    assert.equal(got?.email, 'a@x.test');
  });

  test('rejects a truncated or flipped token', async () => {
    const token = await signSession({
      userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp: Date.now() + 60_000,
    }, hmacKey);
    assert.equal(await verifySession(token.slice(0, -2) + 'ab', hmacKey), null);
    assert.equal(await verifySession(undefined, hmacKey), null);
  });

  test('rejects a signed payload with no exp, or a non-numeric one', async () => {
    for (const exp of [undefined, null, 'never', Number.POSITIVE_INFINITY, Number.NaN]) {
      const token = await signSession(
        { userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp } as unknown as SessionPayload,
        hmacKey,
      );
      assert.equal(await verifySession(token, hmacKey), null, `exp=${String(exp)}`);
    }
  });

  test('sessions last twelve hours', () => {
    assert.equal(SESSION_TTL_MS, 12 * 3600 * 1000);
  });

  test('rejects an expired payload', async () => {
    const token = await signSession({
      userId: 'u1', orgId: 'org_a', email: 'a@x.test', orgName: 'A', exp: Date.now() - 1,
    }, hmacKey);
    assert.equal(await verifySession(token, hmacKey), null);
  });
});
