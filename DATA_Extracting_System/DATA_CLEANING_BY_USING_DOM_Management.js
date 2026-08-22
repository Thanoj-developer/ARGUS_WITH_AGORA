/**
 * DATA_Extracting_System/DATA_CLEANING_BY_USING_DOM_Management.js
 * 
 * Deterministic DOM & Accessibility Tree Data Extraction Engine.
 * Extracts clean, structured JSON records from live web pages (E-Commerce, Job Portals, etc.)
 * with ZERO external LLM API dependencies and sub-second execution latency.
 */

const { captureAccessibilitySnapshot } = require('../DOM_ACCESSBILITY/Capturing_DOM_Snapshot');

// Non-content noise roles to filter out
const NOISE_ROLES = new Set([
  'banner',
  'navigation',
  'contentinfo',
  'footer',
  'search',
  'dialog',
  'alertdialog',
  'menu',
  'menubar',
  'toolbar'
]);

/**
 * Normalizes and canonicalizes e-commerce product URLs (e.g. Amazon ASIN, Flipkart /p/).
 * Strips tracking parameters, ref tags, and session IDs.
 */
function cleanProductUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  try {
    let fullUrl = rawUrl;
    if (baseUrl && !rawUrl.startsWith('http')) {
      fullUrl = new URL(rawUrl, baseUrl).href;
    }

    const urlObj = new URL(fullUrl);

    // Amazon: Canonicalize to /dp/{ASIN}
    if (urlObj.hostname.includes('amazon.')) {
      const asinMatch = fullUrl.match(/\/dp\/([A-Z0-9]{10})/i) || fullUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (asinMatch) {
        return `https://${urlObj.hostname}/dp/${asinMatch[1].toUpperCase()}`;
      }
      if (fullUrl.includes('/sspa/click')) {
        const dest = urlObj.searchParams.get('url');
        if (dest) {
          const decoded = decodeURIComponent(dest);
          const redirectMatch = decoded.match(/\/dp\/([A-Z0-9]{10})/i) || decoded.match(/\/gp\/product\/([A-Z0-9]{10})/i);
          if (redirectMatch) {
            return `https://${urlObj.hostname}/dp/${redirectMatch[1].toUpperCase()}`;
          }
        }
      }
    }

    // Flipkart: Canonicalize to /p/...
    if (urlObj.hostname.includes('flipkart.')) {
      const pIndex = fullUrl.indexOf('/p/');
      if (pIndex !== -1) {
        const qIndex = fullUrl.indexOf('?', pIndex);
        return qIndex !== -1 ? fullUrl.substring(0, qIndex) : fullUrl;
      }
    }

    // Generic: strip tracking query params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'ref_', 'refId', 'trackingId', 'pf_rd_r', 'qid', 'sr', 'keywords'];
    trackingParams.forEach(p => urlObj.searchParams.delete(p));
    return urlObj.href.replace(/\?$/, '');
  } catch (_) {
    return rawUrl;
  }
}

/**
 * Normalizes price string into standard currency + numeric format (e.g. "₹899").
 */
function cleanPriceString(rawPrice) {
  if (!rawPrice) return null;
  const cleaned = String(rawPrice).trim();
  const match = cleaned.match(/(₹|Rs\.?|\$|€|£)\s*([\d,]+(?:\.\d{2})?)/i);
  if (match) {
    const symbol = match[1].startsWith('Rs') ? '₹' : match[1];
    return `${symbol}${match[2].replace(/\s+/g, '')}`;
  }
  return cleaned;
}

/**
 * Extracts rating as a clean float string (e.g. "4.2") or null.
 */
function cleanRatingString(rawRating) {
  if (!rawRating) return null;
  const match = String(rawRating).match(/([0-9]\.[0-9]|[0-9])/);
  return match ? match[1] : null;
}

/**
 * Extracts structured product items directly from the live page using browser-evaluated DOM tree.
 */
