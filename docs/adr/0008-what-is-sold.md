# ADR-0008: The first invoice is Control's Observe loop

**Status:** Accepted
**Date:** 2026-10-15

## Context

ARK ships three products — AI Fit, AI Fit Teams and ARK Control — and Control's roadmap reads Discover → Register → Assure → Observe → Govern → Enforce. With that much surface it is easy to sell the wrong thing first: a quiz with no path to money, a planning document that is consumed once, or an agent inventory that a dozen vendors already demo. A founder grill (round 1, root commercial decisions) settled four questions so they stop being re-litigated deal by deal.

## Decision

**1. What is sold.** The commercial unit is ARK Control's Observe loop: ingest → cost per successful outcome → drift → calibration served back into AI Fit Teams. Teams is included as the estimator that loop calibrates. AI Fit is not in the contract. Discover, Register and Assure ship inside Control but are not what the first invoice is for, and Assurance is not a fourth product.

**2. Who pays.** An engineering-led company of roughly 15–150 people that already has — or is weeks from — a production LLM or agent workload with a named API or inference bill, and one person who gets asked why that line moved. The 3–15 person team in the [Teams PRD](../prd/aifit-business.md) is the *user* of the estimator, not the buyer of the control plane: a shop with no production traces cannot clear the 30-trace floor and will never see `measured`. Not consumers choosing a chat app. Not the Fortune 500 as the first design centre.

**3. Why they choose it, and why they pay.** They choose ARK because every figure says whether it is `heuristic`, `benchmark`, `calibrated` or `measured`, and because the engine can return `not-ai`. They pay because next month's number is cost per successful outcome with a sample size, and the drift page shows what the estimate got wrong. They do not pay for a more confident PDF. A buyer who wants a board slide that looks certain is out of the ideal customer profile.

**4. What ARK still refuses to be.** The published non-goals are binding for any paid pilot:

- not an agent framework;
- not a model gateway;
- not general APM;
- Control does not sit in the live request path;
- no accuracy prediction;
- no portfolio modelling;
- no invented ROI;
- no prompt or payload storage;
- no AI Fit → Teams funnel.

Lifting one of these to win a logo is a stop condition, not a deal.

## Consequences

**Good.** Pilot scope, pricing conversations and roadmap triage all start from the same unit: one instrumented production workload whose cost per outcome is measured and whose estimate drift is visible. Work that does not shorten the path to that number — or keep a figure from being mislabelled on the way there — waits.

**Bad.** The phase-2 exit in the [roadmap](../04-roadmap.md) is still unmet: no customer outside this repository has instrumented production. Until one does, every claim in this ADR about willingness to pay is a hypothesis, and the [roadmap's kill criterion](../04-roadmap.md) (instrumenting a real workload must take less than a day of a customer engineer's time) is the test that decides it.

**Neutral.** AI Fit stays a separate personal product. It is not a lead source, and nothing in Teams or Control links to it.

## Alternatives considered

**Sell Teams reports.** Rejected. An estimate is consumed once and cannot manufacture `measured`.

**Lead with Assurance or the agent inventory.** Rejected as the wedge. It is crowded, it needs no telemetry to demo, and it does not exercise the thing only ARK does — promote a figure from a guess to a measurement and say so on screen.

**Use AI Fit as a funnel into Teams.** Rejected. The products serve different people, and a funnel would pressure the quiz to recommend AI.
