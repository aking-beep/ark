# PRD: AIFit (consumer)

**Surface:** `apps/consumer` · port 3000
**One line:** Six questions about one task you do. A straight answer, including "no".

## Who

Someone who does a repetitive task at work and has been told, in general terms, that AI can do it. They are not a buyer. They have no budget, no engineering team, and no idea what a token is. They have five minutes and a suspicion.

They are also, frequently, the person who will later be in the room when their company decides what to build.

## The job it does

Turn a vague "could AI do this?" into a specific answer with a reason attached, in under a minute, without asking for an email address.

## Scope

**In:**

- Six questions, one screen at a time, no scrolling wall.
- A verdict from the same five-rung ladder the business surface uses: `not-ai`, `not-yet`, `assisted`, `automate-bounded`, `automate`.
- The recommended pattern in plain language, and what it would look like in practice.
- What would change the answer, when the answer is "not yet".
- A shareable result link.
- A one-line cross-link to the business surface, positioned as "if this is a team workload, there is a longer version."

**Out:**

- Cost. The six questions do not ask volume, minutes per unit, or hourly rate, so any cost figure would be fabricated. The section is suppressed entirely rather than shown with invented inputs.
- Model recommendations. Not actionable for someone who is not building.
- Accounts, persistence, email capture.
- Multi-task or portfolio comparison.

## The six questions

1. What is the task, in a sentence?
2. What kind of work is it? (task shapes — the `calculate`/`lookup` answers are what trigger `not-ai`)
3. Does it need to be exactly right, or approximately right?
4. What happens if it is wrong?
5. Does it need information from somewhere else, or just what you give it?
6. Does it just produce an answer, or does it *do* something?

Question 2 carries the most weight and question 6 gates the entire agent branch of the architecture tree.

## Behaviour that is non-negotiable

**It must be able to say no.** A task composed only of `calculate` and `lookup` returns "Don't use AI for this", a recommendation for a rules engine and a scheduled job, and the reasoning written down. Roughly a quarter of what people bring to a tool like this should not go near a language model. A tool that always finds a way to say yes is a lead-generation form wearing a rubric.

**Basis tags appear here too.** The user does not need to understand the ladder on first contact. They need to have seen it, so that when they meet the business surface the concept is already familiar.

**A corrupt link recovers.** Truncated or malformed `w` parameters render a recovery panel with a link back to the start, not an error page.

## Defaults

`fromConsumerIntake()` widens six answers into a full `Workload`. Every default is conservative in the direction of *less* confidence — modest volume, non-zero data sensitivity, unexceptional team capability. A consumer verdict is allowed to be wrong by being too cautious. It is not allowed to be wrong by being too encouraging. See [ADR-0002](../adr/0002-one-engine-two-surfaces.md).

## Success criteria

- Completion in under 90 seconds on a phone.
- The `not-ai` verdict fires on genuinely deterministic tasks, verified by fixture.
- No network dependency for a result — the engine is synchronous and local, and calibration is not fetched on this surface.
- Nothing is written to any store, verifiable by the absence of `@ark/db` in `package.json`.

## Explicit non-goal

This is not a marketing artifact for the business product. It is the same engine at a narrower aperture. If it ever becomes a funnel that softens its verdicts to drive clicks, it has stopped doing the one thing that makes it worth shipping.
