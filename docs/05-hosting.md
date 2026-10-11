# Hosting

Local zero-config is unchanged: `npm run setup && npm run dev`. This file is the path off a laptop.

## Docker (MY AI API + all three surfaces)

From the repo root, set the five required values and start the stack:

```bash
export ARK_SESSION_SECRET=$(openssl rand -hex 32)       # >= 32 chars
export ARK_DEMO_PASSWORD='…'                            # Demo Co login
export ARK_NORTHWIND_PASSWORD='…'                       # Northwind login
export ARK_INGEST_TOKEN_DEMO=$(openssl rand -hex 24)    # Demo Co ingest bearer
export ARK_INGEST_TOKEN_NORTHWIND=$(openssl rand -hex 24)
docker compose -f deploy/docker-compose.yml up --build -d
```

Compose refuses to start if any of the five is unset (`${VAR:?…}`), and the container refuses the public demo defaults in production: Control rejects an empty, placeholder (`change-me-in-production`, `dev-insecure-session-secret`) or shorter-than-32-character session secret, and the seed rejects the demo passwords and the `ark_dev_ingest_*` tokens. There is no insecure fallback to forget to change.

The image is Python 3.12 plus Node 22, built for the target architecture (amd64 or arm64). It runs as an unprivileged `ark` user that owns `/app` and `/data`. `entrypoint.sh` bootstraps the database, then starts four processes: MY AI API, consumer, business, Control. If any of them exits, the others are stopped and the container exits, so `restart: unless-stopped` brings the whole stack back rather than leaving a half-dead one serving. The container healthcheck (`deploy/healthcheck.sh`) requires all four to answer.

Then:

| Surface | URL |
|---|---|
| MY AI (consumer) | http://localhost:3000 |
| Scoring API (Python) | http://localhost:8472/health |
| MY AI for teams | http://localhost:3001 |
| ARK Control | http://localhost:3002 |

Consumer Next proxies `/health` and `/v1/*` to the MY AI API at `API_ORIGIN` (default `http://127.0.0.1:8472` inside the container). From a browser, use the consumer origin for the quiz; 8472 is for operators and compose publishes it on `127.0.0.1` only.

MY AI and MY AI for teams are **separate products**. They do not link to each other. The only product-to-product wire in this stack is business → Control (`ARK_CONTROL_URL`), which is the estimator↔measurement loop.

### Environment

| Variable | Default | Notes |
|---|---|---|
| `ARK_SESSION_SECRET` | **required** | ≥ 32 chars, not a placeholder. Signs Control sessions. |
| `ARK_DEMO_PASSWORD` / `ARK_NORTHWIND_PASSWORD` | **required** | Seeded login passwords. Read only when the database is first seeded. |
| `ARK_INGEST_TOKEN_DEMO` / `ARK_INGEST_TOKEN_NORTHWIND` | **required** | Seeded ingest bearers (stored hashed). Read only at first seed. |
| `ARK_CONTROL_TOKEN` | `$ARK_INGEST_TOKEN_DEMO` | Bearer business uses to read calibration from Control. |
| `ARK_DATABASE_URL` | `file:/data/ark.db` | The compose volume. Point at libSQL/Turso to share one DB (below). |
| `ARK_DATABASE_AUTH_TOKEN` | empty | libSQL/Turso auth token. |
| `ARK_SHOW_DEMO_LOGIN` | off | `1` shows the demo credentials on Control's login page in production — for a deliberate public demo only. |
| `ARK_MEASURE_ENABLED` | off | `1` enables MY AI for teams `POST /api/measure` (real model call + ingest). Rate-limited per IP; writes only `teams_sample_*` workloads. |
| `ARK_ALLOW_SEED` | off | `1` lets the seed run in production. The entrypoint sets it for its own `db:bootstrap` call only; run by hand, bootstrap leaves an empty production database unseeded unless it is set. |
| `ARK_ALLOWED_ORIGINS` | empty | Extra origins Control's login/logout accept, comma-separated. Needed only behind a proxy that rewrites `Host` without setting `X-Forwarded-Host`. |
| `ARK_DISCOVER_ALLOW_PRIVATE` | off | `1` lets `/discover` scan private repositories with the shared `ARK_GITHUB_TOKEN`. Off, only repositories GitHub reports as public are scanned. |
| `MYAI_STORE` | `/tmp/myai-store` | Filesystem store for AI Fit sessions, scores and shares (30-day TTL) when Redis is not configured. |
| `MYAI_SHARE_RATE_PER_MIN` / `MYAI_SCORE_RATE_PER_MIN` | `20` / `60` | Per-client rate limits on the AI Fit API's `/v1/share` and `/v1/score`. |
| `MYAI_SHARE_GLOBAL_RATE_PER_MIN` / `MYAI_SCORE_GLOBAL_RATE_PER_MIN` | `300` / `1200` | Ceilings across all clients on the same endpoints. |
| `ARK_TRUSTED_PROXY_HOPS` | `1` | How many proxies you run in front of the Next apps. Rate limits key on the X-Forwarded-For entry this many places from the right, the one a client cannot write. Every per-client limit also has a global ceiling, so a client that spoofs the header on a direct connection still cannot exceed it. |
| `ARK_WEBHOOK_URL` / `ARK_SLACK_WEBHOOK_URL` | empty | Alert destinations attached to Northwind at first seed. |
| `API_ORIGIN` | `http://127.0.0.1:8472` | Consumer → MY AI API. |
| `MYAI_ROOT` | `/app/my-ai` | Python engine repo root inside Docker. |
| `ARK_CONTROL_URL` | `http://127.0.0.1:3002` | Business → Control. |

