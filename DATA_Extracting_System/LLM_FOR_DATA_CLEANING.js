const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Sanitizes and strips tracking parameters from product URLs.
 * Automatically resolves Amazon /sspa/click sponsored redirect links into clean direct /dp/<ASIN> links
 * and discards invalid tracking links.
 */
function sanitizeUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const urlObj = new URL(rawUrl);
    if (urlObj.hostname.includes('amazon.')) {
      // 1. Direct /dp/ or /gp/product/ in path
      const dpMatch = urlObj.pathname.match(/\/dp\/([A-Z0-9]{10})/i) || urlObj.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (dpMatch) {
        return `https://${urlObj.hostname}/dp/${dpMatch[1]}`;
      }

      // 2. Sponsored /sspa/click redirect links -> Extract real product ASIN from destination 'url' param
      if (urlObj.pathname.includes('/sspa/click') || urlObj.searchParams.has('url')) {
        const destUrl = urlObj.searchParams.get('url');
        if (destUrl) {
          const decoded = decodeURIComponent(destUrl);
          const asinMatch = decoded.match(/\/dp\/([A-Z0-9]{10})/i) || decoded.match(/\/gp\/product\/([A-Z0-9]{10})/i) || decoded.match(/[?&]asin=([A-Z0-9]{10})/i);
          if (asinMatch) {
            return `https://${urlObj.hostname}/dp/${asinMatch[1]}`;
          }
        }
        // Unresolved /sspa/ link without an ASIN is invalid -> discard
        return null;
      }

      // 3. Fallback: search anywhere in full string for ASIN
      const fullMatch = rawUrl.match(/\/dp\/([A-Z0-9]{10})/i) || rawUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (fullMatch) {
        return `https://${urlObj.hostname}/dp/${fullMatch[1]}`;
      }

      // If it contains /sspa/ but no ASIN could be extracted, ignore it
      if (rawUrl.includes('/sspa/')) return null;

      urlObj.search = '';
      return urlObj.href;
    }

    if (urlObj.hostname.includes('flipkart.')) {
      const pid = urlObj.searchParams.get('pid');
      urlObj.search = '';
      if (pid) {
        urlObj.searchParams.set('pid', pid);
      }
      return urlObj.href;
    }

    urlObj.search = '';
    return urlObj.href;
  } catch (_) {
    const asinMatch = rawUrl.match(/\/dp\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      return `https://www.amazon.in/dp/${asinMatch[1]}`;
    }
    if (rawUrl.includes('/sspa/')) return null;
    return rawUrl.split('?')[0];
  }
}

/**
 * Loads the LLM_API_FOR_DATA_CLEANING API key from the local directory's .env file.
 * Fallbacks to process.env if already loaded.
 * 
 * @returns {string|null} The API key or null.
 */
function loadEnv() {
  const rootEnv = path.join(__dirname, '..', '.env');
  const localEnv = path.join(__dirname, '.env');
  const llmEnv = path.join(__dirname, '..', 'Controlled_By_LLM', '.env');
  
  [rootEnv, localEnv, llmEnv].forEach(envPath => {
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
  });
}

function getLLMConfig() {
  loadEnv();
  
  const rawKey = process.env.LLM_API_FOR_DATA_CLEANING || process.env.GEMINI_API_KEY || '';
  
  // Nvidia keys start with nvapi-
  if (rawKey && rawKey.startsWith('nvapi-')) {
    console.log(`[Clean LLM] Using Nvidia NIM endpoint with key: ${rawKey.substring(0, 14)}...`);
    return {
      apiKey: rawKey,
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: process.env.DATA_CLEANING_MODEL || 'meta/llama-3.1-8b-instruct',
      fallbackModel: process.env.DATA_CLEANING_FALLBACK_MODEL || 'mistralai/mistral-7b-instruct-v0.3',
      isGemini: false
    };
  }

  // Gemini/other keys
  if (rawKey && rawKey.length > 10) {
    console.log(`[Clean LLM] Using Gemini endpoint with key: ${rawKey.substring(0, 10)}...`);
    return {
      apiKey: rawKey,
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-3.5-flash',
      isGemini: true
    };
  }

  // Fallback to NVIDIA_API_KEY from Controlled_By_LLM/.env
  const nvidiaKey = process.env.NVIDIA_API_KEY || process.env.LLM_API_FOR_HANDEL_WITH_AI;
  if (!nvidiaKey) {
    throw new Error('No API key found. Set LLM_API_FOR_DATA_CLEANING in DATA_Extracting_System/.env');
  }

  return {
    apiKey: nvidiaKey,
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: process.env.DATA_CLEANING_MODEL || 'meta/llama-3.1-8b-instruct',
    fallbackModel: process.env.DATA_CLEANING_FALLBACK_MODEL || 'mistralai/mistral-7b-instruct-v0.3',
    isGemini: false
  };
}

