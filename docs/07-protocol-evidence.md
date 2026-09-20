# Protocol evidence

ARK Control could answer two questions about a production agent: what did the
model calls cost, and what did the agent do in the world. It could not answer
anything about the **protocols** agents now speak to each other and to their
surfaces.

A support agent that calls a CRM over MCP, delegates to a refund agent over
A2A, asks a human to approve over AG-UI, renders a confirmation over A2UI,
completes a checkout over UCP and authorises the money over AP2 used to produce
exactly one thing in Control: a row of model calls and a cost. The six most
governance-relevant facts about that trace were invisible.

This document is why the fix is a *fourth grain* and an *adapter package*
rather than six new features.

## Protocols are adapters, not surfaces

The tempting shape is an MCP page, an A2A page, an AP2 page. It is the wrong
shape and it gets worse with every protocol added. The decision and the
alternatives are in [ADR-0007](adr/0007-protocols-are-adapters-not-surfaces.md).
The summary:

```
MCP  A2A  AG-UI  A2UI  UCP  AP2
              │
              ▼
       @ark/protocols          normalise + redact
              │
              ▼
         @ark/sdk              the same ARK trace
              │
              ▼
    POST /api/v1/events        events · traces · actions · quality · evidence
              │
              ▼
        ARK CONTROL            cost · policy · evidence → audit
```

One table, one route, one package, one SDK, one auth path. Six adapter files
totalling a few hundred lines each, which is the only part that has to change
when a protocol revs.

## The four grains

| Grain | Table | One row is | Counted as |
|---|---|---|---|
| Trace | `traces` | one unit of business work | the denominator of every cost figure |
| Model event | `events` | one model/provider call | priced |
| Action | `actions` | one external side effect | governed for blast radius |
| Protocol evidence | `protocol_evidence` | one normalised protocol observation | governed for approval, value and outcome |

They are deliberately not merged. Folding protocol observations into `events`
would make `SUM(cost_usd)` meaningless — an MCP `tools/list` has no cost — and
`COUNT(*)` a number nobody could name. They are correlated by `trace_id`, which
is what `/workloads/[id]` reads to render one unit of work end to end:

```
TRACE     tr_1404
MODEL     claude-sonnet-5           5 calls · $0.0269
MCP       tools/call:search_customer  support-agent → crm-mcp · 84ms
A2A       delegate                  support-agent → refund-agent
AG-UI     approval.requested        refund-agent → support-console · awaiting
AG-UI     approval.approved         refund-agent → support-console · user_12
A2UI      createSurface             refund-agent → refund_confirm_829
UCP       complete_checkout         support-agent → merchant.example · $89.50
AP2       payment_mandate           support-agent → merchant.example · $89.50 · user_12
ACTION    Issue refund              Stripe · reversible · $89.50
OUTCOME   success
```

Four tables. One trace id. Each still countable on its own terms.

## The canonical evidence model

`@ark/core` exports `EvidenceInput`:

| Field | Notes |
|---|---|
| `id` | Idempotency key. Re-posting is a no-op. |
| `traceId?`, `workloadId?`, `ts?` | Correlation. The SDK fills the first two from the trace handle. |
| `protocol` | `mcp \| a2a \| ag-ui \| a2ui \| ucp \| ap2` |
| `protocolVersion?` | The *protocol's* version string, verbatim. Never ARK's. |
| `kind` | `tool \| resource \| prompt \| discovery \| delegation \| task \| human_input \| approval \| ui \| commerce \| payment \| receipt \| other` |
| `operation` | The operation in the protocol's own vocabulary, e.g. `tools/call:search_customer` |
| `actor?`, `target?` | Who acted, and on what. |
| `outcome` | `ok \| error \| blocked \| pending \| approved \| denied` |
| `latencyMs?` | |
| `valueUsd?`, `currency?` | `valueUsd` is populated only when the observation was in USD. |
| `requiredApproval`, `approvedBy?` | What `approval_missing` reads. `approvedBy` is nullable on purpose. |
| `risk` | `low \| medium \| high \| critical`. Sets alert severity. |
| `evidenceRef?` | A pointer into the system of record — a task id, a mandate id, a receipt id. Never the object. |
| `metadata` | Scalars only. At most 32 keys, string values at most 200 characters. |

