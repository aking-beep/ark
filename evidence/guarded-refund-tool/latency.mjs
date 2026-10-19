// Guard overhead per call, for the definition-of-done latency line.
//   node evidence/guarded-refund-tool/latency.mjs
// 500 allowed $75 refunds with distinct keys (decide + claim + finish) and 500
// denied $5,000 refunds (decide + one insert), against the in-memory store and a
// temporary libSQL file. Synthetic handler; no network. Wall-clock, one machine.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryReceiptStore } from '@ark/guard';
import { openActionReceiptStore } from '@ark/db';
import { RefundLedger, guardedRefundTool } from '../../packages/guard/dist/demo/refund.js';

const N = 500;
async function measure(label, receipts) {
  const ledger = new RefundLedger();
  const tool = guardedRefundTool({ ledger, receipts });
  for (const [kind, amountMinor] of [['allow', 7_500], ['deny', 500_000]]) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      await tool({ orderId: `ord_${kind}_${i}`, amountMinor, currency: 'USD', idempotencyKey: `${label}-${kind}-${i}` });
    }
    const ms = (performance.now() - t0) / N;
    console.log(`${label.padEnd(8)} ${kind.padEnd(5)} ${ms.toFixed(3)} ms/call (n=${N})`);
  }
  if (ledger.calls !== N) throw new Error(`expected ${N} handler calls, got ${ledger.calls}`);
}

await measure('memory', new MemoryReceiptStore());
const dir = mkdtempSync(path.join(tmpdir(), 'ark-guard-latency-'));
const { store, close } = await openActionReceiptStore(`file:${path.join(dir, 'r.db')}`);
await measure('libsql', store);
close();
rmSync(dir, { recursive: true, force: true });
