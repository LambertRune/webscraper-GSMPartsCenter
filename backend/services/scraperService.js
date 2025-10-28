require('dotenv').config();

const mongoose = require('mongoose');
const puppeteer = require('puppeteer');
const PartData = require('../models/PartData');
const Brand = require('../models/Brand');
const ModelCategory = require('../models/ModelCategory');
const Model = require('../models/Model');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gsmpartscenter';

/**
 * Scrapes all brands, models, categories, and parts from the site.
 */
async function scrapeBrandsAndModels() {
  // Helper: random delay between min and max ms
  function randomDelay(min = 1000, max = 3000) {
    return new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
  }

  let browser;
  try {
    // 1. --- Connect & Launch ---
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected.');

    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    // 2. --- Navigate to Homepage ---
    await page.goto('https://www.gsmpartscenter.com/', { waitUntil: 'networkidle2' });
    console.log('Homepage loaded.');

    try {
      await page.waitForSelector('ul.groupmenu.by-parts', { timeout: 15000 });
      console.log('Navigation menu found.');
    } catch (e) {
      console.error('Navigation menu not found after 15s. Saving debug HTML...');
      const fullHtml = await page.content();
      require('fs').writeFileSync('debug-homepage.html', fullHtml);
      console.error('Debug HTML saved to debug-homepage.html. Aborting.');
      throw new Error('Navigation menu not found.');
    }

    // 3. --- Scrape Nav Menu (Once) ---
    const brands = await page.evaluate(() => {
      const nav = document.querySelector('ul.groupmenu.by-parts');
      if (!nav) return [];
      const brandsData = [];
      nav.querySelectorAll('li.level0').forEach(brandEl => {
        const brandA = brandEl.querySelector('a.menu-link');
        const brandName = brandA?.querySelector('span:last-child')?.textContent.trim() || '';
        const brandUrl = brandA?.href || '';
        const categoriesData = [];
        brandEl.querySelectorAll('ul.level1 > li.level1').forEach(catEl => {
          const catA = catEl.querySelector('a.menu-link');
          const catName = catA?.querySelector('span')?.textContent.trim() || '';
          const catUrl = catA?.href || '';
          const modelsData = [];
          catEl.querySelectorAll('div.level2').forEach(modelEl => {
            const modelA = modelEl.querySelector('a.groupdrop-title');
            const modelName = modelA?.querySelector('span')?.textContent.trim() || '';
            const modelUrl = modelA?.href || '';
            if (modelName && modelUrl) modelsData.push({ name: modelName, url: modelUrl });
          });
          if (catName && catUrl && modelsData.length > 0) {
            categoriesData.push({ name: catName, url: catUrl, models: modelsData });
          }
        });
        if (brandName && brandUrl && categoriesData.length > 0) {
          brandsData.push({ name: brandName, url: brandUrl, categories: categoriesData });
        }
      });
      return brandsData;
    });

    if (brands.length === 0) {
      throw new Error('No brands found in navigation. Check selectors.');
    }
    console.log(`Found ${brands.length} brands in navigation.`);

    // 4. --- Save Nav Data ---
    const brandDocs = brands.map(b => ({ name: b.name, url: b.url }));
    const categoryDocs = brands.flatMap(b =>
      b.categories.map(c => ({
        name: c.name,
        url: c.url,
        brand: b.name
      }))
    );
      let modelDocs = brands.flatMap(b =>
        b.categories.flatMap(c =>
          c.models.map(m => ({
            name: m.name,
            url: m.url,
            brand: b.name,
            modelCategory: c.name
          }))
        )
      );
      // Filter out models with missing or empty brand, and log them
      const invalidModels = modelDocs.filter(m => !m.brand || m.brand.trim() === '');
      if (invalidModels.length > 0) {
        console.warn('Skipping models with missing brand:', invalidModels);
      }
      modelDocs = modelDocs.filter(m => m.brand && m.brand.trim() !== '');

    console.log('Clearing old navigation data...');
    await Brand.deleteMany({});
    await ModelCategory.deleteMany({});
    await Model.deleteMany({});

    console.log('Inserting new navigation data...');
    if (brandDocs.length > 0) await Brand.insertMany(brandDocs);
    if (categoryDocs.length > 0) await ModelCategory.insertMany(categoryDocs);
    if (modelDocs.length > 0) await Model.insertMany(modelDocs);
    console.log('Navigation data saved.');

    // 5. --- Iterate and Scrape Parts ---
    const allPartsResults = [];
    console.log('Starting part scraping for all models...');

    for (const brand of brands) {
      for (const category of brand.categories) {
        for (const model of category.models) {
          try {
            await randomDelay();
            console.log(`Scraping model: ${brand.name} > ${category.name} > ${model.name}`);
            await page.goto(model.url, { waitUntil: 'networkidle2' });

            const parts = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('.product-item-info')).map(function(part) {
                let name = '';
                let type = '';
                let inStock = false;

                const nameEl = part.querySelector('.product-item-link, .name, h2, h3');
                const typeEl = part.querySelector('.type, .product-type'); // May not exist
                const stockEl = part.querySelector('.stock, .availability, .in-stock, .stock-status');

                if (nameEl) name = nameEl.textContent.trim();
                if (typeEl) type = typeEl.textContent.trim();

                if (stockEl) {
                  const stockText = stockEl.textContent.toLowerCase();
                  inStock = stockText.includes('in stock') || stockText.includes('op voorraad') || stockText.includes('available');
                } else {
                  // Fallback
                  const partHtml = part.innerHTML.toLowerCase();
                  inStock = partHtml.includes('in stock') || partHtml.includes('op voorraad');
                }
                return { name, type, inStock };
              });
            });

            // Add context to the scraped parts
            for (const part of parts) {
              allPartsResults.push({
                brand: brand.name,
                modelCategory: category.name,
                model: model.name,
                name: part.name,
                type: part.type,
                inStock: part.inStock,
                scrapedAt: new Date()
              });
            }
            console.log(`Found ${parts.length} parts for ${model.name}.`);

          } catch (err) {
            console.error(`Error scraping model ${model.name} (${model.url}):`, err.message);
          }
        }
      }
    }

    // 6. --- Save Parts Data ---
    console.log(`Total parts scraped: ${allPartsResults.length}`);

    const validResults = allPartsResults
      .filter(r => r.brand && r.modelCategory && r.model && r.name) // Filter for essential fields
      .map(r => ({
        brand: r.brand,
        modelCategory: r.modelCategory,
        model: r.model,
        name: r.name,
        type: r.type || '', // Default to empty string if type wasn't found
        inStock: r.inStock,
        scrapedAt: r.scrapedAt
      }));

    console.log(`Valid parts to insert: ${validResults.length}`);
    await PartData.deleteMany({});
    if (validResults.length > 0) {
      await PartData.insertMany(validResults);
      console.log('Successfully inserted new part data.');
    } else {
      console.warn('No valid part results to insert.');
    }

  } catch (err) {
    console.error('An unexpected error occurred during scraping:', err);
  } finally {
    // 7. --- Cleanup ---
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

module.exports = { scrapeBrandsAndModels };

// If run directly, execute the scraper
if (require.main === module) {
  scrapeBrandsAndModels().catch(err => {
    console.error('Scraper failed to run:', err);
    process.exit(1);
  });
}