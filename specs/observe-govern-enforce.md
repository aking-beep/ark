# observe-govern-enforce

**Status:** APPROVED
**Approved by:** repository owner (close ARK Control v0.1 follow-ups; 2026-10-01)
**Date:** 2026-10-01

## Problem

ARK Control v0.1 shipped Discover → Register → Assure. The deferred items left the
control plane incomplete: policy evaluation did not sit on the request path;
actions and protocol evidence could not carry a registered agent id; GitHub
discovery parsed an unbounded recursive tree; stored discovery/assurance JSON
could 500 the UI; Discover owner was length-sliced; Calibration clipped off the
nav at 1440px; evidence never hit github.com or clicked Discover.

## Outcome

An authenticated org can discover a public GitHub repository live, register from
that click, and see policy enforcement deny a production-sensitive agent before
the model is called. Actions and protocol evidence carry optional `agentId`.
Oversized GitHub trees fail closed. Calibration is visible in the nav.

## Acceptance criteria

1. **Enforce on the request path.** `@ark/core` exports `enforceAgentPolicies` and
   `DEFAULT_AGENT_POLICIES`. `execute({...}, { agent, policies? })` evaluates
   those policies **before** any adapter `complete()` call. A `fail` throws
   `PolicyError` and does not call the model. Omitting `agent` is backward
   compatible. `unknown` does not block. Tests cover deny (production PII, no
   governance) and allow (same agent with required refs) and omit.

2. **`agent_id` on actions and protocol evidence.** Optional on `ActionInput` and
   `EvidenceInput`, `@ark/sdk` `bindAgent` copies it onto actions and evidence,
   `@ark/db` schema + DDL + migrations + ingest + indexes. Agent observations
   count those rows by `agent_id` (not only via events.trace_id). Omitting it
   still ingests. Org isolation holds.

3. **GitHub tree fail-closed.** If the recursive tree JSON exceeds
   `GITHUB_FETCH_LIMITS.maxTreeBytes`, or GitHub sets `truncated: true`, do not
   parse/download the rest of the tree as a snapshot of files — return no files
   and a warning. Tests cover truncated and oversize payloads (injected fetch).

4. **safeParse stored runs.** `getDiscoveryRun` / assurance reads use Zod
   `safeParse`. Corrupt JSON is skipped or returned as null result, not thrown
   as a 500.

5. **Discover owner** is parsed with the Agent Manifest owner schema. Over-long
   input is rejected, not sliced.

6. **Calibration nav** is fully visible at 1440×900 (wrap or shorter labels;
   no clipping of the last item).

7. **Evidence** runs a **live** `fetchGithubSnapshot` against github.com (public
   repo, no token required) and a **live Discover form submit** in the browser
   (not a fixture upsert). Control is up for both before and after HTTP probes.

8. **Preserve** existing tests, org tenancy, no token to the browser, no
   execution of discovered code, no new app.

## How this will be proved

Cloud station is this container. Control `:3002`.

- **Artefact:** `node evidence/observe-govern-enforce/probe.mjs` before and after
  (same command), plus 1440×900 screenshots including a live Discover result.
- **Before:** `enforceAgentPolicies` ABSENT; `actions.agent_id` /
  `protocol_evidence.agent_id` ABSENT in DDL; truncated tree still yields files;
  `/discover` `/agents` `/assurance` authed 200 (Control up); Calibration clipped
  or wrapping not proven.
- **After:** enforce denies production PII without governance and does not call
  the adapter; DDL has both `agent_id` columns; truncated tree returns 0 files;
  live GitHub fetch of a public repo returns files or a documented fail-closed
  warning; Discover click screenshot shows a real repository result.
- **Conditions:** compiled packages, seeded SQLite, Control listening, public
  GitHub API. `ARK_GITHUB_TOKEN` unset.

## Out of scope

- A general-purpose policy engine, org-scoped policy CRUD, or sitting in every
  provider HTTP path.
- Private-repo live fetch (still needs `ARK_GITHUB_TOKEN`).
- Recapturing `evidence/agent-control-v01/before.txt` (a baseline taken after
  the edit is not a baseline).
- SSO, billing, Postgres, LLM-as-judge.

## Risk

Enforcement must not fire when no agent is attached — that would break existing
Runtime callers. Fail-closed trees must not be treated as “no agents exist”
(warning required). Tokens never logged.

- **Rollback:** revert the branch. Events/actions/evidence without `agentId`
  remain valid.
