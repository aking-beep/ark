# three-product-runtime

**Status:** APPROVED
**Approved by:** repository owner (continue building the three-product system; 2026-09-15 correction: Fit and AIFit for teams do not cross-link)
**Date:** 2026-09-15

## Problem

Fit (consumer), AIFit for teams (business), and ARK Control are three products in one repo. After the Fit merge they still do not run as one hosted stack: the Docker image is Node-only, so `docker compose up` never starts the Python Fit API Fit’s UI needs. They are **separate products** with different jobs and layouts — Fit is a personal quiz; AIFit for teams is a workload verdict. They must not funnel into each other. (Consumer PRD: “This is not a funnel that softens team workload assessments.”)

## Outcome

An operator can run all three products plus the Fit API from the compose file. Fit and AIFit for teams stay separate surfaces: no “For teams” on Fit, no “Open Fit” / “Not at work?” on the business landing. Business still points at **ARK Control**, which is the estimator↔measurement loop, not a consumer funnel.

## Acceptance criteria

1. `deploy/Dockerfile` installs Python 3.12+ and the Fit package (`pip install -e ./fit`), copies `fit/`, sets `API_ORIGIN=http://127.0.0.1:8472`, and exposes **8472** as well as 3000/3001/3002.
2. `deploy/entrypoint.sh` starts four processes: Fit API (`uvicorn` on 8472), consumer, business, and Control. `deploy/docker-compose.yml` publishes 8472 and sets `API_ORIGIN`. It does **not** set `NEXT_PUBLIC_ARK_BUSINESS_URL` or `ARK_CONSUMER_URL`.
3. Fit chrome (header, mobile menu, footer) and the landing page have **no** link to AIFit for teams. No `ark-links` / `NEXT_PUBLIC_ARK_BUSINESS_URL`. The consumer app still does not depend on `@ark/db` or `@ark/core`.
4. The business landing has **no** “Not at work?” / “Open Fit” / consumer URL. It must not say the consumer version asks six questions. The Control link in the business chrome stays (teams ↔ Control).
5. `docs/05-hosting.md` and `.env.example` document Fit API (`8472`) and `API_ORIGIN`. They do not document Fit↔business cross-links.

## How this will be proved

Cloud station is this container (`factory/05-CLOUD.md`). Local processes: consumer `:3000`, business `:3001`, Control `:3002`, Fit API `:8472`. No Docker daemon in this station — image contents are proved by file inspection plus the same four processes `entrypoint.sh` would start.

- **Artefact:** terminal output (HTTP status, body snippets, file greps) plus HTML dumps and screenshots of `/` on consumer and business, same 1440×900 viewport.
- **Measured by:**
  - Before (main at start of station): HEAD Dockerfile has no Python/`fit`/8472; entrypoint starts three Next apps only; compose has no 8472; `GET :3000/` has no “For teams”; `GET :3001/` contains “six questions” and a consumer link.
  - After: Dockerfile installs Python 3.12+ and `fit`; entrypoint names `fit-api` and `uvicorn`; compose publishes 8472; `GET :3000/` has no “For teams”; `GET :3001/` has no “six questions”, no “Open Fit”, no “Not at work?”; `GET :8472/health` is 200; `GET :3000/v1/scenarios` returns JSON.
- **Conditions:** `npm run dev` stack (or the four equivalent processes), seeded SQLite, 1440×900 screenshots.

## Out of scope

- Building the image in this station (no Docker daemon). The files are the portable unit; a daemon-equipped host runs `docker compose -f deploy/docker-compose.yml up --build`.
- Rewriting the thesis and ADRs that still mention the former six-question consumer (those are historical).
- Vercel production deploy, OAuth, real customer traces.
- Changing Fit scoring, the business rubric, or Control tenancy.
- Unifying layouts. The products keep distinct visual systems (Fit cream/Geist vs teams dark instrument panel).

## Risk

No new runtime npm dependency. Docker image adds Python 3.12 and the existing Fit PyPI deps (`fastapi`, `uvicorn`, …). Fit API binds `0.0.0.0:8472` inside the container so the published port is reachable; the Next rewrite still talks to `127.0.0.1:8472` on the same container network namespace.

- **Rollback:** revert the branch. Compose without Python is restored; Fit continues to run via `npm run dev:fit-api` on a laptop.
