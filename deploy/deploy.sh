#!/usr/bin/env bash
# Production deploy for the DM Monitoring Dashboard (Linux, on-premise).
# Run as the app user (dmapp). Pulls main, installs, reloads PM2, health-checks,
# and rolls back automatically if the new version does not come up.
#
#   APP_DIR=/home/dmapp/app  ./deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/home/dmapp/app}"
PORT="${PORT:-3000}"
HEALTH_WAIT="${HEALTH_WAIT:-30}"

cd "$APP_DIR"
PREV="$(git rev-parse HEAD)"
echo "-> Current commit: ${PREV:0:8}"

# Runtime files are git-ignored; keep a dated copy of settings before every deploy.
if [ -f config/settings.json ]; then
  cp -p config/settings.json "config/settings.json.bak.$(date +%F-%H%M)"
  # keep only the 10 newest backups
  ls -1t config/settings.json.bak.* 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

echo "-> Fetching origin/main"
git fetch origin main
git reset --hard origin/main
echo "-> New commit: $(git rev-parse --short HEAD)"

echo "-> Installing production dependencies"
npm ci --omit=dev

echo "-> Reloading PM2"
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "-> Health check (waiting up to ${HEALTH_WAIT}s)"
ok=0
for _ in $(seq 1 "$HEALTH_WAIT"); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/status" > /dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

if [ "$ok" -eq 1 ]; then
  echo "OK: deployed $(git rev-parse --short HEAD)"
  exit 0
fi

echo "FAILED health check. Rolling back to ${PREV:0:8}"
git reset --hard "$PREV"
npm ci --omit=dev
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
exit 1
