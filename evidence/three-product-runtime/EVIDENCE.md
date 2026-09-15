# Evidence — three-product-runtime

## What changed

An operator can run Fit, AIFit for teams, and Control from one compose file (Python Fit API on 8472 plus three Next apps). Fit and AIFit for teams stay **separate products**: neither landing funnels into the other. Business still links to ARK Control (estimator↔measurement). The Fit UI reaches its engine through Next (`/v1`, `/health`).

## How it was measured

Same four local processes the entrypoint would start: consumer `:3000`, business `:3001`, Control `:3002`, Fit API `:8472`. Commands in `before.txt` / `after.txt`:

- `curl` `GET :3000/` and `GET :3001/` (body greps + HTML dumps)
- `curl` `GET :8472/health`, `GET :3000/health`, `GET :3000/v1/scenarios`
- file greps of `deploy/Dockerfile`, `entrypoint.sh`, `docker-compose.yml`
- screenshots at **1440×900**

Stamps: `captures.tsv`. Before commit `6b7e3ad`. After unlink commit `84c2a17`.

No Docker daemon in this station.

## Before / after

| | Before (main) | After (this branch) |
|---|---|---|
| Artefact | `before.txt`, `before-consumer.html/.png`, `before-business.html/.png` | `after.txt`, `after-consumer.html/.png`, `after-business.html/.png` |
| Fit `/` nav | No “For teams” | Still no “For teams”; no `localhost:3001` |
| Business `/` | “six questions” + link to consumer | No “six questions”, no “Not at work?”, no “Open Fit”; Control link remains |
| Dockerfile | Node-only, EXPOSE 3000–3002 | Python 3.12, `pip install -e ./fit`, EXPOSE 8472, no business URL ARG |
| Entrypoint | three Next apps | `fit-api` + `uvicorn` + three Next apps |
| Compose | no 8472 | `8472:8472`, `API_ORIGIN`; no `ARK_CONSUMER_URL` / `NEXT_PUBLIC_ARK_BUSINESS_URL` |
| `GET :3000/v1/scenarios` | 404 HTML | 200 JSON, 8 scenarios |
| `GET :3000/health` | 404 HTML | 200 Fit JSON |

Owner correction after Round 2: Fit↔teams chrome links were removed. They contradicted `docs/prd/aifit-consumer.md` (“This is not a funnel…”).

## What this does not prove

The Docker image was not built here (no daemon). Layouts were not redesigned in this station — Fit stays cream/Geist, teams stays the dark instrument panel; this change only removes the funnel links. Thesis/ADRs that still mention a six-question consumer are historical and unchanged.

## Deviations

Spec ACs 3–5 were rewritten after owner review: products must **not** point at each other. Docker + Fit proxy unchanged. No new runtime npm dependency.

Round 1: Node tarball `curl --max-time 120`. Round 2 scored 5/5 on the (now withdrawn) cross-link ACs. This evidence is for the corrected spec.

## Definition of done

- **Cost / latency impact:** N/A for model cost. Proxy hop has a 20s ceiling.
- **Observability for new failure modes:** Proxy returns JSON 502/504. Concurrently names `fit-api`.
- **Docs or ADR updated:** `docs/05-hosting.md`, `docs/06-aifit-consumer.md`, `.env.example`. Hosting now states the products do not cross-link. No new ADR.
