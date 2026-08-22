const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const newTabAccess = require('./newtabaccess');

// Load environment variables from .env files
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, 'Controlled_By_LLM', '.env')
  ];
  for (const envPath of envPaths) {
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
      } catch (err) {
        console.error(`Failed to load env file from ${envPath}:`, err);
      }
    }
  }
}
loadEnv();

const llmControl = require('./Controlled_By_LLM/control');
const { captureState } = require('./Capturing_State_observation/capture');
const Context = require('./Controlled_By_LLM/Context');
const SemanticCache = require('./Redis_Query_caching/Semantic_Cache');
const { scrapePage } = require('./WEBSCRAPING/scraper');
const { cleanScrapedData, cleanScrapedDataStream } = require('./DATA_Extracting_System/LLM_FOR_DATA_CLEANING');
const { extractDataByDomManagement } = require('./DATA_Extracting_System/DATA_CLEANING_BY_USING_DOM_Management');
const { exportToGoogleSheets, getSheetsList, readSheetsData } = require('./GOOGLE_CLOUD_CONNECTIONS/google_sheets');
const domManager = require('./DOM_ACCESSBILITY/dom_manager');

const PORT = 2001;
let browser = null;
let context = null;
let page = null;
let currentChannel = 'chromium';

// Automatically capture state of the active page and store it
async function autoCaptureState() {
  try {
    const activePage = newTabAccess.getActiveVideoPage() || page;
    if (activePage && browser && browser.isConnected() && !activePage.isClosed()) {
      await captureState(activePage, 'body');
    }
  } catch (err) {
    console.error('[Auto-Capture] Failed to save state:', err.message);
  }
}

// Initialize Playwright with a headed browser
async function initPlaywright(channel = 'chromium') {
  currentChannel = channel;
  newTabAccess.reset();
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      console.error('Error closing browser during re-init:', e);
    }
  }

  console.log(`Launching headed browser with channel: ${channel}...`);
  const launchOptions = { 
    headless: false,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  };
  if (channel === 'chrome' || channel === 'msedge') {
    launchOptions.channel = channel;
  } else if (channel === 'access_server') {
    // Launch using Google Chrome for media streaming compatibility
    launchOptions.channel = 'chrome';
  }
  
  browser = await chromium.launch(launchOptions);
  context = await browser.newContext();
  context.setDefaultTimeout(0);
  context.setDefaultNavigationTimeout(0);
  page = await context.newPage();
  await newTabAccess.registerTabFocusHook(page).catch(() => {});
  
  // Set default viewport
  await page.setViewportSize({ width: 1280, height: 720 });
  console.log(`Headed browser (${channel}) ready.`);

  // Listen for YouTube video navigations on the main page and redirect them to a new tab
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      const url = page.url();
      if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
        console.log(`[Navigation Intercept] Main page navigated to YouTube video: ${url}`);
        try {
          // Navigate back on the main page to keep it on the search page
          await page.goBack();
        } catch (e) {
          // Ignore if we can't go back
        }
        // Play the video in a new tab instead
        await newTabAccess.playYouTubeVideoInNewTab(context, url);
      }
    }
  });

  if (channel === 'access_server') {
    console.log('Multi-tab automation mode active. Ready for commands from the Control Console.');
  }
  await autoCaptureState();
}

// Helper to keep page pointing to the active tab
function updateActivePage() {
  if (!context) return;
  const activeVideoPage = newTabAccess.getActiveVideoPage();
  if (activeVideoPage && !activeVideoPage.isClosed()) {
    page = activeVideoPage;
    return;
  }
  const pages = context.pages();
  if (pages.length > 0) {
    page = pages[pages.length - 1];
  }
}

// Helper to ensure the headed browser is alive and active
async function ensureBrowserActive() {
  if (!browser || !browser.isConnected() || !page || page.isClosed() || (context && context.pages().length === 0)) {
    console.log('[Auto-Heal] Browser is closed, dead or disconnected. Re-initializing...');
    await initPlaywright(currentChannel);
  }
}

