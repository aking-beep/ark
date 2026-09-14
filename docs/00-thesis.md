# Thesis

## The problem, stated precisely

There is no shortage of tools that will tell a company whether to use AI. They share a structural flaw: they are estimators with no path to ground truth. A user describes a workload, the tool multiplies some token counts by some published prices, and a number appears on screen with two decimal places and no indication that it is a guess.

The number is wrong, and it is wrong in a way that is predictable rather than random. Cost in an LLM system is dominated by two variables:

**Turns per outcome.** A single-shot classifier makes one call. A bounded agent makes seven in a benchmark and, routinely, nineteen in production — because real inputs are messier than test inputs, because tools fail and get retried, and because the model sometimes loops. Cost is roughly linear in turns, so a 2.7× error in this variable is a 2.7× error in the forecast.

**Context accumulation.** Turn seven does not cost what turn one cost. It carries the transcript of turns one through six. An agent with 900 tokens of context growth per turn and eight turns is paying for roughly 3.6× the input tokens a naive per-call model would predict. Tools that price "a call" and multiply by call count miss this entirely.

Neither variable can be known before the system runs. Both are measurable the moment it does.

## The consequence

If the two numbers that matter most cannot be estimated, then the correct product is not a better estimator. It is a measurement system with an estimator attached to it — and an estimator that is honest about which of the two it is being, on every figure, every time.

This inverts the intuitive build order. The instinct is to ship the assessment tool first, because it is the thing with a funnel, and add telemetry later as an enterprise upsell. That produces a product whose core claim is unfalsifiable at exactly the moment it most needs to be credible. ARK Control comes first because Control is what makes AIFit true. See [ADR-0001](adr/0001-control-before-aifit.md).

## What this system commits to

### 1. Every number carries its provenance

Four rungs — `heuristic`, `benchmark`, `calibrated`, `measured` — rendered by one component that no surface may skip. If a figure appears without a basis tag, that figure is lying by omission.

This is not a disclaimer. A disclaimer is a paragraph at the bottom that absolves the tool of everything above it. This is per-figure, inline, and it changes as the underlying evidence changes. The same cost estimate reads `heuristic` before Control is running and `measured` with a sample size of 881 after.

### 2. The engine can return "no"

`not-ai` is a first-class verdict. A workload composed only of `calculate` and `lookup` receives a recommendation for a rules engine and a scheduled job, with the LLM alternative explicitly rejected and the reasoning written down.

This costs conversions and it is the reason the rest of the report is worth reading. A tool that always says yes is a lead-generation form wearing a rubric.

### 3. Missing inputs produce missing outputs, not invented ones

If the user does not supply what the workload costs today, payback is reported as **unknowable**. The tool does not assume a default hourly rate, does not assume 100% displacement, and does not quietly model the current human process as error-free. A fabricated ROI is worse than no ROI, because a fabricated ROI survives being repeated in a board deck.

### 4. Cost is measured per successful outcome

Not per call, and not per thousand tokens. An outcome costs one attempt plus the expected cost of retries, divided by the success rate. For a single-shot classifier the difference is a few percent. For a bounded agent it is routinely forty. The gap is spend that produces nothing, and it is the line item every vendor calculator omits.

### 5. One engine, two surfaces

The consumer wizard and the business intake call the same `assess()` function. `Depth` changes how much is asked and how much is rendered — never how the system reasons. This means the B2C product is a genuine on-ramp rather than a weaker separate thing, and there is only ever one scoring methodology to defend. See [ADR-0002](adr/0002-one-engine-two-surfaces.md).

## What this system refuses to do

- **Predict accuracy.** Nobody can predict how accurate a model will be on data it has not seen. What the report gives instead is the threshold your stated error tolerance implies and the golden-set size required to measure it honestly.
- **Price your integration surface.** Build cost is a rubric estimate. It knows nothing about your procurement process or your security review queue, and those are frequently the long pole.
- **Model the portfolio.** One workload at a time. Shared retrieval infrastructure, an amortised platform team, and volume commitments are real effects and are not modelled here.
- **Keep your data.** Neither AIFit surface persists anything. Intake is encoded into the result link and recomputed on view.

These refusals are published on the methodology page inside the product, not buried in documentation, because a limitation the user cannot find is not a disclosure.

## Positioning

The distribution advantage is that most teams will meet this system through the consumer surface — one task, six questions, a minute — and arrive at the business surface already understanding what a basis tag means and already having seen the tool decline to recommend AI once. That is a far better qualification mechanism than a demo request form, and it is why the consumer app is not a marketing artifact but the same engine at a narrower aperture.

Control is where the relationship becomes durable. An estimate is consumed once. A system that measures what the estimate got wrong, every month, and re-labels the next estimate accordingly, is consumed continuously — and it is the only part of this that a competitor cannot replicate by copying a rubric.

## Non-goals

This is not an agent framework, not an observability platform competing with general APM, and not a model gateway. It touches telemetry only to the depth required to compute cost per outcome and detect the failure modes — runaway loops, off-allowlist providers, stale pricing, sensitive data in prompts — that cost money or cause incidents. Everything beyond that is somebody else's product.
