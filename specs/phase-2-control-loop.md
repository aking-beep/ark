# phase-2-control-loop

**Status:** APPROVED
**Approved by:** repository owner (build Phase 2)
**Date:** 2026-09-15

## Problem

Phase 0–1 is a working three-app system on seeded data. A second organisation cannot use it as a product: Control UI and ingest are not tenant-scoped at the edge, budgets in `throttle`/`block` only write alerts, alerts stay inside the dashboard, and the only traces in the database were inserted by the seed SQL rather than posted through ingest. There is also no way to run the three surfaces as a hosted stack.

A real third-party production customer does not exist yet. The loop still has to close for *someone other than the seed generator*: a second org whose data arrives only via `POST /api/v1/events`, whose first calibration is `calibrated` from comparable systems, and whose dashboards do not show another org's rows.

## Outcome

An operator can log into Control as one org and not see another org's data; ingest requires an org-bound token; a budget in `block` refuses new events and one in `throttle` returns `circuitBreaks`; new alerts POST to a webhook or Slack; a second org with no seeded events can ingest live traces and receive fleet `calibrated` priors until it has 30 of its own; `docker compose up` runs all three surfaces.

## Acceptance criteria

1. Control HTML routes require a session. Unauthenticated `GET /dashboard` redirects to `/login`. A session for org A never returns org B's workloads, spend, or alerts. `GET /api/v1/calibration` and `POST /api/v1/events` take the org from a bearer token (or session cookie), not from an unauthenticated `?org=` query param. A token for org A posting `orgId: B` writes to A or is rejected — it does not write B.
2. After ingest inserts alerts, Control POSTs each one to that org's destinations (`webhook` JSON body, or Slack incoming-webhook `{text}`). Delivery uses a timeout and does not fail the ingest 202. A destination that 5xxs is recorded as a delivery miss, not retried in-process forever.
3. When spend is already at or above a budget whose `enforcement` is `block`, further events in that scope are not inserted and the 202 body includes `circuitBreaks` with reason `budget_block`. `throttle` still inserts and returns `circuitBreaks` with reason `budget_throttle`. `observe` and `warn` stay alert-only.
4. Seed creates a second org with a workload, a user, an ingest token, and **zero** events/traces. `npm run ingest:live` posts traces for that org through `applyIngest` (the same path as `POST /api/v1/events`). Before that job, `GET /api/v1/calibration` for the second org returns `basis: "calibrated"` from the other org's patterns (no source org id in the payload) when the second org is below the 30-trace floor. After the job, that org's own calibration is `measured` once it has ≥30 traces. Consumer and business AIFit stay unauthenticated and still do not depend on `@ark/db`.
5. `deploy/docker-compose.yml` builds and runs consumer `:3000`, business `:3001`, control `:3002` with a durable `ARK_DATABASE_URL`. README documents the demo logins, ingest tokens as env vars (not committed secrets), and `ARK_SESSION_SECRET` as required in production. `BasisTag` copy for `calibrated` matches the thesis (other systems like yours, not "thin sample of your own").

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`). Control on port 3002.

- **Artefact:** terminal output (HTTP status, JSON bodies, SQL counts) plus HTML dumps of `/login`, `/dashboard` as two orgs, same viewport.
- **Measured by:**
  - Before: `GET /dashboard` with no cookie is 200 and shows seeded spend; `POST /api/v1/events` with no `Authorization` is 202; `?org=` on calibration is honoured; no `/login`; seed has one org with SQL-inserted events.
  - After: unauthenticated dashboard redirects to login; org A session HTML does not contain org B workload names; bearer-less ingest is 401; token A cannot insert into org B; webhook mock received a POST; a `block` budget refuses a follow-up event (`accepted: 0`, `budget_block`); second org event count is 0 after seed and >30 after `ingest:live`; calibration basis flips `calibrated` → `measured`.
- **Conditions:** `npm run setup`, Control on 3002, seeded SQLite at repo-root `ark.db`.

## Out of scope

- A real customer's production traces (no customer has instrumented yet). Kill criterion from the roadmap still applies later.
- OAuth/SSO, invite emails, password reset, encrypting result URLs.
- SDK-side local enforcement beyond surfacing `circuitBreaks` (already returned).
- Slack Bot API (OAuth app, channels). Incoming webhooks only.
- Hosting credentials on AWS/Vercel/Railway — this station ships the compose file and image build. A public URL is attempted when a tunnel or token exists; absence is not a failed criterion.
- Portfolio modelling, accuracy prediction, sitting in the request path.

## Risk

Auth, org isolation, hashed tokens/passwords, outbound HTTP to operator-configured destinations. No new third-party runtime dependency (Node `crypto` + existing `fetch`). Demo passwords and ingest tokens are documented local defaults, overridable by env, never used as production secrets.

- **Rollback:** revert the branch. New tables are additive. Local open-ingest-without-token behaviour is replaced after seed creates tokens.
