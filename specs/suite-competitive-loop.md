# suite-competitive-loop

**Status:** APPROVED
**Approved by:** repository owner (make the three products competitive; 2026-09-20). Owner correction 2026-09-26: AI Fit, AI Fit Teams, and Control are three products, not one suite.
**Date:** 2026-09-20

## Problem

A product review of the suite after protocol-evidence-plane scored it as internally 5/5 and externally not competitive. The thesis is sharp. The experience is three unfinished-feeling surfaces and an SDK that still requires the caller to invent trace ids.

- **Instrumentation is a day of reading.** `@ark/sdk` records events if you already know the data model. Langfuse/Helicone win the bake-off because `wrapOpenAI()` is five lines. Our own Phase 2 kill criterion is: if instrumenting a real workload takes more than a day of a customer engineer’s time, the SDK *is* the product problem.
- **Control’s empty state is an operator note**, not a connect path. There is no `/start`. The dashboard says `POST /api/measure` and names env vars. A stranger cannot get a trace on screen without opening the repo.
- **Each landing feels unfinished on its own.** Teams is a long essay. Consumer does not name the files you walk away with. The assess → measure → Control loop that joins AI Fit Teams to Control exists only in `docs/`. AI Fit never joins that loop.
- **The system documentation is scattered** across a thesis, three PRDs, seven numbered docs and an ADR. There is no one page a new engineer or a buyer can read that says what talks to what, what never talks, and what a request looks like from quiz to drift.

The consumer PRD and `specs/three-product-runtime.md` **still forbid** an AI Fit → AI Fit Teams funnel. This feature does not add one.

## Outcome

A TypeScript caller can wrap the OpenAI or Anthropic HTTP client they already have, run one unit of work, and see a trace in Control without reading the data model. An empty Control org lands on a Connect page with that snippet. The three landings look like finished, separate products that share a thesis, not one suite and not three apps in a monorepo. `docs/08-how-ark-works.md` is the map of the whole system.

## Acceptance criteria

1. **Drop-in wrap.** `@ark/sdk` exports `ArkIngest#instrumentFetch` and `ArkIngest#run`. `instrumentFetch(fetch)` returns a `fetch` that, when used inside `run(workloadId, fn)`, records one model event per OpenAI `/chat/completions` or Anthropic `/v1/messages` response, with model, token counts, latency, and a monotonic turn index, on one trace. It never stores the request or response body as a sample. Calls to Control’s own `/api/v1/events` are not re-instrumented. Calls outside `run()` are a no-op (no invented traces). `run` closes the trace as `success` or `error`; ingest failure inside `run` does not fail `fn`. Tests cover: two turns, one trace; concurrent `run()`s do not share a trace; a prompt body is not in the POST; a Control URL is not recorded as a model call.

2. **Control Connect.** Authenticated `GET /start` is 200. It shows three paths, in this order: wrap the SDK you already have; `POST /api/measure` from AI Fit Teams; protocol evidence via `trace.evidence(...)`. Snippets name `ARK_CONTROL_URL` and `ARK_CONTROL_TOKEN`, never a bearer secret. The empty Spend dashboard’s primary action is this page. Nav includes **Connect**. Seeded orgs still see Spend as today; Connect is documentation, not a redirect.

3. **Teams landing is a product, not an essay.** `/` on `:3001` shows (a) a three-step loop Assess → Measure → Control, (b) the eight report sections as a compact list of what you walk out with, (c) the existing `not-ai` claim, (d) CTAs to `/assess` and `/methodology` and the Control URL. Still **no** “Open AI Fit”, “Not at work?”, consumer URL, or “six questions”.

4. **Consumer landing names the payoff.** `/` on `:3000` names the paste-ready files (`CLAUDE.md`, Cursor rules, `AGENTS.md`) in the hero or the how-it-works row. “Find AI Fit” and “See an example” stay. Still **no** “For teams”, `NEXT_PUBLIC_ARK_BUSINESS_URL`, or Control link in the chrome.

5. **System map, one page.** New `docs/08-how-ark-works.md` explains, in this order: the three products and the two libraries that are not products; the only runtime wire (teams ↔ Control); what a unit of work looks like across four grains; how a number gets from `heuristic` to `measured`; what is forbidden (funnel, payloads in the DB, sitting in the request path, guessing ROI). README gains a short “How it fits together” that links it. `docs/01-architecture.md` links it from the top. Teams `/methodology` links it. Control `/start` links it. Consumer `/methodology` may say AI Fit is a separate product; it must not link to the teams assess URL.

6. **Existing behaviour is preserved.** `not-ai`, blank Today → unknowable payback, 30-trace floor, org isolation, protocol redaction, consumer not importing `@ark/core`/`@ark/db`. `npm run typecheck`, `npm test`, `npm run test:my-ai`, `npm run build` pass.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`). Ports: consumer `:3000`, business `:3001`, Control `:3002`.

- **Artefact:** `node evidence/suite-competitive-loop/probe.mjs` before and after (same command), plus 1440×900 screenshots of consumer `/`, teams `/`, Control `/start` (empty org) and Control `/start` (seeded org), and HTML dumps of the three landings.
- **Measured by:**
  - Before: `@ark/sdk` has no `instrumentFetch` / `run`; `GET :3002/start` is 404; consumer HTML does not contain `CLAUDE.md`; teams HTML has no “Assess → Measure”; `docs/08-how-ark-works.md` is absent.
  - After: probe records wrap (two turns, one trace, no prompt body); `/start` is 200 and contains `instrumentFetch` and `ARK_CONTROL_TOKEN` and does not contain `ark_dev_ingest`; consumer HTML contains `CLAUDE.md` and does not contain “For teams”; teams HTML contains the loop and does not contain “Open AI Fit”; `docs/08-how-ark-works.md` exists.
- **Conditions:** compiled packages; fake LLM fetch for wrap tests (no live provider required); seeded SQLite; 1440×900.

## Out of scope

- An AI Fit ↔ AI Fit Teams funnel, `NEXT_PUBLIC_ARK_BUSINESS_URL`, or “For teams” on the consumer chrome.
- Python SDK, sitting in the request path, OpenAI default keys, `apps/runtime`.
- SSO, billing, Postgres cutover, hosted SaaS.
- Rewriting the scoring rubric, the protocol adapters, or the provenance ladder.
- Unifying the three visual systems. Consumer stays cream/Geist; teams and Control stay the dark instrument panel.
- Making UCP/AP2 live commerce.

## Risk

`instrumentFetch` parses provider JSON. A schema change at OpenAI or Anthropic must fail open (the user call still returns; ARK records nothing), never fail closed. Wrap uses `AsyncLocalStorage` (Node 18+); it is a Node ingest helper, not a browser SDK. Snippets on `/start` must not interpolate env tokens. No new third-party npm dependency.

- **Rollback:** revert the branch. Explicit `trace.event()` remains the supported path.
