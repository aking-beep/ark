# Governance layer — optional

The four steps run as they are for solo and internal work. This layer is what you
add when the work is client-facing, regulated, or handled by more than one
person: the state machine, the required gates, the role separation, and the named
human approvals.

It is optional in the sense that a weekend project should not carry it. It is not
optional in the sense that you can skip it and still hand the output to a client.

## State machine

The four steps are the mechanics. These are the states the *work item* moves
through, and each transition has an artifact and an exit criterion. The mapping
to the four steps is in the right-hand column.

| State | Exit criterion | Artifact | Step |
|---|---|---|---|
| `INTAKE` | Problem stated in user terms; requester named | issue or intake note | — |
| `SPEC_READY` | Acceptance criteria written and testable | `specs/<slug>.md` | — |
| `PLAN_READY` | Human has approved scope; risks named | approval recorded on the spec | — |
| `BUILDING` | Acceptance criteria met; repo checks pass in the worktree | the diff | [1](01-ISOLATE.md), [2](02-BUILD.md) |
| `REVIEW` | Reviewer score of 5/5 | `evidence/<slug>/REVIEW.md` | [4](04-SHIP.md) |
| `VALIDATION` | Required gates below all pass | gate output | [4](04-SHIP.md) |
| `PREVIEW` | Deployed to staging; smoke tests pass | staging evidence | — |
| `APPROVED` | Named human approval for release | approval record | — |
| `RELEASED` | Deployed to production; rollback path confirmed | release note with evidence attached | — |
| `OBSERVED` | New failure modes visible in telemetry; cost impact measured | dashboard or query link | — |

`PREVIEW` through `OBSERVED` sit beyond the factory's four steps. That is
correct: the factory's job ends at a merged, proved, scored change. What happens
between merge and production is deployment, and it has its own controls.

A feature that has not reached `SPEC_READY` does not get a worktree. Isolating
before the spec exists produces a station whose occupant is discovering the
requirements by writing code, which is the expensive way to find out.

## Required gates

These run in `VALIDATION`, in addition to the checks
[`scripts/factory-gate.py`](../scripts/factory-gate.py) runs locally:

```yaml
version: 1
required_gates:
  - unit_tests
  - integration_tests
  - ai_regression
  - safety_eval
  - dependency_scan
  - secret_scan
  - cost_budget
  - staging_smoke
human_approval_required:
  - production_release
  - auth_model_change
  - iam_privilege_expansion
  - safety_policy_change
```

The list lives here rather than in CI configuration because it is a policy
statement, and CI configuration is an implementation of it. When the two
disagree, this file is what a client is shown and CI is what is wrong.

## Role separation

Four roles, defined in [`agents/`](../agents/). Under this layer, the separations
that matter are:

**Builder and reviewer are never the same context.** Enforced by the third
invariant in [`CONTRACT.md`](CONTRACT.md); restated here because under governance
it is auditable rather than merely wise.

**Security review is its own pass.** The [security reviewer](../agents/security-reviewer.md)
looks at a specific list — authorization, data handling, secrets, injection,
dependencies, privilege — and it is not a subset of the general review. A general
reviewer scoring the rubric will notice a missing timeout; it will not notice
that an endpoint's authorization check is one role too permissive.

**The human who approves scope and the human who approves release may be the same
person, and the approvals are still two events.** Recorded separately, at
different times, against different artifacts.

## Evidence retention

For client work, `evidence/` and `specs/` are the deliverable's audit trail and
are retained with the repository. Do not prune them to keep the tree tidy —
their value is that they are complete, and a partially pruned evidence directory
proves nothing about the features whose evidence is missing.

Redact before retaining: evidence artifacts are screenshots and terminal output
from real runs, and those capture real data, real tokens, and real customer
names more often than anyone expects. Screenshot from seeded data where you can.
