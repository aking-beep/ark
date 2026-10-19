# Security review: action-decision-kernel

**Reviewer:** security reviewer (separate pass, `agents/security-reviewer.md`, under `factory/GOVERNANCE.md`)
**Scope:** `git diff edba21e..HEAD` on `worktree-agent-ac3c0e84c9752c454`. Mainly
`packages/core/src/governance/action.ts`, `sha256.ts`, `packages/core/package.json`
and `package-lock.json`. Checked against `specs/action-decision-kernel.md`.
**Date:** 2026-10-19
**Method:** read the code, then attacked the built dist (`npm run build:packages`; core tests 200/200 pass) with
two node scripts. They are kept outside the repo, in the reviewer scratchpad:
`secreview-kernel/attack.mjs` (61 cases) and `secreview-kernel/digest.mjs` (canonical JSON and decisionId properties).

## Verdict: BLOCK

There is one **high** finding. A policy can fail schema validation in a way that
should give `unknown`, and the kernel instead returns `allow` for an unbounded refund.
The spec makes schema-invalid policies fail closed, and this breaks that rule. The fix is one line.
After it lands (with a test), this becomes **approve with notes**. The medium findings
must be resolved, or recorded as accepted constraints, before anything calls the
kernel to authorize money movement.

---

## High

### H1. Unknown keys on a rule are silently stripped, so a malformed policy fails open to `allow`

**File:** `packages/core/src/governance/action.ts:68-71`

```ts
export const ActionRule = z.object({
  when: z.object({ ... }).strict(),
  effect: ActionEffect,
});            // <- not .strict(): zod's default is to strip unknown keys
```

`ActionPolicy` (line 90), `when` (line 69) and `AmountComparison` (line 64) are all
`.strict()`. The rule object between them is not. Zod therefore drops unknown keys
on a rule and accepts it as valid. If an author puts a condition at the wrong level,
or uses a key the schema does not have, the rule becomes `when: {}`. That rule
matches every amount.

**Repro** (`attack.mjs`, run against the dist):

```js
decideAction(
  { ...base, attributes: { amountMinor: 500000, currency: 'USD' } },   // $5,000
  [{ ...DEMO_REFUND_POLICY, rules: [{ when: {}, effect: 'allow', amountMinor: { lte: 10000 } }] }],
);
// -> allow | rule_matched        (expected: unknown | policy_invalid)

// same with { when: { currency: 'USD' }, effect: 'allow', unless: { amountMinor: { gt: 10000 } } }
// -> allow | rule_matched
```

This contradicts spec AC 3: "policy invalid or failing schema → `unknown`". The
strictness on the other levels exists to catch exactly this kind of authoring
mistake, and it is missing at the one level where a mistake turns a cap into "allow everything".

**Fix:** add `.strict()` to `ActionRule`. Add a test showing that a rule with an extra
key yields `unknown` / `policy_invalid`. While there, consider L1 below (rejecting
match-all `allow` rules).

---

## Medium

### M1. `decisionId` does not commit to policy content, `expiresAt`, or the non-first governing policies

**File:** `action.ts:279`. The preimage is `{decision, policyId, policyVersion, reasonCode, requestDigest}`.

Repro (`digest.mjs`): one request evaluated under the demo policy, and again under a
policy with the **same id and version** but `rules: [{when:{}, effect:'allow'}]` and a
24h TTL. Both produce the **same `decisionId`**, with different `expiresAt` values
(`1700000300000` and `1700086400000`). When several policies agree, the id and
`policyId` name only the first one after sorting.

An audit record built from `decisionId` therefore cannot show which rules were in
force. A policy edited without a version bump looks identical in the record.

**Fix:** compute `policyDigest = sha256(canonicalJson(parsedPolicy))` for every governing
policy. Put the sorted list in the decisionId preimage, together with `expiresAt`, and
return `policyDigest` in `ActionDecision`.

### M2. `decisionId` is an unkeyed hash of public data, so it is not a capability

**File:** `action.ts:279`

