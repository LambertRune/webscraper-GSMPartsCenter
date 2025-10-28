const mongoose = require('mongoose');

const ModelCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  brand: { type: String, required: true },
  url: { type: String, required: true }
});

module.exports = mongoose.model('ModelCategory', ModelCategorySchema);
