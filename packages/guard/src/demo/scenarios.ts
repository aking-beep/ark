import type { ActionReceiptStore } from '@ark/core';
import type { GuardResult, GuardTelemetry } from '../guard.js';
import { DEMO_CONTEXT, RefundLedger, guardedRefundTool, type RefundResult } from './refund.js';

/**
 * The eight demo scenarios from the spec, run through `guardTool`. Shared by
 * `npm run demo:guard` (which prints them) and the integration tests (which
 * assert them), so the demo cannot drift from what is tested.
 */

/** 2026-10-19T09:00:00Z. The demo clock ticks 1 ms per read, so runs are reproducible. */
export const DEMO_EPOCH_MS = 1_792_400_400_000;

export function tickingClock(start = DEMO_EPOCH_MS): () => number {
  let t = start;
  return () => t++;
}

export interface ScenarioRow {
  name: string;
  expected: string;
  result: GuardResult<RefundResult>;
  /** Handler calls made during this scenario. */
  calls: number;
}

export interface ScenarioRun {
  rows: ScenarioRow[];
  /** One ledger for every scenario; `entries` is what was actually refunded. */
  ledger: RefundLedger;
}

export async function runRefundScenarios(o: {
  receipts: ActionReceiptStore;
  clock?: () => number;
  telemetry?: GuardTelemetry;
}): Promise<ScenarioRun> {
  const ledger = new RefundLedger();
  const clock = o.clock ?? tickingClock();
  const common = { ledger, receipts: o.receipts, clock, ...(o.telemetry ? { telemetry: o.telemetry } : {}) };
  const refund = guardedRefundTool(common);
  const unknownTool = guardedRefundTool({ ...common, tool: 'billing' });
  const otherOrg = guardedRefundTool({ ...common, context: { ...DEMO_CONTEXT, orgId: 'org_other' } });

  const rows: ScenarioRow[] = [];
  const run = async (
    name: string,
    expected: string,
    tool: (args: unknown) => Promise<GuardResult<RefundResult>>,
    args: Record<string, unknown>,
    before?: () => void,
  ) => {
    before?.();
    const start = ledger.calls;
    const result = await tool(args);
    rows.push({ name, expected, result, calls: ledger.calls - start });
  };

  const r75 = { orderId: 'ord_1001', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-75' };
  await run('$75', 'allowed, executes once', refund, r75);
  await run('$750', 'pending approval, 0 calls', refund,
    { orderId: 'ord_1002', amountMinor: 75_000, currency: 'USD', idempotencyKey: 'k-750' });
  await run('$5,000', 'denied, 0 calls', refund,
    { orderId: 'ord_1003', amountMinor: 500_000, currency: 'USD', idempotencyKey: 'k-5000' });
  await run('unknown tool or policy', 'blocked, 0 calls', unknownTool,
    { orderId: 'ord_1004', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-unknown' });
  // The arguments claim org_demo; identity comes from the trusted context only.
  await run('context for another org', 'blocked, 0 calls', otherOrg,
    { orderId: 'ord_1005', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-other-org', orgId: 'org_demo' });
  await run('forged approvedBy "ceo" on $750', 'still pending, 0 calls, flag recorded', refund,
    { orderId: 'ord_1006', amountMinor: 75_000, currency: 'USD', idempotencyKey: 'k-forged', approvedBy: 'ceo' });
  await run('$75 replayed, same idempotency key', '1 total call', refund, { ...r75 });
  await run('handler throws after starting', 'outcome_unknown', refund,
    { orderId: 'ord_1007', amountMinor: 5_000, currency: 'USD', idempotencyKey: 'k-throw' },
    () => { ledger.crashAfterStart = true; });

  return { rows, ledger };
}
