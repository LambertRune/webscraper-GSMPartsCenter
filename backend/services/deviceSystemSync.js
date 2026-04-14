require('dotenv').config();

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { parse } = require('csv-parse/sync');

const DEFAULT_SOURCE_URL = 'https://www.mobilesentrix.eu/devicesystem?instock=1';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(items, chunkSize) {
  if (!Array.isArray(items)) return [];
  const size = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function parseMoney(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Price column may contain thousand separators like "1,005.57"
  const normalized = s.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function roundToPsychological(price, endings = [0.95, 0.99]) {
  const p = Number(price);
  if (!Number.isFinite(p)) return null;
  if (p <= 0) return 0;

  const centsEndings = endings
    .map(e => Math.round((Number(e) % 1) * 100))
    .filter(e => e >= 0 && e <= 99);

  if (centsEndings.length === 0) return Math.round(p * 100) / 100;

  const base = Math.floor(p);
  const cents = Math.round((p - base) * 100);

  // Find the smallest psychological ending >= current cents within the same base
  const sorted = [...new Set(centsEndings)].sort((a, b) => a - b);
  for (const endCents of sorted) {
    if (cents <= endCents) return Math.round((base + endCents / 100) * 100) / 100;
  }

  // Otherwise jump to next base with lowest ending
  return Math.round((base + 1 + sorted[0] / 100) * 100) / 100;
}

function calculateRetailPrice(costPriceExVat) {
  const cost = Number(costPriceExVat);
  if (!Number.isFinite(cost)) return null;
  // (Inkoop * 1.15) * 1.21
  const raw = cost * 1.15 * 1.21;
  return roundToPsychological(raw, [0.95, 0.99]);
}

function buildTitle({ make, model, size, color, condition }) {
  const parts = [
    [make, model].filter(Boolean).join(' ').trim(),
    size,
    color
  ].filter(Boolean);
  const base = parts.join(' - ');
  const cond = condition ? ` (${condition})` : '';
  return `${base}${cond}`.trim();
}

function normalizeRow(row) {
  const make = row.Make?.trim() || '';
  const model = row.Model?.trim() || '';
  const size = row.Size?.trim() || '';
  const color = row.Color?.trim() || '';
  const condition = row.Condition?.trim() || '';
  const carrier = row.Carrier?.trim() || '';

  const qty = Number(String(row['Available Qty'] ?? '').trim());
  const availableQty = Number.isFinite(qty) ? qty : 0;
  const inStock = availableQty >= 1;

  const costPrice = parseMoney(row.Price);
  const retailPrice = costPrice == null ? null : calculateRetailPrice(costPrice);

  const currency = row['Currency Code']?.trim() || '';
  const sku = row.Sku?.trim() || '';

  return {
    sku,
    title: buildTitle({ make, model, size, color, condition }),
    make,
    model,
    size,
    color,
    condition,
    carrier,
    availableQty,
    inStock,
    pricing: {
      costPriceExVat: costPrice,
      retailPriceIncVat: retailPrice,
      currency
    },
    source: 'mobilesentrix-devicesystem'
  };
}

async function fetchWithRetries(url, options, { retries = 3, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText} - ${text.slice(0, 500)}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

async function pushBatchesToWebshop(products, opts) {
  const {
    url,
    token,
    batchSize = 50,
    delayMs = 250,
    dryRun = false
  } = opts;

  if (!url) {
    console.log('WEBHOOK_URL not set; skipping remote push (JSON export only).');
    return;
  }

  const batches = chunkArray(products, batchSize);
  console.log(`Pushing ${products.length} items in ${batches.length} batches to ${url}`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (dryRun) {
      console.log(`[DRY RUN] Would push batch ${i + 1}/${batches.length} size=${batch.length}`);
    } else {
      await fetchWithRetries(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ products: batch })
        },
        { retries: 3, baseDelayMs: 800 }
      );
      console.log(`Pushed batch ${i + 1}/${batches.length} size=${batch.length}`);
    }
    if (i < batches.length - 1) await sleep(delayMs);
  }
}

