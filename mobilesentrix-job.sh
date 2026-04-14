#!/bin/sh
set -e
echo "📅 Running scheduled MobileSentrix sync at $(date)"
cd /app
npm run sync:devicesystem
echo "✅ MobileSentrix sync completed at $(date)"

