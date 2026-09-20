# protocol-evidence-plane

**Status:** APPROVED
**Approved by:** repository owner (mission brief: "Evolve ARK Control from primarily AI cost/telemetry governance into the evidence and control plane for production AI systems"; 2026-09-20)
**Date:** 2026-09-20

## Problem

ARK Control can answer "what did this model call cost" and "what did the agent
do in the real world" (`events`, `actions`). It cannot answer anything about the
**protocols** production agents now speak to each other and to their surfaces.

A support agent that calls a CRM over MCP, delegates to a refund agent over A2A,
asks a human to approve over AG-UI, renders a confirmation over A2UI, completes
a checkout over UCP and authorises the money over AP2 produces, today, exactly
one thing in Control: a row of model calls and a cost. The six most
governance-relevant facts about that trace — which tool was called, which agent
was delegated to, whether a human approved, how much money was authorised, and
whether any of it was blocked — are invisible.

The operators who hit this are the ones who most need Control: anyone running
agents that touch other systems. Today they either log raw protocol traffic into
a general-purpose observability tool (which turns that tool into a store of tool
arguments, conversation text, payment credentials and signed mandates) or they
log nothing.

## Outcome

An operator can post protocol observations from MCP, A2A, AG-UI, A2UI, UCP and
AP2 through the same ingest endpoint and the same trace id their model telemetry
already uses, and see on `/protocols` which protocols are active, what operations
ran, where humans intervened, which required approvals are missing, and how much
financial value was acted on — without ARK ever storing a tool argument, a
message body, a rendered data model or a payment credential.

## Acceptance criteria

1. **A canonical evidence grain exists and is not the model-event grain.**
   `@ark/core` exports `EvidenceInput` with the fields `id, traceId?,
   workloadId?, ts?, protocol, protocolVersion?, kind, operation, actor?,
   target?, outcome, latencyMs?, valueUsd?, currency?, requiredApproval,
   approvedBy?, risk, evidenceRef?, metadata`. `protocol` is one of
   `mcp|a2a|ag-ui|a2ui|ucp|ap2`. `metadata` accepts scalars only (string, finite
   number, boolean), at most 32 keys, string values at most 200 characters; a
   nested object or array is a parse error. A new `protocol_evidence` table
   carries it, in **both** the Drizzle schema and the plain DDL, with indexes on
   `(org_id, ts)`, `(protocol, ts)`, `(trace_id)` and `(workload_id, ts)`. No
   protocol observation is written to `events`.

2. **`@ark/protocols` normalises the six protocols and cannot carry a payload.**
   A new workspace package `packages/protocols` exports `mcpEvidence`,
   `a2aEvidence`, `agUiEvidence`, `a2uiEvidence`, `ucpEvidence`, `ap2Evidence`,
   each returning an `EvidenceObservation`. Each adapter builds its output from
   an explicit allowlist of safe fields, so a caller who passes `arguments`,
   `content`, `messages`, `signature`, `credential` or any other payload key
   (in JavaScript, where the type cannot stop them) gets evidence that does not
   contain the value anywhere in its serialisation. Each adapter file records
   the exact specification version it was built against, and exports the
   protocol's official operation vocabulary verbatim. `@ark/protocols` depends
   on `@ark/core`; `@ark/core` does not depend on `@ark/protocols`.

