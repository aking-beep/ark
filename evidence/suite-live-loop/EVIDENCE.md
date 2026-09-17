# Evidence — suite-live-loop

## What changed

A teams measured sample now runs on the operator’s installed Ollama tag (`ARK_OLLAMA_MODEL`), not the estimator’s catalog id `local-70b`. The measure card sits under the uncalibrated banner. MY AI’s “last reviewed” date is the newest catalog `last_evaluated_at`. Control login tells the operator to use `localhost`, not `127.0.0.1`.

## How it was measured

Same command twice, from the repo root, on this cloud station, with MY AI API `:8472`, teams `:3001`, Control `:3002`, and Ollama `127.0.0.1:11434` (installed tag `smollm2:135m`) running:

```
node evidence/suite-live-loop/probe.mjs
```

Screenshots 1440×900: `after-myai-registry.png`, `after-teams-report.png` / `after.png` (report top), `after-teams-measure.png`, `after-control-login.png`, `after-control-northwind.png`. Live POST bodies are the in-repo fixtures; prompts never include secrets.

## Before / after

| | Before (`752a097`) | After (`eeacf40`) |
|---|---|---|
| Artefact | `before.txt` | `after.txt` |
| Catalog id as sample model | `passesCatalogPrimaryAsModel: true` | `false` |
| Live POST support-triage | **502** `local-70b is not installed (have: smollm2:135m)` | **200** `modelId: smollm2:135m`, `mentionsLocal70b: false` |
| Registry copy | hardcoded `12 September 2026` | derived; UI “Last reviewed 16 September 2026” |
| Measure card in report source | index 21853 (bottom) | index 5283 (with uncalibrated callout) |
| Client abort | false | `AbortSignal` |
| Control login host | no localhost vs 127.0.0.1 | names `localhost:3002`, not `127.0.0.1`, session cookie |

Supporting: `node --experimental-strip-types --test apps/business/src/lib/measure.test.ts` (10 pass). `npm run test:my-ai` (23 pass). `npm run typecheck` exit 0. Live Control Northwind after ingest: 3 units of work, model `smollm2:135m`, workload “Support ticket triage and refund handling” (`after-control-northwind.png`). `GET /v1/registry/freshness` → `last_reviewed: 2026-09-16`.

## What this does not prove

One sample still does not clear Control’s 30-trace calibration floor; reports stay heuristic until n≥30. Ingest only succeeds when `ARK_ORG_ID` matches the bearer org (SDK defaults `org_demo` if unset — operator config, not changed here). Client abort does not cancel in-flight `execute` on the server. Screenshots are Chromium 1440×900 only. Not a public traffic test. MY AI still scores in Python `my-ai/`, not `@ark/core`. No consumer↔teams funnel (forbidden).

## Deviations

none

## Definition of done

- **Cost / latency impact:** Sample still `maxTokens` 64 and `maxCostUsd` 0.05. Using the installed 135m tag avoids a surprise 70B pull. Live sample ~0.3–3s on this host.
- **Observability for new failure modes:** Measure still returns 422/502/503/504 with a message on the card; client timeout surfaces as a timeout string. Ingest outcome is `telemetry.ok`.
- **Docs or ADR updated:** `docs/01-architecture.md` and ADR-0006 name the configured-model sample. `.env.example` notes `ARK_OLLAMA_MODEL` is the sample tag.
