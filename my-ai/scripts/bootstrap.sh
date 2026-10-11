#!/usr/bin/env bash
set -euo pipefail
# Run from anywhere; everything below is relative to my-ai/ inside the ARK monorepo.
cd "$(dirname "$0")/.."
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e ".[dev]"
PYTHONPATH=packages/core/src python -m pytest
echo ""
echo "Run demo:"
echo "  myai score examples/sample_session.json"
echo ""
echo "Run API:"
echo "  PYTHONPATH=packages/core/src uvicorn services.api.main:app --host 127.0.0.1 --port 8472"
echo "Run web (from the monorepo root; the UI is apps/consumer):"
echo "  cd .. && npm ci && npm run dev:consumer"
