import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_REFUND_POLICY,
  MIN_APPROVAL_SECRET_BYTES,
  decideAction,
  mintApprovalGrant,
  type ApprovalGrant,
  type ApprovalStore,
} from '@ark/core';
import { MemoryReceiptStore } from './memory-store.js';
import { MemoryApprovalStore } from './memory-approval-store.js';
import { DEMO_CONTEXT, RefundLedger, callerChosenKey, guardedRefundTool } from './demo/refund.js';
import { DEMO_EPOCH_MS } from './demo/scenarios.js';

const T0 = DEMO_EPOCH_MS;
const SECRET = 'k'.repeat(MIN_APPROVAL_SECRET_BYTES);

/** $750: inside the demo policy's approval band ($100–$1,000). */
const r750 = { orderId: 'ord_1', amountMinor: 75_000, currency: 'USD', idempotencyKey: 'key-750' };
/** $50: an outright allow, so it must never touch the approval path. */
const r50 = { orderId: 'ord_2', amountMinor: 5_000, currency: 'USD', idempotencyKey: 'key-50' };

function setup(over: { approvals?: { store: ApprovalStore; secret: string | Uint8Array } } = {}) {
  const ledger = new RefundLedger();
  const receipts = new MemoryReceiptStore();
  const approvalStore = new MemoryApprovalStore();
  const tool = guardedRefundTool({
    ledger,
    receipts,
    clock: () => T0,
    idempotencyKey: callerChosenKey,
    approvals: over.approvals ?? { store: approvalStore, secret: SECRET },
  });
  return { ledger, receipts, approvalStore, tool };
}

/** The decision the guard will reach for `r750` under the demo context. */
function decisionFor(amountMinor = 75_000, orderId = 'ord_1') {
  return decideAction(
    {
      orgId: DEMO_CONTEXT.orgId,
      agentId: DEMO_CONTEXT.agentId,
      principal: DEMO_CONTEXT.principal,
      tool: 'payments',
      action: 'refund',
      resource: { type: 'order', id: orderId },
      attributes: { amountMinor, currency: 'USD' },
      now: T0,
    },
    [DEMO_REFUND_POLICY],
  );
}

async function approve(store: ApprovalStore, amountMinor = 75_000, orderId = 'ord_1') {
  const decision = decisionFor(amountMinor, orderId);
  assert.equal(decision.decision, 'require_approval');
  const minted = mintApprovalGrant(SECRET, decision, {
    orgId: DEMO_CONTEXT.orgId,
    nonce: `nonce_${orderId}`,
    approvedBy: 'user_manager',
    now: T0,
    ttlMs: 15 * 60 * 1000,
  });
  assert.equal(minted.ok, true);
  if (!minted.ok) throw new Error('mint failed');
  const ask = await store.get(DEMO_CONTEXT.orgId, decision.decisionId);
  assert.ok(ask, 'the guard should have opened the ask first');
  assert.equal(await store.approve(DEMO_CONTEXT.orgId, decision.decisionId, minted.grant, T0), true);
  return { decision, grant: minted.grant };
}

describe('without an approval service, nothing changes', () => {
  test('require_approval still stops the call', async () => {
    const ledger = new RefundLedger();
    const tool = guardedRefundTool({
      ledger, receipts: new MemoryReceiptStore(), clock: () => T0, idempotencyKey: callerChosenKey,
    });
    const res = await tool(r750);
    assert.equal(res.outcome, 'pending_approval');
    assert.equal(ledger.calls, 0);
  });
});

describe('the ask', () => {
  test('a first attempt opens an ask and executes nothing', async () => {
    const { tool, ledger, approvalStore } = setup();
    const res = await tool(r750);

    assert.equal(res.outcome, 'pending_approval');
    assert.equal(ledger.calls, 0, 'no money may move before a person answers');
    assert.ok(res.notes.includes('approval_pending'));

    const pending = await approvalStore.listPending(DEMO_CONTEXT.orgId, T0);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.decisionId, res.decisionId);
    assert.equal(pending[0]?.status, 'pending');
    // The ask carries identifiers and digests, never the arguments.
    assert.equal(Object.hasOwn(pending[0] ?? {}, 'attributes'), false);
  });

  test('a retrying agent does not flood the queue', async () => {
    const { tool, approvalStore } = setup();
    await tool(r750);
    await tool(r750);
    await tool(r750);
    assert.equal((await approvalStore.listPending(DEMO_CONTEXT.orgId, T0)).length, 1);
  });

  test('an outright allow never opens an ask', async () => {
    const { tool, ledger, approvalStore } = setup();
    const res = await tool(r50);
    assert.equal(res.outcome, 'executed');
    assert.equal(ledger.calls, 1);
    assert.equal((await approvalStore.listPending(DEMO_CONTEXT.orgId, T0)).length, 0);
  });
});

