## Round 1 — 2026-09-16 — 5/5

From the artifacts alone, before any diff: a recovered fallback used to post one `ok` event; it now posts `error` then `ok` on the same trace, both `turn: 0`. A local-only refusal used to open a `failure` trace (`status: refused`, `errorKind: policy`); it now posts nothing. A provider HTTP body that contained `LEAK_SENTINEL` used to become `errorKind`; it now posts `errorKind: http` with the sentinel absent.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All three acceptance criteria match the after probe and the ingest path: two turn-0 events on a recovered fallback (`retries: 1`, `outcome: success`); `errorKind` is the closed enum and does not copy `Attempt.error`; `privacy: local-only` with no local adapter throws `PolicyError` and posts 0 events / 0 traces. No undeclared scope. |
| 2 | Evidence proves it | ✅ | Same command (`node evidence/runtime-v02/probe.mjs`) on the same machine. Before (`before-ingest.txt`, `abc2b36`) vs after (`after-ingest.txt`, `61cf6ee`) is in `after-summary.txt` and `captures.tsv`. `EVIDENCE.md` states the honest limit (fake adapters, no listening Control, `failureRate` SQL unchanged). Tests support; they are not the artifact. |
| 3 | Structure holds | ✅ | Changes stay in `@ark/runtime`: `execute` (service) → `runFallback` / `emitTelemetry` → provider adapters and `ArkIngest`. No edge file talks to a provider or database. No framework request/response types in service code. No new dependency. |
| 4 | Fails safely | ✅ | Ingest still cannot fail inference (`telemetry.ts:118-121`); Control client still has `timeoutMs: 2500` (`telemetry.ts:135`). Policy refusal returns without posting (`telemetry.ts:56-58`). `errorKind` is clamped to the closed set (`telemetry.ts:32-35`, `93-98`); `Attempt.error` is documented as in-process only (`types.ts:74`) and is not copied into the event. `RuntimeRequest` still parses at the execute boundary. |
| 5 | Readable | ✅ | Names match the spec (`closedErrorKind`, `classifyError`, `INGEST_ERROR_KINDS`, `refused`). Why-comments cover turn 0 vs new agent turns (`telemetry.ts:51-53`), unmatched Ollama → `local-8b` (`catalog.ts:11-12`), and not ingesting `Attempt.error`. Tests for fallback shape, leak, timeout status, and no policy trace live next to the code. |

**Blocking:** none.

**Non-blocking:**
- `execute.ts:67-68` still throws `runtime execution failed: ${last}` where `last` is `Attempt.error` (provider body). Ingest is clean; a caller that stringifies the exception still sees vendor text. Pre-existing, out of this spec.
- `telemetry.ts:81-90` is a second `ok` branch for an attempt whose adapter does not match `completion`. `runFallback` returns on first success, so execute never hits it. Harmless.
- The probe does not print Control `total_turns`. Both events are `turn: 0`; the spec’s `MAX(total_turns, turn+1)` claim is Control-side and is already listed under “what this does not prove.”
