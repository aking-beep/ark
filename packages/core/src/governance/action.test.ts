import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ActionAttributes,
  ActionPolicy,
  ActionReasonCode,
  ActionRequest,
  ActionResource,
  ActionRule,
  AmountComparison,
  DEMO_REFUND_POLICY,
  decideAction,
} from './action.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

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

  test('canonical JSON sorts keys, has no whitespace, and refuses non-finite numbers', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } }), '{"a":{"c":null,"d":[1,"x"]},"b":1}');
    assert.throws(() => canonicalJson(Number.NaN));
    assert.throws(() => canonicalJson({ a: Number.POSITIVE_INFINITY }));
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

  test('the module imports only zod and its sha256 wrapper over @noble/hashes; neither touches I/O, clock or randomness', () => {
    const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    const importsOf = (src: string) => [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
    const action = read('./action.js');
    const hash = read('./sha256.js');
    const canon = read('./canonical-json.js');
    assert.deepEqual(importsOf(action), ['./canonical-json.js', './sha256.js', 'zod']);
    assert.deepEqual(importsOf(hash), ['@noble/hashes/sha2', '@noble/hashes/utils']);
    assert.deepEqual(importsOf(canon), []);
    for (const src of [action, hash, canon]) {
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

describe('decideAction — review round 1 / security fixes', () => {
  const FIVE_K = 500_000;

  test('H1: a rule with an unknown key is invalid, not a match-everything rule', () => {
    const malformedRules: unknown[] = [
      { when: {}, effect: 'allow', amountMinor: { lte: 10_000 } },
      { when: { currency: 'USD' }, effect: 'allow', unless: { amountMinor: { gt: 10_000 } } },
    ];
    for (const rule of malformedRules) {
      const bad = { ...structuredClone(DEMO_REFUND_POLICY), rules: [rule] };
      const d = decide(req(FIVE_K), [bad]);
      assert.equal(d.decision, 'unknown', JSON.stringify(rule));
      assert.equal(d.reasonCode, 'policy_invalid');
    }
  });

  test('H1: every object schema in the module is strict', () => {
    const extra = { surprise: true };
    assert.equal(ActionPolicy.safeParse({ ...structuredClone(DEMO_REFUND_POLICY), ...extra }).success, false);
    for (const schema of [ActionRequest, ActionResource, ActionAttributes, ActionRule, AmountComparison]) {
      assert.equal((schema as unknown as { _def: { unknownKeys: string } })._def.unknownKeys, 'strict');
    }
  });

  test('criterion 4 / L3: a present but invalid principal is denied, not dropped', () => {
    for (const principal of [42, { admin: true }, ['user_1'], '', null, true]) {
      const d = decide({ ...req(7_500), principal });
      assert.equal(d.decision, 'deny', JSON.stringify(principal));
      assert.equal(d.reasonCode, 'invalid_request');
      assert.notEqual(d.requestDigest, decide({ ...req(7_500), principal: undefined }).requestDigest);
    }
    const { principal: _p, ...noPrincipal } = req(7_500);
    assert.equal(decide(noPrincipal).decision, 'allow');
    assert.equal(decide({ ...req(7_500), principal: undefined }).decision, 'allow');
  });

  test('M1: decisionId binds policy content, not just id and version', () => {
    const loose = policy({ rules: [{ when: {}, effect: 'allow' }] });
    assert.equal(loose.id, DEMO_REFUND_POLICY.id);
    assert.equal(loose.version, DEMO_REFUND_POLICY.version);
    const a = decide(req(7_500));
    const b = decide(req(7_500), [loose]);
    assert.equal(a.decision, b.decision);
    assert.notEqual(a.policyDigest, b.policyDigest);
    assert.notEqual(a.decisionId, b.decisionId);
    assert.equal(a.policyDigest, sha256Hex(canonicalJson(DEMO_REFUND_POLICY as never)));
  });

  test('M1: decisionId binds expiresAt and every governing policy', () => {
    const longer = policy({ decisionTtlMs: 600_000 });
    assert.notEqual(decide(req(7_500), [longer]).decisionId, decide(req(7_500)).decisionId);
    const second = policy({ id: 'pol_z_second' });
    const both = decide(req(7_500), [DEMO_REFUND_POLICY, second]);
    assert.equal(both.policyId, DEMO_REFUND_POLICY.id);
    assert.notEqual(both.decisionId, decide(req(7_500)).decisionId);
  });

  test('M3: the decision returns the frozen normalized request it was made on', () => {
    const d = decide({ ...req(75_000), role: 'admin', attributes: { amountMinor: 75_000, currency: 'USD', amount: 1 } });
    assert.deepEqual(d.normalizedRequest, req(75_000));
    assert.ok(Object.isFrozen(d.normalizedRequest) && Object.isFrozen(d.normalizedRequest!.attributes));
    assert.equal(d.requestDigest, sha256Hex(canonicalJson(d.normalizedRequest as never)));
    assert.equal(decide(req(-1)).normalizedRequest, null);
  });

  test('M3: a getter that changes value between reads cannot produce allow for the larger amount', () => {
    let reads = 0;
    const attributes = {
      currency: 'USD',
      get amountMinor() {
        reads += 1;
        return reads === 1 ? 100 : 99_999_999;
      },
    };
    const d = decide({ ...req(0), attributes });
    assert.notEqual(d.decision, 'allow');
    assert.equal(d.decision, 'unknown');
    assert.equal(d.reasonCode, 'invalid_request');
    assert.equal(reads, 0, 'accessor is never invoked');
    const outer = { ...req(0) } as Record<string, unknown>;
    Object.defineProperty(outer, 'attributes', { enumerable: true, get: () => ({ amountMinor: 100, currency: 'USD' }) });
    assert.equal(decide(outer).decision, 'unknown');
  });

  test('M3 / L4: inherited and polluted prototype properties are never read', () => {
    const inherited = { ...req(0), attributes: Object.create({ amountMinor: 100, currency: 'USD' }) };
    assert.equal(decide(inherited).reasonCode, 'invalid_amount');
    const { now: _n, ...noNow } = req(7_500);
    const proto = Object.prototype as Record<string, unknown>;
    proto.now = NOW;
    proto.principal = 'user_polluted';
    try {
      assert.equal(decide(noNow).reasonCode, 'invalid_request');
      const ok = decide(req(7_500, { principal: undefined }));
      assert.equal(ok.normalizedRequest?.principal, undefined);
    } finally {
      delete proto.now;
      delete proto.principal;
    }
    class Req {
      constructor(public orgId = 'org_demo') {}
    }
    assert.equal(decide(Object.assign(new Req(), req(7_500))).reasonCode, 'invalid_request');
  });

  test('M3: an unreadable policy (getter, class instance) is policy_invalid', () => {
    const getterPolicy = { ...structuredClone(DEMO_REFUND_POLICY) } as Record<string, unknown>;
    Object.defineProperty(getterPolicy, 'rules', { enumerable: true, get: () => [{ when: {}, effect: 'allow' }] });
    assert.equal(decide(req(FIVE_K), [getterPolicy]).reasonCode, 'policy_invalid');
    const instance = Object.assign(Object.create({ x: 1 }), structuredClone(DEMO_REFUND_POLICY));
    assert.equal(decide(req(7_500), [instance]).reasonCode, 'policy_invalid');
  });

  test('L2: hostile options or inputs return unknown and never throw', () => {
    const throwingOptions = {
      get expectedPolicyVersion(): number {
        throw new Error('boom');
      },
    };
    const proxy = new Proxy(req(7_500), {
      getOwnPropertyDescriptor() {
        throw new Error('trap');
      },
    });
    const cases: [unknown, unknown, unknown][] = [
      [req(7_500), [DEMO_REFUND_POLICY], null],
      [req(7_500), [DEMO_REFUND_POLICY], 'v1'],
      [req(7_500), [DEMO_REFUND_POLICY], throwingOptions],
      [proxy, [DEMO_REFUND_POLICY], undefined],
    ];
    for (const [r, ps, o] of cases) {
      const d = decideAction(r, ps, o);
      assert.equal(d.decision, 'unknown');
      assert.equal(d.reasonCode, 'invalid_request');
      assert.match(d.requestDigest, /^[0-9a-f]{64}$/);
    }
  });

  test('currency is part of the governing key: per-currency limits work, an ungoverned currency is denied', () => {
    const eur = policy({ id: 'pol_eur', currency: 'EUR', rules: [{ when: { amountMinor: { lte: 1_000 } }, effect: 'allow' }] });
    const usd = decide(req(7_500), [DEMO_REFUND_POLICY, eur]);
    assert.equal(usd.decision, 'allow');
    assert.equal(usd.policyId, DEMO_REFUND_POLICY.id);
    const e = decide(req(7_500, { attributes: { amountMinor: 7_500, currency: 'EUR' } }), [DEMO_REFUND_POLICY, eur]);
    assert.equal(e.decision, 'deny');
    assert.equal(e.reasonCode, 'default_deny');
    assert.equal(e.policyId, 'pol_eur');
    const gbp = decide(req(7_500, { attributes: { amountMinor: 7_500, currency: 'GBP' } }), [DEMO_REFUND_POLICY, eur]);
    assert.equal(gbp.reasonCode, 'currency_mismatch');
  });

  test('two versions of one policy id together, unpinned, are a conflict, not two policies', () => {
    const v2 = policy({ version: 2 });
    for (const set of [[DEMO_REFUND_POLICY, v2], [v2, DEMO_REFUND_POLICY]]) {
      const d = decide(req(7_500), set);
      assert.equal(d.decision, 'unknown');
      assert.equal(d.reasonCode, 'policy_conflict');
    }
    assert.equal(decide(req(7_500), [DEMO_REFUND_POLICY, structuredClone(DEMO_REFUND_POLICY)]).decision, 'allow');
  });
});

describe('decideAction — security re-review (round 2) fixes', () => {
  const FIVE_K = 500_000;
  const demoJson = JSON.stringify(DEMO_REFUND_POLICY);
  /** JSON text with an extra leading member, parsed by JSON.parse (own `__proto__` key). */
  const withLeading = (json: string, member: string) => JSON.parse(`{${member},${json.slice(1)}`);

  test('R-L1: a __proto__ / constructor / prototype key in a policy is policy_invalid', () => {
    const bad: unknown[] = [
      withLeading(demoJson, '"__proto__":"x"'),
      withLeading(demoJson, '"constructor":{}'),
      withLeading(demoJson, '"prototype":{}'),
    ];
    const { decisionTtlMs: _t, ...noTtl } = structuredClone(DEMO_REFUND_POLICY);
    bad.push(withLeading(JSON.stringify(noTtl), '"__proto__":{"decisionTtlMs":86400000}'));
    const rule = JSON.parse('{"__proto__":{"unless":1},"when":{},"effect":"allow"}');
    bad.push({ ...structuredClone(DEMO_REFUND_POLICY), rules: [rule] });
    for (const p of bad) {
      const d = decide(req(7_500), [p]);
      assert.equal(d.decision, 'unknown');
      assert.equal(d.reasonCode, 'policy_invalid');
    }
  });

  test('R-L1: a __proto__ key anywhere in the request is unknown invalid_request', () => {
    const base = JSON.stringify(req(7_500));
    const { now: _n, ...noNow } = req(7_500);
    const cases = [
      withLeading(base, '"__proto__":{"role":"admin"}'),
      withLeading(JSON.stringify(noNow), `"__proto__":{"now":${NOW}}`),
      { ...req(7_500), attributes: JSON.parse('{"__proto__":{},"amountMinor":7500,"currency":"USD"}') },
      { ...req(7_500), resource: JSON.parse('{"__proto__":{},"type":"order","id":"o"}') },
    ];
    for (const c of cases) {
      const d = decide(c);
      assert.equal(d.decision, 'unknown');
      assert.equal(d.reasonCode, 'invalid_request');
    }
  });

  test('R-L2: symbol-keyed or non-enumerable properties are rejected, not ignored', () => {
    const hiddenRule = { when: {}, effect: 'allow' };
    Object.defineProperty(hiddenRule, 'unless', { value: { amountMinor: { gt: 10_000 } }, enumerable: false });
    const symbolRule = { when: {}, effect: 'allow', [Symbol('unless')]: { amountMinor: { gt: 10_000 } } };
    for (const rule of [hiddenRule, symbolRule]) {
      const d = decide(req(FIVE_K), [{ ...structuredClone(DEMO_REFUND_POLICY), rules: [rule] }]);
      assert.equal(d.decision, 'unknown');
      assert.equal(d.reasonCode, 'policy_invalid');
    }
    const hiddenReq = { ...req(7_500) };
    Object.defineProperty(hiddenReq, 'role', { value: 'admin', enumerable: false });
    for (const r of [hiddenReq, { ...req(7_500), [Symbol('role')]: 'admin' }]) {
      assert.equal(decide(r).decision, 'unknown');
      assert.equal(decide(r).reasonCode, 'invalid_request');
    }
    const extraArrayKey = Object.assign([structuredClone(DEMO_REFUND_POLICY.rules[0])], { x: 1 });
    assert.equal(decide(req(7_500), [{ ...structuredClone(DEMO_REFUND_POLICY), rules: extraArrayKey }]).reasonCode, 'policy_invalid');
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [structuredClone(DEMO_REFUND_POLICY.rules[0]), , structuredClone(DEMO_REFUND_POLICY.rules[2])];
    assert.equal(decide(req(7_500), [{ ...structuredClone(DEMO_REFUND_POLICY), rules: sparse }]).reasonCode, 'policy_invalid');
  });

  test('R-L3: over-limit inputs fail closed fast, before validation, and never throw', () => {
    const rule = structuredClone(DEMO_REFUND_POLICY.rules[0]);
    const huge = { ...structuredClone(DEMO_REFUND_POLICY), rules: new Array(1_000_000).fill(rule) };
    const t0 = performance.now();
    const d = decide(req(7_500), [huge]);
    assert.ok(performance.now() - t0 < 500, 'a 1e6-rule policy is rejected without copying it');
    assert.equal(d.reasonCode, 'policy_invalid');
    assert.equal(decide(req(7_500), [{ ...structuredClone(DEMO_REFUND_POLICY), rules: new Array(65).fill(rule) }]).reasonCode, 'policy_invalid');
    assert.equal(decide(req(7_500), [{ ...structuredClone(DEMO_REFUND_POLICY), rules: new Array(64).fill(rule) }]).decision, 'allow');
    assert.equal(decide(req(7_500), new Array(257).fill(DEMO_REFUND_POLICY)).reasonCode, 'policy_invalid');
    assert.equal(decide(req(7_500), new Array(256).fill(DEMO_REFUND_POLICY)).decision, 'allow');
    const wide: Record<string, unknown> = { ...structuredClone(DEMO_REFUND_POLICY) };
    for (let i = 0; i < 64; i++) wide[`k${i}`] = 1;
    assert.equal(decide(req(7_500), [wide]).reasonCode, 'policy_invalid');
    const wideReq: Record<string, unknown> = { ...req(7_500) };
    for (let i = 0; i < 64; i++) wideReq[`k${i}`] = 1;
    assert.equal(decide(wideReq).decision, 'unknown');
    let deep: unknown = { amountMinor: { lte: 1 } };
    for (let i = 0; i < 100_000; i++) deep = { when: deep };
    assert.equal(decide(req(7_500), [{ ...structuredClone(DEMO_REFUND_POLICY), rules: [deep] }]).reasonCode, 'policy_invalid');
  });

  test('R-L3: the shortest TTL is found without spreading into Math.min', () => {
    const many = Array.from({ length: 200 }, (_, i) => policy({ id: `pol_${String(i).padStart(3, '0')}`, decisionTtlMs: 1_000 + i }));
    const d = decide(req(7_500), many);
    assert.equal(d.decision, 'allow');
    assert.equal(d.expiresAt, NOW + 1_000);
  });

  test('M3: through a Proxy, each request property descriptor is read exactly once', () => {
    const reads = new Map<string, number>();
    const counted = <T extends object>(target: T): T =>
      new Proxy(target, {
        getOwnPropertyDescriptor(t, k) {
          reads.set(String(k), (reads.get(String(k)) ?? 0) + 1);
          return Reflect.getOwnPropertyDescriptor(t, k);
        },
      });
    const r = req(7_500);
    const d = decide(counted({ ...r, resource: counted({ ...r.resource }), attributes: counted({ ...r.attributes }) }));
    assert.equal(d.decision, 'allow');
    for (const k of ['orgId', 'agentId', 'principal', 'tool', 'action', 'resource', 'attributes', 'now', 'type', 'id', 'amountMinor', 'currency']) {
      assert.equal(reads.get(k), 1, k);
    }
  });
});
