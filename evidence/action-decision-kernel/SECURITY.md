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

## High — resolved (H1 fixed in b5f9234; confirmed by re-review 9304b3e and sign-off 35ea533)

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

---

# Re-review (round 2)

**Reviewer:** security reviewer (separate pass, `agents/security-reviewer.md`)
**Scope:** `git diff edba21e..HEAD` at `d0675d6`, mainly the rebuilt
`packages/core/src/governance/action.ts` and `canonical-json.ts`. Checked against
`specs/action-decision-kernel.md` and the accepted constraints in `EVIDENCE.md`.
**Date:** 2026-10-19
**Method:** `npm run build:packages`, then core tests (212/212 pass). Next, the round-1
scripts were re-run against the new dist, and two new scripts were run against it.
All scripts are in the reviewer scratchpad, outside the repo:
`secreview-kernel/attack.mjs` (round 1, 61 cases), `rereview.mjs` (about 90 cases:
Proxies, odd objects, `__proto__`, DoS, currency, conflicts, decisionId binding,
normalizedRequest) and `rereview2.mjs` (108 injected throw paths, plus digest checks).

## Verdict: APPROVE WITH NOTES

H1 is fixed. M1, M2 and M3 are fixed. L1 is recorded as an accepted constraint, and
L2–L7 are fixed or accepted (L5 and L7 are recorded in `EVIDENCE.md`). The new code
has no critical, high or medium findings. None of the attacks below produced an
`allow` that a correct reading of the policy would not give. Every exception path
returns `unknown`. The three new findings are low. Each one fails closed, or is
reachable only through policy objects built in code (not JSON). None of them blocks.

## Prior findings

| Finding | Status | Evidence |
|---|---|---|
| H1 non-strict `ActionRule` fails open | **Fixed** | `ActionRule` is `.strict()` (`action.ts:98-103`). A misplaced `amountMinor` and an `unless` both now give `unknown policy_invalid`. Test at `action.test.ts:329` |
| M1 decisionId does not bind policy content | **Fixed** | The preimage (`action.ts:357-367`) now includes the sorted `policyDigests` of every governing policy, plus `expiresAt`. 54 policy variants (rules × version × TTL) across 3 `now` values gave 54 distinct ids and 0 collisions. Changing only the *second* governing policy's rules or TTL changes the id. With two policies the id does not depend on their order. `policyDigest` equals `sha256(canonicalJson(policy))` |
| M2 decisionId is not a token | **Fixed (doc)** | The module doc (`action.ts:22-27`) and the field doc (`:148-152`) say it is a content address, not an authenticator. It can still be recomputed from public data, which is expected and documented |
| M3 TOCTOU, getters, inherited props | **Fixed** | Only own data properties are read, each once (`ownData`, `:223-228`). An accessor gives `unknown`, and an inherited `attributes` gives `deny invalid_amount`. A Proxy that returns a different amount on each read is read exactly once, and the returned `normalizedRequest` carries that value. `normalizedRequest` is deep-frozen and independent of the caller's object: mutating the source afterwards does not change it. `requestDigest === sha256(canonicalJson(normalizedRequest))` held for every case in the sweep. `-0` is normalized to `0` in both `now` and `amountMinor` |
| L1 match-all and shadowed rules | **Accepted constraint** | Recorded in `EVIDENCE.md` deviation list ("policy authors are trusted") |
| L2 hostile inputs throw | **Fixed** | `decideAction` wraps the body in `try/catch` (`:410-418`). There were 108 injected throws (number, `null`, an object shaped like `{decision:'allow'}`, `RangeError`) at every request, resource, attribute, policy, rule, policies-array and options key, plus `getPrototypeOf` traps. All 108 returned `unknown`/`deny`: none escaped and none gave `allow`. A call made near stack exhaustion returns `unknown invalid_request` |
| L3 malformed principal dropped | **Fixed** | `principal: 42` and `principal: ''` both give `deny invalid_request` |
| L4 prototype-pollution reach | **Fixed** | No inherited reads on the request. For the policy side, see R-L1 |
| L5 `canonicalJson` not injective | **Fixed / accepted** | No longer exported from `@ark/core` (`index.ts` exports `action.js` only). It throws on non-finite numbers |
| L6 multi-currency policies deny each other | **Fixed** | Currency is part of the governing key (`:510-512`) |
| L7 `now` caller-trusted | **Accepted / documented** | `action.ts:29-30` |

## New code: what was attacked and held

