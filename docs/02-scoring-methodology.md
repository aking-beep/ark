# Scoring methodology

This document is the rubric, not a summary of it. It exists so that a user who disagrees with a verdict can find the exact assumption they disagree with and name it. A scoring tool that will not show its rubric is asking to be trusted on charisma.

The product surfaces an abbreviated version of this at `/methodology` in the business app.

## Provenance

Four rungs, ordered:

| Basis | Source | Can it contradict the rubric? |
|---|---|---|
| `heuristic` | The rubric itself | — |
| `benchmark` | Published: list prices, context windows, third-party benchmarks | No |
| `calibrated` | Measurements from comparable systems, not yours | No |
| `measured` | Your telemetry, above the sample floor | Yes |

`weakestBasis()` walks every estimate contributing to a report and returns the lowest rung found. The report's overall trust caveat is written from that rung, on the principle that a chain of reasoning is exactly as sound as its worst input — a `measured` cost figure multiplied by a `heuristic` displacement assumption yields a `heuristic` ROI, and saying otherwise would be laundering.

**Sample floor: 30 traces per pattern.** Below it, `resolveCallShape` returns the rubric prior and states the observed count in its `source` string, so the report can say "only 11 observations for bounded-agent, below the 30 needed to trust them" rather than silently using them or silently ignoring them.

## Suitability: seven weighted dimensions

| Dimension | Weight | What drives it |
|---|---|---|
| Task fit | 0.22 | Selected task shapes. `calculate`/`lookup` alone → near zero and a hard blocker. Linguistic or judgement work → high. |
| Determinism demand | 0.18 | `exact` is the strongest single negative signal in the rubric. |
| Error tolerance | 0.15 | Cost of a wrong answer, adjusted by whether anyone would notice. |
| Volume | 0.15 | Units per month against build cost. |
| Data sensitivity | 0.12 | Data classes in scope and the regimes they trigger. |
| Action risk | 0.10 | Write access × blast radius. |
| Team readiness | 0.08 | Engineers, prior ML operations experience, security review, out-of-hours coverage. |

### Why the weighted average is not the whole answer

A pure weighted average lets a high volume score paper over a workload that must be exactly right. It does not get to. Certain conditions are **hard blockers** that cap the verdict regardless of total score:

- Every selected task shape is deterministic → verdict is `not-ai`, full stop.
- Zero error tolerance combined with "nobody would notice if it were subtly wrong" → capped at `assisted`.
- An irreversible action combined with `full` autonomy → capped, with the combination named as the blocker.
- No out-of-hours coverage → autonomous patterns are removed from consideration before scoring.

Blockers are listed by name in the report. A capped verdict with no explanation would be indistinguishable from a low score, and the user would tune the wrong variable.

### The verdict ladder

`not-ai` → `not-yet` → `assisted` → `automate-bounded` → `automate`

`not-yet` is the interesting rung: the workload is plausible but something described makes it a poor *first* thing to hand over. Every `not-yet` report carries an ordered `unlocks` list — the specific changes that would move it up — because "not yet" without "here is what would change it" is an unhelpful answer dressed as a rigorous one.

## Architecture selection

A decision tree, evaluated in order, producing one of eight patterns. Crucially it also produces a `rejected` list with reasons, so the report shows the road not taken.

1. Only deterministic shapes, or verdict is `not-ai` → **deterministic-automation**
2. Verdict is `assisted` → **hybrid-human-loop**
3. Single `classify` shape with no external knowledge → **classifier**
4. Actions present and multi-step → **bounded-agent**, or **autonomous-agent** if every action is `none`/`reversible` blast radius and autonomy is `full`
5. Multi-step without actions → **llm-workflow**
6. Requires external knowledge → **rag**
7. Otherwise → **llm-single-shot**

The bias is explicit and is toward the simpler pattern. Step 5 exists to catch the most expensive common mistake in this field: reaching for an agent when the steps are known in advance. If the sequence is knowable, encoding it as a graph is cheaper, testable, and structurally incapable of looping.

## Assumed call shapes

Each pattern carries the five numbers that drive cost. These are the rubric priors Control replaces.

| Pattern | Turns | Ctx growth/turn | Failure | Retries | Cache hit |
|---|---|---|---|---|---|
| deterministic-automation | 0 | 0 | 0% | 0 | 0% |
| classifier | 1 | 0 | 3% | 1 | 30% |
| llm-single-shot | 1 | 0 | 5% | 1 | 40% |
| rag | 1 | 0 | 8% | 1 | 20% |
| llm-workflow | 3 | 300 | 10% | 1 | 35% |
| bounded-agent | 7 | 900 | 15% | 1.5 | 45% |
| autonomous-agent | 14 | 1200 | 22% | 2 | 50% |
| hybrid-human-loop | 1 | 0 | 4% | 1 | 35% |

