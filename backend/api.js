const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const PartData = require('./models/PartData');
const Brand = require('./models/Brand');
const ModelCategory = require('./models/ModelCategory');
const Model = require('./models/Model');

const app = express();
const PORT = process.env.PORT;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- Basic GET endpoints ---

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/brands', async (req, res) => {
  const brands = await Brand.find();
  res.json(brands);
});

app.get('/api/categories', async (req, res) => {
  const categories = await ModelCategory.find();
  res.json(categories);
});

app.get('/api/models', async (req, res) => {
  const models = await Model.find();
  res.json(models);
});

app.get('/api/parts', async (req, res) => {
  const parts = await PartData.find();
  res.json(parts);
});

// --- Smart GET: filter by query params ---
app.get('/api/search/parts', async (req, res) => {
  const { brand, modelCategory, model, type, inStock } = req.query;
  const filter = {};
  if (brand) filter.brand = brand;
  if (modelCategory) filter.modelCategory = modelCategory;
  if (model) filter.model = model;
  if (type) filter.type = type;
  if (inStock !== undefined) filter.inStock = inStock === 'true';
  const parts = await PartData.find(filter);
  res.json(parts);
});

app.get('/api/search/models', async (req, res) => {
  const { brand, modelCategory, name } = req.query;
  const filter = {};
  if (brand) filter.brand = brand;
  if (modelCategory) filter.modelCategory = modelCategory;
  if (name) filter.name = name;
  const models = await Model.find(filter);
  res.json(models);
});

app.get('/api/search/categories', async (req, res) => {
  const { brand, name } = req.query;
  const filter = {};
  if (brand) filter.brand = brand;
  if (name) filter.name = name;
  const categories = await ModelCategory.find(filter);
  res.json(categories);
});

app.get('/api/search/brands', async (req, res) => {
  const { name } = req.query;
  const filter = {};
  if (name) filter.name = name;
  const brands = await Brand.find(filter);
  res.json(brands);
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
