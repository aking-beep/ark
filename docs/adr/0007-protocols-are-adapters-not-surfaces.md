# ADR-0007: MCP, A2A, AG-UI, A2UI, UCP and AP2 are protocol adapters, not ARK product surfaces

**Status:** Accepted
**Date:** 2026-09-20

## Context

Production agents no longer just call models. They call tools over MCP,
delegate to peers over A2A, interrupt humans over AG-UI, ask trusted frontends
to render over A2UI, complete checkouts over UCP and authorise money over AP2.
Control could price the model calls and audit the side effects; it saw none of
the protocol traffic in between.

The operators who hit this are the ones who most need Control. Today they
either pipe raw protocol traffic into a general-purpose observability tool —
which turns that tool into a store of tool arguments, conversation text,
payment credentials and signed mandates — or they log nothing.

Two shapes were available. Treat each protocol as a thing ARK has a page, a
table and a route for. Or treat each protocol as a thing ARK *observes*, and
normalise all six into the grain Control already governs.

## Decision

Protocols are adapters. One new grain, one new table, one new page, one new
package.

- `packages/protocols` exports `mcpEvidence`, `a2aEvidence`, `agUiEvidence`,
  `a2uiEvidence`, `ucpEvidence`, `ap2Evidence`. Each takes a plain object the
  caller already has and returns one canonical `EvidenceObservation`. The
  package has no I/O, no network access and one dependency, `@ark/core`.
- `@ark/core` owns `EvidenceInput` — the canonical schema — and the dependency
  points one way only. `@ark/core` must never depend on `@ark/protocols`, or
  the canonical schema becomes a function of six external release cycles.
- Protocol evidence is a fourth grain in its own table, `protocol_evidence`,
  correlated to `events`, `actions` and `traces` by `trace_id`. It is not
  written to `events`.
- It arrives on the existing `POST /api/v1/events` as `evidence[]`, under the
  existing bearer auth, with the existing idempotency.
- Control gains one route, `/protocols`, built from existing `@ark/ui`
  primitives.
- No official protocol SDK is a dependency.

Each adapter file records the specification revision it was built against and
exports that protocol's vocabulary verbatim. The canonical schema shields
everything downstream from protocol version changes: when MCP rev'd from
`2025-11-25` to `2026-07-28` and removed five methods, the change that would be
needed is confined to `mcp.ts`.

## Consequences

**Good.** Adding a seventh protocol is one file and one entry in
`PROTOCOL_SPEC_VERSIONS` — not a table, a route, a dashboard, a seed and an
auth path. Every governance question is asked once across all six: one
`approval_missing` detection covers a missing AG-UI approval and a missing AP2
signature, because both normalise to `requiredApproval` with a null
`approvedBy`. One trace reads end to end across model cost, protocol chain and
side effects. And the security property is structural rather than procedural:
an adapter that builds its output from named fields has no path for a payload
to travel down, which is a stronger claim than a filter that removes one.

**Bad.** Normalisation loses protocol-specific nuance by construction. A
question that can only be answered from an A2A `Task.artifacts[]` or an AG-UI
`STATE_DELTA` cannot be answered from ARK, and should be asked of the system
that holds those. The `operation` string keeps each protocol's own vocabulary
precisely so that this loss is visible rather than smoothed over. Adapters also
lag: a protocol that rev's its method names ships a false `operationKnown:
false` until its file is updated, which is why unknown operations are recorded
and flagged rather than rejected.

## Alternatives considered

**Six product surfaces.** An MCP page, an A2A page, an AP2 page. Rejected: it
multiplies every cross-cutting concern by six — auth, tenancy, idempotency,
detection, empty states, seeds — and it makes the question an operator actually
has ("did anything in this refund happen without a human?") require six
lookups. It also gets monotonically worse, because protocols keep being
invented.

**One table per protocol.** Rejected for the same reason plus a concrete one:
`approval_missing` would be six near-identical queries that can drift, and the
Protocols page would be a six-way `UNION` whose columns are the canonical
schema anyway. If the union has to exist, the table should be the union.

**Fold protocol observations into `events`.** Rejected: `events` is the priced
grain. An MCP `tools/list` has no cost and no tokens, and putting it there
makes `SUM(cost_usd)` meaningless and `COUNT(*)` a number nobody can name. The
argument is the same one in [ADR-0004's neighbourhood](../03-data-model.md#the-distinction-the-whole-system-rests-on)
that keeps traces distinct from events.

**Depend on the official SDKs** (`@modelcontextprotocol/sdk`, `@a2a-js/sdk`,
`@ag-ui/core`). Rejected: ARK observes these protocols, it does not speak them,
so it needs their *vocabularies* and not their clients. Taking the dependency
would couple ARK's release cycle to six others, add six transitive trees to a
package whose whole job is to not carry data, and buy nothing — the observer
already has the decoded frame.

**Store the protocol object and normalise on read.** Rejected outright. It is
the sensitive-data lake this feature exists to prevent: an AP2 mandate is an
SD-JWT whose compact serialisation carries the cleartext of every selectively
disclosed field, and an MCP `CallToolResult` carries whatever the tool
returned. Normalising at the boundary means there is no table the payload could
be written to even by mistake.
