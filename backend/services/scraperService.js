require('dotenv').config();

const mongoose = require('mongoose');
const puppeteer = require('puppeteer');
const PartData = require('../models/PartData');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gsmpartscenter';

async function scrapeBrandsAndModels() {
  // Helper: random delay between min and max ms
  function randomDelay(min = 1000, max = 3000) {
    return new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
  }
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  // Set a realistic user agent and viewport
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://www.gsmpartscenter.com/', { waitUntil: 'networkidle2' });
  // Wait for the navigation menu to appear (up to 15s)
  try {
    await page.waitForSelector('ul.groupmenu.by-parts', { timeout: 15000 });
  } catch (e) {
    console.log('Navigation menu not found after waiting. Printing full page HTML for debugging:');
    const fullHtml = await page.content();
    require('fs').writeFileSync('debug-homepage.html', fullHtml);
    console.log('Full homepage HTML written to debug-homepage.html');
  }
  // Print the HTML of the navigation menu (if found)
  const navHtml = await page.evaluate(() => {
    const nav = document.querySelector('ul.groupmenu.by-parts');
    return nav ? nav.outerHTML : 'Navigation menu not found';
  });
  console.log('--- NAVIGATION HTML ---');
  console.log(navHtml);

  // Step 1: Scrape brands from homepage navigation
  const brands = await page.evaluate(() => {
    const brandNodes = Array.from(document.querySelectorAll('ul.groupmenu.by-parts > li[class*="category-node-"]'));
    return brandNodes.map(li => {
      const a = li.querySelector('a');
      const span = a ? a.querySelector('span') : null;
      if (a && span) {
        return {
          name: span.textContent.trim(),
          url: a.href
        };
      }
      return null;
    }).filter(Boolean);
  });

  // DEBUG: Print the brands array
  console.log('--- BRANDS FOUND ---');
  console.log(JSON.stringify(brands, null, 2));

  const results = [];

  // Step 2: For each brand, scrape categories, then models
  for (const brand of brands) {
    try {
      await randomDelay();
      await page.goto(brand.url, { waitUntil: 'networkidle2' });
      // Scrape categories (e.g., iPhone, iPad, etc. under Apple)
      const categories = await page.evaluate(() => {
        // Try to find category links in the left menu or main content
        const catLinks = Array.from(document.querySelectorAll('.category-list a, .categories-list a, .category-menu a'));
        return catLinks.map(link => ({
          name: link.textContent.trim(),
          url: link.href
        })).filter(cat => cat.name && cat.url);
      });
      if (categories.length === 0) {
        // If no categories, treat brand page as a category itself
        categories.push({ name: brand.name, url: brand.url });
      }
      for (const category of categories) {
        try {
          await randomDelay();
          await page.goto(category.url, { waitUntil: 'networkidle2' });
          // Scrape models (e.g., iPhone 17 Pro Max, etc.)
          const models = await page.evaluate(() => {
            // Try to find model links or product items
            const modelLinks = Array.from(document.querySelectorAll('.category-list a, .categories-list a, .category-menu a'));
            if (modelLinks.length > 0) {
              return modelLinks.map(link => ({
                name: link.textContent.trim(),
                url: link.href
              })).filter(m => m.name && m.url);
            }
            // Fallback: try product grid/list
            const items = Array.from(document.querySelectorAll('.category-products .item, .category-products .product-item, .category-products .product'));
            return items.map(el => {
              const name = el.querySelector('.product-name, .name, h2, h3')?.textContent?.trim() || '';
              const countText = el.querySelector('.count, .product-count, .qty, .amount')?.textContent || '';
              const count = parseInt(countText.replace(/\D/g, ''), 10) || 0;
              return { name, partCount: count };
            }).filter(m => m.name);
          });
          if (models.length === 0) {
            // If no models, treat category as a model
            results.push({
              brand: brand.name,
              category: category.name,
              model: category.name,
              partCount: 0,
              scrapedAt: new Date()
            });
          } else {
            for (const model of models) {
              // If model has a URL, try to get part count from its page
              let partCount = model.partCount || 0;
              if (model.url) {
                try {
                  await randomDelay();
                  await page.goto(model.url, { waitUntil: 'networkidle2' });
                  // Try to get part count from the model page
                  partCount = await page.evaluate(() => {
                    // Look for a count element or count products
                    const countEl = document.querySelector('.count, .product-count, .qty, .amount');
                    if (countEl) {
                      const txt = countEl.textContent;
                      const num = parseInt(txt.replace(/\D/g, ''), 10);
                      if (!isNaN(num)) return num;
                    }
                    // Fallback: count product items
                    const prods = document.querySelectorAll('.category-products .item, .category-products .product-item, .category-products .product');
                    return prods.length;
                  });
                } catch (e) {
                  // Ignore errors, use fallback partCount
                }
              }
              results.push({
                brand: brand.name,
                category: category.name,
                model: model.name,
                partCount,
                scrapedAt: new Date()
              });
            }
          }
        } catch (err) {
          console.error(`Error scraping category ${category.name} for brand ${brand.name}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`Error scraping brand ${brand.name}:`, err.message);
    }
  }

  // Print results for verification
  console.log(JSON.stringify(results, null, 2));

  // Only keep valid entries and map to schema fields
  const validResults = results
    .filter(r => r.brand && r.category && r.model)
    .map(r => ({
      brand: r.brand,
      modelCategory: r.category + ' / ' + r.model, // combine for uniqueness
      partCount: r.partCount,
      scrapedAt: r.scrapedAt
    }));

  // Clear old data and insert new
  await PartData.deleteMany({});
  if (validResults.length > 0) {
    await PartData.insertMany(validResults);
  } else {
    console.warn('No valid results to insert.');
  }

  await browser.close();
  await mongoose.disconnect();
}

module.exports = { scrapeBrandsAndModels };

// If run directly, execute the scraper
if (require.main === module) {
  scrapeBrandsAndModels().catch(err => {
    console.error('Scraper failed:', err);
    process.exit(1);
  });
}
