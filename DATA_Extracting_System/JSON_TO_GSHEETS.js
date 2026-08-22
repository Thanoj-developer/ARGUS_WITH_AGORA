const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// Load environment variables if present
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
      // Handle Google Script redirect (302)
      if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          // Google Apps Script redirects a POST request to a GET request to retrieve the return output.
          // We must follow this redirect with a GET request and no request body.
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
      
      // Clean private key formatting in case newline chars are escaped in .env
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
 * Normalizes any structured JSON array or object into the standard schema expected by Google Sheets.
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
  // Reload env variables dynamically on request to pick up changes without restarts
  loadEnv();

  const normalizedData = normalizeCleanDataForSheets(cleanData);

  // 1. Check if Apps Script Web App URL is present in .env
  const webappUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  if (webappUrl && !webappUrl.includes('YOUR_DEPLOYED_URL_HERE')) {
    console.log(`[Google Sheets] Exporting via Apps Script Web App: ${webappUrl}`);
    const response = await makeRequest(webappUrl, { method: 'POST' }, {
      sheetName,
      data: normalizedData
    });
    
    if (!response.ok) {
      throw new Error(`Apps Script Web App returned status ${response.status}: ${response.body}`);
    }
    return JSON.parse(response.body);
  }

  // 2. Fallback: Google service account workflow
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!serviceEmail || !serviceKey || !spreadsheetId) {
    throw new Error('Google Sheets credentials are not configured in your .env file.\n' +
                    'Please set either GOOGLE_SHEETS_WEBAPP_URL OR (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SPREADSHEET_ID).');
  }

  console.log(`[Google Sheets] Fetching Access Token for service account ${serviceEmail}...`);
  const accessToken = await getGoogleAccessToken(serviceEmail, serviceKey);

  // Normalize sheetName to remove special characters not allowed in tab names
  const normalizedTabName = sheetName.replace(/[*?:\[\]\/\\']/g, '').substring(0, 30);
  console.log(`[Google Sheets] Exporting to sheet ID ${spreadsheetId}, tab "${normalizedTabName}"...`);

  // First, verify/create sheet tab by calling spreadsheet batchUpdate
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
  }).catch(() => {
    // If it fails, sheet tab likely already exists, which is fine
  });

  // Construct table rows
  const products = normalizedData.products || [];
  const rows = [];
  
  // Header row
  rows.push(["ID", "Title", "Brand", "Price", "Original Price", "Discount %", "Rating", "Reviews Count", "Sponsored", "Link"]);
  
  // Product rows
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

  // Append values to sheet tab
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

module.exports = {
  exportToGoogleSheets
};
