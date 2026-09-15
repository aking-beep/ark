#!/usr/bin/env bash
# Step 1 — Isolate. Creates a station: one worktree, one branch, one feature.
# See factory/01-ISOLATE.md. Run from the repo root.
set -euo pipefail

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo "usage: bash scripts/factory-new.sh <slug>" >&2
  echo "  slug: kebab-case, names the outcome (resume-upload-limit), not the mechanism" >&2
  exit 2
fi

if [[ ! "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "slug must be kebab-case: [a-z0-9] separated by single hyphens" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

WT="worktrees/$SLUG"
BASE="${FACTORY_BASE_BRANCH:-main}"

if [[ -e "$WT" ]]; then
  echo "station already exists: $WT" >&2
  echo "  tear it down first: git worktree remove $WT --force && git branch -D $SLUG" >&2
  exit 1
fi

# Branch from a freshly fetched origin, never from whatever is checked out here.
# 01-ISOLATE.md explains why: a stale base is how a feature silently reverts
# someone else's merged work.
#
# A repo with no remote yet is a legitimate state — the first week of a project —
# so fall back to the local base branch and say so, rather than dying on a fetch
# that could never have worked.
if git remote get-url origin >/dev/null 2>&1; then
  echo "→ fetching origin"
  git fetch origin "$BASE"
  START="origin/$BASE"
else
  echo "note: no 'origin' remote — branching from local $BASE"
  START="$BASE"
fi

if ! git rev-parse --verify --quiet "$START" >/dev/null; then
  echo "no such base branch: $START" >&2
  echo "  this repo's default branch may not be '$BASE'." >&2
  echo "  set it: export FACTORY_BASE_BRANCH=\$(git rev-parse --abbrev-ref HEAD)" >&2
  exit 1
fi

git worktree add -b "$SLUG" "$WT" "$START"

mkdir -p "evidence/$SLUG" specs

if [[ ! -f "specs/$SLUG.md" ]]; then
  if [[ -f templates/FEATURE.md ]]; then
    sed "s/<slug>/$SLUG/g" templates/FEATURE.md > "specs/$SLUG.md"
  else
    printf '# %s\n\nSpec not written yet.\n' "$SLUG" > "specs/$SLUG.md"
  fi
  echo "→ spec stub: specs/$SLUG.md"
fi

# Ports: one station, one port. Derived from the worktree count so four parallel
# stations do not all try to bind 3000 and produce three confusing failures. The
# count includes the main checkout, which is why the first station lands on 3001
# — 3000 is left to whatever you have running in the root.
N=$(git worktree list --porcelain | grep -c '^worktree ' || true)
PORT=$(( 3000 + N - 1 ))
echo "PORT=$PORT" > "$WT/.factory-station"

echo "→ installing dependencies in the station"
if [[ -f "$WT/package-lock.json" ]]; then (cd "$WT" && npm ci --silent) || (cd "$WT" && npm install --silent)
elif [[ -f "$WT/package.json"      ]]; then (cd "$WT" && npm install --silent)
elif [[ -f "$WT/pnpm-lock.yaml"    ]]; then (cd "$WT" && pnpm install --silent)
elif [[ -f "$WT/uv.lock"           ]]; then (cd "$WT" && uv sync)
elif [[ -f "$WT/pyproject.toml"    ]]; then echo "  python project: install manually in $WT"
else echo "  no recognised manifest; install manually if needed"
fi

cat <<EOF

station ready
  worktree   $WT   (branch $SLUG, based on $START)
  port       $PORT
  spec       specs/$SLUG.md      ← write and approve this before building
  evidence   evidence/$SLUG/

next
  1. write specs/$SLUG.md and get it approved       (factory/CONTRACT.md)
  2. bash scripts/factory-prove.sh $SLUG before     (factory/03-PROVE.md)
  3. build                                          (factory/02-BUILD.md)
EOF