| Attack | Result |
|---|---|
| Proxy request/attributes with a `getOwnPropertyDescriptor` trap that returns a different value per read | each field read once. The decision and `normalizedRequest` agree |
| Proxy whose `getPrototypeOf` lies about a class instance | accepted as plain. Harmless: only own data descriptors are read, once |
| Revoked Proxy as the request / a policy; Proxy `ownKeys` that throws or hides `rules` | `unknown invalid_request` / `unknown policy_invalid` |
| Proxy policies array with `length` 2^32−1 | first missing index → `unknown policy_invalid` (fast) |
| Null-prototype request and policy; frozen request; sealed policy | decide normally (correct) |
| Arrays where objects are expected (request, resource, attributes, policy, `when`); a `Date` as attributes; an Array subclass as `policies`; sparse arrays and holes; explicit `undefined` in a policy | `deny invalid_*` or `unknown policy_invalid` |
| Accessor (getter) on a policy rule | `unknown policy_invalid` |
| Nesting depth 9, and 100k deep | `unknown policy_invalid` (depth cap at `:232`, no stack overflow) |
| Currency selection with a USD demo policy plus an EUR allow-all policy, $5,000 request as `eur`, `EUR `, ` EUR`, `EUR\n`, `Eur`, full-width `ＥＵＲ`, `EU`, `EURO` | all `deny invalid_currency`. Only an exact `EUR` selects the EUR policy, and that is the policy for that currency, so it is correct. JS `$` without the `m` flag does not match before a trailing newline. A policy with `currency:'usd'` gives `unknown policy_invalid` |
| Two USD policies (allow-all + demo), $5,000 | `deny policy_conflict` |
| Same id with different rules, a different TTL, or a different currency | `unknown policy_conflict` |
| Same id, where one copy is invalid | `unknown policy_invalid` |
| Same id under another org (not claiming) | ignored (correct) |
| Version pin with an EUR v7 policy present on a USD request | the pin applies to governing policies only, so `allow` (correct: EUR does not govern) |

## New findings

### R-L1 (low). A `__proto__` key in a policy becomes the copied object's prototype, so it is no longer rejected as an unknown key

**File:** `packages/core/src/governance/action.ts:242-243` (`plainCopy`)

`plainCopy` writes `out[k] = …` into an ordinary `{}`. For an own `__proto__` key
(which `JSON.parse` produces), that assignment calls the `__proto__` setter instead
of creating a key. zod 3.25 reads known keys with `data[key]`, which includes
inherited ones, and its strict check uses `for…in`. The results:

- `{"__proto__":"x", …valid policy}` → previously `unknown policy_invalid` (round 1),
  now **accepted** (`allow` for $75). The primitive is silently dropped.
- `{…policy without decisionTtlMs, "__proto__":{"decisionTtlMs":86400000}}` → accepted,
  and the 24h TTL comes from the prototype.
- An own key wins over a `__proto__` copy of it. A reviewer reading the stored JSON
  can therefore see two TTLs, or two caps, and not know which one applies.
- An unknown key inside `__proto__` (`unless`, `evil`) is still rejected, because
  `for…in` sees it. **Not fail-open:** `policyDigest` and the decision both use
  the effective zod output, so what was decided is what was digested.

The strictness added for H1 exists so that odd policy JSON is rejected, not
quietly reinterpreted. This is a small regression on that.

**Fix:** in `plainCopy`, `if (k === '__proto__') throw new Unreadable('__proto__')`,
or build `out` with `Object.create(null)` / `Object.defineProperty` so strict
rejects the key. Add a test with `JSON.parse('{"__proto__":…}')`.

### R-L2 (low). Symbol-keyed and non-enumerable policy properties are silently ignored

**File:** `action.ts:243` (`Object.keys(v)`)

A rule `{when:{}, effect:'allow'}` with a non-enumerable or Symbol-keyed `unless`
gives `allow` for $5,000. This is the H1 shape (a condition that does not count),
but JSON cannot produce it. Only a policy object built in code can, and policy
authors are trusted (L1). **Fix:** iterate `Reflect.ownKeys(v)` and throw
`Unreadable` on a symbol key or a non-enumerable property.

### R-L3 (low). No size bound before validation, so very large policy inputs cost seconds of CPU (fails closed)

**File:** `action.ts:234-239`, `:477-498`, `:526`

