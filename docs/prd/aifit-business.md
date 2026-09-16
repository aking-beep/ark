# PRD: MY AI for teams (business)

**Surface:** `apps/business` · port 3001
**One line:** Thirty questions about one workload. Verdict, architecture, model, controls, eval plan, cost, roadmap.

## Who

A team of three to fifteen people who have decided to build something with AI and now have to defend the decision to someone who controls budget. Usually an engineering lead or a technical founder. They have a workload in mind and a number they have to produce.

The failure they are trying to avoid is not "we picked the wrong model." It is "we spent four months and $180k building an agent for something a scheduled query does."

## The job it does

Produce a document a team can take into a planning meeting: what to build, what it costs per successful outcome, what has to be true before launch, and what would change the answer — with every figure labelled by where it came from.

## Intake: eight sections

| Section | What it establishes |
|---|---|
| The job | Task shapes, actor, description → suitability and pattern |
| Volume | Units per month, variability → cost, build-cost amortisation |
| Input and output | Modality, token sizes, external knowledge → cost, RAG branch, model requirements |
| Correctness | Determinism demand, error tolerance → hard blockers, eval thresholds |
| Data and actions | Data classes, action surface, autonomy → security controls, agent branch |
| Constraints | Latency budget, regulated regimes, residency → model filtering |
| Today | Minutes/unit, loaded hourly rate, current cost, human error rate → ROI, or "unknowable" |
| Your team | Engineers, ML experience, security review, 24/7 coverage → readiness, autonomous-pattern gate |

Every numeric field in "Today" must be leave-able blank **and must default blank**. Pre-filling minutes or an hourly rate invents a denominator. A form that will not accept "I don't know" will be given a guess instead, and a guess entered as a fact is how a fabricated ROI ends up in a board deck.

## Report: eight sections

1. **Verdict** — headline, badges, and any hard blockers named individually. A capped verdict with no explanation is indistinguishable from a low score, and the team would tune the wrong variable.
2. **The numbers** — run cost per unit, per month, build cost, payback. Each carries a basis tag. `wastedOnFailures` is isolated as its own figure because it is the most actionable line in the report and the one a per-token calculator structurally cannot produce.
3. **Architecture** — the recommended pattern, its components, **the rejected patterns and why**, and the assumed call shape (turns, context growth, failure rate, retries, cache hit) rendered as four numbers the reader can argue with.
4. **Model** — cheapest adequate model that satisfies the derived requirements, with per-1M pricing and an `asOf` stamp. Fallback and escalation routes. Alternatives across providers, always — a recommendation that names one vendor and stops is a lock-in decision made on the team's behalf.
5. **Security controls** — derived from the intersection of data classes and action surface, not from a template. Each control carries a `verifiedBy` field naming how Control confirms it at runtime. `blocking: true` renders as a launch blocker.
6. **Evaluation plan** — golden-set size, accuracy threshold from stated error tolerance, metrics that block launch, and a human-baseline note. An AI accuracy figure with nothing to compare against is not a result.
7. **Roadmap** — phases with exit criteria **and kill criteria**. The kill criteria are the part teams skip and the part that makes the plan honest.
8. **What this report does not know** — unknowns by name, plus the uncalibrated banner when Control is unreachable.

Plus "How it scored" (seven dimension meters with weights and reasoning) and "What would move the verdict" (the ordered `unlocks` list) on `not-yet` verdicts.

## The calibration behaviour

On render, the report calls `fetchCalibration({ days: 30 })`. Two outcomes, no third:

- **Control answers** → cost figures read `measured` with a sample size, and the "calibrated against telemetry" badge appears.
- **Control does not answer** — no `ARK_CONTROL_URL`, 2.5s timeout, non-200, or schema mismatch → every figure reads `heuristic`, the uncalibrated banner appears, and the report is otherwise complete.

The default is uncalibrated, because most teams will run MY AI for teams before they run Control. The uncalibrated path is therefore the primary path and must be the better-tested one.

## `POST /api/assess`

Accepts a `Workload` or an array of them. Returns verdict, blockers, pattern, model, cost, payback, risk, trust, and the full assessment object. `422` with zod issues on a malformed body. `GET` returns a self-documenting reference including an example payload.

This exists so a team can score a backlog of twenty candidate workloads in CI and see which ones the engine refuses, rather than filling in a form twenty times.

## Success criteria

- A `lookup`-only workload returns "Do not use a model for this" and `deterministic-automation`.
- A workload with no `minutesPerUnit` and no hourly rate renders payback as **unknowable**, with the missing input named.
- An irreversible action at `full` autonomy is capped, with the combination named as the blocker.
- With `ARK_CONTROL_URL` set against a seeded Control, at least one figure flips to `measured` and the uncalibrated banner disappears.
- `POST /api/measure` on a non-`not-ai` workload runs one Runtime sample (id + task shapes only) and reports whether Control ingest succeeded. `not-ai` is 422 and does not call a provider.
- Report pages ship negligible page-specific JavaScript — everything except the intake form is server-rendered.

## Out of scope

Portfolio modelling, integration-surface pricing, accuracy prediction, and anything persisted. See the refusals in [`00-thesis.md`](../00-thesis.md).
