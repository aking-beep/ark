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

| | Before (`1507543`) | After (`ec786f1`, review round 1 fixes) |
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
| Guard + receipt-store tests | — | 68 (`@ark/guard`: 44 + 24 in `guard-hardening.test.ts`) + 11 (`action-receipts.test.js`, after the migration move), 0 failures |
| `npm test` (repo) | 633 (per the action-decision-kernel evidence) | exit 0. 723 tests, 0 failures across 13 suite runs, after merging `origin/main` (710 at `ec786f1`, before the merge) |
| `npm run typecheck` | — | exit 0 (includes `@ark/guard`) |
| `npm run build` (packages + consumer, business, control) | — | exit 0 |

`captures.tsv` has one `before` row and two `after` rows, all `dirty=0`. Only
the last `after` row (`ec786f1`) is current. The first (`2b8c55f`) predates the
round-1 review and security fixes. Its `after.txt` was overwritten. Against
`ec786f1`, every decision, decision id, digest, execution status and handler
count is the same. Two things changed:

- every `key_hash`, because the demo now derives the key from the order
  (`refund:<orderId>`, security M2);
- the receipt count line, which now reads the receipts back through
  `ActionReceiptStore.get`.

The `after.txt` header now takes its timestamp from `captures.tsv`, so the two
share one clock read (a review note).

After merging `origin/main` (`e5eb6e6`), `npm run demo:guard` printed output
byte-identical to `after.txt` (diffed with the temp-dir line excluded). The
merge changed no guard source, so the `ec786f1` after capture still describes
current behaviour, and no new capture row was stamped. `after-test.txt` was
re-run at `e5eb6e6` to include the migration tests.

**The tests can fail.** I ran two source mutations and reverted both:

- Replacing the atomic `claim` with a plain insert failed 13 tests. Among them
  were all four race tests (in-memory and libSQL with two connections, each
  with one clock tick and with distinct ticks) and both scenario tables.
- Disabling the sender-approval strip failed 3 tests.
- Round 1: mapping a replay back to telemetry `ok` failed 4 tests.
- Round 1: dropping the neutralisation of a rejected sink promise failed the
  async-sink test with an `unhandledRejection`.

## Review round 1 and security review fixes (`ec786f1`)

Each fix has a test in `packages/guard/src/guard-hardening.test.ts`.

- **Blocking, criterion 4 / security L4: replay telemetry.**
  - A replay is reported as `blocked`, with `replay: true`, the original's
    status and the original's decision id in metadata. It is never `ok`.
  - Only an executed call emits `ok`, so one refund replayed three times is one
    completed observation.
  - The replay of an `outcome_unknown`, `failed` or still-`attempted` call is
    asserted to fall outside `COMPLETED_OUTCOMES`.
- **M1: async telemetry sink.**
  - The observation is built from the final result and handed to the sink with
    `setImmediate`, inside its own `try`, after the result is returned.
  - A returned thenable gets a no-op rejection handler. A `then` getter that
    throws is caught.
  - Tested with an async rejecting sink while an allowed call is in flight:
    0 unhandled rejections, the handler completes, the receipt reads
    `completed`.
  - A 200 ms synchronous sink no longer delays the result.
- **M2: caller-chosen keys.**
  - The demo derives the key on the server side (`refund:${orderId}`), and the
    README recommends this pattern.
  - The README's Known limits now say that idempotency stops accidental retries
    only and that per-call thresholds are not cumulative.
  - A test documents the limit: three caller-chosen keys on one order execute
    three times.
  - **Follow-up, not built here:** cumulative / per-resource limits
    (sum-per-resource, velocity) in the decision kernel, before real payments.
- **L1: handler arguments.** Parsed arguments are `structuredClone`d to plain
  data and frozen before `toRequest`, and the handler gets that same copy.
  - An own getter is read exactly once, and the handler sees the decided
    value.
  - A class-instance prototype getter is never run.
  - Arguments that cannot be cloned (a function) are `invalid_arguments`.
  - The JSDoc and README say to act on `request`.
- **L2: approval fields.**
  - A recursive, bounded, getter-free scan flags any key that starts with
    `approv` once lower-cased with non-alphanumerics stripped. That covers
    `approved-by`, `approvalToken`, `approverId`, a zero-width-space suffix,
    and nested or array placements.
  - Top-level matches are removed before validation.
  - Look-alikes (`approximateTotal`, `approach`) are not flagged.
- **L3: malformed store answers.**
  - Only `claimed === true` executes.
  - `claimed: false` needs `existing` to be `null` or a well-formed receipt.
  - Any other answer (`undefined`, `null`, `{}`, `'yes'`, `1`, a malformed
    `existing`), a synchronous throw or a missing method resolves to `blocked`
    `receipt_store_failed`. It never rejects.
