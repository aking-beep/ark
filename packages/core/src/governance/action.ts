import { z } from 'zod';
import { sha256Hex as sha256 } from './sha256.js';

/**
 * Action decision kernel (ADR-0009).
 *
 * Answers one question: may this agent perform this one consequential action,
 * for this org, now? It is a pure function of a trusted `ActionRequest` and a
 * list of `ActionPolicy` values. No I/O, no clock reads (`request.now` is the
 * time), no randomness, no model calls. A protected action is authorized only
 * by an explicit `allow`; every other path is `deny`, `require_approval` or
 * `unknown`, and there is no fallback `allow`.
 *
 * This is not `policy.ts` (manifest posture) and not `enforce.ts` (model-call
 * gate in `@ark/runtime`). A manifest `pass` is not authorization to act.
 */

const Id = z.string().min(1).max(128);
/** ISO-4217 shape: three upper-case letters. Not checked against the full list. */
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
const MinorUnits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ActionResource = z.object({
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(256),
});
export type ActionResource = z.infer<typeof ActionResource>;

export const ActionAttributes = z.object({
  /** Amount in the currency's minor unit (cents for USD). Integer, >= 0. */
  amountMinor: MinorUnits,
  /** ISO-4217 code, e.g. `USD`. */
  currency: CurrencyCode,
});
export type ActionAttributes = z.infer<typeof ActionAttributes>;

/**
 * One protected action, built only from trusted server context. `orgId` and
 * `agentId` must already be verified by the caller. There is deliberately no
 * `role` or `permissions` field: anything not listed here is dropped before
 * the decision and before the digest, so a forged field changes nothing.
 */
