import { z } from 'zod';
import { canonicalJson, type Json } from './canonical-json.js';
import { sha256Hex as sha256 } from './sha256.js';

/**
 * Action decision kernel (ADR-0009).
 *
 * Answers one question: may this agent perform this one consequential action,
 * for this org, now? It is a pure function of a trusted `ActionRequest` and a
 * list of `ActionPolicy` values. No I/O, no clock reads (`request.now` is the
 * time), no randomness, no model calls. A protected action is authorized only
 * by an explicit `allow`; every other path is `deny`, `require_approval` or
 * `unknown`, and there is no fallback `allow`. It never throws: any unexpected
 * failure is returned as `unknown` `invalid_request`.
 *
 * Inputs are snapshotted before anything is decided: only own data properties
 * of plain objects are read, each exactly once. Accessor (getter) properties and
 * non-plain objects are rejected; inherited (prototype) properties are never
 * read. The decision carries `normalizedRequest`, the exact values it was made
 * on — a guard must execute those values, not its own copy of the request.
 *
 * `decisionId` is a deterministic content hash (a content address) of the
 * decision, the request digest, the governing policies' content digests and
 * `expiresAt`. It is NOT an unforgeable token: anyone who knows the inputs can
 * compute it. An approval or execution credential, if one is ever needed, must be
 * a separate signed (HMAC or signature under a server key), single-use credential
 * bound to `expiresAt`.
 *
 * `request.now` is trusted from the caller. The guard that calls this kernel
 * owns the clock; `now` must never come from the agent.
 *
 * This is not `policy.ts` (manifest posture) and not `enforce.ts` (model-call
 * gate in `@ark/runtime`). A manifest `pass` is not authorization to act.
 */

const Id = z.string().min(1).max(128);
/** ISO-4217 shape: three upper-case letters. Not checked against the full list. */
const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
const MinorUnits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const EpochMs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ActionResource = z
  .object({
    type: z.string().min(1).max(64),
    id: z.string().min(1).max(256),
  })
  .strict();
export type ActionResource = z.infer<typeof ActionResource>;

export const ActionAttributes = z
  .object({
    /** Amount in the currency's minor unit (cents for USD). Integer, >= 0. */
    amountMinor: MinorUnits,
    /** ISO-4217 code, e.g. `USD`. */
    currency: CurrencyCode,
  })
  .strict();
export type ActionAttributes = z.infer<typeof ActionAttributes>;

/**
 * One protected action, built only from trusted server context. `orgId` and
 * `agentId` must already be verified by the caller. There is deliberately no
 * `role` or `permissions` field: anything not listed here is never read, so it
 * cannot reach the digest or the decision.
 */
export const ActionRequest = z
  .object({
    orgId: Id,
    agentId: Id,
    /** Authenticated delegating user id, when the agent acts for a person. */
    principal: Id.optional(),
    tool: Id,
    action: Id,
    resource: ActionResource,
    attributes: ActionAttributes,
    /** Request time in ms since the epoch, from the guard's clock. */
    now: EpochMs,
  })
  .strict();
export type ActionRequest = z.infer<typeof ActionRequest>;

export const ActionEffect = z.enum(['allow', 'deny', 'require_approval']);
export type ActionEffect = z.infer<typeof ActionEffect>;

/** Typed comparison on the amount, in minor units. All bounds present must hold. */
export const AmountComparison = z
  .object({ gt: MinorUnits, gte: MinorUnits, lt: MinorUnits, lte: MinorUnits })
  .partial()
  .strict();
export type AmountComparison = z.infer<typeof AmountComparison>;

/**
 * A rule matches when every condition it states holds. Amount and currency only.
 * Strict at every level: a key the schema does not know (a condition placed at
 * the wrong level, an `unless`) makes the whole policy invalid rather than being
 * stripped into a match-everything rule.
 */
export const ActionRule = z
  .object({
    when: z.object({ amountMinor: AmountComparison.optional(), currency: CurrencyCode.optional() }).strict(),
    effect: ActionEffect,
  })
  .strict();
export type ActionRule = z.infer<typeof ActionRule>;

