const mongoose = require('mongoose');

const PartDataSchema = new mongoose.Schema({
  brand: { type: String, required: true },
  modelCategory: { type: String, required: true },
  partCount: { type: Number, required: true },
  scrapedAt: { type: Date, required: true, default: Date.now }
});

module.exports = mongoose.model('PartData', PartDataSchema);
