/**
 * Scrapes structured data from a Playwright page using browser evaluation.
 * Extracts title, url, metadata, headings, tables, links, images, paragraphs, and JSON-LD data.
 * 
 * @param {import('playwright').Page} page - The active Playwright page.
 * @returns {Promise<Object>} The structured scraped data.
 */
async function scrapePage(page) {
  if (!page) {
    throw new Error('Playwright page is not initialized or active.');
  }

  // Fetch title and URL from Node context in case page evaluates asynchronously
  const title = await page.title().catch(() => '');
  const url = page.url();

  // Evaluate the page in the headed browser context to extract elements
  const scrapedData = await page.evaluate(() => {
    // 1. Extract Meta tags
    const meta = {};
    document.querySelectorAll('meta').forEach(el => {
      const name = el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('itemprop');
      const content = el.getAttribute('content');
      if (name && content) {
        meta[name] = content;
      }
    });

    // 2. Extract Headings hierarchy
    const headings = [];
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
      const text = el.innerText.trim();
      if (text) {
        headings.push({
          tag: el.tagName,
          text: text
        });
      }
    });

    // 3. Extract Tables
    const tables = [];
    document.querySelectorAll('table').forEach((table, index) => {
      const tableData = { index: index + 1, headers: [], rows: [] };
      
      // Parse Table headers (th elements)
      table.querySelectorAll('tr th').forEach(th => {
        tableData.headers.push(th.innerText.trim());
      });
      
      // If no explicit <th> headers found, check first row
      if (tableData.headers.length === 0) {
        const firstRow = table.querySelector('tr');
        if (firstRow) {
          firstRow.querySelectorAll('td').forEach(td => {
            tableData.headers.push(td.innerText.trim());
          });
        }
      }

      // Parse Table body rows (td elements)
      table.querySelectorAll('tr').forEach(tr => {
        const row = [];
        tr.querySelectorAll('td').forEach(td => {
          row.push(td.innerText.trim());
        });
        
        // Skip first row if it was used as headers
        if (row.length > 0) {
          const isHeaderRow = tableData.headers.length > 0 && 
            row.every((val, idx) => val === tableData.headers[idx]);
          if (!isHeaderRow) {
            tableData.rows.push(row);
          }
        }
      });

      // Only save tables that have rows or headers
      if (tableData.headers.length > 0 || tableData.rows.length > 0) {
        tables.push(tableData);
      }
    });

    // 4. Extract Hyperlinks
    const links = [];
    const seenLinks = new Set();
    document.querySelectorAll('a').forEach(el => {
      const href = el.getAttribute('href');
      const text = el.innerText.trim();
      if (href && text && !seenLinks.has(href)) {
        seenLinks.add(href);
        // Clean relative URLs
        let fullHref = href;
        try {
          fullHref = new URL(href, window.location.href).href;
        } catch (_) {}
        links.push({ text, href: fullHref });
      }
    });

    // 5. Extract Images
    const images = [];
    const seenImages = new Set();
    document.querySelectorAll('img').forEach(el => {
      const src = el.getAttribute('src');
      const alt = el.getAttribute('alt') || '';
      if (src && !seenImages.has(src)) {
        seenImages.add(src);
        let fullSrc = src;
        try {
          fullSrc = new URL(src, window.location.href).href;
        } catch (_) {}
        images.push({ alt, src: fullSrc });
      }
    });

    // 6. Extract JSON-LD (Schema.org / Product data)
    const jsonLd = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const text = el.innerText.trim();
        if (text) {
          const parsed = JSON.parse(text);
          jsonLd.push(parsed);
        }
      } catch (e) {
        // Ignore parsing errors for malformed schema scripts
      }
    });

    // 7. Extract main text paragraphs (filtered for substantial text elements)
    const paragraphs = [];
    document.querySelectorAll('p, article span, main span').forEach(el => {
      const text = el.innerText.trim();
      if (text.length > 35 && !paragraphs.includes(text)) {
        paragraphs.push(text);
      }
    });

    // 8. E-commerce Card Heuristic Extraction
    const ecommerceCards = [];
    const cardSelectors = [
      'div[data-component-type="s-search-result"]', // Amazon
      '.s-result-item', // Amazon general
      'div._1AtVbE', 'div._13oc-S', 'div._4ddWPI', 'div._75nlfW', 'div[data-id]', // Flipkart
      '.product-card', '.product-item', '.product', '.card', '.item', // Generic
      'li.product', 'li.item', 'div.product'
    ];

    let candidates = [];
    cardSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (!candidates.includes(el)) {
            candidates.push(el);
          }
        });
      } catch(_) {}
    });

    // Fallback: match any div containing a price and a link
    if (candidates.length === 0) {
      document.querySelectorAll('div').forEach(el => {
        if (el.children.length > 1 && el.children.length < 50) {
          const text = el.innerText || '';
          if (text.includes('₹') || text.match(/\$\d+/)) {
            if (el.querySelector('a')) {
              candidates.push(el);
            }
          }
        }
      });
    }

    // Filter out any candidate that is a child of another candidate (keep outermost card containers)
    candidates = candidates.filter(el => {
      let parent = el.parentElement;
      while (parent) {
        if (candidates.includes(parent)) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });

    candidates.forEach(card => {
      const cardText = card.innerText ? card.innerText.trim() : '';
      if (!cardText || cardText.length < 30) return;

      // Extract Title
      let title = '';
      const headingEl = card.querySelector('h2, h3, h4, [class*="title" i], [class*="name" i]');
      if (headingEl) {
        title = headingEl.innerText.trim();
      } else {
        // Fallback: search all anchor tags in the card and take the first one with substantial text
        const anchors = card.querySelectorAll('a');
        for (const a of anchors) {
          const text = a.innerText ? a.innerText.trim() : '';
          if (text.length > 15 && !text.toLowerCase().includes('compare')) {
            title = text;
            break;
          }
        }
      }
      
      // Clean duplicate carriage returns in title
      if (title) {
        title = title.replace(/\s+/g, ' ');
      }
      if (!title || title.length < 5) return;

      // Extract Price
      let priceText = null;
      let originalPriceText = null;
      const priceRegex = /(?:₹|Rs\.?|\$)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
      const priceMatches = cardText.match(priceRegex);
      if (priceMatches && priceMatches.length > 0) {
        // Filter unique values to prevent duplicates from offscreen spans
        const uniquePrices = [];
        priceMatches.forEach(p => {
          const normalized = p.replace(/\s+/g, '');
          if (!uniquePrices.includes(normalized)) {
            uniquePrices.push(normalized);
          }
        });
        priceText = uniquePrices[0];
        if (uniquePrices.length > 1) {
          originalPriceText = uniquePrices[1];
        }
      } else {
        const priceEl = card.querySelector('[class*="price" i], [id*="price" i]');
        if (priceEl) {
          priceText = priceEl.innerText.trim();
        }
      }

      // Extract Link (prioritize direct /dp/ or /gp/product/ over /sspa/click)
      let productUrl = '';
      const directLink = card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"]');
      const fallbackLink = card.querySelector('a[href*="/p/"], a[href*="product"], a[href*="item"], a[href*="/sspa/click"], a[href]');
      const linkEl = directLink || fallbackLink;

      if (linkEl) {
        const href = linkEl.getAttribute('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, window.location.href).href;
            if (absoluteUrl.includes('amazon.')) {
              const dpMatch = absoluteUrl.match(/\/dp\/([A-Z0-9]{10})/i) || absoluteUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
              if (dpMatch) {
                productUrl = `https://${new URL(absoluteUrl).hostname}/dp/${dpMatch[1]}`;
              } else if (absoluteUrl.includes('/sspa/click')) {
                const destUrl = new URL(absoluteUrl).searchParams.get('url');
                if (destUrl) {
                  const decoded = decodeURIComponent(destUrl);
                  const asinMatch = decoded.match(/\/dp\/([A-Z0-9]{10})/i) || decoded.match(/\/gp\/product\/([A-Z0-9]{10})/i);
                  if (asinMatch) {
                    productUrl = `https://${new URL(absoluteUrl).hostname}/dp/${asinMatch[1]}`;
                  }
                }
              } else {
                productUrl = absoluteUrl.split('?')[0];
              }
            } else {
              productUrl = absoluteUrl;
            }
          } catch (_) {
            productUrl = href;
          }
        }
      }

      // Extract Rating
      let ratingText = null;
      const ratingRegex = /([0-9.]+)\s*out of\s*5/i;
      const ratingMatch = cardText.match(ratingRegex);
      if (ratingMatch) {
        ratingText = ratingMatch[1];
      } else {
        const ratingEl = card.querySelector('[class*="rating" i], [class*="star" i], [aria-label*="star" i], [aria-label*="rating" i]');
        if (ratingEl) {
          const aria = ratingEl.getAttribute('aria-label') || '';
          const ariaMatch = aria.match(/([0-9.]+)/);
          ratingText = ariaMatch ? ariaMatch[1] : ratingEl.innerText.trim();
        }
      }

      // Extract Review Count
      let reviewsText = null;
      const reviewsEl = card.querySelector('.s-underline-text, [class*="review-count" i], [class*="reviews-count" i], a[href*="customerReviews"], a[href*="reviews"]');
      if (reviewsEl) {
        reviewsText = reviewsEl.getAttribute('aria-label') || reviewsEl.innerText.trim();
      }

      // Determine if Sponsored
      const isSponsored = /sponsored|ad\b|promoted/i.test(cardText);

      ecommerceCards.push({
        title,
        priceText,
        originalPriceText,
        url: productUrl,
        ratingText,
        reviewsText,
        isSponsored
      });
    });

    return {
      meta,
      headings,
      tables,
      links,
      images,
      jsonLd,
      paragraphs,
      products: ecommerceCards
    };
  });

  // Limit response payload sizes to maintain snappy performance
  return {
    title,
    url,
    timestamp: new Date().toISOString(),
    meta: scrapedData.meta,
    headings: scrapedData.headings,
    tables: scrapedData.tables,
    links: scrapedData.links.slice(0, 100),
    images: scrapedData.images.slice(0, 50),
    jsonLd: scrapedData.jsonLd,
    paragraphs: scrapedData.paragraphs.slice(0, 50),
    products: scrapedData.products
  };
}

module.exports = {
  scrapePage
};
