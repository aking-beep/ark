import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { canonicalJson } from './canonical-json.js';
import type { ActionDecision } from './action.js';

/**
 * Approval grants: the credential that lets a `require_approval` decision run.
 *
 * WHY THIS IS NOT THE DECISION ID
 *
 * ADR-0009 is explicit: a decision id is a deterministic content hash of the
 * request, the governing policies and the expiry. Anyone who knows those
 * inputs can compute it, so it addresses a decision but authenticates nothing.
 * Treating it as permission to move money would mean anyone able to guess a
 * refund's parameters could authorise that refund.
 *
 * A grant is therefore a separate credential:
 *
 *   - **Signed.** HMAC-SHA256 over the canonical grant body under a secret
 *     only the approval service holds. Unforgeable without that secret.
 *   - **Single-use.** Enforced by the store's `redeem`, not by this module.
 *     Crypto cannot make a token one-shot; only an atomic store can.
 *   - **Bound.** To one org, one decision id and one nonce, so a grant minted
 *     for a $40 refund cannot be replayed against a $4,000 one.
 *   - **Expiring.** Never outlives the decision that prompted it.
 *
 * Why `@noble/hashes` and not `node:crypto`: `@ark/core` is imported by
 * browser client components and Next's client bundler rejects `node:` imports.
 * Same reasoning as `sha256Hex`.
 *
 * Nothing here stores a prompt or a payload. A grant carries identifiers,
 * times and a signature.
 */

/** Minimum secret length. Shorter than this is rejected rather than weakly accepted. */
export const MIN_APPROVAL_SECRET_BYTES = 32;

/** How long a grant may live, regardless of the decision's own expiry. */
export const MAX_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApprovalGrantBody {
  orgId: string;
  /** The decision this grant authorises, and only this one. */
  decisionId: string;
  /** Unique per grant. Two grants for one decision are distinguishable. */
  nonce: string;
  /** Who approved it. Recorded, never trusted as authorisation by itself. */
  approvedBy: string;
  issuedAt: number;
  /** Absolute. Never later than the decision's `expiresAt`. */
  expiresAt: number;
}

export interface ApprovalGrant extends ApprovalGrantBody {
  /** HMAC-SHA256 of the canonical body, lowercase hex. */
  signature: string;
}

export type ApprovalRejection =
  | 'secret_too_short'
  | 'malformed_grant'
  | 'signature_invalid'
  | 'org_mismatch'
  | 'decision_mismatch'
  | 'expired'
  | 'issued_in_future'
  | 'ttl_too_long'
  | 'decision_not_approvable'
  | 'outlives_decision';

export type ApprovalVerification =
  | { ok: true; grant: ApprovalGrant }
  | { ok: false; reason: ApprovalRejection };

function signBody(secret: Uint8Array, body: ApprovalGrantBody): string {
  // Field names are fixed by the canonical encoding, so a renamed field
  // produces a different signature rather than silently verifying.
  const payload = canonicalJson({
    orgId: body.orgId,
    decisionId: body.decisionId,
    nonce: body.nonce,
    approvedBy: body.approvedBy,
    issuedAt: body.issuedAt,
    expiresAt: body.expiresAt,
  });
  return bytesToHex(hmac(sha256, secret, utf8ToBytes(payload)));
}

/**
 * Compare two hex digests without leaking where they first differ.
 *
 * A `===` on a signature is a timing oracle: an attacker who can measure the
 * comparison learns the signature byte by byte. This reads both strings in
 * full and accumulates the difference.
 */
