#!/usr/bin/env bash
# The harness adapters live twice: the canonical copy under harness/ (what
# harness/README.md tells other repos to copy) and the installed copy under
# .claude/ and .cursor/ (what this repo's own editors load). They must stay
# byte-identical — an installed copy that drifts means the agent working in this
# repo follows different instructions from the ones we ship. Edit both, or edit
# harness/ and re-run the copy commands in harness/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# canonical            installed
PAIRS=(
  "harness/claude-code/agents"   ".claude/agents"
  "harness/claude-code/skills"   ".claude/skills"
  "harness/cursor/factory.mdc"   ".cursor/rules/factory.mdc"
)

fail=0
for ((i = 0; i < ${#PAIRS[@]}; i += 2)); do
  src="${PAIRS[i]}"
  dst="${PAIRS[i + 1]}"
  if [[ ! -e "$src" || ! -e "$dst" ]]; then
    echo "missing: $src or $dst" >&2
    fail=1
    continue
  fi
  if ! diff -r "$src" "$dst" >&2; then
    echo "drift: $src and $dst differ" >&2
    fail=1
  fi
done

if [[ "$fail" != 0 ]]; then
  echo "harness copies are out of sync; see harness/README.md" >&2
  exit 1
fi
echo "harness copies in sync"
