#!/bin/sh
set -e
echo "📅 Running scheduled scrape at $(date)"
cd /app
node backend/services/scraperService.js
echo "✅ Scrape completed at $(date)"
