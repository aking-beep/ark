import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_REFUND_POLICY,
  MAX_GRANT_TTL_MS,
  MIN_APPROVAL_SECRET_BYTES,
  decideAction,
  mintApprovalGrant,
  timingSafeHexEqual,
  verifyApprovalGrant,
  type ActionDecision,
  type ActionRequest,
} from '../index.js';

const NOW = 1_760_000_000_000;
const SECRET = 'x'.repeat(MIN_APPROVAL_SECRET_BYTES);
const OTHER_SECRET = 'y'.repeat(MIN_APPROVAL_SECRET_BYTES);

function req(amountMinor: number, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    orgId: 'org_demo',
    agentId: 'agent_support_refunds',
    principal: 'user_42',
    tool: 'payments',
    action: 'refund',
    resource: { type: 'order', id: 'ord_1001' },
    attributes: { amountMinor, currency: 'USD' },
    now: NOW,
    ...overrides,
  };
}

/** $750: above allow, below deny, so the demo policy asks for a person. */
const pending = (): ActionDecision => decideAction(req(75_000), [DEMO_REFUND_POLICY]);
const allowed = (): ActionDecision => decideAction(req(5_000), [DEMO_REFUND_POLICY]);
const denied = (): ActionDecision => decideAction(req(500_000), [DEMO_REFUND_POLICY]);

const mint = (decision = pending(), over: Record<string, unknown> = {}) =>
  mintApprovalGrant(SECRET, decision, {
    orgId: 'org_demo',
    nonce: 'nonce_1',
    approvedBy: 'user_manager',
    now: NOW,
    ttlMs: 15 * 60 * 1000,
    ...over,
  });

const verify = (grant: unknown, decision = pending(), now = NOW, secret: string = SECRET) =>
  verifyApprovalGrant(secret, grant, { orgId: 'org_demo', decision, now });

describe('the demo policy actually produces an approval case', () => {
  test('$750 requires approval, $50 allows, $5,000 denies', () => {
    assert.equal(pending().decision, 'require_approval');
    assert.equal(allowed().decision, 'allow');
    assert.equal(denied().decision, 'deny');
  });
});

describe('minting', () => {
  test('mints a signed grant for a require_approval decision', () => {
    const r = mint();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.grant.decisionId, pending().decisionId);
    assert.match(r.grant.signature, /^[0-9a-f]{64}$/);
  });

  test('refuses to grant an allow or a deny', () => {
    // An allow needs no grant; a deny must never acquire one.
    for (const d of [allowed(), denied()]) {
      const r = mint(d);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'decision_not_approvable');
    }
  });

  test('refuses a secret shorter than the floor', () => {
    const r = mintApprovalGrant('short', pending(), {
      orgId: 'org_demo', nonce: 'n', approvedBy: 'u', now: NOW, ttlMs: 1000,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'secret_too_short');
  });

  test('clamps the expiry to the decision, never past it', () => {
    const d = pending();
    const r = mint(d, { ttlMs: MAX_GRANT_TTL_MS });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.grant.expiresAt, d.expiresAt);
    assert.ok(r.grant.expiresAt <= (d.expiresAt ?? 0));
  });

  test('refuses a TTL beyond the ceiling', () => {
    const r = mint(pending(), { ttlMs: MAX_GRANT_TTL_MS + 1 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'ttl_too_long');
  });

  test('refuses to mint once the decision has already expired', () => {
    const d = pending();
    const r = mint(d, { now: (d.expiresAt ?? 0) + 1 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'expired');
  });

  test('rejects empty identifiers rather than signing them', () => {
    for (const over of [{ orgId: '' }, { nonce: '' }, { approvedBy: '' }]) {
      const r = mint(pending(), over);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'malformed_grant');
    }
  });
});

describe('verification is fail-closed', () => {
  test('accepts a grant it just minted', () => {
    const m = mint();
    assert.equal(m.ok, true);
    if (!m.ok) return;
    assert.equal(verify(m.grant).ok, true);
  });

  test('rejects a grant signed with a different secret', () => {
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    const r = verify(m.grant, pending(), NOW, OTHER_SECRET);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'signature_invalid');
  });

  test('rejects every single-field tamper', () => {
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    const tampers: Partial<Record<string, unknown>>[] = [
      { orgId: 'org_other' },
      { decisionId: 'deadbeef' },
      { nonce: 'nonce_2' },
      { approvedBy: 'user_attacker' },
      { issuedAt: NOW - 1 },
      { expiresAt: NOW + MAX_GRANT_TTL_MS },
      { signature: 'f'.repeat(64) },
    ];
    for (const t of tampers) {
      const r = verify({ ...m.grant, ...t });
      assert.equal(r.ok, false, `tamper ${JSON.stringify(t)} verified`);
      if (!r.ok) {
        assert.ok(
          ['signature_invalid', 'malformed_grant'].includes(r.reason),
          `tamper ${JSON.stringify(t)} gave ${r.reason}`,
        );
      }
    }
  });

  test('a grant for one decision does not authorise another', () => {
    // The whole point of binding: a $750 approval must not run a $4,000 refund.
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    const otherDecision = decideAction(
      req(75_000, { resource: { type: 'order', id: 'ord_9999' } }),
      [DEMO_REFUND_POLICY],
    );
    assert.equal(otherDecision.decision, 'require_approval');
    assert.notEqual(otherDecision.decisionId, m.grant.decisionId);

    const r = verifyApprovalGrant(SECRET, m.grant, {
      orgId: 'org_demo', decision: otherDecision, now: NOW,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'decision_mismatch');
  });

  test('a grant from one org does not work in another', () => {
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    const r = verifyApprovalGrant(SECRET, m.grant, {
      orgId: 'org_other', decision: pending(), now: NOW,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'org_mismatch');
  });

  test('expires exactly at expiresAt, not after', () => {
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    assert.equal(verify(m.grant, pending(), m.grant.expiresAt - 1).ok, true);
    const r = verify(m.grant, pending(), m.grant.expiresAt);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'expired');
  });

  test('rejects a grant issued in the future', () => {
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    const r = verify(m.grant, pending(), m.grant.issuedAt - 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'issued_in_future');
  });

  test('rejects junk without throwing', () => {
    for (const junk of [null, undefined, 0, '', 'grant', [], {}, { signature: 1 }]) {
      const r = verify(junk);
      assert.equal(r.ok, false, `${JSON.stringify(junk)} verified`);
    }
  });

  test('will not verify against an allow or a deny', () => {
    const m = mint();
    if (!m.ok) return assert.fail('mint failed');
    for (const d of [allowed(), denied()]) {
      const forged = { ...m.grant, decisionId: d.decisionId };
      const r = verifyApprovalGrant(SECRET, forged, { orgId: 'org_demo', decision: d, now: NOW });
      assert.equal(r.ok, false);
    }
  });
});

describe('timingSafeHexEqual', () => {
  test('matches identical strings and rejects differing ones', () => {
    assert.equal(timingSafeHexEqual('abc123', 'abc123'), true);
    assert.equal(timingSafeHexEqual('abc123', 'abc124'), false);
    assert.equal(timingSafeHexEqual('abc123', 'abc12'), false);
    assert.equal(timingSafeHexEqual('', ''), true);
  });

  test('reads the whole string rather than stopping at the first difference', () => {
    // A short-circuiting compare leaks position through timing. This checks the
    // observable contract: a first-character difference and a last-character
    // difference are both simply false.
    assert.equal(timingSafeHexEqual('0aaaaaaa', 'faaaaaaa'), false);
    assert.equal(timingSafeHexEqual('aaaaaaa0', 'aaaaaaaf'), false);
  });
});
