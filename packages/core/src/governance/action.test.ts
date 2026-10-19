import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ActionPolicy,
  ActionReasonCode,
  DEMO_REFUND_POLICY,
  canonicalJson,
  decideAction,
  type ActionRequest,
} from './action.js';

const NOW = 1_760_000_000_000;

function req(amountMinor: number, overrides: Partial<ActionRequest> = {}): ActionRequest {
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

function policy(overrides: Record<string, unknown> = {}): ActionPolicy {
  return ActionPolicy.parse({ ...structuredClone(DEMO_REFUND_POLICY), ...overrides });
}

const decide = (r: unknown, ps: unknown[] = [DEMO_REFUND_POLICY], opts = {}) => decideAction(r, ps, opts);

describe('decideAction — demo refund boundaries', () => {
  test('10000 minor units ($100.00) is allow, with expiry', () => {
    const d = decide(req(10_000));
    assert.equal(d.decision, 'allow');
    assert.equal(d.reasonCode, 'rule_matched');
    assert.equal(d.policyId, DEMO_REFUND_POLICY.id);
    assert.equal(d.policyVersion, 1);
    assert.equal(d.expiresAt, NOW + DEMO_REFUND_POLICY.decisionTtlMs);
  });

  test('10001 ($100.01) is require_approval, with expiry', () => {
    const d = decide(req(10_001));
    assert.equal(d.decision, 'require_approval');
    assert.equal(d.expiresAt, NOW + DEMO_REFUND_POLICY.decisionTtlMs);
  });

  test('100000 ($1,000.00) is require_approval', () => {
    assert.equal(decide(req(100_000)).decision, 'require_approval');
  });

  test('100001 ($1,000.01) is deny, with no expiry', () => {
    const d = decide(req(100_001));
    assert.equal(d.decision, 'deny');
    assert.equal(d.expiresAt, undefined);
  });

  test('0 is allow; the demo policy is frozen', () => {
    assert.equal(decide(req(0)).decision, 'allow');
    assert.ok(Object.isFrozen(DEMO_REFUND_POLICY));
    assert.ok(Object.isFrozen(DEMO_REFUND_POLICY.rules[0]));
  });
});

describe('decideAction — fail closed on policies', () => {
  test('no policy at all is unknown', () => {
    const d = decide(req(7_500), []);
    assert.equal(d.decision, 'unknown');
    assert.equal(d.reasonCode, 'no_matching_policy');
    assert.equal(d.policyId, null);
    assert.equal(d.expiresAt, undefined);
  });

  test('no policy for this tool/action is unknown', () => {
    assert.equal(decide(req(7_500, { tool: 'crm' })).reasonCode, 'no_matching_policy');
    assert.equal(decide(req(7_500, { action: 'charge' })).decision, 'unknown');
  });

  test("another org's policy is never matched", () => {
    const d = decide(req(7_500, { orgId: 'org_other' }));
    assert.equal(d.decision, 'unknown');
    assert.equal(d.reasonCode, 'no_matching_policy');
  });

  test('an invalid policy that claims this action is unknown, not a fallback', () => {
    const invalids: unknown[] = [
      { ...structuredClone(DEMO_REFUND_POLICY), defaultEffect: 'allow' },
      { ...structuredClone(DEMO_REFUND_POLICY), rules: [] },
      { ...structuredClone(DEMO_REFUND_POLICY), rules: [{ when: { role: 'admin' }, effect: 'allow' }] },
      { ...structuredClone(DEMO_REFUND_POLICY), version: '1' },
      { id: 'pol_x' },
      null,
      'allow',
    ];
    for (const bad of invalids) {
      const d = decide(req(7_500), [bad]);
      assert.equal(d.decision, 'unknown', JSON.stringify(bad));
      assert.equal(d.reasonCode, 'policy_invalid');
    }
    // Also when a valid allowing policy sits beside it.
    assert.equal(decide(req(7_500), [DEMO_REFUND_POLICY, invalids[0]]).decision, 'unknown');
  });

  test('a policies argument that is not an array is unknown', () => {
    assert.equal(decideAction(req(7_500), { 0: DEMO_REFUND_POLICY }).reasonCode, 'policy_invalid');
  });

  test('an invalid policy plainly for another org does not poison this decision', () => {
    const elsewhere = { ...structuredClone(DEMO_REFUND_POLICY), orgId: 'org_other', defaultEffect: 'allow' };
    assert.equal(decide(req(7_500), [DEMO_REFUND_POLICY, elsewhere]).decision, 'allow');
  });

  test('two governing policies with conflicting effects deny', () => {
    const strict = policy({ id: 'pol_strict', rules: [{ when: {}, effect: 'require_approval' }] });
    const d = decide(req(7_500), [DEMO_REFUND_POLICY, strict]);
    assert.equal(d.decision, 'deny');
    assert.equal(d.reasonCode, 'policy_conflict');
    assert.equal(d.expiresAt, undefined);
  });

  test('agreeing policies decide, and the shortest TTL bounds expiry', () => {
    const short = policy({ id: 'pol_a_short', decisionTtlMs: 1_000 });
    const d = decide(req(7_500), [DEMO_REFUND_POLICY, short]);
    assert.equal(d.decision, 'allow');
    assert.equal(d.policyId, 'pol_a_short');
    assert.equal(d.expiresAt, NOW + 1_000);
  });

  test('policy order does not change the decision or id', () => {
    const other = policy({ id: 'pol_a_other' });
    const a = decide(req(7_500), [DEMO_REFUND_POLICY, other]);
    const b = decide(req(7_500), [other, DEMO_REFUND_POLICY]);
    assert.deepEqual(a, b);
  });

  test('no rule matching falls to default deny', () => {
    const narrow = policy({ rules: [{ when: { amountMinor: { lt: 100 } }, effect: 'allow' }] });
    const d = decide(req(7_500), [narrow]);
    assert.equal(d.decision, 'deny');
    assert.equal(d.reasonCode, 'default_deny');
  });

  test('expectedPolicyVersion mismatch is unknown policy_version_mismatch', () => {
    const d = decide(req(7_500), [DEMO_REFUND_POLICY], { expectedPolicyVersion: 2 });
    assert.equal(d.decision, 'unknown');
    assert.equal(d.reasonCode, 'policy_version_mismatch');
    assert.equal(d.expiresAt, undefined);
    assert.equal(decide(req(7_500), [DEMO_REFUND_POLICY], { expectedPolicyVersion: 1 }).decision, 'allow');
  });
});

describe('decideAction — fail closed on the request', () => {
  test('negative, non-integer and non-finite amounts deny invalid_amount', () => {
    for (const amountMinor of [-1, 10.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const d = decide(req(amountMinor));
      assert.equal(d.decision, 'deny', String(amountMinor));
      assert.equal(d.reasonCode, 'invalid_amount');
    }
    const asString = { ...req(0), attributes: { amountMinor: '7500', currency: 'USD' } };
    assert.equal(decide(asString).reasonCode, 'invalid_amount');
    const missing = { ...req(0), attributes: { currency: 'USD' } };
    assert.equal(decide(missing).reasonCode, 'invalid_amount');
  });

  test('missing or malformed currency denies invalid_currency', () => {
    for (const attributes of [{ amountMinor: 7_500 }, { amountMinor: 7_500, currency: 'usd' }, { amountMinor: 7_500, currency: 'US' }]) {
      const d = decide({ ...req(0), attributes });
      assert.equal(d.decision, 'deny');
      assert.equal(d.reasonCode, 'invalid_currency');
    }
  });

  test('a currency the policy does not govern denies currency_mismatch', () => {
    const d = decide(req(7_500, { attributes: { amountMinor: 7_500, currency: 'EUR' } }));
    assert.equal(d.decision, 'deny');
    assert.equal(d.reasonCode, 'currency_mismatch');
    assert.equal(d.policyId, DEMO_REFUND_POLICY.id);
  });

  test('missing resource denies resource_missing', () => {
    const { resource: _r, ...noResource } = req(7_500);
    assert.equal(decide(noResource).reasonCode, 'resource_missing');
    assert.equal(decide({ ...req(7_500), resource: { type: 'order' } }).decision, 'deny');
    assert.equal(decide({ ...req(7_500), resource: { type: 'order', id: '' } }).reasonCode, 'resource_missing');
  });

  test('missing identity or time denies invalid_request', () => {
    for (const bad of [{ ...req(7_500), orgId: '' }, { ...req(7_500), agentId: undefined }, { ...req(7_500), now: Number.NaN }, null, 'x']) {
      const d = decide(bad);
      assert.equal(d.decision, 'deny');
      assert.equal(d.reasonCode, 'invalid_request');
    }
  });

  test('a forged role or permissions field changes nothing', () => {
    for (const amount of [7_500, 75_000, 500_000]) {
      const plain = decide(req(amount));
      const forged = decide({
        ...req(amount),
        role: 'admin',
        permissions: ['*', 'refund:unlimited'],
        attributes: { amountMinor: amount, currency: 'USD', role: 'admin', approved: true },
        resource: { type: 'order', id: 'ord_1001', owner: 'me' },
      });
      assert.deepEqual(forged, plain);
    }
  });
});

describe('decideAction — determinism and purity', () => {
  test('same input gives the same decisionId and digest', () => {
    const a = decide(req(75_000));
    const b = decide(structuredClone(req(75_000)));
    assert.equal(a.decisionId, b.decisionId);
    assert.equal(a.requestDigest, b.requestDigest);
    assert.match(a.requestDigest, /^[0-9a-f]{64}$/);
    assert.match(a.decisionId, /^[0-9a-f]{64}$/);
  });

  test('key order in the input does not change the digest', () => {
    const r = req(75_000);
    const reordered = {
      now: r.now,
      attributes: { currency: 'USD', amountMinor: 75_000 },
      resource: { id: 'ord_1001', type: 'order' },
      action: r.action,
      tool: r.tool,
      principal: r.principal,
      agentId: r.agentId,
      orgId: r.orgId,
    };
    assert.equal(decide(reordered).requestDigest, decide(r).requestDigest);
  });

  test('different input gives a different digest', () => {
    const base = decide(req(75_000)).requestDigest;
    const variants = [
      req(75_001),
      req(75_000, { resource: { type: 'order', id: 'ord_1002' } }),
      req(75_000, { agentId: 'agent_other' }),
      req(75_000, { principal: 'user_43' }),
      req(75_000, { now: NOW + 1 }),
    ];
    for (const v of variants) assert.notEqual(decide(v).requestDigest, base);
  });

  test('decisionId changes with policy version for the same request', () => {
    const v2 = policy({ version: 2 });
    assert.notEqual(decide(req(7_500), [v2]).decisionId, decide(req(7_500)).decisionId);
    assert.equal(decide(req(7_500), [v2]).requestDigest, decide(req(7_500)).requestDigest);
  });

  test('different outcomes for the same request and policy never share a decisionId', () => {
    const allow = decide(req(7_500));
    const mismatch = decide(req(7_500), [DEMO_REFUND_POLICY], { expectedPolicyVersion: 2 });
    const strict = policy({ id: 'pol_z_strict', rules: [{ when: {}, effect: 'require_approval' }] });
    const conflict = decide(req(7_500), [DEMO_REFUND_POLICY, strict]);
    assert.equal(allow.policyId, mismatch.policyId);
    assert.equal(allow.policyId, conflict.policyId);
    assert.equal(new Set([allow.decisionId, mismatch.decisionId, conflict.decisionId]).size, 3);
  });

  test('canonical JSON sorts keys and has no whitespace', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } }), '{"a":{"c":null,"d":[1,"x"]},"b":1}');
  });

  test('synchronous, and reads no clock, randomness or network', () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    const realFetch = globalThis.fetch;
    const trap = (what: string) => () => {
      throw new Error(`${what} called inside decideAction`);
    };
    Date.now = trap('Date.now');
    Math.random = trap('Math.random');
    globalThis.fetch = trap('fetch') as unknown as typeof fetch;
    try {
      const d = decide(req(75_000));
      assert.ok(!(d instanceof Promise));
      assert.equal(d.decision, 'require_approval');
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
      globalThis.fetch = realFetch;
    }
  });

  test('the module imports only zod and its own sha256; neither touches I/O, clock or randomness', () => {
    const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    const importsOf = (src: string) => [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
    const action = read('./action.js');
    const hash = read('./sha256.js');
    assert.deepEqual(importsOf(action), ['./sha256.js', 'zod']);
    assert.deepEqual(importsOf(hash), []);
    for (const src of [action, hash]) {
      assert.ok(!/\bDate\b|Math\.random|\bfetch\(|process\.|require\(|import\(/.test(src));
    }
  });

  test('every returned reasonCode is in the closed enum, and no path allows without a rule', () => {
    const cases: unknown[] = [req(0), req(10_001), req(500_000), req(-1), req(7_500, { tool: 'x' }), null];
    for (const c of cases) {
      const d = decide(c);
      assert.ok(ActionReasonCode.options.includes(d.reasonCode));
      if (d.decision === 'allow') assert.equal(d.reasonCode, 'rule_matched');
    }
  });
});
