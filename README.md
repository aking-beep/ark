# ARK

Three products, one engine, one commitment: **a guess and a measurement never look the same on screen.**

| Surface | Port | What it is |
|---|---|---|
| **AIFit** (consumer) | 3000 | Six questions about one task you do. A straight answer, including "no". |
| **AIFit for teams** (business) | 3001 | Thirty questions about one workload. Verdict, architecture, model, controls, eval plan, cost, roadmap. |
| **ARK Control** | 3002 | Telemetry ingest and cost governance for AI workloads in production. Measures what AIFit estimated. |

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
npm run setup     # build packages, push schema, seed demo telemetry
npm run dev       # all three apps
```

Then:

- http://localhost:3000 — consumer AIFit
- http://localhost:3001 — business AIFit
- http://localhost:3002 — ARK Control

Zero config. The database is a local SQLite file (`ark.db`); nothing else is required. To see AIFit's figures flip from `heuristic` to `measured`, set `ARK_CONTROL_URL=http://localhost:3002` in the business app's environment and reload a report.

## Layout

```
packages/
  core/     the engine — schema, scoring, economics, model catalog, calibration client
  db/       Drizzle schema + seed for Control
  ui/       shared component vocabulary and Tailwind preset
apps/
  consumer/ AIFit B2C   — 6 questions, no persistence, results encoded in the URL
  business/ AIFit B2B   — 8 sections, no persistence, plus POST /api/assess
  control/  ARK Control — ingest, dashboards, budgets, calibration endpoint
docs/       thesis, architecture, PRDs, methodology, data model, ADRs
```

### The boundary that matters

`apps/consumer` and `apps/business` **do not depend on `@ark/db`**. This is enforced by their `package.json` and it is deliberate: the only coupling between AIFit and Control is one documented HTTP call that is allowed to fail. `fetchCalibration()` returns `null` on timeout, non-200, or schema mismatch, and the product degrades honestly rather than breaking or — worse — silently substituting a guess for a measurement.

Neither AIFit surface stores anything. Both encode the intake into the result link and recompute server-side on every view. A consumer tool that asks what you do all day and keeps a copy has to earn that; this one does not keep anything.

## Commands

```bash
npm run dev            # all three apps concurrently
npm run build          # packages, then all three apps
npm run test           # engine tests (node --test)
npm run typecheck      # every workspace
npm run db:seed        # regenerate demo telemetry
```

## Reading order

1. [`docs/00-thesis.md`](docs/00-thesis.md) — why this exists and what it refuses to do
2. [`docs/01-architecture.md`](docs/01-architecture.md) — how the three surfaces fit together
3. [`docs/02-scoring-methodology.md`](docs/02-scoring-methodology.md) — the rubric, with its limitations named
4. [`docs/03-data-model.md`](docs/03-data-model.md) — traces, events, and why the distinction matters
5. [`docs/04-roadmap.md`](docs/04-roadmap.md) — phases with exit criteria *and* kill criteria
6. [`docs/adr/`](docs/adr/) — the decisions that would otherwise be re-litigated every quarter
7. [`docs/prd/`](docs/prd/) — one per surface: who it is for, what is in scope, what is refused

## Licence

MIT. See [LICENSE](LICENSE).
