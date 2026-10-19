# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A team of three to fifteen people who have decided to build something with AI and now have to defend that decision to whoever controls budget. Usually an engineering lead or a technical founder. They have one workload in mind and a number they have to produce.

The failure they are trying to avoid is not “we picked the wrong model.” It is “we spent four months and $180k building an agent for something a scheduled query does.”

*(Users and that failure mode are taken from `docs/prd/aifit-business.md`. A later commercial grill proposed a larger paying ICP for Control; that split is **not** recorded as product truth here.)*

## Product Purpose

Produce a document a team can take into a planning meeting: whether to use AI at all, what to build, what it costs per successful outcome, what has to be true before launch, and what would change the answer — with every figure labelled by where it came from.

Success includes: `lookup`-only work returns “do not use a model”; blank “today” inputs make payback **unknowable**; an uncalibrated Control still yields a complete report tagged `heuristic`.

## Positioning

AI Fit Teams is the **estimator**. ARK Control is the **measurement**. They are the only two surfaces that talk (one HTTP calibration call, allowed to fail). A neighbouring token calculator cannot truthfully copy the claim that the same figure reads `heuristic` until Control answers and `measured` (with a sample size) when it does — and that the engine can return `not-ai`.

The estimator does not get more confident over time. It gets more informed, and every figure says which of the two just happened.

## Operating Context

- Local: `npm run dev:business` on :3001. Optional `ARK_CONTROL_URL` + `ARK_CONTROL_TOKEN` against Control :3002.
- Intake is encoded into the report link and the assessment is recomputed on every view. Nothing the user enters is stored on the server.
- Nav may link to ARK Control. It must not invite the person to take the AI Fit consumer quiz.
- Route map: `/` (intro), `/assess` (intake), `/report` (result), `/methodology`.
- `POST /api/assess` scores one workload or a backlog in CI. `POST /api/measure` (non-`not-ai` only) sends one synthetic Runtime sample into Control.

## Capabilities and Constraints

**Intake (eight sections):** the job, volume, input/output, correctness, data and actions, constraints, today (defaults **blank**), your team.

**Report (eight sections):** verdict, numbers, architecture (including rejected patterns), model (cheapest adequate, alternatives across providers, `asOf` stamp), security controls with `verifiedBy`, evaluation plan, roadmap with kill criteria, what this report does not know.

**Provenance:** every user-facing number carries `heuristic` | `benchmark` | `calibrated` | `measured` via `BasisTag`. Uncalibrated is the primary path and must remain the better-tested one.

**Calibration:** `fetchCalibration({ days: 30 })` returns a set or `null`. Null on missing URL, 2.5s timeout, non-200, or schema mismatch. Never a partial “looks measured” state. Promotion to `measured` requires Control and the 30-trace floor.

**Does not:** persist intake; predict accuracy; price procurement/security-review queues; model a portfolio of workloads; depend on `@ark/db`; import the consumer Python engine.

**Open:** accessibility standard not set in init.

## Brand Commitments

Public name **AI Fit Teams** (shipped chrome, README, founder brief for this init). Document title pattern: “AI Fit Teams — should you build this?”.

Voice: precise, willing to refuse, labels its own ignorance. A fabricated ROI is treated as worse than no ROI.

Spec `specs/my-ai-names.md` approved “MY AI for teams”; that string is **not** the binding public name in this record.

## Evidence on Hand

- Shipped report and intake under `apps/business`.
- Methodology page in-product.
- Seeded Control calibration path documented in README demo orgs.
- Factory evidence under `evidence/` for Teams/Control loop specs.
- Measure unit tests at `apps/business/src/lib/measure.test.ts`.

**Do not fabricate:** customer ROI outcomes, production drift percentages, or named design-partner case studies. Seeded demo drift (e.g. 18% on synthetic bounded-agent turns) is demo data, not a customer result.

## Product Principles

1. A guess and a measurement never look the same on screen.
2. `not-ai` is a first-class verdict; an assessment that always says yes is a lead-generation form.
3. Missing inputs produce missing outputs (`unknowable`), not invented denominators.
4. Cost is discussed per successful outcome, not per token, and every figure names its basis.
5. The uncalibrated path is the product, not a degraded mode.