**These are guesses.** They are labelled `heuristic` everywhere they surface and they are the entire reason Control exists. The seeded demo telemetry in this repo puts the observed bounded-agent figure at 8.25 turns against a rubric prior of 7 — a 18% error on a variable that scales cost linearly, and that is on synthetic data generated to be well-behaved.

## Cost

### One attempt

```
inputTokens    = avgInput + (contextGrowthPerTurn × turnIndex)
cachedPortion  = inputTokens × cacheHitRate
cost           = (inputTokens − cachedPortion) × inputPer1M  / 1e6
               + cachedPortion                × cachedPer1M / 1e6
               + outputTokens                 × outputPer1M / 1e6
```

Summed across `turnsPerOutcome` turns, with the context term growing each turn. Cached input bills at the provider's cached-read rate, which across the major vendors sits around 10% of the input rate.

### One successful outcome

```
attemptCost      = Σ turns
expectedRetries  = failureRate × retriesPerFailure
costPerAttempt   = attemptCost × (1 + expectedRetries)
costPerOutcome   = costPerAttempt / (1 − failureRate)
```

`wastedOnFailures` is the retry term isolated — spend that produced nothing. It is shown as its own figure because it is the number a per-token calculator structurally cannot produce, and because it is the most actionable line in the report: it responds to better prompts, better validation, and better routing, none of which require changing models.

## Value and ROI

```
humanCostPerUnit = (minutesPerUnit / 60) × fullyLoadedHourlyUsd × displacementFactor
netPerUnit       = humanCostPerUnit − aiCostPerUnit
paybackMonths    = buildCost / (netPerUnit × unitsPerMonth)
```

Every term is nullable and every null propagates:

- No `minutesPerUnit` or no `fullyLoadedHourlyUsd` → `humanCostPerUnit` is null → `netPerUnit`, `netPerMonth` and `paybackMonths` are all null → the report says **unknowable** and lists the missing input by name.
- `displacementFactor` defaults to **0.6** and is stated as an assumption, not buried. Teams routinely model it as 1.0 and are routinely wrong: a review step, an exception queue, and the time spent deciding whether the output is good remain human even after the drafting does not.
- No `humanErrorRate` → the evaluation plan says the human baseline is unmeasured. "93% accurate" is a result or a regression depending entirely on that number, and most teams have never measured it.

## Model routing

Requirements are derived from the workload — required capabilities (vision, tool use, structured output, long context, reasoning), a context floor from input tokens plus accumulated growth, a latency class from the latency budget, and a residency constraint. The catalog is filtered to models that satisfy all of them, then the cheapest adequate model wins. The frontier tier is not the default; it is what you get when the requirements demand it.

Where a confidence split is viable, the report proposes routing the easy majority to a cheaper model with escalation for the uncertain tail. This is presented with an explicit warning that it is a **quality decision wearing a finance costume** — the saving is real and so is the accuracy change, and only one of the two shows up on the invoice.

Alternatives across providers are always listed. A recommendation that names one vendor and stops is a lock-in decision made on the user's behalf.

## Security

Controls are derived from the intersection of data classes and action surface, not from a template. Each control carries a `verifiedBy` field naming how ARK Control confirms it at runtime.

That column is the point of the whole section. A control nobody can verify after launch is a paragraph in a document, and paragraphs do not stop anything. `blocking: true` controls are rendered as launch blockers rather than recommendations.

## Evaluation

Golden-set size scales with error tolerance and volume. Accuracy thresholds map from tolerance: `none` → 0.99, `low` → 0.97, `medium` → 0.93, `high` → 0.85. Metrics marked `blocksLaunch` are exactly that.

Every plan carries a human-baseline note, because an AI accuracy figure with nothing to be compared against is not a result.

## Known limitations

Reproduced in-product at `/methodology`, because a limitation the user cannot find is not a disclosure.

1. **Token estimates come from your description.** Real prompts are usually larger than people think once system prompts, few-shot examples, and retrieved context are counted. Every cost figure scales linearly with this error.
2. **Model prices carry an expiry.** A promotional rate lapsing is the most common way a correct forecast becomes wrong with nobody having changed anything. `staleEntries()` exists so the UI can nag.
3. **Build cost is a rubric estimate** against a loaded engineering rate. It knows nothing about your integration surface, procurement, or security review queue — frequently the long pole.
4. **The evaluation plan cannot tell you whether you will hit the threshold.** It tells you what to measure.
5. **Calibration is accurate about workloads you already run** and silent about the ones you do not. The first assessment of a genuinely novel pattern is always `heuristic`.
6. **One workload at a time.** Portfolio effects are real and are not modelled.
7. **The rubric weights themselves are judgement.** They were chosen, not fitted. There is no labelled dataset of "workloads that should have used AI" to fit them against, and anyone claiming otherwise should be asked to produce it.