Repro: `sha256Hex(canonicalJson({decision:'allow', policyId, policyVersion, reasonCode:'rule_matched', requestDigest}))`
equals the real `decisionId`. Anyone who knows the request can mint the id of an
`allow` without calling the kernel. Two identical requests in the same `now`
millisecond also share an id, because there is no nonce.

The current shape matches the spec ("deterministic, sha256"), and nothing calls the
kernel yet. The risk lies in what a later approval service or tool guard might do:
treat "presents a valid decisionId" as proof that ARK said allow, or use it as a
one-time approval token.

**Fix:** state in the type docs that `decisionId` is a content address, and say
explicitly that it is not an authenticator. If a token is ever needed, issue it
separately with an HMAC or signature under a server key, single-use and bound to `expiresAt`.

### M3. The decision is made on a snapshot the caller never sees, so the checked request and the executed one can diverge (TOCTOU)

**File:** `action.ts:198-216` (`normalize`) and `ActionDecision` (`:111-122`)

`normalize` reads each field once, through ordinary property access. Getters and
inherited (prototype) properties are honored, and extra fields are silently dropped.
The decision does not return the normalized request. Only a digest comes back.

Repro: `attributes` with a getter that returns `100` on its first read and
`99999999` after → `allow`, and the caller's object afterwards reads `99999999`. Also,
`{...base, attributes: Object.create({amountMinor:100, currency:'USD'})}` → `allow`
from inherited properties.

A tool guard that executes from its own copy of the request, or from fields the
kernel dropped (for example `attributes.amount`), can carry out something other than
what was authorized.

**Fix:** return the normalized request in `ActionDecision`, or export a
`verifyDecision(request, decision)` that re-normalizes the request and compares
digests. Document that execution must use the normalized values. Read fields only
through `Object.hasOwn`, and reject inputs that are not plain objects (prototype is
neither `Object.prototype` nor `null`).

---

## Low

- **L1. Match-all and shadowed rules are accepted.** `action.ts:61-71`.
  `{when:{}, effect:'allow'}` and `{when:{amountMinor:{}}, effect:'allow'}` both allow
  $5,000, and an `allow` with `gte:0` placed ahead of a `deny gt:100000` silently
  shadows the deny. This is legitimate only if authors are trusted. Consider requiring
  an upper amount bound (`lt`/`lte`) on every `allow` / `require_approval` rule, and
  rejecting empty comparison objects.
- **L2. Hostile inputs throw instead of returning `unknown`.** `action.ts:264,329`
  and `normalize`. `options = null` raises a `TypeError`, and so does a throwing
  getter on the request. A throw is not an `allow`, but every caller must then treat a
  throw as deny. Wrap the body in `try/catch → result('unknown', 'invalid_request')`,
  and default `options ?? {}`.
- **L3. A present but malformed `principal` is silently dropped.** `action.ts:205`.
  `principal: 42` → `allow`, with the same digest as a request with no principal,
  while `principal: ''` → `deny invalid_request`. Reject a `principal` that is present
  and not a valid `Id`. That keeps the delegating user id in the digest from being
  quietly erased.
- **L4. Prototype pollution reach.** `normalize` and `claims` read inherited
  properties (see M3). A polluted `Object.prototype` elsewhere in the process could
  supply missing fields. Request and policy keys `__proto__` and `constructor` were
  tested: own `__proto__` from `JSON.parse` in a policy → `unknown policy_invalid`
  (strict rejects it), `constructor` on a policy → `unknown`, and on a request both
  are dropped harmlessly. The fix is in M3 (`Object.hasOwn`).
- **L5. The exported `canonicalJson` is not injective.** `action.ts:169-179`.
  `canonicalJson(NaN) === canonicalJson('NaN')` (`"NaN"`), and `-0` encodes like `0`.
  This cannot be reached through `normalize`, because each field has one fixed type
  and `-0` and `0` are the same amount. Other callers of the export could still be
  caught out. Throw on non-finite numbers, or stop exporting it.
- **L6. Multi-currency policies deny each other.** `action.ts:235`. A USD and an
  EUR policy for the same org, tool and action → `deny policy_conflict` for every
  request. This fails closed and is an availability problem, not a bypass. Treat
  `currency` as part of the governing key, or document one policy per tool/action.
