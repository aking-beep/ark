# Review — tracked-migrations

Rounds are appended below, newest last. Never edit or delete a previous round.
Format and scoring rules: `factory/RUBRIC.md`.

## Round 1 — 2026-10-19 — 4/5

**Reviewer:** factory-reviewer subagent (Claude Opus 5.5), clean context, reviewer session 42ccb5e2-1f2c-54e6-b8a5-741f005f3fca. Not the builder. Inputs were only the spec, `git diff edba21e..HEAD` and `evidence/tracked-migrations/`.

**From the evidence alone, before reading the diff:** an operator whose migration is broken now gets a boot that refuses, naming the migration (`migration 9999_broken_probe failed: SQLITE_ERROR: no such table: no_such_table`). Before, the same push resolved and the failure disappeared. Applied migrations are now recorded once each (7 rows after push 1, still 7 after push 2), where before there was no history at all.

**Re-run by this reviewer:** `npm run build:packages` exit 0. `npm test --workspace @ark/db` gave 96 pass, 0 fail. `node evidence/tracked-migrations/probe.mjs` printed output identical to `after.txt`. I also ran three probes of my own (scratch scripts, not committed):
- **Atomicity.** A trigger on `schema_migrations` aborted the history insert for an injected `ALTER TABLE events ADD COLUMN zz`. The push rejected with `migration 9100_x failed: …` and column `zz` was **not** present afterwards, so the statement and its history row commit or roll back together.
- **Concurrent boot.** Four processes ran `pushSchema` at once on one local file, 5 trials fresh and 5 pre-tracking. Some processes failed with `SQLITE_BUSY`, but every failure came from lines this diff did not change: `PRAGMA table_info` in `hasLegacyKey` and the `DDL` loop. Base `edba21e` fails the same way on fresh files. No failure came from `applyMigration`. In every case a single re-run succeeded with 7 rows and all columns present.
- **Tolerance rule.** `CREATE INDEX IF NOT EXISTS t …` where `t` is a table fails with `there is already a table named t`. That message does not match `/already exists/`, so it stays a hard failure.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ❌ | AC2 says any other error "names the migration id and the underlying message". At `packages/db/src/sql.ts:188` (`if (record) await client.execute(mark);`), the history insert after a tolerated error is outside the `try` and is not wrapped, so its failure comes out as a bare `SQLITE_…` message with no migration id. This is the path every migration takes on a fresh DB and on the pre-tracking upgrade (the column or index already exists). Reproduced: with the insert forced to fail, the push rejected with `SQLITE_CONSTRAINT_TRIGGER: boom` and no id. Nothing is swallowed and boot does stop, but the message does not meet AC2 as written. |
| 2 | Evidence proves it | ✅ | Same committed probe, same Node (v22.22.0), temp libSQL files, no seed. Before captured at `1a49e35` before any source change, after at `b80dedf`, both `dirty=0` in `captures.tsv`. Readable without the diff. "What this does not prove" is specific: remote URL, real customer DB, real lock/disk-full, concurrent replicas, Docker. |
| 3 | Structure holds | ✅ | The change stays inside `packages/db`: `sql.ts`, a new test, `package.json` test registration, and docs. No edge or service code touched, no client constructed outside existing sites, no new dependency. |
| 4 | Fails safely | ✅ | No bare catch is left. Non-benign errors are rethrown with `cause`. `bootstrap.ts` prints and exits 1, and `entrypoint.sh` runs `set -euo pipefail`. Migration and history row are one `batch(…, 'write')` (verified above). A failure leaves earlier migrations recorded and later ones unapplied, and a re-run resumes. Replica races on the history row are absorbed by `INSERT OR IGNORE` plus the duplicate-column rule. The tolerance rule is tied to the statement kind and does not mask missing-table, locked, full, read-only or syntax errors. |
| 5 | Readable | ✅ | Comments explain why, not what: `OR IGNORE` for replicas, why the legacy pass does not record, why `migrations` is a parameter. Names are accurate. All five AC4 tests are present in `packages/db/src/migrations.test.ts`, and test 6 really tells a bare catch apart from the rule (it asserts the rebuild did not run). No dead or debug code. |

**Blocking:**
- `packages/db/src/sql.ts:188`: the history insert after a tolerated (benign) error is not wrapped, so a failure there (`SQLITE_BUSY`, `SQLITE_FULL`, `SQLITE_READONLY`) rejects the push without naming the migration, contrary to spec AC2 ("The error names the migration id and the underlying message"). To earn it back: make that insert fail with the same `migration <id> failed: <message>` form (with `cause`), and add a test in `migrations.test.ts` that forces the benign-path insert to fail and asserts the id is in the message. A trigger on `schema_migrations` that `RAISE(ABORT)`s for one id is enough.