export const ActionPolicy = z
  .object({
    id: Id,
    version: z.number().int().positive(),
    orgId: Id,
    tool: Id,
    action: Id,
    /**
     * The currency this policy governs. Policies are selected by org, tool,
     * action and currency; a request in a currency no policy governs is denied.
     */
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
  /**
   * Deterministic content hash: sha256 over decision, reason code, request
   * digest, reported policy id/version, every governing policy's content digest,
   * and `expiresAt`. A content address, not an authenticator (see module doc).
   */
  decisionId: string;
  policyId: string | null;
  policyVersion: number | null;
  /** sha256 of the canonical JSON of the reported policy's full content. */
  policyDigest: string | null;
  reasonCode: ActionReasonCode;
  /** sha256 of the canonical JSON of the normalized request. */
  requestDigest: string;
  /**
   * The exact request values the decision was made on, frozen. `null` when the
   * request itself was rejected. A guard executes these values.
   */
  normalizedRequest: Readonly<ActionRequest> | null;
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
// Snapshotting: own data properties of plain objects only, each read once.

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Thrown inside the kernel when an input cannot be read safely; caught by `decideAction`. */
class Unreadable extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Own data property, or `undefined` if absent. An accessor property is unreadable. */
function ownData(obj: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (d === undefined) return undefined;
  if (!('value' in d)) throw new Unreadable(key);
  return d.value;
}

/** Deep copy of plain JSON-shaped data (own data properties only); anything else is unreadable. */
function plainCopy(v: unknown, depth = 0): unknown {
  if (depth > 8) throw new Unreadable('too deep');
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) throw new Unreadable('array');
    const len = ownData(v, 'length') as number;
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) out.push(plainCopy(ownData(v, String(i)), depth + 1));
    return out;
  }
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = plainCopy(ownData(v, k), depth + 1);
    return out;
  }
  throw new Unreadable(typeof v);
}

interface RequestSnapshot {
  orgId: unknown;
  agentId: unknown;
  principal: unknown;
  tool: unknown;
  action: unknown;
  /** `undefined` when absent or not a plain object. */
  resource: { type: unknown; id: unknown } | undefined;
  /** Raw attribute values; `undefined` when absent. */
  amountMinor: unknown;
  currency: unknown;
  now: unknown;
}

/**
 * Read only the fields `ActionRequest` defines. Unknown fields (`role`,
 * `permissions`, extra attributes) are never touched. Returns `null` when the
 * request is not a plain object; throws `Unreadable` on an accessor property.
 */
function snapshotRequest(raw: unknown): RequestSnapshot | null {
  if (!isPlainObject(raw)) return null;
  const res = ownData(raw, 'resource');
  const attrs = ownData(raw, 'attributes');
  const a = isPlainObject(attrs) ? attrs : undefined;
  return {
    orgId: ownData(raw, 'orgId'),
    agentId: ownData(raw, 'agentId'),
    principal: ownData(raw, 'principal'),
    tool: ownData(raw, 'tool'),
    action: ownData(raw, 'action'),
    resource: isPlainObject(res) ? { type: ownData(res, 'type'), id: ownData(res, 'id') } : undefined,
    amountMinor: a ? ownData(a, 'amountMinor') : undefined,
    currency: a ? ownData(a, 'currency') : undefined,
    now: ownData(raw, 'now'),
  };
}

/** JSON-safe, type-tagged projection of one snapshot value, for the digest of any request. */
function digestValue(v: unknown): Json | undefined {
  if (v === undefined) return undefined;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : { $nonFinite: String(v) };
  return { $type: Array.isArray(v) ? 'array' : typeof v };
}

function digestSnapshot(s: RequestSnapshot | null): string {
  if (s === null) return sha256(canonicalJson({ $type: 'not-a-plain-object' }));
  return sha256(
    canonicalJson({
      orgId: digestValue(s.orgId),
      agentId: digestValue(s.agentId),
      principal: digestValue(s.principal),
      tool: digestValue(s.tool),
      action: digestValue(s.action),
      resource: s.resource ? { type: digestValue(s.resource.type), id: digestValue(s.resource.id) } : undefined,
      attributes: { amountMinor: digestValue(s.amountMinor) ?? null, currency: digestValue(s.currency) ?? null },
      now: digestValue(s.now),
    }),
  );
}

