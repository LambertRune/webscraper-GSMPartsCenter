const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3100;

// Data file paths - aligned with scraper output location
const dataDir = path.join(__dirname, '../data');
const brandsFile = path.join(dataDir, 'brands.json');
const categoriesFile = path.join(dataDir, 'categories.json');
const modelsFile = path.join(dataDir, 'models.json');
const partsFile = path.join(dataDir, 'parts.json');

// Helper: load JSON data from file
function loadData(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}, returning empty array`);
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err.message);
    return [];
  }
}

// Helper: filter data by query params
function filterData(data, query) {
  return data.filter(item => {
    for (const key in query) {
      if (query[key] !== undefined) {
        // Handle boolean conversion for inStock
        if (key === 'inStock') {
          if (item[key] !== (query[key] === 'true')) {
            return false;
          }
        } else {
          // Case-insensitive match for strings
          const itemValue = String(item[key]).toLowerCase();
          const queryValue = String(query[key]).toLowerCase();
          if (itemValue !== queryValue) {
            return false;
          }
        }
      }
    }
    return true;
  });
}


// --- Basic GET endpoints ---

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/brands', (req, res) => {
  const brands = loadData(brandsFile);
  res.json(brands);
});

app.get('/api/categories', (req, res) => {
  const categories = loadData(categoriesFile);
  res.json(categories);
});

app.get('/api/models', (req, res) => {
  const models = loadData(modelsFile);
  res.json(models);
});

app.get('/api/parts', (req, res) => {
  const parts = loadData(partsFile);
  res.json(parts);
});

// --- Smart GET: filter by query params ---
app.get('/api/search/parts', (req, res) => {
  const { brand, modelCategory, model, type, inStock } = req.query;
  const parts = loadData(partsFile);
  const filtered = filterData(parts, { brand, modelCategory, model, type, inStock });
  res.json(filtered);
});

app.get('/api/search/models', (req, res) => {
  const { brand, modelCategory, name } = req.query;
  const models = loadData(modelsFile);
  const filtered = filterData(models, { brand, modelCategory, name });
  res.json(filtered);
});

app.get('/api/search/categories', (req, res) => {
  const { brand, name } = req.query;
  const categories = loadData(categoriesFile);
  const filtered = filterData(categories, { brand, name });
  res.json(filtered);
});

app.get('/api/search/brands', (req, res) => {
  const { name } = req.query;
  const brands = loadData(brandsFile);
  const filtered = filterData(brands, { name });
  res.json(filtered);
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
