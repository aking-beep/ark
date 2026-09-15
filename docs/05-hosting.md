# Hosting

Local zero-config is unchanged: `npm run setup && npm run dev`. This file is the path off a laptop.

## Docker (Fit API + all three surfaces)

From the repo root:

```bash
export ARK_SESSION_SECRET=$(openssl rand -hex 32)
docker compose -f deploy/docker-compose.yml up --build
```

The image is Python 3.12 plus Node 22. First boot installs nothing extra; `entrypoint.sh` starts four processes: Fit API, consumer, business, Control.

Then:

| Surface | URL |
|---|---|
| Fit (consumer) | http://localhost:3000 |
| Fit API (Python) | http://localhost:8472/health |
| AIFit business | http://localhost:3001 |
| ARK Control | http://localhost:3002 |

Consumer Next proxies `/health` and `/v1/*` to the Fit API at `API_ORIGIN` (default `http://127.0.0.1:8472` inside the container). From a browser, use the consumer origin for the quiz; 8472 is for operators.

Fit and AIFit for teams are **separate products**. They do not link to each other. The only product-to-product wire in this stack is business → Control (`ARK_CONTROL_URL`), which is the estimator↔measurement loop.

| Variable | Default | Who reads it |
|---|---|---|
| `API_ORIGIN` | `http://127.0.0.1:8472` | Consumer → Fit API |
| `ARK_CONTROL_URL` | `http://127.0.0.1:3002` | Business → Control |

Control requires a session. Demo logins (override with env before first seed):

| Org | Email | Password |
|---|---|---|
| Demo Co (`org_demo`) | dana@riverbend.example | riverbend-demo |
| Northwind (`org_northwind`) | sam@northwind.example | northwind-demo |

Ingest tokens (hashed at rest; sent as `Authorization: Bearer …`):

| Org | Default token |
|---|---|
| Demo Co | `ark_dev_ingest_org_demo` |
| Northwind | `ark_dev_ingest_org_northwind` |

Change them via `ARK_INGEST_TOKEN_DEMO` / `ARK_INGEST_TOKEN_NORTHWIND` **before** `npm run db:seed`. Production must set `ARK_SESSION_SECRET`.

The compose volume keeps `/data/ark.db`. First boot runs schema + seed. Northwind has **no events** until you exec:

```bash
docker compose -f deploy/docker-compose.yml exec ark npm run ingest:live
```

Set `ARK_WEBHOOK_URL` or `ARK_SLACK_WEBHOOK_URL` on first boot to attach destinations to Northwind (seed reads them once).

## Durable database

Point `ARK_DATABASE_URL` at Turso/libSQL (and `ARK_DATABASE_AUTH_TOKEN`) when more than one process writes. See [ADR-0004](adr/0004-sqlite-first.md). The schema does not change.

## What this is not

A managed AWS/Vercel/Railway account. The compose file is the portable unit. Wire a reverse proxy and TLS in front of the four ports, or run process replicas sharing one libSQL URL. Consumer Fit on Vercel uses `vercel.consumer.json` (web + API services) instead of this image.
