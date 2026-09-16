# runtime-v02

**Status:** APPROVED
**Approved by:** repository owner (develop Runtime v0.2 from the v0.1 live demo and review)
**Date:** 2026-09-16

## Problem

v0.1 can run a completion. The traces it posts to Control do not describe that run the way the data model already requires.

A trace is one unit of work. An event is one model call. Fallback is a second model call, but v0.1 posts only the winner — Control never sees the failed adapter. Policy refusal is not a model call, but v0.1 opens a failure trace with a synthetic `provider: local` / `modelId: none` event; the live demo therefore reported a 33% failure rate on a workload that never called a model. `errorKind` is a 120-character slice of the provider HTTP body, so Control can store vendor error text (and whatever was in it).

Operators looking at Control after a Runtime call cannot tell which adapters ran, cannot trust failure rate, and cannot be sure ingest is free of provider payloads.

## Outcome

A Runtime completion posts one Control event per adapter attempt, keeps fallback on turn 0 (a retry of the same business turn, not a new agent turn), sends `errorKind` from a closed enum, and does not ingest a trace when policy refuses before any model is called.

## Implementation plan (reuse vs create)

### Reuse — do not duplicate

| Existing | Why v0.2 uses it |
|---|---|
| `@ark/core` `EventInput` / `TraceClose` | Same ingest contract. `status` already has `ok \| error \| timeout \| refused \| filtered`. `outcome` already has `abandoned`. v0.2 does not add fields. |
| `@ark/sdk` `ArkIngest` / `TraceHandle.event({ turn })` | Callers who pass `turn` keep control; passing `0` on every attempt keeps `total_turns` at 1. |
| `@ark/providers` `ProviderError.kind` | `timeout \| http \| network \| parse \| config` — the ingest enum is this set plus `unknown`. |
| Control `failureRate` = traces with `outcome <> 'success'` | Unchanged. Policy refusals must not become traces, because Control would count them as failures. Do not patch Control. |
| v0.1 `execute` / `route` / `applyPolicy` / `runFallback` | Routing, local-only, and bounded fallback stay as they are. This feature is telemetry honesty. |

### Change

```
packages/runtime/src/telemetry.ts   one event per attempt; skip ingest on policy refusal
packages/runtime/src/fallback.ts    classify ProviderError.kind onto Attempt
packages/runtime/src/types.ts       Attempt carries catalogProvider, modelId, errorKind
packages/runtime/src/catalog.ts     comment the unmatched-Ollama → local-8b mapping
packages/runtime/src/*.test.ts      ingest shape: fallback events, no leak, no policy trace
docs/adr/0006-runtime-is-not-a-surface.md
docs/01-architecture.md             one sentence: one event per attempt, policy not ingested
```

### Do not create or redesign

`apps/runtime`. Control schema, allowlist, dashboards, or `failureRate` SQL. Calibration-informed routing. Assessment `recommendModel` as an execution router. Kubernetes, agents, RAG, streaming, tool-use. New dependencies.

## Acceptance criteria

1. **One event per attempt.** After a fallback that fails then succeeds, ingest contains two events on the same trace, both `turn: 0`, one `status: error` (or `timeout`) and one `status: ok`. `traces[0].retries` equals the number of failed attempts. `traces[0].outcome` is `success`. `total_turns` stays 1 because Control stores `MAX(total_turns, turn+1)`.
2. **Closed `errorKind`.** Ingest `errorKind` is only `timeout | http | network | parse | config | unknown`. A `ProviderError` whose message contains an HTTP body or a sentinel secret does not copy that string into the ingest JSON. Timeout maps to event `status: timeout`; the other kinds map to `status: error`. Attempt.error may still hold the diagnostic in-process.
3. **Policy refusal is not a model failure.** `privacy: local-only` with no local adapter throws `PolicyError` as today and posts **no** events and **no** traces. Telemetry reports that ingest was not attempted. Control `failureRate` cannot rise because a request was refused before any `fetch`.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`). No UI.

- **Artefact:** terminal output of `evidence/runtime-v02/probe.mjs` (event count, turns, retries, outcomes, errorKind set, secret leak check). Same command before and after.
- **Measured by:**
  - Before: three cases against v0.1 `execute` — recovered fallback, policy refusal, provider error whose message contains `LEAK_SENTINEL`.
  - After: the same three cases. Fallback posts two turn-0 events; refusal posts nothing; sentinel is absent from ingest JSON and errorKind is in the closed set.
- **Conditions:** in-memory fake adapters and a capturing `ArkIngest`. No live Ollama/Bedrock/frontier required. `npm test` and `npm run smoke:runtime` still pass.

## Out of scope

- A Runtime UI or HTTP server.
- Changing MY AI, MY AI for teams, Control dashboards, allowlist, catalog rows, or `failureRate` SQL.
- Using Control calibration priors to pick a model (routing stays deterministic).
- Provider timeout env, streaming, tool-use, Kubernetes, agents, RAG, training.
- Unrelated bugs found along the way.

## Risk

Telemetry shape change. Callers who already ingested v0.1 Runtime traffic will see more events per recovered fallback (honest) and will stop seeing policy-refusal traces (also honest). Prompts still omitted. Ingest failure still does not fail inference. No new dependency. No new credentials.

- **Rollback:** revert the branch. Existing apps still do not import Runtime.
