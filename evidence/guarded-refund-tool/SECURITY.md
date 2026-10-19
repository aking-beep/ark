# Security review — guarded-refund-tool

**Reviewer:** security reviewer (`agents/security-reviewer.md`, under `factory/GOVERNANCE.md`), separate context from the builder and the general reviewer.
**Scope:** `git diff 60f94ec..5758c13` (PR-3, stacked on the security-approved PR-2 decision kernel). Inputs: `specs/guarded-refund-tool.md`, the diff, `evidence/guarded-refund-tool/`. The kernel (`decideAction`) was treated as approved and only re-tested where the guard depends on it.
**Method:** `npm run build:packages`, then attack scripts written against the built `dist` (session scratchpad, `secreview-guard/a1`–`a6`; not committed). Node v22.22.0, temp libSQL files, no network.

## Verdict

_Round 1 verdict, superseded by **Re-review (round 2)** at the end of this file: **APPROVE**._

**APPROVE WITH NOTES.** No critical or high findings. The handler was never invoked on any deny / unknown / require_approval / invalid / expired / context-failure / policy-failure path tried, identity never came from arguments, forged approvals never reached execution or storage, and the libSQL claim held under concurrency across four connections. Two medium findings (M1, M2) should be fixed or explicitly documented before this guard protects real money; neither blocks this synthetic PR.

---

## Medium — M1: an async telemetry sink that rejects crashes the process and abandons in-flight guarded executions — resolved

**File:** `packages/guard/src/guard.ts:229-259` (the call at `:238`, `sink.evidence({...})`).

`emit` wraps `sink.evidence(...)` in a synchronous `try/catch`. If the sink returns a rejected promise (an `async` sink, a JS integration, or a cast), the rejection escapes the `try` and becomes an unhandled rejection. Node 22's default (`--unhandled-rejections=throw`) terminates the process. Spec criterion 5 says a telemetry failure never changes a decision or an execution; here it can kill every concurrent guarded call mid-flight.

**Repro** (`a5-tele-crash.mjs`): start an allowed $75 refund whose handler takes 50 ms, then make a denied $5,000 call on the same guarded tool with `telemetry: { evidence: async () => { throw new Error('sink down') } }`. The process exits with `Error: sink down` from `emit` (`dist/guard.js:97`) before the in-flight handler finishes. Its receipt stays `attempted` (the key is spent and the outcome is lost). `a4-outcome.mjs` saw 2 unhandled rejections from the same sink.

The shipped `@ark/sdk` `TraceHandle.evidence` is synchronous and its type (`GuardTelemetry = Pick<TraceHandle, 'evidence'>`) rejects an async function in TypeScript, so the demo path is safe. That is why this is medium and not high.

**Fix:** keep the return value and neutralise it: `const ret = sink.evidence(...); if (ret && typeof (ret as any).then === 'function') (ret as any).then(undefined, () => {});`. Optionally run `emit` via `queueMicrotask` inside its own try so that a slow synchronous sink cannot delay the result either. (A 300 ms busy sync sink delayed the return by 300 ms but changed nothing.) Add a test with an async rejecting sink.

## Medium — M2: replay protection is only as strong as a caller-chosen key, and nothing bounds repeated refunds of one order — resolved

**Files:** `packages/guard/src/demo/refund.ts:95` (`idempotency: { key: (a) => a.idempotencyKey }`), `packages/guard/src/guard.ts:296-304`, `packages/guard/README.md:253-267` ("What happens on each call", steps 5–6).

The idempotency key comes from the tool arguments, which the agent controls. Keys are hashed byte-exactly, with no normalisation. A replay with the same key is correctly suppressed. A replay with a *new* key is a new action, though, and the kernel's per-call thresholds have no per-resource or cumulative limit. The guard therefore stops one $5,000 refund but allows fifty $100 refunds of the same order.

**Repro** (`a3-idem.mjs`): 60 calls of `refund_order` on `ord_drain` for $100 each with keys `drain-0…59` executed 60 times, $6,000 total, every one `allow`. The keys `norm`, `norm ` (trailing space), `NORM`, NFD `nörm` and NFC `nörm` on one order executed 5 times.

The spec defines the replay scenario as "same idempotency key", so the build meets its acceptance criteria. The README says the key prevents re-execution, though, and does not say that a caller who varies the key is not stopped. For a money-movement boundary that gap should be stated, not discovered.

