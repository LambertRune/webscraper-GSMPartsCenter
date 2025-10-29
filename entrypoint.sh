#!/bin/sh
set -e

# Start the Express API in the background (so healthcheck passes)
node backend/api.js &

# Run the scraper immediately on container start
sh /app/daily-job.sh || echo "Initial scrape failed, continuing with cron."

# Start cron
cron

# Tail the cron log to keep the container running
exec tail -f /var/log/cron.log
