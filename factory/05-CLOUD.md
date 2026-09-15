# Running the factory on cloud agents

Optional. This document replaces [step 1](01-ISOLATE.md) — and only step 1 — for
teams running remote agents instead of agents on one laptop. Steps 2, 3 and 4 are
unchanged, because none of them depends on where the files sit.

Read [`01-ISOLATE.md`](01-ISOLATE.md) first anyway. It explains *why* isolation is
an invariant, and that reasoning is what this document is applying to different
hardware.

## What actually changes

Worktrees exist to solve a problem cloud agents do not have. One machine running
five agents needs five separate working directories or the agents overwrite each
other. A cloud agent already has its own container and its own clone; the
isolation is physical and total, and adding a worktree inside it isolates nothing
from nothing.

So in cloud mode the container **is** the station. The invariant — one feature,
one isolated checkout, one agent — holds by a different mechanism.

| | Local | Cloud |
|---|---|---|
| The station | `worktrees/<slug>/` | the agent's container |
| Created by | `scripts/factory-new.sh` | the platform, when you open the agent |
| Base | freshly fetched `origin/main` | a fresh clone, which is fresher |
| Ports | one per station, `3000 + n` | irrelevant; each container is alone |
| Evidence lives in | the main checkout, uncommitted until ship | the branch, committed as it is captured |
| Ship | `scripts/factory-ship.sh` merges locally | a pull request |
| Teardown | `git worktree remove` | the container is discarded |

The two scripts that matter mid-feature already handle this.
`scripts/factory-prove.sh` and `scripts/factory-gate.py` both look for
`worktrees/<slug>/` and fall back to the repository root when it is absent —
which is exactly the cloud shape. Neither needs modifying. `factory-new.sh` is
simply unused.

## The rule that inverts

Locally, evidence is written to the main checkout and stays out of the station,
because the station gets deleted. In cloud mode that advice is backwards and
dangerous: the container is what gets deleted, and anything not committed to the
branch dies with it.

**In cloud mode, commit evidence to the feature branch as you capture it.** Not
at the end. A container that is reclaimed mid-run takes every uncommitted
screenshot with it, and a before-state cannot be recaptured after the code has
changed — which is the one artifact in this whole workflow that cannot be
reconstructed.

```bash
bash scripts/factory-prove.sh <slug> before
git add evidence/<slug> && git commit -m "evidence: <slug> before"
```

Everything else follows unchanged: build, capture after, fill in `EVIDENCE.md`
including the line about what it does not prove, run the gate.

## Shipping by pull request

```bash
bash scripts/factory-pr.sh <slug>
```

That runs the gate first — a red gate means no pull request is opened — then
pushes the branch and opens a PR whose body is the spec's outcome, the evidence
summary, and the reviewer's score. The point is that the PR carries the proof, so
whoever merges is looking at the same three things the rubric was scored against
rather than at a diff and a hopeful title.

Branch protection on `main` is the cloud equivalent of the local gate being the
last thing that runs. If you use it, require the check that runs
`python3 scripts/factory-gate.py` in CI, so the gate cannot be skipped by someone
merging from the GitHub UI at eleven at night.

## What cloud makes harder, and what to do about it

**Evidence you cannot see.** Locally you watch the dev server. In a container you
are trusting an artifact committed by the thing being reviewed. Prefer artifacts
that are hard to fake and easy to compare: a number with the command that
produced it, a test output, an HTTP response body. A screenshot from a headless
browser is fine; a screenshot with no stated viewport and no route is not
evidence, it is a picture.

**The reviewer collapsing into the builder.** This is the invariant cloud
platforms erode fastest, because "continue in this session" is always the
cheapest button. The reviewer must be a separate agent run, started from
[`agents/reviewer.md`](../agents/reviewer.md) with the spec, the diff and
`evidence/<slug>/` as its only inputs. Not a follow-up turn. Not "now review what
you just did."

**Secrets in the container.** A cloud agent needs credentials that a laptop agent
inherited from your shell, so more secrets exist in more places. The gate's diff
scan catches the obvious leak; it does not catch a key pasted into a spec or an
evidence file. Scope container credentials to the minimum and treat
[`GOVERNANCE.md`](GOVERNANCE.md)'s security pass as required rather than optional
for anything touching auth, payments or user data.

**Base drift.** A fresh clone is fresher than a local `main`, which is the one
place cloud is strictly better — but only if agents are started sequentially
enough that they are not all branching from the same hour-old commit. When ten
stations run at once, the last three merges are where conflicts appear. Keep
features narrow at the spec so they do not overlap in the first place.

## The real ceiling

Locally the limit is how many dev servers your machine holds. In cloud it is how
many rounds of review a human can read in a day. That number is smaller than you
think and it does not scale with spend — which is why the rubric is five criteria
and not twenty, and why the evidence document leads with what changed in one
sentence.

Cloud raises the number of features in flight. It does not raise the number of
decisions you can make well. Start at three here too.