**Fix:**
1. In the README's Known limits, state that idempotency guards against accidental retries, not against a caller that mints new keys, and that per-call policy thresholds are not cumulative.
2. Recommend deriving the key server-side or from the resource where the business allows one refund per order (e.g. `key: (a) => \`refund:${a.orderId}\``), and do that in the demo.
3. Track cumulative / per-resource limits (velocity or sum-per-resource) as a kernel follow-up before real payments.

---

## Low — L1: handler `args` are not bound by the digest when the schema keeps references — resolved

**File:** `packages/guard/src/guard.ts:287-290` (parse, `deepFreeze`), `:460` (handler gets `args` and `request`).

`deepFreeze` freezes own data properties, but it cannot pin accessors on prototypes, and zod keeps references for `z.any()`, `z.unknown()`, `z.custom()` and `.passthrough()` nested values. Repro (`a1-bypass.mjs`): a schema with `meta: z.any()` and a class instance whose `amt` getter returns 7500 then 500000. `toRequest` mapped 7500 (allowed). The handler read `args.meta.amt === 500000` while `request.attributes.amountMinor === 7500`. The demo handler uses `request` only, so the demo is not affected. Top-level getters, Proxies (including a foreign-prototype Proxy) and mutating the raw object during the policy load were all snapshotted correctly; the handler saw the decided values in every case.

**Fix:** after `safeParse`, `structuredClone(parsed.data)` (a failure means `invalid_arguments`) and then freeze, so the handler's `args` are plain data. State in the `HandlerInput.args` JSDoc and the README that handlers must act on `request`, and treat `args` as advisory.

## Low — L2: sender-approval detection is top-level and exact-name only, so variants go unflagged — resolved

**File:** `packages/guard/src/guard.ts:162` (`SENDER_APPROVAL_KEY`), `:194-208`.

`approvedBy`, `APPROVED_BY`, `approval`, `approvals`, `approved` and `approver` are stripped and flagged. `approved-by`, `approvalToken`, `approverId`, `approvedBy​`, nested `meta.approvedBy` and a JSON `__proto__` key carrying `approvedBy` are not flagged (`senderReportedApproval=false`). None of them executed (all `pending_approval`), and none was stored in a receipt or sent in telemetry: the guard has no approval path, so nothing can be "accepted". With a `.passthrough()` schema, `approved-by` and nested `meta.approvedBy` do reach the handler's `args`. The impact is under-reporting in the audit flag, not bypass.

**Fix:** flag on a recursive scan with a normalised name (lower-case, strip non-alphanumerics, match `^approv`), and keep removing only the top-level exact names. Document that handlers must never read approval from `args`.

## Low — L3: the claim result is checked by truthiness, and a misbehaving store makes `guarded()` reject — resolved

**File:** `packages/guard/src/guard.ts:405-433` (`if (!claim.claimed)` at `:416`; `sameRequest(owner, n)` at `:421`).

A store returning `{ claimed: 'yes' }` or `{ claimed: 1 }` caused execution. A store returning `undefined`, `null` or `{}` made the guarded handler reject with a TypeError instead of returning a typed `blocked` result (the handler was not invoked). Stores are trusted components, so this is defence in depth.

**Fix:** `if (claim?.claimed !== true)`. Validate `existing` (null or a receipt with string `requestDigest` and number `createdAt`). Wrap the not-claimed branch in try/catch and return `blocked` / `receipt_store_failed`.

## Low — L4: telemetry reports a replay as `ok` whatever the first attempt's status — resolved

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

---

# Re-review (round 2)

**Scope:** `git diff a19f7a5..f5e6a94`. That covers the fix commit `ec786f1`, the evidence `1e89b24`, and the merge of origin/main `e5eb6e6` that moves `action_receipts` into tracked migrations 0008–0010, with test output in `f5e6a94`.

**Method:** a fresh `npm run build:packages`. Package tests pass: `@ark/guard` 68/0 and `@ark/db` 108/0.

I re-ran the round-1 attacks `a1`–`a6`. The demo now derives its key from the order, so I also ran `a1b` and `a3b`, which do the same against a caller-keyed tool to keep testing the claim path. New attacks:
- `a7`: the derived key;
- `a8`: migrations;
- `a9`: sink isolation, cloned arguments, approval scan, store timeouts, and deviation 8.