// ---------------------------------------------------------------------------
// Evaluation.

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
  for (const rule of policy.rules) {
    if (rule.when.currency !== undefined && rule.when.currency !== attrs.currency) continue;
    if (rule.when.amountMinor && !amountMatches(rule.when.amountMinor, attrs.amountMinor)) continue;
    return { effect: rule.effect, reasonCode: 'rule_matched' };
  }
  return { effect: policy.defaultEffect, reasonCode: 'default_deny' };
}

interface Governing {
  policy: ActionPolicy;
  digest: string;
}

function makeResult(
  requestDigest: string,
  normalizedRequest: Readonly<ActionRequest> | null,
  decision: ActionDecisionValue,
  reasonCode: ActionReasonCode,
  reported: Governing | null = null,
  governing: readonly Governing[] = [],
  expiresAt?: number,
): ActionDecision {
  const policyId = reported?.policy.id ?? null;
  const policyVersion = reported?.policy.version ?? null;
  const policyDigest = reported?.digest ?? null;
  // Every input that can change the outcome is in the preimage: two different
  // outcomes, policy contents or expiries never share an id.
  const decisionId = sha256(
    canonicalJson({
      decision,
      reasonCode,
      requestDigest,
      policyId,
      policyVersion,
      policyDigests: governing.map((g) => g.digest).sort(),
      expiresAt: expiresAt ?? null,
    }),
  );
  const out: ActionDecision = {
    decision,
    decisionId,
    policyId,
    policyVersion,
    policyDigest,
    reasonCode,
    requestDigest,
    normalizedRequest,
  };
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return out;
}

/**
 * Decide one protected action. Pure, synchronous, and never throws.
 *
 * Fail-closed order:
 * 0. options not an object, an unreadable input (accessor property, Proxy
 *    trap that throws), or any unexpected error -> `unknown` `invalid_request`.
 * 1. request not a plain object, malformed identity/time, or a `principal`
 *    that is present but not a valid id -> `deny` `invalid_request`;
 *    missing resource -> `deny` `resource_missing`;
 *    amount negative / non-integer / non-finite -> `deny` `invalid_amount`;
 *    currency missing or not ISO-4217 shaped -> `deny` `invalid_currency`.
 * 2. policies not an array, or an invalid policy that claims (or cannot be
 *    shown not to claim) this org/tool/action -> `unknown` `policy_invalid`.
 * 3. no valid policy for this org + tool + action -> `unknown`
 *    `no_matching_policy`. A policy for another org is never matched.
 * 4. two policies with the same id but different content (e.g. v1 and v2
 *    together) -> `unknown` `policy_conflict`. Identical duplicates collapse.
 * 5. no claiming policy governs the request's currency -> `deny`
 *    `currency_mismatch`. Otherwise only the policies for that currency govern.
 * 6. `expectedPolicyVersion` supplied and any governing policy differs ->
 *    `unknown` `policy_version_mismatch`.
 * 7. governing policies whose effects disagree -> `deny` `policy_conflict`.
 */
export function decideAction(
  request: ActionRequest | unknown,
  policies: readonly (ActionPolicy | unknown)[] | unknown,
  options?: DecideActionOptions | unknown,
): ActionDecision {
  let requestDigest = sha256(canonicalJson({ $type: 'unreadable' }));
  try {
    return decide(request, policies, options, (d) => {
      requestDigest = d;
    });
  } catch {
    return makeResult(requestDigest, null, 'unknown', 'invalid_request');
  }
}

