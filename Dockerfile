FROM node:20-slim

# Install Chromium dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    curl \
    --no-install-recommends \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install cron
RUN apt-get update && apt-get install -y cron && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN npm install
# Install Chromium for Puppeteer
RUN npx puppeteer browsers install chrome
RUN chmod +x /app/daily-job.sh
RUN chmod +x /app/entrypoint.sh

# Add cron job
RUN echo "0 2 * * 0 /app/daily-job.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/daily-job
# RUN chmod 0644 /etc/cron.d/daily-job
# RUN crontab /etc/cron.d/daily-job

# Create log file
RUN touch /var/log/cron.log

EXPOSE 3100
# Expose log file for docker logs
CMD ["/app/entrypoint.sh"]
