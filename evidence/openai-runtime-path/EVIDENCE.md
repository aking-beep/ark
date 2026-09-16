# Evidence — openai-runtime-path

## What changed

An OpenAI API key is enough to run any OpenAI chat model through Runtime: official Chat Completions URL by default, model on the request, the token/temperature fields that model accepts, array content parsed as text. Embeddings, Whisper, TTS, and image models stay unselected.

## How it was measured

Same machine, same command before and after: `node evidence/openai-runtime-path/probe.mjs` against compiled `@ark/providers` and `@ark/runtime` with mocked `fetch`. No live OpenAI key in this environment.

Supporting: `npm test` exit 0; `npm run smoke:runtime` dry-run ok, live skipped (no key).

`factory-prove.sh before` warned dirty=2: the spec and the probe. Product code was still `d3d659f` (merged Runtime v0.1/v0.2). `after` stamped `a2f32f6`.

## Before / after

| | Before (`before-probe.txt`, `d3d659f`) | After (`after-probe.txt`, `a2f32f6`) |
|---|---|---|
| `OPENAI_API_KEY` only | `configured: false`, complete error | `configured: true`, POST `https://api.openai.com/v1/chat/completions` |
| Per-request model, no default | `ProviderError` | `ok` |
| `chatgpt-4o-latest` / `ft:gpt-4o-mini:…` | hint `null` | `openai-compatible` |
| Non-chat (`whisper-1`, `dall-e-3`, embeddings, `tts-1`) | `null` | `null` |
| GPT-5 body | `max_tokens`, no `max_completion_tokens` | `max_completion_tokens`, no `max_tokens` |
| o3-mini `temperature` | sent | omitted |
| Array `content` parts | `""` | `"Hello"` |

Capture timestamps and commit SHAs are in `captures.tsv`.

## What this does not prove

No live call to `api.openai.com` — this environment has no `OPENAI_API_KEY`. Adapter HTTP is mocked. Unknown OpenAI SKUs (e.g. `gpt-4o-mini`) stay unpriced in the assessment catalog. Groq/Together still receive `max_tokens` for non-GPT-5 models, which is the compatible-host path.

## Deviations

None. No new dependency. Catalog price rows were not added. No OpenAI SDK. After Round 1, smoke live supplies `gpt-5-nano` when the adapter has a key but no default model, and the from-env test asserts the official POST URL — reviewer non-blocking notes.

## Definition of done

- **Cost / latency impact:** One Chat Completions POST per attempt, as before. The change avoids a wasted 400 on GPT-5/o-series (`max_tokens` / `temperature`). Defaulting to `api.openai.com` happens only when a key is present.
- **Observability for new failure modes:** Missing model on both env and request is `ProviderError` `config`. Ingest behaviour unchanged.
- **Docs or ADR updated:** `.env.example` documents `OPENAI_*`. Smoke skip message names `OPENAI_API_KEY`. ADR-0006 unchanged (still no vendor SDK).
