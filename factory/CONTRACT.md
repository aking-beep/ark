# The factory contract

A software factory is not a tool and not an agent. It is a workflow made of four
steps, written down, that any model running in any harness can execute the same
way twice. Everything in this repository is markdown and four small scripts. If
the model you use changes next month, nothing here changes.

The four steps, and the failure each one exists to prevent:

| Step | What happens | The failure it prevents |
|---|---|---|
| **1. Isolate** | Every feature gets its own git worktree, branched from `origin/main`. | Agents editing the same tree, clobbering each other, and producing a diff no one can attribute. |
| **2. Build** | The agent writes to a stated code structure, not whatever it feels like. | Code that works and that no human can read six weeks later. |
| **3. Prove** | The agent records a before state and an after state as artifacts. | "It works on my machine," asserted by something that cannot run the machine. |
| **4. Ship** | A reviewer scores the diff against a rubric; the builder loops until it earns 5/5. | Merging on the author's own opinion of the author's own work. |

Each step has one document, and that document is the only place its rules live:

1. [`01-ISOLATE.md`](01-ISOLATE.md)
2. [`02-BUILD.md`](02-BUILD.md)
3. [`03-PROVE.md`](03-PROVE.md)
4. [`04-SHIP.md`](04-SHIP.md)

The scoring rubric used in step 4 is [`RUBRIC.md`](RUBRIC.md). The completion bar
is [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md). The optional layer for
client-facing and regulated work is [`GOVERNANCE.md`](GOVERNANCE.md).

## The four invariants

These hold regardless of harness, model, repo, or how urgent the work is. They
are the difference between a factory and a folder of prompts.

**One feature, one worktree, one agent.** A station is a physical place. Two
agents in one worktree is two machinists at one lathe. If a feature is too big
for one station, it is too big for one feature — split it at the spec, not at
the branch.

**No step may be skipped, and the order is fixed.** Prove before ship, always.
The most common way a factory rots is that someone ships an obvious one-line fix
without evidence, and then the next one, and within a month the evidence
directory is a graveyard of the three features that happened to be hard.

**The reviewer is not the builder.** Same model is fine; same context window is
not. A reviewer that has been watching itself write the code for an hour has
already agreed with every decision in it. The reviewer gets the diff, the spec,
and the evidence — not the build transcript.

**A score below 5 is not a negotiation.** The builder does not argue with the
rubric, and does not explain why 4 is acceptable here. It fixes the thing and
asks again. The loop is the product; a gate you can talk your way past is
decoration.

## What a feature costs

One feature through all four steps produces exactly these artifacts, and a
feature that produced fewer did not go through the factory:

```
worktrees/<slug>/                 the station (disposable)
evidence/<slug>/before.*          state captured before any code changed
evidence/<slug>/after.*           the same measurement, after
evidence/<slug>/EVIDENCE.md       what changed, what was measured, what it proves
evidence/<slug>/REVIEW.md         the reviewer's score and findings, per round
specs/<slug>.md                   the approved spec the work was held against
```

`evidence/` and `specs/` are committed. `worktrees/` is not — the station is torn
down and the evidence is what survives it. That asymmetry is the whole point:
you are not keeping the workshop, you are keeping the proof.

## Running more than one at a time

The reason to isolate with worktrees rather than branches is throughput. Fifteen
worktrees is fifteen agents building simultaneously, each with its own checkout,
its own dev server port, and its own station. You review the evidence and the
scores, not fifteen raw diffs — which is the only way one person reviews fifteen
features in a day without becoming the bottleneck the factory was built to
remove.

The practical ceiling is not the model. It is how many dev servers your machine
will hold and how many rounds of review you can read. Start at three.

## What this is not

It is not CI. CI runs after you push; the factory runs before. It is not a
methodology — there is no ceremony, no estimation, and no ritual here. And it is
not an autonomy story: every invariant above exists to put a human at the point
where judgment is cheap and mistakes are expensive, and to keep them out of the
places where their attention is merely being spent.