describe('approval lets the action run, once', () => {
  test('after a person approves, the next attempt executes', async () => {
    const { tool, ledger, approvalStore, receipts } = setup();
    await tool(r750);
    const { decision } = await approve(approvalStore);

    const res = await tool(r750);
    assert.equal(res.outcome, 'executed');
    assert.equal(ledger.calls, 1);
    assert.ok(res.notes.includes('approval_redeemed'));

    // The result reports what the KERNEL decided.
    assert.equal(res.decision, 'require_approval');
    // The receipt records an allow, which is what the store CHECKs for
    // anything that executed, with the reason naming the person's approval.
    const stored = await receipts.get(DEMO_CONTEXT.orgId, decision.decisionId);
    assert.equal(stored?.decision, 'allow');
    assert.equal(stored?.reasonCode, 'approved_by_person');
    assert.equal(stored?.executionStatus, 'completed');
  });

  test('the grant is single-use: a replay does not refund twice', async () => {
    const { tool, ledger, approvalStore } = setup();
    await tool(r750);
    await approve(approvalStore);

    assert.equal((await tool(r750)).outcome, 'executed');
    assert.equal(ledger.calls, 1);

    // Same call again. The grant is spent; the idempotency key is also spent.
    const again = await tool(r750);
    assert.notEqual(again.outcome, 'executed');
    assert.equal(ledger.calls, 1, 'a replayed approval must not move money twice');
  });

  test('redeeming twice directly returns the grant only once', async () => {
    const { tool, approvalStore } = setup();
    await tool(r750);
    const { decision } = await approve(approvalStore);

    const first = await approvalStore.redeem(DEMO_CONTEXT.orgId, decision.decisionId, T0);
    assert.ok(first);
    assert.equal(await approvalStore.redeem(DEMO_CONTEXT.orgId, decision.decisionId, T0), null);
  });

  test('concurrent redemptions yield at most one grant', async () => {
    const { tool, approvalStore } = setup();
    await tool(r750);
    const { decision } = await approve(approvalStore);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => approvalStore.redeem(DEMO_CONTEXT.orgId, decision.decisionId, T0)),
    );
    assert.equal(results.filter((g) => g !== null).length, 1);
  });
});

describe('denial and expiry', () => {
  test('a denied ask never executes', async () => {
    const { tool, ledger, approvalStore } = setup();
    const first = await tool(r750);
    assert.equal(
      await approvalStore.deny(DEMO_CONTEXT.orgId, first.decisionId ?? '', 'user_manager', T0),
      true,
    );

    const res = await tool(r750);
    assert.equal(res.outcome, 'pending_approval');
    assert.equal(ledger.calls, 0);
  });

  test('a denied ask cannot then be approved', async () => {
    const { tool, approvalStore } = setup();
    const first = await tool(r750);
    const id = first.decisionId ?? '';
    await approvalStore.deny(DEMO_CONTEXT.orgId, id, 'user_manager', T0);

    const decision = decisionFor();
    const minted = mintApprovalGrant(SECRET, decision, {
      orgId: DEMO_CONTEXT.orgId, nonce: 'n', approvedBy: 'user_sneaky', now: T0, ttlMs: 1000,
    });
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    assert.equal(await approvalStore.approve(DEMO_CONTEXT.orgId, id, minted.grant, T0), false);
  });

  test('approving twice is refused', async () => {
    const { tool, approvalStore } = setup();
    await tool(r750);
    const { decision, grant } = await approve(approvalStore);
    assert.equal(
      await approvalStore.approve(DEMO_CONTEXT.orgId, decision.decisionId, grant, T0),
      false,
    );
  });

  test('a pending ask disappears from the queue once expired', async () => {
    const { tool, approvalStore } = setup();
    const res = await tool(r750);
    const ask = await approvalStore.get(DEMO_CONTEXT.orgId, res.decisionId ?? '');
    assert.ok(ask);
    assert.equal((await approvalStore.listPending(DEMO_CONTEXT.orgId, ask.expiresAt)).length, 0);
  });
});

