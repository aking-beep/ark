import type { ActionDecisionValue, ActionReasonCode } from './action.js';

/**
 * Action receipts (guarded-refund-tool, ADR-0009).
 *
 * One receipt per guarded attempt: what was requested, what was decided, and
 * what actually happened. Types only — the guard (`@ark/guard`) writes them, and
 * the stores live with the guard (in-memory) and in `@ark/db` (libSQL).
 *
 * A receipt holds identifiers, the decision and digests. It never holds the
 * tool arguments, a prompt, customer PII, a secret, or the raw idempotency key:
 * the field list below is the whole of what is stored.
 */

/**
 * What happened to the side effect, recorded separately from the decision.
 *
 * - `not_attempted` — the handler was not invoked (blocked, pending, replay).
 * - `attempted` — the idempotency key was claimed and the handler is about to
 *   run or is running. Written before the handler is invoked, so a crash leaves
 *   `attempted` (possibly executed), never `not_attempted`.
 * - `completed` — the handler returned.
 * - `failed` — the side effect definitely did not happen (the handler returned
 *   a definitive failure, or the decision expired after the claim and the
 *   handler was never invoked).
 * - `outcome_unknown` — the handler threw or timed out after it started. Never
 *   retried automatically.
 */
export const EXECUTION_STATUSES = ['not_attempted', 'attempted', 'completed', 'failed', 'outcome_unknown'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** Terminal statuses a claimed (`attempted`) receipt may move to. */
export type FinalExecutionStatus = Extract<ExecutionStatus, 'completed' | 'failed' | 'outcome_unknown'>;

/**
 * Reasons the guard itself blocks or annotates an attempt, in addition to the
 * kernel's `ActionReasonCode`. When the guard's reason supersedes the kernel's
 * (the policy source failed, the decision expired, the key was replayed), the
 * receipt's `reasonCode` is the guard's.
 */
export const GUARD_REASON_CODES = [
  'invalid_arguments',
  'idempotency_key_missing',
  'policy_source_failed',
  'policy_source_timeout',
  'decision_expired',
  'idempotency_replay',
  'idempotency_conflict',
  'receipt_conflict',
  'receipt_store_failed',
  'handler_failed',
  'handler_threw',
  'handler_timeout',
] as const;
export type GuardReasonCode = (typeof GUARD_REASON_CODES)[number];

export type ReceiptReasonCode = ActionReasonCode | GuardReasonCode;

export interface ActionReceipt {
  orgId: string;
  /** The kernel's decision id for the request as the guard submitted it. */
  id: string;
  traceId: string | null;
  agentId: string;
  principal: string | null;
  tool: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  policyId: string | null;
  policyVersion: number | null;
  decision: ActionDecisionValue;
  reasonCode: ReceiptReasonCode;
  /** The kernel's request digest: sha256 of the canonical normalized request, `now` included. */
  requestDigest: string;
  executionStatus: ExecutionStatus;
  /** sha256 of the idempotency key. Never the key. Null when no key was supplied. */
  idempotencyKeyHash: string | null;
  /** An `approvedBy`/`approval` field was present in the arguments and was ignored. */
  senderReportedApproval: boolean;
  amountMinor: number | null;
  currency: string | null;
  /** The guard clock at decision time; equal to the request's `now`. */
  createdAt: number;
  updatedAt: number;
}

export type ClaimResult =
  /** This receipt now owns the key and was stored with status `attempted`. */
  | { claimed: true }
  /**
   * Not stored. `existing` is the receipt that already owns this
   * `(orgId, idempotencyKeyHash)`, or `null` when the insert collided on
   * `(orgId, id)` alone (an identical decision already recorded).
   */
  | { claimed: false; existing: ActionReceipt | null };

/**
 * Receipt storage. Every method is org-scoped; no method reads or writes
 * across orgs.
 *
 * `claim` is the idempotency boundary and must be atomic: of any number of
 * concurrent claims for one `(orgId, idempotencyKeyHash)`, at most one returns
 * `claimed: true`. Adapters implement it as a single conditional insert
 * against a unique constraint, never as read-then-write.
 */
export interface ActionReceiptStore {
  /**
   * Store a receipt whose status is `not_attempted`. Returns false, and stores
   * nothing, when `(orgId, id)` already exists.
   */
  record(receipt: ActionReceipt): Promise<boolean>;
  /** Atomically store `receipt` with status `attempted` iff no other receipt owns its key. */
  claim(receipt: ActionReceipt): Promise<ClaimResult>;
  /** Move an `attempted` receipt to a final status. A no-op for any other status. */
  finish(orgId: string, id: string, status: FinalExecutionStatus, updatedAt: number): Promise<void>;
  get(orgId: string, id: string): Promise<ActionReceipt | null>;
  /** The receipt that owns this key (status other than `not_attempted`), if any. */
  findClaim(orgId: string, idempotencyKeyHash: string): Promise<ActionReceipt | null>;
}
