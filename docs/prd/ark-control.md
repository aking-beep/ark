# PRD: ARK Control

**Surface:** `apps/control` · port 3002
**One line:** Telemetry ingest and cost governance for AI workloads in production. Measures what MY AI for teams estimated.

## Who

The person who owns the bill. In a small company that is the same engineering lead who filled in the business intake three months earlier; in a larger one it is whoever got asked why the API line item tripled.

## The job it does

Two jobs, and they are not the same job.

**For the customer:** answer "what is this actually costing per outcome, and what is going wrong that I cannot see." Per-call dashboards from a model provider do not answer this — they cannot, because they do not know which calls belonged to the same piece of work.

**For the system:** manufacture ground truth. Observed call shapes per architecture pattern, served at `GET /api/v1/calibration`, are what let MY AI for teams promote a figure from `heuristic` to `measured`. This is the defensible asset. See [ADR-0001](../adr/0001-control-before-aifit.md).

## Ingest

`POST /api/v1/events`. Batched. One row per model call, carrying trace id, **turn index**, model, provider, input/output/cached token counts, latency, status, and an optional prompt `sample`. A trace closes when a row arrives with an outcome.

Three rules:

**Strict about shape, permissive about content.** A malformed row is rejected. A row naming an unknown model or an off-allowlist provider is accepted, priced as far as possible, flagged, and counted. Telemetry that rejects real traffic because the catalog is behind under-reports exactly when something unusual is happening.

**The `sample` is scanned and discarded.** Sensitive-data alerts record the class of thing found and the workload it appeared in. They never record the value.

**Turn index is required.** Without it an agent looping nineteen times is indistinguishable from nineteen successful outcomes, and cost per outcome is wrong by 19× in the flattering direction.

## Detection

| Condition | Alert |
|---|---|
| Turn ceiling breached on a trace | `loop_runaway` |
| Trace cost ceiling breached | `circuit_break` |
| Provider outside the allowlist | `off_allowlist` |
| Prompt sample matches a sensitive-data detector | `sensitive_data` |
| Model price past its `asOf` window | `stale_pricing` |
| Spend past `warnAtPct` / past `limitUsd` | `budget_warn` / `budget_breach` |
| Irreversible action with a null `approvedBy` | `unapproved_action` |
| Accuracy below threshold on judged samples | `quality_regression` |

Every `blocking: true` control the business report emits maps to one of these. That mapping is what lets the `verifiedBy` column say something specific rather than "monitor this". A control nobody can verify after launch is a paragraph in a document, and paragraphs do not stop anything.

## Budgets

Scope, period, limit, warn threshold, and an enforcement mode: `observe` → `warn` → `throttle` → `block`. Four modes rather than a boolean because a budget that can only do nothing or kill production traffic gets set to "do nothing" by anyone who has been paged at 3am.

## Calibration

`GET /api/v1/calibration?days=30`. Per architecture pattern, over a rolling window: turns per outcome, context growth per turn, failure rate, retries per failure, cache hit rate, cost per outcome, p95 turns, and sample size.

**Sample floor: 30 traces.** Patterns below it are returned and marked; `resolveCallShape` declines to use them and states the observed count. A prior is promoted only above the floor.

Cached `max-age=60, stale-while-revalidate=300` — it is an aggregate over thirty days and a minute of staleness in that is meaningless.

Snapshots are versioned and never overwritten. When a forecast turns out wrong, "what did the system believe at the time" is the difference between a calibration bug and a data bug.

## The drift page

`/workloads/[id]` renders what MY AI for teams predicted against what the workload actually costs, as a percentage.

This is the most important page in the product and the only one whose purpose is to embarrass the rest of it. The seeded demo data puts observed bounded-agent turns at 8.25 against a rubric prior of 7 — an 18% cost error, on synthetic data generated to be well-behaved. Publishing that is the whole argument.

## Success criteria

- Ingest accepts an unknown-model event, flags it, and does not drop it.
- A seeded trace with nineteen turns produces a `loop_runaway` alert and a correct 1-outcome denominator.
- A pattern with 11 traces is returned by the calibration endpoint, marked, and **not** used by `resolveCallShape`.
- With Control running and `ARK_CONTROL_URL` set, a business report renders `measured` tags and drops the uncalibrated banner.
- `npm run setup && npm run dev` produces a working system with data in it, with no services, containers, or cloud account.

## Non-goals

Not an agent framework. Not general APM — it touches telemetry only to the depth needed to compute cost per outcome and detect the failure modes that cost money or cause incidents. Not a model gateway; it observes traffic, it does not sit in the path of it.
