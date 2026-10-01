# ARK Control v0.1 — Discover → Register → Assure

ARK builds infrastructure for understanding, assuring, governing and operating AI agents.

- **ARK Control** is the control plane.
- **ARK Assurance** is the verification capability inside Control — not a separate product.
- **ARK Runtime** is the execution library — not an app.
- **ARK SDK** and developer tools are the adoption layer.
- **Protocols** remain adapters.

The loop this plane is for:

```
Discover → Register → Assure → Observe → Govern → Enforce
```

v0.1 ships the first three. Observe is already present as telemetry, traces, actions and protocol evidence; this milestone joins that grain to a registered **Agent**. Govern is a policy schema and evaluator. Enforce is not in the request path yet.

## Grains

| Grain | What one row is | What it is not |
|---|---|---|
| **Agent** | One registered identity (`agents` + Agent Manifest) | A model call, a trace, or a protocol |
| **Discovery run** | One bounded scan of a repository snapshot | A clone, an execution, or a guarantee the repo is an agent |
| **Assurance run** | One deterministic check of one manifest | A numeric score or an LLM judgement |
| **Trace** | One unit of business work | One model call |
| **Event** | One model call | An agent, an action, or a protocol observation |
| **Action** | One side effect | A model call |
| **Protocol evidence** | One normalised observation (MCP, A2A, AG-UI, A2UI, UCP, AP2) | A payload |

Events may carry an optional `agentId`. Omitting it is valid. Traces, actions and protocol evidence join to an agent through that id and the shared `traceId`.

## Discover

Control `/discover` accepts `https://github.com/owner/repo` and an optional branch.

The server fetches a **bounded** snapshot via GitHub's API. It does not clone, does not execute repository code, does not install packages, and does not store credentials.

| Limit | Value |
|---|---|
| High-signal files | 40 |
| Per-file bytes | 64,000 |
| Total content bytes | 512,000 |
| Tree entries listed | 400 |
| Timeout | 8,000 ms |

High-signal paths include `package.json`, `pyproject.toml`, `requirements.txt`, `README.md`, `CLAUDE.md`, `AGENTS.md`, agent/MCP/tool source, Docker and compose files. `.env` is skipped (`.env.example` is not). `node_modules` and build output are skipped.

`ARK_GITHUB_TOKEN` is optional, **server-side only**, required for private repositories or higher API limits. It is never sent to the browser, never logged, never stored, and must not be named `NEXT_PUBLIC_`.

Discovery records environment **names** when a secret-looking assignment is present. Values are discarded.

Every finding carries evidence paths. Confidence is a function of how many evidence classes were seen, not a claim of certainty.

## Register

`materializeAgentManifests` turns a `DiscoveryResult` into Agent Manifest candidates. Each field is marked `observed`, `inferred`, or `unknown`.

Owner, policies, permissions and data classifications are **never invented**. Unknown stays unknown. Registering writes `agents` for this org. The same agent id in another org is a different row.

## Assure

`runAssurance(manifest)` is deterministic. Statuses are `pass`, `warn`, `fail`, `unknown`. The report is counts, not a fake score. Unknown means the field was absent — it is not treated as pass. A check that was not executed is not reported as pass.

Groups: identity, provenance, model, tools, permissions, data, production readiness.

## Observe

`execute({ agentId, workloadId, messages })` and `ArkIngest.run(workloadId, fn, { agentId })` attach the registered id to ingested events. Agent detail reads calls, traces, spend, errors, actions and protocol activity for that id.

## Govern (foundation)

`AgentPolicy` + `evaluatePolicy` in `@ark/core`. Conditions: environment, riskLevel, dataClasses includes, permission includes. Requirements: policy refs, evaluations, human escalation/approval, approved provider/model, logging (unverified → unknown).

This is not production enforcement. Unmatched policies return `unknown`, not pass.

## Enforce

Not in v0.1. Do not put complex runtime enforcement on the request path until these semantics have been used in anger.

## Security

- Discovered source is untrusted input. No `eval`, no shell, no dynamic import, no package install from the scanned repository.
- No storage of source secrets, raw credentials, or GitHub tokens.
- Org isolation on every new table.
- Protocol privacy controls (no payloads in `protocol_evidence`) are unchanged.
- Control does not sit in the request path.
