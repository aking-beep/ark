# ADR-0009: The wedge is approval and accountability for consequential agent actions

**Status:** Accepted — supersedes [ADR-0008](0008-what-is-sold.md) §1 ("What is sold") and §3 ("Why they choose it, and why they pay"). ADR-0008 §2 ("Who pays") and §4 ("What ARK still refuses to be") stand.
**Date:** 2026-10-19

## Context

ADR-0008 made Control's Observe loop the first invoice. Observe tells a buyer what a workload cost per successful outcome. It does not answer the question an agent with tools forces first: may this agent take this one consequential action — refund $750 on this order, for this org — now?

Nothing in ARK answered that. `policy.ts` evaluates an Agent Manifest's posture (approved models, policy refs, logging). `enforce.ts` gates model calls inside `@ark/runtime`, and `unknown` passes it. A manifest `pass` is a statement about configuration, not authorization to move money, and treating it as one is how an agent ends up refunding whatever it was asked to.

The founder has chosen this question as the wedge.

## Decision

**1. What is sold.** Approval and accountability for consequential AI-agent tool actions, enforced by an opt-in, in-process guard at a trusted tool boundary. The guard asks a deterministic decision kernel (`decideAction` in `@ark/core`), which returns `allow`, `deny`, `require_approval` or `unknown` for one typed action request against the org's versioned policy. A protected action runs only on an explicit `allow`. Every decision carries a deterministic id, the policy id and version it was made under, a closed reason code and a digest of the request, so who allowed what, under which rule, is answerable afterwards. The decision id is a deterministic content hash (of the request, the governing policies' contents and the expiry), not an unforgeable token: anyone who knows the inputs can compute it. Any future approval or execution credential must be a separate signed, single-use credential bound to the expiry — never the decision id.

**2. Request path.** The guard runs in the customer's process, next to the tool it protects. Control's HTTP service stays out of the request path: no tool call waits on a network round trip to ARK, and ARK being down cannot authorize anything. ADR-0008's refusal "Control does not sit in the live request path" is unchanged.

**3. Why they pay.** Because an agent that can move money, delete data or message customers needs a decision that is explicit, fail-closed and replayable — not a dashboard that shows afterwards what it did. Observe becomes the supporting loop: it measures what the guarded actions cost and how often they were approved, denied or escalated. It is not what the first invoice is for.

**4. Refusals that still bind.** Everything in ADR-0008 §4 holds. In particular:

- not a model gateway;
- not an agent framework;
- not general APM;
- no prompt or payload storage;
- no invented ROI.

The guard is not a general MCP proxy. It sits at the specific tool boundaries a customer opts in, over typed requests built from trusted server context — not over arbitrary protocol traffic.

## Consequences

**Good.** One unit for pilots: a named consequential action, its policy, and the decisions made under it. The kernel is pure and synchronous, so it can be tested exhaustively and replayed from the digest. The refund thresholds it ships with (`DEMO_REFUND_POLICY`: ≤ $100 allow, ≤ $1,000 require approval, above that deny) are **synthetic demo values, not production defaults**; an org's real limits are its own policy.

**Bad.** At the time of this ADR only the kernel exists. There is no guard, no approval service, no approval UI and no persistence of decisions, and nothing calls the kernel. Willingness to pay for this is a hypothesis until a customer puts one real action behind it.

**Neutral.** ADR-0008's text stays as written; this record supersedes two of its sections rather than editing them. `policy.ts` and `enforce.ts` keep their current semantics.

## Alternatives considered

**Keep Observe as the wedge (ADR-0008).** Superseded. It measures cost after the fact and does not stop a bad action.

**Put Control's service in the request path as an authorization server.** Rejected. It makes ARK's uptime part of every tool call and breaks a binding refusal.

**A general MCP proxy that intercepts all tool traffic.** Rejected. It drifts into gateway territory and payload handling, both refused.
