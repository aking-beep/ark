#!/usr/bin/env bash
# Step 3 — Prove. Stamps a capture and scaffolds the evidence report.
# See factory/03-PROVE.md. Run from the repo root.
#
# This script does not take screenshots or drive a browser: it records *when* and
# *at which commit* a capture was taken, so that a reconstructed before-state is
# visible as one. Drop the artefacts themselves into the same directory.
set -euo pipefail

SLUG="${1:-}"
PHASE="${2:-}"

if [[ -z "$SLUG" || ! "$PHASE" =~ ^(before|after)$ ]]; then
  echo "usage: bash scripts/factory-prove.sh <slug> before|after" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

WT="worktrees/$SLUG"
DIR="evidence/$SLUG"
mkdir -p "$DIR"

if [[ -d "$WT" ]]; then
  SHA=$(git -C "$WT" rev-parse --short HEAD)
  DIRTY=$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')
else
  SHA=$(git rev-parse --short HEAD)
  DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
fi

STAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# A dirty tree at 'before' means code changed before the baseline was taken.
# 03-PROVE.md forbids reconstructing a before state, so this warns loudly rather
# than recording a baseline that is quietly already contaminated.
if [[ "$PHASE" == "before" && "$DIRTY" != "0" ]]; then
  echo "WARNING: $DIRTY uncommitted change(s) in the station at 'before'." >&2
  echo "         A baseline taken after editing is not a baseline. See factory/03-PROVE.md." >&2
fi

printf '%s\t%s\t%s\tdirty=%s\n' "$PHASE" "$STAMP" "$SHA" "$DIRTY" >> "$DIR/captures.tsv"

if [[ ! -f "$DIR/EVIDENCE.md" ]]; then
  if [[ -f templates/EVIDENCE.md ]]; then
    sed "s/<slug>/$SLUG/g" templates/EVIDENCE.md > "$DIR/EVIDENCE.md"
  else
    printf '# Evidence — %s\n\n(template missing)\n' "$SLUG" > "$DIR/EVIDENCE.md"
  fi
  echo "→ scaffolded $DIR/EVIDENCE.md"
fi

cat <<EOF

$PHASE capture stamped
  commit     $SHA
  time       $STAMP
  directory  $DIR/

now put the artefact in $DIR/ — name it ${PHASE}.png, ${PHASE}.txt, ${PHASE}.mp4
prefer a measured number with the command that produced it (factory/03-PROVE.md)
EOF
