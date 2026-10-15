# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Everyday people using AI for homework, home life, a shop or studio, a side hustle, or a small team. Not a corporate buyer. No résumé and no account.

*(Inferred from `docs/prd/aifit-consumer.md` and shipped landing copy. Not separately re-interviewed.)*

## Product Purpose

Turn “which AI should I use?” into a named interaction profile, matched tools, and paste-ready setup files for ChatGPT, Claude, Gemini, Cursor, and agents — in about five minutes.

Success is: landing, assessment, and results work at http://localhost:3000 without sign-up; the person leaves with files they can paste.

## Positioning

AI Fit is a personal fit quiz. It is a separate product from AI Fit Teams (workload assessment) and ARK Control (production measurement). It does not share a homepage, login, or funnel with either. A neighbour can use the same app and still need different settings; the quiz watches how the person asks, checks, and decides.

It is not a clinical assessment, personality diagnosis, intelligence test, or hiring screen.

## Operating Context

- Local: `npm run dev:my-ai-api` (Python FastAPI on :8472) + `npm run dev:consumer` (Next.js on :3000).
- Public metadata base: `https://aifit-engine.vercel.app` (`NEXT_PUBLIC_SITE_URL` overrides).
- Quiz progress and reading-level / theme preferences live in the browser. Scoring is the Python engine under `my-ai/`, proxied at `/v1`.
- Simple / Detailed reading level and light / dark theme are first-class chrome.
- Routes: `/`, `/assessment`, `/results/[sessionId]`, `/share/[shareId]`, `/methodology`, `/privacy`, `/registry`.

## Capabilities and Constraints

**Does:**

- Adaptive scene-based quiz (about twelve questions, usually four scenes, about five minutes).
- AI style profile with reasons, not a personality type.
- Product and model recommendations from a dated registry.
- Setup-file exports (ChatGPT, CLAUDE.md, Gemini, Cursor rules, AGENTS.md).
- Anonymous mode: no name, employer, or demographic attributes; no inference of protected characteristics.
- Export and delete from results for the session ID.

**Does not:**

- Import `@ark/core` or `@ark/db`. Does not use `@ark/ui`.
- Run the Teams workload verdict ladder (`not-ai`, cost-per-outcome, architecture for a team workload) as its job.
- Capture email, require an account, or persist intake on a shared Control database.
- Cross-link to AI Fit Teams or ARK Control as a next step.

**Open:** a required accessibility standard was not set in init. Skip-to-content and `lang="en"` already exist in the layout.

## Brand Commitments

Public name **AI Fit** (shipped chrome, README, and founder brief for this init). Wordmark and document title currently say “AI Fit”. CTA copy includes “Find AI Fit”.

Voice: plain, specific, everyday — not a corporate form. Limitations that matter (not a clinical or hiring tool; answers stay in the browser) are stated on Privacy and Methodology, not only in repo docs.

Spec `specs/my-ai-names.md` approved a rename to “MY AI”; that rename is **not** the binding public name in this record. Treat it as unpaid copy debt unless the owner reopens it.

## Evidence on Hand

- Shipped app under `apps/consumer` and scoring engine under `my-ai/`.
- Privacy and methodology pages in-product.
- Registry seed and eval cases under `my-ai/`.
- Factory evidence under `evidence/consumer-fit-look/` and related consumer specs.

**Do not fabricate:** testimonials, conversion rates, clinical claims, or a live customer list.

## Product Principles

1. No account, no résumé — the quiz must work for someone who will not fill a corporate form.
2. Explain what was observed and inferred; do not score protected characteristics.
3. Stay a separate product: never become a softened on-ramp to a Teams workload verdict.
4. Missing identity stays missing: anonymous by default; deletion is a real control.
