# tracked-migrations

**Status:** APPROVED
**Approved by:** repository owner (Prompt 0 scope approval, PR-1 of PR-1–PR-4; 2026-10-19)
**Date:** 2026-10-19

## Problem

`pushSchema` in `packages/db/src/sql.ts` runs every statement in `MIGRATIONS` on
every boot and wraps each one in a bare `catch {}`. It runs twice: once before a
legacy rebuild and once after the DDL. That catch is meant to swallow "duplicate
column" on an already-migrated database. It also swallows a typo, a locked
database, a disk-full error, a permissions error, or a migration that half-applied.
`deploy/entrypoint.sh` runs `db:bootstrap` on every container start against real
customer data, so a migration that silently did nothing would go unnoticed until
a query failed somewhere far away.

## Outcome

A migration either applies and is recorded once, or the push fails loudly and
names the migration and the error. Running it again is a recorded no-op.

## Acceptance criteria

1. **The history table.** A `schema_migrations` table (`id TEXT PRIMARY KEY`,
   `applied_at INTEGER NOT NULL`) records every applied migration.
   - Each entry in `MIGRATIONS` gets a stable, never-reused id, for example
     `0001_events_agent_id`.
   - Migrations run in order, and each runs only if its id is not already recorded.
2. **Only known benign errors are tolerated.** An expected benign error can
   occur when a column already exists because the DDL created it, or on a
   pre-tracking database where the column was added by the old untracked loop.
   - The only tolerated errors are SQLite "duplicate column name" and "already
     exists", and only for the statement kinds that can produce them
     (`ALTER TABLE … ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`).
   - A tolerated statement is still recorded as applied.
   - Any other error stops `pushSchema`. The error names the migration id and
     the underlying message, and nothing after it runs.
3. **Legacy rebuild path.** The column-adding pass before
   `rebuildWithOrgKey` uses the same tolerance rule, not a bare catch.
4. **Tests** (`packages/db/src/*.test.ts`):
   - a fresh database records every migration once;
   - a second push is a no-op that records nothing new;
   - a pre-tracking database whose columns already exist is backfilled without
     error;
   - an injected failing migration (for example a statement naming a missing
     table) makes `pushSchema` reject with its id and leaves later migrations
     unapplied;
   - a non-benign error on an `ALTER TABLE` (for example a missing table) is not
     swallowed.
5. **Docs.** `docs/05-hosting.md` gets one short paragraph:
   - migrations are tracked in `schema_migrations`;
   - a failing migration stops boot;
   - how to roll back: restore from backup, since migrations are additive only.

## How this will be proved

- **Artefact:** terminal output
- **Measured by:** a small script under `evidence/tracked-migrations/` that, before
  and after, runs `pushSchema` against:
  - a temp database with a deliberately broken migration appended, showing the
    "before" swallows it silently and the "after" fails, naming it;
  - a fresh temp database twice, showing the row counts in `schema_migrations`.
- **Conditions:** local libSQL file in a temp dir, with the same Node and the
  same seed both times.

## Out of scope

- Down migrations.
- A migration CLI.
- Changing any table shape.
- `seed.ts` and bootstrap seeding logic.
- RBAC and auth (already fixed: open mode is refused in production).

## Risk

Migrations run on customer data at boot. Additive only, no data rewrite.
`agents/security-reviewer.md` is not required (no auth or permission change), but
the reviewer must check the tolerance rule cannot mask a real failure.

- **Rollback:** revert the PR. `schema_migrations` is an extra table the old code
  ignores.