function decide(
  request: unknown,
  policies: unknown,
  options: unknown,
  onDigest: (digest: string) => void,
): ActionDecision {
  // 1. Snapshot the request (an accessor property throws -> `unknown`).
  const s = snapshotRequest(request);
  const requestDigest = digestSnapshot(s);
  onDigest(requestDigest);

  // 0. Options: absent, or a plain object with an own data property.
  let expected: unknown;
  if (options !== undefined) {
    if (!isPlainObject(options)) throw new Unreadable('options');
    expected = ownData(options, 'expectedPolicyVersion');
  }

  // 1 (cont). Validate the request, most specific reasons first.
  const reject = (code: ActionReasonCode) => makeResult(requestDigest, null, 'deny', code);
  if (s === null) return reject('invalid_request');
  const identity = z
    .object({ orgId: Id, agentId: Id, principal: Id.optional(), tool: Id, action: Id, now: EpochMs })
    .strict()
    .safeParse({ orgId: s.orgId, agentId: s.agentId, principal: s.principal, tool: s.tool, action: s.action, now: s.now });
  if (!identity.success) return reject('invalid_request');
  const resource = ActionResource.safeParse(s.resource);
  if (!resource.success) return reject('resource_missing');
  const amount = MinorUnits.safeParse(s.amountMinor);
  if (!amount.success) return reject('invalid_amount');
  const currency = CurrencyCode.safeParse(s.currency);
  if (!currency.success) return reject('invalid_currency');
  const id = identity.data;
  const attrs: ActionAttributes = { amountMinor: amount.data === 0 ? 0 : amount.data, currency: currency.data };
  const normalized: ActionRequest = deepFreeze({
    orgId: id.orgId,
    agentId: id.agentId,
    ...(id.principal !== undefined ? { principal: id.principal } : {}),
    tool: id.tool,
    action: id.action,
    resource: { type: resource.data.type, id: resource.data.id },
    attributes: attrs,
    now: id.now === 0 ? 0 : id.now,
  });
  const result = (
    decision: ActionDecisionValue,
    code: ActionReasonCode,
    reported: Governing | null = null,
    governing: readonly Governing[] = [],
    expiresAt?: number,
  ) => makeResult(requestDigest, normalized, decision, code, reported, governing, expiresAt);

  // 2-3. Find the policies that claim this org/tool/action. Wrong-org policies never match.
  if (!Array.isArray(policies) || Object.getPrototypeOf(policies) !== Array.prototype) {
    return result('unknown', 'policy_invalid');
  }
  const claiming: Governing[] = [];
  const count = ownData(policies, 'length') as number;
  for (let i = 0; i < count; i++) {
    let raw: unknown;
    try {
      raw = plainCopy(ownData(policies, String(i)));
    } catch {
      return result('unknown', 'policy_invalid');
    }
    const parsed = ActionPolicy.safeParse(raw);
    if (parsed.success) {
      if (claims(parsed.data, id)) claiming.push({ policy: parsed.data, digest: sha256(canonicalJson(parsed.data as Json)) });
      continue;
    }
    // An invalid policy is ignored only when it plainly governs something else.
    const plainlyElsewhere =
      isPlainObject(raw) &&
      typeof raw.orgId === 'string' &&
      typeof raw.tool === 'string' &&
      typeof raw.action === 'string' &&
      !claims(raw, id);
    if (!plainlyElsewhere) return result('unknown', 'policy_invalid');
  }
  if (claiming.length === 0) return result('unknown', 'no_matching_policy');

  // 4. One id, one content. Identical duplicates collapse; anything else conflicts.
  const byId = new Map<string, Governing>();
  for (const g of claiming) {
    const seen = byId.get(g.policy.id);
    if (seen && seen.digest !== g.digest) return result('unknown', 'policy_conflict');
    byId.set(g.policy.id, g);
  }
  const unique = [...byId.values()].sort((a, b) => (a.policy.id < b.policy.id ? -1 : 1));

  // 5. Currency is part of the governing key.
  const governing = unique.filter((g) => g.policy.currency === attrs.currency);
  if (governing.length === 0) return result('deny', 'currency_mismatch', unique[0]!, unique);
  const first = governing[0]!;

  // 6. Version pin.
  if (expected !== undefined && governing.some((g) => g.policy.version !== expected)) {
    return result('unknown', 'policy_version_mismatch', first, governing);
  }

  // 7. Evaluate; disagreement denies.
  const outcomes = governing.map((g) => evaluatePolicy(g.policy, attrs));
  const effect = outcomes[0]!.effect;
  if (outcomes.some((o) => o.effect !== effect)) return result('deny', 'policy_conflict', first, governing);
  if (effect === 'deny') return result('deny', outcomes[0]!.reasonCode, first, governing);
  // allow / require_approval: the shortest TTL among agreeing policies bounds expiry.
  const ttl = Math.min(...governing.map((g) => g.policy.decisionTtlMs));
  return result(effect, outcomes[0]!.reasonCode, first, governing, id.now + ttl);
}
