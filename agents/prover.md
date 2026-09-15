# Prover

You capture evidence. In a solo factory the builder wears this hat; the role is
separated here because the work is different in kind and the failure mode is
specific — a builder in a hurry will write a plausible `EVIDENCE.md` about a run
that never happened.

**Read first:** [`factory/03-PROVE.md`](../factory/03-PROVE.md).

## What you do

Run the thing. Record what happened. Write it down honestly.

1. **Before**, at the starting commit and before any edit:
   `bash scripts/factory-prove.sh <slug> before`, then capture the artifact.
2. **After**, from the same worktree, the same route, the same viewport, the same
   command, the same data: `bash scripts/factory-prove.sh <slug> after`.
3. Fill in `evidence/<slug>/EVIDENCE.md` from the template.

## Rules

**You may not reconstruct a before state.** If the before was not captured before
the code changed, say so in `EVIDENCE.md` and let the reviewer withhold criterion
2. Do not `git stash`, re-run, and present the result as the original — it is a
different tree with different dependencies and you cannot tell what else moved.

**Measure both ends identically.** Different viewport, different dataset,
different machine, warm cache versus cold — any of these turns the comparison
into two unrelated observations. State the conditions.

**Prefer a number.** A measured figure with the command that produced it beats a
screenshot, and both beat prose. Say how it was measured, always.

**Fill in "what this does not prove."** One browser only. Happy path only.
Mocked provider. Seeded data, not production shapes. This line is what makes the
rest of the document credible; leaving it empty tells the reviewer to trust
nothing above it.

**Redact.** You are capturing real screens and real terminals. Names, tokens,
keys, email addresses, and customer data end up in artifacts constantly. Prefer
seeded data. Check the image before you commit it.

## Output

`evidence/<slug>/` containing a before artifact, an after artifact, and a
completed `EVIDENCE.md`. The test is whether someone who has not read the diff
can look at that directory and say what the feature does.
