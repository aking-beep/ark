# Evidence — documented-product-complete

## What changed

A person following the README now gets the product the docs describe: the Control drift page shows a numeric predicted-vs-observed percentage on seeded data, calibration snapshots are versioned, consumer AIFit asks the six PRD questions and copies a result link without inventing a cost, ingest accepts actions and quality samples and can raise all nine alert kinds, tokens can be estimated from a pasted prompt, and `@ark/sdk` assigns trace ids and turn indices.

## How it was measured

Same commands, same encoded consumer intake (`evidence/documented-product-complete/intake.txt`), Control and consumer on ports 3002 and 3000, seeded SQLite.

- SQL against the seeded DB (`SELECT assessment FROM workloads`, `COUNT(*) FROM calibration_snapshots`)
- `GET /api/v1/events` and `GET /api/v1/calibration?days=30`
- `GET /workloads/wl_support_triage`
- `GET /result?i=<intake>` and `GET /result?i=garbage` and `GET /`
- `POST /api/v1/events` with an irreversible action and no `approvedBy`
- `npm run test` (48 core + 7 ingest + 3 SDK + 1 copy-href)

Before used `ARK_DATABASE_URL=file:/workspace/packages/db/ark.db` because `findRepoRoot` only matched a directory named `ark`. After uses the repo-root `file:/workspace/ark.db` that `npm run setup` now writes. That path change is part of the feature (zero-config shared DB).

Capture timestamps and commit SHAs are in `captures.tsv`.

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before.txt` (plus `before-*.html`) | `after.txt` (plus `after-*.html`) |
| Seeded assessment keys | `verdict,score` only | full Assessment including `cost.perUnit` and `architecture.callShape` |
| `calibration_snapshots` | 0, still 0 after GET | 1 after seed, 2 after GET |
| Ingest GET body | `events`, `traces` | also `actions`, `qualitySamples` |
| `/workloads/wl_support_triage` | `has_estimate_drift False` | `has_estimate_drift True`, figure `+1813%` |
| Consumer `/result?i=…` | Per month + Suggested model, no copy control | no cost, no model, Copy link + “link contains your answers” |
| Consumer garbage `i` | recovery, no copy | recovery, no copy |
| Landing | promised “rough monthly cost” / “Real prices” | does not |
| Live POST irreversible action | not accepted | `actionsAccepted: 1`, `alerts: 1` |

## What this does not prove

Seeded telemetry, not a customer’s traces. Drift of +1813% is the synthetic mix (including a frontier-model leak on classification) against a heuristic AIFit prior — it proves the page renders a number, not that the rubric is accurate. Consumer copy control is proven by a unit test of `copyHref` plus HTML that contains the button; it was not clicked in a real browser. Token paste was not driven through the business UI in this capture (the estimator is unit-tested). CI workflows are files in the repo; they have not run on GitHub yet. Multi-tenant auth, Slack routing, and fleet `calibrated` priors were out of scope.

## Deviations

`findRepoRoot` no longer matches a directory named `ark`. The clone here is `/workspace`, so `npm run setup` previously wrote `packages/db/ark.db` while the apps would each have opened a different empty file. The spec did not name this, but acceptance criterion 1 (drift on seeded data after `npm run setup && npm run dev`) cannot hold without a shared database. Declared here: look for `factory.config.json` walking up from cwd.

No new third-party runtime dependency. `@ark/sdk` is a workspace package depending only on `@ark/core`.

## Definition of done

- **Cost / latency impact:** N/A as a new model call — `estimateTokens` is arithmetic. Ingest now writes extra rows (actions, quality, snapshots) on the existing SQLite file; snapshot writes are throttled to once per 60s per org/window.
- **Observability for new failure modes:** `unapproved_action`, `quality_regression`, `budget_warn` / `budget_breach` land in the existing `alerts` table and the budgets page. Circuit breaks still return on the ingest 202 body.
- **Docs or ADR updated:** README layout lists `@ark/sdk`. No ADR: the HTTP ingest contract grew additively; AIFit still stores nothing.
