const http = require('http');

const PLAYWRIGHT_SERVER = 'http://localhost:2001';

function postRequest(url, data) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const body = data ? JSON.stringify(data) : '';
    const reqOptions = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = http.request(reqOptions, (res) => {
      let bodyData = '';
      res.on('data', (chunk) => { bodyData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(bodyData));
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse JSON response', raw: bodyData });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getRequest(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let bodyData = '';
      res.on('data', (chunk) => { bodyData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(bodyData));
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse JSON response', raw: bodyData });
        }
      });
    }).on('error', reject);
  });
}

/**
 * Translates natural language query to Playwright JS code on port 2001.
 */
async function runAiMode(query) {
  console.log(`[Function: AI Mode] Translating query: "${query}"...`);
  const translateRes = await postRequest(`${PLAYWRIGHT_SERVER}/translate`, { task: query });
  if (!translateRes.success || !translateRes.code) {
    throw new Error(translateRes.error || 'Failed to translate instruction');
  }
  return translateRes.code;
}

/**
 * Executes a Playwright JS script on port 2001.
 */
async function executeCode(code) {
  console.log(`[Function] Forwarding execute request to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/execute`, { code });
}

/**
 * Resets the browser session on port 2001.
 */
async function resetBrowser(channel) {
  console.log(`[Function] Forwarding reset browser request (channel: ${channel}) to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/reset`, { channel });
}

/**
 * Fetches the active screenshot from port 2001.
 */
async function fetchScreenshot() {
  return await getRequest(`${PLAYWRIGHT_SERVER}/screenshot`);
}

/**
 * Restarts the server on port 2001 to open the live headed browser.
 */
async function openLiveBrowser() {
  console.log(`[Function] Forwarding open-live-browser request to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/open-live-browser`);
}

/**
 * Scrapes raw DOM elements from the active browser page on port 2001.
 */
async function scrapePage() {
  console.log(`[Function] Forwarding scrape request to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/scrape`, null);
}

/**
 * Cleans scraped raw DOM data using the LLM on port 2001 (buffers streaming completions to resolve with final JSON).
 */
