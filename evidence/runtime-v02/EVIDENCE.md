# Evidence — runtime-v02

## What changed

Runtime now posts one Control event per adapter attempt, keeps fallback on turn 0, sends `errorKind` from a closed enum, and does not ingest a trace when policy refuses before any model is called.

## How it was measured

Same machine, same command before and after: `node evidence/runtime-v02/probe.mjs` against compiled `@ark/runtime` with in-memory fake adapters and a capturing `ArkIngest`. No live Ollama, Bedrock, or frontier. Supporting: `npm test` (exit 0) and `npm run smoke:runtime`.

`factory-prove.sh before` warned dirty=2: the spec and the probe script. Product telemetry code was still v0.1 (`abc2b36`). `after` stamped `61cf6ee` dirty=0 (implementation committed; these artefacts written immediately after).

## Before / after

| | Before (`before-ingest.txt`, `abc2b36`) | After (`after-ingest.txt`, `61cf6ee`) |
|---|---|---|
| Recovered fallback | 1 event, `status: ok` only, retries=1 | **2 events**, `error` then `ok`, both `turn: 0`, retries=1, outcome=success |
| Policy refusal | 1 event `status: refused`, `errorKind: policy`, outcome=**failure** | **0 posts** (no events, no traces) |
| Provider HTTP body with `LEAK_SENTINEL` | `errorKind` = `ollama: http: ollama HTTP 500: LEAK_SENTINEL`, `leakedSentinel: true` | `errorKind: http`, `leakedSentinel: false` |

Capture timestamps and commit SHAs are in `captures.tsv`, written by `scripts/factory-prove.sh`.

`npm test` after: exit 0 (`after-test.txt`), including 24 runtime tests (was 17 in v0.1). Smoke dry-run still selects ollama, local-only fallbacks `[]`, local-only without ollama selected `null` (`after-smoke.txt`).

## What this does not prove

The probe uses fake adapters and a capturing ingest, not a listening Control on `:3002`. Live Ollama/Bedrock/frontier were not configured. Control's `failureRate` SQL is unchanged — honesty depends on Runtime not opening a refusal trace, which the probe shows, not on a dashboard screenshot. `retriesPerFailure` in Control still averages `traces.retries` across all traces; recovered fallbacks still carry `retries: 1` as in v0.1.

## Deviations

None. No new dependency. Control schema, allowlist, and dashboards were not changed. Routing, local-only, and bounded fallback are unchanged; this feature is ingest shape.

## Definition of done

- **Cost / latency impact:** Not applicable to the three UIs — they do not import Runtime. Ingest may post one extra event per recovered fallback (a few hundred bytes). No additional model calls.
- **Observability for new failure modes:** Failed adapter attempts are now visible as Control events with `status: error|timeout` and a closed `errorKind`. Policy refusal remains a thrown `PolicyError` and is intentionally absent from Control. Ingest failure still cannot fail inference.
- **Docs or ADR updated:** `docs/adr/0006-runtime-is-not-a-surface.md` and the architecture Runtime subsection.
