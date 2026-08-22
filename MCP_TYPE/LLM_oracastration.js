const fs = require('fs');
const path = require('path');
const https = require('https');

// Hardcoded Nvidia NIM API configuration
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const systemPrompt = '';
// system_prompt.txt is loaded by the Playwright Code Generation agent (newllm.js), not the Orchestration Agent.

const orchestrationInstructions = `
You are the Orchestration Assistant. Your task is to help the user perform browser automation by splitting their goals into sequential function calls.

You have access to the following functions:
1. runAiMode(query): Translate a natural language command (query) into Playwright code and execute it.
2. executeCode(code): Run a Playwright JS script.
3. resetBrowser(channel): Reset the browser ('chromium', 'chrome', or 'msedge').
4. fetchScreenshot(): Refresh the screen preview.
5. openLiveBrowser(): Open the headed browser window.
6. scrapePage(): Scrape the active page DOM elements.
7. cleanScrapedData(scrapedData, commands): Clean scraped data.
8. exportToSheets(sheetName, cleanData): Export data to Google Sheets.
9. getSheetsList(): Get sheets tab names.
10. readSheetsData(sheetNames): Read sheets data.
11. connectGoogleSheets(): Connects to Google Sheets and retrieves the list of tab names.
12. sortSheetData(sheetName, sortBy, direction, maxTabs): Reads sheet tab, sorts all products by 'price' or 'rating', exports them to a new tab named '\${sheetName} Sorted \${sortBy} \${direction}', and opens up to maxTabs of the sorted product links in separate browser tabs.

If the user wants to execute a task, you must:
1. Split the task into logical sub-queries.
2. Formulate these sub-queries into a JSON array of commands.
3. Prefix your output with 'CALL: ' followed by the raw JSON array.

JSON Format for each command step:
{
  "query": "The sub-query description",
  "func": "The function name to execute (e.g. runAiMode, scrapePage)",
  "args": ["Argument 1", "Argument 2"] // Arguments array matching the function definition
}

Example 1:
User: "open amazon and search for trimmers under 1000"
Output:
CALL: [
  { "query": "open amazon", "func": "runAiMode", "args": ["open amazon"] },
  { "query": "search for trimmers under 1000", "func": "runAiMode", "args": ["search for trimmers under 1000"] }
]

Example 2:
User: "Open amazon ans search for trimmers under 1000 rupee and aggrange them in each separate tab according to the price from Higher TO LOWER"
Output:
CALL: [
  { "query": "open amazon", "func": "runAiMode", "args": ["open amazon"] },
  { "query": "search for trimmers under 1000 rupee", "func": "runAiMode", "args": ["search for trimmers under 1000 rupee"] },
  { "query": "scrape page data", "func": "scrapePage", "args": [] },
  { "query": "clean scraped data", "func": "cleanScrapedData", "args": ["[\"title\", \"price\", \"rating\", \"link\"]"] },
  { "query": "export to google sheets", "func": "exportToSheets", "args": ["Trimmers Under 1000"] },
  { "query": "connect google sheets", "func": "connectGoogleSheets", "args": [] },
  { "query": "sort sheets from higher to lower price", "func": "sortSheetData", "args": ["Trimmers Under 1000", "price", "desc", 5] }
]

Example 3:
User: "compare prices and open the links from lower to higher in each tab"
Output:
CALL: [
  { "query": "sort sheet from lower to higher price and open product tabs", "func": "sortSheetData", "args": ["Trimmers Under 1000", "price", "asc"] }
]

Example 4:
User: "compare prices and open the links from higher to lower in each tab"
Output:
CALL: [
  { "query": "sort sheet from higher to lower price and open product tabs", "func": "sortSheetData", "args": ["Trimmers Under 1000", "price", "desc"] }
]

If it is conversational, respond normally without 'CALL: '.
`;

/**
 * Utility to make an HTTPS POST request returning a Promise.
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

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Orchestration LLM call: uses hardcoded Nvidia NIM endpoint
 */
