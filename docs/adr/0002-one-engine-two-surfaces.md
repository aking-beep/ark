# ADR-0002: One engine, two surfaces

**Status:** Accepted
**Date:** 2026-09-14

## Context

The consumer product asks six questions about one task. The business product asks around thirty across eight sections. They serve different people, render differently, and one of them has to be finishable on a phone in a minute.

The tempting implementation is two scoring implementations: a simple one for the wizard and a real one for teams. It is tempting because the consumer intake genuinely lacks most of the inputs the business rubric wants, and writing a small purpose-built scorer for six answers is an hour of work against the effort of making the full engine tolerate a mostly-empty `Workload`.

## Decision

One `assess()` function in `packages/core`, called by both surfaces. `ConsumerIntake` is widened to a full `Workload` by `fromConsumerIntake()`, which fills the unasked fields with explicitly conservative defaults.

`Depth` is a parameter (`'consumer' | 'business'`) that changes **how much is asked and how much is rendered**. It never changes how the system reasons. There is no branch anywhere in the scoring path that reads `depth` and takes a different rubric.

## Consequences

**Good.**

- One methodology to defend. When someone disputes a verdict, there is a single document and a single code path to point at.
- The consumer app becomes a genuine on-ramp rather than a weaker separate thing. A user who arrives at the business surface has already seen a basis tag and has already watched the tool decline to recommend AI at least once. That is a better qualification mechanism than a demo request form.
- A bug in the rubric is fixed once.
- The consumer surface gets the hard blockers for free. `not-ai` fires on six questions exactly as it does on thirty, which is the single most credibility-generating behaviour in the product and would have been the first thing cut from a "simple" scorer.

**Bad.**

- `fromConsumerIntake()` is a pile of defaults, and defaults are assumptions wearing a different hat. Mitigated by keeping them conservative in the direction of *less* confident: unknown volume is modest, unknown data sensitivity is not zero, unknown team capability is not high. A consumer verdict should be able to be wrong by being too cautious, never by being too encouraging.
- The consumer report must suppress sections it cannot honestly populate. The engine returns the full assessment object; the consumer view renders a fraction of it and hides cost entirely when the inputs to cost were never asked for.
- Any new required field on `Workload` is a change in two places at once.

## Alternatives considered

**Two scorers, shared constants.** Rejected: shared constants with divergent logic is the worst of both — it *looks* consistent and drifts silently. The constants would stay in sync and the verdicts would not.

**Consumer as a marketing page with a fake calculator.** Rejected on the grounds that it makes the entire provenance argument a lie at the first point of contact.

**One surface only, at business depth.** Rejected: thirty questions before any output is a wall, and the distribution advantage here is people meeting the system casually and arriving at the paid surface pre-educated.
