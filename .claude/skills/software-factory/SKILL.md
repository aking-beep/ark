---
name: software-factory
description: Run a feature through the four-step software factory — isolate in a git worktree, build to the structure, prove with before/after evidence, ship through a 5/5 review gate. Use when starting a new feature, when asked to run the factory, build something in a worktree, capture evidence, review or score a diff, or ship a feature.
---

# Software factory

The factory is four steps and four invariants, and they live in `factory/` at the
repo root. **This skill is a loader, not a copy** — read the step document before
executing the step, because the document is the only place the rules live and it
may have been changed for this repo.

Read `factory/CONTRACT.md` first, once per session. It carries the four
invariants and the artifact list. All paths below are relative to the repo root.

## Routing

| The user says | Do this |
|---|---|
| "start a feature", "new feature", "isolate" | Read `factory/01-ISOLATE.md`, then run `bash scripts/factory-new.sh <slug>` |
| "build it", "implement the spec" | Adopt `agents/builder.md`; read `factory/02-BUILD.md` |
| "capture evidence", "prove it" | Adopt `agents/prover.md`; read `factory/03-PROVE.md` |
| "review this", "score it" | **Spawn a separate agent** with `agents/reviewer.md`; read `factory/RUBRIC.md` |
| "security review" | Spawn a separate agent with `agents/security-reviewer.md` |
| "ship it", "merge it" | Read `factory/04-SHIP.md`, then `bash scripts/factory-ship.sh <slug>` |
| "run the factory" on a stated feature | All of the above, in order, stopping for approval at the spec |

## The part that is easy to get wrong in this harness

**The reviewer must be a separate agent.** Use the Task/Agent tool with a fresh
context and hand it only the spec, the diff, and `evidence/<slug>/`. Do not
review in the same context that built the code — an agent that watched itself
make every decision has already agreed with all of them, and it will score 5/5 on
work it would have failed cold. This is the third invariant in
`factory/CONTRACT.md` and it is the one this harness makes easiest to violate.

**Capture the before state before the first edit.** Not after. The moment you
read the spec and think you know what to change, run
`bash scripts/factory-prove.sh <slug> before` — the script warns if the tree is
already dirty, and that warning is a finding, not a nuisance.

**Do not skip the gate for a small change.** `python3 scripts/factory-gate.py
<slug>` before every merge, including the one-liners. The gate is what makes the
evidence directory complete, and a complete evidence directory is the deliverable.

## Running several at once

Each station is its own worktree with its own port (written to
`worktrees/<slug>/.factory-station`). Launch one agent per station, let them run,
then review the evidence directories rather than the diffs. Start with three
before trying fifteen — the limit is how many review rounds a human can read, not
how many agents will run.