`pending` is the load-bearing outcome. Without it, an approval that has been
requested and not yet answered is indistinguishable from one that completed
with nobody signing, and the missing-approval detection would fire on every
in-flight request.

`valueUsd` is never converted. An amount observed in EUR is stored with
`currency: 'EUR'` and its raw amount in metadata, and the Protocols page says
how many observations it excluded from the USD total. Converting at ingest
would turn an observation into an estimate, and the dashboard could not then
tell you which of the two it was showing.

## Redaction: three layers, and none of them is a promise

The entire risk of this feature is that ARK becomes the sensitive-data lake it
exists to prevent. ARK must never store prompt bodies, MCP tool arguments, MCP
resource bodies, A2A message bodies, AG-UI conversation text, A2UI data models,
UCP checkout payloads, AP2 signed mandates or signatures, card numbers, CVVs,
bank credentials, OAuth tokens, JWTs, API keys, cookies, passwords or private
keys.

Three layers enforce it, in order of strength.

**1. The adapters have no field for it.** Every function in `@ark/protocols`
takes a typed observation with named, safe fields and builds its output key by
key through `compose`, rather than spreading its input. There is no
`arguments`, no `content`, no `messages`, no `dataModel`, no `signature`, no
`payment_instrument`. A JavaScript caller can pass one — TypeScript is not a
runtime — and it goes nowhere, because nothing reads it. This is the strongest
layer because it is structural: there is no path, not a filter on a path.

```ts
mcpEvidence({
  method: 'tools/call', name: 'search_customer', server: 'crm-mcp',
  arguments: { customerEmail: 'person@example.com' },   // inert
});
// → { protocol: 'mcp', kind: 'tool', operation: 'tools/call:search_customer',
//     target: 'crm-mcp', outcome: 'ok', metadata: { method, transport, methodKnown } }
```

**2. The schema admits scalars only.** `EvidenceInput.metadata` is
`Record<string, string | number | boolean>` with a 32-key cap and a 200-character
value cap. A nested object or an array is a parse error, not a flattening —
flattening is how a tool-argument blob arrives one key at a time.

**3. `redactEvidence` runs on both sides of the wire.** It drops metadata whose
*key* names a payload or a credential, and metadata whose *value* trips the
sensitive-data detectors ARK already uses on prompt samples — which catches an
innocently named `stepName` carrying an email address. The SDK runs it before
the POST, so the value need never leave the caller's process, and `applyIngest`
runs it again before the `INSERT`, which is the last place a hand-rolled POST
can still be stopped.

When ingest has to redact, it raises a `sensitive_data` alert against the
observation that carried the field. The alert says how many fields were dropped
and what *class* each fell into — a payload name, a nested value, or one of the
detector labels — and that vocabulary is fixed in ARK's own code.

It does not repeat the key. A metadata key is caller free text of up to 64
characters and can be the sensitive value itself: `bob@example.com_token` is a
key name and an email address at once. A control that logs the payload it found
in order to warn you about the payload is not a control, and that holds for the
name as much as the value. The key names go back to the sender in the ingest
response under `evidenceRedacted`, which is not stored anywhere.

None of the three layers is a promise, and the first is the only one that is
structural. A denylist catches the names it knows; the scalar cap stops a shape,
not a string; only the adapters, which build their output from named fields
rather than by spreading the caller's input, give a payload no path at all.
Normalise with `@ark/protocols` and the other two layers are a backstop rather
than the defence.

