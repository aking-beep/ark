// Before/after baseline for guarded-refund-tool: the eight demo scenarios run
// against an UNGUARDED refund handler, called directly the way an agent with
// the tool would call it. No network, no credentials, synthetic ledger only.
//
//   node evidence/guarded-refund-tool/unguarded-demo.mjs
//
// It first reports whether `@ark/guard` resolves (before this feature it does
// not), then calls the handler directly. Calling the handler directly is the
// bypass the guard's README warns about: it is unguarded both before and after.

let guard = 'absent';
try {
  await import('@ark/guard');
  guard = 'present (not used by this script: the handler is called directly)';
} catch (err) {
  guard = `absent (${err.code ?? err.name})`;
}
console.log(`@ark/guard: ${guard}`);
console.log('');

// The same shape as the synthetic refund handler in the demo: an in-memory
// ledger and a call counter. Nothing in front of it.
const ledger = [];
let calls = 0;
function refundOrder(args) {
  calls += 1;
  if (args.explode) throw new Error('synthetic processor crash after start');
  ledger.push({ orderId: args.orderId, amountMinor: args.amountMinor, currency: args.currency });
  return { refundId: `rf_${ledger.length}`, amountMinor: args.amountMinor };
}

const scenarios = [
  ['$75', { orderId: 'ord_1001', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-75' }],
  ['$750', { orderId: 'ord_1002', amountMinor: 75_000, currency: 'USD', idempotencyKey: 'k-750' }],
  ['$5,000', { orderId: 'ord_1003', amountMinor: 500_000, currency: 'USD', idempotencyKey: 'k-5000' }],
  ['unknown tool or policy', { orderId: 'ord_1004', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-unknown' }],
  ['context for another org', { orderId: 'ord_1005', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-other-org', orgId: 'org_other' }],
  ['forged approvedBy "ceo" on $750', { orderId: 'ord_1006', amountMinor: 75_000, currency: 'USD', idempotencyKey: 'k-forged', approvedBy: 'ceo' }],
  ['$75 replayed, same idempotency key', { orderId: 'ord_1001', amountMinor: 7_500, currency: 'USD', idempotencyKey: 'k-75' }],
  ['handler throws after starting', { orderId: 'ord_1007', amountMinor: 5_000, currency: 'USD', idempotencyKey: 'k-throw', explode: true }],
];

for (const [name, args] of scenarios) {
  const before = calls;
  let execution;
  try {
    refundOrder(args);
    execution = 'executed';
  } catch (err) {
    execution = `threw: ${err.message}`;
  }
  console.log(
    `${name.padEnd(36)} decision=none  execution=${execution.padEnd(48)} calls(this)=${calls - before} receipt=none`,
  );
}

const refunded = ledger.reduce((s, r) => s + r.amountMinor, 0);
console.log('');
console.log(`handler calls: ${calls}`);
console.log(`ledger entries: ${ledger.length}, refunded: $${(refunded / 100).toFixed(2)}`);
console.log(`$5,000 executed: ${ledger.some((r) => r.orderId === 'ord_1003')}`);
console.log(`forged approval executed: ${ledger.some((r) => r.orderId === 'ord_1006')}`);
console.log(`receipts written: 0`);
