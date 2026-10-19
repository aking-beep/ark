#!/usr/bin/env bash
# Start the AI Fit API on 127.0.0.1:8472 for `npm run dev`. Prefers the
# project venv from `npm run setup:my-ai`, and says what to do when the
# Python it finds cannot run the API instead of failing with a traceback.
set -euo pipefail
cd "$(dirname "$0")/../my-ai"

PY=python3
[[ -x .venv/bin/python ]] && PY=.venv/bin/python

if ! "$PY" -c 'import fastapi, uvicorn, pydantic' >/dev/null 2>&1; then
  echo "The AI Fit API cannot start: $PY is missing fastapi/uvicorn." >&2
  echo "Run: npm run setup:my-ai   (creates my-ai/.venv with Python 3.12+), then npm run dev again." >&2
  exit 1
fi

export PYTHONPATH=packages/core/src
exec "$PY" -m uvicorn services.api.main:app --host 127.0.0.1 --port "${MYAI_PORT:-8472}"
