# huggingface-models

**Status:** APPROVED
**Approved by:** repository owner (review Hugging Face most-used open models; those this product can run must be recognised)
**Date:** 2026-09-16

## Problem

Hugging Face is where open-weight chat models actually live. A snapshot of Hub `text-generation` downloads (2026-09-16) is dominated by Qwen, Llama, **gpt-oss**, DeepSeek, Gemma, SmolLM, Kimi, and GLM. Runtime already hints several of those families to Ollama, but:

- Ollama tags `gpt-oss:20b` / `gpt-oss-20b` match `startsWith('gpt-')` and are treated as closed OpenAI.
- Hugging Face ids `openai/gpt-oss-20b` and `moonshotai/Kimi-K2-Instruct` have no open-weight hint.
- There is no `HF_TOKEN` path to Hugging Face’s Chat Completions router (`https://router.huggingface.co`), so hosted open models on the Hub cannot be selected the way DeepSeek already can.

This product is local-first open-weight execution, not an OpenAI client. Closed `gpt-4o` / `gpt-5-*` stay on the existing frontier hint.

## Outcome

A caller can name the Hugging Face models this product can actually run — Hub repo ids, Ollama library tags, and `hf.co/…` GGUF paths — and Runtime will select Ollama for the open-weight ones (including **gpt-oss** and **Kimi**). `HF_TOKEN` configures the existing OpenAI-compatible adapter against `https://router.huggingface.co` with default model `Qwen/Qwen3-8B`. Empty env stays unconfigured. Closed-source GPT ids are unchanged.

## Implementation plan (reuse vs create)

### Reuse

Ollama adapter, OpenAI-compatible adapter (protocol only), `hintAdapter`, `adaptersFromEnv`. No Hugging Face SDK. No fourth adapter. No new catalog price rows.

### Change

```
packages/runtime/src/catalog.ts          gpt-oss before gpt-*; kimi/moonshot/qwq/grok/ornith; hf.co paths
packages/providers/src/from-env.ts       HF_TOKEN → router.huggingface.co
packages/providers/src/ollama.ts         huggingface.co/… → hf.co/…
packages/runtime/src/catalog.test.ts
packages/providers/src/from-env.test.ts
.env.example, smoke skip message
```

### Do not create or redesign

`apps/runtime`. OpenAI official defaults. MY AI registry rows per Hub model. Control schema. Pulling Hub weights in CI.

## Acceptance criteria

1. **Hugging Face most-used open chat ids hint Ollama.** `hintAdapter` returns `ollama` for `openai/gpt-oss-20b`, `gpt-oss:20b`, `gpt-oss-20b`, `Qwen/Qwen3-8B`, `Qwen/Qwen2.5-7B-Instruct`, `meta-llama/Llama-3.1-8B-Instruct`, `deepseek-ai/DeepSeek-R1`, `google/gemma-3-1b-it`, `HuggingFaceTB/SmolLM2-135M`, `moonshotai/Kimi-K2-Instruct`, `zai-org/GLM-5.2`, `Qwen/QwQ-32B`, `hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF`. It does **not** return `ollama` for `gpt-4o`, `gpt-5-nano`, or `amazon.nova-lite-v1:0`.
2. **gpt-oss is open-weight, not closed GPT.** `gpt-oss:20b` is not sent down the `gpt-*` frontier branch.
3. **Hosted Hub inference is opt-in env.** `adaptersFromEnv({ HF_TOKEN })` configures openai-compatible against `https://router.huggingface.co` with default model `Qwen/Qwen3-8B`. `ARK_FRONTIER_*` and `DEEPSEEK_API_KEY` still win over `HF_TOKEN`. Empty env leaves Ollama and frontier unconfigured. No `api.openai.com`.
4. **Ollama GGUF paths stay Hub-shaped.** `huggingface.co/org/repo` is posted to Ollama as `hf.co/org/repo`. Tests cover 1–3. `npm test` and `npm run smoke:runtime` pass.

## How this will be proved

- **Artefact:** `evidence/huggingface-models/probe.mjs` JSON (hints for the Hub snapshot ids, HF env URL).
- **Measured by:** same probe before and after, mocked `fetch`. The Hub download ranking is snapshotted in `hf-top-downloads.txt` (live API at spec time); the probe itself is frozen so before/after compare.
- **Conditions:** no OpenAI key. Live Hugging Face Inference only if `HF_TOKEN` is set. Live Ollama only if `ARK_OLLAMA_URL` is set.

## Out of scope

- Pricing every GGUF in the assessment catalog.
- Adding one MY AI registry card per Hub model.
- Pulling 30B+ weights in CI.
- OpenAI official API / `OPENAI_API_KEY`.

## Risk

Optional `HF_TOKEN` from env; prompts stay in-process. Ingest still omits `sample`. Hugging Face router is cloud residency.

- **Rollback:** revert the branch.
