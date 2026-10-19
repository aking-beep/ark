# Evidence — guarded-refund-tool

## What changed

A developer can now wrap one tool handler with `guardTool` from the new
`@ark/guard` library. The synthetic `refund_order` then runs only on an
unexpired `allow`: $5,000, a forged `approvedBy: "ceo"`, an unknown tool, another
org's context and a replayed idempotency key no longer execute. Every attempt
leaves a privacy-safe receipt in the new `action_receipts` table saying what was
requested, what was decided, and what actually happened (`completed`,
`outcome_unknown`, …). Before this change, the same calls made directly against
the handler all executed: 8 handler calls, $6,800 refunded, no receipts.

## How it was measured

From the worktree root, Node v22.22.0, after `npm ci && npm run build:packages`.
There is no network: the demo replaces `globalThis.fetch` with a function that
throws and counts its calls.

```
node evidence/guarded-refund-tool/unguarded-demo.mjs   # the 8 scenarios against the bare handler
npm run demo:guard                                     # the same 8 scenarios through guardTool, temp libSQL
```

The first command is the before artefact. `npm run demo:guard` did not exist
before this change, so the before capture records its `Missing script` failure.
I committed `unguarded-demo.mjs` (`1507543`) before stamping `before`. It is
unchanged since then. After the change it still shows the bare handler
executing everything, because calling the side effect directly bypasses the
guard (README, "enforcement boundary").

`capture.sh`, kept in the session scratchpad and not committed, runs both
commands and writes the command, Node version, commit and exit code into
`before.txt` and `after.txt`. The npm debug-log path in `before.txt` was
replaced with `<npm log path>`.

The integration tests were run with the spec reporter. The output is in
`after-test.txt`:

```
cd packages/guard && node --test --test-reporter=spec dist/demo/refund.test.js dist/guard.test.js dist/memory-store.test.js
cd packages/db && node --test --test-reporter=spec dist/action-receipts.test.js
```

The demo output does not depend on the machine. The demo clock is injected: it
starts at `2026-10-19T09:00:00Z` and ticks 1 ms per read. Decision ids, digests
and key hashes are therefore identical on every run. The temp directory name
is the only line that changes.

## Before / after

| | Before (`1507543`) | After (`2b8c55f`) |
|---|---|---|
| Artefact | `before.txt` | `after.txt`, `after-test.txt` |
| $75 | executed | `executed`, allow, 1 call |
| $750 | executed | `pending_approval`, 0 calls |
| $5,000 | **executed** | `blocked`, deny, 0 calls |
| unknown tool (`billing`) | executed | `blocked`, unknown `no_matching_policy`, 0 calls |
| context for another org (args claim `org_demo`) | executed | `blocked`, unknown `no_matching_policy`, 0 calls, receipt stored under `org_other` |
| forged `approvedBy: "ceo"` on $750 | **executed** | `pending_approval`, 0 calls, `sender_reported_approval=true` |
| $75 replayed, same key | executed again | `replayed`, 0 calls (pair total 1), original `completed` |
| handler throws after start | threw, nothing recorded | `execution_failed`, `outcome_unknown`, 1 call, not retried |
| Handler calls / refunded | 8 / $6,800.00 | 2 / $75.00 |
| Receipts | 0 | 8 |
| Telemetry | — | 1 POST attempt to a transport that always fails. Flush rejected; no outcome changed |
| `npm run demo:guard` | exit 1 `Missing script` | exit 0 |
| Guard + receipt-store tests | — | 44 (`@ark/guard`) + 9 (`action-receipts.test.js`), 0 failures |
| `npm test` (repo) | 633 (per the action-decision-kernel evidence) | exit 0. 686 tests, 0 failures across 13 suite runs |
| `npm run typecheck` | — | exit 0 (includes `@ark/guard`) |
| `npm run build` (packages + consumer, business, control) | — | exit 0 |

`captures.tsv` has one `before` and one `after` row, both `dirty=0`.

**The tests can fail.** I ran two source mutations and reverted both:

- Replacing the atomic `claim` with a plain insert failed 13 tests. Among them
  were all four race tests (in-memory and libSQL with two connections, each
  with one clock tick and with distinct ticks) and both scenario tables.
- Disabling the sender-approval strip failed 3 tests.

## What this does not prove

