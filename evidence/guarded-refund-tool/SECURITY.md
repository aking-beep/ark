# Security review — guarded-refund-tool

**Reviewer:** security reviewer (`agents/security-reviewer.md`, under `factory/GOVERNANCE.md`), separate context from the builder and the general reviewer.
**Scope:** `git diff 60f94ec..5758c13` (PR-3, stacked on the security-approved PR-2 decision kernel). Inputs: `specs/guarded-refund-tool.md`, the diff, `evidence/guarded-refund-tool/`. The kernel (`decideAction`) was treated as approved and only re-tested where the guard depends on it.
**Method:** `npm run build:packages`, then attack scripts written against the built `dist` (session scratchpad, `secreview-guard/a1`–`a6`; not committed). Node v22.22.0, temp libSQL files, no network.

## Verdict

**APPROVE WITH NOTES.** No critical or high findings. The handler was never invoked on any deny / unknown / require_approval / invalid / expired / context-failure / policy-failure path tried, identity never came from arguments, forged approvals never reached execution or storage, and the libSQL claim held under concurrency across four connections. Two medium findings (M1, M2) should be fixed or explicitly documented before this guard protects real money; neither blocks this synthetic PR.

---

## Medium — M1: an async telemetry sink that rejects crashes the process and abandons in-flight guarded executions

**File:** `packages/guard/src/guard.ts:229-259` (the call at `:238`, `sink.evidence({...})`).

`emit` wraps `sink.evidence(...)` in a synchronous `try/catch`. If the sink returns a rejected promise (an `async` sink, a JS integration, or a cast), the rejection escapes the `try` and becomes an unhandled rejection. Node 22's default (`--unhandled-rejections=throw`) terminates the process. Spec criterion 5 says a telemetry failure never changes a decision or an execution; here it can kill every concurrent guarded call mid-flight.

**Repro** (`a5-tele-crash.mjs`): start an allowed $75 refund whose handler takes 50 ms, then make a denied $5,000 call on the same guarded tool with `telemetry: { evidence: async () => { throw new Error('sink down') } }`. The process exits with `Error: sink down` from `emit` (`dist/guard.js:97`) before the in-flight handler finishes. Its receipt stays `attempted` (the key is spent and the outcome is lost). `a4-outcome.mjs` saw 2 unhandled rejections from the same sink.

The shipped `@ark/sdk` `TraceHandle.evidence` is synchronous and its type (`GuardTelemetry = Pick<TraceHandle, 'evidence'>`) rejects an async function in TypeScript, so the demo path is safe. That is why this is medium and not high.

**Fix:** keep the return value and neutralise it: `const ret = sink.evidence(...); if (ret && typeof (ret as any).then === 'function') (ret as any).then(undefined, () => {});`. Optionally run `emit` via `queueMicrotask` inside its own try so that a slow synchronous sink cannot delay the result either. (A 300 ms busy sync sink delayed the return by 300 ms but changed nothing.) Add a test with an async rejecting sink.

## Medium — M2: replay protection is only as strong as a caller-chosen key, and nothing bounds repeated refunds of one order

**Files:** `packages/guard/src/demo/refund.ts:95` (`idempotency: { key: (a) => a.idempotencyKey }`), `packages/guard/src/guard.ts:296-304`, `packages/guard/README.md:253-267` ("What happens on each call", steps 5–6).

The idempotency key comes from the tool arguments, which the agent controls. Keys are hashed byte-exactly, with no normalisation. A replay with the same key is correctly suppressed. A replay with a *new* key is a new action, though, and the kernel's per-call thresholds have no per-resource or cumulative limit. The guard therefore stops one $5,000 refund but allows fifty $100 refunds of the same order.

**Repro** (`a3-idem.mjs`): 60 calls of `refund_order` on `ord_drain` for $100 each with keys `drain-0…59` executed 60 times, $6,000 total, every one `allow`. The keys `norm`, `norm ` (trailing space), `NORM`, NFD `nörm` and NFC `nörm` on one order executed 5 times.

The spec defines the replay scenario as "same idempotency key", so the build meets its acceptance criteria. The README says the key prevents re-execution, though, and does not say that a caller who varies the key is not stopped. For a money-movement boundary that gap should be stated, not discovered.

