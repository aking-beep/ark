## Round 1 — 2026-09-16 — 5/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All four acceptance criteria hold: Hub/Ollama ids in AC1 hint `ollama` (including gpt-oss and Kimi); `gpt-oss:20b` is not the closed `gpt-*` branch; `HF_TOKEN` configures openai-compatible at `https://router.huggingface.co` with default `Qwen/Qwen3-8B`, DeepSeek still wins, empty env stays unconfigured; `huggingface.co/…` is posted as `hf.co/…`. No silent extra surface (no fourth adapter, no HF SDK, no new price rows). |
| 2 | Evidence proves it | ✅ | Same probe (`probe.mjs`, mocked fetch) before `a20e167` and after `44b5307`. Before: gpt-oss Hub ids `null`, `gpt-oss:20b` → `openai-compatible`, Kimi `null`, `HF_TOKEN` unconfigured/`error`, GGUF posted as `huggingface.co/…`. After: those ids → `ollama`, HF POST `https://router.huggingface.co/v1/chat/completions`, GGUF `hf.co/…`. “What this does not prove” names live Hub inference, live Ollama pulls, and MY AI registry. |
| 3 | Structure holds | ✅ | Hints stay in `packages/runtime/src/catalog.ts` (service). Env wiring stays in `packages/providers/src/from-env.ts`; Hub path rewrite stays in `packages/providers/src/ollama.ts`. Existing OpenAI-compatible adapter is reused; no client constructed outside an adapter; no new dependency. |
| 4 | Fails safely | ✅ | New outbound path reuses `OpenAICompatibleAdapter` (`timeoutMs` default 30s via `fetchWithTimeout`). Empty env still leaves Ollama and frontier unconfigured. Unconfigured Ollama still throws `ProviderError('config')`. Runtime fallback/privacy filters are unchanged. |
| 5 | Readable | ✅ | gpt-oss-before-`gpt-*` and `hf.co` path rules have why-comments. Tests sit next to the logic (`catalog.test.ts`, `from-env.test.ts`, `adapters.test.ts`) and name the spec ids. |

**Blocking:** none
**Non-blocking:** `packages/providers/src/from-env.ts:32` also reads `HUGGING_FACE_HUB_TOKEN` (spec named only `HF_TOKEN`); a one-line why would help. `from-env.test.ts` asserts DeepSeek-over-HF but not `ARK_FRONTIER_*`-over-HF even though AC3 names both. `packages/runtime/src/catalog.ts:27` adds `'grok'` (listed in the spec plan); that substring will also match closed xAI ids such as `grok-2`.
