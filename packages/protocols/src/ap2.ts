import type { EvidenceKind, EvidenceOutcome, EvidenceRisk } from '@ark/core';
import { compose, money, type NormalisedEvidence, type ObservationBase } from './types.js';

/**
 * AP2 — Agent Payments Protocol.
 *
 * Built against specification version **v0.2**
 * (github.com/google-agentic-commerce/ap2, ap2-protocol.org), created by
 * Google and donated to the FIDO Alliance in April 2026; the specification
 * document itself is headed "Agentic Payment Protocol (v0.2)". v0.2 replaced
 * the v0.1 Intent and Cart mandates with the Checkout Mandate and the Payment
 * Mandate, each in an open and a closed form.
 *
 * AP2 evidence is *authorisation* evidence: who authorised how much, for
 * whom, and whether a human was there. It is not the authorisation itself.
 *
 * Mandates are SD-JWT verifiable digital credentials, and the point of an
 * SD-JWT is that the compact serialisation with its `~`-separated disclosures
 * attached carries the full cleartext. Storing one would put every field a
 * buyer selectively disclosed into this database. So there is no field for
 * `checkout_jwt`, for `disclosures`, for `cnf`, for `payment_instrument`, or
 * for a signature of any kind. What ARK keeps is the mandate or receipt
 * *identifier* — a pointer into the system of record that already holds the
 * credential and is built to.
 */

export const AP2_SPEC_VERSION = '0.2';

/** The four `vct` credential-type claims defined by v0.2. */
export const AP2_MANDATE_TYPES = [
  'mandate.checkout.open.1',
  'mandate.checkout.1',
  'mandate.payment.open.1',
  'mandate.payment.1',
] as const;
export type Ap2MandateType = (typeof AP2_MANDATE_TYPES)[number];

/** The four concepts AP2 puts on the wire. */
export const AP2_OPERATIONS = [
  'checkout_mandate',
  'payment_mandate',
  'checkout_receipt',
  'payment_receipt',
] as const;
export type Ap2Operation = (typeof AP2_OPERATIONS)[number];

/**
 * Whether a person was at the keyboard. AP2 writes these as
 * "Human Present ('direct')" and "Human Not Present ('autonomous')"; these are
 * the snake-case forms ARK stores, with the spec's aliases accepted as input.
 */
export const AP2_PRESENCE = ['human_present', 'human_not_present'] as const;
export type Ap2Presence = (typeof AP2_PRESENCE)[number];

const PRESENCE_ALIASES: Record<string, Ap2Presence> = {
  direct: 'human_present',
  human_present: 'human_present',
  'human present': 'human_present',
  autonomous: 'human_not_present',
  human_not_present: 'human_not_present',
  'human not present': 'human_not_present',
};

const KNOWN_OPERATIONS = new Set<string>(AP2_OPERATIONS);
const MANDATES = new Set<string>(['checkout_mandate', 'payment_mandate']);

export interface Ap2Observation extends ObservationBase {
  operation: Ap2Operation | string;
  /** The `vct` claim, which carries the mandate's own schema version. */
  mandateType?: Ap2MandateType | string;
  /** Mandate identifier. A reference into the credential store, not the credential. */
  mandateRef?: string;
  /** Receipt identifier. */
  receiptRef?: string;
  /** The shopping or procurement agent. */
  agent?: string;
  /** The merchant or payee. */
  merchant?: string;
  amount?: number;
  currency?: string;
  presence?: Ap2Presence | 'direct' | 'autonomous' | string;
  /** Receipt status as AP2 spells it. */
  status?: 'Success' | 'Error' | string;
  errorKind?: string;
}

export function ap2Presence(v: string | undefined): Ap2Presence | undefined {
  if (!v) return undefined;
  return PRESENCE_ALIASES[v.trim().toLowerCase()];
}

export function ap2Kind(operation: string): EvidenceKind {
  return operation.endsWith('_receipt') ? 'receipt' : 'payment';
}

export function ap2Evidence(o: Ap2Observation): NormalisedEvidence {
  const operation = String(o.operation).trim();
  const kind = ap2Kind(operation);
  const presence = ap2Presence(o.presence);
  const m = money(o.amount, o.currency);

  let outcome: EvidenceOutcome = 'ok';
  if (o.errorKind || o.status === 'Error') outcome = 'error';
  else if (o.status === 'Pending' || o.status === 'pending') outcome = 'pending';

  const risk: EvidenceRisk =
    operation === 'payment_mandate' ? 'high' : operation === 'checkout_mandate' ? 'medium' : 'low';

  return compose(o, {
    protocol: 'ap2',
    protocolVersion: AP2_SPEC_VERSION,
    kind,
    operation,
    actor: o.agent,
    target: o.merchant,
    outcome,
    risk,
    // A mandate IS the authorisation step: one exists precisely because
    // something needed authorising. A receipt is a record of what already
    // happened and carries no approval obligation of its own. Callers whose
    // policy differs pass `requiredApproval` and this is ignored.
    requiredApproval: MANDATES.has(operation) ? true : undefined,
    evidenceRef: o.mandateRef ?? o.receiptRef,
    valueUsd: m.valueUsd,
    currency: m.currency,
    metadata: {
      // The `vct` string, whose numeric suffix is the mandate schema version.
      mandateType: o.mandateType,
      presence,
      status: o.status,
      amount: m.amount,
      errorKind: o.errorKind,
      operationKnown: KNOWN_OPERATIONS.has(operation),
    },
  });
}