// Helper to take a screenshot and return base64
async function getScreenshotBase64() {
  updateActivePage();
  if (!browser || !browser.isConnected() || !page) return null;

  // Do not take screenshots if in access_server mode, if multiple tabs are open, or if newtabaccess is active
  // to avoid causing lag in headed streaming browser and preventing screenshot timeouts.
  if (currentChannel === 'access_server' || newTabAccess.shouldDisableScreenshots() || (context && context.pages().length > 1)) {
    return null;
  }

  try {
    const buffer = await page.screenshot({ type: 'png' });
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('Failed to capture screenshot:', err);
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route: GET /commanding.html
  if (req.method === 'GET' && (req.url === '/commanding.html' || req.url === '/')) {
    const filePath = path.join(__dirname, 'commanding.html');
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading commanding.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      }
    });
    return;
  }

  // Route: POST /execute
  if (req.method === 'POST' && req.url === '/execute') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let code;
      try {
        const payload = JSON.parse(body);
        code = payload.code;
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
        return;
      }

      await ensureBrowserActive();
      updateActivePage();
      if (!page) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Browser not initialized' }));
        return;
      }

      console.log(`Executing command: ${code}`);
      let success = true;
      let result = '';
      let errorMsg = '';

      // Intercept YouTube video URLs (either raw URL or inside page.goto/commands)
      const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+)/;
      const match = code.match(youtubeRegex);

      try {
        if (match) {
          const videoUrl = match[1];
          console.log(`[youtube_play] Intercepted YouTube link: ${videoUrl}. Launching in a new tab with consent/autoplay automation...`);
          await newTabAccess.playYouTubeVideoInNewTab(context, videoUrl);
          result = `Opened and playing YouTube video in new tab: ${videoUrl}`;
        } else {
          // Helper to recursively wrap Playwright locator objects to intercept click events on YouTube links
          function wrapLocator(locatorObj, selector) {
            return new Proxy(locatorObj, {
              get(target, prop) {
                if (prop === 'click') {
                  return async function(options = {}) {
                    if (selector.includes('video-title') || selector.includes('ytd-video-renderer')) {
                      console.log(`[Proxy] Intercepted click on YouTube video link: ${selector}`);
                      try {
                        const href = await target.getAttribute('href');
                        if (href) {
                          const videoUrl = href.startsWith('http') ? href : 'https://www.youtube.com' + href;
                          console.log(`[Proxy] Opening in a new tab: ${videoUrl}`);
                          await newTabAccess.playYouTubeVideoInNewTab(context, videoUrl);
                          return;
                        }
                      } catch (err) {
                        console.error('[Proxy] Failed to get href, falling back to standard click:', err);
                      }
                    }
                    return await target.click(options);
                  };
                }

                const val = target[prop];
                if (typeof val === 'function') {
                  return function(...args) {
                    const result = val.apply(target, args);
                    // Duck-type Locator checks: if it has a click method, wrap it recursively
                    if (result && typeof result.click === 'function') {
                      return wrapLocator(result, selector);
                    }
                    return result;
                  };
                }
                return val;
              }
            });
          }

          // Create a Proxy around the Playwright page object
          const pageProxy = new Proxy(page, {
            get(target, prop) {
              if (prop === 'locator') {
                return function(selector, ...args) {
                  const locatorObj = target.locator(selector, ...args);
                  return wrapLocator(locatorObj, selector);
                };
              }
              
              const value = target[prop];
              if (typeof value === 'function') {
                return value.bind(target);
              }
              return value;
            }
          });

          const dismissPopupIfPresent = async (targetPage) => {
            const p = targetPage || pageProxy || page;
            const closeSelectors = [
              'button._30XB9F',
              'span._30XB9F',
              'button._2KpZ6l._2doB4z',
              '[aria-label="Close"]',
              '[aria-label="close"]',
              'button:has-text("✕")',
              'span:has-text("✕")',
              'button:has-text("×")',
              'span:has-text("×")',
              '.modal-close',
              '[data-testid="close-button"]',
              '#attachSiNoCoverage',
              'input[aria-labelledby="attachSiNoCoverage-announce"]'
            ];
            for (const selector of closeSelectors) {
              try {
                const el = p.locator(selector).first();
                if (await el.isVisible({ timeout: 1000 })) {
                  await el.click();
                  break;
                }
              } catch (e) {}
            }
          };

          const currentSheetData = global.lastLoadedSheetData || {};
          const currentSheetProducts = Object.values(currentSheetData).flat();

          const executeCode = new Function('page', 'browser', 'context', 'newTabAccess', 'captureState', 'dismissPopupIfPresent', 'sheetData', 'sheetProducts', `
            return (async () => {
              ${code}
            })();
          `);
          const val = await executeCode(pageProxy, browser, context, newTabAccess, captureState, dismissPopupIfPresent, currentSheetData, currentSheetProducts);
          result = val !== undefined ? String(val) : 'Command executed successfully';
        }
      } catch (err) {
        success = false;
        errorMsg = err.stack || err.message;
        console.error('Execution error:', err);
      }

      // Update active page again in case tabs were created/closed
      updateActivePage();
      await autoCaptureState();

      // Capture screenshot after executing the command
      const screenshot = await getScreenshotBase64();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success,
        result: success ? result : null,
        error: !success ? errorMsg : null,
        screenshot
      }));
    });
    return;
  }

  // Route: POST /click
  if (req.method === 'POST' && req.url === '/click') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        await ensureBrowserActive();
        updateActivePage();
        const { x, y } = JSON.parse(body);
        console.log(`Clicking coordinates: (${x}, ${y})`);
        const activePage = newTabAccess.getActiveVideoPage() || page;
        if (activePage) {
          await activePage.mouse.click(Number(x), Number(y));
        }
        await autoCaptureState();
        const screenshot = await getScreenshotBase64();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, screenshot }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /type
  if (req.method === 'POST' && req.url === '/type') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        await ensureBrowserActive();
        updateActivePage();
        const { text, key } = JSON.parse(body);
        const activePage = newTabAccess.getActiveVideoPage() || page;
        if (activePage) {
          if (text) {
            console.log(`Typing text: "${text}"`);
            await activePage.keyboard.type(text);
          }
          if (key) {
            console.log(`Pressing key: "${key}"`);
            await activePage.keyboard.press(key);
          }
        }
        await autoCaptureState();
        const screenshot = await getScreenshotBase64();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, screenshot }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /reset
  if (req.method === 'POST' && req.url === '/reset') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let channel = 'chromium';
      try {
        if (body) {
          const payload = JSON.parse(body);
          channel = payload.channel || 'chromium';
        }
      } catch (e) {
        // Fallback
      }
      try {
        Context.clearHistory();
        await initPlaywright(channel);
        const screenshot = await getScreenshotBase64();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, screenshot }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: GET /screenshot
  if (req.method === 'GET' && req.url === '/screenshot') {
    const screenshot = await getScreenshotBase64();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ screenshot }));
    return;
  }

  // Route: GET /state
  if (req.method === 'GET' && req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, channel: currentChannel }));
    return;
  }

  // Route: POST /scrape
  if (req.method === 'POST' && req.url === '/scrape') {
    try {
      await ensureBrowserActive();
      updateActivePage();
      const activePage = newTabAccess.getActiveVideoPage() || page;
      if (!activePage) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No active page found to scrape.' }));
        return;
      }
      console.log(`[Scraper] Scraping page: ${activePage.url()}`);
      const data = await scrapePage(activePage);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
    } catch (err) {
      console.error('[Scraper] Failed to scrape page:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route: POST /clean-data
  if (req.method === 'POST' && req.url === '/clean-data') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const scrapedData = payload.scrapedData;
        const commands = payload.commands || [];
        const maxLinks = parseInt(payload.maxLinks) > 0 ? parseInt(payload.maxLinks) : 10;
        console.log(`[Data Cleaning] Streaming scraped data cleaning (maxLinks: ${maxLinks}) using LLM with context of ${commands.length} commands...`);
        
        // Write headers for standard chunked HTTP streaming
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Content-Type-Options': 'nosniff'
        });

        // Send 1024 bytes of padding to bypass browser fetch buffering thresholds
        res.write('/* ' + ' '.repeat(1024) + ' */\n');

        // Forward generated chunks to client immediately
        const onChunk = (chunk) => {
          res.write(chunk);
        };

        const finalCleanJson = await cleanScrapedDataStream(scrapedData, commands, onChunk, maxLinks);

        // Send a custom delimiter followed by the final re-mapped URL JSON payload
        res.write(`\n\n__FINAL_DATA__\n${JSON.stringify({ success: true, cleanData: finalCleanJson })}`);
        res.end();
      } catch (err) {
        console.error('[Data Cleaning] Failed to stream clean data:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.write(`\n\n__FINAL_DATA__\n${JSON.stringify({ success: false, error: err.message })}`);
          res.end();
        }
      }
    });
    return;
  }

  // Route: POST /get-dom-data (Deterministic DOM & Accessibility extraction - Zero LLM API calls)
  if (req.method === 'POST' && req.url === '/get-dom-data') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        await ensureBrowserActive();
        updateActivePage();
        const activePage = newTabAccess.getActiveVideoPage() || page;
        if (!activePage) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No active page found.' }));
          return;
        }

        let options = {};
        try {
          if (body) options = JSON.parse(body);
        } catch (_) {}

        console.log(`[Server: /get-dom-data] Extracting clean structured data via DOM Management from: ${activePage.url()}`);
        const extractedData = await extractDataByDomManagement(activePage, options);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          count: extractedData.length,
          data: extractedData,
          url: activePage.url()
        }));
      } catch (err) {
        console.error('[Server: /get-dom-data] Extraction error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: GET /observation
  if (req.method === 'GET' && req.url === '/observation') {
    try {
      // Capture live state on demand before returning it!
      await autoCaptureState();

      const obsPath = path.join(__dirname, 'Capturing_State_observation', 'latest_observation.json');
      if (fs.existsSync(obsPath)) {
        const data = fs.readFileSync(obsPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No observation data captured yet.' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route: POST /translate
  if (req.method === 'POST' && req.url === '/translate') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { task } = JSON.parse(body);
        if (!task) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No task instruction provided' }));
          return;
        }

        // Check semantic cache (only for static commands; bypass for dynamic Google Sheet/JSON data or Max Tabs settings)
        const isDynamicTask = task.includes('Connected Google Sheets Data') || task.includes('Connected JSON Data') || task.includes('Max Tabs');
        let code = isDynamicTask ? null : await SemanticCache.checkCache(task);
        if (code) {
          console.log(`[Server] Cache Hit! Serving Playwright script from semantic cache.`);
          
          // Save interaction to context history so the LLM session state stays synchronized
          Context.addInteraction(task, code);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, code }));
          return;
        }

        console.log(`[Server] ${isDynamicTask ? 'Dynamic task detected (bypassing cache)' : 'Cache Miss'}. Directing task to LLM...`);
        const generatedCode = await llmControl.translateInstruction(task);
        
        // Save generated code to semantic cache if not a dynamic task
        if (!isDynamicTask) {
          await SemanticCache.setCache(task, generatedCode);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, code: generatedCode }));
      } catch (err) {
        console.error('Translation failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: GET /get-llm-config (returns current LLM model list and masked API key)
  if (req.method === 'GET' && req.url === '/get-llm-config') {
    try {
      loadEnv();
      const key = process.env.NVIDIA_API_KEY || '';
      const masked = key.length > 12 ? key.slice(0, 8) + '...' + key.slice(-4) : '(not set)';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        maskedKey: masked,
        isKeySet: key.length > 0,
        models: [
          { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct', role: 'Primary (Fastest)', speed: '~2–5s' },
          { id: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B Instruct', role: 'Fallback 1 (Smarter)', speed: '~10–20s' },
          { id: 'mistralai/mixtral-8x7b-instruct-v0.1', label: 'Mixtral 8x7B Instruct', role: 'Fallback 2 (Backup)', speed: '~5–15s' }
        ],
        platform: 'NVIDIA NIM API (integrate.api.nvidia.com)',
        keySource: 'Controlled_By_LLM/.env → NVIDIA_API_KEY'
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route: POST /update-api-key (updates NVIDIA_API_KEY in Controlled_By_LLM/.env)
  if (req.method === 'POST' && req.url === '/update-api-key') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { apiKey } = JSON.parse(body);
        if (!apiKey || !apiKey.startsWith('nvapi-')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid API key. Must start with nvapi-' }));
          return;
        }
        const envPath = path.join(__dirname, 'Controlled_By_LLM', '.env');
        let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (content.includes('NVIDIA_API_KEY=')) {
          content = content.replace(/NVIDIA_API_KEY=.*/g, `NVIDIA_API_KEY=${apiKey.trim()}`);
        } else {
          content = `# Nvidia NIM Platform API Key\nNVIDIA_API_KEY=${apiKey.trim()}\n` + content;
        }
        fs.writeFileSync(envPath, content, 'utf8');
        // Reload env so the new key is picked up immediately
        loadEnv();
        process.env.NVIDIA_API_KEY = apiKey.trim();
        console.log(`[Server] NVIDIA_API_KEY updated to: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'API key updated successfully. No restart required.' }));
      } catch (err) {
        console.error('[Server] Failed to update API key:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /export-sheets
  if (req.method === 'POST' && req.url === '/export-sheets') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { sheetName, cleanData } = JSON.parse(body);
        if (!sheetName || !cleanData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing sheetName or cleanData in request' }));
          return;
        }

        console.log(`[Google Sheets] Received export request for tab "${sheetName}"...`);
        const result = await exportToGoogleSheets(sheetName, cleanData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: result.message || 'Data exported successfully!', 
          spreadsheetUrl: result.spreadsheetUrl 
        }));
      } catch (err) {
        console.error('[Google Sheets] Export failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /get-sheets
  if (req.method === 'POST' && req.url === '/get-sheets') {
    try {
      console.log(`[Google Sheets] Fetching sheet list...`);
      const sheets = await getSheetsList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, sheets }));
    } catch (err) {
      console.error('[Google Sheets] Fetching sheets failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route: POST /read-sheets
  if (req.method === 'POST' && req.url === '/read-sheets') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { sheetNames } = JSON.parse(body);
        if (!sheetNames || !Array.isArray(sheetNames)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing or invalid sheetNames array in request' }));
          return;
        }
        console.log(`[Google Sheets] Reading data from tabs: ${sheetNames.join(', ')}...`);
        const data = await readSheetsData(sheetNames);
        global.lastLoadedSheetData = data;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data }));
      } catch (err) {
        console.error('[Google Sheets] Reading sheets data failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /save-clean-json (Saves clean data locally)
  if (req.method === 'POST' && req.url === '/save-clean-json') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { name, data } = JSON.parse(body);
        if (!name || !data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing name or data in request' }));
          return;
        }
        const sanitized = name.replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!sanitized) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid name provided' }));
          return;
        }
        const dirPath = path.join(__dirname, 'Storing_Clean_JSON');
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        const filePath = path.join(dirPath, `${sanitized}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[JSON Store] Saved clean data to ${filePath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `JSON file saved to Storing_Clean_JSON/${sanitized}.json successfully!` }));
      } catch (err) {
        console.error('[JSON Store] Save failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: GET /list-clean-json (Lists local clean JSON files)
  if (req.method === 'GET' && req.url === '/list-clean-json') {
    try {
      const dirPath = path.join(__dirname, 'Storing_Clean_JSON');
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const files = fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, files }));
    } catch (err) {
      console.error('[JSON Store] Listing failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route: POST /read-clean-json (Reads selected clean JSON files)
  if (req.method === 'POST' && req.url === '/read-clean-json') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { files } = JSON.parse(body);
        if (!files || !Array.isArray(files)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing or invalid files array in request' }));
          return;
        }
        console.log(`[JSON Store] Reading data from files: ${files.join(', ')}...`);
        const data = {};
        for (const file of files) {
          const sanitized = file.replace(/[^a-zA-Z0-9_\-]/g, '');
          const filePath = path.join(__dirname, 'Storing_Clean_JSON', `${sanitized}.json`);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            data[sanitized] = JSON.parse(content);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data }));
      } catch (err) {
        console.error('[JSON Store] Reading failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /list-tabs (Lists all open tabs in headed browser)
  if (req.method === 'POST' && req.url === '/list-tabs') {
    try {
      const tabs = await newTabAccess.getTabList(context);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tabs }));
    } catch (err) {
      console.error('[Tabs] Listing failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Route: POST /switch-tab (Switches active tab pointer)
  if (req.method === 'POST' && req.url === '/switch-tab') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { index } = JSON.parse(body);
        const result = await newTabAccess.switchToTab(context, parseInt(index, 10));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Switched to tab: "${result.title}"` }));
      } catch (err) {
        console.error('[Tabs] Switch failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /open-product-tabs
  if (req.method === 'POST' && req.url === '/open-product-tabs') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { urls, maxTabs = 30 } = JSON.parse(body);
        if (!urls || !Array.isArray(urls)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Missing or invalid urls array in request' }));
          return;
        }
        await ensureBrowserActive();
        const validUrls = urls.filter(u => u && typeof u === 'string' && u.startsWith('http')).slice(0, maxTabs);
        console.log(`[Browser Tabs] Opening ${validUrls.length} sorted product links in separate tabs...`);

        const openedUrls = [];
        for (const link of validUrls) {
          try {
            const newTab = await context.newPage();
            await newTabAccess.registerTabFocusHook(newTab).catch(() => {});
            // Set viewport size
            await newTab.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
            // Navigate to product page
            await newTab.goto(link, { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(err => {
              console.warn(`[Browser Tabs] Navigation timeout on ${link}:`, err.message);
            });
            openedUrls.push(link);
            await new Promise(r => setTimeout(r, 600));
          } catch (e) {
            console.warn(`[Browser Tabs] Could not open link: ${link}`, e.message);
          }
        }

        updateActivePage();
        await autoCaptureState();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Successfully opened ${openedUrls.length} product tabs in the browser!`,
          openedCount: openedUrls.length
        }));
      } catch (err) {
        console.error('[Browser Tabs] Failed to open tabs:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /dom-action (DOM Management connected to live browser)
  if (req.method === 'POST' && req.url === '/dom-action') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        await ensureBrowserActive();
        updateActivePage();

        const payload = body ? JSON.parse(body) : {};
        const action = payload.action || 'captureDomSnapshot';

        console.log(`\n[DOM_Management API] Executing action: "${action}" on live browser page...`);
        
        let result;
        if (typeof domManager[action] === 'function') {
          result = await domManager[action](page, payload.params, context);
        } else if (action === 'captureDomSnapshot' || action === 'snapshot') {
          result = await domManager.captureDomSnapshot(page);
        } else {
          throw new Error(`Action "${action}" is not implemented in DOM_ACCESSBILITY yet.`);
        }

        const screenshot = await getScreenshotBase64();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, action, result, screenshot }));
      } catch (err) {
        console.error('[DOM_Management API] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Route: POST /open-live-browser
  if (req.method === 'POST' && req.url === '/open-live-browser') {
    console.log('[Server] Received open-live-browser request. Restarting server via detached launcher...');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Server restarting...' }));
    
    const batPath = path.join(__dirname, 'open_live_browser.bat');
    const child = spawn(batPath, [], {
      detached: true,
      stdio: 'ignore',
      shell: true
    });
    child.unref();
    
    setTimeout(() => {
      process.exit(0);
    }, 200);
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Start the HTTP server
server.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Open http://localhost:${PORT}/commanding.html in your browser.`);
  try {
    await initPlaywright();
  } catch (err) {
    console.error('Failed to initialize Playwright on startup:', err);
  }
});

// Clean close on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  if (browser) {
    await browser.close();
  }
  process.exit();
});
