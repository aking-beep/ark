# Roadmap

Phases carry exit criteria and kill criteria. The kill criteria are the part that usually gets skipped, and they are the part that makes the rest of it honest — a roadmap with no condition under which you stop is a wish list.

## Phase 0 — Where this repo is now

Three apps, one engine, one database, seeded telemetry, `npm run setup && npm run dev`.

Working: the full assessment path on MY AI and MY AI for teams including `not-ai` verdicts and hard blockers; the business report across all eight sections; `POST /api/assess`; Control ingest, pricing, detection, dashboards and budgets; the calibration endpoint; and the `heuristic → measured` promotion verified end to end against seeded data.

**Exit:** met.

## Phase 1 — Make the numbers defensible (weeks 1–4)

The rubric is currently defensible as *judgement*. That is honest but it is not the same as being right.

- Wire `npm run refresh:models` into CI on a weekly schedule. The audit script exists and exits non-zero when an entry is stale or a promotional rate is about to lapse; nothing runs it yet. A promotional rate lapsing is the most common way a correct forecast becomes wrong with nobody having changed anything.
- Token estimation from a pasted prompt rather than a slider. Every cost figure scales linearly with this input and it is currently the weakest number in the report.
- Golden set of ~40 real workloads with known outcomes, scored by the engine, disagreements documented. The rubric weights were chosen, not fitted — this is the first step toward being able to say anything else.
- Ingest SDK (`@ark/sdk`): a wrapper that emits correct trace ids and turn indices without the customer hand-rolling it. Until this exists, correct instrumentation depends on someone reading the data model doc carefully, which is a bad bet.

**Exit:** a report can be defended line by line to a sceptical engineer without reaching for "that's a heuristic."
**Kill:** if the golden set shows the verdict ladder disagreeing with informed human judgement more than ~30% of the time, stop building surfaces and rebuild the rubric.

## Phase 2 — The loop closes for someone other than me

Shipped in-repo: Control sessions and org-bound ingest tokens; webhook/Slack alert delivery; budget `throttle`/`block` on ingest; a second org whose traces arrive only via ingest; fleet `calibrated` priors below the 30-trace floor; Docker compose for all three surfaces.

Still required to call the phase **done** against a real customer: three workloads instrumented in production by someone who did not write this code, and a drift figure they check rather than one we show them on seed data.

**Exit:** a customer's report reads `measured` on cost, and the drift figure is something they check rather than something we show them.
**Kill:** if instrumenting a real workload takes more than a day of a customer engineer's time, the SDK is the product problem and nothing after this matters.

## Phase 3 — Distribution (months 4–6)

- Consumer surface public, no gate, no email capture. It is a qualification mechanism, not a funnel — see [the consumer PRD](prd/aifit-consumer.md).
- The methodology page as the linkable artifact. The bet is that publishing the rubric with its limitations named travels further than publishing a number.
- Publish drift data in aggregate. "Here is how wrong the industry's default call-shape assumptions are, measured" is the only marketing this needs.
- Batch assessment in CI via `POST /api/assess` for teams with a backlog of candidate workloads.

**Exit:** inbound arrives at the business surface already knowing what a basis tag is.
**Kill:** if the consumer surface converts by softening verdicts, shut it off. A tool that always says yes is a lead-generation form.

## Phase 4 — The things currently refused (months 6+)

Each of these is a published refusal in [`00-thesis.md`](00-thesis.md). Lifting one requires evidence, not enthusiasm.

- **Portfolio modelling.** Shared retrieval infrastructure, amortised platform cost, volume commitments. Requires enough multi-workload customers to observe the effects rather than assume them.
- **Integration-surface pricing.** Build cost currently knows nothing about procurement or security review queues, which are frequently the long pole. Requires enough completed builds to regress against.
- **Accuracy prediction.** Probably stays refused. Nobody can predict how accurate a model will be on data it has not seen, and the honest substitute — the threshold your tolerance implies plus the golden-set size to measure it — is already shipped.

**Kill for the whole phase:** if lifting a refusal means guessing, the refusal stands. A fabricated number survives being repeated in a board deck, which is exactly what makes it expensive.

## What is deliberately not on this roadmap

An agent framework. A model gateway. A general-purpose observability platform. Sitting in the request path. Each is somebody else's product and each would dilute the one claim this system makes: that a guess and a measurement never look the same on screen.
