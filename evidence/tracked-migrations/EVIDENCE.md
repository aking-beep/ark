# Evidence — tracked-migrations

## What changed

A schema migration that fails at boot now stops `pushSchema` with an error that
names the migration id and the database error, instead of being silently
swallowed; every applied migration is recorded once in `schema_migrations`, and
a second push records nothing new.

## How it was measured

`evidence/tracked-migrations/probe.mjs`, committed before any source changed and
run unchanged both times, from the repo root, after `npm ci && npm run build:packages`:

```bash
node evidence/tracked-migrations/probe.mjs
```

It imports the built `packages/db/dist/sql.js` and, against libSQL files in a
fresh `mkdtemp` directory (Node v22.22.0 both times, no seed data):

1. appends `ALTER TABLE no_such_table ADD COLUMN x TEXT` to the exported
   `MIGRATIONS` array (as a string before, as `{ id: '9999_broken_probe', sql }`
   after — the only shape-dependent line), runs `pushSchema`, and prints whether
   it resolved or rejected and the `schema_migrations` row count;
2. runs `pushSchema` twice on a second fresh file and prints the
   `schema_migrations` row count after each push.

The result depends only on the code at the captured commit; no network, cache
or data set is involved.

## Before / after

| | Before (`1a49e35`) | After (`6ee592c`, round 2; identical output at `b80dedf`) |
|---|---|---|
| Artefact | `before.txt` | `after.txt` |
| Broken migration appended | `pushSchema RESOLVED` — swallowed silently | `pushSchema REJECTED: migration 9999_broken_probe failed: SQLITE_ERROR: no such table: no_such_table` |
| `schema_migrations` rows, fresh DB, push 1 | n/a (table does not exist) | 7 |
| `schema_migrations` rows, fresh DB, push 2 | n/a (table does not exist) | 7 |

Supporting test output: `after-test.txt` (`packages/db/src/migrations.test.ts`,
11 tests, all pass, at `6ee592c`). Full suite at `6ee592c`: `npm test` exit 0,
592 tests across all workspaces, 0 failures; `npm run typecheck` exit 0.

**Round 2 (after review round 1).** The after state was re-captured at
`6ee592c` because behaviour changed on one path the probe does not exercise:
when a tolerated (benign) migration's history insert fails, the push now
rejects with `migration <id> failed: <message>` (with `cause`) instead of a bare
`SQLITE_…` message. That path is proved by the new test "a failure recording a
tolerated migration names the migration", which uses a trigger on
`schema_migrations` that `RAISE(ABORT)`s for `0003_events_cost_source` and
asserts the id, the message, the cause, and that only 0001 and 0002 were
recorded. The probe output is unchanged, as expected.

Capture timestamps and commit SHAs are in `captures.tsv`, written by
`scripts/factory-prove.sh` (both captures at `dirty=0`).

## What this does not prove

- Only local libSQL **files** were exercised. Not tested against a remote
  Turso/libSQL URL, where `client.batch(..., 'write')` runs over HTTP; the
  error-message text the tolerance rule matches (`duplicate column name`,
  `already exists`) is assumed to be the same there, and if a remote server
  worded it differently the effect would be a loud boot failure, not a silent one.
- Not tested against a copy of a real customer database; the pre-tracking case
  is simulated by applying the current DDL without `schema_migrations`, and the
  legacy-key case by a hand-built single-id `events` table.
- Locked-database, disk-full and permission errors were not produced for real;
  they are covered only by unit tests of `isBenignMigrationError` on their
  SQLite message text.
- Two replicas booting concurrently against one database were not exercised;
  the `INSERT OR IGNORE` on the history row is reasoned, not measured.
- Not run inside the Docker image via `deploy/entrypoint.sh`; that the
  container exits on a rejected push relies on its `set -euo pipefail`, read
  but not executed.

## Deviations

- Round 2: `packages/db/src/bootstrap.ts`'s CLI error handler now also prints
  `caused by: <code> <message>` when the error has a `cause` (reviewer
  non-blocking note, requested by the coordinator). This is error output only;
  no seeding or bootstrap logic changed, which the spec puts out of scope.
- Round 2: the "already exists" branch of `isBenignMigrationError` is kept
  because the spec asks for it, but SQLite never raises it for
  `CREATE INDEX IF NOT EXISTS` (checked: a plain `CREATE INDEX` on an existing
  index gives `index i already exists`; `IF NOT EXISTS` naming a table gives
  `there is already a table named t`, which is not tolerated and now has a
  test). The fixture comment says so. The test temp directory is now removed
  after the run.

- `pushSchema` gained an optional second parameter
  `migrations: readonly Migration[] = MIGRATIONS`, used only by tests to inject
  failing migrations. Production callers (`push.ts`, `bootstrap.ts`) are unchanged.
- `MIGRATIONS` changed from `string[]` to `{ id, sql }[]` (new exported
  `Migration` type and `isBenignMigrationError`). No caller outside `sql.ts`
  read it.
- `schema_migrations` is created as the last entry of `DDL` rather than by a
  separate statement, so anything that pushes `DDL` gets it. It is not added to
  the drizzle `schema.ts`, because no query reads it.
- Each migration and its history row are written in one `client.batch(..., 'write')`
  so a statement cannot be applied without being recorded. A tolerated statement
  is recorded by a separate insert. The history insert is `INSERT OR IGNORE`, so
  a replica that loses the race to record a migration does not fail boot.
- The tolerance rule pairs each message with one statement kind:
  "duplicate column name" only for `ALTER TABLE … ADD COLUMN`, "already exists"
  only for `CREATE INDEX IF NOT EXISTS`. The spec allows this pairing; it is the
  stricter reading.
- The legacy pre-rebuild pass applies the same rule but does not record; the
  main pass that follows records those ids (hitting the benign duplicate-column
  error). The history table does not exist yet at that point on a legacy DB.
- No dependency added. No test changed or loosened; one test file added and
  registered in `packages/db/package.json`'s `test` script.

## Definition of done

- **Cost / latency impact:** one extra `SELECT id FROM schema_migrations` per
  push, and on an already-migrated DB the seven migration statements are skipped
  rather than executed, so boot does slightly less work. No runtime request path
  is touched.
- **Observability for new failure modes:** the new failure mode is a rejected
  push; its message is `migration <id> failed: <database error>` with the
  original error as `cause`, printed by `db:bootstrap`/`db:push` and ending
  the container at boot. `schema_migrations.applied_at` records when each
  migration applied.
- **Docs or ADR updated:** `docs/05-hosting.md`, "Database bootstrap" — one
  paragraph on tracking, boot failure and rollback by restoring from backup.
  No ADR: this does not change ADR-0004's SQLite-first decision.
