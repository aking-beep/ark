import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  COMPLETED_OUTCOMES,
  DEMO_REFUND_POLICY,
  type ActionReceiptStore,
  type EvidenceObservation,
} from '@ark/core';
import { guardTool, type GuardTelemetry } from './guard.js';
import { MemoryReceiptStore } from './memory-store.js';
import {
  DEMO_CONTEXT,
  RefundArgs,
  RefundLedger,
  callerChosenKey,
  guardedRefundTool,
  refundAction,
  type RefundToolOptions,
} from './demo/refund.js';
import { tickingClock } from './demo/scenarios.js';

/**
 * Round-1 review and security-review findings (evidence/guarded-refund-tool/
 * REVIEW.md, SECURITY.md): replay telemetry (blocking / L4), async telemetry
 * sinks (M1), caller-chosen keys (M2), handler args binding (L1), approval
 * detection (L2), malformed store results (L3) and store timeouts.
 */

const r75 = { orderId: 'ord_1', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'key-75' };
const telemetryTurn = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recordingSink(): { sink: GuardTelemetry; seen: EvidenceObservation[] } {
  const seen: EvidenceObservation[] = [];
  return { seen, sink: { evidence: (o) => { seen.push(o); return undefined as never; } } };
}

function setup(over: Partial<RefundToolOptions> = {}) {
  const ledger = new RefundLedger();
  const receipts = over.receipts ?? new MemoryReceiptStore();
  const tool = guardedRefundTool({ ledger, receipts, clock: tickingClock(), idempotencyKey: callerChosenKey, ...over });
  return { ledger, receipts, tool };
}

/** A store that delegates to memory, with some methods overridden. */
function storeWith(over: Partial<Record<keyof ActionReceiptStore, unknown>>): ActionReceiptStore {
  const inner = new MemoryReceiptStore();
  return {
    record: (r) => inner.record(r),
    claim: (r) => inner.claim(r),
    finish: (...a) => inner.finish(...a),
    get: (o, i) => inner.get(o, i),
    findClaim: (o, k) => inner.findClaim(o, k),
    ...(over as Partial<ActionReceiptStore>),
  };
}

describe('replay telemetry is never a completed outcome', () => {
  test('the replay of an outcome_unknown call is reported outside COMPLETED_OUTCOMES', async () => {
    const { sink, seen } = recordingSink();
    const { tool, ledger } = setup({ telemetry: sink });
    ledger.crashAfterStart = true;
    await tool(r75);
    const replay = await tool(r75);
    await telemetryTurn();
    assert.equal(replay.outcome, 'replayed');
    assert.equal(replay.executionStatus, 'outcome_unknown');
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.outcome, 'error');
    assert.ok(!COMPLETED_OUTCOMES.includes(seen[1]!.outcome!), `replay emitted ${seen[1]!.outcome}`);
    assert.equal(seen[1]!.metadata?.replay, true);
    assert.equal(seen[1]!.metadata?.originalExecutionStatus, 'outcome_unknown');
    assert.equal(seen[1]!.metadata?.executionStatus, 'not_attempted');
    assert.equal(ledger.calls, 1);
  });

  test('the replay of a failed or still-attempted call is not completed either', async () => {
    for (const [name, over] of [
      ['failed', { handler: 'failed' }],
      ['attempted (final status never written)', { finishThrows: true }],
    ] as const) {
      const { sink, seen } = recordingSink();
      const receipts = 'finishThrows' in over
        ? storeWith({ finish: () => Promise.reject(new Error('disk full')) })
        : new MemoryReceiptStore();
      const guarded = guardTool({
        tool: 'payments', action: refundAction, policies: [DEMO_REFUND_POLICY], receipts, telemetry: sink,
        resolveContext: () => DEMO_CONTEXT, idempotency: { key: callerChosenKey }, clock: tickingClock(),
        handler: async () => ('handler' in over ? (await import('./guard.js')).toolFailed() : 'ok'),
      });
      await guarded(r75);
      const replay = await guarded(r75);
      await telemetryTurn();
      assert.equal(replay.outcome, 'replayed', name);
      assert.ok(!COMPLETED_OUTCOMES.includes(seen[1]!.outcome!), `${name}: replay emitted ${seen[1]!.outcome}`);
      assert.equal(seen[1]!.metadata?.originalExecutionStatus, replay.executionStatus, name);
    }
  });

  test('one completed refund replayed three times is one completed observation', async () => {
    const { sink, seen } = recordingSink();
    const { tool, ledger } = setup({ telemetry: sink });
    for (let i = 0; i < 4; i++) await tool(r75);
    await telemetryTurn();
    assert.equal(ledger.calls, 1);
    assert.equal(seen.filter((o) => COMPLETED_OUTCOMES.includes(o.outcome!)).length, 1);
    assert.deepEqual(seen.map((o) => o.outcome), ['ok', 'blocked', 'blocked', 'blocked']);
    assert.ok(seen.slice(1).every((o) => o.metadata?.replay === true && o.metadata?.originalDecisionId === seen[0]!.evidenceRef));
  });
});

