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

## Round 2 — 2026-09-15 — 5/5

From the artefacts alone, before any diff: a visitor to consumer `/` now sees **MY AI** (wordmark, title, “Find MY AI”) instead of Fit / “Find my fit”. A visitor to business `/` now sees **MY AI for teams** instead of AIFit for teams. An operator now installs `my-ai/` as Python package `myai` and runs `dev:my-ai-api` / `test:my-ai`; `/health` reports `"product":"MY AI"`. Same 1440×900 chrome dumps plus `after-engine.txt`.

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All six ACs met. Chrome/title/OG/CTA/body and “MY AI score”; business wordmark/kicker/titles; Control empty state, calibration, workload drift; named operator docs; Playwright plus no cross-links. AC6: directory `my-ai/`, package `myai` (`my-ai/pyproject.toml:6`), scripts `setup:my-ai` / `dev:my-ai-api` / `test:my-ai` (`package.json:15-25`), Docker `COPY my-ai` and `pip install -e ./my-ai` (`deploy/Dockerfile:23,27`), proxy errors “MY AI API …” (`apps/consumer/src/lib/my-ai-proxy.ts:31,67`), env `MYAI_ROOT` (`deploy/Dockerfile:30`, `my-ai/packages/core/src/myai/engine.py:27`). HTTP `/v1/*` and `@ark/consumer` unchanged; historical ADRs left. Spec expansion (AC6) declared in `EVIDENCE.md`. |
| 2 | Evidence proves it | ✅ | Before/after HTML and 1440×900 PNGs of consumer `/` and business `/`, greps in `before.txt` / `after.txt`, and `after-engine.txt` (`fit/` absent, `my-ai/` present, `name = "myai"`, live `/health` product MY AI, npm scripts). Honest “what this does not prove.” |
| 3 | Structure holds | ✅ | Edge routes still call the proxy adapter (`apps/consumer/src/app/v1/[...path]/route.ts:8`, `apps/consumer/src/app/health/route.ts:6`). Fetch stays in `my-ai-proxy.ts`. Directory/package rename only; no new dependency, no edge→adapter skip, no service importing framework types. |
| 4 | Fails safely | ✅ | No new external call or write path. Proxy still times out at 20s (`apps/consumer/src/lib/my-ai-proxy.ts:14,54`) and returns JSON 502/504. Scoring unchanged. |
| 5 | Readable | ✅ | Operator names (`my-ai/`, `myai`, `MYAI_ROOT`, `proxyMyAiRequest`) match the public brand. Playwright and `deploy/runtime.test.mjs` assert the new names, `my-ai/` paths, and the absence of `AIFit` / `Fit API`. Internal `FitFilters` / `myai.fit` stay as matching-domain vocabulary, declared in `EVIDENCE.md`. |

**Blocking:** none.
**Non-blocking:** `after-engine.txt:20` prints unlabeled `False False False`. There is no paired `before-engine.txt`; the after dump still records `fit/` absent vs `my-ai/` present. It does not curl a 502 “MY AI API is not configured” (asserted in `deploy/runtime.test.mjs:100-101`) and Docker was not rebuilt (disclosed). `captures.tsv:1` still stamps `factory-prove.sh before` on a dirty tree. Control pages were not screenshotted (disclosed). `.env.example` documents `API_ORIGIN` but not `MYAI_ROOT` (hosting table does: `docs/05-hosting.md:32`).
