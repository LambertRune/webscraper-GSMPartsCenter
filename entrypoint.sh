#!/bin/sh
set -e

echo "🚀 Starting GSM Parts Center Scraper..."

# Run the scraper immediately on container start
echo "📊 Running initial scrape..."
sh /app/daily-job.sh || echo "⚠️  Initial scrape failed, continuing with cron."

# Start the Express API in the background (so healthcheck passes)
echo "🌐 Starting API server..."
node backend/api.js &

# Start cron for scheduled scraping (Sundays at 2:00 AM)
echo "⏰ Starting cron scheduler..."
cron

# Tail the cron log to keep the container running
echo "✅ Setup complete! API running on port 3100, cron job scheduled for Sundays at 2:00 AM"
exec tail -f /var/log/cron.log
