## Round 1 — 2026-09-26 — 5/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All six acceptance criteria met as written. Declared deviations (`run()` closes as `failure` not `error`; Connect is 1 + 2/3 not a three-column row; AI Fit names) are in `EVIDENCE.md` and match the schema / copy-paste constraint. |
| 2 | Evidence proves it | ✅ | Same probe twice (`before.txt` on `720048a`, `after.txt` matching `last-probe.txt`). Same 1440×900 routes: consumer `/`, teams `/`, empty Spend, `/start` 404 → Connect, seeded `/start`. HTML dumps sit next to the PNGs. “What this does not prove” is specific, not empty. |
| 3 | Structure holds | ✅ | Wrap lives in `@ark/sdk` (`instrument.ts` + `ArkIngest`). `/start` is edge UI over `requireOrg()`. No new third-party client, no new npm dependency, no service importing a framework request type. |
| 4 | Fails safely | ✅ | Parse and ingest fail open (`instrumentFetch` catch; `run()` `.catch` on `close`). Ingest already times out (`timeoutMs` default 10s). `/start` names env vars, never a bearer. `requireOrg()` still gates the page. Schema drift returns `null`. |
| 5 | Readable | ✅ | `instrumentFetch` / `run` / `observeLlmCall` / `activeTrace` name the jobs. Comments say why (fail open, ALS empty outside `run()`, never read `messages`). Tests in `packages/sdk/src/instrument.test.ts` cover two turns, concurrency, no prompt body, Control URL, ingest-down. |

**Blocking:** none.

**Non-blocking:**
- `apps/business/src/app/methodology/page.tsx:25` and `apps/control/src/app/start/page.tsx:18` cite `docs/08-how-ark-works.md` in a `<code>` tag. README and `docs/01-architecture.md` already href it. A clickable link would make AC5 literal on the two web pages.
- `evidence/suite-competitive-loop/captures.tsv:2` still stamps after as `074b22b`; the after PNGs and `after.txt` were recaptured after the AI Fit rename. The artifacts themselves match HEAD.
- `packages/sdk/src/index.ts:14` also exports `observeLlmCall` and `isControlIngestUrl`. Spec only required `instrumentFetch` and `run`. Harmless; a reader may wonder if they are the supported API.
