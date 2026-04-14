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

    // Also detect CSV via network response (more reliable than download behavior).
    // IMPORTANT: never throw on timeout; fallback to filesystem download detection.
    const recentRequestUrls = [];
    page.on('request', req => {
      try {
        const u = req.url();
        if (!u) return;
        const lu = u.toLowerCase();
        if (lu.includes('devicesystem') || lu.includes('export') || lu.includes('download') || lu.includes('.csv')) {
          recentRequestUrls.push(u);
          if (recentRequestUrls.length > 200) recentRequestUrls.shift();
        }
      } catch {}
    });

    const csvFromNetworkPromise = new Promise(resolve => {
      const timer = setTimeout(() => {
        page.off('response', onResponse);
        resolve(null);
      }, timeoutMs);

      const onResponse = async res => {
        try {
          const url = res.url() || '';
          const headers = res.headers();
          const ct = String(headers['content-type'] || '').toLowerCase();
          const cd = String(headers['content-disposition'] || '').toLowerCase();

          const looksLikeCsv =
            url.toLowerCase().includes('.csv') ||
            ct.includes('text/csv') ||
            ct.includes('application/csv') ||
            cd.includes('.csv') ||
            cd.includes('attachment');

          if (!looksLikeCsv) return;

          const buf = await res.buffer().catch(() => null);
          if (!buf || buf.length < 50) return;

          const filename = `devicesystem_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
          const outPath = path.join(outDir, filename);
          fs.writeFileSync(outPath, buf);
          clearTimeout(timer);
          page.off('response', onResponse);
          resolve(outPath);
        } catch {
          // ignore
        }
      };

      page.on('response', onResponse);
    });

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

    // Direct-link attempt: find any likely export/download URL and open it.
    // This often triggers the CSV response even when buttons are hard to click.
    const candidateHref = await page
      .evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const scored = anchors
          .map(a => {
            const href = String(a.getAttribute('href') || '');
            const text = String(a.textContent || '');
            const hay = (href + ' ' + text).toLowerCase();
            const score =
              (hay.includes('devicesystem') ? 5 : 0) +
              (hay.includes('export') ? 4 : 0) +
              (hay.includes('download') ? 3 : 0) +
              (hay.includes('.csv') ? 10 : 0) +
              (hay.includes('csv') ? 6 : 0);
            return { href, score };
          })
          .filter(x => x.href && x.score > 0)
          .sort((a, b) => b.score - a.score);
        return scored[0]?.href || null;
      })
      .catch(() => null);

    if (candidateHref) {
      try {
        const absolute = new URL(candidateHref, page.url()).toString();
        console.log(`Found candidate export link: ${absolute}`);
        await page.goto(absolute, { waitUntil: 'networkidle2', timeout: timeoutMs }).catch(() => {});
      } catch {
        // ignore
      }
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
      await page.click('a[download], a[href*=\".csv\" i]').catch(() => {});

      // Try some common icon/button wrappers
      await page
        .evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('a, button, span, i'));
          const icon = candidates.find(el => {
            const cls = (el.getAttribute('class') || '').toLowerCase();
            const t = (el.textContent || '').toLowerCase();
            return cls.includes('download') || cls.includes('file-text') || t.includes('download');
          });
          if (icon) {
            (icon instanceof HTMLElement) && icon.click();
            return true;
          }
          return false;
        })
        .catch(() => {});

      // Try specific icon class seen on site dumps
      await page
        .evaluate(() => {
          const el =
            document.querySelector('.download-black') ||
            document.querySelector('[class*="download-black" i]') ||
            document.querySelector('[class*="file-text" i]') ||
            document.querySelector('[class*="download" i]');
          if (el) {
            (el instanceof HTMLElement) && el.click();
            return true;
          }
          return false;
        })
        .catch(() => {});

      // Try common export/download attributes
      await page
        .evaluate(() => {
          const sels = [
            '[aria-label*="download" i]',
            '[aria-label*="export" i]',
            '[title*="download" i]',
            '[title*="export" i]',
            '[data-action*="download" i]',
            '[data-action*="export" i]'
          ];
          for (const sel of sels) {
            const el = document.querySelector(sel);
            if (el) {
              (el instanceof HTMLElement) && el.click();
              return true;
            }
          }
          return false;
        })
        .catch(() => {});
    }

    // Wait for CSV via network OR filesystem download
    const start = Date.now();
    let latestCsv = null;

    while (Date.now() - start < timeoutMs && !latestCsv) {
      // Prefer network-captured CSV if it resolved
      const maybeNetwork = await Promise.race([
        csvFromNetworkPromise.then(p => ({ ok: true, p })).catch(() => ({ ok: false })),
        sleep(500).then(() => ({ ok: false }))
      ]);
      if (maybeNetwork.ok) {
        latestCsv = maybeNetwork.p;
        break;
      }

      const files = fs.readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.csv'));
      if (files.length > 0) {
        const full = files
          .map(f => ({ p: path.join(outDir, f), m: fs.statSync(path.join(outDir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m);
        const candidate = full[0].p;
        const size1 = fs.statSync(candidate).size;
        await sleep(400);
        const size2 = fs.statSync(candidate).size;
        if (size2 > 0 && size2 === size1) {
          latestCsv = candidate;
          break;
        }
      }
    }

    if (!latestCsv) {
      // Debug artifacts to help diagnose selector/flow differences in production
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const debugHtmlPath = path.join(outDir, `mobilesentrix_devicesystem_debug_${stamp}.html`);
      const debugPngPath = path.join(outDir, `mobilesentrix_devicesystem_debug_${stamp}.png`);
      const debugMetaPath = path.join(outDir, `mobilesentrix_devicesystem_debug_${stamp}.txt`);

      try {
        const html = await page.content();
        fs.writeFileSync(debugHtmlPath, html);
      } catch {}

      try {
        await page.screenshot({ path: debugPngPath, fullPage: true });
      } catch {}

      try {
        const topAnchors = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          return anchors
            .map(a => {
              const href = String(a.getAttribute('href') || '');
              const text = String(a.textContent || '').trim().slice(0, 120);
              const hay = (href + ' ' + text).toLowerCase();
              const score =
                (hay.includes('devicesystem') ? 5 : 0) +
                (hay.includes('export') ? 4 : 0) +
                (hay.includes('download') ? 3 : 0) +
                (hay.includes('.csv') ? 10 : 0) +
                (hay.includes('csv') ? 6 : 0);
              return { href, text, score };
            })
            .filter(x => x.href && x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 20);
        });

        const lines = [];
        lines.push(`page_url=${page.url()}`);
        lines.push(`candidateHref=${candidateHref || ''}`);
        lines.push('');
        lines.push('top_anchor_candidates=');
        for (const a of topAnchors) lines.push(`${a.score}\t${a.href}\t${a.text}`);
        lines.push('');
        lines.push('recent_request_urls=');
        for (const u of recentRequestUrls.slice(-50)) lines.push(u);
        fs.writeFileSync(debugMetaPath, lines.join('\n'));
      } catch {}

      throw new Error(
        `CSV download not detected within ${timeoutMs}ms (debug saved: ${path.basename(debugHtmlPath)}, ${path.basename(
          debugPngPath
        )}, ${path.basename(debugMetaPath)})`
      );
    }
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

