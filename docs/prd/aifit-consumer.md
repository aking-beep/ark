# PRD: AIFit (consumer) — Fit

**Surface:** `apps/consumer` + `fit/` · port 3000 (web) · port 8472 (Fit API, dev)
**One line:** Five minutes. Find the AI setup that fits how you ask, check, and decide.

## Source

The consumer surface is [Fit](https://github.com/aking-beep/aifit-engine), merged into this repo as `apps/consumer` (Next.js) and `fit/` (Python scoring engine + FastAPI). The public product at https://aifit-engine.vercel.app/ is this codebase.

It is **not** the six-question ARK workload rubric. That engine lives in `@ark/core` and powers **AIFit for teams** and **ARK Control**.

## Who

Everyday people using AI for homework, home life, a shop or studio, a side hustle, or a small team. Not a corporate buyer. No résumé, no account.

## The job it does

Turn “which AI should I use?” into a named interaction profile, matched tools, and paste-ready setup files for ChatGPT, Claude, Gemini, Cursor, and agents — in about five minutes.

## Scope

**In:**

- Adaptive scene-based quiz (~12 questions, usually four scenes).
- AI style profile with reasons, not a personality type.
- Product and model recommendations from a dated registry.
- Setup file exports (ChatGPT, CLAUDE.md, Gemini, Cursor rules, AGENTS.md).
- Simple / Detailed reading level and light / dark theme.
- Share links and browser-local session storage.
- FastAPI backend at `/v1` (proxied by Next.js in dev and on Vercel).

**Out:**

- ARK workload verdict ladder (`not-ai`, cost, architecture for a team workload).
- `@ark/db` or Control telemetry on this surface.
- Accounts, email capture, subscriptions.
- The unrelated business-matching site at aifitengine.com.

## Boundaries

`apps/consumer` does **not** depend on `@ark/db` or `@ark/core`. Scoring is Python under `fit/packages/core/src/aifit`. The only shared repo concern with Control is cohabitation in the monorepo — there is no runtime coupling.

## Success criteria

- `npm run dev:fit-api` + `npm run dev:consumer` → landing, assessment, and results work at http://localhost:3000.
- `npm run test:fit` and consumer `npm run build` pass in CI.
- Deploy matches the Vercel Services layout in `vercel.consumer.json` (web + API on one domain).

## Explicit non-goal

This is not a funnel that softens team workload assessments. Consumer Fit and business AIFit are different products in one repo, aimed at different jobs.
