import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionLabel,
  executionLabel,
  executionNote,
  executionTone,
  isSimulation,
  formatAmount,
  formatWhen,
  policyLabel,
  tallyReceipts,
  receiptBasis,
  IGNORED_APPROVAL_TEXT,
  DECISION_LABELS,
  EXECUTION_LABELS,
} from './receipts.ts';

describe('decisionLabel', () => {
  test('maps the four kernel decisions; require_approval is pending, never approved', () => {
    assert.equal(decisionLabel('allow'), 'allow');
    assert.equal(decisionLabel('deny'), 'deny');
    assert.equal(decisionLabel('require_approval'), 'pending approval');
    assert.equal(decisionLabel('unknown'), 'unknown');
  });

  test('anything else is unknown, and no label anywhere says approved', () => {
    for (const v of [null, undefined, '', 'approved', 'ALLOW', 'allowed']) assert.equal(decisionLabel(v), 'unknown');
    for (const l of [...DECISION_LABELS, ...EXECUTION_LABELS]) assert.doesNotMatch(l, /^approved|success/i);
  });
});

describe('executionLabel', () => {
  test('maps the stored statuses', () => {
    assert.equal(executionLabel('completed'), 'completed');
    assert.equal(executionLabel('not_attempted'), 'not attempted');
    assert.equal(executionLabel('failed'), 'failed');
    assert.equal(executionLabel('outcome_unknown'), 'outcome unknown');
  });

  test('attempted (possibly executed) reads as outcome unknown, with a note', () => {
    assert.equal(executionLabel('attempted'), 'outcome unknown');
    assert.match(executionNote('attempted')!, /may have executed/);
  });

  test('a missing or unrecognised status is unknown, never a success', () => {
    for (const v of [null, undefined, '', 'ok', 'success', 'done']) {
      assert.equal(executionLabel(v), 'unknown');
      assert.notEqual(executionTone(executionLabel(v)), 'good');
      assert.match(executionNote(v)!, /No execution status recorded/);
    }
  });

  test('only completed is green; failures and unknown outcomes are amber, never red', () => {
    assert.equal(executionTone('completed'), 'good');
    assert.equal(executionTone('failed'), 'warn');
    assert.equal(executionTone('outcome unknown'), 'warn');
    assert.equal(executionTone('not attempted'), 'neutral');
    assert.equal(executionTone('unknown'), 'neutral');
    for (const l of EXECUTION_LABELS) assert.notEqual(executionTone(l), 'danger');
  });
});

describe('isSimulation', () => {
  test('the guard demo agent on a demo tool id is a simulation', () => {
    assert.equal(isSimulation({ agentId: 'agent_support_bot', tool: 'payments', action: 'refund' }), true);
    assert.equal(isSimulation({ agentId: 'agent_support_bot', tool: 'billing', action: 'refund' }), true);
  });

  test('a real agent calling the same tool is not', () => {
    assert.equal(isSimulation({ agentId: 'refund-agent', tool: 'payments', action: 'refund' }), false);
    assert.equal(isSimulation({ agentId: 'agent_support_bot', tool: 'payments', action: 'capture' }), false);
  });
});

describe('formatting', () => {
  test('amounts use the currency exponent', () => {
    assert.equal(formatAmount(7_500, 'USD'), 'USD 75.00');
    assert.equal(formatAmount(500_000, 'USD'), 'USD 5,000.00');
    assert.equal(formatAmount(1_200, 'JPY'), 'JPY 1,200');
    assert.equal(formatAmount(null, 'USD'), '—');
    assert.match(formatAmount(10, null), /minor units/);
    assert.match(formatAmount(10, 'NOT'), /minor units/);
  });

  test('time is absolute UTC', () => {
    assert.equal(formatWhen(1_792_400_400_000), '2026-10-19 09:00:00 UTC');
  });

  test('policy id and version, or says none matched', () => {
    assert.equal(policyLabel({ policyId: 'pol_demo_refund_synthetic', policyVersion: 1 }), 'pol_demo_refund_synthetic v1');
    assert.equal(policyLabel({ policyId: null, policyVersion: null }), 'no matching policy');
  });

  test('the ignored-approval sentence says so in words', () => {
    assert.match(IGNORED_APPROVAL_TEXT, /ignored/i);
    assert.match(IGNORED_APPROVAL_TEXT, /not an approval/);
  });
});

describe('tallyReceipts', () => {
  test('folds stored values onto labels; attempted counts as outcome unknown', () => {
    const t = tallyReceipts({
      total: 8,
      byDecision: { allow: 3, deny: 1, require_approval: 2, unknown: 1, bogus: 1 },
      byExecutionStatus: { completed: 1, not_attempted: 5, outcome_unknown: 1, attempted: 1 },
    });
    assert.deepEqual(t.decisions, { allow: 3, deny: 1, 'pending approval': 2, unknown: 2 });
    assert.deepEqual(t.executions, { completed: 1, 'not attempted': 5, failed: 0, 'outcome unknown': 2, unknown: 0 });
  });

  test('receipts are measured, n = receipts, sourced to the guard', () => {
    const b = receiptBasis(7);
    assert.equal(b.basis, 'measured');
    assert.equal(b.sampleSize, 7);
    assert.match(b.source, /decided and recorded by @ark\/guard/);
  });
});