`plainCopy` copies any array length and any object width before zod's `max(64)`
applies. Measured: one policy with 1e6 rules takes 3.5 s, then `unknown policy_invalid`.
1e5 identical claiming policies take 4.6 s, then `allow`. 2e5 distinct claiming
policies take 10 s, then `unknown invalid_request`, because the spread in
`Math.min(...)` at `:526` throws `RangeError` and the catch-all handles it. Every case
fails closed. Policies come from trusted server storage, so this matters only if a
policy store can be written by a less trusted party.
**Fix:** in `plainCopy`, reject arrays longer than 64 and objects with more than
about 16 keys. Cap `policies.length`, for example at 256 → `policy_invalid`. Use a
loop or `reduce` in place of `Math.min(...spread)`.

### Informational

- The returned `ActionDecision` object is not frozen (its `normalizedRequest` is).
  A consumer can only mutate its own copy, so this is not a kernel issue.
- `policyId` and `policyVersion` report the first governing policy by id sort. The
  full governing set is bound only through `decisionId`. An audit log that wants to
  list every governing policy has to record the set itself.
- A malformed policy that cannot be shown to belong elsewhere (for example another
  org's policy with no `tool`) still gives `unknown` for every request in this org.
  That is fail-closed by design, and it is an availability coupling.
- Dependencies: no change since round 1 (`@noble/hashes` 1.8.0 exact pin; `zod` ^3.23.8 was already present).

---

# Security sign-off (round 3)

**Scope:** fix commit `4f6780c` (`action.ts`, `action.test.ts`). I rebuilt the
packages with `npm run build:packages`; core tests pass 218/218. I re-ran
`attack.mjs`, `rereview.mjs` and `rereview2.mjs` against the new dist, and added
`round3.mjs` (all four are in the reviewer scratchpad, `secreview-kernel/`).

## Verdict: APPROVE

No findings remain at any severity. R-L1, R-L2 and R-L3 are fixed. Each one now
fails closed with `unknown` and nothing is thrown to the caller.

| Finding | Status | Evidence |
|---|---|---|
| R-L1 `__proto__` smuggling | **Fixed** | `ownEntries` rejects `__proto__`, `constructor` and `prototype` keys. `"__proto__":"x"`, a TTL or cap supplied through `__proto__`, and `__proto__` inside a rule or `when` all give `unknown policy_invalid`. The same keys on a request give `unknown invalid_request` |
| R-L2 Symbol / non-enumerable keys | **Fixed** | Keys come from `Reflect.ownKeys`, and a symbol key, an accessor or a non-enumerable key is unreadable. A Symbol or non-enumerable `unless` on a rule gives `unknown policy_invalid`. On a request it gives `unknown invalid_request` |
| R-L3 no size bound | **Fixed** | The array length is checked before keys are listed, and the TTL minimum is now a loop. Policies above 256, rules above 64 and keys above 64 are rejected; exactly 256, 64 and 64 are accepted. Every case returns `unknown` within milliseconds: 1e6 rules, 1e5 and 2e5 policies, 2e5 keys, a Proxy reporting a length of 2^32−1. Measured before the fix: 3.5–10 s. A worst-case valid input (256 distinct governing policies) takes about 13 ms per call. An extra non-index key on an array, a hole, or a Proxy whose `length` disagrees with its keys gives `policy_invalid` |

**Held again:** all round-1 and round-2 cases give the same outcomes as before, apart
from the R-L1/R-L2/R-L3 cases above:
- currency casing and whitespace
- same id with different content gives `policy_conflict`
- decisionId binding: 54 variants, 0 collisions
- the digest matches `normalizedRequest`
- `normalizedRequest` is deep-frozen and read once

**Throw paths:** throws were injected through `ownKeys` and `getOwnPropertyDescriptor`
traps on the request, options, policies array and rules, using a thrown object
shaped like `{decision:'allow'}`. Each one returns `unknown`. Every throw that
actually fired led to `unknown`, never `allow`, and none escaped.

The older scripts still count some `allow` results under "allows from throws". In
those cases the trap was set on a key that is absent, and `ownEntries` only reads
listed keys, so no throw was ever raised. `round3.mjs` checks whether each throw
fired, and the count of `allow` after a fired throw is 0.

**Remaining notes (informational, no action needed):**
- A request now gets `unknown invalid_request` if it carries a Symbol, non-enumerable,
  `__proto__` or `constructor` key, or more than 64 keys. It used to ignore those
  extras. Callers that put large metadata objects on the request should keep them
  separate.
- The returned `ActionDecision` is not frozen; its `normalizedRequest` is. `decisionId`
  is still a content address, not a credential (M2, documented).
- The accepted constraints from `EVIDENCE.md` still apply: L1 (match-all and
  shadowed rules) and L7 (caller-trusted `now`).
