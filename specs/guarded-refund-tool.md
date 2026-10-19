# guarded-refund-tool

**Status:** APPROVED
**Approved by:** repository owner (Prompt 0 scope approval, PR-3; 2026-10-19)
**Date:** 2026-10-19

## Problem

`@ark/protocols` (`mcpEvidence`) records what a tool call reported after the
fact. Nothing in ARK stands between an agent and a side effect. `approvedBy` on
ingested actions is a free string the sender asserts, and Control counts
"unapproved" from it. The wedge in ADR-0009 needs one real boundary: a protected
tool that cannot run unless `decideAction` returned `allow`, and that leaves an
honest, privacy-safe receipt.

## Outcome

A developer can wrap one TypeScript MCP-style tool handler with ARK's guard. A
synthetic refund then runs only on `allow`, never on `deny`, `unknown`,
`require_approval`, a forged approval or a replay. Every attempt leaves a
receipt saying what was requested, what was decided, and what actually happened.

## Acceptance criteria

1. **The library.** A new workspace library `@ark/guard` (`packages/guard`) is a
   library, not an app, and depends on `@ark/core` (and `@ark/sdk` for
   best-effort telemetry). It exports
   `guardTool({ tool, action, handler, policies, resolveContext, idempotency, receipts })`,
   which returns a handler. Per call:
   1. **Context:** `resolveContext()` supplies the trusted `orgId`, `agentId` and
      `principal` from the server side. Values carried in the tool arguments are
      ignored for identity.
   2. **Validation:** arguments are validated with a zod schema and normalized.
      The request digest binds the decision to the arguments.
   3. **Decision first:** `decideAction` runs before any side effect.
   4. **Blocked outcomes:** on `deny`, `unknown`, an invalid request, or a stale
      or expired decision, the handler is never invoked. The guard returns a
      typed `blocked` result.
   5. **`require_approval`:** the result is `pending_approval` and the handler is
      not invoked. No approval service exists in this PR; any
      `approvedBy`/`approval` field in the arguments is ignored and recorded as
      `sender_reported_approval_ignored`.
   6. **`allow`:**
      - the idempotency key, which is required, is claimed atomically before the
        handler runs;
      - a second call with the same key returns the first outcome without
        invoking the handler;
      - the same key with a different digest is rejected as `idempotency_conflict`.
   7. **Execution status:** recorded separately as `not_attempted`, `attempted`,
      `completed`, `failed` or `outcome_unknown`. A thrown error or a timeout
      after the handler started is `outcome_unknown`, never `completed`, and is
      never retried automatically.
   8. **Policy failures fail closed:** if the policy source throws or times out,
      the result is `unknown` and the call is blocked.
2. **Action receipt.** A privacy-safe receipt is stored in a new org-scoped table,
   `action_receipts`, with primary key `(org_id, id)`. The DDL is added through
   the tracked migrations from PR-1, or through the existing DDL list if PR-1 is
   not merged yet; declare which in `EVIDENCE.md`.
   - **Stored fields:**
     - `org_id`, `id` (the decision id), `trace_id`, `agent_id`, `principal`;
     - `tool`, `action`, `resource_type`, `resource_id`;
     - `policy_id`, `policy_version`, `decision`, `reason_code`, `request_digest`;
     - `execution_status`, `idempotency_key_hash`;
     - `sender_reported_approval` (boolean: one was present and ignored);
     - `amount_minor`, `currency`, `created_at`, `updated_at`.
   - **Never stored:** raw arguments, prompts, customer PII, secrets or
     credentials.
   - **Storage:** an `ActionReceiptStore` interface, with a libSQL adapter in
     `@ark/db` and an in-memory adapter for tests.
3. **Synthetic refund demo.**
   - `packages/guard/src/demo/refund.ts` is a fake `refund_order` handler with
     an in-memory ledger and a call counter. It makes no network calls and uses
     no credentials.
   - `npm run demo:guard` prints the following scenarios, each with its decision,
     execution status, handler call count and receipt:

     | Scenario | Expected |
     |---|---|
     | $75 | allowed, executes once |
     | $750 | pending approval, 0 calls |
     | $5,000 | denied, 0 calls |
     | unknown tool or policy | blocked, 0 calls |
     | context for another org | blocked, 0 calls |
     | forged `approvedBy: "ceo"` on $750 | still pending, 0 calls, flag recorded |
     | the $75 call replayed with the same idempotency key | 1 total call |
     | handler throws after starting | `outcome_unknown` |

4. **Integration tests** assert the handler call count for every case above:
   zero in every blocked case, exactly one for the allowed and replayed pair.
   Add them to the root `npm test`.
5. **Telemetry stays best-effort.** It is sent via `@ark/sdk`, and a telemetry
   failure never changes a decision or an execution. Telemetry success never
   counts as authorization.
6. **README** at `packages/guard/README.md` explains:
   - the enforcement boundary: only tools routed through `guardTool` are
     protected;
   - that an agent calling the side effect directly bypasses it;
   - that this is a simulation and not an approval workflow.

## How this will be proved

- **Artefact:** terminal output from `npm run demo:guard` and from the
  integration test run.
- **Measured by:**
  - **Before:** the same demo script is run against the unguarded handler (call
    the refund directly), showing $5,000 and the forged approval executing.
  - **After:** the same scenarios through `guardTool`.
- **Conditions:** temp libSQL database, Node 22, no network.

## Out of scope

- A human approval service or inbox.
- Real payments.
- A general MCP proxy or server.
- A2A.
- Control UI (that is PR-4).
- RBAC.

## Risk

Authorization boundary plus a new table. `agents/security-reviewer.md` must run,
and focus on bypass: identity from arguments, replay, and races on the
idempotency claim.

- **Rollback:** revert. The new table is unused by the old code.
