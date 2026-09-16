# Evidence — open-weight-runtime

## What changed

A caller can now name open-source chat models (`deepseek-r1`, SmolLM, Yi, Granite, Mixtral, …) and Runtime will select local Ollama and send that tag; `DEEPSEEK_API_KEY` wires the existing Chat Completions adapter to DeepSeek’s host, not OpenAI.

## How it was measured

Same machine, same command before and after: `node evidence/open-weight-runtime/probe.mjs` against compiled `@ark/providers` and `@ark/runtime` with mocked `fetch`. No OpenAI key. No live DeepSeek key.

`factory-prove.sh before` warned dirty=2: the spec and the probe script. Product code was still v0.2 on `d3d659f`. `after` stamped `74ab52d` dirty=0 (implementation committed; these artefacts written immediately after).

Supporting: `npm test` (exit 0) and `npm run smoke:runtime`. Live Ollama on this host (`smollm2:135m` already pulled): `ARK_OLLAMA_URL=http://127.0.0.1:11434 ARK_OLLAMA_MODEL=llama3.2 ARK_LIVE_MODEL=smollm2:135m node evidence/open-weight-runtime/live.mjs`.

## Before / after

| | Before (`before-probe.txt`, `d3d659f`) | After (`after-probe.txt`, `74ab52d`) |
|---|---|---|
| `hintAdapter('deepseek-r1')` | `null` | `ollama` |
| `hintAdapter('smollm2:135m')` | `null` | `ollama` |
| `hintAdapter('yi-34b')` | `null` | `ollama` |
| `hintAdapter('granite-code')` | `null` | `ollama` |
| `hintAdapter('olmo-2')` | `null` | `ollama` |
| `hintAdapter('mixtral')` | `null` | `ollama` |
| `hintAdapter('deepseek-chat')` / `deepseek-reasoner` | `null` | `openai-compatible` |
| `hintAdapter('qwen2.5' / 'llama3.2' / 'gemma2' / 'phi3')` | `ollama` (already) | `ollama` |
| `hintAdapter('gpt-4o' / 'gpt-5-nano')` | `openai-compatible` | `openai-compatible` (unchanged) |
| `hintAdapter('amazon.nova-lite-v1:0')` | `bedrock` | `bedrock` (unchanged) |
| `DEEPSEEK_API_KEY` only | `deepseekConfigured: false`, URL `error` | `true`, default `deepseek-chat`, POST `https://api.deepseek.com/v1/chat/completions` |
| Empty env | Ollama and frontier unconfigured | still unconfigured; no `api.openai.com` |
| Ollama POST model for `deepseek-r1` | `deepseek-r1` on `/api/chat` (already forwarded) | `deepseek-r1` on `/api/chat` |

Capture timestamps and commit SHAs are in `captures.tsv`, written by `scripts/factory-prove.sh`.

`npm test` after: exit 0 (`after-test.txt`), including 31 runtime tests (was 24 in v0.2) and 15 provider tests (was 12). Smoke dry-run still selects ollama; with `ARK_OLLAMA_URL` set, live adapter is ollama / `smollm2:135m` (`after-smoke.txt`). Live execute with env default `llama3.2` and request `smollm2:135m` returned `modelId: smollm2:135m` in 92ms (`after-live-ollama.txt`).

## What this does not prove

Hosted DeepSeek was not called live — `DEEPSEEK_API_KEY` is unset here; the DeepSeek path is mocked HTTP to `api.deepseek.com`. Live Ollama used one small tag (`smollm2:135m`); DeepSeek-R1, Yi, Granite, Mixtral weights were not pulled. Catalog 32B→14B is a pricing heuristic, not a measured token price. Closed-source OpenAI official models were intentionally not improved.

## Deviations

None. No new dependency. No fourth adapter. Hosted DeepSeek reuses the existing OpenAI-compatible protocol against DeepSeek’s host. `OPENAI_API_KEY` / `api.openai.com` were not added.

Round 1 non-blocking notes left as-is: `DEEPSEEK_API_KEY` remains a fallback Bearer when `ARK_FRONTIER_API_KEY` is empty; family matching still uses substring `includes`; live tag was SmolLM, not DeepSeek-R1.

## Definition of done

- **Cost / latency impact:** Not applicable to the three UIs — they do not import Runtime. Open-weight requests that previously had no hint still selected Ollama by cost when both adapters were eligible; the hint now states that preference. Live SmolLM completion was 92ms on this host. Hosted DeepSeek, if keyed, is one Chat Completions POST with the existing 30s adapter timeout.
- **Observability for new failure modes:** Unconfigured Ollama still throws `ProviderError('config')`. Hosted DeepSeek uses the existing openai-compatible timeout and ingest path. Empty env still leaves both adapters unconfigured, so there is no surprise outbound call.
- **Docs or ADR updated:** Not applicable — no new surface and no architecture change (ADR 0006 still holds). Operator env is `.env.example` (`DEEPSEEK_API_KEY`, Ollama open-weight comment).