All scripts are in the session scratchpad (`secreview-guard/`) and are not committed.

## Verdict (round 2)

**APPROVE.** There are no open critical, high or medium findings. M1, M2 and L1–L4 are resolved, and the headings above are marked. Five new low or informational notes follow; none blocks.

## Round-1 findings, re-tested

- **M1 — resolved.** `emit` builds the observation, then calls the sink in `setImmediate` inside its own `try` (`packages/guard/src/guard.ts:341-383`). A returned thenable gets a no-op rejection handler, and a throwing `then` getter is caught.
  - The repro `a5-tele-crash.mjs` now exits 0. The in-flight call finishes `executed` and its row reads `completed`.
  - In `a9`: async-rejecting, sync-throwing, throwing-`then`, late-rejecting thenable and 250 ms busy sinks gave 0 unhandled rejections. The result was returned before the sink ran (2–6 ms).
  - A re-entrant sink that calls the tool again with the same key cannot cause a second execution.
- **M2 — resolved (documented, demo fixed, follow-up tracked).**
  - The README states that idempotency stops accidental retries, not a caller that mints keys, and that thresholds are per call (`packages/guard/README.md:27-29`, `:124-128`).
  - The demo derives the key as `refund:${orderId}`. `a7`: a second refund of the same order with a different amount and a different caller key gives `idempotency_conflict`, with 0 extra calls. The round-1 drain repro on the demo tool now executes 1 time, not 60.
  - On a tool whose key the caller chooses, the drain still executes 60 times (`a3b`). That is the documented limit.
  - Cumulative / per-resource limits are recorded as a kernel follow-up before real payments (EVIDENCE.md). That is the right place for them.
- **L1 — resolved.** Parsed arguments are `deepFreeze(structuredClone(...))` (`guard.ts:415`). `a9` covered these cases:
  - an own getter inside `z.any()` is read once, and the handler's `args` equal the decided request;
  - a Proxy or a function inside `z.any()` gives `invalid_arguments`;
  - a getter produced by a zod `.transform` is snapshotted;
  - `toRequest` cannot mutate what the handler sees.

  The round-1 prototype-getter repro is now blocked, because the getter is never copied.
- **L2 — resolved.** A recursive, getter-free scan flags any key that starts with `approv` once normalised (`guard.ts:188-238`).
  - `a2` flagged all 17 variants with 0 executions.
  - Array elements and accessor-defined `approvedBy` are flagged.
  - The look-alikes `approximateTotal` and `approach` are not flagged.
  - Top-level matches are stripped, so a `.passthrough()` handler no longer sees `approved-by`.
- **L3 — resolved.** Only `claimed === true` executes. `claimed: false` needs `existing` to be `null` or `isReceipt` (`guard.ts:541-558`). These all gave `blocked` / `receipt_store_failed` with 0 calls:
  - `undefined`, `null`, `{}`, `'yes'` and `1`;
  - a store without `claim()`;
  - a claim that hangs (bounded by `storeMs`).
- **L4 — resolved.** A replay emits `outcome: 'blocked'`, with `replay: true` and the original's status in metadata (`guard.ts:312-324`, `:346-366`).

## New attack areas

**Store timeouts before execution (`a9`)**
- Hung `claim`: blocked, 0 calls.
- Hung `record` on a deny: blocked within the timeout, with `receipt_write_failed`.
- A claim that lands *after* the guard timed out: the first call reports `blocked` and the row later appears as `attempted`. A retry with the same key then replays `attempted`, with 0 calls in total.
- A retry sent *before* the late claim lands: exactly 1 execution. The late insert loses on the unique index.
- No ordering of a slow claim produced two executions.

**Deviation 8: after a post-handler store failure, `attempted` is not overwritten. This is safe.**
- `attempted` is the schema's "possibly executed". It never claims `not_attempted`, and it keeps the key spent, so no later call can re-execute (`a9`: `finish` hangs after success, the result is `executed` with `receipt_update_failed`, and the next same-key call is `replayed` with 0 extra calls).
- The guard issues only one `finish` per claim. `finish` moves a row only out of `attempted` (libSQL `WHERE execution_status = 'attempted'`; the memory store likewise), so a late-landing write sets the true final status once, with no race. In `a9`, a late finish made 1 write and the row ended `completed`.
- A handler throw followed by a failed `finish` reports `outcome_unknown` to the caller, and the row stays `attempted`. It never reads `completed`.
- Writing `outcome_unknown` best-effort instead would add a second write that could race the late first write, for no safety gain. The cost is operational only: rows stuck at `attempted` need reconciling against the system of record, which the README already says.

