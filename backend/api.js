const express = require('express');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const PartData = require('./models/PartData');
const Brand = require('./models/Brand');
const ModelCategory = require('./models/ModelCategory');
const Model = require('./models/Model');

const app = express();
const PORT = process.env.PORT;
const MONGO_URI = process.env.MONGO_URI;

// NOTE: DB connection disabled — API serves data from generated files.
const partsFile = path.join(__dirname, '../parts.ndjson');
const brandsFile = path.join(__dirname, '../brands.json');
const categoriesFile = path.join(__dirname, '../categories.json');
const modelsFile = path.join(__dirname, '../models.json');

// --- Basic GET endpoints ---

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/brands', async (req, res) => {
  try {
    if (fs.existsSync(brandsFile)) {
      const data = JSON.parse(fs.readFileSync(brandsFile, 'utf-8'));
      return res.json(data);
    }
  } catch (e) { /* fallthrough */ }
  res.json([]);
});

app.get('/api/categories', async (req, res) => {
  try {
    if (fs.existsSync(categoriesFile)) {
      const data = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
      return res.json(data);
    }
  } catch (e) { }
  res.json([]);
});

app.get('/api/models', async (req, res) => {
  try {
    if (fs.existsSync(modelsFile)) {
      const data = JSON.parse(fs.readFileSync(modelsFile, 'utf-8'));
      return res.json(data);
    }
  } catch (e) { }
  res.json([]);
});

app.get('/api/parts', async (req, res) => {
  try {
    if (!fs.existsSync(partsFile)) return res.json([]);
    const lines = fs.readFileSync(partsFile, 'utf-8').split('\n').filter(Boolean);
    const parts = lines.map(l => JSON.parse(l));
    return res.json(parts);
  } catch (e) {
    console.error('Failed to read parts file:', e.message);
    return res.status(500).json({ error: 'Failed to read parts' });
  }
});

// --- Smart GET: filter by query params ---
app.get('/api/search/parts', async (req, res) => {
  try {
    if (!fs.existsSync(partsFile)) return res.json([]);
    const lines = fs.readFileSync(partsFile, 'utf-8').split('\n').filter(Boolean);
    let parts = lines.map(l => JSON.parse(l));
    const { brand, modelCategory, model, type, inStock } = req.query;
    if (brand) parts = parts.filter(p => p.brand === brand);
    if (modelCategory) parts = parts.filter(p => p.modelCategory === modelCategory);
    if (model) parts = parts.filter(p => p.model === model);
    if (type) parts = parts.filter(p => p.type === type);
    if (inStock !== undefined) parts = parts.filter(p => p.inStock === (inStock === 'true'));
    return res.json(parts);
  } catch (e) {
    console.error('Search parts failed:', e.message);
    return res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/search/models', async (req, res) => {
  // Models are served from generated models.json
  try {
    if (!fs.existsSync(modelsFile)) return res.json([]);
    let models = JSON.parse(fs.readFileSync(modelsFile, 'utf-8'));
    const { brand, modelCategory, name } = req.query;
    if (brand) models = models.filter(m => m.brand === brand);
    if (modelCategory) models = models.filter(m => m.modelCategory === modelCategory);
    if (name) models = models.filter(m => m.name === name);
    res.json(models);
  } catch (e) { res.json([]); }
});

app.get('/api/search/categories', async (req, res) => {
  try {
    if (!fs.existsSync(categoriesFile)) return res.json([]);
    let cats = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));
    const { brand, name } = req.query;
    if (brand) cats = cats.filter(c => c.brand === brand);
    if (name) cats = cats.filter(c => c.name === name);
    res.json(cats);
  } catch (e) { res.json([]); }
});

app.get('/api/search/brands', async (req, res) => {
  try {
    if (!fs.existsSync(brandsFile)) return res.json([]);
    let brands = JSON.parse(fs.readFileSync(brandsFile, 'utf-8'));
    const { name } = req.query;
    if (name) brands = brands.filter(b => b.name === name);
    res.json(brands);
  } catch (e) { res.json([]); }
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