**Non-blocking:**
- `packages/db/src/sql.ts:170`: the `already exists` branch for `CREATE INDEX IF NOT EXISTS` cannot fire, because SQLite never raises "already exists" for an `IF NOT EXISTS` index, and a name clash with a table gives `there is already a table named …`. It is harmless and the spec asks for it. The test fixture at `migrations.test.ts:105` (`index events_agent_idx already exists`) is a message this statement kind cannot produce, which a comment could say.
- Concurrent boot against one local SQLite file still fails some replicas with `SQLITE_BUSY` in unchanged code (`hasLegacyKey`, the `DDL` loop). Base `edba21e` does the same. It recovers on restart and is not caused by this diff. Before, the bare catch also hid `SQLITE_BUSY` inside the migration loop, so pre-tracking files "passed" more often on base. Failing loudly there is what the spec asked for. A busy timeout on the client would be a separate change.
- `bootstrap.ts` prints only `err.message`, so the `cause` attached in `applyMigration` is never shown. The message already carries the database error, so nothing is lost today.
- `migrations.test.ts:9`: the temp directory is never removed after the run.

## Round 2 — 2026-10-19 — 5/5

**Reviewer:** factory-reviewer subagent (Claude Opus 5.5), clean context, reviewer session 42ccb5e2-1f2c-54e6-b8a5-741f005f3fca. Not the builder. Inputs were only the spec, `git diff edba21e..HEAD` (HEAD `63b4bbb`) and `evidence/tracked-migrations/`.

**From the evidence alone, before reading the diff:** same as Round 1. A broken migration now stops the push and names itself (`migration 9999_broken_probe failed: SQLITE_ERROR: no such table: no_such_table`), where before the push resolved silently. A fresh DB records 7 migrations after push 1 and still 7 after push 2, where before there was no history table. EVIDENCE.md says why the after state was re-captured at `6ee592c`: the probe output did not change, and the benign-path change is covered by a named test.

**Re-run by this reviewer:** `npm run build:packages` exit 0. `npm test --workspace @ark/db` gave 97 pass, 0 fail. `npm run typecheck` exit 0. `node evidence/tracked-migrations/probe.mjs` printed output identical to `after.txt`. My own checks (scratch only, not committed):
- **Mutation check on the Round 1 fix.** I copied the built `sql.js` and `migrations.test.js` to scratch and put back the Round 1 line `if (record) await client.execute(mark);`. With that line restored, the new test "a failure recording a tolerated migration names the migration" fails and the other 10 pass. The test guards the fix.
- **End-to-end CLI.** I set up a DB with the DDL applied and a trigger that refuses the `0003` history row, then ran `node packages/db/dist/bootstrap.js` on it. It printed `migration 0003_events_cost_source failed: SQLITE_CONSTRAINT_TRIGGER: history write refused` and then the `caused by:` line, and exited 1. A database that could not be opened printed the libSQL `ConnectionFailed(...)` message and also exited 1.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | The Round 1 blocker is fixed. In `packages/db/src/sql.ts:189-194`, a failed history insert after a tolerated error now throws `migration <id> failed: <message>` with `cause` (shared helper at `:182`), so AC2 holds on every path. AC1, AC3, AC4 and AC5 are unchanged from Round 1 and still met. The `bootstrap.ts` cause printing is declared in EVIDENCE.md "Deviations". It only changes error output and does not touch seeding logic, so it stays inside scope. |
| 2 | Evidence proves it | ✅ | The same committed probe was run unchanged at `1a49e35` (before) and `6ee592c` (after), both `dirty=0` in `captures.tsv`, with the same Node v22.22.0 and temp libSQL files. EVIDENCE.md says plainly that the probe does not exercise the round-2 path and names the test that does. "What this does not prove" is still specific. |
| 3 | Structure holds | ✅ | Round 2 touches only `packages/db/src/sql.ts`, `bootstrap.ts` (the CLI edge, error output only) and `migrations.test.ts`. No client is constructed in a new place and no dependency was added. |
| 4 | Fails safely | ✅ | Both failure exits from `applyMigration` now give the same named error with `cause`. Nothing is swallowed (`if (!record) return;` only covers the legacy pass, which records nothing, as Round 1 established). The `bootstrap.ts` handler still exits 1 on every error, including errors with no `cause` and non-Error throws. |
| 5 | Readable | ✅ | The `failed` helper removes the duplicated message format, and the doc comment on `applyMigration` now mentions the history-insert case. The test fixture comments at `migrations.test.ts:128-133` say why the "already exists" branch is only a backstop and show the real table-clash text. The test temp directory is now closed and removed in `after()` (`:16-19`). No dead or debug code. |

**Blocking:** none.

**Non-blocking:**
- `packages/db/src/bootstrap.ts:69`: when the cause is a libSQL error, the `caused by:` line repeats the code that is already in the message (`caused by: SQLITE_CONSTRAINT_TRIGGER SQLITE_CONSTRAINT_TRIGGER: history write refused`), because `cause.message` already starts with the code. It is harmless but adds no information. Printing only `cause.code`, or skipping the line when the message already contains it, would make it tidier.
- `packages/db/src/bootstrap.ts:66-70`: the new cause-printing branch has no test. It is five lines of CLI output and I checked it by hand above, so it is not blocking.
- The Round 1 note on concurrent-boot `SQLITE_BUSY` in unchanged code (`hasLegacyKey`, the `DDL` loop) still applies. This diff does not cause it.
