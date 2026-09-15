# ARK

Three products, one engine, one commitment: **a guess and a measurement never look the same on screen.**

| Surface | Port | What it is |
|---|---|---|
| **Fit** (consumer) | 3000 | Five-minute quiz: your AI style, matched tools, paste-ready setup files. |
| **AIFit for teams** (business) | 3001 | Thirty questions about one workload. Verdict, architecture, model, controls, eval plan, cost, roadmap. |
| **ARK Control** | 3002 | Telemetry ingest and cost governance for AI workloads in production. Measures what AIFit estimated. |

![Three surfaces, one engine, one wire between them](docs/diagrams/system-map.svg)

## The sequencing argument

Most tools in this category are estimators: they take a description of a workload and emit a confident cost figure derived from published token prices and an assumed call shape. The figure is wrong for a specific and predictable reason — the two variables that dominate real spend are *turns per outcome* and *failure rate*, and neither can be known before the system runs. An agent that averages seven turns in a demo and nineteen in production produces a bill at nearly three times the forecast, and no amount of care with the price-per-token column will catch it.

ARK Control is the thing that manufactures ground truth. It ingests traces from running workloads, computes observed call shapes per architecture pattern, and serves them at `GET /api/v1/calibration`. AIFit calls that endpoint. When it answers, cost figures are labelled `measured` and carry a sample size. When it does not answer — which is the default, because most people will run AIFit before they run Control — the assessment still completes and every figure is labelled `heuristic`.

That is the whole product thesis in one sentence: **the estimator does not get more confident over time, it gets more informed, and it tells you which one just happened.**

## The provenance ladder

Every user-facing number carries one of four tags, rendered by a single component (`BasisTag`) that no surface is allowed to skip:

| Basis | Meaning |
|---|---|
| `heuristic` | A rule of thumb from the rubric. Defensible, arguable, not observed. |
| `benchmark` | A published figure — list price, stated context window, third-party benchmark. |
| `calibrated` | Derived from measurements on systems like yours, but not yours. |
| `measured` | Computed from your own telemetry, above the 30-trace sample floor. |

A prior is promoted only above that floor. Below it, the number stays `heuristic` and says why, because a mean drawn from four traces is noise wearing a decimal point.

## The engine can say no

`Verdict = 'not-ai'` is a real outcome, not a courtesy. A workload whose task shapes are only `calculate` and `lookup` gets routed to a query and a scheduled job, with the LLM alternative explicitly rejected and the reason written down. Roughly a quarter of what people bring to a tool like this should not go near a language model. An assessment tool that always finds a way to recommend AI is a lead-generation form.

## Quick start

```bash
npm install
pip install -e 'fit/[dev]'   # consumer Fit API (Python)
npm run setup                # build ARK packages, push schema, seed Control
npm run dev                  # Fit API + consumer + business + control
```

Then:

- http://localhost:3000 — Fit (consumer AIFit)
- http://localhost:3001 — business AIFit
- http://localhost:3002 — ARK Control (sign in; see demo accounts below)

Zero config. The database is a local SQLite file (`ark.db`); nothing else is required. To see AIFit's figures flip from `heuristic` to `measured`, set `ARK_CONTROL_URL=http://localhost:3002` and `ARK_CONTROL_TOKEN` to a Demo Co ingest token, then reload a business report.

Control is org-scoped at the edge. After `npm run setup`:

| Org | UI login | Ingest bearer |
|---|---|---|
| Demo Co | `dana@riverbend.example` / `riverbend-demo` | `ark_dev_ingest_org_demo` |
| Northwind (no seeded events) | `sam@northwind.example` / `northwind-demo` | `ark_dev_ingest_org_northwind` |

`npm run ingest:live` posts traces for Northwind through the same ingest path as production. Until that runs, Northwind's calibration is `calibrated` from Demo Co's patterns — fleet priors, not a thin sample of its own.

Host all three surfaces with Docker: [`docs/05-hosting.md`](docs/05-hosting.md).

## Layout

```
packages/
  core/     the engine — schema, scoring, economics, model catalog, calibration client
  db/       Drizzle schema + seed for Control
  ui/       shared component vocabulary and Tailwind preset
  sdk/      ingest client — trace ids, turn indices, POST /api/v1/events
fit/        Fit engine — Python scoring, FastAPI, registry, evals (consumer backend)
apps/
  consumer/ Fit B2C     — adaptive quiz UI; proxies /v1 to fit API
  business/ AIFit B2B   — 8 sections, @ark/core, plus POST /api/assess
  control/  ARK Control — ingest, dashboards, budgets, calibration endpoint
docs/       thesis, architecture, PRDs, methodology, data model, ADRs
```

### The boundary that matters

`apps/consumer` and `apps/business` **do not depend on `@ark/db`**. Consumer Fit uses the Python engine under `fit/`; business uses `@ark/core`. The only coupling between **business** AIFit and Control is one documented HTTP call that is allowed to fail. `fetchCalibration()` returns `null` on timeout, non-200, or schema mismatch, and the product degrades honestly rather than breaking or — worse — silently substituting a guess for a measurement.

Consumer Fit keeps quiz progress in the browser (`localStorage`) and scores via the Fit API. Business AIFit encodes intake into the result link and recomputes server-side on every view.

## Commands

```bash
npm run dev            # all three apps concurrently
npm run build          # packages, then all three apps
npm run test           # @ark/core, db, SDK
npm run test:fit       # Fit Python engine (pytest)
npm run typecheck      # every workspace
npm run db:seed        # regenerate demo telemetry
npm run ingest:live    # POST live traces for the Northwind org (not SQL-inserted)
```

## Reading order

1. [`docs/00-thesis.md`](docs/00-thesis.md) — why this exists and what it refuses to do
2. [`docs/01-architecture.md`](docs/01-architecture.md) — how the three surfaces fit together
3. [`docs/02-scoring-methodology.md`](docs/02-scoring-methodology.md) — the rubric, with its limitations named
4. [`docs/03-data-model.md`](docs/03-data-model.md) — traces, events, and why the distinction matters
5. [`docs/04-roadmap.md`](docs/04-roadmap.md) — phases with exit criteria *and* kill criteria
6. [`docs/05-hosting.md`](docs/05-hosting.md) — Docker and production env
7. [`docs/06-aifit-consumer.md`](docs/06-aifit-consumer.md) — Fit consumer (merged from aifit-engine)
8. [`docs/adr/`](docs/adr/) — the decisions that would otherwise be re-litigated every quarter
9. [`docs/prd/`](docs/prd/) — one per surface: who it is for, what it refuses to do

If you would rather see the five arguments than read them, [`docs/diagrams/`](docs/diagrams/) is an index of the same material: the system map above, the trace-versus-event comparison, the verdict ladder drawn from the source, the provenance ladder worked end to end, and the calibration loop.

## Licence

MIT. See [LICENSE](LICENSE).
