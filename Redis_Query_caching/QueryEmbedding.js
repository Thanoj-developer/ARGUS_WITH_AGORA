const https = require('https');

function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const contentLen = options.body ? Buffer.byteLength(options.body) : 0;
    const reqOptions = {
      method: options.method || 'GET',
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        ...options.headers,
        'Content-Length': contentLen
      }
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => body,
          json: async () => JSON.parse(body)
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Queries the Upstash Vector Database for semantic similarity.
 */
async function querySimilarity(text, threshold = 0.85) {
  const token = process.env.EMBEDDING_API;
  const baseUrl = process.env.EMBEDDING_URL;

  if (!token || !baseUrl || token.trim() === '' || baseUrl.trim() === '') {
    return null; // Signals fallback to local cache
  }

  // Ensure url is clean and ends with no trailing slash
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  try {
    const response = await makeRequest(`${url}/query-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        data: text,
        topK: 1,
        includeMetadata: true,
        includeVectors: false
      })
    });

    if (!response.ok) {
      console.error(`[Vector Cache] Error query-data (status ${response.status})`);
      return null;
    }

    const data = await response.json();
    if (data.result && data.result.length > 0) {
      const match = data.result[0];
      if (match.score >= threshold) {
        return {
          id: match.id,
          score: match.score,
          metadata: match.metadata
        };
      }
    }
  } catch (err) {
    console.error('[Vector Cache] Query error:', err.message);
  }
  return null;
}

/**
 * Upserts a query to the Upstash Vector Database.
 */
async function upsertVector(id, text, metadata = {}) {
  const token = process.env.EMBEDDING_API;
  const baseUrl = process.env.EMBEDDING_URL;

  if (!token || !baseUrl || token.trim() === '' || baseUrl.trim() === '') {
    return false;
  }

  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  try {
    const response = await makeRequest(`${url}/upsert-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify([{
        id: id,
        data: text,
        metadata: metadata
      }])
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Vector Cache] Upsert error (status ${response.status}):`, text);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Vector Cache] Upsert connection error:', err.message);
    return false;
  }
}

module.exports = {
  querySimilarity,
  upsertVector
};
