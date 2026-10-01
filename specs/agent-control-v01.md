# agent-control-v01

**Status:** APPROVED
**Approved by:** repository owner (ARK Control v0.1 Discover → Register → Assure; 2026-10-01)
**Date:** 2026-10-01

## Problem

ARK Control can observe what a running workload cost, did, and was allowed to do. It cannot yet answer which agents exist, where they came from, or whether they are safe to run in production. Discovery, identity, and assurance live nowhere in the product. Telemetry without an agent grain is still a bill, not a control plane.

## Outcome

An authenticated Control org can point at a GitHub repository, see bounded discovery evidence, register one or more Agent Manifests, and run deterministic ARK Assurance against them. Registered agents can be joined to runtime traces via an optional `agentId`. Existing spend, traces, protocol evidence, budgets and calibration are unchanged.

## Acceptance criteria

1. **Agent Manifest** in `@ark/core` (`packages/core/src/agents/manifest.ts`), Zod, bounded (string maxes, array caps). Closed enums for status, environment, risk, tool type, MCP transport, integration type/direction, permissions flags. Unknown owner/policy/data fields stay optional — not invented. Exported from `@ark/core`. Unit tests cover parse, reject-giant-payload, and required identity.

2. **Repository discovery** in `@ark/core` accepts a bounded snapshot `{ repository, branch, commitSha?, files: [{ path, content }] }`. It does not execute code, clone, install packages, or store credential values. It returns `DiscoveryResult` with candidates, models, tools, mcpServers, integrations, infrastructure, evidence paths, warnings, and confidence. Tests cover a LangGraph+OpenAI+MCP fixture, an empty/non-agent fixture (false-positive resistance), and secret-looking values recorded as env *names* only.

3. **Materialize** `materializeAgentManifests(discovery)` produces candidates that mark each field `observed | inferred | unknown`. Owner, policies, permissions and data classes are never silently invented.

4. **ARK Assurance** in `@ark/core` is deterministic (no LLM judge). Checks: identity, provenance, model, tools/MCP, permissions, data, production readiness. Statuses: `pass | warn | fail | unknown`. Returns `AssuranceReport` with counts, not a fake numeric score. Tests cover a complete manifest (pass/warn) and a production high-risk agent missing evals/policies/owner (fail).

5. **Policy foundation** in `@ark/core`: schema + `evaluatePolicy`. Conditions: environment, riskLevel, dataClasses includes, permission includes. Requirements: policyRefs, evaluations, humanEscalation, humanApproval, approved provider/model. Tests only — no production request-path enforcement.

6. **Database** adds `agents`, `discovery_runs`, `assurance_runs` (not folded into events/traces). `events.agent_id` optional. Queries: `listAgents`, `getAgent`, `upsertAgent`, `createDiscoveryRun`, `getDiscoveryRun`, `createAssuranceRun`, `latestAssuranceForAgent`, `listAssuranceRuns`, plus org-scoped agent observations. Org isolation tests. `schema.ts` and `sql.ts` both updated. Existing ingest tests still pass.

7. **Control UI** (authenticated): `GET /discover` 200; `GET /agents` 200; `GET /assurance` 200; `GET /agents/[id]` 200 for a registered agent. Nav: Connect, Discover, Agents, Assurance, then existing Spend…Calibration. Dashboard keeps cost-per-outcome and adds an Agent Infrastructure summary. Agent detail has overview, source, models, tools, MCP, integrations, permissions, data, policies, evaluations, assurance, runtime observations, and a CSS infrastructure graph from the manifest only (no invented edges). Discover accepts `https://github.com/owner/repo` (+ optional branch). `ARK_GITHUB_TOKEN` is server-side only. File fetch is capped (files, per-file bytes, total bytes) and documented.

8. **Runtime** `RuntimeRequest.agentId` optional. Telemetry copies it onto events. `@ark/sdk` EventInput/draft accepts `agentId`. Backward compatible: omitting it still ingests. Tests cover presence and absence.

9. **Docs:** `docs/09-agent-control-v01.md`; updates to `docs/01-architecture.md`, `docs/03-data-model.md`, `docs/04-roadmap.md`, `README.md`, `.env.example`. No new app, no Runtime surface, no per-protocol dashboard.

10. **Preserve:** `npm run typecheck`, `npm test`, `npm run test:my-ai`, `npm run build` pass. Consumer still does not import `@ark/core`/`@ark/db`. No payloads in protocol evidence. Org tenancy holds.

## How this will be proved

Cloud station is this container. Control `:3002`.

- **Artefact:** `node evidence/agent-control-v01/probe.mjs` before and after (same command), plus 1440×900 screenshots of `/discover`, `/agents`, `/assurance` after login.
- **Before:** `/discover` `/agents` `/assurance` are 404; `@ark/core` has no `AgentManifest`; no `agents` table.
- **After:** probe records manifest parse, discovery+materialize, assurance fail-on-missing-owner-in-production, GitHub URL parser, file bounds, org isolation, runtime `agentId` round-trip; Control routes 200 when authenticated.
- **Conditions:** compiled packages, seeded SQLite, fake GitHub fetch (no live token required for unit tests). Live GitHub optional.

## Out of scope

- A fourth product, `apps/runtime`, per-protocol dashboards, unifying visual systems.
- LLM-as-judge assurance, production policy enforcement in the request path.
- Cloning arbitrary repos, executing discovered code, storing tokens or source secrets.
- SSO, billing, Postgres cutover.
- Rewriting scoring, protocol adapters, or the provenance ladder.

## Risk

GitHub fetch must be bounded and fail closed on oversized trees (warn, do not download). Tokens never logged. Discovery treats source as untrusted: no `eval`, no shell, no dynamic import of scanned files. Assurance must not report `pass` without running the check.

- **Rollback:** revert the branch. Telemetry without `agentId` remains valid.
