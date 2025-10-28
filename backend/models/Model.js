const mongoose = require('mongoose');

const ModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  modelCategory: { type: String, required: true },
  brand: { type: String, required: true },
  url: { type: String, required: true }
});

module.exports = mongoose.model('Model', ModelSchema);
