import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ActionReceipt } from '@ark/core';
import { openActionReceiptStore } from '@ark/db';
import { MemoryReceiptStore } from '../memory-store.js';
import { runRefundScenarios, type ScenarioRow } from './scenarios.js';

/**
 * Integration: the spec's scenario table through `guardTool`, asserting the
 * handler call count for every case — zero in every blocked case, exactly one
 * for the allowed-and-replayed pair. Run against both receipt stores.
 */

interface Expect {
  outcome: string;
  decision: string;
  executionStatus: string;
  calls: number;
  reasonCode?: string;
  senderReportedApproval?: boolean;
}

const EXPECTED: Record<string, Expect> = {
  '$75': { outcome: 'executed', decision: 'allow', executionStatus: 'completed', calls: 1 },
  '$750': { outcome: 'pending_approval', decision: 'require_approval', executionStatus: 'not_attempted', calls: 0 },
  '$5,000': { outcome: 'blocked', decision: 'deny', executionStatus: 'not_attempted', calls: 0 },
  'unknown tool or policy': { outcome: 'blocked', decision: 'unknown', executionStatus: 'not_attempted', calls: 0, reasonCode: 'no_matching_policy' },
  'context for another org': { outcome: 'blocked', decision: 'unknown', executionStatus: 'not_attempted', calls: 0, reasonCode: 'no_matching_policy' },
  'forged approvedBy "ceo" on $750': { outcome: 'pending_approval', decision: 'require_approval', executionStatus: 'not_attempted', calls: 0, senderReportedApproval: true },
  '$75 replayed, same idempotency key': { outcome: 'replayed', decision: 'allow', executionStatus: 'completed', calls: 0, reasonCode: 'idempotency_replay' },
  'handler throws after starting': { outcome: 'execution_failed', decision: 'allow', executionStatus: 'outcome_unknown', calls: 1 },
};

function check(rows: ScenarioRow[]): void {
  assert.deepEqual(rows.map((r) => r.name), Object.keys(EXPECTED));
  for (const { name, result, calls } of rows) {
    const e = EXPECTED[name]!;
    assert.equal(result.outcome, e.outcome, name);
    assert.equal(result.decision, e.decision, name);
    assert.equal(result.executionStatus, e.executionStatus, name);
    assert.equal(calls, e.calls, `${name}: handler calls`);
    assert.equal(result.handlerInvoked, e.calls === 1, name);
    if (e.reasonCode) assert.equal(result.reasonCode, e.reasonCode, name);
    assert.ok(result.receipt, `${name}: every attempt with a trusted org leaves a receipt`);
    assert.equal(result.receipt.senderReportedApproval, e.senderReportedApproval ?? false, name);
  }
  const pair = rows.filter((r) => r.name === '$75' || r.name === '$75 replayed, same idempotency key');
  assert.equal(pair.reduce((s, r) => s + r.calls, 0), 1, 'the allowed and replayed pair runs the handler exactly once');
  const replay = rows.find((r) => r.result.outcome === 'replayed')!.result;
  assert.equal(replay.outcome === 'replayed' && replay.original.id, rows[0]!.result.receipt?.id);
}

describe('synthetic refund scenarios through guardTool', () => {
  test('in-memory receipts', async () => {
    const receipts = new MemoryReceiptStore();
    const { rows, ledger } = await runRefundScenarios({ receipts });
    check(rows);
    assert.equal(ledger.calls, 2);
    assert.deepEqual(ledger.entries.map((e) => [e.orderId, e.amountMinor]), [['ord_1001', 7_500]]);
    assert.equal((await receipts.list('org_demo')).length + (await receipts.list('org_other')).length, 8);
  });

  test('libSQL receipts in a temporary database', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ark-guard-scenarios-'));
    const { store, close } = await openActionReceiptStore(`file:${path.join(dir, 'receipts.db')}`);
    const { rows, ledger } = await runRefundScenarios({ receipts: store });
    check(rows);
    assert.equal(ledger.calls, 2);
    const stored: ActionReceipt[] = [...(await store.list('org_demo')), ...(await store.list('org_other'))];
    close();
    assert.equal(stored.length, 8);
    // What was stored is what each result reported.
    for (const { name, result } of rows) {
      assert.deepEqual(stored.find((s) => s.id === result.receipt!.id && s.orgId === result.receipt!.orgId), result.receipt, name);
    }
    // The other-org attempt is stored under the trusted org, not the one in the arguments.
    assert.equal(rows.find((r) => r.name === 'context for another org')!.result.receipt?.orgId, 'org_other');
  });
});
