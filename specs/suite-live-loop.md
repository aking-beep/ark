# suite-live-loop

**Status:** APPROVED
**Approved by:** repository owner (close remaining suite QA launch blockers; 2026-09-16)
**Date:** 2026-09-16

## Problem

A live re-QA on merged `suite-product-fit` scored the suite ~4/5 function and ~3.5/5 composition. The first-party measure caller exists, but it does not close the loop on a real machine:

- **MY AI for teams** passes the estimator’s catalog id (`local-70b`) as `RuntimeRequest.model`. That id is a cost row, not an Ollama tag. Inventory then refuses (`502`, `ollama model 'local-70b' is not installed (have: smollm2:135m)`), even when `ARK_OLLAMA_MODEL` names a tag that *is* installed. The sample is supposed to prove Control can receive a trace, not to run the production 70B.
- The measure card sits at the **bottom** of a long report. Failures are easy to miss.
- Client `fetch` has no abort; a hung measure looks like a hang.
- **MY AI** catalog rows are dated 2026-09-16 and the registry UI still says “Last reviewed 12 September 2026.”
- **ARK Control** session cookies are host-bound. Opening `127.0.0.1:3002` after a `localhost` login drops the session; login copy does not say so.

The consumer PRD still forbids a MY AI → teams funnel. This feature does not add one. The 30-trace calibration floor stays. Runtime inventory still does not cross-family substitute.

## Outcome

A team can send one synthetic Runtime sample on the operator’s configured local model (not the catalog estimate id), see that outcome without scrolling the whole report, and land a trace in Control when ingest env is set. MY AI’s “last reviewed” date is the newest catalog `last_evaluated_at`. Control login tells the operator to use `localhost`, not `127.0.0.1`.

## Acceptance criteria

1. **Sample model is the operator’s, not the estimate.** `measureWorkload` must not pass `assessment.model.primary.id` as `RuntimeRequest.model`. If `ARK_OLLAMA_MODEL` is set, the sample uses that string; otherwise the request omits `model` so the adapter default applies. The report still shows the estimator’s recommended catalog id. `not-ai` remains 422 and does not call a provider. Prompt still never includes `description`.
2. **Installed tag succeeds; missing tag still refuses.** With Ollama up and `ARK_OLLAMA_MODEL` equal to an installed tag, `POST /api/measure` on a non-`not-ai` fixture does not 502 for `local-70b`. Inventory still refuses a *requested* tag that is not installed. No `ARK_OLLAMA_PULL`, no Hub auto-pull, no change to Ollama cross-family rules.
3. **Measure is visible and abortable.** On a non-`not-ai` report, `MeasureSample` is rendered with the uncalibrated callout (before the page footer), not only after every panel. The client `fetch` uses `AbortSignal` with timeout ≤ 15s. Success and failure copy stay on the card (no hang, no stack trace).
4. **Registry last-reviewed is derived.** `freshness_report` includes `last_reviewed` equal to the max `last_evaluated_at` across products and models. Consumer registry copy uses that date (formatted), not a hardcoded “12 September 2026.” Methodology version copy uses the same sourced date or points at the registry instead of a stale hardcoded day. `my-ai/README.md` catalog date matches.
5. **Control cookie host.** Login copy tells the operator to open Control at `http://localhost:3002`, not `127.0.0.1`, so the session cookie sticks. Tokens are not printed. Empty-org measure copy from `suite-product-fit` stays.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`).

- **Artefact:** terminal output from `node evidence/suite-live-loop/probe.mjs` (before and after, same command). Optional live `POST /api/measure` when `:3001` and Ollama are up. Screenshots 1440×900 of teams report (measure card placement + outcome), MY AI registry date, Control login host copy.
- **Measured by:**
  - Before: `measure.ts` passes `assessment.model.primary.id`; registry/methodology HTML or source contains `12 September 2026`; `MeasureSample` is after the last report panel; login copy does not mention `localhost:3002` vs `127.0.0.1`; live POST support-triage 502s on `local-70b` when only `smollm2:135m` is installed.
  - After: sample request has no `local-70b` model; `ARK_OLLAMA_MODEL=smollm2:135m` live POST is not a `local-70b` 502; freshness JSON has `last_reviewed`; registry UI does not say 12 September 2026; report source places `MeasureSample` next to the uncalibrated callout; login mentions `localhost`; `npm test` and `npm run test:my-ai` pass.
- **Conditions:** compiled packages; fake adapters for unit tests; live Ollama optional and recorded if present, not faked. Viewport 1440×900 for screenshots.

## Out of scope

- A MY AI ↔ teams funnel, unifying MY AI onto `@ark/core`, email capture, accounts.
- `apps/runtime`, OpenAI defaults, `OPENAI_API_KEY`, auto-pull of Hub weights.
- Flipping calibration to `measured` from one sample (30-trace floor stays).
- Changing Ollama `resolveOllamaTag` cross-family rules.
- Rewriting cookie `Domain` / terminating TLS; the fix is operator copy, not a new session scheme.
- Aborting in-flight `execute` inside Runtime (client abort + server Promise.race stay).

## Risk

`POST /api/measure` still runs a model when adapters are configured. Mitigations unchanged: synthetic prompt (no `description`), `maxTokens` 64, `maxCostUsd` 0.05, 15s timeout, `not-ai` refusal. Using the operator’s installed tag *reduces* surprise 70B pulls. No new npm dependency.

- **Rollback:** revert the branch. Measure still exists; it would again send catalog ids. Registry copy would again hardcode 12 September.