For cryptographic protocols, the rule is the same one the rest of the system
follows: store the *reference*, not the object. An AP2 mandate is an SD-JWT
whose whole point is that the compact serialisation carries the cleartext of
every selectively disclosed field. `evidenceRef: 'mandate_829'` is a pointer
into the credential store that already holds it and is built to.

## The detection

`approval_missing` fires when all three hold:

- `requiredApproval` is true, **and**
- `approvedBy` is null, **and**
- `outcome` is `ok` or `approved` — the operation ran to completion.

It does **not** fire on `pending`, `error`, `blocked` or `denied`. An approval
in flight is the system working; the other three mean nothing happened, so
nothing needed approving. Severity follows the recorded `risk`: `critical` for
high and critical, `warn` for medium, `info` for low. The alert id is derived
from the evidence id, so re-posting the observation does not accumulate alerts.

This is the same shape as `unapproved_action` on the actions table, for the
same reason.

The columns a future `protocol_denied`, `high_risk_tool`,
`agent_delegation_loop`, `commerce_limit` or `payment_limit` would read —
`outcome`, `risk`, `actor`, `target`, `value_usd` — are all present. Those
detections are deliberately not built yet.

## The six adapters

Each adapter file records the exact specification revision it was built
against and exports that protocol's official vocabulary verbatim, so a reader
can check it against the spec without reading the code. `PROTOCOL_SPEC_VERSIONS`
collects them and the Protocols page renders them beside the counts.

| Protocol | Spec built against | Governance | What ARK takes |
|---|---|---|---|
| MCP | revision **2026-07-28** (legacy **2025-11-25** recognised) | Model Context Protocol | method, tool/resource/prompt *name*, client, server, transport, latency, `isError` |
| A2A | **1.0** (legacy **0.3** recognised) | Agentic AI Foundation, Linux Foundation | method, calling agent, peer agent, task id, task state, binding, artefact count |
| AG-UI | **1.0** | AG-UI project | event type, agent, surface, run/thread id, tool name, time to approval |
| A2UI | **0.9.1** (1.0 candidate recognised) | A2UI project | operation, surface id, catalog, component *type* vocabulary, component count, policy decision |
| UCP | **2026-08-25** | UCP council (Google, Shopify, Stripe) | operation, agent, merchant, checkout/order reference, capability, transport, amount, status |
| AP2 | **v0.2** | Google, donated to the FIDO Alliance | operation, mandate type, mandate/receipt reference, agent, merchant, amount, human-presence mode, status |

Notes a reader will want:

- **MCP 2026-07-28 removed methods.** `initialize`, `ping`, `logging/setLevel`,
  `resources/subscribe` and `resources/unsubscribe` are gone. A fleet upgrades
  one server at a time, so both vocabularies are recognised; an observation of
  a legacy-only method records `2025-11-25`, because saying `2026-07-28` would
  be a lie about the peer.
- **A2A 1.0 renamed every method** to PascalCase (`SendMessage`, not
  `message/send`) and moved task states to `TASK_STATE_*`. Both are recognised.
  A2A has no `Delegate` RPC — delegation is a `SendMessage` that opens a task
  on a peer — so `delegate` and `discover` are *ARK's* names for the
  relationship, and `operationKnown` says which vocabulary an operation came
  from.
- **AG-UI 1.0 has no human-in-the-loop event type.** It models the pattern as
  an interrupt layered on the tool-call events. ARK names the pattern itself:
  `approval.requested`, `approval.approved`, `approval.denied`,
  `human_input.*`, `tool.*`, `interrupt.*`. These are lower-case and dotted so
  they can never be mistaken for AG-UI's `SCREAMING_SNAKE` event types, and
  `metadata.operationSource` records `ag-ui` or `ark` on every row.
- **UCP is not ACP.** The Agentic Commerce Protocol is a separate, competing
  specification from OpenAI and Stripe, also on date-based versions. A bare
  date string is ambiguous between them, which is why the `protocol` column
  says `ucp`.
