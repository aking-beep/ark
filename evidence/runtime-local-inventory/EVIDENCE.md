# Evidence — runtime-local-inventory

## What changed

Ollama will not `POST /api/chat` for a tag that is not already on the machine. It lists `GET /api/tags` first, uses an installed match (exact, `:latest`, or unique family prefix), and raises `ProviderError('config')` for a miss instead of 404ing or pulling weights. `ARK_OLLAMA_PULL=1` opts back into posting the requested id.

## How it was measured

Same machine, same command before and after: `node evidence/runtime-local-inventory/probe.mjs` against compiled `@ark/providers` with mocked `fetch` and a fixture inventory of `smollm2:135m` (plus the other cases in the spec).

`factory-prove.sh before` stamped `0841118` dirty=0 (spec and probe already committed; product code still huggingface-models). `after` stamped `dd5bad3`.

Supporting: `npm test --workspace @ark/providers` (24 pass) and `npm test --workspace @ark/runtime` (34 pass). `npm run smoke:runtime` dry-run ok; with `ARK_OLLAMA_URL` and `ARK_OLLAMA_MODEL=smollm2:135m`, live adapter is ollama / `smollm2:135m`. Live daemon: `node evidence/runtime-local-inventory/live.mjs`.

## Before / after

| Case | Before (`before.json`, `0841118`) | After (`after.json`, `dd5bad3`) |
|---|---|---|
| `smollm2:135m` installed | 0 tags GET, POST `smollm2:135m` | 1 tags GET, POST `smollm2:135m` |
| `smollm2` unique family | POST `smollm2` (unresolved) | POST `smollm2:135m` |
| `llama3.2` vs `llama3.2:latest` | POST `llama3.2` | POST `llama3.2:latest` |
| `huggingface.co/…` installed as `hf.co/…` | POST `hf.co/…` (rewrite only) | GET tags, POST `hf.co/…` |
| `deepseek-r1` not installed | POST `deepseek-r1` | 0 chat POST, `errorKind: config` |
| empty inventory | POST `llama3.2` | 0 chat POST, `errorKind: config` |
| ambiguous `smollm2:135m` + `smollm2:360m` | POST `smollm2` | 0 chat POST, `errorKind: config` |
| `allowPull` / `ARK_OLLAMA_PULL=1` | POST `deepseek-r1`, 0 tags GET | POST `deepseek-r1`, 0 tags GET |
| empty env | Ollama unconfigured | still unconfigured |

Live Ollama on this host (`after-live.json`): inventory stayed `["smollm2:135m"]`. `smollm2:135m` completed in 581ms; family `smollm2` resolved to that tag in 40ms. `deepseek-r1` and default `llama3.2` failed with `ollama: config: … is not installed (have: smollm2:135m)` and did not pull. Before, the same daemon `POST /api/chat` for `deepseek-r1` returned HTTP 404 (`before-live-missing.json`).

Capture timestamps and commit SHAs are in `captures.tsv`.

## What this does not prove

Ollama versions that auto-pull on a missing chat tag were not exercised — this daemon 404s. `ARK_OLLAMA_PULL=1` was proved with mocked fetch only, not by downloading DeepSeek-R1. Family resolution is unique-prefix only; it will not map Hub ids like `HuggingFaceTB/SmolLM2-135M` onto `smollm2:135m`. No product app imports `@ark/runtime` yet. Control CSS / drizzle vendor-chunk issues from the walkthrough are untouched.

## Deviations

None. No new dependency. No `listModels()` on `ProviderAdapter`. Inventory stays inside the Ollama adapter. Different families are not silently substituted (`llama3.2` does not become `smollm2:135m`).

Round 1 non-blocking notes left as-is: live.mjs reports `errorKind: unknown` because `execute` wraps the last attempt; adapter-level kind is `config` in `after.json`. Happy-path tests do not count tags GETs (the probe does). No extra test for a down `/api/tags` (fail-closed follows from `resolveInstalled`).

## Definition of done

- **Cost / latency impact:** One extra local `GET /api/tags` per Ollama completion (this host: a few milliseconds). No additional model tokens. Missing-id path no longer spends a chat round-trip (live miss 2–4ms vs a 404). Cloud cost unchanged: empty env still does not configure frontier.
- **Observability for new failure modes:** Missing and empty inventory throw `ProviderError('config')`, which Runtime already maps to ingest `errorKind: config` on a failed attempt. The message names the requested id and the installed list. `/api/tags` failures keep the existing HTTP/network/timeout kinds and still do not POST chat.
- **Docs or ADR updated:** ADR-0006 and `docs/01-architecture.md` each gained one sentence. Operator env is `.env.example` (`ARK_OLLAMA_PULL`).
