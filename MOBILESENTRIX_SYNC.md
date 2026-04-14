# MobileSentrix DeviceSystem Sync

Separate from GSMPartsCenter scraper/API.

## What it does
- Download DeviceSystem CSV (needs login sometimes)
- Parse CSV rows into normalized product objects
- Compute retail price: `(cost * 1.15) * 1.21`, then round to `.95`/`.99`
- Title: `[Make] [Model] - [Size] - [Color] ([Condition])`
- Stock rule: `Available Qty < 1` → `inStock=false`
- Optional batch push to your webshop endpoint

## Configure
Copy `.env.example` → `.env`, set:
- `MS_USERNAME`, `MS_PASSWORD` (required if login page shown)
- Optional: `WEBSHOP_WEBHOOK_URL`, `WEBSHOP_WEBHOOK_TOKEN`

## Run

### Use existing CSV

```bash
DRY_RUN=true DEVICESYSTEM_CSV_PATH="/path/to/device_system.csv" npm run sync:devicesystem
```

### Auto-download

```bash
# if puppeteer missing browser:
npx puppeteer browsers install chrome

DRY_RUN=true npm run sync:devicesystem
```

## Output
- Writes `data/devicesystem-products.json`
- If `WEBSHOP_WEBHOOK_URL` set: pushes batches as `{ "products": [...] }`

