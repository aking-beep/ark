# Step 3 — Prove

**Rule: the agent records a before state and an after state as artifacts, and the
human reviews the artifacts instead of the code.**

This is the step that makes parallelism possible. Reading fifteen diffs is a
day's work and you will do it badly by the fourth one. Reading fifteen pairs of
screenshots, or fifteen before/after numbers, takes twenty minutes and you will
do it well, because the question "did the thing that was broken get fixed" is one
a human answers instantly and a model answers unreliably.

It is also the step that catches the specific failure mode of coding agents:
confident completion reports about work that does not run. An agent that must
produce an after-state artifact cannot report success without having executed
the code. The artifact is not documentation. It is the receipt.

## The before state is not optional and comes first

Capture the before state **before any code changes**, from the worktree, on the
branch, at the commit you started from. An agent that builds first and then
reconstructs what things "would have looked like" is writing fiction with a
screenshot attached.

If the before state is "this page 500s" — capture the 500. If it is "this
endpoint takes 4.2 seconds" — capture the 4.2 seconds. If the feature is new and
the before state is genuinely nothing, capture the nothing: the 404, the empty
list, the missing menu item. "There was no before" is almost never true and is
usually a sign the agent skipped the step.

## What counts as an artifact

In descending order of preference:

**A number, measured the same way twice.** Latency in milliseconds, rows
returned, bundle size in kilobytes, cost in dollars, test count, error rate. A
number is the strongest evidence because it is comparable, and it is the cheapest
to review — two figures side by side and you are done. Say how it was measured.

**A screenshot, same viewport and same route.** For anything visual. Two images
at different widths prove nothing; the reviewer's eye will find a difference and
attribute it to the feature.

**A short screen recording.** For multi-step flows where the interesting thing is
the sequence. Keep it under about thirty seconds — a recording nobody watches is
worse than a screenshot, because it looks like evidence.

**Terminal output, captured whole.** For CLI work, migrations, and jobs. Include
the command and the exit code, not just the pretty part in the middle.

**Test output.** Necessary and never sufficient. Passing tests prove the code
does what its author believed; they do not prove the user's problem is solved.
Tests are evidence in support of an artifact, not a substitute for one.

## Capturing

```bash
bash scripts/factory-prove.sh <slug> before
# ... build ...
bash scripts/factory-prove.sh <slug> after
```

The script creates `evidence/<slug>/`, stamps each capture with the commit SHA
and timestamp, and scaffolds `EVIDENCE.md` from
[`templates/EVIDENCE.md`](../templates/EVIDENCE.md). Screenshots and recordings
are dropped into the same directory by hand or by whatever automation the repo
has; the script does not pretend to drive a browser.

## Writing EVIDENCE.md

The template asks four questions and they are the whole review surface:

- **What changed** — one sentence, in user terms. Not "refactored the upload
  handler" but "files over 10 MB now fail with a message instead of hanging."
- **How it was measured** — the exact command, route, viewport, or procedure,
  such that the reviewer could repeat it.
- **Before / after** — the two artifacts, side by side.
- **What this does not prove** — the honest limit. Tested on one browser. Not
  tested against real S3. Only the happy path. This line is the one that earns
  the reviewer's trust in all the others, and an `EVIDENCE.md` where it reads
  "nothing" is a document to distrust.

Deviations from the spec, and any dependency added under
[build rule 2](02-BUILD.md#rules-that-survive-contact-with-agents), are declared
here.

## Exit criteria

Prove is done when `evidence/<slug>/` contains a before artifact, an after
artifact measured the same way, and a completed `EVIDENCE.md` — and when a person
who has not read the diff could look at that directory and say what the feature
does. Then [step 4](04-SHIP.md) begins.
