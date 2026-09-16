# ADR-0006: Runtime is an engine library, not a fourth surface

**Status:** Accepted
**Date:** 2026-09-16

## Context

ARK is three products (MY AI, MY AI for teams, ARK Control) over one engine. The thesis and the roadmap refuse a model gateway, an agent framework, and "sitting in the request path." Operators still need to *run* a completion under the same privacy, provenance, and telemetry rules the rest of the engine already has. The tempting shape is `apps/runtime` — a fourth UI or an HTTP proxy.

## Decision

Runtime is three workspace packages, imported by callers, never a Next app:

- `@ark/providers` — HTTP adapters (Ollama, Bedrock Converse, OpenAI-compatible)
- `@ark/evals` — deterministic quality / latency / cost / reliability of one call
- `@ark/runtime` — policy → router → fallback → eval → `@ark/sdk` ingest

Telemetry uses the existing `POST /api/v1/events` body. Each adapter attempt is one event; fallback retries share `turn: 0` so Control does not count them as extra agent turns. `errorKind` is a closed enum (`timeout | http | network | parse | config | unknown`), never a provider HTTP body. Policy refusal is not ingested — Control's `failureRate` is traces with `outcome <> success`, and a request that never called a model is not a failed outcome. Prompts are not attached. Ingest failure does not fail inference. `privacy=local-only` is enforced before any adapter is called, including on fallback.

## Consequences

**Good.** Assessment routing (`recommendModel`) stays an estimator. Execution routing is a separate, deterministic decision over live adapters. Control does not grow a second event schema. There is no Runtime URL to confuse with the three products.

**Bad.** Bedrock `modelId`s are usually absent from the assessment catalog, so Control will leave those events unpriced unless the caller supplies `costUsd` (Runtime does, when it can map to a catalog row). Operators who ingest `provider: bedrock` should add it to `ARK_PROVIDER_ALLOWLIST`; off-allowlist events are still stored.

## Alternatives considered

**A fourth Next app.** Rejected: it would be a product surface, and the repo already has three. Runtime is not a UI.

**AWS / OpenAI SDKs.** Rejected for v0.1: adapters speak HTTP via `fetch`. Bedrock uses a local SigV4 signer. A vendor SDK is a later decision if Converse coverage is not enough.
