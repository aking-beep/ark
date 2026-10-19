# Evidence — action-decision-kernel

## What changed

A caller can now hand `@ark/core` a typed description of one protected action
(org, agent, tool, action, resource, amount, currency, time) and get back a
deterministic `allow`, `deny`, `require_approval` or `unknown`. Each decision
carries a decision id, the policy id, version and content digest, a closed reason
code, a request digest, the normalized request it was made on, and an expiry. Before
this change ARK had no function that could answer "may this agent refund $750 on
this order, now?". ADR-0009 records that this is now the wedge, and ADR-0008 is
marked superseded in part.

## How it was measured

From the repo root, Node v22.22.0, after `npm ci && npm run build:packages`:

```
node evidence/action-decision-kernel/decide-demo.mjs
```

The script imports `decideAction` and `DEMO_REFUND_POLICY` from the built
`packages/core/dist/index.js` and prints one row per case: $75, $100, $100.01,
$750, $1,000, $1,000.01, $5,000, an unknown tool, another org's policy, a forged
`role`/`permissions`, a version mismatch, and (added after the security review)
a policy with a malformed rule (H1). It counts network calls by wrapping
`globalThis.fetch`, and runs every decision with `Date.now` and `Math.random`
replaced by stubs that throw, so a clock read or random draw inside the kernel
would crash the run. The script was committed (`32451b7`) before the before
capture. Its only later change (`345afe8`) adds the H1 row and an optional
per-row policy list. The command, the fixed `now` and the other 11 rows are
unchanged.
`capture.sh` (kept in the session scratchpad, not committed) wraps that command
and writes the version, the command and the exit code into `before.txt` /
`after.txt`.

The result depends only on the input and the policy. The machine, cache and data
cannot change it, because the kernel reads no state.

## Before / after

| | Before (`32451b7`) | After (`345afe8`) |
|---|---|---|
| Artefact | `before.txt` | `after.txt` |
| Measurement | exit code 1: `SyntaxError: ... does not provide an export named 'DEMO_REFUND_POLICY'`. No kernel exists. | exit code 0. 12 cases, **2 `allow`** ($75, $100). $100.01 / $750 / $1,000 are `require_approval`. $1,000.01 / $5,000 are `deny`. Unknown tool and other-org are `unknown` `no_matching_policy`. Forged role is `deny`, with a digest identical to the plain $5,000 request. Version mismatch is `unknown` `policy_version_mismatch`. A malformed rule at $5,000 is `unknown` `policy_invalid` (before the H1 fix it was `allow`, per SECURITY.md). **0 network/model calls.** |
| `@ark/core` tests | 166 | 212 (+43 `action.test.js`, +3 `sha256.test.js`) |
| `npm test` (repo) | — | exit 0. 627 tests, 0 failures across 12 suite runs |
| `npm run typecheck` | — | exit 0 |
| `npm run build --workspace @ark/business` | — | exit 0 (see deviation 1) |
| `npm run build --workspace @ark/control` | — | exit 0 |

`captures.tsv` has four `after` rows, and only the last is current.
- `8535621` was taken before the decisionId fix (deviation 2). Its `after.txt`
  was overwritten.
- `22546e7` used the hand-rolled SHA-256 that was later removed. It reads
  `dirty=2` because `captures.tsv` and `after.txt` themselves were uncommitted
  at the time. No source file was dirty.
- `7a91a43` switched to `@noble/hashes`. Its output was byte-identical to
  `22546e7` apart from the header line, so swapping the hash implementation did
  not change behaviour.
- `345afe8` is current: the review round 1 and security fixes, `dirty=0`. Every
  `decisionId` differs from `7a91a43`, as expected, because the preimage now
  binds policy digests and `expiresAt` (deviation 2). Every decision and reason
  code for the original 11 rows is unchanged.

`policy.ts`, `enforce.ts`, `policy.test.ts` and `enforce.test.ts` are unchanged.
`git diff edba21e -- <those four files>` is empty.

## What this does not prove

- **No protection exists yet.** Nothing calls `decideAction`. There is no guard
  at a tool boundary, no approval flow, and decisions are not persisted. An
  `expiresAt` means nothing until a guard enforces it.
- **The request is only as trustworthy as its caller.** The kernel assumes
  `orgId`/`agentId`/`principal` were verified upstream. It cannot detect a caller
  that builds an `ActionRequest` from untrusted input. Forged `role`/`permissions`
  fields are dropped, but a forged `orgId` would be believed.
- **Currency is checked by shape only.** It must be three upper-case letters, not
  a member of the ISO-4217 list. Minor-unit exponents are not checked (JPY has 0
  decimals, KWD has 3). The policy author has to state thresholds in the right
  unit.
- **The thresholds are synthetic.** `DEMO_REFUND_POLICY` is a demo policy and
  says so in the code, the ADR and this output. Nothing here says what a real org
  should allow.
