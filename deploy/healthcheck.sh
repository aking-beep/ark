#!/bin/bash
# Container health: every one of the four processes must answer. curl -f fails
# only on >=400, so Control's redirect to /login still counts as up.
set -euo pipefail
for url in \
  http://127.0.0.1:8472/health \
  http://127.0.0.1:3000/ \
  http://127.0.0.1:3001/ \
  http://127.0.0.1:3002/login; do
  curl -fsS -o /dev/null --max-time 4 "$url"
done
