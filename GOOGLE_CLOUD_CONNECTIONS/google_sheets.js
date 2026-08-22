const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// Load environment variables
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const index = trimmed.indexOf('=');
          if (index !== -1) {
            const key = trimmed.substring(0, index).trim();
            const val = trimmed.substring(index + 1).trim();
            process.env[key] = val;
          }
        }
      }
    } catch (_) {}
  }
}
loadEnv();

/**
 * Helper to make a simple HTTPS request returning a Promise.
 */
function makeRequest(url, options, bodyData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = { ...options.headers };
    let postBody = '';

    if (bodyData) {
      postBody = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postBody);
    }

    const reqOptions = {
      method: options.method || 'POST',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers
    };

    const req = https.request(reqOptions, (res) => {
      // Handle Google Script redirect (302/301/307)
      if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          // Follow redirect with GET request and no body
          const redirectHeaders = { ...headers };
          delete redirectHeaders['Content-Type'];
          delete redirectHeaders['Content-Length'];
          resolve(makeRequest(redirectUrl, { method: 'GET', headers: redirectHeaders }, null));
          return;
        }
      }

      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: responseBody
        });
      });
    });

    req.on('error', err => reject(err));
    if (bodyData) {
      req.write(postBody);
    }
    req.end();
  });
}

/**
 * Signs a Google JWT assertion for OAuth2 using service account credentials.
 */
