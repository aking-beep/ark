import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput } from '@ark/core';
import {
  a2aEvidence,
  a2aOutcome,
  A2A_METHODS,
  A2A_TASK_STATES,
  A2A_SPEC_VERSION,
  A2A_LEGACY_SPEC_VERSION,
  A2A_AGENT_CARD_PATH,
} from './a2a.js';

describe('a2aEvidence', () => {
  test('a delegation normalises into actor, target and the task it opened', () => {
    const e = a2aEvidence({
      operation: 'delegate',
      agent: 'operator-agent',
      peerAgent: 'security-agent',
      taskId: 'task_123',
      taskState: 'TASK_STATE_COMPLETED',
    });
    assert.equal(e.protocol, 'a2a');
    assert.equal(e.protocolVersion, A2A_SPEC_VERSION);
    assert.equal(e.kind, 'delegation');
    assert.equal(e.operation, 'delegate');
    assert.equal(e.actor, 'operator-agent');
    assert.equal(e.target, 'security-agent');
    assert.equal(e.evidenceRef, 'task_123');
    assert.equal(e.outcome, 'ok');
    assert.equal(e.risk, 'medium');
    assert.equal(e.metadata.taskState, 'TASK_STATE_COMPLETED');
  });

  test('SendMessage is a delegation and the 0.3 spelling is dated as 0.3', () => {
    assert.equal(a2aEvidence({ operation: 'SendMessage' }).kind, 'delegation');
    assert.equal(a2aEvidence({ operation: 'SendMessage' }).protocolVersion, A2A_SPEC_VERSION);
    assert.equal(a2aEvidence({ operation: 'message/send' }).kind, 'delegation');
    assert.equal(a2aEvidence({ operation: 'message/send' }).protocolVersion, A2A_LEGACY_SPEC_VERSION);
  });

  test('task methods are tasks and card reads are discovery', () => {
    assert.equal(a2aEvidence({ operation: 'GetTask' }).kind, 'task');
    assert.equal(a2aEvidence({ operation: 'CancelTask' }).kind, 'task');
    assert.equal(a2aEvidence({ operation: 'GetExtendedAgentCard' }).kind, 'discovery');
    assert.equal(a2aEvidence({ operation: 'discover' }).kind, 'discovery');
  });

  test('an interrupted task is pending, not a success', () => {
    assert.equal(a2aOutcome('TASK_STATE_INPUT_REQUIRED'), 'pending');
    assert.equal(a2aOutcome('TASK_STATE_AUTH_REQUIRED'), 'pending');
    assert.equal(a2aOutcome('TASK_STATE_WORKING'), 'pending');
    assert.equal(a2aOutcome('TASK_STATE_SUBMITTED'), 'pending');
    assert.equal(a2aOutcome('TASK_STATE_COMPLETED'), 'ok');
    assert.equal(a2aOutcome('TASK_STATE_FAILED'), 'error');
    assert.equal(a2aOutcome('TASK_STATE_REJECTED'), 'denied');
    assert.equal(a2aOutcome('TASK_STATE_CANCELED'), 'blocked');
  });

  test('does not store message parts or push-notification credentials', () => {
    const secret = 'ada@example.com';
    const e = a2aEvidence({
      operation: 'SendMessage',
      agent: 'a',
      peerAgent: 'b',
      parts: [{ text: secret }],
      message: { parts: [{ text: secret }] },
      artifacts: [{ parts: [{ text: secret }] }],
      authentication: { credentials: 'Bearer abc123' },
      signature: 'eyJhbGciOiJFUzI1NiJ9',
    } as never);
    const serialised = JSON.stringify(e);
    assert.ok(!serialised.includes(secret));
    assert.ok(!serialised.includes('Bearer'));
    assert.ok(!serialised.includes('eyJhbGciOiJFUzI1NiJ9'));
  });

  test('artefacts are counted, not carried', () => {
    const e = a2aEvidence({ operation: 'GetTask', taskId: 't1', artifactCount: 3 });
    assert.equal(e.metadata.artifactCount, 3);
  });

  test('every v1.0 method and task state produces parseable evidence', () => {
    for (const operation of A2A_METHODS) {
      for (const taskState of A2A_TASK_STATES) {
        const e = a2aEvidence({ operation, taskState, id: `pe_${operation}_${taskState}` });
        assert.ok(EvidenceInput.safeParse(e).success, `${operation}/${taskState} did not parse`);
      }
    }
  });

  test('the Agent Card path is the IANA-registered one', () => {
    assert.equal(A2A_AGENT_CARD_PATH, '/.well-known/agent-card.json');
  });
});
