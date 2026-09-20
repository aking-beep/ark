import type { EvidenceOutcome, EvidenceRisk } from '@ark/core';
import { compose, money, type NormalisedEvidence, type ObservationBase } from './types.js';

/**
 * UCP — Universal Commerce Protocol.
 *
 * Built against specification version **2026-08-25** (ucp.dev/2026-08-25/),
 * governed by a council whose permanent members are Google, Shopify and
 * Stripe. Note that UCP is not ACP: the Agentic Commerce Protocol is a
 * separate, competing specification from OpenAI and Stripe, also on
 * date-based versions. A bare date string is ambiguous between them, which is
 * why the protocol column says `ucp` and not a date.
 *
 * UCP also carries per-capability versions that can lag the profile version,
 * so `protocolVersion` here is the profile revision this adapter normalises
 * against and a caller observing an older capability should pass its own.
 *
 * ARK observes commerce. It does not do commerce. There is no field here for
 * `buyer` (four PII fields), for `line_items`, for `payment.instruments`, or
 * for a `credential` — and the last of those is `additionalProperties: true`
 * in UCP's own schema, so it could not be filtered by field name even if
 * there were somewhere to put it.
 */

export const UCP_SPEC_VERSION = '2026-08-25';

/** Where a business publishes its UCP profile. */
export const UCP_DISCOVERY_PATH = '/.well-known/ucp';

/** The shopping service's MCP method names, which ARK treats as canonical. */
export const UCP_OPERATIONS = [
  'create_checkout',
  'get_checkout',
  'update_checkout',
  'complete_checkout',
  'cancel_checkout',
  'create_cart',
  'get_cart',
  'update_cart',
  'cancel_cart',
  'search_catalog',
  'lookup_catalog',
  'get_order',
  'get_product',
] as const;
export type UcpOperation = (typeof UCP_OPERATIONS)[number];

/**
 * The same operations reached over the REST binding and over the shorthand
 * operators tend to write. UCP defines four transport bindings for one set of
 * operations; normalising them to one name is the difference between a
 * dashboard that can count checkouts and one that cannot.
 */
const ALIASES: Record<string, UcpOperation> = {
  'POST /checkout-sessions': 'create_checkout',
  'GET /checkout-sessions/{id}': 'get_checkout',
  'PUT /checkout-sessions/{id}': 'update_checkout',
  'POST /checkout-sessions/{id}/complete': 'complete_checkout',
  'POST /checkout-sessions/{id}/cancel': 'cancel_checkout',
  'POST /carts': 'create_cart',
  'GET /carts/{id}': 'get_cart',
  'PUT /carts/{id}': 'update_cart',
  'POST /carts/{id}/cancel': 'cancel_cart',
  'POST /catalog/search': 'search_catalog',
  'POST /catalog/lookup': 'lookup_catalog',
  'POST /catalog/product': 'get_product',
  'GET /orders/{id}': 'get_order',
  'checkout:create': 'create_checkout',
  'checkout:get': 'get_checkout',
  'checkout:update': 'update_checkout',
  'checkout:complete': 'complete_checkout',
  'checkout:cancel': 'cancel_checkout',
  'cart:create': 'create_cart',
  'cart:get': 'get_cart',
  'cart:update': 'update_cart',
  'cart:cancel': 'cancel_cart',
  'catalog:search': 'search_catalog',
  'catalog:lookup': 'lookup_catalog',
  'order:get': 'get_order',
  'product:get': 'get_product',
};

const CANONICAL = new Set<string>(UCP_OPERATIONS);

export function ucpOperation(operation: string): { operation: string; known: boolean } {
  const raw = operation.trim();
  if (CANONICAL.has(raw)) return { operation: raw, known: true };
  const alias = ALIASES[raw] ?? ALIASES[raw.replace(/\s+/g, ' ')];
  return alias ? { operation: alias, known: true } : { operation: raw, known: false };
}

/** UCP's four transport bindings. */
export const UCP_TRANSPORTS = ['rest', 'mcp', 'a2a', 'embedded'] as const;

export interface UcpObservation extends ObservationBase {
  /** A canonical method name, a REST template, or a `resource:verb` shorthand. */
  operation: UcpOperation | string;
  /** The shopping agent or platform acting. */
  agent?: string;
  /** The merchant, by domain or id. */
  merchant?: string;
  /** Checkout, cart or order id — a reference, never the object. */
  reference?: string;
  /** Capability URI from the merchant's profile, e.g. `.../shopping/checkout.json`. */
  capability?: string;
  transport?: (typeof UCP_TRANSPORTS)[number];
  /** Transaction amount in `currency`. Not converted. See `money`. */
  amount?: number;
  currency?: string;
  /** Checkout status as reported, e.g. `completed`, `canceled`. */
  status?: string;
  errorKind?: string;
}

/** Only the two operations that move an order forward are treated as high risk. */
const HIGH_RISK = new Set<string>(['complete_checkout', 'create_checkout']);

export function ucpEvidence(o: UcpObservation): NormalisedEvidence {
  const { operation, known } = ucpOperation(String(o.operation));
  const m = money(o.amount, o.currency);

  let outcome: EvidenceOutcome = 'ok';
  if (o.errorKind) outcome = 'error';
  else if (o.status === 'canceled' || o.status === 'cancelled') outcome = 'blocked';
  else if (o.status === 'pending' || o.status === 'in_progress') outcome = 'pending';

  const risk: EvidenceRisk = operation === 'complete_checkout' ? 'high' : HIGH_RISK.has(operation) ? 'medium' : 'low';

  return compose(o, {
    protocol: 'ucp',
    protocolVersion: UCP_SPEC_VERSION,
    kind: 'commerce',
    operation,
    actor: o.agent,
    target: o.merchant,
    outcome,
    risk,
    evidenceRef: o.reference,
    valueUsd: m.valueUsd,
    currency: m.currency,
    metadata: {
      capability: o.capability,
      transport: o.transport,
      status: o.status,
      // Kept beside `currency` so a non-USD checkout is still a number
      // somebody can read, without it being silently summed as dollars.
      amount: m.amount,
      errorKind: o.errorKind,
      operationKnown: known,
    },
  });
}