- **L7. `now` is fully caller-trusted.** `now: 0` and `now: MAX_SAFE_INTEGER` are
  accepted. Policies carry no validity window, so an "expired" `now` has no effect on
  the decision. Whoever controls `now` controls `expiresAt`, which past
  `MAX_SAFE_INTEGER` also loses precision. This is as specified (trusted server
  context). Document that `now` must come from the guard's clock and never from the agent.

## Informational

- `package-lock.json` root `engines` changes `>=20` → `>=22.6`. This only syncs the
  lockfile to the root `package.json`, which was already `>=22.6` at `edba21e`.

---

## What was checked and held (no finding)

| Attack | Result |
|---|---|
| Another org's policy; request for another org | `unknown no_matching_policy` |
| Currency EUR vs USD policy; lowercase `usd`; rule currency ≠ policy currency | `deny currency_mismatch` / `invalid_currency` / `default_deny` |
| Amount −1, 1.5, 1e-7, NaN, ±Infinity, `"100"`, `100n`, `new Number(100)`, 2^53 | `deny invalid_amount` |
| Amount `MAX_SAFE_INTEGER` | `deny rule_matched` |
| Amount −0 | treated as 0 → `allow` (same value, same digest). Acceptable |
| Forged `role`, `permissions`, `approvedBy`, `decision:'allow'` on a $5,000 request | `deny`, and the digest is the same as without them |
| `defaultEffect: 'allow'` | `unknown policy_invalid` |
| Extra key in `when` | `unknown policy_invalid` |
| Invalid policy claiming this action, `null` in the array, non-string `orgId` | `unknown policy_invalid` |
| Invalid `allow`-default policy for another org | ignored (correct) |
| Non-array `policies` (array-like object) | `unknown policy_invalid` |
| Duplicate identical policies; same id at v1 and v2 that agree | decide normally. A version pin catches drift |
| allow vs deny, allow vs require_approval | `deny policy_conflict` |
| Tool case (`PAYMENTS`), Cyrillic homoglyph in orgId, trailing space | `unknown no_matching_policy`. Exact match, no normalization, fails closed |
| `expectedPolicyVersion` 2, `"1"`, NaN, null | `unknown policy_version_mismatch` |
| `now` −1, 1.5, string | `deny invalid_request` |
| Missing resource, empty resource id, null request | `deny resource_missing` / `invalid_request` |
| Canonical JSON: key order; `undefined` vs missing vs `null` principal; NFC vs NFD; lone surrogates; quote injection in a value | key order and missing/undefined/null give equal digests (intended). NFC ≠ NFD and lone surrogates stay distinct (strings are escaped by `JSON.stringify` before UTF-8 encoding). Values cannot break out of their string. No collision found between semantically different normalized requests |
| decisionId uniqueness | 48 distinct (amount × now × version-pin) decisions → 48 distinct ids. Same input gives the same id |
| No fallback `allow` | every `allow` path requires a rule match on a valid governing policy, with all governing policies agreeing |
| Purity / I/O | no clock, randomness, network or env reads in `action.ts` or `sha256.ts` |
| Secrets / data handling | no secrets, env vars, logging or network calls in the diff or the evidence |

### Dependency: `@noble/hashes`

- Exact pin `"1.8.0"` in `packages/core/package.json`, with no range.
- The lockfile entry has `resolved` from registry.npmjs.org and `integrity sha512-jCs9ldd7…XEI4A==`.
  This matches `npm view @noble/hashes@1.8.0 dist.integrity`, and the registry
  carries an npm signature for it.
- The installed `node_modules/@noble/hashes/package.json` is version 1.8.0, has no
  `dependencies`, and has no `preinstall` / `install` / `postinstall` / `prepare`
  scripts and no `gypfile`. The only scripts are bench, build, lint and test.
- Maintainer is paulmillr. The library is widely used, has been audited, and is pure
  JS. It replaces a hand-rolled SHA-256, which reduces risk.
  `sha256.test.ts` checks it against NIST vectors and `node:crypto` for lengths
  0..300, multi-byte input and a 1 MB input.
- There is one `@noble/hashes` entry in the lockfile, so no duplicate versions.
