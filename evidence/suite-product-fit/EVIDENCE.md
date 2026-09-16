# Evidence — suite-product-fit

## What changed

MY AI for teams no longer invents today’s cost, can send one Runtime sample into Control, empty Control orgs say how to do that without opening `.env.example`, and MY AI recommends 2026-current tools without duplicate React keys.

## How it was measured

Same command before and after, from the repo root, on this container:

```
node evidence/suite-product-fit/probe.mjs
```

Supporting HTTP (business `:3001`, Control `:3002`):

```
curl -sS http://127.0.0.1:3001/api/measure
curl -sS -X POST http://127.0.0.1:3001/api/measure -H 'content-type: application/json' -d @INVOICE_LOOKUP
```

Screenshots 1440×900, Chromium headless: Control `/login`, Northwind `/dashboard` (zero traces). Unit tests: `node --experimental-strip-types --test apps/business/src/lib/measure.test.ts` (fake adapter). `npm test` and `npm run test:my-ai`.

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before.json` | `after.json` |
| GET `/api/measure` | 404 | 200, documents POST |
| Today defaults | `8` / `65` | `''` / `''` |
| `key={item}` in results | 3 | 0 |
| products / models | 16 / 4 | 23 / 9 |
| `apps/business` → `@ark/runtime` | false | true |
| Control empty copy | `npm run setup` | `POST /api/measure` + `ARK_CONTROL_TOKEN` (no bearer secret) |
| `POST` not-ai fixture | n/a | 422 `reason=not-ai` (`after-measure-not-ai.json`) |
| Measure with fake adapter | n/a | ingest `ok` (six tests pass) |

Capture timestamps and commit SHAs are in `captures.tsv`, written by `scripts/factory-prove.sh`.

## What this does not prove

A live Ollama (or other) adapter was not configured on the teams Next process, so `POST /api/measure` for support triage returned **503 `no_provider`** — the safe failure, not a hang. Ingest of a live completion into Control was proved with a fake adapter in unit tests, not against this machine’s Ollama daemon. One sample still does not clear the 30-trace calibration floor. Screenshots are Chromium 1440×900 only. Registry rows are dated official product/model cards, not a claim that Sensor Tower share figures are capabilities. MY AI still does not use `@ark/core` and still does not link to teams (consumer PRD).

## Deviations

Gemma family row is `gemma-3` citing `google/gemma-3-27b-it` (official card fetched 2026-09-16). Research mentioned Gemma 4 Hub snapshots; that id was not used because the verifiable card was Gemma 3. Grok homepage is `https://grok.com` (`x.ai/grok` returned a Cloudflare block from this station). No new third-party npm dependency; `@ark/runtime` was already in the workspace.

## Definition of done

- **Cost / latency impact:** `POST /api/measure` is opt-in, `maxTokens` 64, `maxCostUsd` 0.05, 15s timeout. Not on the production request path. N/A for the catalog/key/Today edits (no new model call).
- **Observability for new failure modes:** JSON `{ ok:false, reason, message }` with 422/503/504/502. UI shows the message. Policy refusal is not ingested (existing Runtime rule).
- **Docs or ADR updated:** `docs/01-architecture.md`, `docs/adr/0006-runtime-is-not-a-surface.md`, both PRDs, README, `.env.example`, `my-ai/docs/REGISTRY_SEED_REVIEW.md`.
