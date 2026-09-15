# Step 4 — Ship

**Rule: a reviewer scores the work against [`RUBRIC.md`](RUBRIC.md), and the
builder loops back to [build](02-BUILD.md) until it earns 5 out of 5. Nothing
merges below 5.**

The loop is the mechanism. A review that produces a list of suggestions produces
a negotiation; a review that produces a number produces another round. Agents are
extremely good at another round and extremely bad at deciding when a suggestion
was important enough to act on.

## The loop

```
build → prove → review → score
                  ↑         ↓
                  └── < 5 ──┘
                            ↓
                          == 5 → gate → merge → teardown
```

1. The reviewer receives the spec, the diff, and `evidence/<slug>/`. **Not the
   build transcript** — see the third invariant in [`CONTRACT.md`](CONTRACT.md).
2. The reviewer writes `evidence/<slug>/REVIEW.md`: a score per criterion, the
   blocking findings, and the non-blocking notes, appended as a new round rather
   than overwriting the last.
3. Below 5, the builder fixes the blocking findings, re-captures the after
   artifact if behaviour changed, and requests a new round. Non-blocking notes
   are recorded and not necessarily acted on.
4. At 5, the gate runs.

Rounds are appended, never replaced. Three rounds is normal. A feature that takes
more than five rounds has a spec problem, not a code problem — stop, fix the
spec, and start the station over.

## Running the gate

```bash
python3 scripts/factory-gate.py <slug>
```

The gate is mechanical and has no opinions. It checks that the spec exists, that
the evidence directory has a before artifact, an after artifact and a completed
`EVIDENCE.md`, that `REVIEW.md` records a most-recent score of 5, that the
declared project checks pass, and that the diff contains nothing matching the
secret patterns. It exits non-zero and names what is missing.

A structural gate — one that only checks whether files exist — is theatre. This
one runs the repo's real commands, configured in `factory.config.json` at the
repo root:

```json
{
  "checks": {
    "typecheck": "npm run typecheck",
    "test": "npm run test",
    "lint": "npm run lint"
  }
}
```

Absent that file, the gate reports which checks it could not find and fails. It
does not pass by default, because a gate that passes when unconfigured is a gate
that passes.

## Merging and teardown

```bash
bash scripts/factory-ship.sh <slug>
```

Runs the gate, merges the branch into `main` with `--no-ff`, commits the evidence
and spec to `main`, removes the worktree, and deletes the branch. The `--no-ff`
merge is deliberate: it keeps the feature's commits grouped so that the evidence
directory and the commit range for that feature line up when someone goes looking
a year from now.

If the gate fails, nothing merges and the station is left intact.

## Where a human is required

The factory is not an approval-free pipeline. A human approves the spec before
step 1, and a human approves the merge — for regulated or client-facing work, the
specific approvals required are listed in [`GOVERNANCE.md`](GOVERNANCE.md), which
also carries the release policy and the required external gates.

The human is reading evidence and scores, not diffs. That is the trade: give up
line-by-line reading, gain the ability to actually review fifteen features, and
put the rubric in charge of the things line-by-line reading was catching.

## After merge

The worktree is gone; `evidence/<slug>/` and `specs/<slug>.md` remain on `main`.
That pair is the durable record of the feature: what was asked, what was built,
what was measured, and what the reviewer said about it — which is a materially
better artifact than the commit history alone, and the reason this step ends by
committing evidence rather than deleting it.