3. **Redaction is enforced at the ARK boundary, not only in the adapters.**
   `@ark/core` exports `redactEvidence`, which drops metadata entries whose key
   is on a payload/credential denylist and metadata entries whose value trips
   the existing sensitive-data detectors. The SDK applies it before the POST
   (so the value need never leave the caller's process) and `applyIngest`
   applies it again before the INSERT. Ingest reports what class of thing was
   redacted, never the value.

4. **Ingest accepts evidence, idempotently, under the existing auth.**
   `POST /api/v1/events` accepts an `evidence[]` array alongside `events[]`,
   `traces[]`, `actions[]` and `qualitySamples[]`; a body containing only
   `evidence` parses and is accepted. Re-posting the same evidence `id` is a
   no-op. The bearer token's org stays authoritative — an `orgId` in the body
   that disagrees is still a 403, and no field in the evidence payload can name
   another org. `GET /api/v1/events` documents an evidence example.

5. **`approval_missing` fires on completed, unapproved, required-approval
   operations and not on pending ones.** A new `approval_missing` alert kind
   fires when `requiredApproval` is true, `approvedBy` is null, and the
   operation completed successfully (`outcome` of `ok` or `approved`). Severity
   is `critical` for `risk` of `high` or `critical`, `warn` for `medium`, `info`
   for `low`. It does **not** fire on `pending`, `error`, `blocked` or `denied`.
   The alert id is derived from the evidence id, so re-posting does not duplicate
   it.

6. **The SDK correlates evidence to the same trace.** `TraceHandle` gains
   `evidence(...)` beside `event()`, `action()`, `qualitySample()` and `close()`.
   Evidence recorded on a trace is posted with that trace's `traceId` and the
   handle's `workloadId` unless the caller overrides the workload.

7. **Control has a Protocols page that answers the governance questions.** A
   `Protocols` nav item routes to `/protocols`, built from existing `@ark/ui`
   primitives with no new design system. It shows four headline metrics
   (protocol events, blocked/denied, missing approvals, value acted on), one
   card per protocol with its own totals (events, distinct operations, errors,
   blocked, approvals required, missing approvals, value, latency), and a recent
   evidence table with columns Protocol, Operation, Actor → Target, Outcome,
   Approval, Value, Time. An org with no evidence gets an empty state, not a
   crash.

8. **One trace reads end to end across grains.** `/workloads/[id]` renders a
   single real trace from that workload as an ordered story — model calls with
   their cost, protocol evidence, actions, and the trace outcome — correlated by
   trace id, with each grain still stored in its own table.

9. **Seeded demo data demonstrates the governance case.** `npm run db:seed`
   produces protocol evidence for all six protocols on Demo Co, including a
   successful MCP tool call and a failed one, an A2A delegation, an AG-UI
   approval requested and granted, an A2UI render, a UCP checkout, an approved
   AP2 payment mandate, and one deliberately unapproved AP2 mandate that makes
   `approval_missing` visible on the dashboard. No network call and no real
   payment is involved.

10. **Nothing that worked stops working.** `npm run typecheck`, `npm run test`
    and `npm run build` pass. Every pre-existing test still passes unmodified.
    Spend, Workloads, Optimise, Budgets & alerts and Calibration still render.
    Runtime is still a library, not an app.

## How this will be proved

The station is this cloud container (`factory/05-CLOUD.md`).

- **Artefact:** terminal output from `node evidence/protocol-evidence-plane/probe.mjs`,
  run before any edit and again after, plus 1440×900 screenshots of the Control
  pages.
- **Measured by:** the probe builds a temporary SQLite database from the repo's
  own `DDL`, runs `applyIngest` against it, and prints a fixed set of counters:
  whether a `protocol_evidence` table exists, whether an evidence-only body
  parses, whether a duplicate evidence id is a no-op, whether the MCP/A2UI
  adapters leak a payload string, whether `approval_missing` fires on a completed
  unapproved operation and stays silent on a pending one, whether two orgs' rows
  are separated, and the counts of the pre-existing event/action/quality
  behaviour. Before the change every protocol line reads `ABSENT`; after it they
  read the measured values, and the pre-existing counters are identical.
  Screenshots: `/protocols` and `/workloads/[id]` at 1440×900 on the seeded Demo
  Co org, before (404 / no panel) and after.
- **Conditions:** Node 22, compiled packages, the repo's own seed, Chromium at
  1440×900, no network access required by the probe.

## Out of scope

- Executing anything. No MCP tool is called, no A2A task is submitted, no UI is
  rendered, no checkout is completed, no payment is made, no credential is
  stored. `@ark/protocols` is a normaliser with no I/O.
- Adding official protocol SDKs as dependencies. The adapters take plain objects
  the caller already has; pulling `@modelcontextprotocol/sdk`, `@a2a-js/sdk` or
  `@ag-ui/core` into ARK would couple ARK's release cycle to six others.
- Six dashboards, six tables, six routes, six apps. One table, one route, one
  package.
- The future detections named in the brief — `protocol_denied`,
  `high_risk_tool`, `agent_delegation_loop`, `commerce_limit`, `payment_limit`.
  The schema carries the columns they would read (`outcome`, `risk`, `actor`,
  `target`, `value_usd`); the detections themselves are a separate feature.
- Currency conversion. `valueUsd` is populated only when the observed currency
  is USD; converting at ingest would turn an observation into an estimate.
- Changing anything about model telemetry, calibration, budgets, or MY AI.

## Risk

This feature's entire risk is that it becomes the sensitive-data lake it exists
to prevent. Mitigations, in order of strength: adapters construct metadata from
an allowlist rather than filtering a denylist, so a payload field has no path
into the output; `EvidenceInput` rejects non-scalar metadata at the schema
boundary; `redactEvidence` runs in the SDK before the POST and again in ingest
before the INSERT; the `protocol_evidence` table has no column a body could be
written to. Tests assert the absence of the payload string in the serialised
output for MCP and A2UI specifically, because those two carry the worst of it
(tool arguments and the rendered data model).

No new runtime dependency. No new external call. No change to authentication:
the bearer token's org remains authoritative for evidence exactly as it is for
events.

- **Rollback:** revert the branch. The `protocol_evidence` table is additive and
  unreferenced by any existing query; leaving it behind is harmless, and
  `npm run db:push` is idempotent.