**Fix:**
1. In the README's Known limits, state that idempotency guards against accidental retries, not against a caller that mints new keys, and that per-call policy thresholds are not cumulative.
2. Recommend deriving the key server-side or from the resource where the business allows one refund per order (e.g. `key: (a) => \`refund:${a.orderId}\``), and do that in the demo.
3. Track cumulative / per-resource limits (velocity or sum-per-resource) as a kernel follow-up before real payments.

---

## Low — L1: handler `args` are not bound by the digest when the schema keeps references

**File:** `packages/guard/src/guard.ts:287-290` (parse, `deepFreeze`), `:460` (handler gets `args` and `request`).

`deepFreeze` freezes own data properties, but it cannot pin accessors on prototypes, and zod keeps references for `z.any()`, `z.unknown()`, `z.custom()` and `.passthrough()` nested values. Repro (`a1-bypass.mjs`): a schema with `meta: z.any()` and a class instance whose `amt` getter returns 7500 then 500000. `toRequest` mapped 7500 (allowed). The handler read `args.meta.amt === 500000` while `request.attributes.amountMinor === 7500`. The demo handler uses `request` only, so the demo is not affected. Top-level getters, Proxies (including a foreign-prototype Proxy) and mutating the raw object during the policy load were all snapshotted correctly; the handler saw the decided values in every case.

**Fix:** after `safeParse`, `structuredClone(parsed.data)` (a failure means `invalid_arguments`) and then freeze, so the handler's `args` are plain data. State in the `HandlerInput.args` JSDoc and the README that handlers must act on `request`, and treat `args` as advisory.

## Low — L2: sender-approval detection is top-level and exact-name only, so variants go unflagged

**File:** `packages/guard/src/guard.ts:162` (`SENDER_APPROVAL_KEY`), `:194-208`.

`approvedBy`, `APPROVED_BY`, `approval`, `approvals`, `approved` and `approver` are stripped and flagged. `approved-by`, `approvalToken`, `approverId`, `approvedBy​`, nested `meta.approvedBy` and a JSON `__proto__` key carrying `approvedBy` are not flagged (`senderReportedApproval=false`). None of them executed (all `pending_approval`), and none was stored in a receipt or sent in telemetry: the guard has no approval path, so nothing can be "accepted". With a `.passthrough()` schema, `approved-by` and nested `meta.approvedBy` do reach the handler's `args`. The impact is under-reporting in the audit flag, not bypass.

**Fix:** flag on a recursive scan with a normalised name (lower-case, strip non-alphanumerics, match `^approv`), and keep removing only the top-level exact names. Document that handlers must never read approval from `args`.

## Low — L3: the claim result is checked by truthiness, and a misbehaving store makes `guarded()` reject

**File:** `packages/guard/src/guard.ts:405-433` (`if (!claim.claimed)` at `:416`; `sameRequest(owner, n)` at `:421`).

A store returning `{ claimed: 'yes' }` or `{ claimed: 1 }` caused execution. A store returning `undefined`, `null` or `{}` made the guarded handler reject with a TypeError instead of returning a typed `blocked` result (the handler was not invoked). Stores are trusted components, so this is defence in depth.

**Fix:** `if (claim?.claimed !== true)`. Validate `existing` (null or a receipt with string `requestDigest` and number `createdAt`). Wrap the not-claimed branch in try/catch and return `blocked` / `receipt_store_failed`.

## Low — L4: telemetry reports a replay as `ok` whatever the first attempt's status

**File:** `packages/guard/src/guard.ts:236`.

`replayed` maps to `outcome: 'ok'` even when the original is `attempted`, `failed` or `outcome_unknown`. `metadata.executionStatus` carries the truth, but dashboards keyed on `outcome` would count a replay of an unknown outcome as success. **Fix:** map replay through the original status (`completed` gives `ok`, `failed` gives `error`, anything else gives `pending` or `unknown`).

## Informational (documented or accepted, no action required)