async function extractEcommerceProductsFromPage(page) {
  const baseUrl = page.url();
  
  const rawProducts = await page.evaluate(() => {
    const results = [];
    const seenTitles = new Set();

    // Select candidate cards
    const cardSelectors = [
      'div[data-component-type="s-search-result"]',
      '.s-result-item[data-asin]:not([data-asin=""])',
      'div[data-asin]:not([data-asin=""])',
      'div._1AtVbE', 'div._13oc-S', 'div._4ddWPI', 'div._75nlfW', 'div[data-id]',
      '.product-card', '.product-item', '.product', 'li.product', 'article.product'
    ];

    let candidateElements = [];
    cardSelectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (!candidateElements.includes(el)) candidateElements.push(el);
        });
      } catch (_) {}
    });

    // Fallback: containers with price and link
    if (candidateElements.length === 0) {
      document.querySelectorAll('div, article, li').forEach(el => {
        if (el.children.length >= 2 && el.children.length <= 40) {
          const text = el.innerText || '';
          if ((text.includes('₹') || text.includes('$') || text.includes('Rs')) && el.querySelector('a')) {
            candidateElements.push(el);
          }
        }
      });
    }

    // Filter out parent/child overlaps
    candidateElements = candidateElements.filter(el => {
      let p = el.parentElement;
      while (p) {
        if (candidateElements.includes(p)) return false;
        p = p.parentElement;
      }
      return true;
    });

    candidateElements.forEach(card => {
      const cardText = (card.innerText || '').trim();
      if (!cardText || cardText.length < 20) return;

      // 1. Extract Title
      let title = '';
      const heading = card.querySelector('h2, h3, h4, [class*="title" i], [class*="name" i]');
      if (heading) {
        title = heading.innerText.trim();
      } else {
        const anchors = card.querySelectorAll('a');
        for (const a of anchors) {
          const t = (a.innerText || '').trim();
          if (t.length > 15 && !t.toLowerCase().includes('compare') && !t.toLowerCase().includes('sponsor')) {
            title = t;
            break;
          }
        }
      }

      if (!title || title.length < 5) return;
      title = title.replace(/\s+/g, ' ');

      if (seenTitles.has(title.toLowerCase())) return;
      seenTitles.add(title.toLowerCase());

      // 2. Extract Product URL
      let href = '';
      const linkEl = card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], a[href*="/p/"], a[href*="product"], a[href]');
      if (linkEl) {
        href = linkEl.getAttribute('href') || '';
      }

      // 3. Extract Price
      let price = '';
      const priceRegex = /(?:₹|Rs\.?|\$|€|£)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i;
      const priceMatch = cardText.match(priceRegex);
      if (priceMatch) {
        price = priceMatch[0];
      } else {
        const priceEl = card.querySelector('[class*="price" i], [id*="price" i]');
        if (priceEl) price = priceEl.innerText.trim();
      }

      // 4. Extract Rating
      let rating = null;
      const ratingMatch = cardText.match(/([0-9.]+)\s*(?:out of\s*5|★|\*|\/5)/i) || cardText.match(/\b([3-5]\.[0-9])\b/);
      if (ratingMatch) {
        rating = ratingMatch[1];
      } else {
        const ratingEl = card.querySelector('[class*="rating" i], [class*="star" i], [aria-label*="star" i]');
        if (ratingEl) {
          const aria = ratingEl.getAttribute('aria-label') || ratingEl.innerText || '';
          const m = aria.match(/([0-9.]+)/);
          if (m) rating = m[1];
        }
      }

      results.push({
        text: title,
        href,
        price,
        rating
      });
    });

    return results;
  });

  // Normalize all extracted records
  return rawProducts.map(p => ({
    text: p.text,
    href: cleanProductUrl(p.href, baseUrl),
    price: cleanPriceString(p.price) || 'N/A',
    rating: cleanRatingString(p.rating)
  })).filter(p => p.text && p.href);
}

/**
 * Extracts structured job listings (for Job Portals like LinkedIn, Indeed, Naukri).
 */
async function extractJobsFromPage(page) {
  const baseUrl = page.url();

  const rawJobs = await page.evaluate(() => {
    const results = [];
    const cardSelectors = [
      '.job-card-container', '.jobsearch-ResultsList > li', '.srp-jobtuple-wrapper',
      'article.job', '.job-item', 'li[data-occludable-job-id]'
    ];

    let cards = [];
    cardSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (!cards.includes(el)) cards.push(el);
      });
    });

    cards.forEach(card => {
      const heading = card.querySelector('h2, h3, .job-title, [class*="title" i]');
      const title = heading ? heading.innerText.trim() : '';
      if (!title) return;

      const linkEl = card.querySelector('a[href*="job"], a[href*="viewjob"], a');
      const href = linkEl ? linkEl.getAttribute('href') : '';

      const companyEl = card.querySelector('.company-name, [class*="company" i], .employer');
      const company = companyEl ? companyEl.innerText.trim() : 'Unknown';

      const locationEl = card.querySelector('.job-location, [class*="location" i]');
      const location = locationEl ? locationEl.innerText.trim() : 'Not specified';

      const salaryEl = card.querySelector('.salary, [class*="salary" i], .pay');
      const salary = salaryEl ? salaryEl.innerText.trim() : null;

      results.push({
        title,
        company,
        location,
        salary,
        href
      });
    });

    return results;
  });

  return rawJobs.map(j => ({
    ...j,
    href: cleanProductUrl(j.href, baseUrl)
  }));
}

/**
 * Main Entrypoint: Deterministically extracts data using DOM Management & Accessibility.
 * Automatically detects e-commerce or job portal contexts.
 * 
 * @param {import('playwright').Page} page - Active Playwright Page.
 * @param {Object} options - Options (type: 'ecommerce' | 'jobs' | 'auto').
 * @returns {Promise<Array<Object>>} Structured clean JSON records.
 */
async function extractDataByDomManagement(page, options = {}) {
  if (!page) {
    throw new Error('Active Playwright page is required for DOM data extraction.');
  }

  const url = page.url().toLowerCase();
  const pageType = options.type || (url.includes('job') || url.includes('naukri') || url.includes('indeed') || url.includes('linkedin') ? 'jobs' : 'ecommerce');

  console.log(`[DOM Data Extraction] Running deterministic extraction for type: "${pageType}" on ${page.url()}...`);

  let data = [];
  if (pageType === 'jobs') {
    data = await extractJobsFromPage(page);
  } else {
    data = await extractEcommerceProductsFromPage(page);
  }

  console.log(`[DOM Data Extraction] Successfully extracted ${data.length} clean structured records.`);
  return data;
}

module.exports = {
  extractDataByDomManagement,
  cleanProductUrl,
  cleanPriceString,
  cleanRatingString,
  extractEcommerceProductsFromPage,
  extractJobsFromPage
};
