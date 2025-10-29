#!/bin/sh
set -e

# Run the scraper immediately on container start
sh /app/daily-job.sh || echo "Initial scrape failed, continuing with API and cron."

# Start the Express API in the background
node backend/api.js &

# Start cron
cron

# Tail the cron log to keep the container running
exec tail -f /var/log/cron.log
