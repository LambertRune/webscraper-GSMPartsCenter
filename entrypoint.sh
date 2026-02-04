#!/bin/sh
set -e

echo "🚀 Starting GSM Parts Center Scraper..."

# Start the Express API FIRST (so healthcheck passes immediately)
echo "🌐 Starting API server..."
node backend/api.js &

# Run initial scrape to populate data files
echo "🔄 Running initial scrape..."
node backend/services/scraperService.js

# Start cron daemon
echo "⏰ Starting cron daemon..."
cron

# Tail the cron log to keep the container running
echo "✅ Setup complete! API running on port 3100"
exec tail -f /var/log/cron.log
