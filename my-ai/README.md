# AI Fit

AI Fit is a 5-minute adaptive quiz that answers:

**How do you like to use AI — and which setup actually fits you?**

It is for everyday people: homework, home life, a shop or studio, a side hustle, or a small team. Not a corporate form.

You leave with:

1. **Your AI style** — a named interaction profile, not a personality type.
2. **Why** — the choices that produced that profile.
3. **How you like to use AI** — checking facts, tweaking, going deeper, handing work off, wanting sources, comparing options.
4. **Tools that fit you** — what each product should handle.
5. **What to use each model for**.
6. **How your AI should talk to you**.
7. **Setup files** — ChatGPT, Claude / CLAUDE.md, Gemini, Cursor rules, AGENTS.md.

This is a **free individual quiz**. It is not a $10/month “which AI should I use?” subscription.

This tree lives in the [ARK](https://github.com/aking-beep/ark) monorepo (`my-ai/` + `apps/consumer`). Upstream history: [github.com/aking-beep/aifit-engine](https://github.com/aking-beep/aifit-engine).

The public name is AI Fit. The upstream repo stays `aifit-engine` so it is not confused with the unrelated business-matching site at aifitengine.com. Point a custom domain at the Vercel project and set `NEXT_PUBLIC_SITE_URL` to that origin for share cards.

## What it measures

AI Fit scores **what you ask, how you steer, and how much evidence you demand**. Two people with the same job, budget, and skill level can need different AI setups.

The quiz usually stops after four scenes (about twelve interactions). It continues only when a core habit still is not clear, and never past eight.

An LLM may label optional free text. It never picks the winner. Ranking is dated registries + weights.

## Limitations

- The catalog in `data/registry/` was last reviewed on 2026-09-16 (newest `last_evaluated_at`; also `GET /v1/registry/freshness` → `last_reviewed`). Re-run `docs/REGISTRY_SEED_REVIEW.md` when a vendor changes.
- Your quiz and results stay in the browser (`localStorage`). Server storage is filesystem locally, or Upstash / Vercel KV when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) are set. Share links also embed a compressed copy of the result.
- There are no accounts.
- Keyword classification is first-class. The optional LLM classifier is off unless `MYAI_LLM_CLASSIFIER=1` and an endpoint is set.
- AI Fit scores are normalized similarity, not scientifically validated probabilities.
- Not a personality test, clinical instrument, or hiring screen.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
myai score examples/sample_session.json
myai freshness
PYTHONPATH=packages/core/src python3 -m evals.harness validate-seed
PYTHONPATH=packages/core/src python3 -m evals.harness run-cases
PYTHONPATH=packages/core/src uvicorn services.api.main:app --host 127.0.0.1 --port 8472
```

In another terminal, from the monorepo root (the consumer UI is `apps/consumer`):

```bash
npm ci
npm run dev:consumer
# or a production-style preview:
npm run build --workspace @ark/consumer && (cd apps/consumer && npx next start --port 43123)
```

Open `http://127.0.0.1:3000` (dev) or `http://127.0.0.1:43123` (preview). The consumer app
proxies `/v1/*` and `/health` to this API (`API_ORIGIN`, default `http://127.0.0.1:8472`).

Frontend happy path (builds first; Playwright starts the API and the preview server itself):

```bash
npm run build --workspace @ark/consumer
cd apps/consumer
npx playwright install chromium
npm run test:e2e
```

## Deploy

The monorepo ships one container (see `deploy/` and `docs/05-hosting.md` at the repo root): the
consumer app on :3000 proxies to this API on :8472.

Storage: sessions, scores, and share snapshots go to Upstash Redis / Vercel KV when
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, otherwise to files under
`MYAI_STORE` (default `/tmp/myai-store`). Every record expires after 30 days, and deleting a
session also deletes its share snapshots. See `docs/API_SPEC.md`. Without durable storage,
share links still work via a compressed snapshot in the URL hash (`/share/local#...`).

## Architecture

```text
Short everyday scenes
        │
        ▼
How you actually use AI
        │
        ▼
Your AI style
        │
        ▼
What you need from tools
        │
        ├───────────────┐
        ▼               ▼
Product list        Model list
        │               │
        └───────┬───────┘
                ▼
         Tools that fit
                │
                ▼
      How AI should talk + setup files
                │
                ▼
     A setup you can paste today
```

The registry, methodology, and evidence live under **How it works**. They are credibility infrastructure, not the homepage.

## Pack docs

1. `docs/PRODUCT_SPEC.md`
2. `docs/ASSESSMENT_DESIGN.md`
3. `docs/SCORING_SPEC.md`
4. `docs/REGISTRY_SPEC.md`
5. `docs/PERSONA_SPEC.md`
6. `docs/ETHICS_PRIVACY.md`
7. `docs/ROADMAP_4_WEEKS.md`
8. `docs/DEFINITION_OF_DONE.md`
