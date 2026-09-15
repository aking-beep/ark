#!/bin/bash
set -euo pipefail
mkdir -p /data
if [[ ! -f /data/ark.db ]]; then
  echo "→ first boot: pushing schema and seed"
  npm run db:push
  npm run db:seed
fi
export ARK_CONTROL_URL="${ARK_CONTROL_URL:-http://127.0.0.1:3002}"
exec npx concurrently -n consumer,business,control -c cyan,magenta,green \
  "npm run start --workspace @ark/consumer" \
  "npm run start --workspace @ark/business" \
  "npm run start --workspace @ark/control"