- **AP2 v0.2** replaced the v0.1 Intent and Cart mandates with the Checkout
  Mandate and the Payment Mandate.

None of the official SDKs is a dependency. The adapters take plain objects the
caller already has. Pulling `@modelcontextprotocol/sdk`, `@a2a-js/sdk` and
`@ag-ui/core` into ARK would couple ARK's release cycle to six others, and the
canonical schema exists precisely to shield the rest of the product from
protocol version changes.

`@ark/protocols` depends on `@ark/core`. `@ark/core` does not depend on
`@ark/protocols`, and must not: that would make the canonical schema a function
of six external release cycles.

## Developer usage

Evidence goes on the trace it happened in:

```ts
import { ArkIngest } from '@ark/sdk';
import { mcpEvidence, a2aEvidence, agUiEvidence, ap2Evidence } from '@ark/protocols';

const ark = new ArkIngest({ baseUrl: process.env.ARK_CONTROL_URL!, token: process.env.ARK_CONTROL_TOKEN });
const trace = ark.trace('wl_support_triage');

trace.event({ provider: 'anthropic', modelId: 'claude-haiku-4.5', inputTokens: 2400, outputTokens: 180 });

trace.evidence(mcpEvidence({
  method: 'tools/call', name: 'search_customer',
  client: 'support-agent', server: 'crm-mcp', transport: 'streamable-http', latencyMs: 84,
}));

trace.evidence(a2aEvidence({
  operation: 'delegate', agent: 'support-agent', peerAgent: 'refund-agent',
  taskId: 'task_829', taskState: 'TASK_STATE_COMPLETED',
}));

trace.evidence(agUiEvidence({
  eventType: 'approval.approved', agent: 'refund-agent', surface: 'support-console',
  approvedBy: 'user_12', timeToApprovalMs: 84_000,
}));

trace.evidence(ap2Evidence({
  operation: 'payment_mandate', agent: 'support-agent', merchant: 'merchant.example',
  mandateRef: 'mandate_829', amount: 89.5, currency: 'USD', presence: 'direct',
  approvedBy: 'user_12',
}));

await trace.close('success');
```

`trace.evidence()` assigns the id, the trace id and the workload, and redacts
metadata before the POST. Everything lands on one trace id in three tables.

Posting straight to the API works too — `evidence[]` alongside `events[]`,
`traces[]`, `actions[]` and `qualitySamples[]`, under the same bearer token,
with the same idempotency. `GET /api/v1/events` documents the shape. The
bearer token's org stays authoritative; no field in an evidence payload can
name another org.

## Where to look in Control

**`/protocols`** answers: which protocols are active, what operations ran,
where humans intervened, which required approvals are missing, how much value
was acted on, and what failed or was blocked. Four headline metrics, one card
per protocol with its own totals and the spec revision its adapter targets, and
a recent evidence table.

"Value acted on" is counted **once per unit of work**. A single $89.50 refund
appears as a UCP checkout completion, an AP2 payment mandate and an AP2 payment
receipt — three true observations of one amount. So the figure for a trace is
the largest amount any single operation in it acted on, and those are summed.
The trade is explicit: a trace that genuinely made two separate purchases
reports the larger. Under-reporting a rare case beats over-reporting every case
by the number of protocols that witnessed it.

**`/workloads/[id]`** renders the trace in that workload crossing the most
protocols as one story across all four grains. A trace with one protocol on it
demonstrates nothing the rollup did not already say.

## What this is not

`@ark/protocols` executes nothing. It calls no MCP tool, submits no A2A task,
renders no UI, completes no checkout and moves no money. It has no I/O and no
network access. UCP and AP2 here are control-plane observability and
governance — schemas, normalisation, ingestion, detection, fixtures, tests and
dashboard evidence. There are no payment credentials anywhere in this repo and
nothing in it can send money.
