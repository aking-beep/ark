# runtime-local-inventory

**Status:** APPROVED
**Approved by:** repository owner (build and test the next level of this product — local Ollama inventory so Runtime does not POST missing tags)
**Date:** 2026-09-16

## Problem

Runtime can now *name* open-weight models (DeepSeek-R1, SmolLM, gpt-oss, Hub `hf.co/…` paths) and forward that id to Ollama. It does not ask Ollama what is actually on the machine.

`GET /api/tags` on a typical workstation is a short list. This environment has only `smollm2:135m`. A request for `deepseek-r1`, `llama3.2`, or a Hub GGUF still `POST`s `/api/chat` with that tag. Ollama then 404s — or, for library and `hf.co/` ids, starts pulling gigabytes of weights the caller did not opt into. The open-weight product is local-first; accidental Hub pulls are the failure mode v0.1 left out of scope as “discover Ollama models.”

## Outcome

Ollama `complete()` lists installed tags first (`GET /api/tags`), uses an installed tag that matches the request (exact, `:latest`, or a unique family prefix), and refuses with `ProviderError('config')` instead of posting a missing tag. Auto-pull stays off unless the operator sets `ARK_OLLAMA_PULL`. Empty env stays unconfigured. There is still no `apps/runtime`.

## Implementation plan (reuse vs create)

### Reuse

Ollama adapter (`POST /api/chat`), `ollamaNativeModel`, `ProviderError('config')`, `fetchWithTimeout`, Runtime `execute` / fallback (a config miss is already a failed attempt). No fourth adapter. No `listModels()` on `ProviderAdapter`. No vendor SDK.

### Change

```
packages/providers/src/ollama.ts          GET /api/tags; resolve or refuse; optional allowPull
packages/providers/src/from-env.ts        ARK_OLLAMA_PULL
packages/providers/src/index.ts           export resolve helpers
packages/providers/src/adapters.test.ts   inventory cases
packages/runtime/src/execute.test.ts      mocks answer /api/tags
.env.example, ADR-0006 / architecture     one sentence each
```

### Do not create or redesign

`apps/runtime`. `ProviderAdapter.listModels()`. Silently substituting a different family (e.g. `llama3.2` → `smollm2:135m`). MY AI / teams / Control / factory. OpenAI official defaults. Pulling Hub weights in CI.

## Acceptance criteria

1. **Inventory before chat.** A configured Ollama `complete()` issues `GET {baseUrl}/api/tags` before any `POST /api/chat`, unless `allowPull` / `ARK_OLLAMA_PULL` is on.
2. **Installed ids run.** Request `smollm2:135m` when that tag is installed → `POST /api/chat` with `smollm2:135m`. Request `smollm2` when the only installed `smollm2*` tag is `smollm2:135m` → POST `smollm2:135m`. Request `llama3.2` when `llama3.2:latest` is installed → POST `llama3.2:latest`. `huggingface.co/org/repo` still posts as `hf.co/org/repo` when that installed name matches.
3. **Missing ids do not POST and do not pull.** Request `deepseek-r1` when only `smollm2:135m` is installed, and pull is off → no `POST /api/chat`, `ProviderError` with `kind: 'config'`. Empty inventory → same: no chat POST, `kind: 'config'`. Ambiguous family (`smollm2:135m` and `smollm2:360m`, request `smollm2`) → config error, no chat POST.
4. **Opt-in pull.** `allowPull: true` or `ARK_OLLAMA_PULL=1` skips the installed-tag requirement and POSTs the requested native id (Ollama may pull). Empty env still leaves Ollama unconfigured. Tests cover 1–4. `npm test` and `npm run smoke:runtime` pass. Live Ollama on this host records: `smollm2:135m` succeeds; `deepseek-r1` / default `llama3.2` config-fail; `/api/tags` still only `smollm2:135m` afterward.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`). No UI.

- **Artefact:** JSON from `evidence/runtime-local-inventory/probe.mjs` (tags GETs, chat POSTs, error kinds, posted model ids). Same command before and after.
- **Measured by:** mocked `fetch` with a fixture inventory of `smollm2:135m` (and the other cases in AC 2–4). Live daemon only if `http://127.0.0.1:11434/api/tags` responds; absence is skipped, not faked.
- **Conditions:** no OpenAI key. No `ARK_OLLAMA_PULL` on the live missing-id case.

## Out of scope

- Picking an arbitrary installed model when the requested family is absent (`llama3.2` must not become `smollm2:135m`).
- A first product caller in MY AI / teams.
- Streaming, tool-use, a Runtime HTTP server, Kubernetes, agents, RAG.
- OpenAI official API / `OPENAI_API_KEY`.
- Control CSS / drizzle vendor-chunk issues seen in the walkthrough (separate feature).

## Risk

One extra local HTTP GET per Ollama completion. Fail-closed if `/api/tags` is down (no silent pull). Prompts stay in-process. Ingest still omits `sample`. Config misses already map to Control `errorKind: config`.

- **Rollback:** revert the branch. Existing apps still do not import Runtime.
