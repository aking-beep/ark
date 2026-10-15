# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The person who owns the inference/API bill. In a small company that is often the same engineering lead who filled in an AI Fit Teams intake; in a larger one it is whoever got asked why that line item tripled.

Two jobs, and they are not the same job:

- **For that person:** what is this actually costing **per outcome**, and what is going wrong that a per-call provider dashboard cannot see.
- **For the system:** manufacture ground truth so AI Fit Teams can promote a figure from `heuristic` to `measured`.

*(Inferred from `docs/prd/ark-control.md` and `docs/00-thesis.md`.)*

## Product Purpose

ARK Control is the evidence and control plane: discover and register agents, run ARK Assurance, ingest traces, govern spend, observe protocol evidence, and measure what AI Fit Teams estimated.

The loop this plane is for:

```
Discover → Register → Assure → Observe → Govern → Enforce
```

v0.1 in-repo is Discover → Register → Assure, plus Observe as telemetry. ARK Assurance is a capability of Control, not a fourth product. `@ark/runtime` is a library, not an app.

Success includes: ingest that never drops real traffic because the catalog is behind; a 19-turn trace counting as one outcome; patterns below 30 traces returned and **not** used as `measured`; `npm run setup && npm run dev` producing a working system on a local SQLite file.

## Positioning

Most tools in this category are estimators with no path to ground truth. Control is the measurement system; Teams is the estimator attached to it. A provider console cannot answer cost per outcome because it does not know which calls belonged to the same unit of work.

Control observes. It does not sit in the customer’s live request path. A Control outage inside ingest must not fail the user’s model call.

## Operating Context

- Local: `npm run dev:control` on :3002. Database: `ark.db` (SQLite). Org-scoped sessions and ingest bearer tokens.
- Demo orgs after `npm run setup`: Demo Co (`dana@riverbend.example`) and Northwind (`sam@northwind.example`).
- Connect path in-product: authenticated `/start`.
- Teams consumes `GET /api/v1/calibration?days=30`. Ingest is `POST /api/v1/events` (and SDK `instrumentFetch` + `run()`).
- Drift page `/workloads/[id]` compares what Teams predicted to what ran. That page exists to keep the rubric honest.
- GitHub discovery is a bounded snapshot via API (optional server-side `ARK_GITHUB_TOKEN`). No clone, no exec, no stored credentials.

## Capabilities and Constraints

**Grains:** Agent, discovery run, assurance run, trace (unit of business work), event (one model call), action (side effect), protocol evidence (normalised MCP / A2A / AG-UI / A2UI / UCP / AP2 observation). Turn index is required on events.

**Discover / Register / Assure:** bounded GitHub snapshot; Agent Manifest fields marked observed / inferred / unknown (owner, policies, permissions, data classes are never invented); deterministic assurance (`pass` / `warn` / `fail` / `unknown` counts, not an LLM score). A check not executed is not reported as pass.

**Observe:** price events; detect `loop_runaway`, `circuit_break`, `off_allowlist`, `sensitive_data`, `stale_pricing`, budget warn/breach, `unapproved_action`, `quality_regression`, `approval_missing`; serve spend, workloads, protocols, calibration.

**Budgets:** `observe` → `warn` → `throttle` → `block`.

**Provenance:** sample floor 30 traces. Below it, Teams keeps `heuristic` and says why. Snapshots of calibration are versioned and not overwritten.

**Privacy:** prompt `sample` is scanned and discarded; protocol adapters admit scalars only; no tool arguments, message bodies, mandates, or credentials stored. Sensitive-data alerts record class and workload, never the value.

**Does not:** agent framework; general APM; model gateway; store protocol payloads; sit in the live request path (v0.1 Enforce is explicitly not production request-path enforcement).

**Open:** accessibility standard not set in init. Whether Discover/Assure is part of the first paid invoice is a commercial decision, not recorded as product truth here.

## Brand Commitments

Public name **ARK Control** (shipped chrome, README, founder brief). Wordmark: “ARK” + “Control”.

Voice: precise, operational, willing to embarrass its own estimates. Footer states figures are computed from ingested traces, not provider invoices, and should be reconciled monthly.

Family commitment, shared with Teams: **a guess and a measurement never look the same on screen.**

## Evidence on Hand

- Shipped Control app, `@ark/db` schema and seed, `@ark/sdk`, `@ark/protocols`, `@ark/runtime`.
- Demo telemetry and two demo orgs.
- Docs: `docs/prd/ark-control.md`, `docs/09-agent-control-v01.md`, `docs/07-protocol-evidence.md`, `docs/08-how-ark-works.md`.
- Factory evidence under `evidence/` including agent-control and protocol-evidence work.

**Do not fabricate:** production customer traces, SOC2/status-page claims, or drift figures from anyone other than seeded/demo data.

## Product Principles

1. Manufacture ground truth; do not dress a guess as a measurement.
2. Strict about event shape, permissive about unknown models — real traffic is not dropped because the catalog is behind.
3. One unit of work is a trace; cost is per successful outcome; turn index is load-bearing.
4. Unknown stays unknown (manifests, assurance, calibration below the floor).
5. Observe first; do not become a gateway, a framework, or an APM.
