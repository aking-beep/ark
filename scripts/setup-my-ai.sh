#!/usr/bin/env bash
# Install the AI Fit API (my-ai/) into its own virtualenv at my-ai/.venv.
#
# A project venv rather than `pip install` into the system Python: Homebrew
# and recent Debian/Ubuntu Pythons refuse system-wide installs (PEP 668,
# "externally-managed-environment"), and a pip that belongs to a different
# Python than `python3` installs packages the API never sees.
set -euo pipefail
cd "$(dirname "$0")/../my-ai"

pick_python() {
  for c in python3.13 python3.12 python3; do
    if command -v "$c" >/dev/null 2>&1 &&
       "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
      echo "$c"; return 0
    fi
  done
  return 1
}

if ! PY="$(pick_python)"; then
  echo "AI Fit needs Python 3.12 or newer, and none was found on PATH." >&2
  echo "Install one (macOS: brew install python@3.12) and run: npm run setup:my-ai" >&2
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "→ creating my-ai/.venv with $("$PY" --version)"
  "$PY" -m venv .venv
fi
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -e '.[dev]'
echo "→ AI Fit API installed in my-ai/.venv ($(.venv/bin/python --version))"
