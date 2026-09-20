import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput } from '@ark/core';
import {
  agUiEvidence,
  AGUI_EVENT_TYPES,
  AGUI_INTERACTION_OPERATIONS,
  AGUI_SPEC_VERSION,
} from './ag-ui.js';

describe('agUiEvidence', () => {
  test('an approval request is pending with no approver — the state the detection needs', () => {
    const e = agUiEvidence({
      eventType: 'approval.requested',
      agent: 'refund-agent',
      surface: 'support-console',
      runId: 'run_9',
    });
    assert.equal(e.protocol, 'ag-ui');
    assert.equal(e.protocolVersion, AGUI_SPEC_VERSION);
    assert.equal(e.kind, 'approval');
    assert.equal(e.outcome, 'pending');
    assert.equal(e.requiredApproval, true);
    assert.equal(e.approvedBy, undefined);
    assert.equal(e.evidenceRef, 'run_9');
  });

  test('an approval granted carries the approver and the time it took', () => {
    const e = agUiEvidence({
      eventType: 'approval.approved',
      agent: 'refund-agent',
      approvedBy: 'user_12',
      timeToApprovalMs: 41_000,
    });
    assert.equal(e.outcome, 'approved');
    assert.equal(e.requiredApproval, true);
    assert.equal(e.approvedBy, 'user_12');
    assert.equal(e.metadata.timeToApprovalMs, 41_000);
  });

  test('a refusal is denied, which is not an error', () => {
    const e = agUiEvidence({ eventType: 'approval.denied', approvedBy: null });
    assert.equal(e.outcome, 'denied');
    assert.equal(e.approvedBy, null);
  });

  test('human input requested is pending and received is not', () => {
    assert.equal(agUiEvidence({ eventType: 'human_input.requested' }).outcome, 'pending');
    assert.equal(agUiEvidence({ eventType: 'human_input.requested' }).kind, 'human_input');
    assert.equal(agUiEvidence({ eventType: 'human_input.received' }).outcome, 'ok');
  });

  test('the tool lifecycle maps to the tool kind and the right outcomes', () => {
    assert.equal(agUiEvidence({ eventType: 'tool.started' }).outcome, 'pending');
    assert.equal(agUiEvidence({ eventType: 'tool.completed' }).outcome, 'ok');
    assert.equal(agUiEvidence({ eventType: 'tool.failed' }).outcome, 'error');
    assert.equal(agUiEvidence({ eventType: 'tool.failed' }).kind, 'tool');
  });

  test('an official event type is marked as AG-UI and an ARK label as ARK', () => {
    assert.equal(agUiEvidence({ eventType: 'RUN_STARTED' }).metadata.operationSource, 'ag-ui');
    assert.equal(agUiEvidence({ eventType: 'TOOL_CALL_RESULT' }).metadata.operationSource, 'ag-ui');
    assert.equal(agUiEvidence({ eventType: 'approval.requested' }).metadata.operationSource, 'ark');
    assert.equal(agUiEvidence({ eventType: 'THINKING_START' }).metadata.operationSource, 'unknown');
  });

  test('does not store conversation text, tool argument deltas or state snapshots', () => {
    const secret = 'my card is 4111 1111 1111 1111';
    const e = agUiEvidence({
      eventType: 'TEXT_MESSAGE_CONTENT',
      delta: secret,
      content: secret,
      snapshot: { messages: [secret] },
      messages: [secret],
      rawEvent: { text: secret },
    } as never);
    assert.ok(!JSON.stringify(e).includes('4111'));
  });

  test('a subagent event is a delegation', () => {
    assert.equal(agUiEvidence({ eventType: 'SUBAGENT_STARTED' }).kind, 'delegation');
    assert.equal(agUiEvidence({ eventType: 'SUBAGENT_ERROR' }).outcome, 'error');
  });

  test('every official event type and every ARK label produces parseable evidence', () => {
    for (const eventType of [...AGUI_EVENT_TYPES, ...AGUI_INTERACTION_OPERATIONS]) {
      const e = agUiEvidence({ eventType, id: `pe_${eventType}` });
      assert.ok(EvidenceInput.safeParse(e).success, `${eventType} did not parse`);
    }
  });

  test('exports all 31 event types of the 1.0 schema', () => {
    assert.equal(AGUI_EVENT_TYPES.length, 31);
    assert.ok(!(AGUI_EVENT_TYPES as readonly string[]).includes('THINKING_START'));
    assert.ok((AGUI_EVENT_TYPES as readonly string[]).includes('REASONING_START'));
  });
});
