## Round 1 — 2026-09-16 — 5/5

From the artifacts alone, before reading the diff: a team can POST a non-`not-ai` sample and get **200** on the installed Ollama tag (`smollm2:135m`) instead of **502** `local-70b is not installed`. The measure card is at the top of the report. MY AI registry copy reads **Last reviewed 16 September 2026**. Control login tells the operator to use `http://localhost:3002`, not `127.0.0.1`. Control Spend for Northwind shows three ingested units on `smollm2:135m`.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All five acceptance criteria met as written. `measure.ts:25-28` / `measure.ts:72-74` omit catalog `primary.id` and pass `ARK_OLLAMA_MODEL` or no model. Live `after.txt` support POST is 200 `smollm2:135m`, not-ai stays 422. `report/page.tsx:114-129` places the uncalibrated callout and `MeasureSample` before the numbers panel and footer; `measure-sample.tsx:23` aborts at 15s. `freshness.py:40-46` derives `last_reviewed`; registry/methodology/README no longer hardcode 12 September. `login/page.tsx:53-55` names `localhost:3002` vs `127.0.0.1`. Report still prints the catalog id at `report/page.tsx:273-274`. No silent extra scope. |
| 2 | Evidence proves it | ✅ | Same command (`node evidence/suite-live-loop/probe.mjs`) on this station. `captures.tsv` before at `752a097` dirty=0, after at `eeacf40`. `before.txt` → `after.txt`: catalog-as-model true→false, support 502 `local-70b` → 200 `smollm2:135m`, hardcoded 12 Sep → derived, measure index 21853→5283, `AbortSignal` false→true, login host copy false→true. Screenshots 1440×900 cover report placement, registry date, login copy, Control ingest. “What this does not prove” is specific (30-trace floor, ingest org match, client abort ≠ server cancel). |
| 3 | Structure holds | ✅ | Edge (`measure/route.ts:35`, `measure-sample.tsx`) calls service `measureWorkload`; service does not import `Request`/`Response`. `last_reviewed` is computed in `freshness.py`, not in the registry page. No new dependency. `measure-timeout.ts` is a client-safe constant so the UI does not import Runtime. |
| 4 | Fails safely | ✅ | Client `AbortSignal.timeout(MEASURE_TIMEOUT_MS)` at `measure-sample.tsx:23`; abort maps to a timeout string at lines 47-54, not a hang or stack. Server still races 15s. POST validates `Workload` (`route.ts:27-32`). `not-ai` never calls a provider. Cost ceiling `maxCostUsd` 0.05 / `maxTokens` 64 unchanged. |
| 5 | Readable | ✅ | `sampleModelId` states why catalog ids are not tags (`measure.ts:20-23`). Split timeout file comments why (`measure-timeout.ts:1`). Tests cover omit-model, env tag, not-ai, no description in prompt (`measure.test.ts`). Login/registry copy is direct. |

**Blocking:** none.

**Non-blocking:**
- `after.png` is a calibrated report (`calibrated n=969`), so the uncalibrated callout is not in the screenshot; placement is still in source (`report/page.tsx:114-129`) and probe indices.
- `after.txt` `measureNearUncalibrated` stays false because the callout body is ~900 characters and `probe.mjs:87` uses an 800-character window.
- `after-teams-measure.png` is a full-page zoom-out; card success copy is not readable there. HTTP `after.txt` and `after-control-northwind.png` carry the outcome.
- `test_core.py:307` only asserts `last_reviewed` is truthy, not that it equals `max(last_evaluated_at)`.