async function cleanScrapedData(scrapedData, commands = [], maxLinks = 10) {
  const limit = parseInt(maxLinks) > 0 ? parseInt(maxLinks) : 10;
  console.log(`[Function] Requesting clean-data on port 2001 (maxLinks: ${limit})...`);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ scrapedData, commands, maxLinks: limit });
    const parsedUrl = new URL(`${PLAYWRIGHT_SERVER}/clean-data`);
    const reqOptions = {
      method: 'POST',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = http.request(reqOptions, (res) => {
      let accumulatedText = '';
      res.on('data', (chunk) => {
        accumulatedText += chunk.toString();
      });
      res.on('end', () => {
        try {
          if (accumulatedText.includes('__FINAL_DATA__')) {
            const parts = accumulatedText.split('__FINAL_DATA__');
            const finalPayloadStr = parts[1].trim();
            const finalJson = JSON.parse(finalPayloadStr);
            if (finalJson.success) {
              resolve(finalJson.cleanData);
            } else {
              reject(new Error(finalJson.error || 'Clean data returned unsuccessful state'));
            }
          } else {
            // Check if it is a direct JSON error object (no streaming occurred)
            const fallbackJson = JSON.parse(accumulatedText);
            if (fallbackJson && fallbackJson.error) {
              reject(new Error(fallbackJson.error));
            } else {
              reject(new Error('Delimiter __FINAL_DATA__ not found in stream response'));
            }
          }
        } catch (err) {
          reject(new Error(`Failed to parse clean-data response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Exports cleaned product JSON data to Google Sheets tab name.
 */
async function exportToSheets(sheetName, cleanData) {
  console.log(`[Function] Forwarding export-sheets request to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/export-sheets`, { sheetName, cleanData });
}

/**
 * Fetches list of tab names from Google Sheets.
 */
async function getSheetsList() {
  console.log(`[Function] Forwarding get-sheets request to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/get-sheets`, null);
}

/**
 * Reads records from selected Google Sheet tab names.
 */
async function readSheetsData(sheetNames) {
  console.log(`[Function] Forwarding read-sheets request to port 2001...`);
  return await postRequest(`${PLAYWRIGHT_SERVER}/read-sheets`, { sheetNames });
}

/**
 * Connects to Google Sheets and fetches list of tab names.
 */
async function connectGoogleSheets() {
  console.log(`[Function] Connecting to Google Sheets and fetching tabs...`);
  return await getSheetsList();
}

/**
 * Reads a sheet, sorts its data by a given column and direction, and exports it to a new separate sheet tab.
 */
async function sortSheetData(sheetName, sortBy = 'price', direction = 'asc', maxTabs = null) {
  console.log(`[Function] Sorting sheet "${sheetName}" by "${sortBy}" (${direction})...`);
  
  // 1. Read existing sheet data
  const sheetRes = await readSheetsData([sheetName]);
  const data = (sheetRes && sheetRes.data) ? sheetRes.data : sheetRes;
  let products = data ? data[sheetName] : null;

  // Fallback: search case-insensitively or take first tab's data
  if (!products && data && typeof data === 'object') {
    const matchedKey = Object.keys(data).find(k => k.toLowerCase() === sheetName.toLowerCase());
    if (matchedKey) products = data[matchedKey];
    else if (Object.values(data).length > 0 && Array.isArray(Object.values(data)[0])) {
      products = Object.values(data)[0];
    }
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    throw new Error(`No products found or failed to read sheet "${sheetName}"`);
  }
  
  // 2. Perform sorting
  products.sort((a, b) => {
    const valA = typeof a[sortBy] === 'number' ? a[sortBy] : parseFloat(a[sortBy]) || 0;
    const valB = typeof b[sortBy] === 'number' ? b[sortBy] : parseFloat(b[sortBy]) || 0;
    return direction.toLowerCase() === 'asc' ? valA - valB : valB - valA;
  });
  
  // 3. Define new tab name
  const dirLabel = direction.toLowerCase() === 'asc' ? 'Asc' : 'Desc';
  const newTabName = `${sheetName} Sorted ${sortBy.charAt(0).toUpperCase() + sortBy.slice(1)} ${dirLabel}`;
  
  // 4. Export sorted data back to sheets
  const exportResult = await exportToSheets(newTabName, { products });

  // 5. Open sorted product links in separate browser tabs respecting Browser Tab Manager setting!
  const productUrls = products.map(p => p.url).filter(u => u && typeof u === 'string' && u.startsWith('http'));
  let tabMessage = '';
  if (productUrls.length > 0) {
    const tabLimit = (maxTabs !== null && maxTabs !== undefined && parseInt(maxTabs) > 0)
      ? parseInt(maxTabs)
      : productUrls.length;

    console.log(`[Function] Opening ${Math.min(tabLimit, productUrls.length)} of ${productUrls.length} sorted products in separate browser tabs...`);
    const tabRes = await postRequest(`${PLAYWRIGHT_SERVER}/open-product-tabs`, {
      urls: productUrls,
      maxTabs: tabLimit
    });
    if (tabRes && tabRes.success) {
      tabMessage = ` and opened ${tabRes.openedCount} product tabs in the browser`;
    }
  }

  return {
    success: true,
    newTabName,
    message: `Successfully sorted sheet "${sheetName}" by "${sortBy}" (${direction}), exported to tab "${newTabName}"${tabMessage}!`,
    spreadsheetUrl: exportResult.spreadsheetUrl
  };
}

/**
 * Deterministically extracts data using DOM Management & Accessibility on Port 2001.
 */
async function getDomData(options = {}) {
  const result = await postRequest(`${PLAYWRIGHT_SERVER}/get-dom-data`, options);
  return result;
}

/**
 * Retrieves the list of open tabs in the headed browser from port 2001.
 */
async function listTabs() {
  return await postRequest(`${PLAYWRIGHT_SERVER}/list-tabs`);
}

/**
 * Switches the active tab in the headed browser on port 2001.
 */
async function switchTab(index) {
  return await postRequest(`${PLAYWRIGHT_SERVER}/switch-tab`, { index });
}

module.exports = {
  runAiMode,
  executeCode,
  resetBrowser,
  fetchScreenshot,
  openLiveBrowser,
  scrapePage,
  cleanScrapedData,
  getDomData,
  exportToSheets,
  getSheetsList,
  readSheetsData,
  connectGoogleSheets,
  sortSheetData,
  listTabs,
  switchTab
};

