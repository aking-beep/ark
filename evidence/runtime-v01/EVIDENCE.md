# Evidence — runtime-v01

## What changed

Callers can import `@ark/runtime` and run one completion schema through policy, a deterministic router, Ollama / Bedrock / OpenAI-compatible adapters, bounded fallback, eval, and the existing ARK Control ingest contract — without a fourth app.

## How it was measured

Same machine, cold `npm test` / `npm run smoke:runtime` / `npm run build`. No Ollama process on `:11434`, no AWS credentials, no frontier API key.

- **Before:** `ls packages` (core, db, sdk, ui only); `test -d apps/runtime` missing; `npm test` exit 0 on adc4645.
- **After:** `ls packages` includes providers, evals, runtime; `apps/runtime` still absent; `npm test` exit 0 (121 node:test counts, 0 fails); smoke dry-run selects ollama, local-only fallbacks `[]`, local-only without ollama selected `null`; `npm run typecheck` and `npm run build` (all three Next apps) exit 0.

Commands: `npm test`, `npm run smoke:runtime`, `npm run typecheck`, `npm run build`.

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before-packages.txt`, `before-test.txt` | `after-packages.txt`, `after-test.txt`, `after-smoke.txt` |
| Measurement | packages: core, db, sdk, ui. `apps/runtime` absent. `npm test` exit 0 (existing core/db/sdk/deploy/consumer tests). | packages: core, db, evals, providers, runtime, sdk, ui. `apps/runtime` still no. `npm test` exit 0 including 11 provider + 5 eval + 17 runtime tests. Smoke: `privacy=local-only fallbacks: []`, `local-only without ollama selected: null`. Full `npm run build` succeeded. |

Capture timestamps and commit SHAs are in `captures.tsv`, written by `scripts/factory-prove.sh`.

`factory-prove.sh before` warned dirty=2: the spec and the before artefacts themselves. Product packages were still the original four; `before-packages.txt` was written before those library files existed.

`after` stamped dirty=6 while adapter HTTP tests and this document were still uncommitted. The after test log already includes those HTTP adapter tests.

## What this does not prove

Live Ollama, Bedrock, and frontier calls were not executed here — those daemons and credentials were absent. Adapter HTTP paths are covered with mocked `fetch` (including SigV4 to the Converse URL). Telemetry was proven against a fake Control, not a listening `:3002`. Cost figures for unknown Bedrock model ids stay heuristic/unpriced, matching Control's existing unknown-model behaviour.

## Deviations

None of the three product apps were redesigned. Control's default `ARK_PROVIDER_ALLOWLIST` was not changed; `provider: bedrock` events will be stored and flagged `off_allowlist` until an operator adds `bedrock`. No AWS/OpenAI SDK: adapters use `fetch` and a local SigV4 signer. `zod` is a direct dependency of the new packages (same version as `@ark/core`). Assessment `recommendModel` is unused by Runtime on purpose — it is an estimator, not an execution router.

## Definition of done

- **Cost / latency impact:** Not applicable to the three UIs — they do not import Runtime. Runtime itself issues model calls only when a caller invokes `execute()` with a configured adapter; smoke uses `maxTokens: 16` on the live path.
- **Observability for new failure modes:** Provider timeout/HTTP errors become fallback or a thrown execution error. Control ingest timeout/failure is swallowed and returned on `result.telemetry`. Policy refusal is `PolicyError` with the routing rationale.
- **Docs or ADR updated:** `docs/adr/0006-runtime-is-not-a-surface.md`, architecture subsection, README layout, `.env.example`.