describe('a forged or foreign grant does not execute', () => {
  test('a grant signed with the wrong secret is refused and spent', async () => {
    const { tool, ledger, approvalStore } = setup();
    const first = await tool(r750);
    const id = first.decisionId ?? '';

    const decision = decisionFor();
    const forged = mintApprovalGrant('z'.repeat(MIN_APPROVAL_SECRET_BYTES), decision, {
      orgId: DEMO_CONTEXT.orgId, nonce: 'n', approvedBy: 'user_attacker', now: T0, ttlMs: 60_000,
    });
    assert.equal(forged.ok, true);
    if (!forged.ok) return;
    assert.equal(await approvalStore.approve(DEMO_CONTEXT.orgId, id, forged.grant, T0), true);

    const res = await tool(r750);
    assert.equal(res.outcome, 'blocked');
    assert.equal(ledger.calls, 0);
    assert.ok(res.notes.includes('approval_grant_invalid'));

    // Spent on the failed attempt, so it cannot be retried.
    assert.equal(await approvalStore.redeem(DEMO_CONTEXT.orgId, id, T0), null);
  });

  test('a grant for a different amount does not authorise this one', async () => {
    const { tool, ledger, approvalStore } = setup();
    const first = await tool(r750);
    const id = first.decisionId ?? '';

    // Approved for $200, attached to the $750 ask.
    const other = decisionFor(20_000, 'ord_1');
    const minted = mintApprovalGrant(SECRET, other, {
      orgId: DEMO_CONTEXT.orgId, nonce: 'n', approvedBy: 'user_manager', now: T0, ttlMs: 60_000,
    });
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    // The store itself refuses a grant bound to another decision.
    assert.equal(await approvalStore.approve(DEMO_CONTEXT.orgId, id, minted.grant, T0), false);
    assert.equal((await tool(r750)).outcome, 'pending_approval');
    assert.equal(ledger.calls, 0);
  });
});

describe('the store failing is not permission', () => {
  test('a redeem that throws blocks the call', async () => {
    const failing: ApprovalStore = {
      open: async () => true,
      get: async () => null,
      listPending: async () => [],
      approve: async () => false,
      deny: async () => false,
      redeem: async () => { throw new Error('store down'); },
    };
    const ledger = new RefundLedger();
    const tool = guardedRefundTool({
      ledger, receipts: new MemoryReceiptStore(), clock: () => T0,
      idempotencyKey: callerChosenKey, approvals: { store: failing, secret: SECRET },
    });

    const res = await tool(r750);
    assert.equal(res.outcome, 'blocked');
    assert.equal(ledger.calls, 0);
    assert.ok(res.notes.includes('approval_store_failed'));
  });

  test('a redeem that hangs blocks the call rather than waiting forever', async () => {
    const hanging: ApprovalStore = {
      open: async () => true,
      get: async () => null,
      listPending: async () => [],
      approve: async () => false,
      deny: async () => false,
      redeem: () => new Promise<ApprovalGrant | null>(() => {}),
    };
    const ledger = new RefundLedger();
    const tool = guardedRefundTool({
      ledger, receipts: new MemoryReceiptStore(), clock: () => T0,
      idempotencyKey: callerChosenKey, approvals: { store: hanging, secret: SECRET },
      timeouts: { storeMs: 20 },
    });

    const res = await tool(r750);
    assert.equal(res.outcome, 'blocked');
    assert.equal(ledger.calls, 0);
  });

  test('a secret below the floor cannot approve anything', async () => {
    const { approvalStore } = setup();
    const ledger = new RefundLedger();
    const tool = guardedRefundTool({
      ledger, receipts: new MemoryReceiptStore(), clock: () => T0,
      idempotencyKey: callerChosenKey, approvals: { store: approvalStore, secret: 'short' },
    });
    const first = await tool(r750);
    assert.equal(first.outcome, 'pending_approval');

    // Even a grant minted under the real secret fails, because the guard's own
    // secret is too short to verify with.
    const decision = decisionFor();
    const minted = mintApprovalGrant(SECRET, decision, {
      orgId: DEMO_CONTEXT.orgId, nonce: 'n', approvedBy: 'user_manager', now: T0, ttlMs: 60_000,
    });
    if (!minted.ok) return assert.fail('mint failed');
    await approvalStore.approve(DEMO_CONTEXT.orgId, first.decisionId ?? '', minted.grant, T0);

    const res = await tool(r750);
    assert.equal(res.outcome, 'blocked');
    assert.equal(ledger.calls, 0);
  });
});