/**
 * Extracts the first valid JSON object from text that may contain
 * Gemini thinking-mode markdown reasoning before or after the JSON block.
 */
function extractJson(text) {
  let t = (text || '').trim();

  // 1. Strip fenced code blocks (```json ... ```)
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }

  // 2. Try the whole text as-is
  try { return JSON.parse(t); } catch (_) {}

  // 3. Find the first { and attempt recovery
  const firstBrace = t.indexOf('{');
  if (firstBrace !== -1) {
    const sub = t.substring(firstBrace);
    try { return JSON.parse(sub); } catch (_) {}

    // 4. SMART TRUNCATION REPAIR FOR "products" ARRAY:
    // If the stream truncated inside an incomplete item, find the last completed item's '}'
    const lastObjectClose = sub.lastIndexOf('}');
    if (lastObjectClose !== -1 && lastObjectClose > 20) {
      const candidateBefore = sub.substring(0, lastObjectClose + 1);
      const possibleClosures = ['', '\n  ]\n}', '\n}'];
      for (const closure of possibleClosures) {
        try {
          const parsed = JSON.parse(candidateBefore + closure);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch (_) {}
      }
    }

    // 5. General backward scan with multiple closure patterns
    const closures = ['', '}', ']}', '"]}', '"}', 'null}]}', 'null}', '"]}}', ']}}'];
    for (let end = sub.length - 1; end > 20; end--) {
      const chunk = sub.substring(0, end);
      for (const closure of closures) {
        try {
          const parsed = JSON.parse(chunk + closure);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch (_) {}
      }
    }
  }

  return null;
}

/**
 * Utility to make HTTPS request.
 */
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

    req.on('error', (err) => { reject(err); });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Utility to make a streaming HTTPS request for Server-Sent Events (SSE).
 */
function makeRequestStream(url, options, onChunk) {
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
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          console.error(`[makeRequestStream] HTTP error body:`, body);
          resolve({
            ok: false,
            status: res.statusCode,
            text: async () => body
          });
        });
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          
          const dataStr = trimmed.substring(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              onChunk(data.choices[0].delta.content);
            }
          } catch (e) {
            // Ignore partial lines
          }
        }
      });

      res.on('end', () => {
        if (buffer.trim().startsWith('data:')) {
          const dataStr = buffer.trim().substring(5).trim();
          if (dataStr !== '[DONE]') {
            try {
              const data = JSON.parse(dataStr);
              if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                onChunk(data.choices[0].delta.content);
              }
            } catch (e) {}
          }
        }
        resolve({
          ok: true,
          status: res.statusCode
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
 * Extracts the user's search query and budget constraints from command history and page information.
 */
function extractSearchQueryAndBudget(commands, scrapedData) {
  let query = 'N/A';
  let budget = null;
  
  const text = commands.join('\n').toLowerCase();
  
  const fillRegex = /(?:fill|type|typeText)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/i;
  const fillMatch = text.match(fillRegex);
  if (fillMatch) {
    query = fillMatch[1].trim();
  } else {
    const commentRegex = /\/\/\s*(?:search for|find|lookup)\s+([^\n\r]+)/i;
    const commentMatch = text.match(commentRegex);
    if (commentMatch) {
      query = commentMatch[1].trim();
    } else if (scrapedData && scrapedData.title) {
      const title = scrapedData.title.toLowerCase();
      if (title.includes('amazon.in :') || title.includes('amazon.in:')) {
        query = title.replace(/amazon\.in\s*:\s*/, '').trim();
      } else if (title.includes('flipkart') && title.includes('search')) {
        query = title.split('|')[0].trim();
      } else {
        query = scrapedData.title;
      }
    }
  }

  const budgetRegex = /(?:under|below|max|budget|limit|price|rupees|inr|rs\.?)\s*(?:of)?\s*(\d+)/i;
  const budgetMatch = query.match(budgetRegex) || text.match(budgetRegex);
  if (budgetMatch) {
    budget = parseFloat(budgetMatch[1]);
  }
  
  const urlText = (scrapedData && scrapedData.url) ? scrapedData.url : '';
  const nativeFilterMatch = urlText.match(/p_36(?:%3A|:)-(\d+)/i);
  if (nativeFilterMatch) {
    budget = parseFloat(nativeFilterMatch[1]) / 100;
  }
  
  return { query, budget };
}

const SYSTEM_PROMPT = `You are a fast, strict product data extraction and normalization engine.
Transform raw e-commerce scrape items into a clean, normalized JSON schema matching the user search query, budget, and requested link count.

OUTPUT JSON SCHEMA (RETURN RAW JSON ONLY):
{
  "search_query": "search query string",
  "max_budget": null,
  "max_valid_links_requested": 10,
  "currency": "INR",
  "total_raw_items": 0,
  "total_filtered_results": 0,
  "products": [
    {
      "id": "original item id (e.g. item-1)",
      "title": "cleaned product title",
      "brand": "extracted brand name or null",
      "price": 0.0,
      "original_price": null,
      "discount_pct": null,
      "rating": null,
      "url": "verbatim source_url from input item or null"
    }
  ]
}

STRICT RULES:
1. Filter out items where price > max_budget (if max_budget is not null).
2. Filter out obvious accessories, blade replacements, or category mismatches.
3. Prioritize items that have a valid "source_url". Return up to "max_valid_links_requested" valid matching products with valid direct URLs.
4. Normalize price to a clean float (no currency symbols or commas).
5. Copy "source_url" exactly into "url". Never invent URLs.
6. Return ONLY valid JSON. No conversational text, no markdown backticks.`;

async function cleanScrapedData(scrapedData, commands = [], maxLinks = 10) {

  const { query, budget } = extractSearchQueryAndBudget(commands, scrapedData);
  const targetLimit = parseInt(maxLinks) > 0 ? parseInt(maxLinks) : 10;

  let rawItems = [];
  if (Array.isArray(scrapedData)) {
    rawItems = scrapedData;
  } else if (scrapedData && Array.isArray(scrapedData.products)) {
    rawItems = scrapedData.products;
  } else if (scrapedData && Array.isArray(scrapedData.items)) {
    rawItems = scrapedData.items;
  } else {
    rawItems = [scrapedData];
  }

  const mappedRawItems = rawItems.map((item, index) => {
    const localId = item.id || item.asin || `item-${index + 1}`;
    const itemCopy = { ...item };
    // Pre-sanitize and convert any sponsored/sspa links into direct /dp/<ASIN> canonical URLs
    const rawUrl = item.url || item.link || item.href || null;
    itemCopy.source_url = sanitizeUrl(rawUrl);
    itemCopy.source_image = item.image_url || item.image || item.img_url || null;
    delete itemCopy.url;
    delete itemCopy.image_url;
    delete itemCopy.image;
    delete itemCopy.link;
    delete itemCopy.href;
    delete itemCopy.img_url;
    itemCopy.id = localId;
    return itemCopy;
  });

  // Prioritize items with valid product links
  mappedRawItems.sort((a, b) => (b.source_url ? 1 : 0) - (a.source_url ? 1 : 0));

  // Take sufficient items to fulfill maxLinks
  const itemsToSend = mappedRawItems.slice(0, Math.max(targetLimit * 2, 20));

  const payload = {
    search_query: query,
    max_budget: budget,
    max_valid_links_requested: targetLimit,
    currency: "INR",
    raw_items: itemsToSend
  };

  const userPrompt = JSON.stringify(payload, null, 2);
  const config = getLLMConfig();
  
  console.log(`[Clean LLM] Requesting cleaning completions (maxLinks: ${targetLimit}) using model ${config.model}...`);

  let response = null;

  try {
    response = await makeRequest(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        top_p: 0.95,
        max_tokens: 8192
      })
    });
  } catch (err) {
    if (!config.isGemini && config.fallbackModel) {
      console.warn(`[Clean LLM] Connection to ${config.model} failed: ${err.message}. Retrying with ${config.fallbackModel}...`);
    } else {
      throw err;
    }
  }

  if ((!response || !response.ok || response.status >= 500 || response.status === 404) && !config.isGemini && config.fallbackModel) {
    const statusInfo = response ? `status ${response.status}` : 'connection error';
    console.log(`[Clean LLM] Primary model failed (${statusInfo}). Falling back to ${config.fallbackModel} for recovery...`);
    try {
      response = await makeRequest(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.fallbackModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          top_p: 0.95,
          max_tokens: 4096
        })
      });
    } catch (err) {
      throw new Error(`Fallback connection to ${config.fallbackModel} failed: ${err.message}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cleaning API Error (status ${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
    throw new Error('Cleaning API returned an empty or invalid response.');
  }

  let cleanText = data.choices[0].message.content.trim();

  const cleanJson = extractJson(cleanText);
  if (!cleanJson) {
    console.error('[Clean LLM] Failed to parse JSON. Raw output:', cleanText.substring(0, 500));
    throw new Error('LLM output was not in a valid JSON format.');
  }

  if (cleanJson && Array.isArray(cleanJson.products)) {
    cleanJson.products = cleanJson.products.map(prod => {
      if (prod.url) {
        prod.url = sanitizeUrl(prod.url);
        if (prod.url && prod.url.includes('/sspa/')) prod.url = null;
      }
      return prod;
    }).filter(p => p.url && p.url.startsWith('http')).slice(0, targetLimit);
    cleanJson.total_filtered_results = cleanJson.products.length;
  }
  return cleanJson;
}

/**
 * Cleans the raw web scraped JSON data and streams the JSON text chunks in real-time.
 */
async function cleanScrapedDataStream(scrapedData, commands = [], onChunk, maxLinks = 10) {

  const { query, budget } = extractSearchQueryAndBudget(commands, scrapedData);
  const targetLimit = parseInt(maxLinks) > 0 ? parseInt(maxLinks) : 10;

  let rawItems = [];
  if (Array.isArray(scrapedData)) {
    rawItems = scrapedData;
  } else if (scrapedData && Array.isArray(scrapedData.products)) {
    rawItems = scrapedData.products;
  } else if (scrapedData && Array.isArray(scrapedData.items)) {
    rawItems = scrapedData.items;
  } else {
    rawItems = [scrapedData];
  }

  const mappedRawItems = rawItems.map((item, index) => {
    const localId = item.id || item.asin || `item-${index + 1}`;
    const itemCopy = { ...item };
    // Pre-sanitize and convert any sponsored/sspa links into direct /dp/<ASIN> canonical URLs
    const rawUrl = item.url || item.link || item.href || null;
    itemCopy.source_url = sanitizeUrl(rawUrl);
    itemCopy.source_image = item.image_url || item.image || item.img_url || null;
    delete itemCopy.url;
    delete itemCopy.image_url;
    delete itemCopy.image;
    delete itemCopy.link;
    delete itemCopy.href;
    delete itemCopy.img_url;
    itemCopy.id = localId;
    return itemCopy;
  });

  // Prioritize items with valid product links
  mappedRawItems.sort((a, b) => (b.source_url ? 1 : 0) - (a.source_url ? 1 : 0));

  // Take sufficient items to fulfill maxLinks
  const itemsToSend = mappedRawItems.slice(0, Math.max(targetLimit * 2, 20));

  const payload = {
    search_query: query,
    max_budget: budget,
    max_valid_links_requested: targetLimit,
    currency: "INR",
    raw_items: itemsToSend
  };

  const userPrompt = JSON.stringify(payload, null, 2);
  const config = getLLMConfig();
  
  console.log(`[Clean LLM Stream] Requesting streaming cleaning completions (maxLinks: ${targetLimit}) using model ${config.model}...`);

  let response = null;
  let accumulatedText = '';

  const handleChunk = (chunk) => {
    accumulatedText += chunk;
    if (onChunk) onChunk(chunk);
  };

  try {
    response = await makeRequestStream(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        top_p: 0.95,
        max_tokens: 8192,
        stream: true
      })
    }, handleChunk);
  } catch (err) {
    if (!config.isGemini && config.fallbackModel) {
      console.warn(`[Clean LLM Stream] Connection to ${config.model} failed: ${err.message}. Retrying with ${config.fallbackModel}...`);
    } else {
      throw err;
    }
  }

  if ((!response || !response.ok || response.status >= 500 || response.status === 404) && !config.isGemini && config.fallbackModel) {
    const statusInfo = response ? `status ${response.status}` : 'connection error';
    console.log(`[Clean LLM Stream] Primary model failed (${statusInfo}). Falling back to ${config.fallbackModel} for streaming...`);
    
    accumulatedText = '';
    if (onChunk) onChunk(`\n\n[System: Falling back to ${config.fallbackModel} model...]\n\n`);

    try {
      response = await makeRequestStream(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.fallbackModel,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          top_p: 0.95,
          max_tokens: 4096,
          stream: true
        })
      }, handleChunk);
    } catch (err) {
      throw new Error(`Fallback streaming connection to ${config.fallbackModel} failed: ${err.message}`);
    }
  }

  if (!response || !response.ok) {
    throw new Error(`Cleaning Stream API failed with status ${response ? response.status : 'unknown'}`);
  }

  let cleanText = accumulatedText.trim();

  const cleanJson = extractJson(cleanText);
  if (!cleanJson) {
    console.error('[Clean LLM Stream] Failed to parse JSON. Raw output:', cleanText.substring(0, 500));
    throw new Error('LLM output was not in a valid JSON format.');
  }

  // URLs are echoed directly by the LLM from source_url/source_image - sanitize and limit
  if (cleanJson && Array.isArray(cleanJson.products)) {
    cleanJson.products = cleanJson.products.map(prod => {
      if (prod.url) {
        prod.url = sanitizeUrl(prod.url);
        if (prod.url && prod.url.includes('/sspa/')) prod.url = null;
      }
      return prod;
    }).filter(p => p.url && p.url.startsWith('http')).slice(0, targetLimit);
    cleanJson.total_filtered_results = cleanJson.products.length;
  }
  return cleanJson;
}

module.exports = {
  cleanScrapedData,
  cleanScrapedDataStream
};