- **Only routed calls are guarded.** The guard protects the handler you pass
  to it, and nothing else. `unguarded-demo.mjs` still executes $5,000 after
  this change because it calls the side effect directly. Whether an agent can
  reach the side effect any other way is a deployment property, and nothing
  here checks it.
- **No approval workflow exists.** `pending_approval` is terminal in this
  release. Nothing can approve a request, and nothing here shows that a future
  approval credential would be bound correctly.
- **Concurrency was tested in one process.** The race tests run 12 concurrent
  calls over one in-memory store, and over two libSQL connections to one local
  file. They do not cover separate OS processes, remote libSQL/Turso, or any
  other database. The in-memory store protects one process only (README).
- **Trusted context is assumed, not verified.** The guard believes whatever
  `resolveContext()` returns. It cannot detect a resolver that reads identity
  from the request.
- **Sender-approval detection is top-level only.** Keys matching
  `approved_?by|approver|approval|approvals|approved` (case-insensitive) are
  removed. A nested `{ meta: { approvedBy } }` is not detected. It is still
  never read for authorization, but it is not flagged either.
- **Privacy is a property of the field list.** The test scans stored receipts
  for the raw key, an email, a card number, an API-key-shaped value and a
  prompt. It cannot stop a caller from using an email address as `resource_id`
  or `principal`. The key hash is unsalted SHA-256, so a guessable key can be
  brute-forced (README).
- **A timeout does not stop the handler.** On timeout the guard aborts the
  handler's `AbortSignal` and records `outcome_unknown`. A handler that ignores
  the signal may still complete, and the receipt is not updated afterwards.
- **Telemetry was not tested against a live Control.** It was exercised against
  a throwing sink, a recording sink, and an `@ark/sdk` `ArkIngest` whose
  transport always fails. No guard evidence was posted to a running Control.
- **No security review yet.** The spec requires `agents/security-reviewer.md`
  (focus: identity from arguments, replay, claim races). It has not run.
- **Latency was measured on one machine.** The figures are in `latency.txt`.
  Load and contention were not tested.

## Deviations

