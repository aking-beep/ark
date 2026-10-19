import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ArkIngest } from '@ark/sdk';
import { openActionReceiptStore } from '@ark/db';
import { runRefundScenarios } from './scenarios.js';

/**
 * `npm run demo:guard` — the synthetic refund scenarios through `guardTool`,
 * with receipts in a temporary libSQL database. No network: the global `fetch`
 * is replaced by one that throws and counts, and telemetry goes to an
 * `@ark/sdk` client whose transport always fails, to show it changes nothing.
 */

let networkCalls = 0;
globalThis.fetch = (async () => {
  networkCalls += 1;
  throw new Error('network disabled in the guard demo');
}) as typeof fetch;

const dir = mkdtempSync(path.join(tmpdir(), 'ark-guard-demo-'));
const { store, close } = await openActionReceiptStore(`file:${path.join(dir, 'receipts.db')}`);

let telemetryPosts = 0;
const ingest = new ArkIngest({
  baseUrl: 'http://control.invalid',
  fetch: (async () => {
    telemetryPosts += 1;
    throw new Error('telemetry transport down (synthetic)');
  }) as typeof fetch,
});
const trace = ingest.trace('wl_refund_demo', 'tr_guard_demo');

const { rows, ledger } = await runRefundScenarios({ receipts: store, telemetry: trace });

const usd = (minor: number | null) => (minor === null ? '-' : `$${(minor / 100).toFixed(2)}`);
console.log('guarded refund_order — synthetic, DEMO_REFUND_POLICY (<= $100 allow, <= $1,000 approval, else deny)');
console.log(`receipts: temporary libSQL database (${path.basename(dir)}/receipts.db)`);
console.log('');
for (const { name, expected, result, calls } of rows) {
  const notes = result.notes.length ? ` notes=${result.notes.join(',')}` : '';
  console.log(
    `${name.padEnd(36)} outcome=${result.outcome.padEnd(16)} decision=${String(result.decision).padEnd(16)} ` +
      `reason=${result.reasonCode.padEnd(19)} execution=${result.executionStatus.padEnd(15)} calls(this)=${calls}${notes}`,
  );
  console.log(`${''.padEnd(36)} expected: ${expected}`);
  const r = result.receipt;
  if (r) {
    console.log(
      `${''.padEnd(36)} receipt: org=${r.orgId} id=${r.id.slice(0, 16)}… agent=${r.agentId} principal=${r.principal} ` +
        `${r.tool}.${r.action} ${r.resourceType}:${r.resourceId} ${usd(r.amountMinor)} ${r.currency ?? '-'} ` +
        `policy=${r.policyId ?? '-'}@${r.policyVersion ?? '-'} decision=${r.decision} reason=${r.reasonCode} ` +
        `execution=${r.executionStatus} key_hash=${r.idempotencyKeyHash?.slice(0, 12) ?? '-'}… ` +
        `sender_reported_approval=${r.senderReportedApproval} digest=${r.requestDigest.slice(0, 12)}…`,
    );
  }
  if (result.outcome === 'replayed') {
    console.log(`${''.padEnd(36)} original: id=${result.original.id.slice(0, 16)}… execution=${result.original.executionStatus}`);
  }
}

let telemetry = 'flushed';
try {
  await trace.flush();
} catch (err) {
  telemetry = `flush failed (${(err as Error).message}) — no decision or execution changed`;
}

const stored = [...(await store.list('org_demo')), ...(await store.list('org_other'))];
const refunded = ledger.entries.reduce((s, e) => s + e.amountMinor, 0);
const pair = rows.filter((r) => r.name === '$75' || r.name.startsWith('$75 replayed')).reduce((s, r) => s + r.calls, 0);
console.log('');
console.log(`handler calls: ${ledger.calls}`);
console.log(`ledger entries: ${ledger.entries.length}, refunded: ${usd(refunded)}`);
console.log(`$5,000 executed: ${ledger.entries.some((e) => e.orderId === 'ord_1003')}`);
console.log(`forged approval executed: ${ledger.entries.some((e) => e.orderId === 'ord_1006')}`);
console.log(`$75 + replay handler calls: ${pair}`);
console.log(`receipts written: ${stored.length}`);
console.log(`telemetry: ${telemetryPosts} post attempt(s), ${telemetry}`);
console.log(`network calls outside telemetry: ${networkCalls}`);

close();
rmSync(dir, { recursive: true, force: true });
