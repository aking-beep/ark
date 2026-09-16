# Evidence — huggingface-models

## What changed

Runtime now treats Hugging Face’s most-used open chat models as runable: `gpt-oss` and Kimi hint to Ollama (they did not), Hub GGUF paths rewrite to `hf.co/…`, and `HF_TOKEN` talks to `router.huggingface.co` instead of nowhere.

## How it was measured

Same machine, same command before and after: `node evidence/huggingface-models/probe.mjs` against compiled `@ark/providers` and `@ark/runtime` with mocked `fetch`. Hub ranking snapshotted live at spec time (`hf-top-downloads.txt`, Hugging Face API 2026-09-16). The probe uses a frozen id list so before/after compare.

`factory-prove.sh before` warned dirty=2: the spec and the probe script. Product code was still open-weight-runtime (`a20e167`). `after` stamped `44b5307` dirty=0.

Supporting: `npm test --workspace @ark/providers` (18 pass) and `npm test --workspace @ark/runtime` (33 pass). `npm run smoke:runtime` dry-run ok. No `HF_TOKEN` in this environment, so live Hub inference was skipped, not faked.

## Before / after

| | Before (`before-probe.txt`, `a20e167`) | After (`after-probe.txt`, `44b5307`) |
|---|---|---|
| `openai/gpt-oss-20b` / `openai/gpt-oss-120b` | `null` | `ollama` |
| `gpt-oss:20b` / `gpt-oss-20b` | `openai-compatible` (closed GPT branch) | `ollama` |
| `moonshotai/Kimi-K2-Instruct` | `null` | `ollama` |
| Qwen / Llama / DeepSeek / Gemma / SmolLM / GLM / QwQ Hub ids | `ollama` | `ollama` |
| `gpt-4o` / `gpt-5-nano` | `openai-compatible` | `openai-compatible` (unchanged) |
| `HF_TOKEN` only | unconfigured, URL `error` | configured, default `Qwen/Qwen3-8B`, POST `https://router.huggingface.co/v1/chat/completions` |
| `huggingface.co/bartowski/…` posted to Ollama | `huggingface.co/…` | `hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF` |
| Empty env | both unconfigured | still unconfigured |

Capture timestamps and commit SHAs are in `captures.tsv`.

## What this does not prove

The Hub snapshot is one day’s download ranking; it is not an exhaustive inventory of 45k GGUFs. Live Hugging Face Inference was not called (`HF_TOKEN` unset). Live Ollama was not asked to pull a Hub GGUF (that download is large and out of scope for CI). Closed GPT ids were intentionally not expanded. MY AI’s registry still has a single “open-weight (local)” card, not one row per Hub model.

## Deviations

None. No new dependency. No fourth adapter. Hosted Hub inference reuses the existing OpenAI-compatible protocol against Hugging Face’s router.

## Definition of done

- **Cost / latency impact:** Not applicable to the three UIs. Hosted HF, if keyed, is one Chat Completions POST with the existing 30s timeout (cloud residency). Local `hf.co/…` pulls are Ollama’s existing HTTP path.
- **Observability for new failure modes:** Unconfigured Ollama still throws `ProviderError('config')`. Empty env still leaves both adapters unconfigured, so `HF_TOKEN` is the only new outbound path.
- **Docs or ADR updated:** Not applicable — no new surface. Operator env is `.env.example` (`HF_TOKEN`).
