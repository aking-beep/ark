import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  decideAction,
  EXECUTION_STATUSES,
  type ActionAttributes,
  type ActionDecision,
  type ActionDecisionValue,
  type ActionReceipt,
  type ActionReceiptStore,
  type ActionRequest,
  type ActionResource,
  type EvidenceObservation,
  type ExecutionStatus,
  type FinalExecutionStatus,
  type ReceiptReasonCode,
} from '@ark/core';
import type { TraceHandle } from '@ark/sdk';

/**
 * `guardTool` — the enforcement boundary for one consequential tool (ADR-0009).
 *
 * Per call, in this order and with no way to skip a step:
 *
 * 1. identity comes from `resolveContext()` (trusted, server side); nothing in
 *    the arguments is read for identity;
 * 2. sender-reported approval fields are flagged (at any depth) and removed (at
 *    the top level); the arguments are validated with the tool's zod schema,
 *    deep-copied to plain data, frozen, and mapped to an `ActionRequest`;
 * 3. policies are loaded (a throw or a timeout fails closed);
 * 4. `decideAction` runs on the guard's clock;
 * 5. only an unexpired `allow` with a required idempotency key reaches the
 *    atomic claim, and only a claim the store confirms with `claimed === true`
 *    reaches the handler;
 * 6. the execution status is recorded separately from the decision, and a
 *    handler that throws or times out is `outcome_unknown` and never retried.
 *
 * Every attempt with a trusted org leaves a receipt (see `ActionReceipt`).
 * Every store call has a timeout; one that fails or times out before the
 * handler blocks the call. Telemetry is best-effort and is emitted after the
 * outcome is final, on a later turn of the event loop.
 */

export interface TrustedContext {
  orgId: string;
  agentId: string;
  /**
   * Authenticated delegating user id, when the agent acts for a person. Stored
   * in the receipt as given: use an opaque id, never an email address or a name.
   */
  principal?: string;
  /** Correlates the receipt with an ARK trace. */
  traceId?: string;
}

/** The action a tool performs, and how its validated arguments map to a kernel request. */
export interface GuardedAction<A> {
  /** Kernel action name, e.g. `refund`. Policies are matched on `tool` + `name`. */
  name: string;
  /**
   * Validates and normalizes the arguments. The parsed output is deep-copied to
   * plain data (`structuredClone`) and frozen before `toRequest` and the handler
   * see it; output that cannot be cloned (functions, symbols) is invalid.
   */
  args: z.ZodType<A, z.ZodTypeDef, unknown>;
  /**
   * The resource and attributes the decision is made on. Pure: everything the
   * handler acts on that the policy should judge must be mapped here, because
   * only these fields are bound by the request digest. `resource.id` is stored
   * in the receipt as given: map an opaque id (an order id), never PII.
   */
  toRequest(args: Readonly<A>): { resource: ActionResource; attributes: ActionAttributes };
}

export type PolicySource = () => readonly unknown[] | Promise<readonly unknown[]>;

export interface HandlerInput<A> {
  /**
   * The validated arguments: the same frozen plain-data copy `toRequest` read.
   * Advisory. Act on `request`; never read an approval from `args`.
   */
  args: Readonly<A>;
  /** The exact request the decision was made on (`decision.normalizedRequest`). Act on this. */
  request: Readonly<ActionRequest>;
  decisionId: string;
  /** Aborted when the guard's handler timeout fires. */
  signal: AbortSignal;
}

const TOOL_FAILED: unique symbol = Symbol('ark.guard.toolFailed');
/** Returned by a handler to say the side effect definitely did not happen. */
export interface ToolFailure {
  readonly [TOOL_FAILED]: true;
}
/** Return this from a handler when the side effect definitely did not happen. Records `failed`. */
export function toolFailed(): ToolFailure {
  return { [TOOL_FAILED]: true };
}
function isToolFailure(v: unknown): v is ToolFailure {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[TOOL_FAILED] === true;
}

