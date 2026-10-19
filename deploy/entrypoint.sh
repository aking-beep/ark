#!/bin/bash
set -euo pipefail
mkdir -p /data
# Always bootstrap. `db:bootstrap` pushes the schema idempotently and seeds only
# when the orgs table is empty, so it is safe on every boot and safe when
# ARK_DATABASE_URL points at a shared libSQL/Turso database that has no local
# file to test for (a file check here would re-seed a remote DB on every replica).
# ARK_ALLOW_SEED=1 is scoped to this one call: the production seed refuses to
# run without it, and bootstrap only reaches the seed when no org exists yet.
# The seed still refuses the public demo passwords/tokens in production.
echo "→ bootstrapping database (schema push; seed only if empty)"
ARK_ALLOW_SEED=1 npm run db:bootstrap
export ARK_CONTROL_URL="${ARK_CONTROL_URL:-http://127.0.0.1:3002}"
export API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:8472}"
export MYAI_ROOT="${MYAI_ROOT:-/app/my-ai}"
# Bind 0.0.0.0 so compose's published 8472 is reachable from the host.
# Consumer still calls 127.0.0.1:8472 via API_ORIGIN on the same network namespace.
# --kill-others-on-fail: if one process dies, take the container down so the
# orchestrator restarts it, instead of serving a stack with a silently dead app.
exec npx concurrently --kill-others-on-fail -n my-ai-api,consumer,business,control -c yellow,cyan,magenta,green \
  "bash -c 'cd /app/my-ai && PYTHONPATH=packages/core/src python3 -m uvicorn services.api.main:app --host 0.0.0.0 --port 8472'" \
  "npm run start --workspace @ark/consumer" \
  "npm run start --workspace @ark/business" \
  "npm run start --workspace @ark/control"
