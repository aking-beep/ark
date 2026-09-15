# documented-product-complete

**Status:** APPROVED
**Approved by:** repository owner (build the documented product)
**Date:** 2026-09-15

## Problem

The repo documents a working three-app system. Several of those documented behaviours are missing or contradicted, so a person who follows the README and the PRDs does not get the product the docs describe.

- The Control drift page (`/workloads/[id]`) is supposed to show what AIFit predicted against what the workload actually costs. The seed stores only `{ verdict, score }`, so predicted cost and assumed call shape are always missing and the drift figure never renders.
- Calibration snapshots are versioned in the data model and "never overwritten." `GET /api/v1/calibration` only writes one when `?snapshot=1` is passed, which nothing does.
- The consumer PRD specifies six questions, no cost, no model recommendation, no calibration fetch, and a shareable result with a copy control. The wizard asks volume instead of "does it do something," the result page shows cost and a model, and it fetches Control.
- Ingest accepts events and trace closes. The schema has `actions` and `quality_samples`. Two of the nine alert kinds (`unapproved_action`, `quality_regression`) and the budget alerts cannot fire on a live POST.
- Token sizes on the business intake are a slider. Methodology limitation 1 says this is the weakest number in the report; Phase 1 asks for an estimate from a pasted prompt.
- There is no ingest SDK, so correct trace ids and turn indices depend on someone reading the data model doc.
- There is no golden set, and no CI.

## Outcome

A person who runs `npm run setup && npm run dev` can walk the documented product: consumer six-question assessment with a copyable result link and no fabricated cost; business intake that can estimate tokens from a pasted prompt; Control ingest of events, actions and quality samples that can raise all nine alert kinds; a drift page that shows a numeric predicted-vs-observed percentage on seeded data; versioned calibration snapshots; an SDK that posts correctly shaped traces; a golden set the engine is scored against; and CI that runs typecheck and tests.

## Acceptance criteria

1. Seeded Control stores the full assessment object (including `cost.perUnit.value` and `architecture.callShape`). `/workloads/wl_support_triage` renders a numeric estimate-drift percentage against observed cost per outcome.
2. `GET /api/v1/calibration` writes a versioned row to `calibration_snapshots` on the normal path (not only `?snapshot=1`). Seed writes an initial snapshot. Existing snapshots are never updated in place.
3. Consumer AIFit matches its PRD: six questions (task, kind of work, exact vs approximate, what happens if wrong, external information, produce vs do). A valid result shows the verdict, the recommended pattern in plain language, unlocks when not-yet, basis tags, and a copy control that writes `window.location.href` and discloses that the link contains the answers. It does not show cost or a model recommendation, and it does not fetch calibration. A missing or garbage `i` shows the recovery panel and no copy control. Old result links that still carry the previous intake fields continue to decode.
4. `POST /api/v1/events` accepts `actions` and `qualitySamples` in addition to `events` and `traces`. An irreversible (or required-approval) action with a null `approvedBy` emits `unapproved_action`. Quality samples that put a workload below its accuracy threshold (from the stored evaluation plan, else 0.93) with at least 20 samples emit `quality_regression`. After events, a budget that crosses `warnAtPct` / `limitUsd` emits `budget_warn` / `budget_breach`. Prompt `sample` is still scanned and discarded.
5. Business intake "Input and output" can estimate input tokens from a pasted typical prompt via `estimateTokens()` in `@ark/core` (heuristic, labelled). The numeric field remains editable. `@ark/sdk` assigns trace ids and monotonically increasing turn indices and POSTs the documented ingest body. It does not depend on `@ark/db`.
6. `@ark/core` includes a golden set of about 40 labelled workloads. Tests score them and fail if undocumented disagreements with the labelled verdict exceed 30%. GitHub Actions runs `npm run typecheck` and `npm run test` on pull requests. A weekly workflow runs `npm run refresh:models`.

## How this will be proved

Cloud station is this container (see `factory/05-CLOUD.md`). Apps bind their documented ports: consumer 3000, business 3001, control 3002.

- **Artefact:** terminal output (HTTP bodies, SQL counts, test log) plus screenshots of the consumer result and the Control drift page, same viewport.
- **Measured by:**
  - Before: SQL of a seeded workload's `assessment` keys; count of `calibration_snapshots`; `GET /api/v1/events` body keys; consumer `/result` HTML for a valid intake (cost copy present, no copy button); Control `/workloads/wl_support_triage` HTML (no "Estimate drift").
  - After: the same measurements. Assessment JSON contains `cost.perUnit`; snapshots ≥ 1; ingest GET documents actions/qualitySamples; consumer result has copy control and no monthly cost; drift page contains "Estimate drift"; golden-set and SDK tests pass.
- **Conditions:** `npm run setup && npm run dev`, seeded `ark.db`, cold load. One encoded consumer intake reused for valid-result shots.

## Out of scope

- Multi-tenant auth at the edge (schema is already org-scoped).
- Slack/webhook alert routing and SDK-side throttle/block enforcement (SDK surfaces `circuitBreaks`; Control still observes).
- Fleet-wide `calibrated` priors from other orgs.
- Encrypting or shortening result URLs.
- Portfolio modelling, accuracy prediction, integration-surface pricing (published refusals).
- The business report copy-link (separate from consumer, named in the draft share-link spec).

## Risk

Ingest now writes actions and quality samples — still org-scoped, still no PII persistence (`sample` discarded). Clipboard write is client-side and not persistence. No new third-party runtime dependency. `@ark/sdk` is a workspace package. Token estimate is a heuristic (4 characters ≈ 1 token) and is labelled as such.

- **Rollback:** revert the branch. Seed, ingest contract and consumer URL fields are additive; old consumer links still decode.
