#!/bin/sh
set -e

echo "🚀 Starting GSM Parts Center Scraper..."

# Start the Express API FIRST (so healthcheck passes immediately)
echo "🌐 Starting API server..."
node backend/api.js &

# Give API a moment to start
sleep 2

# Run the scraper in the background (non-blocking)
echo "📊 Running initial scrape in background..."
sh /app/daily-job.sh &

# Start cron for scheduled scraping (Sundays at 2:00 AM)
echo "⏰ Starting cron scheduler..."
cron

# Tail the cron log to keep the container running
echo "✅ Setup complete! API running on port 3100, scraper running in background, cron job scheduled for Sundays at 2:00 AM"
exec tail -f /var/log/cron.log
