# Quick Start Guide

## 🚀 Getting Started

### 1️⃣ Install Dependencies
```bash
npm install
```

### 2️⃣ Option A: Generate Test Data (Quick Test)
```bash
# Create sample data for testing
npm run test-data

# Start the API server
npm run api

# Test in browser or with curl:
# http://localhost:3100/health
# http://localhost:3100/api/brands
# http://localhost:3100/api/parts
```

### 2️⃣ Option B: Scrape Real Data (Takes Time!)
```bash
# Run the scraper (will take ~30-60 minutes)
npm run scrape

# Start the API server
npm run api
```

## 📋 Available Commands

```bash
npm run scrape      # Run the web scraper
npm run api         # Start the API server
npm run test-data   # Generate sample data for testing
```

## 🔍 API Endpoints

### Basic Endpoints
```
GET /health                  → Health check
GET /api/brands             → All brands
GET /api/categories         → All categories
GET /api/models             → All models
GET /api/parts              → All parts
```

### Search Endpoints (with filters)
```
GET /api/search/brands?name=Apple
GET /api/search/categories?brand=Samsung
GET /api/search/models?brand=Apple&modelCategory=iPhone
GET /api/search/parts?brand=Apple&model=iPhone 15&inStock=true
```

## 📁 File Structure

```
webscraper-GSMPartsCenter/
├── data/                    # JSON data files (created by scraper)
│   ├── brands.json
│   ├── categories.json
│   ├── models.json
│   └── parts.json
├── backend/
│   ├── api.js              # API server (reads from JSON)
│   ├── test-data.js        # Test data generator
│   ├── services/
│   │   └── scraperService.js  # Web scraper (writes to JSON)
│   └── models_deprecated/  # Old MongoDB models (not used)
├── ARCHITECTURE.md         # Technical details
├── MIGRATION.md           # Migration summary
└── README.md              # Project overview
```

## ✅ What Changed?

**Before:** Scraper → MongoDB → API
**After:** Scraper → JSON Files → API (100x faster! 🚀)

- ✅ Removed MongoDB dependency
- ✅ API reads from JSON files directly
- ✅ Smart diff: only updates changed parts
- ✅ All endpoints work exactly the same
- ✅ No breaking changes!

## 🎯 Production Deployment

1. Run scraper to generate data: `npm run scrape`
2. Start API server: `npm run api`
3. Deploy with Dokploy (configured for auto-routing)
4. Set up cron job for daily scraping (see daily-job.sh)

## 💡 Tips

- The `/data` folder is automatically created
- JSON files are human-readable (great for debugging!)
- Re-run scraper anytime to refresh data
- No database needed - just files!

## 🆘 Troubleshooting

**Problem:** API returns empty arrays
**Solution:** Run `npm run test-data` or `npm run scrape` first

**Problem:** Port 3100 already in use
**Solution:** Change PORT in `.env` file

**Problem:** Scraper fails
**Solution:** Check your internet connection and website availability

---

**Ready to test?** Run: `npm run test-data && npm run api`
