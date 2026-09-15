#!/usr/bin/env bash
# Step 4 — Ship. Gate, merge, commit the evidence, tear down the station.
# See factory/04-SHIP.md. Run from the repo root.
set -euo pipefail

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo "usage: bash scripts/factory-ship.sh <slug>" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASE="${FACTORY_BASE_BRANCH:-main}"
WT="worktrees/$SLUG"

if ! git show-ref --verify --quiet "refs/heads/$SLUG"; then
  echo "no such branch: $SLUG" >&2
  exit 1
fi

# The gate runs first and its failure is final. Nothing below this line executes
# on a red gate — no merge, and the station is left standing so the builder can
# pick up where it stopped.
echo "→ running the gate"
python3 scripts/factory-gate.py "$SLUG"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "the main checkout has uncommitted changes; commit or stash them first" >&2
  exit 1
fi

# Say it out loud when the checkout is not already on the base branch. Shipping
# silently moves you off whatever you had open, and finding that out later — via
# a confusing diff in another window — is worse than being told now.
HERE="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$HERE" != "$BASE" ]]; then
  echo "note: leaving branch '$HERE' to ship on '$BASE'; you are not returned to it"
fi

echo "→ committing evidence and spec on $BASE"
git checkout "$BASE"
git add "evidence/$SLUG" "specs/$SLUG.md"
git commit -m "evidence: $SLUG" --quiet || echo "  (nothing new to commit)"

# --no-ff keeps the feature's commits grouped, so the evidence directory and the
# commit range for that feature still line up a year from now.
echo "→ merging $SLUG into $BASE"
git merge --no-ff "$SLUG" -m "merge: $SLUG"

echo "→ tearing down the station"
git worktree remove "$WT" --force
git branch -d "$SLUG"

cat <<EOF

shipped: $SLUG
  merged into $BASE, station removed, branch deleted
  surviving record: evidence/$SLUG/ and specs/$SLUG.md

push when ready:  git push origin $BASE
EOF