/** The part of an `@ark/sdk` `TraceHandle` the guard uses. */
export type GuardTelemetry = Pick<TraceHandle, 'evidence'>;

export interface GuardToolOptions<A, R> {
  /** Kernel tool name, e.g. `payments`. */
  tool: string;
  action: GuardedAction<A>;
  handler: (input: HandlerInput<A>) => R | ToolFailure | Promise<R | ToolFailure>;
  /** The org's policies, or a source that loads them. */
  policies: readonly unknown[] | PolicySource;
  /** Trusted identity from the server side: the authenticated session, never the arguments. */
  resolveContext: () => TrustedContext | Promise<TrustedContext>;
  /**
   * Required: a call whose key is missing is blocked. Prefer a key derived from
   * the resource on the server side (`refund:${orderId}`) over one the caller
   * chooses: a caller that mints a new key is a new action (see README).
   */
  idempotency: { key: (args: Readonly<A>) => string | undefined };
  receipts: ActionReceiptStore;
  /** The guard's clock. Defaults to `Date.now`. `now` never comes from the request. */
  clock?: () => number;
  /** Pin the policy version in force; any other version is `unknown`. */
  expectedPolicyVersion?: number;
  timeouts?: { contextMs?: number; policyMs?: number; handlerMs?: number; storeMs?: number };
  /** Best-effort. A failure here never changes a decision or an execution. */
  telemetry?: GuardTelemetry;
}

export type GuardOutcome = 'executed' | 'execution_failed' | 'blocked' | 'pending_approval' | 'replayed';

export type GuardNote =
  /** An approval-like field was in the arguments. It was ignored (and removed if top-level). */
  | 'sender_reported_approval_ignored'
  /** The receipt could not be written. The outcome stands; the call was not executed unless it says so. */
  | 'receipt_write_failed'
  /** The receipt was claimed but its final status could not be written; it still reads `attempted`. */
  | 'receipt_update_failed';

export interface GuardResultBase {
  outcome: GuardOutcome;
  /** The kernel's decision, or null when no decision could be made (no trusted context). */
  decision: ActionDecisionValue | null;
  decisionId: string | null;
  /** The receipt's reason code: the guard's when it supersedes the kernel's. */
  reasonCode: ReceiptReasonCode;
  /**
   * What happened to the side effect. For `replayed` it is the first attempt's
   * status (this attempt executed nothing; `handlerInvoked` is false).
   */
  executionStatus: ExecutionStatus;
  handlerInvoked: boolean;
  /** This attempt's receipt, as stored. Null when none could be stored. */
  receipt: ActionReceipt | null;
  notes: GuardNote[];
  /** Set when the handler ran and did not complete. */
  executionError?: 'failed' | 'threw' | 'timeout';
}

export type GuardResult<R> =
  | (GuardResultBase & { outcome: 'executed'; value: R })
  | (GuardResultBase & { outcome: 'replayed'; original: ActionReceipt })
  | (GuardResultBase & { outcome: 'execution_failed' | 'blocked' | 'pending_approval' });

export type GuardedHandler<R> = (rawArgs: unknown) => Promise<GuardResult<R>>;

const DEFAULT_TIMEOUTS = { contextMs: 1_000, policyMs: 1_000, handlerMs: 10_000, storeMs: 2_000 };

const Id = z.string().min(1).max(128);
const ContextSchema = z.object({
  orgId: Id,
  agentId: Id,
  principal: Id.optional(),
  traceId: Id.optional(),
});
const IdempotencyKey = z.string().min(1).max(256);

// ---------------------------------------------------------------------------
// Sender-reported approval.

/**
 * A key claims an approval when, lower-cased with every non-alphanumeric
 * removed, it starts with `approv`: `approvedBy`, `approved_by`, `approved-by`,
 * `APPROVAL`, `approvalToken`, `approverId`, `approvedBy` with a zero-width
 * space. The sender cannot approve its own action.
 */
