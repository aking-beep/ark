# ADR-0004: SQLite first, Postgres-portable

**Status:** Accepted
**Date:** 2026-09-14

## Context

ARK Control is a telemetry system. Telemetry systems attract a particular kind of premature architecture: Postgres for the rollups, ClickHouse for the events, Redis for the counters, a queue in front of ingest, and a docker-compose file nobody can run on an aeroplane.

The actual requirements at this stage are one developer, a demo that has to work in front of a prospect, and a workload volume measured in thousands of events per month — not billions.

There is also a specific risk: Control's value depends on people actually pointing traffic at it. Every service a prospective user has to stand up before they see anything is a place they stop.

## Decision

SQLite, via Drizzle over `@libsql/client`. A local file (`ark.db`). No services, no containers, no cloud account.

`npm run setup && npm run dev` produces a working three-app system with seeded telemetry in under a minute.

The schema is written to be portable from day one: no SQLite-specific column types, timestamps as integers, JSON as text, and nothing in the query layer that assumes single-writer semantics or relies on SQLite's type affinity.

## Consequences

**Good.**

- Zero-config onboarding. The gap between `git clone` and a working system with data in it is one command.
- `@libsql/client` speaks the same protocol to a local file and to Turso, so the first hosting step is a URL change and a token — no code.
- Tests run against a real database rather than mocks, at no setup cost. A seeded file is faster than a container.
- The seed data is checked in as a generator, so the demo is reproducible and the calibration figures in the docs can be verified by anyone reading them.

**Bad.**

- **Single writer.** Fine for one process ingesting at demo volume; it is the first thing that breaks under concurrent ingest. The mitigation is that the schema and queries assume nothing about it, so the fix is a driver swap rather than a rewrite.
- **No native JSON operators.** JSON columns are text and are parsed in application code. Acceptable because nothing queries *into* them — `spec` and `assessment` are read whole.
- **Aggregate queries over `events` will be the first thing to get slow.** Partially anticipated: `traces` carries denormalised rollups precisely so the dashboard does not aggregate events per page load. See [`03-data-model.md`](../03-data-model.md).
- **Networked filesystems.** SQLite on a mounted or network filesystem throws I/O errors. Development on such a mount requires pointing `ARK_DATABASE_URL` at local disk. This bit during development of this repo and is worth knowing before it bites someone else.

## Migration trigger

Move off local SQLite when any of these is true:

1. More than one process writes concurrently.
2. Ingest exceeds roughly 50 events/second sustained.
3. The events table passes ~10M rows and rollups stop being sub-second.
4. A customer requires a database they control.

Steps 1 and 4 point at Turso (URL change). Steps 2 and 3 point at Postgres (driver swap, plus indexes the current volume does not justify).

## Alternatives considered

**Postgres from the start.** Rejected: it converts a one-command setup into a docker-compose prerequisite, and the failure mode being avoided — a prospect who never gets the system running — is more expensive right now than a migration later that is already scoped to a driver swap.

**ClickHouse for events.** Rejected as correct for the volume this does not have. Revisit at migration trigger 3.

**Prisma instead of Drizzle.** Rejected: Drizzle's generated SQL is legible, which matters for a system whose credibility rests on being able to show its arithmetic, and it carries no separate schema language or codegen step.