- **The SHA-256 comes from a third-party package** (`@noble/hashes` 1.8.0,
  deviation 1). `sha256.test.ts` checks the wrapper against the NIST vectors and
  against `node:crypto`: every length from 0 to 300, multi-byte UTF-8, and a 1 MB
  input. That checks correctness. It does not audit the package's supply chain
  beyond the exact pin and the lockfile integrity hash.
- **Purity is evidenced, not proven.** Traps on `Date.now`/`Math.random`/`fetch`
  and a check of the compiled module's imports show the absence of the obvious
  side effects. They do not rule out every possible one.
- **Accepted constraints (security review L1, L5, L7).**
  - *L1:* match-all rules (`when: {}`) and rules shadowed by an earlier rule are
    accepted. Policy authors are trusted, and the kernel does not lint
    policies.
  - *L5:* `canonicalJson` is now internal (not exported from `@ark/core`) and
    throws on non-finite numbers. The kernel never passes it one: amounts are
    validated, and the digest projection tags non-finite values. So NaN can no
    longer reach it.
  - *L7:* `now` is trusted from the caller. The guard (PR-3) owns the clock, and
    `now` must never come from the agent. This is stated in the module doc.
- **Bundle size is not measured.** `apps/business` imports the `@ark/core` barrel
  in a client component, so the kernel and the frozen demo policy probably ship
  in that bundle. The build passes. The size delta was not
  measured.

## Deviations

1. **No `node:crypto`. `@noble/hashes` instead, behind a thin internal
   wrapper (`packages/core/src/governance/sha256.ts`).** The build instruction
   said to use `node:crypto` because "core already runs on Node". It does not
   only run on Node. `apps/business/src/components/intake/steps.tsx` is a client
   component that imports `estimateTokens` from the `@ark/core` barrel. With
   `node:crypto` in `action.ts`, `npm run build --workspace @ark/business`
   failed with `UnhandledSchemeError: Reading from "node:crypto" is not handled`
   (import trace: `action.js` → `index.js` → `steps.tsx`). WebCrypto's
   `subtle.digest` is async, which breaks the spec's "pure and synchronous". The
   spec does not name a hash implementation. The alternatives were changing
   `next.config.mjs`, changing the client component, or adding a non-barrel
   subpath export. All of those are outside the spec's scope, and the last one
   conflicts with "exported from `@ark/core`". `sha256.ts` is not exported from
   the barrel.

   **New dependency: `@noble/hashes` at exactly `1.8.0`** (published
   2025-04-21, the latest 1.x), a runtime dependency of `@ark/core`. It was
   *authorized by the coordinator in lieu of `node:crypto`, which breaks the
   business client bundle*. It replaced a hand-rolled SHA-256 from an earlier
   commit (`7a565dc`), which the coordinator rejected for authorization code. It
   is synchronous, pure JS, audited, and works in both the browser and Node.
   Imports used: `sha256` from `@noble/hashes/sha2`, and `bytesToHex` and
   `utf8ToBytes` from `@noble/hashes/utils`. npm updated the lockfile
   (`npm install --save-exact`). In the same write, npm also synced the
   lockfile's root `engines.node` from `>=20` to `>=22.6`, which is what the root
   `package.json` already declares. I did not edit `package-lock.json` by hand.
2. **`decisionId` preimage is wider than the spec's (extended again after security review M1).** The spec
   says "sha256 over policy id, version and request digest". Built literally, the
   first after capture (stamped at `8535621`, then overwritten, never
   committed) showed `$75 allow` and `$75 version mismatch → unknown` with the
   same `decisionId` (`9e56284abcfb84ff`, first 16 hex chars, in both rows). A `policy_conflict` deny would also
   share an id with a single-policy allow. An accountability id that is the same
   for an allow and a refusal is a defect, so the preimage gained `decision` and
   `reasonCode`. After M1 it is now
   `{decision, reasonCode, requestDigest, policyId, policyVersion, policyDigests, expiresAt}`
   in canonical JSON. `policyDigests` is the sorted list of sha256 hashes of
   every governing policy's canonical content. The decision also returns
   `policyDigest` for the reported policy. Tests pin four things: distinct
   outcomes get distinct ids; same id and version with different rules gives a
   different id; a different TTL gives a different id; a second agreeing policy
   gives a different id. The id is a content address, not a token (M2). That is
   documented in the module doc and ADR-0009.
