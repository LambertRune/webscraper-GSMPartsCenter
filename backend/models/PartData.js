const mongoose = require('mongoose');


const PartDataSchema = new mongoose.Schema({
  brand: { type: String, required: true },
  modelCategory: { type: String, required: true },
  model: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  inStock: { type: Boolean, required: true },
  scrapedAt: { type: Date, required: true, default: Date.now }
});

module.exports = mongoose.model('PartData', PartDataSchema);