- **Non-blocking notes taken:**
  - Store timeouts: every receipt-store call is bounded by `timeouts.storeMs`
    (default 2 s), with tests. A hang before execution blocks. After execution,
    the result carries the true outcome plus `receipt_update_failed`, and the
    row stays `attempted`.
  - A comment on `sameRequest` records its dependency on kernel normalization.
  - PII warnings are on `TrustedContext.principal`, `GuardedAction.toRequest`
    and the receipt type.
  - `demo/run.ts` reads receipts through `ActionReceiptStore.get`.

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
- **Approval detection is a name heuristic.** It flags keys that start with
  `approv` after normalisation, up to depth 8 and 2,000 keys. It does not catch
  a field named something else (`signedOffBy`). Nothing in the guard ever reads
  an approval from the arguments, so a miss only under-reports the flag.
- **Idempotency is not a limit.** A caller-chosen key that changes is a new
  action, and policy thresholds are per call. The demo's derived key allows one
  refund per order, but nothing bounds refunds across orders. Cumulative limits
  are a follow-up.
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
- **Security review findings are fixed, not re-reviewed.** `SECURITY.md`
  approved with notes (2 medium, 4 low). The fixes above have not yet been
  re-reviewed by the security reviewer.
- **Latency was measured on one machine.** The figures are in `latency.txt`.
  Load and contention were not tested.

## Deviations

1. **Resolved: `action_receipts` is now three tracked migrations.**
   - *Before:* PR-1 (tracked migrations, #21) was not in the original base, so
     the table and its two indexes were first added to the plain `DDL` list.
   - *Now:* PR-1 and PR-2 merged to `main` (`f80c0ca`), and `origin/main` was
     merged into this branch as a merge commit, not a rebase. The `sql.ts`
     conflict was resolved by moving the three statements into `MIGRATIONS` in
     `packages/db/src/sql.ts`:
     - `0008_action_receipts`
     - `0009_action_receipts_idempotency_idx`
     - `0010_action_receipts_created_idx`
   - They use the same `{ id, sql }` shape and the same `applyMigration` /
     `isBenignMigrationError` path as 0001–0007. `DDL` no longer mentions the
     table.
   - Every statement is `CREATE … IF NOT EXISTS`, so it is safe on a fresh
     database and on one where the earlier build created the table from the
     DDL list. Neither case needs a tolerated error.
   - Tests in `action-receipts.test.ts`:
     - a fresh `pushSchema` records exactly 0008–0010 and creates the table and
       both indexes;
     - a second push is a no-op (the ids and `applied_at` are unchanged);
     - a database that already had the table and a claimed row upgrades
       without error and keeps the row.
     The existing `migrations.test.ts` (from PR-1) covers all ids, including
     the new ones.
   - `openActionReceiptStore(url)`, for a database that holds only receipts,
     runs the same three statements (`ACTION_RECEIPTS_DDL`, now derived from
     `MIGRATIONS`) without recording them.
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
   - Default timeouts: context 1 s, policy 1 s, handler 10 s, receipt store
     2 s. Each is configurable.
   - A store that fails or times out after the handler ran: the security note
     suggested recording `outcome_unknown` best-effort. I did not, because the
     guard knows the true outcome then. The result reports it, with
     `receipt_update_failed`, and the row keeps `attempted`, which the schema
     already defines as "possibly executed". A second write could also race a
     late-landing first write; `finish` moves a row out of `attempted` only
     once, so whichever lands first would win.
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
  - in-memory store: 0.30 ms per allow, 0.21 ms per deny;
  - temp libSQL file: 3.9 ms per allow, 2.4 ms per deny.
  Cloud cost: none.
- **Observability for new failure modes:** every failure mode has its own
  `reason_code` or `execution_status` on the receipt: policy source down or
  slow, expired decision, key conflict, store failure, `outcome_unknown`. A
  receipt write or update that fails surfaces as a `notes` entry on the result.
  The same outcome is reported best-effort as `mcp`/`tool` evidence through
  `@ark/sdk`. No Control UI reads receipts yet; that is PR-4, out of scope.
- **Docs or ADR updated:** yes. See deviation 9.
- **Rollback:** revert the branch. `action_receipts` is new and unused by the
  old code. A pushed database keeps the table and its three `schema_migrations`
  rows (0008–0010). Both are harmless to the old code. To remove them by hand:
  `DROP TABLE action_receipts` and delete those three ids.
- **Authorization and privacy review:** `SECURITY.md` (round 1) approved with
  notes. Every medium and low finding is fixed and tested, per "Review round 1
  and security review fixes". The fixes have not been re-reviewed.
