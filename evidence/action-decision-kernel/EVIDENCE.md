# Evidence — action-decision-kernel

## What changed

A caller can now hand `@ark/core` a typed description of one protected action
(org, agent, tool, action, resource, amount, currency, time) and get back a
deterministic `allow`, `deny`, `require_approval` or `unknown`, with a decision id,
policy id/version, a closed reason code, a request digest and an expiry. Before
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
`role`/`permissions`, and a version mismatch. It counts network calls by wrapping
`globalThis.fetch`, and runs every decision with `Date.now` and `Math.random`
replaced by stubs that throw, so a clock read or random draw inside the kernel
would crash the run. The script was committed (`32451b7`) before the before
capture and was not changed afterwards, so before and after use the same command.
`capture.sh` (kept in the session scratchpad, not committed) wraps that command
and writes the version, the command and the exit code into `before.txt` /
`after.txt`.

The result depends only on the input and the policy. The machine, cache and data
cannot change it, because the kernel reads no state.

## Before / after

| | Before (`32451b7`) | After (`22546e7`) |
|---|---|---|
| Artefact | `before.txt` | `after.txt` |
| Measurement | exit code 1: `SyntaxError: ... does not provide an export named 'DEMO_REFUND_POLICY'`. No kernel exists. | exit code 0. 11 cases, **2 `allow`** ($75, $100). $100.01 / $750 / $1,000 are `require_approval`. $1,000.01 / $5,000 are `deny`. Unknown tool and other-org are `unknown` `no_matching_policy`. Forged role is `deny`, with a digest identical to the plain $5,000 request. Version mismatch is `unknown` `policy_version_mismatch`. **0 network/model calls.** |
| `@ark/core` tests | 166 | 200 (+31 `action.test.js`, +3 `sha256.test.js`) |
| `npm test` (repo) | — | exit 0. 615 tests, 0 failures across 12 suite runs |
| `npm run typecheck` | — | exit 0 |
| `npm run build --workspace @ark/business` | — | exit 0 (see deviation 1) |

`captures.tsv` has two `after` rows. The first (`8535621`) was taken before the
decisionId fix (deviation 2) and its `after.txt` was overwritten. The second
(`22546e7`) is current. It reads `dirty=2` because `captures.tsv` and `after.txt`
themselves were uncommitted at the time of capture. No source file was dirty.

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
- **The SHA-256 is hand-written** (deviation 1). It matches `node:crypto` on the
  NIST vectors, on every length from 0 to 300, on multi-byte UTF-8 and on a 1 MB
  input. It is not constant-time, and it is used for identifiers only, never for
  secrets or MACs.
- **Purity is evidenced, not proven.** Traps on `Date.now`/`Math.random`/`fetch`
  and a check of the compiled module's imports show the absence of the obvious
  side effects. They do not rule out every possible one.
- **Bundle size is not measured.** `apps/business` imports the `@ark/core` barrel
  in a client component, so the kernel and the frozen demo policy probably ship
  in that bundle. The build passes. The size delta was not
  measured.

## Deviations

1. **No `node:crypto`. A dependency-free synchronous SHA-256
   (`packages/core/src/governance/sha256.ts`) instead.** The build instruction
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
   conflicts with "exported from `@ark/core`". No package dependency was added.
   `sha256.ts` is not exported from the barrel.
2. **`decisionId` preimage includes `decision` and `reasonCode`.** The spec
   says "sha256 over policy id, version and request digest". Built literally, the
   first after capture (stamped at `8535621`, then overwritten, never
   committed) showed `$75 allow` and `$75 version mismatch → unknown` with the
   same `decisionId` (`9e56284abcfb84ff`, first 16 hex chars, in both rows). A `policy_conflict` deny would also
   share an id with a single-policy allow. An accountability id that is the same
   for an allow and a refusal is a defect, so the preimage is now
   `{decision, policyId, policyVersion, reasonCode, requestDigest}` in canonical
   JSON. A test pins that the three outcomes get three distinct ids.
3. **Choices the spec left open, stated so they can be reviewed:**
   - `expectedPolicyVersion` is a third `options` argument, not a request field.
   - Policy `version` is a positive integer.
   - A policy has one `currency`, and requests in any other currency get `deny`
     `currency_mismatch`.
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

Tests changed: none. New test files: `action.test.ts`, `sha256.test.ts`. Both are
added to the core `test` script.

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
- **Security review:** The spec requires `agents/security-reviewer.md` to run.
  It has not run; that is not the builder's step.
