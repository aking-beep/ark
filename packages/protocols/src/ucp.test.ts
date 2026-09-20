import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput } from '@ark/core';
import { ucpEvidence, ucpOperation, UCP_OPERATIONS, UCP_SPEC_VERSION, UCP_DISCOVERY_PATH } from './ucp.js';

describe('ucpEvidence', () => {
  test('a completed checkout normalises amount, merchant and reference', () => {
    const e = ucpEvidence({
      operation: 'complete_checkout',
      agent: 'shopping-agent',
      merchant: 'merchant.example',
      reference: 'co_8812',
      amount: 175,
      currency: 'USD',
      status: 'completed',
      transport: 'mcp',
    });
    assert.equal(e.protocol, 'ucp');
    assert.equal(e.protocolVersion, UCP_SPEC_VERSION);
    assert.equal(e.kind, 'commerce');
    assert.equal(e.operation, 'complete_checkout');
    assert.equal(e.actor, 'shopping-agent');
    assert.equal(e.target, 'merchant.example');
    assert.equal(e.valueUsd, 175);
    assert.equal(e.currency, 'USD');
    assert.equal(e.evidenceRef, 'co_8812');
    assert.equal(e.outcome, 'ok');
    assert.equal(e.risk, 'high');
  });

  test('a non-USD amount is recorded without being converted into dollars', () => {
    const e = ucpEvidence({ operation: 'complete_checkout', amount: 150, currency: 'eur' });
    assert.equal(e.valueUsd, undefined);
    assert.equal(e.currency, 'EUR');
    assert.equal(e.metadata.amount, 150);
  });

  test('the REST binding and the shorthand both resolve to one canonical operation', () => {
    assert.equal(ucpOperation('POST /checkout-sessions/{id}/complete').operation, 'complete_checkout');
    assert.equal(ucpOperation('checkout:complete').operation, 'complete_checkout');
    assert.equal(ucpOperation('complete_checkout').operation, 'complete_checkout');
    assert.equal(ucpEvidence({ operation: 'checkout:complete' }).operation, 'complete_checkout');
  });

  test('an operation from neither binding is flagged, not dropped', () => {
    const r = ucpOperation('teleport_checkout');
    assert.equal(r.known, false);
    assert.equal(ucpEvidence({ operation: 'teleport_checkout' }).metadata.operationKnown, false);
  });

  test('does not store the buyer, the line items or a payment credential', () => {
    const secret = 'buyer@example.com';
    const e = ucpEvidence({
      operation: 'complete_checkout',
      amount: 10,
      currency: 'USD',
      buyer: { first_name: 'Ada', email: secret, phone_number: '555-867-5309' },
      line_items: [{ name: 'Widget', sku: 'W-1' }],
      payment: { instruments: [{ credential: { type: 'card', number: '4111111111111111' } }] },
      signals: { risk_score: 0.3 },
    } as never);
    const serialised = JSON.stringify(e);
    assert.ok(!serialised.includes(secret));
    assert.ok(!serialised.includes('4111111111111111'));
    assert.ok(!serialised.includes('555-867-5309'));
    assert.ok(!serialised.includes('W-1'));
  });

  test('a cancelled checkout is blocked, and an error is an error', () => {
    assert.equal(ucpEvidence({ operation: 'cancel_checkout', status: 'canceled' }).outcome, 'blocked');
    assert.equal(ucpEvidence({ operation: 'create_checkout', errorKind: 'out_of_stock' }).outcome, 'error');
  });

  test('every canonical operation produces parseable evidence', () => {
    for (const operation of UCP_OPERATIONS) {
      const e = ucpEvidence({ operation, id: `pe_${operation}`, amount: 1, currency: 'USD' });
      assert.ok(EvidenceInput.safeParse(e).success, `${operation} did not parse`);
    }
  });

  test('the discovery path is the well-known one', () => {
    assert.equal(UCP_DISCOVERY_PATH, '/.well-known/ucp');
  });
});