async function downloadDeviceSystemCsv({
  sourceUrl,
  downloadDir,
  username,
  password,
  timeoutMs = 60000
}) {
  const url = sourceUrl || DEFAULT_SOURCE_URL;
  const outDir = downloadDir || path.join(__dirname, '../../data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // enable downloads
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: outDir
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });

    // Cookie banner (best effort)
    const clickedCookie = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const accept = buttons.find(b => /accept/i.test(b.textContent || ''));
      if (accept) {
        accept.click();
        return true;
      }
      return false;
    });
    if (clickedCookie) await sleep(500);

    // If login required, attempt with env-provided creds (no hardcoded secrets)
    const user = username || process.env.MS_USERNAME || '';
    const pass = password || process.env.MS_PASSWORD || '';

    // Heuristic: check for login form fields
    const hasLogin = await page.evaluate(() => {
      const email = document.querySelector('input[type="email"], input[name*="email" i], input#email');
      const pw = document.querySelector('input[type="password"], input[name*="pass" i], input#pass');
      return Boolean(email && pw);
    });

    if (hasLogin) {
      if (!user || !pass) {
        throw new Error(
          'Login required but MS_USERNAME/MS_PASSWORD not set. Put creds in .env (see .env.example).'
        );
      }
      console.log('Login form detected; attempting sign-in...');
      await page.type('input[type="email"], input[name*="email" i], input#email', user, { delay: 20 });
      await page.type('input[type="password"], input[name*="pass" i], input#pass', pass, { delay: 20 });

      // Submit
      await Promise.allSettled([
        page.click('button[type="submit"], button[name="send"], button.login, #send2'),
        page.keyboard.press('Enter')
      ]);
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: timeoutMs }).catch(() => {});
      await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    }

    // Find any link/button that triggers CSV download (best effort heuristic)
    console.log('Searching for CSV download action...');
    const downloadTriggered = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a, button'));
      const match = candidates.find(el => {
        const t = (el.textContent || '').toLowerCase();
        const href = (el.getAttribute('href') || '').toLowerCase();
        return (
          href.endsWith('.csv') ||
          href.includes('.csv') ||
          t.includes('csv') ||
          t.includes('export') ||
          t.includes('download')
        );
      });
      if (match) {
        (match instanceof HTMLElement) && match.scrollIntoView({ block: 'center' });
        match.click();
        return true;
      }
      return false;
    });

    if (!downloadTriggered) {
      // Last resort: try clicking a "file-text / download" icon wrapper
      await page.click('a[download], a[href*=".csv" i]').catch(() => {});
    }

    // Wait for CSV to appear in download dir
    const start = Date.now();
    let latestCsv = null;
    while (Date.now() - start < timeoutMs) {
      const files = fs.readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.csv'));
      if (files.length > 0) {
        // pick newest
        const full = files
          .map(f => ({ f, p: path.join(outDir, f), m: fs.statSync(path.join(outDir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m);
        latestCsv = full[0].p;
        // ensure file is not still being written (simple stability check)
        const size1 = fs.statSync(latestCsv).size;
        await sleep(500);
        const size2 = fs.statSync(latestCsv).size;
        if (size2 > 0 && size2 === size1) break;
      }
      await sleep(500);
    }

    if (!latestCsv) throw new Error(`CSV download not detected within ${timeoutMs}ms`);
    console.log(`Downloaded CSV: ${latestCsv}`);
    return latestCsv;
  } finally {
    await browser.close();
  }
}

function parseDeviceSystemCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });

  const products = [];
  for (const row of records) {
    const normalized = normalizeRow(row);
    // Skip rows without SKU
    if (!normalized.sku) continue;
    products.push(normalized);
  }
  return products;
}

async function main() {
  const sourceUrl = process.env.MS_SOURCE_URL || DEFAULT_SOURCE_URL;
  const outDir = path.join(__dirname, '../../data');

  const csvPath =
    process.env.DEVICESYSTEM_CSV_PATH ||
    (await downloadDeviceSystemCsv({
      sourceUrl,
      downloadDir: process.env.DEVICESYSTEM_DOWNLOAD_DIR || outDir,
      username: process.env.MS_USERNAME,
      password: process.env.MS_PASSWORD,
      timeoutMs: Number(process.env.MS_TIMEOUT_MS) || 90000
    }));

  console.log(`Parsing CSV: ${csvPath}`);
  const products = parseDeviceSystemCsv(csvPath);

  const exportPath = path.join(outDir, 'devicesystem-products.json');
  fs.writeFileSync(exportPath, JSON.stringify(products, null, 2));
  console.log(`Wrote ${products.length} products to ${exportPath}`);

  await pushBatchesToWebshop(products, {
    url: process.env.WEBSHOP_WEBHOOK_URL,
    token: process.env.WEBSHOP_WEBHOOK_TOKEN,
    batchSize: Number(process.env.WEBSHOP_BATCH_SIZE) || 50,
    delayMs: Number(process.env.WEBSHOP_BATCH_DELAY_MS) || 250,
    dryRun: String(process.env.DRY_RUN || '').toLowerCase() === 'true'
  });
}

if (require.main === module) {
  main().catch(err => {
    if (String(err?.message || '').includes('Could not find Chrome')) {
      console.error(
        [
          '',
          'Puppeteer browser not found.',
          '- Option A: install a bundled browser: `npx puppeteer browsers install chrome`',
          '- Option B: set `PUPPETEER_EXECUTABLE_PATH` to your system Chromium/Chrome binary',
          ''
        ].join('\n')
      );
    }
    console.error(err);
    process.exit(1);
  });
}

