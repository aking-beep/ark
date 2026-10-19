# Evidence — observe-govern-enforce

## What changed

An authenticated Control org can Discover a public GitHub repository live (not a fixture upsert), register from that click, and see DEFAULT_AGENT_POLICIES evaluated on the agent. Runtime `execute` denies a production-PII agent before the model is called. Actions and protocol evidence carry optional `agent_id`. Truncated GitHub trees fail closed. Calibration is fully visible in the nav at 1440×900.

## How it was measured

Same command twice:

```bash
node evidence/observe-govern-enforce/probe.mjs
```

Conditions: compiled packages, seeded SQLite, Control `next dev` on `:3002`, `ARK_GITHUB_TOKEN` unset. Screenshots: `node evidence/observe-govern-enforce/shots.mjs after --live-discover` at 1440×900, Demo Co login, **live** form submit of `https://github.com/aking-beep/ark`.

## Before / after

| | Before (`before.txt`, commit `e2bf153`) | After (`after.txt`) |
|---|---|---|
| `enforceAgentPolicies` | ABSENT | yes |
| enforce denies production PII | ABSENT | yes (denied) |
| `actions.agent_id` / `protocol_evidence.agent_id` | ABSENT | yes |
| truncated tree fail-closed | files=1 (still fetched) | yes (0 files) |
| execute blocks before complete() | ABSENT | yes (PolicyError, complete=0) |
| GET /discover anon | 307 | 307 |
| GET /discover authed | 200 | 200 |
| live GitHub octocat/Hello-World | empty (no high-signal files; HTTP succeeded) | empty |
| Live Discover click | not taken | `after-discover-live.png` + registered `after-agent-detail.png` |
| Calibration in nav at 1440px | present, previously clipped | fully visible |

Screenshots: `before-discover.png`, `before-dashboard.png`, `after-discover.png`, `after-dashboard.png`, `after-agents.png`, `after-assurance.png`, `after-discover-live.png`, `after-agent-detail.png`.

## What this does not prove

Private-repo fetch (`ARK_GITHUB_TOKEN` unset). Hello-World has no high-signal files so the live probe line is empty by inventory, not by HTTP failure — the live click against `aking-beep/ark` is the user-visible proof. Org-scoped policy CRUD and Control-as-a-model-proxy are out of scope. Load and SSO untested.

## Deviations

GitHub agent indexes for `actions` / `protocol_evidence` live in `MIGRATIONS` as well as the CREATE TABLE, so existing SQLite files get `ALTER TABLE … ADD COLUMN` instead of a DDL index that would fail before the column exists.

`evidence/agent-control-v01/before.txt` was **not** recaptured.

## Definition of done

- **Cost / latency impact:** Enforcement is in-process Zod + table lookup on the caller’s Runtime, only when a manifest is attached. GitHub fail-closed avoids downloading truncated trees. `agent_id` is one nullable column on two tables.
- **Observability for new failure modes:** `PolicyError` is thrown; policy refusal is not ingested as a model call (existing telemetry rule). Discover surfaces GitHub errors without logging the token. Corrupt assurance JSON is skipped.
- **Docs or ADR updated:** `docs/09-agent-control-v01.md`, `docs/03-data-model.md`, `docs/04-roadmap.md`.
