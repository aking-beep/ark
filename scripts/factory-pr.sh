#!/usr/bin/env bash
# Cloud ship — gate, push, open a pull request carrying the proof.
# See factory/05-CLOUD.md. The local equivalent is scripts/factory-ship.sh.
#
# This is the cloud counterpart to factory-ship.sh: same gate, same refusal to
# proceed on red, but it hands the merge to the platform instead of doing it
# locally. The PR body is assembled from the spec and the evidence so that
# whoever merges reads the same three things the rubric was scored against.
set -euo pipefail

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo "usage: bash scripts/factory-pr.sh <slug>" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BASE="${FACTORY_BASE_BRANCH:-main}"
SPEC="specs/$SLUG.md"
EV="evidence/$SLUG"

if ! command -v gh >/dev/null 2>&1; then
  echo "the GitHub CLI (gh) is not installed; push and open the PR by hand" >&2
  echo "  https://cli.github.com" >&2
  exit 2
fi

# The gate runs first and its failure is final. A pull request opened on a red
# gate is a request to merge something that does not pass — which is how a 5/5
# gate quietly becomes a suggestion.
echo "→ running the gate"
python3 scripts/factory-gate.py "$SLUG"

# In cloud mode the container is the station and uncommitted work dies with it.
# Refusing here is friendlier than opening a PR that is missing the evidence.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "uncommitted changes present; commit them before opening the PR" >&2
  echo "  cloud stations are disposable — anything uncommitted is already at risk" >&2
  git status --short >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "$BASE" ]]; then
  echo "you are on $BASE; check out the feature branch first" >&2
  exit 1
fi

echo "→ pushing $BRANCH"
git push -u origin "$BRANCH"

# Outcome line from the spec, evidence summary, and the latest review score.
# Extracted rather than retyped: a PR body written by hand drifts from the spec
# it claims to implement, and the drift is invisible to the person merging.
outcome() {
  awk '/^## Outcome/{f=1;next} /^## /{f=0} f' "$SPEC" 2>/dev/null \
    | sed '/^[[:space:]]*$/d' | head -3
}
changed() {
  awk '/^## What changed/{f=1;next} /^## /{f=0} f' "$EV/EVIDENCE.md" 2>/dev/null \
    | sed '/^[[:space:]]*$/d' | head -3
}
notproved() {
  awk '/^## What this does not prove/{f=1;next} /^## /{f=0} f' "$EV/EVIDENCE.md" 2>/dev/null \
    | sed '/^[[:space:]]*$/d' | head -5
}
score() {
  grep -iEo '^#+[[:space:]]*Round.*[0-9][[:space:]]*/[[:space:]]*5' "$EV/REVIEW.md" 2>/dev/null \
    | tail -1
}

BODY=$(cat <<EOF
## Outcome

$(outcome)

## What changed

$(changed)

## What this does not prove

$(notproved)

## Review

$(score)

---

Spec: \`$SPEC\`
Evidence: \`$EV/\` — before/after artefacts, \`EVIDENCE.md\`, \`REVIEW.md\`

The gate passed locally before this PR was opened
(\`python3 scripts/factory-gate.py $SLUG\`). See \`factory/04-SHIP.md\`.
EOF
)

echo "→ opening the pull request"
gh pr create --base "$BASE" --head "$BRANCH" --title "$SLUG" --body "$BODY"

cat <<EOF

pull request opened for $SLUG
  the station is the container; it is discarded, and the branch carries the proof
  merge when the required checks pass — nothing here merges for you
EOF