async function orchestrateChat(message, history = [], selectedSheets = [], selectedJsonFiles = [], maxTabs = 999) {
  let contextInfo = '';
  
  if (maxTabs && maxTabs !== 999) {
    contextInfo += `\n\n[Max Tabs Limit]: The user wants to open at most ${maxTabs} tabs in the headed browser. Ensure that when generating steps for sorting sheets, you pass ${maxTabs} as the 4th argument (maxTabs) to sortSheetData. If the user query is about opening tabs, strictly honor this limit of ${maxTabs} tab(s).`;
  }

  if (selectedSheets && selectedSheets.length > 0) {
    contextInfo += `\n\n[Active Selected Google Sheet Tab: "${selectedSheets.join(', ')}"]\nNOTE: If the user asks to compare prices, sort, or open product links from lower to higher or higher to lower, execute sortSheetData using the sheetName "${selectedSheets[0]}", sortBy="price", direction="asc" (for lower to higher) or "desc" (for higher to lower) and pass ${maxTabs} as the maxTabs argument.`;
  }

  if (selectedJsonFiles && selectedJsonFiles.length > 0) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dirPath = path.join(__dirname, '..', 'Storing_Clean_JSON');
      const cleanJsonData = {};

      for (const file of selectedJsonFiles) {
        const sanitized = file.replace(/[^a-zA-Z0-9_\-]/g, '');
        const filePath = path.join(dirPath, `${sanitized}.json`);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            // Trim long titles and map fields to save token bandwidth
            cleanJsonData[sanitized] = parsed.map((item, idx) => ({
              id: item.id || (idx + 1),
              title: (item.title || item.name || '').substring(0, 90).replace(/\n|\r|\t/g, ' ').replace(/[\r\n\s]+/g, ' '),
              price: typeof item.price === 'number' ? item.price : (parseFloat(String(item.price || 0).replace(/[^0-9.]/g, '')) || 0),
              url: (item.url || item.link || item.href || '').replace(/\n|\r|\t/g, '').replace(/[\r\n\s]+/g, '')
            }));
          } else {
            cleanJsonData[sanitized] = parsed;
          }
        }
      }

      if (Object.keys(cleanJsonData).length > 0) {
        contextInfo += `\n\n[Connected Local JSON Data]:\n${JSON.stringify(cleanJsonData, null, 2)}\nNOTE: Use this local JSON data to answer the user's questions or generate automation instructions.`;
      }
    } catch (err) {
      console.error('[Orchestrator Chat] Error loading local JSON data:', err.message);
    }
  }

  const messages = [
    { role: 'system', content: orchestrationInstructions + '\n\n' + contextInfo }
  ];
  
  history.forEach(item => {
    messages.push({
      role: item.role === 'user' ? 'user' : 'assistant',
      content: item.text
    });
  });
  messages.push({ role: 'user', content: message });

  console.log(`[Orchestrator Chat] Sending request to Nvidia NIM (${NVIDIA_API_KEY.slice(0, 14)}...) with ${messages.length} messages...`);
  
  const models = ['meta/llama-3.1-8b-instruct', 'openai/gpt-oss-20b', 'mistralai/mistral-7b-instruct-v0.3'];
  let lastError = null;

  for (const model of models) {
    try {
      const response = await makeRequest(NVIDIA_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NVIDIA_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 2048
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const content = data.choices[0].message.content || '';
          const reasoning = data.choices[0].message.reasoning_content || '';
          return (content || reasoning).trim();
        }
      } else {
        const errText = await response.text();
        console.warn(`[Orchestrator Chat] Model ${model} returned status ${response.status}: ${errText}`);
        lastError = new Error(`Nvidia API Error (${model} status ${response.status}): ${errText}`);
      }
    } catch (err) {
      console.warn(`[Orchestrator Chat] Model ${model} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to get response from Nvidia NIM.');
}

module.exports = {
  apiKey: NVIDIA_API_KEY,
  systemPrompt,
  orchestrateChat
};
