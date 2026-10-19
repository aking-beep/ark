import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { ActionReceipt } from '@ark/core';
import { MemoryReceiptStore } from './memory-store.js';

const receipt = (over: Partial<ActionReceipt> = {}): ActionReceipt => ({
  orgId: 'org_a', id: 'dec_1', traceId: null, agentId: 'agent_1', principal: null, tool: 'payments', action: 'refund',
  resourceType: 'order', resourceId: 'ord_1', policyId: 'pol_1', policyVersion: 1, decision: 'allow',
  reasonCode: 'rule_matched', requestDigest: 'd', executionStatus: 'not_attempted', idempotencyKeyHash: 'k',
  senderReportedApproval: false, amountMinor: 100, currency: 'USD', createdAt: 1, updatedAt: 1, ...over,
});

describe('MemoryReceiptStore', () => {
  test('record is not_attempted, refuses a duplicate id, and does not own the key', async () => {
    const s = new MemoryReceiptStore();
    assert.equal(await s.record(receipt({ executionStatus: 'completed' })), true);
    assert.equal(await s.record(receipt()), false);
    assert.equal((await s.get('org_a', 'dec_1'))?.executionStatus, 'not_attempted');
    assert.equal(await s.findClaim('org_a', 'k'), null);
  });

  test('claim refuses a non-allow decision or a missing key, like the SQL CHECKs', async () => {
    const s = new MemoryReceiptStore();
    await assert.rejects(s.claim(receipt({ decision: 'deny' })), /only an allow/);
    await assert.rejects(s.claim(receipt({ idempotencyKeyHash: null })), /requires an idempotency key/);
  });

  test('one key, one owner, per org; concurrent claims land once', async () => {
    const s = new MemoryReceiptStore();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => s.claim(receipt({ id: `dec_${i}` }))));
    assert.equal(results.filter((r) => r.claimed).length, 1);
    assert.deepEqual(await s.claim(receipt({ orgId: 'org_b' })), { claimed: true });
    const lost = results.find((r) => !r.claimed);
    assert.equal(lost && !lost.claimed && lost.existing?.id, 'dec_0');
  });

  test('a claim colliding on id alone returns existing: null', async () => {
    const s = new MemoryReceiptStore();
    await s.record(receipt());
    assert.deepEqual(await s.claim(receipt({ idempotencyKeyHash: 'other' })), { claimed: false, existing: null });
  });

  test('finish moves attempted once; stored rows are copies', async () => {
    const s = new MemoryReceiptStore();
    await s.claim(receipt());
    await s.finish('org_a', 'dec_1', 'completed', 5);
    await s.finish('org_a', 'dec_1', 'outcome_unknown', 6);
    const r = (await s.get('org_a', 'dec_1'))!;
    assert.equal(r.executionStatus, 'completed');
    r.executionStatus = 'failed';
    assert.equal((await s.get('org_a', 'dec_1'))?.executionStatus, 'completed');
  });
});
