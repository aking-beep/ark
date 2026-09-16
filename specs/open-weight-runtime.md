# open-weight-runtime

**Status:** APPROVED
**Approved by:** repository owner (open-source models through Runtime: Ollama, DeepSeek, the rest of the open-weight family — not OpenAI)
**Date:** 2026-09-16

## Problem

Runtime can talk to Ollama, but it only *recognises* a handful of names (`llama`, `mistral`, `qwen`, `phi`, `gemma`). A request for `deepseek-r1`, `smollm2:135m`, `yi-34b`, or `granite` has no open-weight hint, so when a cloud frontier is also configured the router does not prefer local Ollama. Hosted DeepSeek (`deepseek-chat` / `deepseek-reasoner`, open-weight models on DeepSeek’s own Chat Completions host) has no env path. This is the local-first product; it is not an OpenAI client.

## Outcome

A caller can run open-source chat models through `@ark/runtime`: Ollama is selected for the open-weight family (DeepSeek-R1, SmolLM, Yi, Gemma, Llama, Qwen, Mistral, Granite, …) and the requested model id is forwarded to Ollama; `DEEPSEEK_API_KEY` configures the existing OpenAI-compatible adapter against `https://api.deepseek.com` for `deepseek-chat` / `deepseek-reasoner`. Closed-source ids (`gpt-*`, Bedrock ARNs) are unchanged. There is no OpenAI default host and no `OPENAI_API_KEY` shortcut.

## Implementation plan (reuse vs create)

### Reuse

Ollama adapter (`POST /api/chat`), OpenAI-compatible adapter (protocol only — DeepSeek’s host, not OpenAI’s), `hintAdapter`, `execute`, catalog local-8b/14b/70b rows. No vendor SDK. No fourth adapter.

### Change

```
packages/runtime/src/catalog.ts          open-weight hint; DeepSeek API ids; size map 32b→14b
packages/providers/src/from-env.ts       DEEPSEEK_API_KEY → api.deepseek.com
packages/providers/src/parse.ts          Ollama message.content or thinking
packages/runtime/src/catalog.test.ts
packages/providers/src/from-env.test.ts
.env.example, smoke skip message
```

### Do not create or redesign

`apps/runtime`. OpenAI official API defaults. Control schema. New catalog price rows. Kubernetes, agents, RAG.

## Acceptance criteria

1. **Open-weight hints select Ollama.** `hintAdapter` returns `ollama` for `deepseek-r1`, `deepseek-r1:8b`, `smollm2:135m`, `yi-34b`, `granite-code`, `olmo-2`, `qwen2.5`, `llama3.2`, `gemma2`, `phi3`, `mixtral`. It does **not** return `ollama` for `gpt-4o`, `gpt-5-nano`, `amazon.nova-lite-v1:0`, or `claude-sonnet-5`.
2. **The model id is what Ollama receives.** `execute` with a configured Ollama adapter and `model: 'deepseek-r1'` POSTs that id to `/api/chat` (not the env default `llama3.2`). Foreign closed-source hints are still stripped on fallback to Ollama.
3. **Hosted DeepSeek is opt-in env, not OpenAI.** `adaptersFromEnv({ DEEPSEEK_API_KEY })` configures openai-compatible against `https://api.deepseek.com` with default model `deepseek-chat`. `hintAdapter('deepseek-chat')` and `hintAdapter('deepseek-reasoner')` select `openai-compatible`. Empty env still leaves both Ollama and frontier unconfigured. No default `api.openai.com`.
4. Tests cover 1–3. `npm test` and `npm run smoke:runtime` pass. Live Ollama is attempted when `ARK_OLLAMA_URL` is set (or a daemon is used in this environment) and recorded; absence is skipped, not faked.

## How this will be proved

- **Artefact:** `evidence/open-weight-runtime/probe.mjs` JSON (hints, forwarded Ollama model, DeepSeek env URL).
- **Measured by:** same probe before and after, mocked `fetch`. Live Ollama if present: one short completion on a small open-weight tag.
- **Conditions:** no OpenAI key required. DeepSeek live API only if `DEEPSEEK_API_KEY` is set.

## Out of scope

- OpenAI official models / `OPENAI_API_KEY` / `api.openai.com`.
- Pulling every Ollama library weights in CI.
- Pricing every GGUF in the assessment catalog.
- Changing MY AI / teams / Control / factory.

## Risk

Local HTTP to Ollama; optional DeepSeek key from env. Prompts stay in-process. Ingest still omits `sample`.

- **Rollback:** revert the branch.
