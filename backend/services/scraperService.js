const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Scrapes all brands, models, categories, and parts from the site.
 * Saves data to JSON files for fast API access.
 * 
 * Performance optimizations:
 * - Parallel scraping with configurable concurrency
 * - Reduced delays between requests
 * - Multiple browser pages for concurrent scraping
 */

// Configuration
const CONCURRENCY = 5; // Number of parallel browser pages
const MIN_DELAY = 200; // Minimum delay between requests (ms)
const MAX_DELAY = 500; // Maximum delay between requests (ms)
const REQUEST_TIMEOUT = 30000; // Page load timeout (ms)

async function scrapeBrandsAndModels() {
  // Helper: random delay between min and max ms
  function randomDelay(min = MIN_DELAY, max = MAX_DELAY) {
    return new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
  }

  // Data file paths
  const dataDir = path.join(__dirname, '../../data');
  const brandsFile = path.join(dataDir, 'brands.json');
  const categoriesFile = path.join(dataDir, 'categories.json');
  const modelsFile = path.join(dataDir, 'models.json');
  const partsFile = path.join(dataDir, 'parts.json');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let browser;
  try {
    console.log('Starting scraper...');
    const startTime = Date.now();

    // Launch browser with stealth settings to bypass bot detection
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    const page = await browser.newPage();
    
    // Hide webdriver property to avoid detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to homepage (use networkidle0 for better AJAX handling)
    await page.goto('https://www.gsmpartscenter.com/', { waitUntil: 'networkidle0', timeout: REQUEST_TIMEOUT });
    console.log('Homepage loaded.');

    // Wait for navigation menu content to load (AJAX-loaded)
    try {
      // First wait for container
      await page.waitForSelector('ul.groupmenu.by-parts', { timeout: 15000 });
      console.log('Navigation menu container found, waiting for content...');
      
      // Wait for actual menu items to load (they are loaded via AJAX)
      await page.waitForSelector('ul.groupmenu.by-parts li.level0 a.menu-link', { timeout: 30000 });
      console.log('Navigation menu content loaded.');
      
      // Extra wait to ensure all AJAX content is fully populated
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (e) {
      console.error('Navigation menu not fully loaded after timeout. Saving debug HTML...');
      const fullHtml = await page.content();
      fs.writeFileSync('debug-homepage.html', fullHtml);
      console.error('Debug HTML saved to debug-homepage.html. Aborting.');
      throw new Error('Navigation menu not found: ' + e.message);
    }

    // Scrape navigation structure
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

    // Prepare navigation data
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

    // Filter out invalid models
    const invalidModels = modelDocs.filter(m => !m.brand || m.brand.trim() === '');
    if (invalidModels.length > 0) {
      console.warn('Skipping models with missing brand:', invalidModels.length);
    }
    modelDocs = modelDocs.filter(m => m.brand && m.brand.trim() !== '');

    // Save navigation data to JSON files
    console.log('Saving navigation data...');
    fs.writeFileSync(brandsFile, JSON.stringify(brandDocs, null, 2));
    fs.writeFileSync(categoriesFile, JSON.stringify(categoryDocs, null, 2));
    fs.writeFileSync(modelsFile, JSON.stringify(modelDocs, null, 2));
    console.log('Navigation data saved.');

    // Close main page and prepare for parallel scraping
    await page.close();

    // Build flat list of all models to scrape
    const allModels = [];
    for (const brand of brands) {
      for (const category of brand.categories) {
        for (const model of category.models) {
          allModels.push({
            brand: brand.name,
            category: category.name,
            model: model.name,
            url: model.url
          });
        }
      }
    }

    console.log(`Starting parallel part scraping for ${allModels.length} models with ${CONCURRENCY} concurrent pages...`);

    // Part scraping function for a single model
    async function scrapeModelParts(browserPage, modelInfo) {
      const parts = [];
      try {
        await randomDelay();
        await browserPage.goto(modelInfo.url, { waitUntil: 'networkidle2', timeout: REQUEST_TIMEOUT });

        const rawParts = await browserPage.evaluate(() => {
          // FIXED: Updated selector to match current website structure
          const realProducts = Array.from(
            document.querySelectorAll('ol.product-items li.product-item .product-item-info, ol.row.product-items li.product-item .product-item-info')
          );
          return realProducts.map(function(part) {
            let name = '';
            let inStock = false;
            let imageUrl = '';

            const nameEl = part.querySelector('.product-item-link, .product-item-name a, .name, h2, h3');
            const stockEl = part.querySelector('.stock, .availability, .in-stock, .stock-status');
            const imageEl = part.querySelector('img.product-image-photo, .product-item-photo img, img');

            if (nameEl) name = nameEl.textContent.trim();

            if (stockEl) {
              const stockText = stockEl.textContent.toLowerCase();
              inStock = stockText.includes('in stock') || stockText.includes('op voorraad') || stockText.includes('available');
            } else {
              const partHtml = part.innerHTML.toLowerCase();
              inStock = partHtml.includes('in stock') || partHtml.includes('op voorraad');
            }

            if (imageEl) {
              imageUrl = imageEl.src || imageEl.getAttribute('data-src') || '';
            }

            return { name, inStock, imageUrl };
          });
        });

        // Part filtering keywords
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

        // Filter and process parts
        for (const part of rawParts) {
          const normalizedName = part.name.toLowerCase();
          const hasPartKeyword = partKeywords.some(keyword => normalizedName.includes(keyword));
          const hasStorageSpec = storageRegex.test(normalizedName);
          const hasAccessoryKeyword = accessoryKeywords.some(keyword => normalizedName.includes(keyword));
          const hasOtherKeyword = otherKeywords.some(keyword => normalizedName.includes(keyword));

          // Keep only real parts
          if (hasPartKeyword && !hasStorageSpec && !hasAccessoryKeyword && !hasOtherKeyword) {
            // Extract part type by removing brand and model from name
            let remainingName = part.name;
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const modelRegex = new RegExp(escapeRegExp(modelInfo.model), 'gi');
            const brandRegex = new RegExp(escapeRegExp(modelInfo.brand), 'gi');
            remainingName = remainingName.replace(modelRegex, '').replace(brandRegex, '');
            const partType = remainingName.replace(/[\s-]+/g, ' ').trim();

            // Skip if type is empty
            if (!partType) continue;

            parts.push({
              brand: modelInfo.brand,
              modelCategory: modelInfo.category,
              model: modelInfo.model,
              name: part.name,
              type: partType,
              inStock: part.inStock,
              imageUrl: part.imageUrl || '',
              scrapedAt: new Date().toISOString()
            });
          }
        }

        return { model: modelInfo, rawCount: rawParts.length, parts };
      } catch (err) {
        console.error(`Error scraping ${modelInfo.model}: ${err.message}`);
        return { model: modelInfo, rawCount: 0, parts: [], error: err.message };
      }
    }

    // Create worker pages for parallel scraping with stealth settings
    const pages = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const p = await browser.newPage();
      // Hide webdriver on worker pages too
      await p.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      await p.setViewport({ width: 1920, height: 1080 });
      pages.push(p);
    }

    // Process models in parallel batches
    const allParts = [];
    let completed = 0;
    
    async function processWithWorker(workerIndex, modelQueue) {
      const workerPage = pages[workerIndex];
      while (modelQueue.length > 0) {
        const modelInfo = modelQueue.shift();
        if (!modelInfo) break;
        
        const result = await scrapeModelParts(workerPage, modelInfo);
        allParts.push(...result.parts);
        completed++;
        
        if (completed % 10 === 0 || completed === allModels.length) {
          console.log(`Progress: ${completed}/${allModels.length} models scraped, ${allParts.length} parts found`);
        }
      }
    }

    // Create a shared queue and start workers
    const modelQueue = [...allModels];
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(processWithWorker(i, modelQueue));
    }
    await Promise.all(workers);

    // Close worker pages
    for (const p of pages) {
      await p.close();
    }

    console.log(`Total valid parts scraped: ${allParts.length}`);

    // Smart diff: only update changed parts
    let existingParts = [];
    if (fs.existsSync(partsFile)) {
      try {
        existingParts = JSON.parse(fs.readFileSync(partsFile, 'utf-8'));
      } catch (e) {
        console.warn('Could not parse existing parts file, starting fresh.');
        existingParts = [];
      }
    }

    // Create unique key for comparison
    function partKey(part) {
      return `${part.brand}||${part.modelCategory}||${part.model}||${part.name}||${part.type}`;
    }

    const existingMap = new Map(existingParts.map(p => [partKey(p), p]));
    const newParts = [];
    const updatedParts = [];

    for (const part of allParts) {
      const key = partKey(part);
      const existing = existingMap.get(key);
      
      if (!existing) {
        newParts.push(part);
      } else if (existing.inStock !== part.inStock || existing.imageUrl !== part.imageUrl) {
        updatedParts.push(part);
      }
    }

    console.log(`New parts: ${newParts.length}, Updated parts: ${updatedParts.length}`);

    // Merge: keep unchanged parts, add new, update changed
    const allPartsSet = new Set(allParts.map(p => partKey(p)));
    const unchangedParts = existingParts.filter(p => !allPartsSet.has(partKey(p)));

    const finalParts = [...unchangedParts, ...newParts, ...updatedParts];
    
    // Save to JSON file
    fs.writeFileSync(partsFile, JSON.stringify(finalParts, null, 2));
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(`Parts data saved to ${partsFile}`);
    console.log(`Total parts in database: ${finalParts.length}`);
    console.log(`Scraping completed in ${duration} minutes`);

  } catch (err) {
    console.error('An unexpected error occurred during scraping:', err);
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
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
