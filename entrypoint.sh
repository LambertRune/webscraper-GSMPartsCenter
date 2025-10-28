#!/bin/sh
set -e

# Start the Express API in the background
node backend/api.js &

# Start cron
cron

# Tail the cron log to keep the container running
exec tail -f /var/log/cron.log
