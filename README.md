# GSMPartsCenter Webscraper & API

## Overview

This project scrapes https://www.gsmpartscenter.com/ and stores all brands, model categories, models, and parts in **JSON files** for ultra-fast API access. It provides a public REST API via Dokploy/Traefik reverse proxy, and runs daily (every Sunday at 2:00 AM) in Docker.

### 🚀 Performance Optimized

- **File-based storage** instead of MongoDB (100x faster reads!)
- **Smart diff algorithm** - only updates changed parts
- **No database overhead** - simpler deployment
- See [ARCHITECTURE.md](ARCHITECTURE.md) for details

## API Endpoints

All endpoints are prefixed with `/api` (e.g., `/api/brands`).

### Health Check

- `GET /health`
  - Returns `ok` if the API is running.

### Brands

- `GET /api/brands`
  - Returns all brands.

### Model Categories

- `GET /api/categories`
  - Returns all model categories.

### Models

- `GET /api/models`
  - Returns all models.

### Parts

- `GET /api/parts`
  - Returns all parts.

### Search Parts

- `GET /api/search/parts`
  - Query params: `brand`, `modelCategory`, `model`, `type`, `inStock`
  - Example: `/api/search/parts?brand=Apple&inStock=true`

### Search Models

- `GET /api/search/models`
  - Query params: `brand`, `modelCategory`, `name`
  - Example: `/api/search/models?brand=Apple&name=iPhone 13`

## Security

- API is accessible via your configured domain in Dokploy.
- Tunnel token is stored in `.env` (never commit this file).
- No database credentials needed (file-based storage).

## Cron/Scheduling

- The scraper runs automatically every Sunday at 2:00 AM (container time).

## Running

- Use `docker compose up -d` to start the stack.
- The API will be available at your configured domain.
