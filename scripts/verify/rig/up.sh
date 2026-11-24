#!/usr/bin/env bash
# Sandbox rig: start the sync-service (fresh local database) and the frontend, in the
# background. For machines that can't install the native packages (see README.md here).
#   scripts/verify/rig/up.sh            start (or restart) both
#   scripts/verify/rig/up.sh stop
# RIG_N=<0-9> runs a separate copy on its own ports and database, so several checkouts
# can run at once: frontend 5173+10N, sync 1234+10N, files in /tmp/rig<N>.
# RIG_KEEP_DB=1 keeps the database between restarts.
set -euo pipefail
cd "$(dirname "$0")/../../.."
N="${RIG_N:-0}"
WEB=$((5173 + 10 * N)); SYNC=$((1234 + 10 * N)); DIR="/tmp/rig${N}"
mkdir -p "$DIR"
# Stop this copy's processes by the marker on their command lines (pid files proved unreliable)
pkill -f -- "src/index.ts --rig=${N}\$" 2>/dev/null || true
pkill -f -- "rig/web.mjs ${WEB}\$" 2>/dev/null || true
[[ "${1:-}" == "stop" ]] && exit 0
sleep 1
[[ "${RIG_KEEP_DB:-}" == "1" ]] || rm -f "$DIR"/universe.db*
( cd server/sync-service && DB_PATH="$DIR/universe.db" PORT="$SYNC" DEV_FIXED_OTP=123456 DEV_NO_RATE_LIMIT=1 \
  BETTER_AUTH_SECRET=local-dev-secret-local-dev-secret-0000 MANA_ADMIN_TOKEN=dev-admin MAIL_TRANSPORT=console \
  BETTER_AUTH_URL="http://localhost:$SYNC" \
  nohup node --no-warnings --experimental-transform-types --import ../../scripts/verify/rig/hooks.mjs src/index.ts "--rig=${N}" > "$DIR/sync.log" 2>&1 & )
VITE_SYNC_URL="ws://localhost:$SYNC" nohup node scripts/verify/rig/web.mjs "$WEB" > "$DIR/web.log" 2>&1 &
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "http://localhost:$SYNC/stats" 2>/dev/null && curl -fsS -o /dev/null "http://localhost:$WEB/" 2>/dev/null; then
    echo "rig up: http://localhost:$WEB (sync :$SYNC, logs and database in $DIR)"; exit 0
  fi
  sleep 0.5
done
echo "rig did not come up; see $DIR/*.log" >&2; tail -n 5 "$DIR/sync.log" "$DIR/web.log" >&2; exit 1