- `resource_id` and `principal` are stored as given, and the key hash is unsalted SHA-256. Both are documented in the README Receipts caveats; there are no other free-text columns.
- `outcome_unknown` is final even if a timed-out handler later completes (`slowSuccess` and `ignoresAbort` repros). This is the honest choice and it is documented.
- A crash between claim and finish leaves `attempted`. The next same-key call returns `replayed` with `executionStatus: 'attempted'` and does not re-run (repro with a `finish` that throws). Callers must not read `replayed` as success; the README says `attempted` means "possibly executed".
- `PolicySource` receives no context. That is safe because the kernel matches `policy.orgId` to the trusted org (an allow-all policy for another org returned `unknown`), but multi-tenant loaders need to resolve the org themselves.
- Identical requests in the same millisecond share a decision id, so the second is blocked with `receipt_conflict` (fail-closed; documented).

## What was checked, and held

**Bypass and identity**
- `orgId`, `agentId`, `principal` and `context` in args were ignored. The receipt was stored under the trusted org.
- `resolveContext` throwing, hanging, returning `null` or returning malformed values gave `context_unavailable` and 0 calls.

**Blocked decisions**
- `deny`, `require_approval`, unknown tool and other-org context each gave 0 calls.
- Policy source cases gave 0 calls each:
  - throws or rejects: `policy_source_failed`;
  - hangs: `policy_source_timeout`;
  - returns a string, an object, `[null,1,'x']`, `undefined`, a garbage thenable, a Proxy that throws, or a getter-flipping policy: `unknown` / `policy_invalid`, `failed` or deny.
- Clock cases gave 0 calls: expiry before the claim; expiry after the claim (recorded `failed`); a clock going backwards; a NaN clock; a fractional clock.
- Invalid args gave 0 calls: missing or empty key, negative amount, string amount, an array, `null`, a JSON string.

**TOCTOU**
- Raw args mutated during the policy load, getter properties, a top-level Proxy and a foreign-prototype Proxy: the handler got the decided values.
- `args` and `request` were frozen against handler mutation.
- See L1 for the one gap (schema-retained references).

**Approvals**
- 17 placements, casings and nestings of the field: none executed, and none was stored or sent as authorization. Telemetry always sends `approvedBy: null`.

**Idempotency**
- 100 concurrent same-key calls on the in-memory store, and 80 across 4 libSQL connections to one file, each produced exactly 1 handler call and 1 owning row, with no `SQLITE_BUSY`.
- Same key with a different amount, a different order, another agent or no principal gave `idempotency_conflict`.
- A replay 48 h after expiry gave `replayed` and 0 calls.
- Cross-tenant key reuse: the claim is org-scoped (`(org_id, idempotency_key_hash)`). `findClaim` and `get` never return another org's row, and `finish` is org-scoped and only moves `attempted` rows.

**Receipts and SQL**
- All statements are parameterised. SQL metacharacters in the tool, policy, resource and key were stored as data and the table stayed intact.
- The DDL CHECKs reject claiming a non-allow decision or an unknown decision value.
- No raw key, `note` text or args appeared in stored rows.

**Outcome honesty**
- These handlers were all recorded `outcome_unknown`, never `completed`: a synchronous throw, a rejection, a hang, slow success past the timeout, a throwing `then` getter, `throw undefined`, and an ignored abort.
- A forged `Symbol('ark.guard.toolFailed')` or `Symbol.for(...)` is not treated as `toolFailed` (the symbol is module-private).
- Only `toolFailed()` gives `failed`.
- There was no automatic retry in any case, and same-key replays never re-ran.

**Telemetry**
- Throwing, slow (300 ms) and mutating synchronous sinks never changed a decision or execution.
- The payload is operation, outcome, decision id, agent id and status only: no args, note text, key or approver. See M1 for async sinks.

**Dependencies**
- `zod ^3.23.8` was already in the workspace (lockfile resolves 3.25.76, with no new tarball).
- `@ark/db` is a devDependency, used only by the demo and tests. `node:crypto` is built in.
- The lockfile diff only adds the workspace link. Nothing new is fetched.

**Secrets**
- There are no credentials in the diff, fixtures or evidence. The demo replaces `fetch` with a throwing stub.
