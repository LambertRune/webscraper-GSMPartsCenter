#!/bin/sh
set -e

echo "🚀 Starting GSM Parts Center Scraper..."

# Start the Express API FIRST (so healthcheck passes immediately)
echo "🌐 Starting API server..."
node backend/api.js &

CRON_LOG="${CRON_LOG:-/var/log/cron.log}"
touch "$CRON_LOG"

# Ensure data dir exists (volume mount)
mkdir -p /app/data

# Cron schedules (container timezone)
# - GSMPartsCenter: user wants only Sunday evening (default 22:00 on Sunday)
# - MobileSentrix: optional (disabled by default)
GSM_CRON_SCHEDULE="${GSM_CRON_SCHEDULE:-0 22 * * 0}"
MS_CRON_SCHEDULE="${MS_CRON_SCHEDULE:-30 21 * * *}"
ENABLE_GSM_CRON="${ENABLE_GSM_CRON:-true}"
ENABLE_MOBILESENTRIX_CRON="${ENABLE_MOBILESENTRIX_CRON:-false}"
MOBILESENTRIX_RUN_ON_STARTUP="${MOBILESENTRIX_RUN_ON_STARTUP:-true}"

echo "🗓️  Cron config:"
echo "   - GSMPartsCenter enabled=${ENABLE_GSM_CRON} schedule='${GSM_CRON_SCHEDULE}'"
echo "   - MobileSentrix enabled=${ENABLE_MOBILESENTRIX_CRON} schedule='${MS_CRON_SCHEDULE}' run_on_startup=${MOBILESENTRIX_RUN_ON_STARTUP}"

if [ "$ENABLE_GSM_CRON" = "true" ]; then
  cat > /etc/cron.d/gsm-scrape <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${GSM_CRON_SCHEDULE} root /app/daily-job.sh >> ${CRON_LOG} 2>&1
EOF
  chmod 0644 /etc/cron.d/gsm-scrape
fi

if [ "$ENABLE_MOBILESENTRIX_CRON" = "true" ]; then
  cat > /etc/cron.d/mobilesentrix-sync <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${MS_CRON_SCHEDULE} root /app/mobilesentrix-job.sh >> ${CRON_LOG} 2>&1
EOF
  chmod 0644 /etc/cron.d/mobilesentrix-sync
fi

# Start cron daemon
echo "⏰ Starting cron daemon..."
cron

# Optional: run MobileSentrix sync once on container start to avoid empty API on fresh deploy.
if [ "$ENABLE_MOBILESENTRIX_CRON" = "true" ] && [ "$MOBILESENTRIX_RUN_ON_STARTUP" = "true" ]; then
  if [ ! -f /app/data/devicesystem-products.json ]; then
    echo "▶️  Running MobileSentrix sync on startup (file missing)..."
    (cd /app && npm run sync:devicesystem >> "$CRON_LOG" 2>&1) &
  else
    echo "ℹ️  MobileSentrix file exists; skipping startup sync."
  fi
fi

# Tail the cron log to keep the container running
echo "✅ Setup complete! API running on port 3100"
exec tail -f "$CRON_LOG"
