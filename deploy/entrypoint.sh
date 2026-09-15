#!/bin/bash
set -euo pipefail
mkdir -p /data
if [[ ! -f /data/ark.db ]]; then
  echo "→ first boot: pushing schema and seed"
  npm run db:push
  npm run db:seed
fi
export ARK_CONTROL_URL="${ARK_CONTROL_URL:-http://127.0.0.1:3002}"
export API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:8472}"
export MYAI_ROOT="${MYAI_ROOT:-/app/my-ai}"
# Bind 0.0.0.0 so compose's published 8472 is reachable from the host.
# Consumer still calls 127.0.0.1:8472 via API_ORIGIN on the same network namespace.
exec npx concurrently -n my-ai-api,consumer,business,control -c yellow,cyan,magenta,green \
  "bash -c 'cd /app/my-ai && PYTHONPATH=packages/core/src python3 -m uvicorn services.api.main:app --host 0.0.0.0 --port 8472'" \
  "npm run start --workspace @ark/consumer" \
  "npm run start --workspace @ark/business" \
  "npm run start --workspace @ark/control"
