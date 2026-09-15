# AIFit consumer (Fit)

Consumer AIFit is **Fit** — the project formerly at [github.com/aking-beep/aifit-engine](https://github.com/aking-beep/aifit-engine), now living in this monorepo.

| Path | Role |
|---|---|
| `apps/consumer/` | Next.js UI (port **3000**) |
| `fit/` | Python engine, FastAPI (`/v1`), registry data, evals, tests |

Business AIFit and ARK Control still use the TypeScript `@ark/core` engine. Consumer does not.

## Run locally

```bash
npm install
pip install -e 'fit/[dev]'    # or: npm run setup:fit

# terminal 1
npm run dev:fit-api           # http://127.0.0.1:8472/health

# terminal 2
npm run dev:consumer          # http://localhost:3000
```

Or both with the rest of ARK:

```bash
npm run setup && npm run dev  # fit-api + consumer + business + control
```

Next.js proxies `/health` and `/v1/*` to the Fit API (`API_ORIGIN`, default `http://127.0.0.1:8472` off Vercel) through `apps/consumer/src/lib/fit-proxy.ts`. Docker compose publishes 8472 and starts uvicorn next to the three Next apps — see [Hosting](05-hosting.md). Fit does not link to AIFit for teams; they are separate products.

## Tests

```bash
npm run test:fit              # pytest in fit/
cd apps/consumer && npm run test:e2e   # Playwright (requires fit-api running)
```

## Deploy on Vercel

Use `vercel.consumer.json` at the repo root as the project config: Next.js in `apps/consumer`, FastAPI in `fit/` on the same domain. Set `NEXT_PUBLIC_SITE_URL` to your origin for share cards. Add Upstash or Vercel KV for durable share IDs across instances.

See also `fit/README.md` and `fit/ARCHITECTURE.md` from the upstream project.
