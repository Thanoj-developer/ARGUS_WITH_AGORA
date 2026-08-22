const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Target Configuration
const CONFIG = {
  targetSite: 'https://www.amazon.in',
  searchQuery: 'trimmers',
  priceLimit: 1000, // INR
  targetProductCount: 25
};

async function run() {
  console.log(`Starting scraper for ${CONFIG.searchQuery} on ${CONFIG.targetSite} under ${CONFIG.priceLimit} INR...`);

  // Launch browser (headed mode to bypass easy automation checks)
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });
  const context = await browser.newContext({
    viewport: null,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  
  // Calculate native filter value: max price in paise (1 INR = 100 paise)
  // Query param format: rh=p_36%3A-[MaxPriceInPaise]
  const maxPriceInPaise = CONFIG.priceLimit * 100;
  const filterParam = `p_36%3A-${maxPriceInPaise}`;
  
  // Construct starting URL with search query and native budget query parameter
  const startUrl = `${CONFIG.targetSite}/s?k=${encodeURIComponent(CONFIG.searchQuery)}&rh=${encodeURIComponent(filterParam)}`;
  
  console.log(`Navigating to filtered search: ${startUrl}`);
  await page.goto(startUrl, { waitUntil: 'load', timeout: 60000 });

  let products = [];
  let seenAsins = new Set();
  let pageNum = 1;

  while (products.length < CONFIG.targetProductCount) {
    console.log(`Scraping Page ${pageNum}...`);
    
    // Scroll slowly to the bottom of the page to trigger lazy loading of images & prices
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 150;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Explicit small wait for safety and anti-throttling
    await page.waitForTimeout(2000);

    // Extract product cards from the page
    const cards = await page.locator('div[data-component-type="s-search-result"]').all();
    console.log(`Found ${cards.length} search result cards on page.`);

    for (const card of cards) {
      if (products.length >= CONFIG.targetProductCount) break;

      try {
        // Retrieve ASIN to identify sponsored widgets/carousels or duplicates
        const asin = await card.getAttribute('data-asin');
        if (!asin || seenAsins.has(asin)) {
          continue; // Skip duplicates or empty result containers
        }

        // Check if card is sponsored
        const isSponsored = await card.locator('.puis-sponsored-label-text, .s-sponsored-label-info-icon').count() > 0;
        if (isSponsored) {
          continue; // Skip sponsored results as requested
        }

        // 1. Title
        let title = '';
        const titleEl = card.locator('h2 a span, .a-size-base-plus.a-color-base.a-text-normal, .a-size-medium.a-color-base.a-text-normal').first();
        if (await titleEl.count() > 0) {
          title = (await titleEl.innerText()).trim();
        }
        if (!title) continue;
        
        // Truncate to 120 chars
        if (title.length > 120) {
          title = title.substring(0, 117) + '...';
        }

        // 2. Brand Name
        // Try getting first word as brand name fallback
        let brand = 'N/A';
        const brandMatch = title.match(/^([A-Za-z0-9]+)/);
        if (brandMatch) {
          brand = brandMatch[1];
        }

        // 3. Sale Price
        let salePrice = 'N/A';
        const priceWholeEl = card.locator('.a-price-whole').first();
        if (await priceWholeEl.count() > 0) {
          const rawPrice = await priceWholeEl.innerText();
          // Clean commas, non-digits
          const cleanedPrice = rawPrice.replace(/[^\d]/g, '');
          if (cleanedPrice) {
            salePrice = parseInt(cleanedPrice, 10);
          }
        }

        // Strictly verify price budget limit
        if (salePrice === 'N/A' || salePrice > CONFIG.priceLimit) {
          continue; // Drop if no price or exceeds limit
        }

        // 4. Original / List Price (MRP)
        let originalPrice = 'N/A';
        const origPriceEl = card.locator('.a-price.a-text-price span.a-offscreen, .a-price.a-text-price span[aria-hidden="true"]').first();
        if (await origPriceEl.count() > 0) {
          const rawOrig = await origPriceEl.innerText();
          const cleanedOrig = rawOrig.replace(/[^\d]/g, '');
          if (cleanedOrig) {
            originalPrice = parseInt(cleanedOrig, 10);
          }
        }

        // 5. Rating (Float score out of 5)
        let rating = 'N/A';
        const ratingEl = card.locator('.a-icon-alt, a.mvt-review-star-mini-popover, span[aria-label*="out of 5 stars"]').first();
        if (await ratingEl.count() > 0) {
          const rawRating = await ratingEl.getAttribute('aria-label') || await ratingEl.innerText();
          const ratingMatch = rawRating.match(/([0-9.]+)\s*out of/i);
          if (ratingMatch) {
            rating = parseFloat(ratingMatch[1]);
          }
        }

        // 6. Review Count
        let reviews = 'N/A';
        const reviewsEl = card.locator('a.s-underline-text, span.s-underline-text, a[aria-label*="ratings"]').first();
        if (await reviewsEl.count() > 0) {
          const ariaReviews = await reviewsEl.getAttribute('aria-label');
          if (ariaReviews) {
            const cleanReviews = ariaReviews.replace(/[^\d]/g, '');
            if (cleanReviews) {
              reviews = parseInt(cleanReviews, 10);
            }
          } else {
            const rawReviews = await reviewsEl.innerText();
            const cleanReviews = rawReviews.replace(/[^\d]/g, '');
            if (cleanReviews) {
              reviews = parseInt(cleanReviews, 10);
            }
          }
        }

        // 7. Clean Product URL
        const cleanUrl = `https://www.amazon.in/dp/${asin}`;

        // Save entry
        seenAsins.add(asin);
        products.push({
          sNo: products.length + 1,
          title,
          brand,
          price: salePrice,
          originalPrice,
          rating,
          reviews,
          link: cleanUrl
        });

        console.log(`Scraped: [${brand}] ${title.substring(0, 40)}... Price: ${salePrice} INR`);

      } catch (err) {
        console.error(`Error parsing card: ${err.message}`);
      }
    }

    if (products.length >= CONFIG.targetProductCount) {
      break;
    }

    // Attempt Pagination
    const nextBtn = page.locator('a.s-pagination-next, .s-pagination-next');
    if (await nextBtn.count() > 0 && await nextBtn.isVisible()) {
      console.log('Navigating to next page...');
      await nextBtn.first().click();
      await page.waitForLoadState('load');
      pageNum++;
    } else {
      console.log('No next page found. Ending scrape early.');
      break;
    }
  }

  console.log(`Scraping complete. Total products collected: ${products.length}`);
  
  // Format Results
  const markdownTable = generateMarkdownTable(products);
  const tsvData = generateTSV(products);

  // Write outputs to files in WEBSCRAPING folder
  const outputFilePath = path.join(__dirname, 'scraped_products.json');
  fs.writeFileSync(outputFilePath, JSON.stringify({ markdownTable, tsvData, rawProducts: products }, null, 2), 'utf8');
  console.log(`Saved output to ${outputFilePath}`);

  // Write raw formats to visual terminal file
  fs.writeFileSync(path.join(__dirname, 'output.txt'), `=== FORMAT A: MARKDOWN TABLE ===\n${markdownTable}\n\n=== FORMAT B: TSV ===\n${tsvData}`, 'utf8');

  await browser.close();
}

function generateMarkdownTable(products) {
  let table = '| S.No | Product Title | Brand | Price (INR) | Original Price | Rating | Reviews | Product Link |\n';
  table += '|------|---------------|-------|-------------|----------------|--------|---------|--------------|\n';
  
  for (const p of products) {
    table += `| ${p.sNo} | ${p.title.replace(/\|/g, '\\|')} | ${p.brand} | ${p.price} | ${p.originalPrice} | ${p.rating} | ${p.reviews} | [Link](${p.link}) |\n`;
  }
  return table;
}

function generateTSV(products) {
  let tsv = 'S.No\tProduct Title\tBrand\tPrice\tOriginal Price\tRating\tReviews\tProduct Link\n';
  
  for (const p of products) {
    const titleClean = p.title.replace(/\t/g, ' ').replace(/\n/g, ' ');
    const brandClean = p.brand.replace(/\t/g, ' ').replace(/\n/g, ' ');
    const hyperLink = `=HYPERLINK("${p.link}", "View Product")`;
    tsv += `${p.sNo}\t${titleClean}\t${brandClean}\t${p.price}\t${p.originalPrice}\t${p.rating}\t${p.reviews}\t${hyperLink}\n`;
  }
  return tsv;
}

run().catch(console.error);
