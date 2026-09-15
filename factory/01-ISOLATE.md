# Step 1 — Isolate

**Rule: every feature starts in a fresh git worktree branched from `origin/main`.
No exceptions, including for one-line changes.**

A worktree is a second working directory backed by the same `.git` object store.
It is not a clone — there is one history, one remote, one set of objects — but it
is a separate set of files on disk with its own checked-out branch. That is what
makes it a station: an agent can `cd` into it, install, run a dev server, and
edit, without any other agent seeing a single one of those changes.

## Why not just a branch

Branches share the working directory. Two agents on two branches in one checkout
are two agents fighting over the same files, and `git checkout` between them
throws away uncommitted work. The failure is not hypothetical and it is not
recoverable: the second agent's edits are simply gone, and neither agent knows
it happened, so the diff you review is missing changes that were made.

Worktrees cost disk and an install per station. That is the entire downside.

## Creating a station

```bash
bash scripts/factory-new.sh <slug>
```

That script is the normative implementation — read it before you hand-roll the
equivalent. It fetches, branches from `origin/main` (never from whatever you
happen to have checked out), creates `worktrees/<slug>/`, and writes the spec
stub at `specs/<slug>.md` and the evidence directory at `evidence/<slug>/`.

The slug is the feature's identity for its whole life: branch name, worktree
directory, evidence directory, spec filename. Use `kebab-case`, keep it under
about thirty characters, and make it describe the outcome rather than the
mechanism — `resume-upload-limit`, not `fix-multer-config`.

## The rules of a station

**Branch from `origin/main`, freshly fetched.** Not from `main` as it sits on
your disk, which is however stale you last left it. Not from another feature
branch, however tempting the dependency looks — if feature B genuinely cannot
start until A merges, that is a sequencing fact, and stacking it on A's branch
hides it until the merge.

**One agent per station, for the station's whole life.** Handing a half-built
worktree to a second agent loses the first agent's reasoning and produces a diff
with two incompatible designs in it.

**The station is disposable; nothing of value lives only inside it.** Evidence
and spec are written to the main checkout's `evidence/` and `specs/`, not into
the worktree. When the feature ships, the worktree is deleted and nothing is
lost. If deleting the worktree would lose something, that something was in the
wrong place.

**Each station gets its own port.** Running four dev servers on 3000 produces
three confusing failures and one feature that appears to work. Assign
`3000 + n`, or read the port from an env var per station, and write the port
into the spec so the prover knows where to point.

## Tearing down

Do not `rm -rf` a worktree. Git tracks worktree registration in
`.git/worktrees/`, and deleting the directory leaves a stale entry that blocks
the slug from being reused.

```bash
bash scripts/factory-ship.sh <slug>
```

handles merge and teardown together. To abandon a station without merging:

```bash
git worktree remove worktrees/<slug> --force
git branch -D <slug>
```

## Exit criteria

You have finished isolating when `worktrees/<slug>/` exists, is on branch
`<slug>`, is based on a freshly fetched `origin/main`, has its dependencies
installed, and `specs/<slug>.md` states what the feature is and how it will be
proved. Only then does [step 2](02-BUILD.md) begin.
