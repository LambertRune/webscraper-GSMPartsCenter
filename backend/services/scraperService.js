const puppeteer = require('puppeteer');
require('dotenv').config();
const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI
/**
 * Scrapes all brands, models, categories, and parts from the site.
 */
async function scrapeBrandsAndModels() {
  // Helper: random delay between min and max ms
  function randomDelay(min = 1000, max = 3000) {
    return new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
  }

  const fs = require('fs');
  const path = require('path');
  const mainFilePath = path.join(__dirname, '../../parts.ndjson');
  // Clear the main file at the start
  fs.writeFileSync(mainFilePath, '');
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
      // ... (your navigation scraping logic is correct, no changes needed) ...
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
    // ... (your navigation saving logic is correct, no changes needed) ...
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
              // ... (your page evaluation logic is correct, no changes) ...
              const realProducts = Array.from(
                document.querySelectorAll('.products.wrapper.grid.products-grid ol.product-items > li.product-item .product-item-info')
              );
              return realProducts.map(function(part) {
                let name = '';
                let type = ''; // This type is often empty, we will overwrite it
                let inStock = false;

                const nameEl = part.querySelector('.product-item-link, .name, h2, h3');
                const typeEl = part.querySelector('.type, .product-type'); // May not exist
                const stockEl = part.querySelector('.stock, .availability, .in-stock, .stock-status');

                if (nameEl) name = nameEl.textContent.trim();
                if (typeEl) type = typeEl.textContent.trim(); // We'll ignore this one

                if (stockEl) {
                  const stockText = stockEl.textContent.toLowerCase();
                  inStock = stockText.includes('in stock') || stockText.includes('op voorraad') || stockText.includes('available');
                } else {
                  const partHtml = part.innerHTML.toLowerCase();
                  inStock = partHtml.includes('in stock') || partHtml.includes('op voorraad');
                }
                return { name, type: '', inStock }; // Return empty type
              });
            });

            // Add context to the scraped parts and write to file
            for (const part of parts) {

              // --- User's robust part filtering logic ---
              const partKeywords = [
                'volume button', 'simcard reader', 'flex cable', 'vibration', 'bottom screws', 'adhesive tape', 'glass', 'cover',
                'display', 'screen', 'lcd', 'digitizer', 'battery', 'camera', 'charging', 'connector', 'flex', 'speaker', 'microphone',
                'sensor', 'frame', 'housing', 'tray', 'antenna', 'button', 'cable', 'dock', 'earpiece', 'vibrator', 'motor', 'adhesive',
                'lens', 'back', 'front', 'proximity', 'face id', 'touch id', 'home button', 'volume', 'power', 'wifi', 'bluetooth', 'usb',
                'port', 'buzzer', 'ring', 'bracket', 'holder', 'clip', 'mount', 'board', 'pcb', 'chip', 'ic', 'fpc', 'module',
                'assembly', 'charging port', 'charging dock', 'camera lens', 'camera glass', 'midframe', 'mid frame', 'battery cover',
                'back cover', 'front camera', 'rear camera', 'mainboard', 'main board', 'logic board', 'motherboard', 'screw', 'screws',
                'micro usb', 'type-c', 'type c', 'lightning', 'audio jack', 'headphone', 'jack', 'sim card'
              ];
              const storageRegex = /\b(\d{2,4}\s?(gb|tb|g|t|gigabyte|terabyte))\b/i;
              const accessoryKeywords = [
                'case', 'protector', 'skin', 'shield', 'magforce', 'softskin', 'gelskin', 'impactskin', 'sika', 'smoothie', 'magshield', 'livon', 'tactical'
              ];
              const otherKeywords = [
                'tool', 'tools', 'repair', 'kit', 'set', 'sim tool', 'sim eject'
              ];

              const normalizedName = part.name.toLowerCase();
              const hasPartKeyword = partKeywords.some(keyword => normalizedName.includes(keyword));
              const hasStorageSpec = storageRegex.test(normalizedName);
              const hasAccessoryKeyword = accessoryKeywords.some(keyword => normalizedName.includes(keyword));
              const hasOtherKeyword = otherKeywords.some(keyword => normalizedName.includes(keyword));

              // Keep it ONLY if it has a part keyword, AND it's NOT a full device (no storage spec),
              // AND it's NOT an accessory, AND it's NOT "other stuff".
              if (hasPartKeyword && !hasStorageSpec && !hasAccessoryKeyword && !hasOtherKeyword) {
                
                // --- NEW LOGIC: Extract part type ---
                let remainingName = part.name;
                // Helper to escape regex special characters
                const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Create case-insensitive regex for brand and model
                const modelRegex = new RegExp(escapeRegExp(model.name), 'gi');
                const brandRegex = new RegExp(escapeRegExp(brand.name), 'gi');
                // Remove model first (as it's more specific)
                remainingName = remainingName.replace(modelRegex, '');
                // Then remove brand
                remainingName = remainingName.replace(brandRegex, '');
                // Clean up remaining string (removes extra spaces, dashes, etc.)
                const partType = remainingName.replace(/[\s-]+/g, ' ').trim();
                // --- END OF NEW LOGIC ---

                // Skip if type is empty after trimming
                if (!partType) {
                  // Optionally log: console.warn('Skipping part with empty type:', part.name);
                  continue;
                }

                const partObj = {
                  brand: brand.name,
                  modelCategory: category.name,
                  model: model.name,
                  name: part.name, // Keep the original full name
                  type: partType,  // Use the new, extracted part type
                  inStock: part.inStock,
                  scrapedAt: new Date()
                };

                allPartsResults.push(partObj);
                // Write each part as a line to the main file
                fs.appendFileSync(mainFilePath, JSON.stringify(partObj) + '\n');
                // Print to logs, showing the new type
                console.log(`  > PART (kept): [${partObj.name}] -> TYPE: [${partObj.type}]`);
              }
              
              // --- BUG FIX ---
              // The code block that was here has been removed.
              // It was incorrectly saving *all* items (including filtered-out ones)
              // to the results array and file, causing duplicates and bad data.

            }
            console.log(`Found ${parts.length} total items for ${model.name}.`);

          } catch (err) {
            console.error(`Error scraping model ${model.name} (${model.url}):`, err.message);
          }
        }
      }
    }

    // 6. --- Save Parts Data ---
    console.log(`Total valid parts scraped and saved to file: ${allPartsResults.length}`);

    // Read all scraped parts from the main file
    const scrapedLines = fs.readFileSync(mainFilePath, 'utf-8').split('\n').filter(Boolean);
    const scrapedParts = scrapedLines.map(line => JSON.parse(line));

    // Prepare unique key for each part
    function partKey(part) {
      // Use the new `type` field in the unique key
      return [part.brand, part.modelCategory, part.model, part.name, part.type && part.type.trim() !== '' ? part.type : 'Unknown'].join('||');
    }

    // Fetch all existing parts from the database
    const existingParts = await PartData.find({}, { _id: 0, brand: 1, modelCategory: 1, model: 1, name: 1, type: 1, inStock: 1, scrapedAt: 1 });
    const existingMap = new Map(existingParts.map(p => [partKey(p), p]));

    // Only insert new or changed parts
    const toInsert = scrapedParts.filter(part => {
      const key = partKey(part);
      const existing = existingMap.get(key);
      if (!existing) return true; // New part
      // Compare fields (ignore scrapedAt)
      return existing.inStock !== part.inStock || existing.name !== part.name || existing.type !== part.type;
    });

    console.log(`Valid parts to insert/update in DB: ${toInsert.length}`);
    if (toInsert.length > 0) {
      // Use bulk operations for efficiency (upsert)
      const bulkOps = toInsert.map(part => ({
        updateOne: {
          filter: { 
            brand: part.brand, 
            modelCategory: part.modelCategory, 
            model: part.model, 
            name: part.name,
            type: part.type // Include type in filter
          },
          update: { $set: part },
          upsert: true
        }
      }));
      await PartData.bulkWrite(bulkOps);
      console.log('Successfully upserted new/changed part data.');
    } else {
      console.warn('No new or changed part data to insert.');
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