export const ActionRequest = z.object({
  orgId: Id,
  agentId: Id,
  /** Authenticated delegating user id, when the agent acts for a person. */
  principal: Id.optional(),
  tool: Id,
  action: Id,
  resource: ActionResource,
  attributes: ActionAttributes,
  /** Request time in ms since the epoch, supplied by the caller. */
  now: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type ActionRequest = z.infer<typeof ActionRequest>;

export const ActionEffect = z.enum(['allow', 'deny', 'require_approval']);
export type ActionEffect = z.infer<typeof ActionEffect>;

/** Typed comparison on the amount, in minor units. All bounds present must hold. */
export const AmountComparison = z
  .object({ gt: MinorUnits, gte: MinorUnits, lt: MinorUnits, lte: MinorUnits })
  .partial()
  .strict();
export type AmountComparison = z.infer<typeof AmountComparison>;

/** A rule matches when every condition it states holds. Amount and currency only. */
export const ActionRule = z.object({
  when: z.object({ amountMinor: AmountComparison.optional(), currency: CurrencyCode.optional() }).strict(),
  effect: ActionEffect,
});
export type ActionRule = z.infer<typeof ActionRule>;

export const ActionPolicy = z
  .object({
    id: Id,
    version: z.number().int().positive(),
    orgId: Id,
    tool: Id,
    action: Id,
    /** The currency this policy governs. A request in any other currency is denied. */
    currency: CurrencyCode,
    /** Ordered; the first matching rule decides. */
    rules: z.array(ActionRule).min(1).max(64),
    /** Applies when no rule matches. Only `deny` is accepted. */
    defaultEffect: z.literal('deny'),
    /** Lifetime of an `allow` or `require_approval` decision, ms. At most 24h. */
    decisionTtlMs: z.number().int().positive().max(86_400_000),
  })
  .strict();
export type ActionPolicy = z.infer<typeof ActionPolicy>;

export const ActionDecisionValue = z.enum(['allow', 'deny', 'require_approval', 'unknown']);
export type ActionDecisionValue = z.infer<typeof ActionDecisionValue>;

export const ActionReasonCode = z.enum([
  'rule_matched',
  'default_deny',
  'no_matching_policy',
  'policy_invalid',
  'policy_conflict',
  'policy_version_mismatch',
  'invalid_request',
  'invalid_amount',
  'invalid_currency',
  'currency_mismatch',
  'resource_missing',
]);
export type ActionReasonCode = z.infer<typeof ActionReasonCode>;

export interface ActionDecision {
  decision: ActionDecisionValue;
  /** sha256 over policy id, policy version and request digest. */
  decisionId: string;
  policyId: string | null;
  policyVersion: number | null;
  reasonCode: ActionReasonCode;
  /** sha256 of the canonical JSON of the normalized request. */
  requestDigest: string;
  /** Set for `allow` and `require_approval` only: `request.now + decisionTtlMs`. */
  expiresAt?: number;
}

export interface DecideActionOptions {
  /** When supplied, every governing policy must be at exactly this version. */
  expectedPolicyVersion?: number;
}

/**
 * SYNTHETIC demo policy for the refund walkthrough. These thresholds are
 * illustrative and are NOT production defaults; no org gets this policy
 * unless it passes it in explicitly.
 *
 * - amount <= $100.00            -> allow
 * - $100.00 < amount <= $1,000   -> require_approval
 * - amount > $1,000.00           -> deny
 */
export const DEMO_REFUND_POLICY: ActionPolicy = deepFreeze(
  ActionPolicy.parse({
    id: 'pol_demo_refund_synthetic',
    version: 1,
    orgId: 'org_demo',
    tool: 'payments',
    action: 'refund',
    currency: 'USD',
    rules: [
      { when: { amountMinor: { lte: 10_000 } }, effect: 'allow' },
      { when: { amountMinor: { gt: 10_000, lte: 100_000 } }, effect: 'require_approval' },
      { when: { amountMinor: { gt: 100_000 } }, effect: 'deny' },
    ],
    defaultEffect: 'deny',
    decisionTtlMs: 300_000,
  }),
);

// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Canonical JSON: object keys sorted, no whitespace, `undefined` keys omitted. */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`).join(',')}}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function pickNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * Keep only the fields `ActionRequest` defines, and only when they have the
 * right primitive type. Everything else — `role`, `permissions`, extra
 * attributes — is dropped here, so it cannot reach the digest or the decision.
 */
function normalize(raw: unknown): { [key: string]: Json } {
  const r = isRecord(raw) ? raw : {};
  const res = isRecord(r.resource) ? r.resource : undefined;
  const attrs = isRecord(r.attributes) ? r.attributes : {};
  const out: Record<string, Json | undefined> = {
    orgId: pickString(r.orgId),
    agentId: pickString(r.agentId),
    principal: pickString(r.principal),
    tool: pickString(r.tool),
    action: pickString(r.action),
    resource: res ? { type: pickString(res.type) ?? null, id: pickString(res.id) ?? null } : undefined,
    attributes: {
      amountMinor: pickNumber(attrs.amountMinor) ?? null,
      currency: pickString(attrs.currency) ?? null,
    },
    now: pickNumber(r.now),
  };
  return out as { [key: string]: Json };
}

function amountMatches(cmp: AmountComparison, amount: number): boolean {
  if (cmp.gt !== undefined && !(amount > cmp.gt)) return false;
  if (cmp.gte !== undefined && !(amount >= cmp.gte)) return false;
  if (cmp.lt !== undefined && !(amount < cmp.lt)) return false;
  if (cmp.lte !== undefined && !(amount <= cmp.lte)) return false;
  return true;
}

/** Does a policy-shaped value claim to govern this org/tool/action? */
function claims(p: Record<string, unknown>, req: { orgId: string; tool: string; action: string }): boolean {
  return p.orgId === req.orgId && p.tool === req.tool && p.action === req.action;
}

function evaluatePolicy(
  policy: ActionPolicy,
  attrs: ActionAttributes,
): { effect: ActionEffect; reasonCode: ActionReasonCode } {
  if (attrs.currency !== policy.currency) return { effect: 'deny', reasonCode: 'currency_mismatch' };
  for (const rule of policy.rules) {
    if (rule.when.currency !== undefined && rule.when.currency !== attrs.currency) continue;
    if (rule.when.amountMinor && !amountMatches(rule.when.amountMinor, attrs.amountMinor)) continue;
    return { effect: rule.effect, reasonCode: 'rule_matched' };
  }
  return { effect: policy.defaultEffect, reasonCode: 'default_deny' };
}

/**
 * Decide one protected action. Pure and synchronous.
 *
 * Fail-closed order:
 * 1. malformed identity/time -> `deny` `invalid_request`;
 *    missing resource -> `deny` `resource_missing`;
 *    amount negative / non-integer / non-finite -> `deny` `invalid_amount`;
 *    currency missing or not ISO-4217 shaped -> `deny` `invalid_currency`.
 * 2. policies not an array, or an invalid policy that claims (or cannot be
 *    shown not to claim) this org/tool/action -> `unknown` `policy_invalid`.
 * 3. no valid policy for this org + tool + action -> `unknown`
 *    `no_matching_policy`. A policy for another org is never matched.
 * 4. `expectedPolicyVersion` supplied and any governing policy differs ->
 *    `unknown` `policy_version_mismatch`.
 * 5. each governing policy yields an effect (currency mismatch -> `deny`);
 *    governing policies that disagree -> `deny` `policy_conflict`.
 */
export function decideAction(
  request: ActionRequest | unknown,
  policies: readonly (ActionPolicy | unknown)[] | unknown,
  options: DecideActionOptions = {},
): ActionDecision {
  const normalized = normalize(request);
  const requestDigest = sha256(canonicalJson(normalized));

  const result = (
    decision: ActionDecisionValue,
    reasonCode: ActionReasonCode,
    policy: ActionPolicy | null = null,
    expiresAt?: number,
  ): ActionDecision => {
    const policyId = policy?.id ?? null;
    const policyVersion = policy?.version ?? null;
    const decisionId = sha256(canonicalJson({ policyId, policyVersion, requestDigest }));
    const out: ActionDecision = { decision, decisionId, policyId, policyVersion, reasonCode, requestDigest };
    if (expiresAt !== undefined) out.expiresAt = expiresAt;
    return out;
  };

  // 1. Validate the request, most specific reasons first.
  const n = normalized as Record<string, unknown>;
  const identity = ActionRequest.pick({ orgId: true, agentId: true, principal: true, tool: true, action: true, now: true });
  const id = identity.safeParse({
    orgId: n.orgId,
    agentId: n.agentId,
    principal: n.principal,
    tool: n.tool,
    action: n.action,
    now: n.now,
  });
  if (!id.success) return result('deny', 'invalid_request');
  const resource = ActionResource.safeParse(n.resource);
  if (!resource.success) return result('deny', 'resource_missing');
  const rawAttrs = n.attributes as { amountMinor: unknown; currency: unknown };
  const amount = MinorUnits.safeParse(rawAttrs.amountMinor);
  if (!amount.success) return result('deny', 'invalid_amount');
  const currency = CurrencyCode.safeParse(rawAttrs.currency);
  if (!currency.success) return result('deny', 'invalid_currency');
  const req = id.data;
  const attrs: ActionAttributes = { amountMinor: amount.data, currency: currency.data };

  // 2-3. Find the governing policies. Wrong-org policies never match.
  if (!Array.isArray(policies)) return result('unknown', 'policy_invalid');
  const governing: ActionPolicy[] = [];
  for (const raw of policies as unknown[]) {
    const parsed = ActionPolicy.safeParse(raw);
    if (parsed.success) {
      if (claims(parsed.data, req)) governing.push(parsed.data);
      continue;
    }
    // An invalid policy is ignored only when it plainly governs something else.
    const plainlyElsewhere =
      isRecord(raw) &&
      typeof raw.orgId === 'string' &&
      typeof raw.tool === 'string' &&
      typeof raw.action === 'string' &&
      !claims(raw, req);
    if (!plainlyElsewhere) return result('unknown', 'policy_invalid');
  }
  if (governing.length === 0) return result('unknown', 'no_matching_policy');
  governing.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version));

  // 4. Version pin.
  const expected = options.expectedPolicyVersion;
  if (expected !== undefined && governing.some((p) => p.version !== expected)) {
    return result('unknown', 'policy_version_mismatch', governing[0] ?? null);
  }

  // 5. Evaluate; disagreement denies.
  const outcomes = governing.map((p) => ({ policy: p, ...evaluatePolicy(p, attrs) }));
  const first = outcomes[0]!;
  if (outcomes.some((o) => o.effect !== first.effect)) {
    return result('deny', 'policy_conflict', first.policy);
  }
  if (first.effect === 'deny') return result('deny', first.reasonCode, first.policy);
  // allow / require_approval: the shortest TTL among agreeing policies bounds expiry.
  const ttl = Math.min(...outcomes.map((o) => o.policy.decisionTtlMs));
  return result(first.effect, first.reasonCode, first.policy, req.now + ttl);
}
