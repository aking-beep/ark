# <slug>

**Status:** DRAFT — a station may not be built in until this reads APPROVED.
**Approved by:**
**Date:**

## Problem

What is broken or missing, in the user's terms. Who hits it, how often, and what
they do instead today. TODO

## Outcome

One sentence: what a user can do after this ships that they cannot do now. If you
cannot write this sentence, the feature is not specified — it is a direction.
TODO

## Acceptance criteria

Each one testable, each one a thing a reviewer can check off. Three to six is
the healthy range; more than eight usually means two features.

1. TODO
2. TODO
3. TODO

## How this will be proved

State the measurement before the work starts, so the before capture is possible
and the after capture is comparable. Name the route, the command, the viewport,
or the metric. See `factory/03-PROVE.md`.

- **Artefact:** number / screenshot / recording / terminal output
- **Measured by:** TODO
- **Conditions:** TODO (data set, viewport, machine, warm or cold)

## Out of scope

The adjacent things this feature is *not* doing, named explicitly so that neither
the builder nor the reviewer has to guess. Unrelated bugs found along the way go
here as a note and become their own feature.

## Risk

Anything that makes this more than a normal change: auth, permissions, user data,
payments, migrations, model calls, cost, a third-party dependency. If any apply,
say so — it decides whether `agents/security-reviewer.md` runs and which gates in
`factory/GOVERNANCE.md` are required.

- **Rollback:** TODO — how this is undone if it is wrong in production.
