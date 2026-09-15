# MY AI (consumer)

Consumer **MY AI** is the project formerly at [github.com/aking-beep/aifit-engine](https://github.com/aking-beep/aifit-engine), now living in this monorepo.

| Path | Role |
|---|---|
| `apps/consumer/` | Next.js UI (port **3000**) |
| `my-ai/` | Python engine, FastAPI (`/v1`), registry data, evals, tests |

MY AI for teams and ARK Control still use the TypeScript `@ark/core` engine. Consumer does not.

## Run locally

```bash
npm install
pip install -e 'my-ai/[dev]'    # or: npm run setup:my-ai

# terminal 1
npm run dev:my-ai-api         # http://127.0.0.1:8472/health

# terminal 2
npm run dev:consumer          # http://localhost:3000
```

Or both with the rest of ARK:

```bash
npm run setup && npm run dev  # my-ai-api + consumer + business + control
```

Next.js proxies `/health` and `/v1/*` to the scoring API (`API_ORIGIN`, default `http://127.0.0.1:8472` off Vercel) through `apps/consumer/src/lib/my-ai-proxy.ts`. Docker compose publishes 8472 and starts uvicorn next to the three Next apps — see [Hosting](05-hosting.md). MY AI does not link to MY AI for teams; they are separate products.

## Tests

```bash
npm run test:my-ai            # pytest in my-ai/
cd apps/consumer && npm run test:e2e   # Playwright (requires my-ai-api running)
```

## Deploy on Vercel

Use `vercel.consumer.json` at the repo root as the project config: Next.js in `apps/consumer`, FastAPI in `my-ai/` on the same domain. Set `NEXT_PUBLIC_SITE_URL` to your origin for share cards. Add Upstash or Vercel KV for durable share IDs across instances.

See also `my-ai/README.md` and `my-ai/ARCHITECTURE.md` from the upstream project.
