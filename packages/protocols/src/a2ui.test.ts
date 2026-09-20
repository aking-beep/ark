import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput } from '@ark/core';
import {
  a2uiEvidence,
  A2UI_SERVER_OPERATIONS,
  A2UI_CANDIDATE_SERVER_OPERATIONS,
  A2UI_BASIC_CATALOG_COMPONENTS,
  A2UI_SPEC_VERSION,
  A2UI_CANDIDATE_SPEC_VERSION,
} from './a2ui.js';

describe('a2uiEvidence', () => {
  test('records the component vocabulary and the count, not the tree', () => {
    const e = a2uiEvidence({
      operation: 'updateComponents',
      agent: 'refund-agent',
      surfaceId: 'srf_refund_829',
      catalogId: 'basic',
      components: ['Card', 'Text', 'Button', 'Card'],
      policy: 'rendered',
    });
    assert.equal(e.protocol, 'a2ui');
    assert.equal(e.protocolVersion, A2UI_SPEC_VERSION);
    assert.equal(e.kind, 'ui');
    assert.equal(e.operation, 'updateComponents');
    assert.equal(e.target, 'srf_refund_829');
    assert.equal(e.metadata.componentTypes, 'Button,Card,Text');
    assert.equal(e.metadata.componentCount, 4);
    assert.equal(e.outcome, 'ok');
  });

  test('does not store the application data model', () => {
    const secret = 'person@example.com';
    const e = a2uiEvidence({
      operation: 'updateDataModel',
      surfaceId: 'srf_1',
      // Every one of these is a real A2UI payload location.
      contents: { customer: { email: secret } },
      dataModel: { email: secret },
      value: secret,
      path: '/customer/email',
      a2uiClientDataModel: { email: secret },
    } as never);
    const serialised = JSON.stringify(e);
    assert.ok(!serialised.includes(secret));
    assert.ok(!serialised.includes('/customer/email'));
  });

  test('a blocked render is blocked, and a denied one is denied', () => {
    assert.equal(a2uiEvidence({ operation: 'createSurface', policy: 'blocked' }).outcome, 'blocked');
    assert.equal(a2uiEvidence({ operation: 'createSurface', policy: 'denied' }).outcome, 'denied');
    assert.equal(a2uiEvidence({ operation: 'createSurface', policy: 'pending' }).outcome, 'pending');
  });

  test('interactive components raise the risk, decorative ones do not', () => {
    assert.equal(a2uiEvidence({ operation: 'updateComponents', components: ['Text', 'Image'] }).risk, 'low');
    assert.equal(a2uiEvidence({ operation: 'updateComponents', components: ['Text', 'TextField'] }).risk, 'medium');
  });

  test('a 1.0-candidate operation is dated as 1.0, not as 0.9.1', () => {
    assert.equal(a2uiEvidence({ operation: 'callFunction' }).protocolVersion, A2UI_CANDIDATE_SPEC_VERSION);
    assert.equal(a2uiEvidence({ operation: 'createSurface' }).protocolVersion, A2UI_SPEC_VERSION);
  });

  test('an operation outside either version is flagged, not dropped', () => {
    const e = a2uiEvidence({ operation: 'teleportSurface' });
    assert.equal(e.operation, 'teleportSurface');
    assert.equal(e.metadata.operationKnown, false);
  });

  test('every server operation in both versions produces parseable evidence', () => {
    for (const operation of [...A2UI_SERVER_OPERATIONS, ...A2UI_CANDIDATE_SERVER_OPERATIONS]) {
      const e = a2uiEvidence({ operation, id: `pe_${operation}`, components: [...A2UI_BASIC_CATALOG_COMPONENTS] });
      assert.ok(EvidenceInput.safeParse(e).success, `${operation} did not parse`);
    }
  });

  test('the full basic catalog fits inside the metadata value cap', () => {
    const e = a2uiEvidence({ operation: 'createSurface', components: [...A2UI_BASIC_CATALOG_COMPONENTS] });
    assert.ok(EvidenceInput.safeParse({ ...e, id: 'pe_cap' }).success);
  });
});