4. **Review round 1 and security review fixes (`b5f9234`), each with a test:**
   - *H1:* `ActionRule` is `.strict()`, and so is every other object schema
     (`ActionRequest`, `ActionResource`, `ActionAttributes`, `AmountComparison`,
     `when`, `ActionPolicy`). A test asserts each one is strict. A rule with a
     top-level `amountMinor` or an `unless` key now gives `unknown`
     `policy_invalid`.
   - *Criterion 4 / L3:* a `principal` that is present but invalid (`42`,
     `{admin:true}`, an array, `''`, `null`, `true`) gives `deny`
     `invalid_request`. Absent or `undefined` still means "no principal".
   - *M3 / L4:* inputs are snapshotted before deciding.
     - Only own data properties of plain objects (prototype `Object.prototype`
       or `null`) are read, each exactly once.
     - A request is read only for its known keys. Policies are deep-copied the
       same way.
     - An accessor property on the request gives `unknown` `invalid_request`,
       and the getter is never invoked. On a policy it gives `unknown`
       `policy_invalid`.
     - Non-plain objects are rejected: a class-instance request gives
       `invalid_request`, inherited `attributes` give `invalid_amount`, and a
       non-plain policy gives `policy_invalid`.
     - Polluting `Object.prototype` cannot supply a missing field.
     - The decision returns `normalizedRequest`. It is frozen and is the exact
       object the digest was computed from (asserted), or `null` when the
       request itself was rejected.
     - A Proxy over a plain object passes the plain-object check. Its traps
       are invoked once per field, and a throwing trap gives `unknown`.
   - *L2:* the function never throws. `options` that is `null`, a non-object,
     or has a throwing getter gives `unknown` `invalid_request`, and so does any
     unexpected exception (the whole body is wrapped). Accessor or unreadable
     *requests* give `unknown`, not `deny`. They are not a validated request.
   - *Currency (reviewer's call: match by currency):* currency is now part of
     the governing key. Among the policies that claim the org, tool and action,
     only those for the request's currency govern. So separate USD and EUR
     limits work. A currency no claiming policy governs still gives `deny`
     `currency_mismatch` (spec AC3). This replaces the earlier behaviour, where
     a USD and an EUR policy produced `deny policy_conflict` for every request.
   - *Same id, different content:* two policies with the same id and different
     content (for example v1 and v2 together, unpinned) give `unknown`
     `policy_conflict` before any evaluation. Identical duplicates collapse to
     one. Note that `policy_conflict` is now emitted with `unknown` here and
     with `deny` when distinct policies disagree.
   - The dead `governing[0] ?? null` fallback is removed. `canonicalJson` moved
     to an internal `canonical-json.ts` and is no longer exported from
     `@ark/core`.
3. **Choices the spec left open, stated so they can be reviewed:**
   - `expectedPolicyVersion` is a third `options` argument, not a request field.
   - Policy `version` is a positive integer.
   - A policy has one `currency`. Policies are selected by org, tool, action
     and currency (see 4).
   - `decisionTtlMs` (≤ 24 h) sets `expiresAt = now + ttl`. When governing
     policies agree, the shortest TTL wins.
   - A malformed `orgId`/`agentId`/`tool`/`action`/`now` gets `deny`
     `invalid_request`. The spec lists no rule for that case, and the choice is
     fail-closed.
   - Request validation (resource → amount → currency) runs before policy
     lookup, so those denies carry `policyId: null`.
   - An invalid policy is ignored only if its `orgId`/`tool`/`action` are
     strings that plainly name a different target. Otherwise the result is
     `unknown` `policy_invalid`.
   - Governing policies are sorted by id, so input order does not change the
     decision or the id.

Tests changed: in `action.test.ts`, the module-import assertion now also
expects `./canonical-json.js`, and the canonical JSON test also checks that
non-finite numbers throw. Both are this feature's own tests and were updated for
the internal module split. No other test was changed. New test files are
`action.test.ts` and `sha256.test.ts`, and both are in the core `test` script.
`canonical-json.ts` is covered through `action.test.ts`.

## Definition of done

- **Cost / latency impact:** No runtime path calls the kernel, so production
  cost is zero. The kernel makes no network or model calls (0 in `after.txt`).
  Per-decision latency was not benchmarked. It is two SHA-256s over a few hundred
  bytes plus a zod parse per policy.
- **Observability for new failure modes:** No new I/O, so no new runtime
  failure modes. Every non-allow outcome carries a closed `reasonCode` from
  `ActionReasonCode`, which is the observability hook a future guard should log.
  Logging is not added here, because the spec puts persistence out of scope.
- **Docs or ADR updated:** Added `docs/adr/0009-action-accountability-wedge.md`.
  ADR-0008 has a "Superseded in part by ADR-0009" status line, and its text is
  otherwise unchanged. README, `docs/00-thesis.md` and `docs/prd/ark-control.md`
  each have a one-line pointer to ADR-0009. The ADR labels `DEMO_REFUND_POLICY`
  synthetic.
- **Security review:** It ran (`SECURITY.md`, verdict BLOCK on H1). Every
  finding is addressed in deviation 4, or listed above as an accepted
  constraint (L1, L5, L7). M2 is a documentation fix only. It still needs a
  re-review; that is not the builder's step.
