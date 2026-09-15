#!/usr/bin/env bash
set -euo pipefail
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e ".[dev]"
pytest
echo ""
echo "Run demo:"
echo "  aifit score examples/sample_session.json"
echo ""
echo "Run API:"
echo "  PYTHONPATH=packages/core/src uvicorn services.api.main:app --host 127.0.0.1 --port 8472"
echo "Run web:"
echo "  cd apps/web && npm install && npm run dev"