function isApprovalKey(key: string): boolean {
  return /^approv/.test(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

const APPROVAL_SCAN_MAX_DEPTH = 8;
const APPROVAL_SCAN_MAX_KEYS = 2_000;

/**
 * Is there an approval-like key anywhere in `v`? Reads own data properties
 * only (never invokes a getter), bounded in depth and in keys visited. A value
 * that cannot be inspected (a Proxy whose trap throws) counts as no flag; it is
 * still never read for authorization.
 */
function containsApprovalKey(v: unknown): boolean {
  let visited = 0;
  const walk = (x: unknown, depth: number): boolean => {
    if (typeof x !== 'object' || x === null || depth > APPROVAL_SCAN_MAX_DEPTH) return false;
    for (const k of Reflect.ownKeys(x)) {
      if (++visited > APPROVAL_SCAN_MAX_KEYS) return false;
      if (typeof k !== 'string') continue;
      if (isApprovalKey(k)) return true;
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (d && 'value' in d && walk(d.value, depth + 1)) return true;
    }
    return false;
  };
  try {
    return walk(v, 0);
  } catch {
    return false;
  }
}

/**
 * Flag approval-like keys at any depth, and remove the top-level ones so a
 * strict schema turns a forged approval into "ignored" rather than "invalid".
 * Nested ones are left for the schema (usually stripped); they are never read
 * for authorization either way.
 */
function stripSenderApproval(raw: unknown): { args: unknown; senderApproval: boolean } {
  const senderApproval = containsApprovalKey(raw);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { args: raw, senderApproval };
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return { args: raw, senderApproval };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isApprovalKey(k)) continue;
    Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  return { args: out, senderApproval };
}

// ---------------------------------------------------------------------------
// Helpers.

class Timeout extends Error {}

async function withTimeout<T>(run: () => T | Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Timeout());
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(run), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const STATUSES: ReadonlySet<string> = new Set(EXECUTION_STATUSES);

/** Enough of a receipt to compare against and report. Anything else from a store is malformed. */
function isReceipt(v: unknown): v is ActionReceipt {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.orgId === 'string' &&
    typeof r.id === 'string' &&
    typeof r.requestDigest === 'string' &&
    Number.isSafeInteger(r.createdAt) &&
    typeof r.executionStatus === 'string' &&
    STATUSES.has(r.executionStatus)
  );
}

/**
 * Do the stored claim and this request describe the same action? The kernel's
 * request digest covers `now`, so the claim's digest is recomputed with this
 * request's fields at the claim's own `now` (`createdAt`, which the guard sets
 * to the decision time). Same org, agent, principal, tool, action, resource and
 * attributes give the same digest; anything else does not.
 *
 * This depends on two kernel properties: `requestDigest` does not depend on
 * the policy list (so `[]` is fine here), and the kernel's normalization of a
 * request is stable across versions. If a future kernel changes how it
 * normalizes or digests a request, replays of claims stored before the change
 * become `idempotency_conflict` — which blocks, so it fails closed, but a kernel
 * author changing the digest should know that this is the cost.
 */
function sameRequest(claim: ActionReceipt, request: Readonly<ActionRequest>): boolean {
  return decideAction({ ...request, now: claim.createdAt }, []).requestDigest === claim.requestDigest;
}

/**
 * The evidence outcome for telemetry. Only an attempt whose handler completed
 * is `ok` (a member of `COMPLETED_OUTCOMES`). A replay executed nothing, so it
 * is `blocked` whatever the first attempt's status — it must neither read as a
 * second completed refund nor turn an `outcome_unknown` into a success.
 */
function evidenceOutcome(result: GuardResultBase): EvidenceObservation['outcome'] {
  switch (result.outcome) {
    case 'executed':
      return 'ok';
    case 'pending_approval':
      return 'pending';
    case 'execution_failed':
      return 'error';
    case 'replayed':
    case 'blocked':
      return 'blocked';
  }
}

