// Measurement for specs/action-decision-kernel.md.
// Prints the decision table for the synthetic DEMO_REFUND_POLICY against the
// built @ark/core dist. Run from the repo root after `npm run build:packages`:
//
//   node evidence/action-decision-kernel/decide-demo.mjs
//
// Network/model calls are counted by wrapping globalThis.fetch; every decision
// is computed with Date.now and Math.random replaced by throwing stubs, so a
// clock read or randomness inside the kernel would crash this script.
import { decideAction, DEMO_REFUND_POLICY } from '../../packages/core/dist/index.js';

let networkCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  networkCalls += 1;
  return realFetch(...args);
};

const NOW = 1_760_000_000_000; // fixed request time (ms), supplied by the caller

function request(amountMinor, overrides = {}) {
  return {
    orgId: 'org_demo',
    agentId: 'agent_support_refunds',
    principal: 'user_42',
    tool: 'payments',
    action: 'refund',
    resource: { type: 'order', id: 'ord_1001' },
    attributes: { amountMinor, currency: 'USD' },
    now: NOW,
    ...overrides,
  };
}

const rows = [
  ['$75.00', request(7_500)],
  ['$100.00', request(10_000)],
  ['$100.01', request(10_001)],
  ['$750.00', request(75_000)],
  ['$1,000.00', request(100_000)],
  ['$1,000.01', request(100_001)],
  ['$5,000.00', request(500_000)],
  ['unknown tool ($75, tool=crm)', request(7_500, { tool: 'crm' })],
  ["another org's policy ($75, org_other)", request(7_500, { orgId: 'org_other' })],
  ['forged role ($5,000 + role=admin, permissions=[*])', { ...request(500_000), role: 'admin', permissions: ['*'] }],
  ['version mismatch ($75, expected v2)', request(7_500), { expectedPolicyVersion: 2 }],
  // Added after security review H1: a rule with a key the schema does not know
  // (a condition at the wrong level) must invalidate the policy, not match everything.
  [
    'malformed rule ($5,000, amountMinor beside when)',
    request(500_000),
    undefined,
    [{ ...structuredClone(DEMO_REFUND_POLICY), rules: [{ when: {}, effect: 'allow', amountMinor: { lte: 10_000 } }] }],
  ],
];

const realNow = Date.now;
const realRandom = Math.random;
const results = rows.map(([label, req, opts, policies = [DEMO_REFUND_POLICY]]) => {
  Date.now = () => {
    throw new Error('clock read inside decideAction');
  };
  Math.random = () => {
    throw new Error('randomness inside decideAction');
  };
  try {
    return [label, decideAction(req, policies, opts)];
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
});

console.log(`policy ${DEMO_REFUND_POLICY.id} v${DEMO_REFUND_POLICY.version} (SYNTHETIC demo policy, not a production default)`);
console.log('');
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('case', 52)}${pad('decision', 18)}${pad('reasonCode', 26)}${pad('expiresAt', 15)}decisionId`);
for (const [label, d] of results) {
  console.log(
    `${pad(label, 52)}${pad(d.decision, 18)}${pad(d.reasonCode, 26)}${pad(d.expiresAt ?? '-', 15)}${d.decisionId.slice(0, 16)}`,
  );
}
console.log('');
const forged = results[9][1];
const plain = decideAction(request(500_000), [DEMO_REFUND_POLICY]);
console.log(`forged-role digest equals plain $5,000 digest: ${forged.requestDigest === plain.requestDigest}`);
const again = decideAction(request(75_000), [DEMO_REFUND_POLICY]);
console.log(`same input, same decisionId: ${again.decisionId === results[3][1].decisionId}`);
console.log(`allow decisions: ${results.filter(([, d]) => d.decision === 'allow').length} of ${results.length}`);
console.log(`network/model calls made: ${networkCalls}`);