describe('telemetry sinks cannot affect a call (M1)', () => {
  test('an async rejecting sink: no unhandled rejection, the in-flight call completes and is recorded', async () => {
    let unhandled = 0;
    const onUnhandled = () => { unhandled += 1; };
    process.on('unhandledRejection', onUnhandled);
    try {
      const receipts = new MemoryReceiptStore();
      const ledger = new RefundLedger();
      const sink = { evidence: (async () => { throw new Error('sink down'); }) as unknown as GuardTelemetry['evidence'] };
      const guarded = guardTool({
        tool: 'payments', action: refundAction, policies: [DEMO_REFUND_POLICY], receipts, telemetry: sink,
        resolveContext: () => DEMO_CONTEXT, idempotency: { key: callerChosenKey }, clock: tickingClock(),
        handler: async (input) => { await sleep(50); return ledger.handler(input); },
      });
      const inFlight = guarded(r75);
      const denied = await guarded({ ...r75, orderId: 'ord_2', amountMinor: 500_000, idempotencyKey: 'k-deny' });
      assert.equal(denied.outcome, 'blocked');
      await sleep(10);
      const done = await inFlight;
      await telemetryTurn();
      await sleep(20);
      assert.equal(unhandled, 0);
      assert.equal(done.outcome, 'executed');
      assert.equal(ledger.calls, 1);
      assert.equal((await receipts.get('org_demo', done.receipt!.id))?.executionStatus, 'completed');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('a thenable whose `then` throws, and a slow synchronous sink, change and delay nothing', async () => {
    const sinks: GuardTelemetry[] = [
      { evidence: () => ({ get then() { throw new Error('then getter'); } }) as never },
      { evidence: () => { const end = Date.now() + 200; while (Date.now() < end) { /* busy */ } return undefined as never; } },
    ];
    for (const sink of sinks) {
      const { tool, ledger } = setup({ telemetry: sink });
      const t0 = Date.now();
      const res = await tool(r75);
      assert.ok(Date.now() - t0 < 150, 'the result is returned before the sink runs');
      assert.equal(res.outcome, 'executed');
      assert.equal(ledger.calls, 1);
      await telemetryTurn();
    }
  });
});

describe('idempotency keys (M2)', () => {
  test('the demo derives the key from the order: a new caller key on the same order is a replay', async () => {
    const ledger = new RefundLedger();
    const tool = guardedRefundTool({ ledger, receipts: new MemoryReceiptStore(), clock: tickingClock() });
    assert.equal((await tool({ ...r75, idempotencyKey: 'a' })).outcome, 'executed');
    assert.equal((await tool({ ...r75, idempotencyKey: 'b' })).outcome, 'replayed');
    assert.equal((await tool({ orderId: 'ord_1', amountMinor: 7_500, currency: 'USD' })).outcome, 'replayed');
    assert.equal(ledger.calls, 1);
  });

  test('documented limit: with a caller-chosen key, a caller that mints new keys is NOT stopped', async () => {
    // Per-call thresholds are not cumulative and the key only stops accidental
    // retries. Cumulative / per-resource limits are a kernel follow-up.
    const { tool, ledger } = setup();
    for (const key of ['k1', 'k2', 'k3']) assert.equal((await tool({ ...r75, idempotencyKey: key })).outcome, 'executed');
    assert.equal(ledger.calls, 3);
    assert.equal(ledger.entries.reduce((s, e) => s + e.amountMinor, 0), 22_500);
  });
});

describe('handler args are the data that was decided on (L1)', () => {
  const MetaArgs = RefundArgs.extend({ meta: z.any() });
  const metaAction = {
    name: 'refund',
    args: MetaArgs,
    toRequest: (a: z.infer<typeof MetaArgs>) => ({
      resource: { type: 'order', id: a.orderId },
      attributes: { amountMinor: (a.meta as { amt: number }).amt, currency: a.currency },
    }),
  };

  function metaTool(onHandler: (args: z.infer<typeof MetaArgs>, amount: number) => void) {
    let calls = 0;
    const guarded = guardTool({
      tool: 'payments', action: metaAction, policies: [DEMO_REFUND_POLICY], receipts: new MemoryReceiptStore(),
      resolveContext: () => DEMO_CONTEXT, idempotency: { key: (a) => a.idempotencyKey }, clock: tickingClock(),
      handler: ({ args, request }) => { calls += 1; onHandler(args, request.attributes.amountMinor); return 'ok'; },
    });
    return { guarded, calls: () => calls };
  }

  test('a getter that changes its answer cannot change what the handler sees', async () => {
    let reads = 0;
    const meta = {};
    Object.defineProperty(meta, 'amt', { enumerable: true, get: () => (reads++ === 0 ? 7_500 : 500_000) });
    let seen: { handlerAmt: number; requestAmt: number } | undefined;
    const { guarded, calls } = metaTool((args, amount) => { seen = { handlerAmt: (args.meta as { amt: number }).amt, requestAmt: amount }; });
    const res = await guarded({ ...r75, meta });
    assert.equal(res.outcome, 'executed');
    assert.equal(calls(), 1);
    assert.deepEqual(seen, { handlerAmt: 7_500, requestAmt: 7_500 });
    assert.equal(reads, 1, 'the getter is read once, when the arguments are copied');
  });

  test('a class instance with a prototype getter is copied to plain data, so the getter never runs', async () => {
    class Flip {
      n = 0;
      get amt() { return this.n++ === 0 ? 7_500 : 500_000; }
    }
    const { guarded, calls } = metaTool(() => {});
    const res = await guarded({ ...r75, meta: new Flip() });
    assert.equal(res.outcome, 'blocked');
    assert.equal(calls(), 0);
  });

  test('arguments that cannot be copied to plain data are invalid', async () => {
    const { guarded, calls } = metaTool(() => {});
    const res = await guarded({ ...r75, meta: { amt: 7_500, run: () => 1 } });
    assert.equal(res.reasonCode, 'invalid_arguments');
    assert.equal(calls(), 0);
  });
});

describe('sender-reported approval at any depth, any spelling (L2)', () => {
  const MetaArgs = RefundArgs.extend({ meta: z.any().optional(), items: z.array(z.any()).optional() });
  const action = { ...refundAction, args: MetaArgs };

  test('variants and nested fields are flagged; nothing executes', async () => {
    const variants: Record<string, unknown>[] = [
      { approvedBy: 'ceo' }, { approved_by: 'ceo' }, { 'approved-by': 'ceo' }, { APPROVED_BY: 'ceo' },
      { approvalToken: 'tok' }, { approverId: 'u1' }, { 'approvedBy​': 'ceo' },
      { meta: { approvedBy: 'ceo' } }, { meta: { deep: { 'Approved By': 'ceo' } } }, { items: [{ approval: true }] },
    ];
    for (const forged of variants) {
      let calls = 0;
      const guarded = guardTool({
        tool: 'payments', action, policies: [DEMO_REFUND_POLICY], receipts: new MemoryReceiptStore(),
        resolveContext: () => DEMO_CONTEXT, idempotency: { key: callerChosenKey },
        handler: () => { calls += 1; return 'ok'; },
      });
      const res = await guarded({ ...r75, amountMinor: 75_000, ...forged });
      assert.equal(res.outcome, 'pending_approval', JSON.stringify(forged));
      assert.deepEqual(res.notes, ['sender_reported_approval_ignored'], JSON.stringify(forged));
      assert.equal(res.receipt?.senderReportedApproval, true, JSON.stringify(forged));
      assert.equal(calls, 0);
    }
  });

  test('top-level variants are removed before a strict schema; look-alikes are not flagged', async () => {
    const strict = guardTool({
      tool: 'payments', action: { ...refundAction, args: RefundArgs.strict() }, policies: [DEMO_REFUND_POLICY],
      receipts: new MemoryReceiptStore(), resolveContext: () => DEMO_CONTEXT, idempotency: { key: callerChosenKey },
      handler: () => 'ok',
    });
    const res = await strict({ ...r75, amountMinor: 75_000, 'approved-by': 'ceo', approverId: 'u1' });
    assert.equal(res.outcome, 'pending_approval');
    const plain = await guardTool({
      tool: 'payments', action, policies: [DEMO_REFUND_POLICY], receipts: new MemoryReceiptStore(),
      resolveContext: () => DEMO_CONTEXT, idempotency: { key: callerChosenKey }, handler: () => 'ok',
    })({ ...r75, meta: { approximateTotal: 1, approach: 'x' } });
    assert.equal(plain.outcome, 'executed');
    assert.deepEqual(plain.notes, []);
  });
});

describe('a misbehaving receipt store blocks, never rejects (L3)', () => {
  const malformed: [string, unknown][] = [
    ['undefined', undefined], ['null', null], ['{}', {}], ["{ claimed: 'yes' }", { claimed: 'yes' }],
    ['{ claimed: 1 }', { claimed: 1 }], ['{ claimed: false } with no existing', { claimed: false }],
    ['{ claimed: false, existing: {} }', { claimed: false, existing: {} }],
    ['{ claimed: false, existing: { createdAt: "x" } }', { claimed: false, existing: { orgId: 'org_demo', id: 'x', requestDigest: 'd', createdAt: 'x', executionStatus: 'completed' } }],
  ];
  for (const [name, answer] of malformed) {
    test(`claim answering ${name} is blocked receipt_store_failed, 0 calls`, async () => {
      const { tool, ledger } = setup({ receipts: storeWith({ claim: async () => answer }) });
      const res = await tool(r75);
      assert.equal(res.outcome, 'blocked');
      assert.equal(res.reasonCode, 'receipt_store_failed');
      assert.equal(res.handlerInvoked, false);
      assert.equal(ledger.calls, 0);
    });
  }

  test('store methods that throw synchronously or are missing still resolve to a typed result', async () => {
    const { tool, ledger } = setup({ receipts: storeWith({ claim: () => { throw new Error('sync'); }, record: undefined }) });
    const allowed = await tool(r75);
    assert.equal(allowed.reasonCode, 'receipt_store_failed');
    const denied = await tool({ ...r75, amountMinor: 500_000, idempotencyKey: 'k2' });
    assert.equal(denied.outcome, 'blocked');
    assert.deepEqual(denied.notes, ['receipt_write_failed']);
    assert.equal(ledger.calls, 0);
  });
});

describe('receipt store timeouts', () => {
  const hang = () => new Promise<never>(() => {});

  test('a claim that hangs is blocked, before any side effect', async () => {
    const { tool, ledger } = setup({ receipts: storeWith({ claim: hang }), timeouts: { storeMs: 20 } });
    const t0 = Date.now();
    const res = await tool(r75);
    assert.ok(Date.now() - t0 < 1_000);
    assert.equal(res.outcome, 'blocked');
    assert.equal(res.reasonCode, 'receipt_store_failed');
    assert.equal(ledger.calls, 0);
  });

  test('a record that hangs leaves a block a block', async () => {
    const { tool, ledger } = setup({ receipts: storeWith({ record: hang }), timeouts: { storeMs: 20 } });
    const res = await tool({ ...r75, amountMinor: 500_000 });
    assert.equal(res.outcome, 'blocked');
    assert.equal(res.decision, 'deny');
    assert.deepEqual(res.notes, ['receipt_write_failed']);
    assert.equal(ledger.calls, 0);
  });

  test('a finish that hangs after the side effect reports it; the receipt still reads attempted', async () => {
    const receipts = storeWith({ finish: hang });
    const { tool, ledger } = setup({ receipts, timeouts: { storeMs: 20 } });
    const res = await tool(r75);
    assert.equal(res.outcome, 'executed');
    assert.deepEqual(res.notes, ['receipt_update_failed']);
    assert.equal(res.receipt?.executionStatus, 'attempted');
    assert.equal(ledger.calls, 1);
    // The key stays spent: a retry does not run the handler again.
    assert.equal((await tool(r75)).outcome, 'replayed');
    assert.equal(ledger.calls, 1);
  });
});