function getGoogleAccessToken(email, privateKey) {
  return new Promise((resolve, reject) => {
    try {
      const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      
      const claim = JSON.stringify({
        iss: email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: exp,
        iat: iat
      });

      const base64UrlEncode = (str) => {
        return Buffer.from(str)
          .toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      };

      const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(claim)}`;
      const formattedKey = privateKey.replace(/\\n/g, '\n');

      const sign = crypto.createSign('RSA-SHA256');
      sign.update(unsignedToken);
      const signature = sign.sign(formattedKey, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const signedJwt = `${unsignedToken}.${signature}`;
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const postBody = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`;

      makeRequest(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }, postBody).then(res => {
        if (!res.ok) {
          reject(new Error(`Google OAuth error (status ${res.status}): ${res.body}`));
          return;
        }
        const tokenData = JSON.parse(res.body);
        resolve(tokenData.access_token);
      }).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Normalizes any structured JSON array or object (e.g. DOM extraction output, LLM output)
 * into the standard schema expected by Google Sheets Apps Script and API.
 */
function normalizeCleanDataForSheets(cleanData) {
  if (!cleanData) return { products: [] };
  
  let rawList = [];
  if (Array.isArray(cleanData)) {
    rawList = cleanData;
  } else if (cleanData.products && Array.isArray(cleanData.products)) {
    rawList = cleanData.products;
  } else if (cleanData.data && Array.isArray(cleanData.data)) {
    rawList = cleanData.data;
  } else if (typeof cleanData === 'object') {
    rawList = Object.values(cleanData).filter(v => typeof v === 'object' && v !== null);
  }

  const products = rawList.map((item, index) => {
    const title = item.title || item.text || item.name || item.jobTitle || '';
    const url = item.url || item.href || item.link || item.jobUrl || '';
    
    // Clean numeric price
    let priceVal = item.price;
    if (typeof priceVal === 'string') {
      const pMatch = priceVal.match(/[\d,]+(?:\.\d+)?/);
      if (pMatch) priceVal = parseFloat(pMatch[0].replace(/,/g, ''));
    }
    
    let origPriceVal = item.original_price || item.originalPrice;
    if (typeof origPriceVal === 'string') {
      const opMatch = origPriceVal.match(/[\d,]+(?:\.\d+)?/);
      if (opMatch) origPriceVal = parseFloat(opMatch[0].replace(/,/g, ''));
    }

    let ratingVal = item.rating;
    if (typeof ratingVal === 'string') {
      const rMatch = ratingVal.match(/[\d.]+/);
      if (rMatch) ratingVal = parseFloat(rMatch[0]);
    }

    let brand = item.brand || item.company || '';
    if (!brand && title) {
      brand = title.split(' ')[0] || '';
    }

    return {
      id: item.id || (index + 1),
      title: title,
      brand: brand,
      price: priceVal !== undefined ? priceVal : (item.price || ''),
      original_price: origPriceVal !== undefined ? origPriceVal : '',
      discount_pct: item.discount_pct || item.discount || '',
      rating: ratingVal !== undefined ? ratingVal : (item.rating || ''),
      review_count: item.review_count || item.reviewsText || item.reviewsCount || '',
      is_sponsored: Boolean(item.is_sponsored || item.isSponsored),
      url: url
    };
  }).filter(p => p.title || p.url);

  return { products };
}

/**
 * Main export function to send clean JSON data to Google Sheets.
 */
async function exportToGoogleSheets(sheetName, cleanData) {
  loadEnv();

  // Normalize incoming payload so arrays and diverse key structures (text, href, etc.) work seamlessly
  const normalizedData = normalizeCleanDataForSheets(cleanData);

  const webappUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  if (webappUrl && !webappUrl.includes('YOUR_DEPLOYED_URL_HERE')) {
    console.log(`[Google Sheets] Exporting via Apps Script Web App: ${webappUrl}`);
    const response = await makeRequest(webappUrl, { method: 'POST' }, {
      action: 'export',
      sheetName,
      data: normalizedData
    });
    
    if (!response.ok) {
      throw new Error(`Apps Script Web App returned status ${response.status}: ${response.body}`);
    }
    return JSON.parse(response.body);
  }

  // Fallback: Google service account workflow
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceEmail || !serviceKey || !spreadsheetId) {
    throw new Error('Google Sheets credentials are not configured in your .env file.');
  }

  console.log(`[Google Sheets] Fetching Access Token...`);
  const accessToken = await getGoogleAccessToken(serviceEmail, serviceKey);
  const normalizedTabName = sheetName.replace(/[*?:\[\]\/\\']/g, '').substring(0, 30);

  // Verify/create sheet tab
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  await makeRequest(updateUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }, {
    requests: [{
      addSheet: {
        properties: { title: normalizedTabName }
      }
    }]
  }).catch(() => {});

  const products = normalizedData.products || [];
  const rows = [];
  rows.push(["ID", "Title", "Brand", "Price", "Original Price", "Discount %", "Rating", "Reviews Count", "Sponsored", "Link"]);
  
  products.forEach(p => {
    rows.push([
      p.id || '',
      p.title || '',
      p.brand || '',
      p.price !== undefined && p.price !== null ? p.price : '',
      p.original_price !== undefined && p.original_price !== null ? p.original_price : '',
      p.discount_pct !== undefined && p.discount_pct !== null ? p.discount_pct : '',
      p.rating !== undefined && p.rating !== null ? p.rating : '',
      p.review_count !== undefined && p.review_count !== null ? p.review_count : '',
      p.is_sponsored ? 'TRUE' : 'FALSE',
      p.url || ''
    ]);
  });

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${normalizedTabName}'!A1:append?valueInputOption=USER_ENTERED`;
  const appendRes = await makeRequest(appendUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  }, {
    values: rows
  });

  if (!appendRes.ok) {
    throw new Error(`Google Sheets API append failed: ${appendRes.body}`);
  }

  return { 
    success: true, 
    message: `Successfully appended ${products.length} products to tab "${normalizedTabName}"!`,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  };
}

/**
 * Fetches the list of sheet tab names from the spreadsheet.
 */
async function getSheetsList() {
  loadEnv();

  const webappUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  if (webappUrl && !webappUrl.includes('YOUR_DEPLOYED_URL_HERE')) {
    console.log(`[Google Sheets] Fetching sheet list via Web App: ${webappUrl}`);
    const response = await makeRequest(webappUrl, { method: 'POST' }, {
      action: 'getSheets'
    });
    
    if (!response.ok) {
      throw new Error(`Apps Script Web App returned status ${response.status}: ${response.body}`);
    }
    const result = JSON.parse(response.body);
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch sheet list from Web App');
    }
    return result.sheets;
  }

  // Fallback: Google service account workflow
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceEmail || !serviceKey || !spreadsheetId) {
    throw new Error('Google Sheets credentials are not configured in your .env file.');
  }

  const accessToken = await getGoogleAccessToken(serviceEmail, serviceKey);
  const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  
  const response = await makeRequest(metadataUrl, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Sheets API metadata fetch failed: ${response.body}`);
  }
  
  const result = JSON.parse(response.body);
  return result.sheets.map(s => s.properties.title);
}

/**
 * Reads and maps tabular data from selected sheet tabs.
 */
async function readSheetsData(sheetNames) {
  loadEnv();

  const webappUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  if (webappUrl && !webappUrl.includes('YOUR_DEPLOYED_URL_HERE')) {
    console.log(`[Google Sheets] Reading sheets data via Web App: ${webappUrl}`);
    const response = await makeRequest(webappUrl, { method: 'POST' }, {
      action: 'readSheets',
      sheetNames
    });
    
    if (!response.ok) {
      throw new Error(`Apps Script Web App returned status ${response.status}: ${response.body}`);
    }
    const result = JSON.parse(response.body);
    if (!result.success) {
      throw new Error(result.error || 'Failed to read sheets data from Web App');
    }
    return result.data;
  }

  // Fallback: Google service account workflow
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceEmail || !serviceKey || !spreadsheetId) {
    throw new Error('Google Sheets credentials are not configured in your .env file.');
  }

  const accessToken = await getGoogleAccessToken(serviceEmail, serviceKey);
  const results = {};

  for (const sheetName of sheetNames) {
    const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${sheetName}'!A1:Z`;
    const response = await makeRequest(valuesUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      console.warn(`[Google Sheets] Failed to read sheet "${sheetName}":`, response.body);
      results[sheetName] = [];
      continue;
    }

    const result = JSON.parse(response.body);
    const data = result.values || [];
    if (data.length <= 1) {
      results[sheetName] = [];
      continue;
    }

    const headers = data[0];
    const rows = [];
    for (let r = 1; r < data.length; r++) {
      const rowData = data[r];
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        const header = headers[c].toString().toLowerCase().trim();
        const cellVal = rowData[c];
        if (header === "id") obj.id = cellVal;
        else if (header === "title") obj.title = cellVal;
        else if (header === "brand") obj.brand = cellVal;
        else if (header === "price") obj.price = parseFloat(cellVal) || cellVal;
        else if (header === "original price") obj.original_price = parseFloat(cellVal) || cellVal;
        else if (header === "discount %") obj.discount_pct = parseFloat(cellVal) || cellVal;
        else if (header === "rating") obj.rating = parseFloat(cellVal) || cellVal;
        else if (header === "reviews count") obj.review_count = parseInt(cellVal) || cellVal;
        else if (header === "sponsored") obj.is_sponsored = cellVal === "TRUE" || cellVal === true;
        else if (header === "link") obj.url = cellVal;
        else obj[headers[c]] = cellVal;
      }
      rows.push(obj);
    }
    results[sheetName] = rows;
  }

  return results;
}

module.exports = {
  exportToGoogleSheets,
  getSheetsList,
  readSheetsData
};
