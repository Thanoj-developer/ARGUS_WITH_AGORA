const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const QueryEmbedding = require('./QueryEmbedding');

// Similarity threshold for cloud semantic matches (embeddings)
const CLOUD_SIMILARITY_THRESHOLD = 0.85;

// Similarity threshold for local fallback semantic matches (Jaccard)
const LOCAL_SIMILARITY_THRESHOLD = 0.80;


// Local in-memory cache for fallback mode
const localCache = new Map();

// Helper to load history.json into local cache on startup
function seedLocalCache() {
  try {
    const historyPath = path.join(__dirname, '..', 'Controlled_By_LLM', 'cache_history.json');
    if (fs.existsSync(historyPath)) {
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      for (const entry of history) {
        if (entry.userTask && entry.generatedCode) {
          localCache.set(entry.userTask.trim().toLowerCase(), entry.generatedCode);
        }
      }
      console.log(`[Semantic Cache] Loaded ${localCache.size} historical queries into local fallback cache.`);
    }
  } catch (err) {
    console.warn('[Semantic Cache] Could not seed local cache from history.json:', err.message);
  }
}

// Seed the cache on initialization
seedLocalCache();

// List of common stopwords/boilerplate words to ignore in semantic matching
const STOPWORDS = new Set([
  'open', 'amazon', 'and', 'search', 'for', 'in', 'on', 'a', 'an', 'the', 
  'under', 'rupee', 'rupees', 'price', 'with', 'each', 'product', 'tab', 
  'tabs', 'page', 'site', 'website', 'go', 'to', 'click', 'button', 'link'
]);

// Normalizes words (e.g. basic singular/plural normalization)
function normalizeWord(word) {
  if (word.length > 3 && word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}

// Calculate Jaccard similarity between two strings, ignoring common stopwords
function getJaccardSimilarity(str1, str2) {
  const words1 = str1.toLowerCase().match(/\b\w+\b/g) || [];
  const words2 = str2.toLowerCase().match(/\b\w+\b/g) || [];
  
  if (words1.length === 0 && words2.length === 0) return 1.0;
  
  // Filter out stopwords and normalize
  const filtered1 = words1.filter(w => !STOPWORDS.has(w)).map(normalizeWord);
  const filtered2 = words2.filter(w => !STOPWORDS.has(w)).map(normalizeWord);
  
  if (filtered1.length > 0 && filtered2.length > 0) {
    const set1 = new Set(filtered1);
    const set2 = new Set(filtered2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }
  
  // If one has non-stopwords but the other does not, they are not similar
  if (filtered1.length > 0 || filtered2.length > 0) {
    return 0.0;
  }
  
  // Fallback: If both consist only of stopwords, compare the original word sets
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// Zero-dependency HTTPS helper for Upstash Redis
function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const contentLen = options.body ? Buffer.byteLength(options.body) : 0;
    const reqOptions = {
      method: options.method || 'POST',
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
 * Checks the semantic cache for a matching query.
 * Returns the cached Playwright code if hit, or null if miss.
 */
async function checkCache(task) {
  const normalizedTask = task.trim().toLowerCase();
  const token = process.env.Redis_cache_API;
  const baseUrl = process.env.Redis_cache_URL;

  // Fallback to local in-memory semantic cache if Upstash credentials are not set
  if (!token || !baseUrl || token.trim() === '' || baseUrl.trim() === '') {
    console.log('[Semantic Cache] Upstash Redis cache not configured. Performing local semantic search...');
    let bestMatch = null;
    let highestScore = 0;

    for (const [cachedTask, cachedCode] of localCache.entries()) {
      const score = getJaccardSimilarity(normalizedTask, cachedTask);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = cachedCode;
      }
    }

    if (highestScore >= LOCAL_SIMILARITY_THRESHOLD) {
      console.log(`[Semantic Cache] LOCAL HIT: "${task}" matches cached query with similarity ${(highestScore * 100).toFixed(1)}%`);
      return bestMatch;
    }
    
    console.log(`[Semantic Cache] LOCAL MISS (Best match was ${(highestScore * 100).toFixed(1)}%)`);
    return null;
  }

  // Upstash Cloud Flow
  console.log('[Semantic Cache] Performing cloud semantic cache lookup...');
  try {
    // 1. Find semantically similar query in Vector DB
    const match = await QueryEmbedding.querySimilarity(task, CLOUD_SIMILARITY_THRESHOLD);
    if (match) {
      console.log(`[Semantic Cache] CLOUD HIT: Matched vector ID "${match.id}" with score ${match.score}`);
      
      // 2. Fetch code from Upstash Redis using matched ID
      const redisUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const response = await makeRequest(redisUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(['GET', match.id])
      });

      if (response.ok) {
        const data = await response.json();
        // Upstash Redis returns value in .result field
        if (data.result) {
          return data.result;
        }
      }
      console.warn('[Semantic Cache] Key found in vector DB but missing in Redis.');
    }
  } catch (err) {
    console.error('[Semantic Cache] Cloud retrieval error:', err.message);
  }
  return null;
}

/**
 * Saves a new task and its generated Playwright code to the cache.
 */
async function setCache(task, code) {
  const normalizedTask = task.trim().toLowerCase();
  
  // Save to local cache first
  localCache.set(normalizedTask, code);

  // Write/append to cache_history.json so it persists across server restarts
  try {
    const historyPath = path.join(__dirname, '..', 'Controlled_By_LLM', 'cache_history.json');
    let history = [];
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
    
    // Check if the query is already in cache_history.json to avoid duplicates
    const exists = history.some(entry => entry.userTask.trim().toLowerCase() === normalizedTask);
    if (!exists) {
      history.push({
        timestamp: new Date().toISOString(),
        userTask: task,
        generatedCode: code
      });
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
      console.log('[Semantic Cache] Successfully appended query to local cache_history.json.');
    }
  } catch (err) {
    console.warn('[Semantic Cache] Failed to write query to cache_history.json:', err.message);
  }

  const token = process.env.Redis_cache_API;
  const baseUrl = process.env.Redis_cache_URL;

  if (!token || !baseUrl || token.trim() === '' || baseUrl.trim() === '') {
    console.log('[Semantic Cache] Saved to local persistent fallback cache.');
    return;
  }

  try {
    // Generate deterministic unique ID from task
    const id = crypto.createHash('md5').update(normalizedTask).digest('hex');

    console.log(`[Semantic Cache] Saving "${task}" to cloud cache with ID: ${id}...`);

    // 1. Save code to Redis
    const redisUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const redisRes = await makeRequest(redisUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(['SET', id, code])
    });

    if (!redisRes.ok) {
      console.error('[Semantic Cache] Failed to write to Redis.');
    }

    // 2. Index query in Vector database
    const vectorSuccess = await QueryEmbedding.upsertVector(id, task, { id });
    if (vectorSuccess) {
      console.log('[Semantic Cache] Cloud cache successfully updated.');
    }
  } catch (err) {
    console.error('[Semantic Cache] Cloud write error:', err.message);
  }
}

module.exports = {
  checkCache,
  setCache
};
