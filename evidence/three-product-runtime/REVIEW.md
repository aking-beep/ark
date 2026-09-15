## Round 1 — 2026-09-15 — 4/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All five acceptance criteria met: Dockerfile installs Python 3.12, `fit/`, `pip3 install -e ./fit`, `API_ORIGIN`, and EXPOSE 8472; entrypoint starts `fit-api`/`uvicorn` plus the three Next apps; compose publishes 8472 and sets `API_ORIGIN`, `ARK_CONSUMER_URL`, and `NEXT_PUBLIC_ARK_BUSINESS_URL`; Fit header/mobile/footer and landing link to the business URL; business “Not at work?” describes the five-minute Fit quiz and does not say six questions; `docs/05-hosting.md` and `.env.example` document the new vars. The `/v1` App Router proxy is declared in `EVIDENCE.md` as how the spec’s `GET :3000/v1/scenarios` measurement is met. |
| 2 | Evidence proves it | ✅ | Before (`6b7e3ad`) and after (`db12e35`) measured the same way: curl on `:3000/`, `:3001/`, `:8472/health`, `:3000/health`, `:3000/v1/scenarios`; HTML dumps; 1440×900 PNGs. A reader who has not opened the diff can see “For teams” appear on Fit, “six questions” leave the business landing, Docker files gain Python/8472, and `/v1/scenarios` go from 404 HTML to JSON. “What this does not prove” is specific (no daemon, bake-time `NEXT_PUBLIC_*`, business copy below the fold on the PNG). |
| 3 | Structure holds | ✅ | Edge routes (`apps/consumer/src/app/health/route.ts`, `apps/consumer/src/app/v1/[...path]/route.ts`) call `proxyFitRequest`; they do not touch a database. No new runtime npm dependency. Consumer still has no `@ark/db` / `@ark/core`. |
| 4 | Fails safely | ❌ | `deploy/Dockerfile:10` — `curl` of the Node tarball from `nodejs.org` has no `--max-time`. A hung or stalled download hangs `docker compose up --build` with no error. Adding `--max-time` (so the RUN fails instead of hanging) would earn the point. The Fit proxy itself times out at 20s and returns JSON 502/504 (`apps/consumer/src/lib/fit-proxy.ts:49-69`). |
| 5 | Readable | ✅ | Names (`fit-proxy`, `businessUrl`, `ark-links`) match the job. Comments explain why (Turbopack rewrites, `0.0.0.0` bind, Python 3.12 from `fit/pyproject.toml`). Tests cover the proxy and the deploy-file invariants. |

**Blocking:** criterion 4.

**Non-blocking:**
- `evidence/three-product-runtime/after-business.png` does not show the “Not at work?” copy (below the fold at 1440×900); the HTML dump does — already stated in `EVIDENCE.md`.
- `apps/consumer/src/app/v1/[...path]/route.ts:1-15` plus `apps/consumer/src/lib/fit-proxy.ts:20-21` (`VERCEL` → `null` → 502) mean a Vercel platform rewrite for `/v1` never runs; Vercel deploy is out of spec scope.
- `apps/consumer/src/components/site-header.tsx:81` — the mobile “For teams” `<a>` does not call `setOpen(false)` (internal `Link`s do).
- `apps/consumer/src/app/page.tsx:157` landing CTA label is “AIFit for teams”, not “For teams”; chrome carries the spec’s label and `GET :3000/` still contains it.

## Round 2 — 2026-09-15 — 5/5

| # | Criterion | Point | Finding |
|---|---|---|---|
| 1 | Spec satisfied | ✅ | All five acceptance criteria met: `deploy/Dockerfile` is Python 3.12, copies `fit/`, `pip3 install -e ./fit`, `API_ORIGIN`, EXPOSE 8472; entrypoint starts `fit-api`/`uvicorn` plus the three Next apps; compose publishes 8472 and sets `API_ORIGIN`, `ARK_CONSUMER_URL`, `NEXT_PUBLIC_ARK_BUSINESS_URL`; Fit header/mobile/footer and landing link to the business URL; business “Not at work?” describes the five-minute Fit quiz and does not say six questions; `docs/05-hosting.md` and `.env.example` document the new vars. The `/v1` App Router proxy is declared in `EVIDENCE.md` as how `GET :3000/v1/scenarios` returns JSON. |
| 2 | Evidence proves it | ✅ | Before (`6b7e3ad`) and after (`db12e35` / `f48ca9d`) measured the same way: curl on `:3000/`, `:3001/`, `:8472/health`, `:3000/health`, `:3000/v1/scenarios`; HTML dumps; 1440×900 PNGs. A reader who has not opened the diff can see “For teams” appear on Fit, “six questions” leave the business landing, Docker files gain Python/8472, `/v1/scenarios` go from 404 HTML to JSON, and the Node tarball curl gain `--max-time`. “What this does not prove” is specific (no daemon, bake-time `NEXT_PUBLIC_*`, business copy below the fold on the PNG). |
| 3 | Structure holds | ✅ | Edge routes (`apps/consumer/src/app/health/route.ts`, `apps/consumer/src/app/v1/[...path]/route.ts`) call `proxyFitRequest`; they do not touch a database. Fetch to the Fit API lives in `apps/consumer/src/lib/fit-proxy.ts`. No new runtime npm dependency. Consumer still has no `@ark/db` / `@ark/core`. |
| 4 | Fails safely | ✅ | Round 1 gap closed: `deploy/Dockerfile:11` curls the Node tarball with `--max-time 120 --retry 3` (comment at line 8). The Fit proxy times out at 20s and returns JSON 502/504 (`apps/consumer/src/lib/fit-proxy.ts:49-69`). |
| 5 | Readable | ✅ | Names (`fit-proxy`, `businessUrl`, `ark-links`) match the job. Comments explain why (Turbopack rewrites, `0.0.0.0` bind, Python 3.12 from `fit/pyproject.toml`, curl `--max-time`). Tests cover the proxy, the deploy-file invariants, and the curl timeout. Mobile “For teams” closes the menu (`apps/consumer/src/components/site-header.tsx:81`). |

**Blocking:** none.

**Non-blocking:**
- `evidence/three-product-runtime/after-business.png` does not show the “Not at work?” copy (below the fold at 1440×900); the HTML dump does — already stated in `EVIDENCE.md`.
- `apps/consumer/src/app/v1/[...path]/route.ts:1-15` plus `apps/consumer/src/lib/fit-proxy.ts:20-21` (`VERCEL` → `null` → 502) mean a Vercel platform rewrite for `/v1` never runs; Vercel deploy is out of spec scope.
- `apps/consumer/src/app/page.tsx:157` landing CTA label is “AIFit for teams”, not “For teams”; chrome carries the spec’s label and `GET :3000/` still contains it.