Control sessions last 12 hours and are re-checked against the membership table on every request. Ingest responses report `duplicates` for rows already stored (a retried batch is a no-op). A custom `ARK_FRONTIER_BASE_URL` requires `ARK_FRONTIER_API_KEY`; `DEEPSEEK_API_KEY` and `HF_TOKEN` are only ever sent to their own hosts.

Provider credentials (`ARK_OLLAMA_*`, `ARK_BEDROCK_*`, `ARK_FRONTIER_*`, …) and `ARK_GITHUB_TOKEN` are documented in [`.env.example`](../.env.example); add them to the compose `environment:` block if you use them.

### Database bootstrap

On every boot the entrypoint runs `npm run db:bootstrap`: push the schema (idempotent) and seed **only if the `orgs` table is empty**. It does not look for a local file, so it behaves the same against the volume and against a remote libSQL URL. The seed values above are therefore read exactly once, at first boot; changing them later does not rotate existing logins or tokens.

Northwind has **no events** until you exec:

```bash
docker compose -f deploy/docker-compose.yml exec ark npm run ingest:live
```

`npm run db:seed` re-seeds unconditionally and replaces demo data. In production it refuses to run unless `ARK_ALLOW_SEED=1`; do not point it at a database you care about.

### Control login

Org logins are the emails in `.env.example` (`ARK_DEMO_EMAIL`, `ARK_NORTHWIND_EMAIL`) with the passwords you set. The login page does not display credentials in production unless `ARK_SHOW_DEMO_LOGIN=1`. Ingest clients send `Authorization: Bearer <ARK_INGEST_TOKEN_…>`; the token determines the org, so an ingest body does not need an `orgId` (one that disagrees with the token is rejected).

## Durable database

Point `ARK_DATABASE_URL` at Turso/libSQL (and `ARK_DATABASE_AUTH_TOKEN`) when more than one process writes. See [ADR-0004](adr/0004-sqlite-first.md). The schema does not change.

Several containers can share one libSQL URL. Because bootstrap seeds only an empty database, a replica that boots against an already-seeded database pushes the (unchanged) schema and starts; it does not re-seed or wipe data. Two replicas booting for the very first time at the same instant can still race the initial seed — start one, then scale.

## What this is not

A managed AWS/Vercel/Railway account. The compose file is the portable unit. Put a reverse proxy with TLS in front of the four ports — Control's session cookie is `Secure` in production, so it needs HTTPS to log in from anything but localhost. Consumer MY AI on Vercel uses `vercel.consumer.json` (web + API services) instead of this image.
