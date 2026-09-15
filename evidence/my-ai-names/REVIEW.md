## Round 1 — 2026-09-15 — 5/5

From the artefacts alone, before any diff: a visitor to consumer `/` now sees **MY AI** (wordmark, document title, “Find MY AI”) instead of Fit / “Find my fit”. A visitor to business `/` now sees **MY AI for teams** instead of AIFit for teams. Same routes, 1440×900 PNGs, and HTML dumps.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All five ACs met: consumer chrome/title/OG/CTA/body and “MY AI score”; business wordmark/kicker/titles; Control dashboard empty state, calibration, and workload drift; named operator docs; Playwright plus no cross-links. Code paths `fit/`, `fit-proxy.ts`, `taskFit` unchanged. Extra Control PRD copy was declared in `EVIDENCE.md`. |
| 2 | Evidence proves it | ✅ | Before/after HTML and 1440×900 PNGs of consumer `/` and business `/`, plus greps in `before.txt` / `after.txt`. Honest “what this does not prove.” `factory-prove.sh before` was stamped late on a dirty tree (`captures.tsv:1`); the dumps themselves still contain the old brand (consumer 17:21Z, business 17:24Z). |
| 3 | Structure holds | ✅ | Copy, metadata, docs, and tests only. No new dependency, no edge→adapter skip, no service importing framework types. |
| 4 | Fails safely | ✅ | No new external call, timeout, or write path. Scoring and proxy behaviour unchanged. |
| 5 | Readable | ✅ | Brand strings updated in the files a reader would open; Playwright and `deploy/runtime.test.mjs` now assert the new names and the absence of `AIFit`. |

**Blocking:** none.
**Non-blocking:** `captures.tsv:1` records `factory-prove.sh before` after edits had started (`dirty=27`, same SHA as after). Control surfaces named in AC3 were not screenshotted (disclosed). `docs/05-hosting.md:4` still titles the Docker section “Fit API”; `apps/consumer/src/lib/fit-proxy.ts:31` still returns “Fit API is not configured” — both are the scoring-service path the spec told the builder to leave.
