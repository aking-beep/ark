import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceInput } from '@ark/core';
import {
  ap2Evidence,
  ap2Presence,
  AP2_OPERATIONS,
  AP2_MANDATE_TYPES,
  AP2_SPEC_VERSION,
} from './ap2.js';

describe('ap2Evidence', () => {
  test('an approved payment mandate normalises to a reference, a value and an approver', () => {
    const e = ap2Evidence({
      operation: 'payment_mandate',
      mandateType: 'mandate.payment.1',
      mandateRef: 'mandate_829',
      agent: 'procurement-agent',
      merchant: 'AWS',
      amount: 475,
      currency: 'USD',
      presence: 'direct',
      approvedBy: 'user_12',
      status: 'Success',
    });
    assert.equal(e.protocol, 'ap2');
    assert.equal(e.protocolVersion, AP2_SPEC_VERSION);
    assert.equal(e.kind, 'payment');
    assert.equal(e.operation, 'payment_mandate');
    assert.equal(e.actor, 'procurement-agent');
    assert.equal(e.target, 'AWS');
    assert.equal(e.valueUsd, 475);
    assert.equal(e.evidenceRef, 'mandate_829');
    assert.equal(e.requiredApproval, true);
    assert.equal(e.approvedBy, 'user_12');
    assert.equal(e.risk, 'high');
    assert.equal(e.metadata.presence, 'human_present');
    assert.equal(e.metadata.mandateType, 'mandate.payment.1');
  });

  test('a mandate with no approver keeps the missing state representable', () => {
    const e = ap2Evidence({ operation: 'payment_mandate', mandateRef: 'mandate_830', amount: 890, currency: 'USD' });
    assert.equal(e.requiredApproval, true);
    assert.equal(e.approvedBy, undefined);
    assert.equal(e.outcome, 'ok');
  });

  test('never stores the credential, the signature or the disclosures', () => {
    const jwt = 'eyJhbGciOiJFUzI1NiIsInR5cCI6ImtiK3NkLWp3dCJ9.payload.sig~disclosure1~disclosure2';
    const e = ap2Evidence({
      operation: 'payment_mandate',
      mandateRef: 'mandate_829',
      checkout_jwt: jwt,
      disclosures: ['WyJzYWx0IiwiZW1haWwiLCJhZGFAZXhhbXBsZS5jb20iXQ'],
      cnf: { jwk: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' } },
      payment_instrument: { id: 'pi_1', description: 'Card ••••4242' },
      signature: 'MEUCIQ',
      risk_data: { device: 'iphone' },
    } as never);
    const serialised = JSON.stringify(e);
    assert.ok(!serialised.includes('eyJhbGci'));
    assert.ok(!serialised.includes('disclosure'));
    assert.ok(!serialised.includes('4242'));
    assert.ok(!serialised.includes('MEUCIQ'));
    assert.ok(!serialised.includes('P-256'));
  });

  test('receipts are receipts, carry no approval obligation, and are low risk', () => {
    const e = ap2Evidence({ operation: 'payment_receipt', receiptRef: 'rcpt_11', status: 'Success' });
    assert.equal(e.kind, 'receipt');
    assert.equal(e.requiredApproval, false);
    assert.equal(e.risk, 'low');
    assert.equal(e.evidenceRef, 'rcpt_11');
  });

  test('an error receipt is an error', () => {
    assert.equal(ap2Evidence({ operation: 'payment_receipt', status: 'Error' }).outcome, 'error');
  });

  test('presence accepts the spec aliases and stores one spelling', () => {
    assert.equal(ap2Presence('direct'), 'human_present');
    assert.equal(ap2Presence('Human Present'), 'human_present');
    assert.equal(ap2Presence('autonomous'), 'human_not_present');
    assert.equal(ap2Presence('Human Not Present'), 'human_not_present');
    assert.equal(ap2Presence('delegated'), undefined);
    assert.equal(ap2Presence(undefined), undefined);
  });

  test('every operation and mandate type produces parseable evidence', () => {
    for (const operation of AP2_OPERATIONS) {
      for (const mandateType of AP2_MANDATE_TYPES) {
        const e = ap2Evidence({ operation, mandateType, id: `pe_${operation}_${mandateType}` });
        assert.ok(EvidenceInput.safeParse(e).success, `${operation}/${mandateType} did not parse`);
      }
    }
  });
});
