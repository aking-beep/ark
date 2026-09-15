# Evidence — three-product-runtime

## What changed

Fit, AIFit for teams, and Control now run as one stack: Docker starts the Python Fit API next to the three Next apps, Fit’s chrome links to the team product, and the business landing describes Fit instead of a six-question quiz. In this station the Fit UI can also reach the engine: `/v1/scenarios` went from a Next 404 to JSON.

## How it was measured

Same four local processes the entrypoint would start: consumer `:3000`, business `:3001`, Control `:3002`, Fit API `:8472`. Commands in `before.txt` / `after.txt`:

- `curl` `GET :3000/` and `GET :3001/` (body greps + HTML dumps)
- `curl` `GET :8472/health`, `GET :3000/health`, `GET :3000/v1/scenarios`, `POST :3000/v1/sessions/demo`
- `curl` `GET :3002/dashboard` (session redirect)
- file greps of `deploy/Dockerfile`, `entrypoint.sh`, `docker-compose.yml`
- screenshots at **1440×900**: `before-consumer.png` / `after-consumer.png`, `before-business.png` / `after-business.png`

Stamps: `captures.tsv`. Before commit `6b7e3ad` (dirty=2 was spec + evidence dir, not product code). After commit `db12e35`.

No Docker daemon in this station — `docker info` fails. Image contents are the files; the running processes are the same four the entrypoint launches.

## Before / after

| | Before | After |
|---|---|---|
| Artefact | `before.txt`, `before-consumer.html`, `before-business.html`, `before-consumer.png`, `before-business.png` | `after.txt`, `after-consumer.html`, `after-business.html`, `after-consumer.png`, `after-business.png` |
| Fit `/` nav | No “For teams” | “For teams” → `http://localhost:3001` (visible in `after-consumer.png`) |
| Business `/` | “The consumer version asks six questions…” | “Fit is the five-minute personal quiz…” / Open Fit; `six questions` absent |
| Dockerfile | `FROM node:22-bookworm-slim`, no `fit/`, EXPOSE 3000–3002 | `FROM python:3.12-slim-bookworm`, `pip3 install -e ./fit`, EXPOSE 8472 |
| Entrypoint | three Next apps | `fit-api` + `uvicorn` + three Next apps |
| Compose | no 8472 | `8472:8472`, `API_ORIGIN`, `ARK_CONSUMER_URL`, `NEXT_PUBLIC_ARK_BUSINESS_URL` |
| `GET :3000/v1/scenarios` | 404 HTML | 200 JSON, 8 scenarios |
| `GET :3000/health` | 404 HTML | 200 `{"ok":true,"product":"Fit",...}` |
| `GET :8472/health` | 200 (local process already running) | 200 (unchanged; now also in the image) |
| Control `/dashboard` | 307 `/login` | 307 `/login` |

## What this does not prove

The Docker image was not built or run here (no daemon). A host with Docker still has to `docker compose -f deploy/docker-compose.yml up --build` to prove the Python+Node image boots. `NEXT_PUBLIC_ARK_BUSINESS_URL` is baked at Next build time; compose runtime env cannot retarget an already-built Fit bundle. Screenshots are 1440×900, so the business “Not at work?” block is below the fold — that change is in the HTML dump, not the PNG. Thesis and ADRs that still mention six-question consumer are unchanged (out of scope).

## Deviations

None from the spec’s five criteria. The `/v1` App Router proxy (`fit-proxy.ts`) was not named as its own criterion; it is how AC measurement “`GET :3000/v1/scenarios` returns JSON” is met, because Next 16 turbopack was ignoring `next.config` rewrites (before: 404). Timeout 20s; 502/504 on miss. No new runtime npm dependency.

Round 1 review: `curl` of the Node tarball in `deploy/Dockerfile` now uses `--max-time 120 --retry 3` so a hung `nodejs.org` fails the build instead of hanging. Mobile “For teams” also closes the menu (`setOpen(false)`). User-facing HTTP and 1440×900 screenshots are unchanged; see the curl line in `after.txt` (appended).

## Definition of done

- **Cost / latency impact:** N/A for model cost — no new model call. Proxy adds one hop with a 20s ceiling; Fit scoring latency is unchanged.
- **Observability for new failure modes:** Proxy returns JSON `{error}` with 502 (unreachable / unconfigured) or 504 (timeout) instead of a Next 404 page. Docker logs are four named concurrently streams including `fit-api`.
- **Docs or ADR updated:** `docs/05-hosting.md`, `docs/06-aifit-consumer.md`, `.env.example`, README. No new ADR (compose still one service; it now includes Python).
