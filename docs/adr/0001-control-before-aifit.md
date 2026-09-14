# ADR-0001: Build Control before AIFit

**Status:** Accepted
**Date:** 2026-09-14

## Context

The obvious build order is AIFit first. It is the surface with a funnel, it demos in ninety seconds, and it requires no customer to already be running anything. Telemetry is the classic "phase two, enterprise tier" item — the thing you add once there is revenue to justify it.

Every tool in this category has made that choice. The result is a category of products that emit confident cost figures derived entirely from published token prices and an assumed call shape.

The assumed call shape is the problem. Cost in an LLM system is dominated by two variables:

- **Turns per outcome.** Roughly linear in cost. A bounded agent benchmarks at seven and routinely runs nineteen in production.
- **Context accumulation.** Turn seven carries the transcript of turns one through six. At 900 tokens of growth per turn across eight turns, input tokens are roughly 3.6× what a per-call model predicts.

Neither can be known before the system runs. Both are trivially measurable the moment it does.

So an estimator built without a measurement system is not slightly imprecise. It is confidently wrong about the two things that matter most, in the direction that makes the product look good, and it has no mechanism that would ever tell it so.

## Decision

Build ARK Control first. Ship AIFit against the rubric priors, labelled `heuristic`, and let Control promote them to `measured` as telemetry arrives.

Concretely: the seeded demo telemetry in this repo puts observed bounded-agent turns at 8.25 against a rubric prior of 7. That is an 18% cost error on synthetic data generated to be well-behaved. Real traffic is worse.

## Consequences

**Good.**

- The provenance ladder has somewhere to go. `heuristic → measured` is a real state transition backed by a real endpoint, not a marketing gradient.
- The drift page exists. `/workloads/[id]` renders predicted against observed, which means the rubric is continuously audited by the product rather than by nobody.
- It is the defensible part. A competitor can copy a rubric in an afternoon. They cannot copy a corpus of traces.
- Retention inverts. An estimate is consumed once; a system that re-labels last quarter's estimate every month is consumed continuously.

**Bad.**

- Slower to first demo. Control requires a database, an ingest contract, and a pricing engine before anything is visible.
- Control has no funnel of its own. It is sold to people already running something, which is a narrower door than "answer six questions."
- The calibration path is the harder path to test and it is the one most users will never exercise, so it is the one most likely to rot. Mitigated by making the uncalibrated path the default and the tested path.

## Alternatives considered

**AIFit first, Control as an upsell.** Rejected: it produces a product whose central claim is unfalsifiable at precisely the moment it most needs to be credible — in front of someone deciding whether to spend money on it.

**Publish benchmark call shapes and skip measurement entirely.** Rejected: benchmark call shapes are drawn from clean inputs. The gap between benchmark and production *is* the thing being sold.

**Measure but don't estimate — pure observability.** Rejected as a different product. General APM already covers it, and the decision a team needs help with happens before there is anything to observe.