export function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function secretBytes(secret: string | Uint8Array): Uint8Array | null {
  const bytes = typeof secret === 'string' ? utf8ToBytes(secret) : secret;
  return bytes.length < MIN_APPROVAL_SECRET_BYTES ? null : bytes;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isTimestamp(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/**
 * Mint a grant for a decision a person has approved.
 *
 * The caller must pass the decision itself, so the expiry can be clamped to it
 * here rather than trusted from a parameter. Returns a rejection instead of
 * throwing, because every caller has to handle the failure path anyway.
 */
export function mintApprovalGrant(
  secret: string | Uint8Array,
  decision: ActionDecision,
  input: { orgId: string; nonce: string; approvedBy: string; now: number; ttlMs: number },
): ApprovalVerification {
  const key = secretBytes(secret);
  if (key === null) return { ok: false, reason: 'secret_too_short' };

  // Only a decision that asked for a person can be granted. An `allow` needs
  // no grant and a `deny` must never acquire one.
  if (decision.decision !== 'require_approval') {
    return { ok: false, reason: 'decision_not_approvable' };
  }
  if (!isNonEmptyString(input.orgId) || !isNonEmptyString(input.nonce) || !isNonEmptyString(input.approvedBy)) {
    return { ok: false, reason: 'malformed_grant' };
  }
  if (!isTimestamp(input.now) || !Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
    return { ok: false, reason: 'malformed_grant' };
  }
  if (input.ttlMs > MAX_GRANT_TTL_MS) return { ok: false, reason: 'ttl_too_long' };
  if (!isNonEmptyString(decision.decisionId)) return { ok: false, reason: 'malformed_grant' };

  // The decision's own expiry is the ceiling. A grant that outlived its
  // decision would resurrect an action the policy had already timed out.
  const decisionExpiry = decision.expiresAt;
  if (!isTimestamp(decisionExpiry)) return { ok: false, reason: 'malformed_grant' };
  if (input.now >= decisionExpiry) return { ok: false, reason: 'expired' };

  const expiresAt = Math.min(input.now + input.ttlMs, decisionExpiry);
  const body: ApprovalGrantBody = {
    orgId: input.orgId,
    decisionId: decision.decisionId,
    nonce: input.nonce,
    approvedBy: input.approvedBy,
    issuedAt: input.now,
    expiresAt,
  };
  return { ok: true, grant: { ...body, signature: signBody(key, body) } };
}

/**
 * Verify a grant against the decision it claims to authorise.
 *
 * Fail-closed: every path that is not a complete, current, correctly bound and
 * correctly signed grant returns `ok: false`. Single use is NOT checked here —
 * that is the store's `redeem`, and a caller that skips it has not enforced it.
 */
export function verifyApprovalGrant(
  secret: string | Uint8Array,
  grant: unknown,
  against: { orgId: string; decision: ActionDecision; now: number },
): ApprovalVerification {
  const key = secretBytes(secret);
  if (key === null) return { ok: false, reason: 'secret_too_short' };

  if (typeof grant !== 'object' || grant === null) return { ok: false, reason: 'malformed_grant' };
  const g = grant as Record<string, unknown>;
  if (
    !isNonEmptyString(g.orgId) ||
    !isNonEmptyString(g.decisionId) ||
    !isNonEmptyString(g.nonce) ||
    !isNonEmptyString(g.approvedBy) ||
    !isNonEmptyString(g.signature) ||
    !isTimestamp(g.issuedAt) ||
    !isTimestamp(g.expiresAt)
  ) {
    return { ok: false, reason: 'malformed_grant' };
  }
  if (!isTimestamp(against.now)) return { ok: false, reason: 'malformed_grant' };

  const body: ApprovalGrantBody = {
    orgId: g.orgId,
    decisionId: g.decisionId,
    nonce: g.nonce,
    approvedBy: g.approvedBy,
    issuedAt: g.issuedAt,
    expiresAt: g.expiresAt,
  };

  // Signature first: everything after this point trusts the body's contents,
  // and an unsigned body's claims are worth nothing.
  if (!timingSafeHexEqual(signBody(key, body), g.signature)) {
    return { ok: false, reason: 'signature_invalid' };
  }

  if (body.orgId !== against.orgId) return { ok: false, reason: 'org_mismatch' };
  if (body.decisionId !== against.decision.decisionId) return { ok: false, reason: 'decision_mismatch' };
  if (against.decision.decision !== 'require_approval') {
    return { ok: false, reason: 'decision_not_approvable' };
  }
  if (body.issuedAt > against.now) return { ok: false, reason: 'issued_in_future' };
  if (body.expiresAt - body.issuedAt > MAX_GRANT_TTL_MS) return { ok: false, reason: 'ttl_too_long' };
  if (against.now >= body.expiresAt) return { ok: false, reason: 'expired' };

  const decisionExpiry = against.decision.expiresAt;
  if (!isTimestamp(decisionExpiry)) return { ok: false, reason: 'malformed_grant' };
  if (body.expiresAt > decisionExpiry) return { ok: false, reason: 'outlives_decision' };
  if (against.now >= decisionExpiry) return { ok: false, reason: 'expired' };

  return { ok: true, grant: { ...body, signature: g.signature } };
}

/**
 * The approval record and its store.
 *
 * SINGLE USE LIVES HERE, NOT IN THE SIGNATURE
 *
 * A signature proves a grant is genuine. It cannot prove the grant has not
 * already been spent: a replayed byte-identical grant verifies perfectly every
 * time. Only an atomic `redeem` can make it one-shot, so a caller that
 * verifies without redeeming has not enforced single use at all.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface ApprovalRequestRecord {
  orgId: string;
  decisionId: string;
  policyId: string | null;
  policyVersion: number | null;
  /** Why the kernel asked for a person. */
  reasonCode: string;
  /** sha256 of the normalized request. No payload is stored. */
  requestDigest: string;
  /** The decision's expiry. After this the ask is dead regardless of status. */
  expiresAt: number;
  createdAt: number;
  status: ApprovalStatus;
  approvedBy: string | null;
  resolvedAt: number | null;
  /** Present only once approved, and removed by a successful redeem. */
  grant: ApprovalGrant | null;
  redeemedAt: number | null;
}

export interface ApprovalStore {
  /**
   * Record that an action is waiting on a person. Idempotent: the same
   * decision id asked twice is one ask, so a retrying agent does not flood the
   * queue. Returns true when this call created the record.
   */
  open(record: ApprovalRequestRecord): Promise<boolean>;
  get(orgId: string, decisionId: string): Promise<ApprovalRequestRecord | null>;
  /** Oldest first. Excludes anything already past `expiresAt` at `now`. */
  listPending(orgId: string, now: number): Promise<ApprovalRequestRecord[]>;
  /** Attach a grant. Returns false if the ask is missing or already resolved. */
  approve(orgId: string, decisionId: string, grant: ApprovalGrant, at: number): Promise<boolean>;
  deny(orgId: string, decisionId: string, by: string, at: number): Promise<boolean>;
  /**
   * Hand back the grant exactly once. Every later call returns null, including
   * concurrent ones. Returns null for anything not approved, or expired at `at`.
   */
  redeem(orgId: string, decisionId: string, at: number): Promise<ApprovalGrant | null>;
}

/** Build the record for a decision that asked for a person. */
export function approvalRequestFor(
  decision: ActionDecision,
  input: { orgId: string; now: number },
): ApprovalRequestRecord | null {
  if (decision.decision !== 'require_approval') return null;
  if (!isNonEmptyString(decision.decisionId) || !isTimestamp(decision.expiresAt)) return null;
  if (!isNonEmptyString(input.orgId) || !isTimestamp(input.now)) return null;
  return {
    orgId: input.orgId,
    decisionId: decision.decisionId,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    reasonCode: decision.reasonCode,
    requestDigest: decision.requestDigest,
    expiresAt: decision.expiresAt,
    createdAt: input.now,
    status: 'pending',
    approvedBy: null,
    resolvedAt: null,
    grant: null,
    redeemedAt: null,
  };
}