export function guardTool<A, R>(opts: GuardToolOptions<A, R>): GuardedHandler<R> {
  const clock = opts.clock ?? Date.now;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  const store = opts.receipts;
  const loadPolicies: PolicySource =
    typeof opts.policies === 'function' ? (opts.policies as PolicySource) : () => opts.policies as readonly unknown[];
  /** Every store call is bounded: a hung store must not hang the guarded call. */
  const storeCall = <T>(run: () => Promise<T>) => withTimeout(run, timeouts.storeMs);

  /**
   * Best-effort telemetry. The observation is built now, from the final result,
   * and handed to the sink on a later turn of the event loop, so the result is
   * returned first. A sink that throws, returns a rejected promise or is slow
   * can neither change the result nor surface an unhandled rejection.
   */
  function emit(result: GuardResult<unknown>, ctx: TrustedContext | null): void {
    const sink = opts.telemetry;
    if (!sink) return;
    let observation: EvidenceObservation;
    try {
      const replay = result.outcome === 'replayed';
      observation = {
        protocol: 'mcp',
        kind: 'tool',
        operation: `tools/call:${opts.tool}.${opts.action.name}`,
        outcome: evidenceOutcome(result),
        risk: 'high',
        requiredApproval: result.decision === 'require_approval',
        // The guard has no approval service; a sender's claim is never forwarded as one.
        approvedBy: null,
        ...(result.decisionId ? { evidenceRef: result.decisionId } : {}),
        ...(ctx ? { agentId: ctx.agentId } : {}),
        metadata: {
          guardOutcome: result.outcome,
          decision: result.decision ?? 'none',
          reasonCode: result.reasonCode,
          // This attempt's own status: a replay executed nothing.
          executionStatus: replay ? 'not_attempted' : result.executionStatus,
          ...(replay
            ? { replay: true, originalExecutionStatus: result.original.executionStatus, originalDecisionId: result.original.id }
            : {}),
        },
      };
    } catch {
      return;
    }
    setImmediate(() => {
      try {
        const ret: unknown = sink.evidence(observation);
        if (ret !== null && (typeof ret === 'object' || typeof ret === 'function')) {
          const then = (ret as { then?: unknown }).then;
          if (typeof then === 'function') then.call(ret, undefined, () => {});
        }
      } catch {
        // Best-effort by contract (spec criterion 5): a telemetry failure is not an outcome.
      }
    });
  }

  return async function guarded(rawArgs: unknown): Promise<GuardResult<R>> {
    const notes: GuardNote[] = [];

    // 1. Trusted context. No org, no receipt and no execution.
    let ctx: TrustedContext;
    try {
      ctx = ContextSchema.parse(await withTimeout(opts.resolveContext, timeouts.contextMs));
    } catch {
      const result: GuardResult<R> = {
        outcome: 'blocked', decision: null, decisionId: null, reasonCode: 'context_unavailable',
        executionStatus: 'not_attempted', handlerInvoked: false, receipt: null, notes,
      };
      emit(result, null);
      return result;
    }

    // 2. Validate. Sender-reported approval is flagged and removed first, so a
    //    strict schema cannot turn a forged approval into anything but "ignored".
    //    The parsed output is cloned to plain data, so `toRequest` and the
    //    handler read the same values and no getter or retained reference can
    //    change between the decision and the side effect.
    const { args: stripped, senderApproval } = stripSenderApproval(rawArgs);
    if (senderApproval) notes.push('sender_reported_approval_ignored');
    let guardReason: ReceiptReasonCode | null = null;
    let args: Readonly<A> | null = null;
    let mapped: { resource: ActionResource; attributes: ActionAttributes } | null = null;
    let keyHash: string | null = null;
    try {
      const parsed = opts.action.args.safeParse(stripped);
      if (!parsed.success) throw new Error('invalid');
      args = deepFreeze(structuredClone(parsed.data));
      mapped = opts.action.toRequest(args);
    } catch {
      guardReason = 'invalid_arguments';
      args = null;
      mapped = null;
    }
    if (args !== null) {
      try {
        const key = IdempotencyKey.safeParse(opts.idempotency.key(args));
        if (key.success) keyHash = sha256Hex(key.data);
        else guardReason = 'idempotency_key_missing';
      } catch {
        guardReason = 'idempotency_key_missing';
      }
    }

    // 3. Policies. A source that throws or hangs leaves no policies: `unknown`.
    let policies: readonly unknown[] = [];
    try {
      policies = await withTimeout(loadPolicies, timeouts.policyMs);
    } catch (err) {
      guardReason ??= err instanceof Timeout ? 'policy_source_timeout' : 'policy_source_failed';
      policies = [];
    }

    // 4. Decide, on the guard's clock.
    const now = clock();
    const request = {
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      ...(ctx.principal !== undefined ? { principal: ctx.principal } : {}),
      tool: opts.tool,
      action: opts.action.name,
      ...(mapped ?? {}),
      now,
    };
    const decision: ActionDecision = decideAction(
      request,
      policies,
      opts.expectedPolicyVersion !== undefined ? { expectedPolicyVersion: opts.expectedPolicyVersion } : undefined,
    );

    const n = decision.normalizedRequest;
    const receipt: ActionReceipt = {
      orgId: ctx.orgId,
      id: decision.decisionId,
      traceId: ctx.traceId ?? null,
      agentId: ctx.agentId,
      principal: ctx.principal ?? null,
      tool: opts.tool,
      action: opts.action.name,
      resourceType: n?.resource.type ?? mapped?.resource.type ?? null,
      resourceId: n?.resource.id ?? mapped?.resource.id ?? null,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      decision: decision.decision,
      reasonCode: guardReason ?? decision.reasonCode,
      requestDigest: decision.requestDigest,
      executionStatus: 'not_attempted',
      idempotencyKeyHash: keyHash,
      senderReportedApproval: senderApproval,
      amountMinor: n?.attributes.amountMinor ?? null,
      currency: n?.attributes.currency ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const base = {
      decision: decision.decision,
      decisionId: decision.decisionId,
      handlerInvoked: false,
      notes,
    };

    const done = (result: GuardResult<R>): GuardResult<R> => {
      emit(result, ctx);
      return result;
    };

    /** Store this attempt's receipt as not_attempted. Returns it as stored, or null. */
    const recordNotAttempted = async (reasonCode: ReceiptReasonCode): Promise<ActionReceipt | null> => {
      const r: ActionReceipt = { ...receipt, reasonCode, executionStatus: 'not_attempted' };
      try {
        // A duplicate (org_id, id) is an identical decision already on record.
        if ((await storeCall(() => store.record(r))) === true) return r;
        const existing = await storeCall(() => store.get(r.orgId, r.id));
        return isReceipt(existing) ? existing : null;
      } catch {
        notes.push('receipt_write_failed');
        return null;
      }
    };

    /** A result that executed nothing, with its receipt stored. */
    const stop = async (
      outcome: 'blocked' | 'pending_approval',
      reasonCode: ReceiptReasonCode,
    ): Promise<GuardResult<R>> =>
      done({
        ...base, outcome, reasonCode, executionStatus: 'not_attempted', receipt: await recordNotAttempted(reasonCode),
      });

    /** The store failed, timed out or answered nonsense before execution: block, nothing runs. */
    const storeFailed = (): GuardResult<R> => {
      notes.push('receipt_write_failed');
      return done({
        ...base, outcome: 'blocked', reasonCode: 'receipt_store_failed', executionStatus: 'not_attempted', receipt: null,
      });
    };

    if (guardReason !== null) return stop('blocked', guardReason);
    if (decision.decision === 'require_approval') return stop('pending_approval', decision.reasonCode);
    if (decision.decision !== 'allow') return stop('blocked', decision.reasonCode);

    // 5. Allow. Defensive: an allow must carry what was decided and an expiry.
    if (n === null || decision.expiresAt === undefined || keyHash === null) {
      return stop('blocked', 'invalid_request');
    }
    const expiresAt = decision.expiresAt;
    const fresh = () => {
      const t = clock();
      return Number.isSafeInteger(t) && t >= now && t < expiresAt;
    };
    if (!fresh()) return stop('blocked', 'decision_expired');

    const claimed: ActionReceipt = { ...receipt, executionStatus: 'attempted' };
    let claim: unknown;
    try {
      claim = await storeCall(() => store.claim(claimed));
    } catch {
      return storeFailed();
    }
    const claimedField = typeof claim === 'object' && claim !== null ? (claim as Record<string, unknown>).claimed : undefined;

    if (claimedField !== true) {
      // Only a strict `claimed: false` with `existing` null or a well-formed
      // receipt is understood. Anything else is a misbehaving store: block.
      if (claimedField !== false) return storeFailed();
      const owner = (claim as Record<string, unknown>).existing;
      // No owner of the key: the insert collided on (org_id, id) alone. No
      // receipt of our own can be stored, so nothing executes.
      if (owner === null) return stop('blocked', 'receipt_conflict');
      if (!isReceipt(owner)) return storeFailed();
      if (!sameRequest(owner, n)) return stop('blocked', 'idempotency_conflict');
      const own = await recordNotAttempted('idempotency_replay');
      let original: ActionReceipt = owner;
      try {
        const fetched = await storeCall(() => store.get(owner.orgId, owner.id));
        if (isReceipt(fetched)) original = fetched;
      } catch {
        // The owner returned by the claim is still the first attempt's receipt.
      }
      return done({
        ...base,
        outcome: 'replayed',
        original,
        reasonCode: 'idempotency_replay',
        // The first attempt's status. This attempt executed nothing.
        executionStatus: original.executionStatus,
        receipt: own,
      });
    }

    // The claim is ours and reads `attempted`. Re-check expiry: the claim was I/O.
    // If the final status cannot be written (store error or timeout), the row
    // keeps `attempted` — "possibly executed" — and the result says so in notes.
    const finish = async (status: FinalExecutionStatus): Promise<ActionReceipt> => {
      const at = clock();
      const updatedAt = Number.isSafeInteger(at) && at >= now ? at : now;
      try {
        await storeCall(() => store.finish(claimed.orgId, claimed.id, status, updatedAt));
      } catch {
        notes.push('receipt_update_failed');
        return claimed;
      }
      return { ...claimed, executionStatus: status, updatedAt };
    };

    if (!fresh()) {
      const r = await finish('failed');
      return done({
        ...base, outcome: 'blocked', reasonCode: 'decision_expired', executionStatus: r.executionStatus, receipt: r,
      });
    }

    // 6. Execute exactly once. Never retried, whatever happens.
    const ac = new AbortController();
    let value: R | ToolFailure;
    try {
      value = await withTimeout(
        () => opts.handler({ args: args as Readonly<A>, request: n, decisionId: decision.decisionId, signal: ac.signal }),
        timeouts.handlerMs,
        () => ac.abort(),
      );
    } catch (err) {
      const r = await finish('outcome_unknown');
      return done({
        ...base, handlerInvoked: true, outcome: 'execution_failed', reasonCode: claimed.reasonCode,
        executionStatus: 'outcome_unknown', receipt: r, executionError: err instanceof Timeout ? 'timeout' : 'threw',
      });
    }

    if (isToolFailure(value)) {
      const r = await finish('failed');
      return done({
        ...base, handlerInvoked: true, outcome: 'execution_failed', reasonCode: claimed.reasonCode,
        executionStatus: 'failed', receipt: r, executionError: 'failed',
      });
    }

    const r = await finish('completed');
    return done({
      ...base, handlerInvoked: true, outcome: 'executed', value, reasonCode: claimed.reasonCode,
      executionStatus: 'completed', receipt: r,
    });
  };
}
