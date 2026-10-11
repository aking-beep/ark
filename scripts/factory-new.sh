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

# Ports: one station, one port, so parallel stations do not all try to bind the
# same one and produce confusing failures. Take the first port from the base
# that is neither claimed by another station's .factory-station nor currently
# listening. Counting worktrees instead (the old rule) reissued a live station's
# port as soon as an earlier station was torn down. The base defaults above the
# ARK apps' own ports (3000-3002) so `npm run dev` in the root never collides.
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port_claimed() { grep -qsx "PORT=$1" worktrees/*/.factory-station; }
PORT="${FACTORY_PORT_BASE:-3010}"
while port_claimed "$PORT" || port_in_use "$PORT"; do
  PORT=$(( PORT + 1 ))
  if (( PORT > 65535 )); then echo "no free port for the station" >&2; exit 1; fi
done
echo "PORT=$PORT" > "$WT/.factory-station"

# A failed install is an error, not a cue to fall back to `npm install`: that
# silently rewrites the lockfile, and the station then builds against
# dependencies nobody reviewed. Fix the lockfile on the base branch instead.
echo "→ installing dependencies in the station"
if [[ -f "$WT/package-lock.json" ]]; then
  if ! (cd "$WT" && npm ci --silent); then
    echo "npm ci failed in $WT; the lockfile and package.json disagree or the install broke." >&2
    echo "  the station is left in place; fix and re-run npm ci there, or tear it down:" >&2
    echo "  git worktree remove $WT --force && git branch -D $SLUG" >&2
    exit 1
  fi
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
