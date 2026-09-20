# How ARK works

This is the map. The thesis is [why](00-thesis.md). The architecture is [how it is built](01-architecture.md). This page is **what talks to what**, what a request looks like from a quiz to a drift number, and what is forbidden.

## Three products, not one suite

**MY AI**, **MY AI for teams**, and **ARK Control** are three products. They share a thesis — a guess and a measurement never look the same on screen — and they do not share a homepage, a login, or a funnel.

- **MY AI** (`:3000`) is a personal fit quiz. Five minutes. You walk away with `CLAUDE.md`, Cursor rules, and `AGENTS.md`. It talks only to its own Python API.
- **MY AI for teams** (`:3001`) is a workload estimator. Thirty questions about one repeating job. It can say `not-ai`. It talks only to Control.
- **ARK Control** (`:3002`) is production measurement. Traces, protocol evidence, spend per outcome, drift. It does not sit in the request path.

A person who finishes the quiz is not invited to assess a workload. A team that finishes an assessment is not invited to take the quiz. Control does not deep-link either of them as a next step. That is a product decision, not an omission. See [`specs/three-product-runtime.md`](../specs/three-product-runtime.md).

The rest of this page is how they flow together **when they do talk** — which is only teams ↔ Control.

## Three products, two libraries that are not products

```
                    personal fit                         the loop
               ┌──────────────────┐          ┌──────────────────────────┐
               │  MY AI  :3000    │          │ MY AI for teams  :3001   │
               │  quiz + exports  │          │ estimator (heuristic)    │
               └────────┬─────────┘          └────────────┬─────────────┘
                        │ Python /v1                      │ GET /api/v1/calibration
                        │ (no @ark/core)                  │ POST /api/measure
                        ▼                                 ▼
               ┌──────────────────┐          ┌──────────────────────────┐
               │  my-ai FastAPI   │          │  ARK Control  :3002      │
               │  :8472           │          │  measurement (measured)  │
               └──────────────────┘          └────────────▲─────────────┘
                                                          │
                         @ark/sdk  POST /api/v1/events ───┘
                         @ark/runtime  (library, not a surface)
                         @ark/protocols (adapters, not surfaces)
```

| Name | Port | Job | Talks to |
|---|---|---|---|
| **MY AI** | 3000 | Five minutes. A personal AI style and paste-ready `CLAUDE.md`, Cursor rules, `AGENTS.md`. | Only the Python MY AI API on 8472. |
| **MY AI for teams** | 3001 | Thirty questions about one workload. Verdict, architecture, cost, controls. | Control, over HTTP, and only Control. |
| **ARK Control** | 3002 | What production actually cost, did, and was allowed to do. | Ingest from anyone with a bearer. Calibration out to teams. |
| **`@ark/runtime`** | — | Policy → router → provider → eval → ingest. | Imported. Not an app. |
| **`@ark/protocols`** | — | MCP, A2A, AG-UI, A2UI, UCP, AP2 → one evidence grain. | Imported. Executes nothing. |

MY AI and MY AI for teams **do not link to each other.** The consumer quiz is not a funnel that softens a team workload assessment.

## The only runtime wire: teams ↔ Control

On every report render:

```
teams  --GET /api/v1/calibration?days=30-->  Control
teams  <-- CalibrationSet or null --------
teams  assess(workload, { calibration })
```

Two outcomes, no third:

- Control answers, schema matches, sample floor of 30 traces is met → cost figures read **measured**.
- Anything else (no `ARK_CONTROL_URL`, timeout, non-200, bad schema, thin sample) → figures read **heuristic**, and the page says so.

`fetchCalibration()` never throws and never partially applies. A guess that looks measured is the failure this boundary exists to prevent.

A report can also `POST /api/measure`: one synthetic Runtime sample (workload id and task shapes, never the description). That is how an empty Control org gets its first event without sitting in production traffic.

## A unit of work, four grains

Production traffic does not have to go through Runtime. The durable path is the SDK:

```ts
import OpenAI from 'openai';
import { ArkIngest } from '@ark/sdk';
import { mcpEvidence } from '@ark/protocols';

const ark = new ArkIngest({
  baseUrl: process.env.ARK_CONTROL_URL!,
  token: process.env.ARK_CONTROL_TOKEN,
});
const openai = new OpenAI({ fetch: ark.instrumentFetch() });

await ark.run('wl_support_triage', async (trace) => {
  await openai.chat.completions.create({ /* ... */ });
  trace.evidence(mcpEvidence({
    method: 'tools/call', name: 'search_customer',
    client: 'support-agent', server: 'crm-mcp',
  }));
});
```

`run()` is one unit of business work — one trace id. Inside it:

| Grain | Table | What it is |
|---|---|---|
| MODEL EVENT | `events` | One model call. Turn index is required. Prompt bodies are not stored. |
| ACTION | `actions` | A side effect (refund, ticket, email). |
| PROTOCOL EVIDENCE | `protocol_evidence` | A normalised MCP / A2A / AG-UI / A2UI / UCP / AP2 observation. Scalars only. |
| TRACE | `traces` | The unit. Outcome, total cost, total turns. |

Control prices events, detects runaway loops, missing approvals, off-allowlist providers, budget breaches, and serves `/dashboard`, `/protocols`, `/workloads/[id]` (the drift page), `/budgets`.

Connect path in the product: authenticated `/start` on Control.

## How a number gets from heuristic to measured

1. Teams scores a workload against the rubric. Turns-per-outcome and failure rate are **heuristic**.
2. The workload ships. `instrumentFetch` + `run()` (or Runtime, or a hand-rolled POST) send traces.
3. Control aggregates call shape per architecture pattern over 30 days.
4. Next report render, `fetchCalibration` returns that shape with a sample size.
5. Above 30 traces, `resolveCallShape` promotes the figure. It is labelled **measured**. Below 30 it stays heuristic and says why.
6. `/workloads/[id]` compares what the report predicted to what ran. That page exists to embarrass the estimate.

The estimator does not get more confident. It gets more informed, and every figure says which of the two it is.

## What is forbidden

- **A consumer → teams funnel.** No “For teams” on MY AI. No “Open MY AI” on teams. The quiz must not soften a workload verdict.
- **Payloads in the database.** No prompt bodies, tool arguments, message contents, A2UI data models, UCP checkout payloads, AP2 signatures. Adapters build from named fields; the schema admits scalars; redaction runs in the SDK and again at ingest.
- **Sitting in the request path.** Control observes. A Control outage inside `run()` does not fail the user’s model call.
- **Guessing ROI.** Blank minutes and hourly rate stay blank. Payback is **unknowable**, not $0.
- **A fourth product.** Runtime is a library. Protocols are adapters. Adding a seventh protocol is one file, not one app.

## Where to click

| If you are… | Open |
|---|---|
| A person picking an AI setup | http://localhost:3000 — MY AI |
| A team deciding whether to build | http://localhost:3001 — MY AI for teams |
| An operator connecting production | http://localhost:3002/start — Control Connect |
| An engineer changing the engine | [`01-architecture.md`](01-architecture.md), [`03-data-model.md`](03-data-model.md), [`07-protocol-evidence.md`](07-protocol-evidence.md) |
