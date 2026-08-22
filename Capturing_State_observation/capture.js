const fs = require('fs');
const path = require('path');

/**
 * Captures the current URL, a base64 screenshot, and a DOM snippet of the page,
 * then saves the observation state as a JSON file in the same directory.
 * 
 * @param {import('playwright').Page} page - The active Playwright page.
 * @param {string} containerSelector - The DOM selector to capture (defaults to 'body').
 * @returns {Promise<{ currentUrl: string, screenshotBase64: string, domSnippet: string, timestamp: string }>}
 */
async function captureState(page, containerSelector = 'body') {
  if (!page) {
    throw new Error('[Capture] Cannot capture state: Playwright page object is undefined.');
  }

  const currentUrl = page.url();

  // Take the screenshot (base64)
  const screenshotBase64 = await page.screenshot({ encoding: 'base64' });

  // Get a snippet of the DOM innerHTML
  const domSnippet = await page.locator(containerSelector)
    .innerHTML()
    .catch(() => '')
    .then(html => html.slice(0, 5000));

  const state = {
    currentUrl,
    screenshotBase64,
    domSnippet,
    timestamp: new Date().toISOString()
  };

  // Store the state as a JSON file for checking purposes
  try {
    const outputDir = __dirname;
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const filePath = path.join(outputDir, 'latest_observation.json');
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
    console.log(`[Capture] State successfully captured and stored in: ${filePath}`);
  } catch (err) {
    console.error('[Capture] Failed to save observation JSON:', err);
  }

  return state;
}

module.exports = {
  captureState
};
