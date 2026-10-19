import { z } from 'zod';
import { DEMO_REFUND_POLICY, type ActionReceiptStore } from '@ark/core';
import { guardTool, type GuardTelemetry, type GuardedAction, type HandlerInput, type TrustedContext } from '../guard.js';

/**
 * SYNTHETIC refund tool for the guard demo and its integration tests.
 *
 * `refund_order` moves no money: it appends to an in-memory ledger and counts
 * its calls. No network, no credentials, no real payment provider. The policy is
 * `DEMO_REFUND_POLICY` from `@ark/core` (<= $100 allow, <= $1,000 approval,
 * above that deny), whose thresholds are illustrative, not production defaults.
 */

/** What an agent sends to `refund_order`. Unknown keys (an `orgId`, a `role`) are stripped. */
export const RefundArgs = z.object({
  orderId: z.string().min(1).max(64),
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /**
   * A caller-chosen key. The demo ignores it by default and derives the key
   * from the order instead (`refundKeyFromOrder`); it is accepted only so that
   * `callerChosenKey` can show what a caller-chosen key does and does not stop.
   */
  idempotencyKey: z.string().min(1).max(256).optional(),
  /** Free text from the agent. Never stored in a receipt. */
  note: z.string().max(500).optional(),
});
export type RefundArgs = z.infer<typeof RefundArgs>;

export const refundAction: GuardedAction<RefundArgs> = {
  name: 'refund',
  args: RefundArgs,
  toRequest: (a) => ({
    resource: { type: 'order', id: a.orderId },
    attributes: { amountMinor: a.amountMinor, currency: a.currency },
  }),
};

export interface LedgerEntry {
  refundId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
}

export interface RefundResult {
  refundId: string;
}

/** The fake side effect. Not guarded by itself: calling `refundOrder` directly bypasses everything. */
export class RefundLedger {
  readonly entries: LedgerEntry[] = [];
  calls = 0;
  /** When set, the next call starts, then throws before it can report back. */
  crashAfterStart = false;

  refundOrder(input: { orderId: string; amountMinor: number; currency: string }): RefundResult {
    this.calls += 1;
    if (this.crashAfterStart) {
      this.crashAfterStart = false;
      throw new Error('synthetic processor crash after start');
    }
    const refundId = `rf_${this.entries.length + 1}`;
    this.entries.push({ refundId, orderId: input.orderId, amountMinor: input.amountMinor, currency: input.currency });
    return { refundId };
  }

  /** The guarded handler: executes exactly the request the decision was made on. */
  readonly handler = ({ request }: HandlerInput<RefundArgs>): RefundResult =>
    this.refundOrder({
      orderId: request.resource.id,
      amountMinor: request.attributes.amountMinor,
      currency: request.attributes.currency,
    });
}

/**
 * The recommended pattern: derive the key on the server side from the
 * resource, so one order has at most one refund, however many keys the agent
 * invents. A caller-chosen key only stops accidental retries of the same key.
 */
export const refundKeyFromOrder = (a: Readonly<RefundArgs>): string => `refund:${a.orderId}`;

/** The key the caller sent. Shown only to document the limit: a new key is a new refund. */
export const callerChosenKey = (a: Readonly<RefundArgs>): string | undefined => a.idempotencyKey;

export const DEMO_CONTEXT: TrustedContext = { orgId: 'org_demo', agentId: 'agent_support_bot', principal: 'user_ops_1' };

export interface RefundToolOptions {
  ledger: RefundLedger;
  receipts: ActionReceiptStore;
  context?: TrustedContext | (() => TrustedContext | Promise<TrustedContext>);
  /** Kernel tool name. `payments` is the one `DEMO_REFUND_POLICY` governs. */
  tool?: string;
  policies?: readonly unknown[] | (() => readonly unknown[] | Promise<readonly unknown[]>);
  clock?: () => number;
  telemetry?: GuardTelemetry;
  timeouts?: { contextMs?: number; policyMs?: number; handlerMs?: number; storeMs?: number };
  /** Defaults to `refundKeyFromOrder`. */
  idempotencyKey?: (a: Readonly<RefundArgs>) => string | undefined;
}

/** `refund_order` wrapped with `guardTool`. */
export function guardedRefundTool(o: RefundToolOptions) {
  const ctx = o.context ?? DEMO_CONTEXT;
  return guardTool<RefundArgs, RefundResult>({
    tool: o.tool ?? 'payments',
    action: refundAction,
    handler: o.ledger.handler,
    policies: o.policies ?? [DEMO_REFUND_POLICY],
    resolveContext: typeof ctx === 'function' ? ctx : () => ctx,
    idempotency: { key: o.idempotencyKey ?? refundKeyFromOrder },
    receipts: o.receipts,
    ...(o.clock ? { clock: o.clock } : {}),
    ...(o.telemetry ? { telemetry: o.telemetry } : {}),
    ...(o.timeouts ? { timeouts: o.timeouts } : {}),
  });
}