1. **`action_receipts` comes from the existing DDL list, not a tracked
   migration.** PR-1 (tracked migrations, #21) is not in this base, so the table
   and its two indexes were added to `DDL` in `packages/db/src/sql.ts`
   (`CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`).
   `pushSchema` creates them on every boot, and old code never reads them.
   When PR-1 lands, these three statements should move into a numbered
   migration.
2. **Receipt types live in `@ark/core`.** `ActionReceipt`,
   `ActionReceiptStore`, `ClaimResult`, `ExecutionStatus` and the guard reason
   codes are in `packages/core/src/governance/receipt.ts`. The file is types
   plus two `as const` arrays and has no runtime imports, so it does not grow
   the business client bundle. Putting them there lets `@ark/db` (libSQL
   adapter) and `@ark/guard` (in-memory adapter, consumer) share one interface
   without depending on each other. `npm run build` passes, including
   `@ark/business`.
3. **Dependencies.**
   - `zod` (`^3.23.8`) is a direct dependency of `@ark/guard`. The spec requires
     zod validation, and the range is the same as `@ark/core`'s. It resolves to
     the existing 3.25.76, so the lockfile has no new third-party package.
   - `@ark/db` is a **devDependency** of `@ark/guard`, used only by the demo and
     the tests (temp libSQL store). The spec names `@ark/core` and `@ark/sdk`
     only, so I am declaring this one here.
   - `@ark/sdk` is imported as a type only (`TraceHandle`). The caller passes a
     handle in.
   - The guard hashes the idempotency key with `node:crypto`. No app imports
     `@ark/guard`, so this does not repeat the `node:crypto` bundle failure that
     the kernel hit.
4. **Idempotency conflicts are detected without storing an extra digest.** The
   kernel's `requestDigest` includes `now`, so a later call with the same
   arguments never has the same digest. To compare against the claim, the guard
   recomputes this request's digest at the claim's own `now` (`created_at`,
   which the guard sets to the decision time) and compares it with the stored
   `request_digest` (`sameRequest` in `guard.ts`). Same org, agent, principal,
   tool, action, resource and attributes means a replay. Anything else is
   `idempotency_conflict`. This keeps the receipt to exactly the spec's field
   list.
5. **The claim is the receipt row.** I did not add a separate claim table.
   - A receipt is inserted as `attempted` with
     `INSERT … ON CONFLICT DO NOTHING`, against a partial unique index on
     `(org_id, idempotency_key_hash) WHERE execution_status <> 'not_attempted'`.
   - Blocked, pending and replay receipts are `not_attempted`. They keep their
     key hash for audit, but they do not own the key.
   - Two CHECKs refuse any non-`not_attempted` row that is not an `allow` with
     a key.
   - `ON CONFLICT DO NOTHING` was chosen over `INSERT OR IGNORE` because OR
     IGNORE would also swallow those CHECK violations.
6. **A receipt id is the decision id, so it is unique per decision, not per
   call.** The decision id is a content hash that includes `now` in ms. When two
   calls with identical requests land in the same millisecond, the second gets
   the same id.
   - If the second call uses the same key, it is a replay.
   - If it uses a different key, it is blocked as `receipt_conflict`, because it
     could not store a receipt of its own and nothing runs without one.
   - With a real clock this needs two identical refunds in one ms. A test pins
     the behaviour.
7. **Guard reason codes.** Some reasons come from the guard rather than the
   kernel: `context_unavailable`, `invalid_arguments`,
   `idempotency_key_missing`, `policy_source_failed`, `policy_source_timeout`,
   `decision_expired`, `idempotency_replay`, `idempotency_conflict`,
   `receipt_conflict`, `receipt_store_failed`. When one applies, it is stored
   in `reason_code` and replaces the kernel's. `decision` and `id` stay the
   kernel's for the request as the guard submitted it. For invalid arguments,
   that request has no resource, so the kernel answers `deny`.
8. **Choices the spec left open:**
   - No trusted context means no receipt, because there is no org to store it
     under. The result is `blocked` `context_unavailable`.
   - The idempotency check runs after an `allow`. If a reused key arrives with
     arguments the policy does not allow, the call is blocked or pending by the
     decision, not reported as `idempotency_conflict`.
   - A replay returns the first receipt (`original`) and its execution status.
     It does not return the handler's return value, because that is not stored.
   - `failed` means the side effect definitely did not happen. Either the
     handler returned `toolFailed()`, or the decision expired between the claim
     and the handler. Any throw or timeout is `outcome_unknown`.
   - `attempted` is written before the handler is invoked. A crash leaves the
     row reading "possibly executed", and the key stays spent.
   - A decision is fresh only while `decision.now <= clock() < expiresAt`. It is
     checked before the claim and again after it. A clock that runs backwards
     counts as stale (`decision_expired`).
   - Default timeouts: context 1 s, policy 1 s, handler 10 s. Each is
     configurable.
   - Telemetry uses `TraceHandle.evidence` (protocol `mcp`, kind `tool`,
     `evidenceRef` = decision id), not `TraceHandle.action`. Control counts
     action rows as actions taken, which would be wrong for blocked attempts.
     `approvedBy` is always `null`.
9. **Docs:** `docs/01-architecture.md` gained an "Action enforcement layer"
   paragraph. `packages/guard/README.md` holds the boundary caveats. No ADR was
   needed, because ADR-0009 already decided the in-process guard.

## Definition of done

- **Cost / latency impact:** no model call and no network call. Each guarded
  call adds one synchronous `decideAction`, plus one insert (blocked or pending)
  or one insert and one update (executed). Measured with
  `node evidence/guarded-refund-tool/latency.mjs`, n=500 each, on one machine
  (`latency.txt`):
  - in-memory store: 0.26 ms per allow, 0.18 ms per deny;
  - temp libSQL file: 4.9 ms per allow, 2.5 ms per deny.
  Cloud cost: none.
- **Observability for new failure modes:** every failure mode has its own
  `reason_code` or `execution_status` on the receipt: policy source down or
  slow, expired decision, key conflict, store failure, `outcome_unknown`. A
  receipt write or update that fails surfaces as a `notes` entry on the result.
  The same outcome is reported best-effort as `mcp`/`tool` evidence through
  `@ark/sdk`. No Control UI reads receipts yet; that is PR-4, out of scope.
- **Docs or ADR updated:** yes. See deviation 9.
- **Rollback:** revert the branch. `action_receipts` is new and unused by the
  old code. A pushed database keeps an empty, harmless table. Drop it by hand
  if wanted: `DROP TABLE action_receipts`.
- **Authorization and privacy review:** pending. `agents/security-reviewer.md`
  must run before ship, per the spec's Risk section.