**Migrations 0008–0010 (`a8`)**
- **Fresh DB:** 0001–0010 are recorded once, a second push is idempotent, the partial unique index exists, and 5 concurrent claims produce 1 owner.
- **DB created by the round-1 DDL**, with live `attempted` and `not_attempted` rows: the push succeeds, rows are preserved, 0001–0010 are recorded, and the old owner still blocks its key.
- **Pre-PR main DB** with no `action_receipts`: the table and index are created.
- **Receipts-only DB** from `openActionReceiptStore` followed by `pushSchema`: OK.
- **Table without the index and with duplicate owners:** 0009 fails with `SQLITE_CONSTRAINT_UNIQUE`, is not recorded, and the push rejects. It fails closed rather than silently running non-unique.

### Low — R2-L1: a pre-existing index with the expected name but a weaker definition satisfies migration 0009

**File:** `packages/db/src/sql.ts` (`ACTION_RECEIPTS_IDEMPOTENCY_IDX`, `CREATE UNIQUE INDEX IF NOT EXISTS`).

**Repro** (`a8` case f): create a non-unique `action_receipts_idempotency_idx` by hand, then `pushSchema`. Two concurrent claims for one key both win. Reaching this needs prior manual tampering with the database; no shipped code path creates the weak index.

**Fix (optional hardening):** at `openActionReceiptStore` or `pushSchema` time, assert that `PRAGMA index_list(action_receipts)` reports this index as `unique = 1` and `partial = 1`, and refuse to start otherwise.

### Low — R2-L2: a top-level Proxy whose `ownKeys` or `getOwnPropertyDescriptor` trap throws makes the guarded call reject

**File:** `packages/guard/src/guard.ts:233` (`Object.entries(raw)` in `stripSenderApproval`, outside any `try`).

The scan at `:214-218` is wrapped, but the copy is not. The result is a thrown `nope` rather than a typed `blocked` / `invalid_arguments`. No handler call and no receipt follow, so the call fails closed. MCP arguments arrive as JSON, so this is not reachable from an agent, only from in-process callers.

**Fix:** wrap the copy, and treat a throw as `invalid_arguments`.

### Low — R2-L3: the approval flag is bounded, so deep nesting or key padding hides it

**File:** `packages/guard/src/guard.ts:192-193`.

Nesting at depth 8 or more, or more than 2,000 keys visited before the approval key, gives `senderReportedApproval = false` (`a9`). This affects the audit flag only. The call stayed `pending_approval`, and nothing reads approval from arguments. The bounds are a reasonable DoS trade-off.

**Optional:** when a bound is hit, set the flag (or a distinct `approval_scan_truncated` note) rather than clearing it.

### Informational

- **Late-landing claim:** a claim that times out but lands later leaves a never-executed row reading `attempted`, and its key is spent (see "Store timeouts before execution"). This is conservative for money. It needs reconciling, and the README already says `attempted` means "possibly executed".
- **Buggy store returning another org's owner:** if a buggy store answers `claimed: false` with an `existing` receipt from another org that carries the same digest, the guard accepts it as a replay (0 calls, no execution). Optional: also require `owner.orgId === ctx.orgId` before treating it as a replay.

## Round 2: re-checked and held

- Every round-1 check in `a1`/`a1b`, `a2`, `a3b`, `a4` and `a6` passes on the new code. The round-1 scripts that still use the demo's caller-supplied key report expected differences only; those are covered by `a7`.
- The libSQL claim across 4 connections: 80 concurrent calls gave 1 execution.
- Cross-org reuse of one key: the claims are independent and org-scoped.
- Outcome honesty: every throw and timeout gave `outcome_unknown`. Forged `toolFailed` symbols are not honoured.
- Telemetry payload: no arguments, note text, key or approver.
- No new dependencies. `structuredClone` and `setImmediate` are Node built-ins.
