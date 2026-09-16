# openai-runtime-path

**Status:** APPROVED
**Approved by:** repository owner (all OpenAI chat models through Runtime; re-test; keep it efficient)
**Date:** 2026-09-16

## Problem

Runtime’s frontier adapter is labelled OpenAI-compatible but does not actually take the OpenAI chat family as a caller would send it.

`configured()` requires `ARK_FRONTIER_BASE_URL`, `ARK_FRONTIER_API_KEY`, and `ARK_FRONTIER_MODEL`. An operator with `OPENAI_API_KEY` and a per-request `model` (gpt-4o, gpt-4o-mini, chatgpt-4o-latest, o3-mini, a fine-tune) is not configured. The router does not recognise `chatgpt-*`. GPT-5 / GPT-4.1 / o-series reject `max_tokens` and o-series reject `temperature`, so a correct request still burns a round-trip on 400 before fallback. Some chat completions return `content` as an array of parts; the parser treats that as empty text.

## Outcome

A caller with an OpenAI API key can run any OpenAI *chat* model through `@ark/runtime` on one request: the adapter comes up from `OPENAI_API_KEY` (official base URL by default), the model id on the request is enough (no default model required), the Chat Completions body uses the token/temperature fields that model accepts, and the parser reads string or array content. Embeddings, Whisper, TTS, and image models stay unselected.

## Implementation plan (reuse vs create)

### Reuse

`OpenAICompatibleAdapter`, `chatCompletionsUrl`, `parseOpenAIChat`, `adaptersFromEnv`, `hintAdapter`, `execute`. No vendor SDK. Assessment catalog rows stay as they are — unknown OpenAI ids remain unpriced, which Control already accepts.

### Change

```
packages/providers/src/from-env.ts              OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL; default api.openai.com/v1
packages/providers/src/openai-compatible.ts     configured() = url + key; model from request
packages/providers/src/parse.ts                 openaiChatBody; array content; max_completion_tokens vs max_tokens
packages/runtime/src/catalog.ts                 hint the OpenAI chat family, including chatgpt-* and ft:
packages/providers/src/*.test.ts
packages/runtime/src/catalog.test.ts            (new) / router tests
.env.example, smoke skip message
```

### Do not create or redesign

`apps/runtime`. Control schema, allowlist, dashboards. New catalog price rows. OpenAI SDK. Kubernetes, agents, RAG, streaming, tool-use execution.

## Acceptance criteria

1. **Key is enough.** `adaptersFromEnv` with `OPENAI_API_KEY` (and no `ARK_FRONTIER_*`) yields an openai-compatible adapter that is `configured() === true`, `defaultModel()` may be empty, and `complete({ messages, model: 'gpt-4o-mini' })` POSTs to `https://api.openai.com/v1/chat/completions`. `ARK_FRONTIER_*` still wins when set. Missing both key and URL stays unconfigured.
2. **Chat family routes; non-chat does not.** `hintAdapter` selects `openai-compatible` for `gpt-*`, `chatgpt-*`, `o{digit}*`, and `ft:<those>`. It does not select that adapter for `text-embedding-3-small`, `whisper-1`, `dall-e-3`, or `tts-1`.
3. **One request, the fields that model accepts.** For GPT-5 / GPT-4.1 / GPT-6 / chatgpt / o-series, the body sends `max_completion_tokens` and does not send `max_tokens`. o-series omit `temperature`. Other chat models still send `max_tokens`. `parseOpenAIChat` returns the joined text when `message.content` is an array of `{ text }` parts.
4. Unit tests cover 1–3. `npm test` and `npm run smoke:runtime` still pass. Live OpenAI is attempted when a key is present and recorded as skipped when it is not.

## How this will be proved

Cloud station is this container. No UI.

- **Artefact:** terminal output of `evidence/openai-runtime-path/probe.mjs` (configured-from-OPENAI_API_KEY, hints, payload fields, array-content parse).
- **Measured by:** same probe before and after against compiled packages with mocked `fetch`.
- **Conditions:** no live OpenAI required for the probe. If `OPENAI_API_KEY` or `ARK_FRONTIER_API_KEY` is set, smoke/live is attempted with `maxTokens: 8` on a cheap chat model and the result (ok / skipped / error class) is recorded without printing the key or the prompt.

## Out of scope

- Pricing every OpenAI SKU in the assessment catalog.
- Changing MY AI / teams / Control / factory.
- Streaming, tool-use, image, audio, embeddings.
- A fourth adapter or `apps/runtime`.

## Risk

Cloud credentials and prompt data. Keys still come from env. Prompts stay in-process. Ingest still omits `sample`. Defaulting to `api.openai.com` only when a key is present — no extra network on a machine with no key.

- **Rollback:** revert the branch.
