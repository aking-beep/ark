# Evidence — agent-control-v01

## What changed

An authenticated Control org can discover agents in a GitHub repository (bounded, no code execution), register an Agent Manifest, and run deterministic ARK Assurance against it. Registered agents optionally join runtime traces via `agentId`. Spend, traces, protocol evidence, budgets and calibration are unchanged.

## How it was measured

Same command twice:

```bash
node evidence/agent-control-v01/probe.mjs
```

Conditions: compiled `@ark/core` / `@ark/db` / `@ark/runtime`, seeded SQLite (`npm run setup`), Control `next dev` on `:3002`. Authed probe uses Northwind (`sam@northwind.example`). Screenshots: `node evidence/agent-control-v01/shots.mjs` at 1440×900, Demo Co login, routes `/discover` `/agents` `/assurance` `/dashboard`.

## Before / after

| | Before (`before.txt`, commit `ac7476f`) | After (`after.txt`, commit `a2a0000`) |
|---|---|---|
| `@ark/core` AgentManifest / discovery / assurance / policy | ABSENT | yes |
| Giant purpose rejected | ABSENT | yes |
| GitHub URL parser | ABSENT | yes |
| `listAgents` + `agents` DDL | ABSENT | yes |
| `RuntimeRequest.agentId` optional | ABSENT | yes |
| `GET /discover` `/agents` `/assurance` (anon) | ABSENT (would 404) | 307 (login) |
| Same routes authed | ABSENT | 200 |
| Nav Discover + docs/09 | ABSENT | yes |

Screenshots: `after-discover.png`, `after-agents.png`, `after-assurance.png`, `after-dashboard.png`.

Capture timestamps and commit SHAs are in `captures.tsv`.

## What this does not prove

Live GitHub fetch was unit-tested with an injected `fetch`, not against github.com in this run (`ARK_GITHUB_TOKEN` unset). Screenshots are empty-inventory pages (Demo Co has no registered agents yet). Policy evaluation is unit-tested only — it is not on the request path. Load, SSO, and private-repo rate limits were not exercised.

## Deviations

None of substance. `RiskLevel` on the Agent Manifest is exported as `AgentRiskLevel` so it does not collide with the existing assessment `RiskLevel` (`low | moderate | high | severe`). Field name on the manifest remains `riskLevel`.

## Definition of done

- **Cost / latency impact:** Discovery is a bounded GitHub fetch (40 files, 64 KB each, 512 KB total, 8 s timeout). Assurance is in-process Zod + checks. Ingest of `agent_id` is one extra nullable column. No change to cost-per-outcome queries.
- **Observability for new failure modes:** Discover form surfaces GitHub errors (404/401/timeout) without logging the token. Assurance findings persist on `assurance_runs`. Unknown fields stay `unknown`, not pass.
- **Docs or ADR updated:** `docs/09-agent-control-v01.md`; extensions to `docs/01-architecture.md`, `docs/03-data-model.md`, `docs/04-roadmap.md`, `docs/08-how-ark-works.md`, `README.md`, `.env.example`.
