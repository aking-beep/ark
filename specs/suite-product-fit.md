# suite-product-fit

**Status:** APPROVED
**Approved by:** repository owner (close the three-product QA/PMF findings; 2026-09-16)
**Date:** 2026-09-16

## Problem

A live QA of MY AI, MY AI for teams, and ARK Control scored the suite ~2.5/5 because the products do not compose, even though each surface mostly works in isolation.

- **MY AI for teams** pre-fills Today as 8 minutes and $65/h while the copy, the thesis, and the PRD say leave blanks so payback can be **unknowable**. A guess entered as a default is how a fabricated ROI reaches a board deck.
- **ARK Runtime** is a library with zero first-party callers. Control measures ingest; no product app imports `@ark/runtime` to emit a real trace. Empty orgs (Northwind) tell the operator to read `npm run setup` / `.env.example`.
- **MY AI** results lists use `key={item}`, so duplicate evidence strings collide. The registry is 16 products and 4 models and is missing 2026-scale assistants (DeepSeek, Grok, Microsoft Copilot, Meta AI) and the open-weight families the rest of this repo already routes (Qwen, DeepSeek-R1, Llama, Gemma, gpt-oss).

The consumer PRD and `specs/three-product-runtime.md` **forbid** a MY AI → teams funnel. This feature does not add one. The documented loop is teams ↔ Control. MY AI stays a personal fit quiz with a current catalog.

Research used (2026-09-16): Sensor Tower State of AI 2026 via TechCrunch (ChatGPT 46.4% / Gemini 27.7% / Claude 10.3%; Grok, Perplexity, DeepSeek, Meta AI, Copilot each under 5% user share); Similarweb May 2026 chatbot web-visit share (DeepSeek 4.1%, Grok 2.4%, Copilot 1.3%); Hugging Face most-downloaded text models (Qwen family dominant, Gemma 4, Llama, DeepSeek-R1 / V3, gpt-oss); Microsoft first-party Copilot family MAU claims. Registry rows cite dated official product pages, not those market-share articles as capability evidence.

## Outcome

A team can leave Today blank and get unknowable payback; can POST one synthetic Runtime sample from MY AI for teams into Control without sitting in the request path; can see on an empty Control org how to do that without opening `.env.example`; and a MY AI result recommends 2026-current tools without duplicate React keys.

## Acceptance criteria

1. **Honest Today.** Intake `minutesPerUnit` and `hourlyUsd` default to blank (not 8 / 65). A report whose encoded workload omits both still renders payback as **unknowable**. Human error rate stays blank. Copy that says “leave blank” remains true of the defaults.
2. **First-party Runtime caller.** `apps/business` depends on `@ark/runtime`. `POST /api/measure` accepts a `Workload`, refuses `not-ai` with 422 and does not call a provider, otherwise runs one bounded completion through `execute` (synthetic prompt: workload id + task shapes only — never `description`) and returns ingest outcome. `GET /api/measure` documents the contract. There is no `apps/runtime`. Consumer still does not import `@ark/core` or `@ark/db`.
3. **Control first-run.** An org with zero traces sees copy that names `POST /api/measure` on MY AI for teams, `ARK_CONTROL_URL`, and `ARK_CONTROL_TOKEN` — not only `npm run setup`. Login copy for the empty org names the same measure path. Tokens are not printed in HTML.
4. **Teams door to measurement.** The uncalibrated report banner names `ARK_CONTROL_URL` / `ARK_CONTROL_TOKEN` and that a measured sample is `POST /api/measure`. A report for a non-`not-ai` workload offers a control to send that sample. Failures surface as a message (no provider / timeout / not-ai), not a hang or stack trace. Timeout ≤ 15s.
5. **MY AI catalog of today’s tools.** `my-ai/data/registry/products.json` adds researched 2026-current products at least: DeepSeek, Grok, Microsoft Copilot, Meta AI, GitHub Copilot, LM Studio, Mistral Le Chat — each with dated official evidence. `models.json` adds family rows for Qwen, DeepSeek-R1, Llama, Gemma, and gpt-oss (open-weight), with dated evidence. `npm run test:my-ai` still passes. Registry version on new rows is `0.4`.
6. **Unique result keys.** MY AI results lists that currently use `key={item}` use a key unique in the parent (index or id+index). Duplicate evidence strings no longer produce duplicate React keys.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`).

- **Artefact:** terminal output from `node evidence/suite-product-fit/probe.mjs` (before and after, same command) plus HTML dumps of Control empty state and teams Today defaults where a server is up.
- **Measured by:**
  - Before: `GET :3001/api/measure` is 404 (or no such route in the tree); `apps/*` has no `@ark/runtime` import; intake defaults `8` and `65`; products.json length 16 / models.json length 4; `key={item}` count in `results-view.tsx` is 3; Control empty copy mentions `npm run setup` and does not mention `/api/measure`.
  - After: measure GET documents POST; intake defaults blank; a `not-ai` fixture POSTed to measure (with fake adapter) is 422 and the adapter was not called; a support-triage fixture with a fake adapter returns ingest `ok`; Control empty HTML contains `/api/measure` and `ARK_CONTROL_TOKEN` and does not contain a bearer secret; products ≥ 23 and models ≥ 9; `key={item}` count is 0; `npm test` and `npm run test:my-ai` pass.
- **Conditions:** compiled packages; fake adapters for measure (live Ollama optional, recorded if present, not faked). Viewport 1440×900 if screenshots are taken.

## Out of scope

- A MY AI ↔ teams funnel, `NEXT_PUBLIC_ARK_BUSINESS_URL`, or “For teams” on the consumer chrome (`specs/three-product-runtime.md`, consumer PRD).
- Unifying MY AI onto `@ark/core`. Consumer scoring stays Python under `my-ai/`.
- Email capture, accounts, or persistence of intake (ADR-0003).
- `apps/runtime`, OpenAI defaults, `OPENAI_API_KEY`, sitting in the request path, auto-pull of Hub weights in CI.
- Flipping calibration to `measured` from one sample (30-trace floor stays). One first-party event is the composition proof.
- Rewriting thesis ADR-0002 (historical six-question consumer). The consumer PRD already supersedes it.

## Risk

`POST /api/measure` runs a model when adapters are configured. Mitigations: synthetic prompt only (no `description`), `maxTokens` 64, `maxCostUsd` 0.05, 15s timeout, `not-ai` refusal, ingest already omits prompt samples. Org tokens stay hashed; UI names env vars, it does not echo secrets. No new third-party npm dependency. `@ark/runtime` is an existing workspace package.

- **Rollback:** revert the branch. Measure is additive. Today blanks restore the documented honesty default. Registry rows are additive.
