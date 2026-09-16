# runtime-v01

**Status:** APPROVED
**Approved by:** repository owner (implement ARK Runtime inside this repo)
**Date:** 2026-09-16

## Problem

ARK estimates and measures AI workloads but cannot execute a model call. Operators who want a local-first, policy-constrained completion still leave the engine: they pick a provider by hand, lose the provenance ladder, and either skip Control ingest or invent a second event shape. The missing piece is an internal execution layer — not a fourth product surface — that routes a single request schema through policy, a provider adapter, bounded fallback, deterministic eval, and the existing Control ingest contract.

## Outcome

A caller can run one completion request through `@ark/runtime`: policy filters providers, a deterministic router explains its choice, Ollama / Bedrock / an OpenAI-compatible frontier adapter execute the same schema, local-only data cannot leave the machine, a failed allowed provider can fall back within a bound, eval scores quality/latency/cost/reliability, and Control receives a standard ingest batch — without raw prompts, and without ingest failure breaking inference.

## Implementation plan (reuse vs create)

### Reuse — do not duplicate

| Existing | Why Runtime uses it |
|---|---|
| `@ark/core` `Basis` / `Estimate` / `estimate()` | Provenance ladder on routing, cost, latency, quality. |
| `@ark/core` `Provider`, `Capability`, `Tier`, `CATALOG`, `byId`, `costOfCall`, `priceEvent` | Cost and capability checks; Control can price known `modelId`s. |
| `@ark/core` `EventInput`, `TraceClose`, `QualitySampleInput`, `IngestBody` | The Control ingest contract. |
| `@ark/core` `detectSensitive` (via `@ark/sdk` `scanLocally`) | Labels only; never persist prompt text. |
| `@ark/sdk` `ArkIngest` / `TraceHandle` | POST `/api/v1/events` with trace ids and turn indices. |
| Control `POST /api/v1/events` + GET shape | Telemetry target. Runtime does not add a new event schema. |
| Catalog `Provider` already includes `local` and `bedrock` | Adapter ids map onto those strings (`ollama` → `local`). |

Assessment routing in `packages/core/src/models/routing.ts` (`recommendModel`) stays an estimator. Runtime routing is a separate, execution-time decision with a live provider list. Eval *plans* in `packages/core/src/assess/evaluation.ts` stay workload-assessment artefacts; `@ark/evals` scores one completed call.

### Create

```
packages/providers/          @ark/providers — adapters (Ollama, Bedrock, OpenAI-compatible)
packages/evals/              @ark/evals — deterministic quality / latency / cost / reliability
packages/runtime/            @ark/runtime — policy, router, fallback, execute, telemetry
packages/runtime/src/smoke.ts
specs/runtime-v01.md
evidence/runtime-v01/
docs/adr/0006-runtime-is-not-a-surface.md
```

### Change (minimal)

- Root `package.json` — `build:packages` and `test` include the three new workspaces.
- `README.md` — layout line for the engine packages (not a fourth app).
- `.env.example` — Runtime provider and Control ingest variables.
- `docs/01-architecture.md` — one short subsection: Runtime is an internal library.

### Do not create or redesign

`apps/runtime`, Kubernetes, agents, RAG, vector DBs, training, MY AI / teams / Control / factory redesigns. No new third-party SDK (providers speak HTTP via `fetch` + Node `crypto` for SigV4).

## Acceptance criteria

1. `@ark/runtime` executes `caller → policy → router → provider → evaluation → Control ingest` with one request schema across Ollama, Bedrock, and an OpenAI-compatible frontier adapter. There is no `apps/runtime`.
2. `privacy: 'local-only'` is a hard policy constraint: cloud adapters are not selected and are not used as fallback. The router returns an explanation for the chosen provider.
3. Provider failure may fall back only to remaining policy-eligible adapters, bounded by `maxFallbacks`. Telemetry uses `@ark/sdk` against the existing ingest body; ingest/timeout/network failure never fails the completion; raw prompts are not sent (`sample` omitted). Provenance on routing/cost/latency/quality uses `heuristic | benchmark | calibrated | measured`.
4. Unit tests cover routing, local-only enforcement, provider result normalization, fallback, and telemetry failure. `npm run smoke --workspace @ark/runtime` runs without live providers (dry-run) and attempts Ollama / Bedrock / frontier when their env is set. `npm run build` and existing `npm test` still pass.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`). No UI.

- **Artefact:** terminal output (package listing, test log, smoke log).
- **Measured by:**
  - Before: `packages/` listing (no runtime/providers/evals); `npm test` pass count; `apps/runtime` absent.
  - After: same listing with the three packages; existing tests still pass; new runtime/providers/evals tests pass; smoke dry-run prints a routing explanation and a local-only refusal to select cloud.
- **Conditions:** `npm test` and smoke dry-run. Live Ollama/Bedrock/frontier only if those env vars and services are present; absence is recorded, not faked.

## Out of scope

- A Runtime UI or HTTP server.
- Changing MY AI, MY AI for teams, Control dashboards, or the factory.
- Adding Bedrock rows to the assessment catalog (unknown `modelId`s stay unpriced, which Control already accepts).
- Changing Control's default provider allowlist (operators who ingest `bedrock` set `ARK_PROVIDER_ALLOWLIST`; off-allowlist events are still stored).
- Kubernetes, agent loops, RAG, vector databases, model training, streaming, tool-use execution.

## Risk

Model calls, cloud credentials, and prompt data. Adapters read credentials from env only. Prompts stay in-process; Control gets token counts, model id, status, and eval labels. New workspace packages depend on `@ark/core`, `@ark/sdk`, `zod` (already in the lockfile for core), and Node built-ins. No AWS SDK.

- **Rollback:** revert the branch. Existing apps do not import Runtime.
