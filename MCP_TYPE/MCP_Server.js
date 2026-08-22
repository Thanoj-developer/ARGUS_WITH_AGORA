const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { 
  runAiMode, 
  executeCode, 
  resetBrowser, 
  fetchScreenshot, 
  openLiveBrowser,
  scrapePage,
  getDomData,
  exportToSheets,
  getSheetsList,
  readSheetsData,
  connectGoogleSheets,
  sortSheetData,
  listTabs,
  switchTab
} = require('./Components/Function');
const { handleFunctionCall } = require('./Pannel_for_Function_call');
const { orchestrateChat } = require('./LLM_oracastration');
const { handleAutoNavigation } = require('./Navigation_Handeler');

const app = express();
const PORT = 2002;

app.use(express.json({ limit: '50mb' }));

// Serve static dashboard page
app.use(express.static(path.join(__dirname, 'public')));

// Route: AI Mode - translate natural language instructions to code
app.post('/api/ai-mode', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }

  console.log(`[MCP Server] Translating AI Mode query: "${query}"`);
  try {
    const code = await runAiMode(query);
    res.json({ success: true, code });
  } catch (err) {
    console.error(`[MCP Server] AI Mode Translation error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Forward execute command to Port 2001
app.post('/api/execute', async (req, res) => {
  const { code } = req.body;
  try {
    const result = await executeCode(code);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Forward reset command to Port 2001
app.post('/api/reset', async (req, res) => {
  const { channel } = req.body;
  try {
    const result = await resetBrowser(channel);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Forward screenshot query to Port 2001
app.get('/api/screenshot', async (req, res) => {
  try {
    const result = await fetchScreenshot();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Forward open-live-browser request to Port 2001
app.post('/api/open-live-browser', async (req, res) => {
  try {
    const result = await openLiveBrowser();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Scrape page data
app.post('/api/scrape', async (req, res) => {
  try {
    const result = await scrapePage();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Get clean structured data via DOM Management (Fast, 0 API calls)
app.post('/api/get-dom-data', async (req, res) => {
  try {
    const { fileName, ...options } = req.body;
    const result = await getDomData(options);
    
    if (result && result.success && result.data && fileName) {
      const sanitized = fileName.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      if (sanitized) {
        const dirPath = path.join(__dirname, '..', 'Storing_Clean_JSON');
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        const filePath = path.join(dirPath, `${sanitized}.json`);
        fs.writeFileSync(filePath, JSON.stringify(result.data, null, 2), 'utf8');
        console.log(`[MCP Server] Saved clean JSON to Storing_Clean_JSON/${sanitized}.json`);
        result.savedFile = sanitized;
      }
    }
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Export to sheets
app.post('/api/export-sheets', async (req, res) => {
  const { sheetName, cleanData } = req.body;
  try {
    const result = await exportToSheets(sheetName, cleanData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Get Sheets list
app.post('/api/get-sheets', async (req, res) => {
  try {
    const result = await getSheetsList();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Read Sheets data
app.post('/api/read-sheets', async (req, res) => {
  const { sheetNames } = req.body;
  try {
    const result = await readSheetsData(sheetNames);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Proxy POST /clean-data (streaming SSE response for frontend UI display) to Port 2001
app.post('/api/clean-data', (req, res) => {
  console.log(`[MCP Server] Proxying streaming clean-data request to Port 2001...`);
  const body = JSON.stringify(req.body);
  const reqOptions = {
    method: 'POST',
    hostname: 'localhost',
    port: 2001,
    path: '/clean-data',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const proxyReq = http.request(reqOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.status(500).json({ success: false, error: err.message });
  });

  proxyReq.write(body);
  proxyReq.end();
});

// Route: List local clean JSON files (direct file system lookup)
app.get('/api/list-clean-json', (req, res) => {
  try {
    const fs = require('fs');
    const dirPath = path.join(__dirname, '..', 'Storing_Clean_JSON');
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const files = fs.readdirSync(dirPath)
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));
    res.json({ success: true, files });
  } catch (err) {
    console.error('[MCP Server] Listing JSON failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Read selected clean JSON files
app.post('/api/read-clean-json', (req, res) => {
  const { files } = req.body;
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ success: false, error: 'Missing or invalid files array' });
  }
  try {
    const fs = require('fs');
    const dirPath = path.join(__dirname, '..', 'Storing_Clean_JSON');
    const data = {};
    for (const file of files) {
      const sanitized = file.replace(/[^a-zA-Z0-9_\-]/g, '');
      const filePath = path.join(dirPath, `${sanitized}.json`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        data[sanitized] = JSON.parse(content);
      }
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[MCP Server] Reading JSON failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: List active browser tabs from Port 2001
app.post('/api/list-tabs', async (req, res) => {
  try {
    const result = await listTabs();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Switch active browser tab on Port 2001
app.post('/api/switch-tab', async (req, res) => {
  const { index } = req.body;
  try {
    const result = await switchTab(index);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Auto Navigation route using Navigation_Handeler
app.post('/api/auto-navigate', handleAutoNavigation);

// Route: Proxy DOM action request to Port 2001
app.post('/api/dom-action', async (req, res) => {
  try {
    const response = await fetch('http://localhost:2001/dom-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    
    // If DOM action executed successfully, log it to navigation context memory
    if (result.success && req.body.action === 'runClickOrFill' && req.body.params) {
      let pageTitle = '';
      try {
        const tabsResult = await listTabs();
        if (tabsResult.success && tabsResult.tabs) {
          const activeTab = tabsResult.tabs.find(t => t.isActive);
          if (activeTab) {
            pageTitle = activeTab.title;
          }
        }
      } catch (err) {
        console.error('[MCP Server] Failed to resolve active tab title for context:', err.message);
      }
      const context = require('./orchestrator_initialization');
      if (req.body.params.actions && Array.isArray(req.body.params.actions)) {
        for (const actionItem of req.body.params.actions) {
          const selectorMap = context.selectorMap;
          const target = selectorMap[actionItem.index?.toString()] || {};
          context.addStep({
            index: actionItem.index,
            action: actionItem.action,
            selector: target.selector || actionItem.selector,
            name: target.name || actionItem.name || ''
          }, pageTitle);
        }
      } else {
        context.addStep(req.body.params, pageTitle);
      }
      console.log(`[MCP Server] Step recorded. Updated History:\n${context.getFormattedHistory()}`);

      // Synchronous submit logic: if we just filled fields, check if a continue button exists and click it
      let containsFill = false;
      let containsClick = false;
      if (req.body.params.actions && Array.isArray(req.body.params.actions)) {
        containsFill = req.body.params.actions.some(a => a.action === 'fill');
        containsClick = req.body.params.actions.some(a => a.action === 'click');
      } else if (req.body.params.action === 'fill' || (req.body.params.value !== undefined && req.body.params.action !== 'click')) {
        containsFill = true;
      } else if (req.body.params.action === 'click') {
        containsClick = true;
      }

      if (containsFill && !containsClick) {
        const selectorMap = context.selectorMap;
        let continueBtn = null;

        for (const index in selectorMap) {
          const el = selectorMap[index];
          const nameLower = (el.name || '').toLowerCase();
          const roleLower = (el.role || '').toLowerCase();

          if ((roleLower === 'button' || roleLower === 'link') && 
              (nameLower.includes('continue') || nameLower === 'next' || nameLower.includes('submit') || nameLower.includes('sign-in') || nameLower === 'sign in' || nameLower.includes('proceed') || nameLower.includes('verify'))) {
            continueBtn = {
              index: parseInt(index, 10),
              action: 'click',
              selector: el.selector,
              name: el.name
            };
            break;
          }
        }

        if (continueBtn) {
          console.log(`[MCP Server] Auto-submitting: Clicking "${continueBtn.name}" (index ${continueBtn.index}) synchronously...`);
          try {
            const continueResponse = await fetch('http://localhost:2001/dom-action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'runClickOrFill',
                params: continueBtn
              })
            });
            const continueResult = await continueResponse.json();
            if (continueResult.success) {
              context.addStep(continueBtn, pageTitle);
              console.log(`[MCP Server] Sync click completed. Updated History:\n${context.getFormattedHistory()}`);
              
              if (result.result) {
                result.result.message = `Successfully executed form actions and clicked "${continueBtn.name}" synchronously.`;
              }
            }
          } catch (clickErr) {
            console.error('[MCP Server] Failed to execute synchronous click on continue button:', clickErr.message);
          }
        }
      }
    }

    res.json(result);
  } catch (err) {
    console.error('[MCP Server] dom-action proxy failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Query LLM to resolve natural language commands into JSON actions
app.post('/api/auto-navigate-query', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query instruction is required' });
  }

  try {
    console.log('[MCP Server] Forcing fresh DOM snapshot capture to clear cache...');
    await fetch('http://localhost:2001/dom-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'captureDomSnapshot' })
    });

    console.log('[MCP Server] Fetching page accessibility indices from Playwright server...');
    const domResponse = await fetch('http://localhost:2001/dom-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assignSelectorIndices' })
    });
    const domData = await domResponse.json();
    if (!domData.success) {
      throw new Error(domData.error || 'Failed to retrieve accessibility tree');
    }

    const context = require('./orchestrator_initialization');
    // Set the query goal (resets history automatically if new)
    if (context.getState().originalTask !== query) {
      context.initialize(query);
    }

    const selectorMap = domData.result?.selectorMap || {};
    // Store latest AXTree map to lookup names/roles for steps execution
    context.setSelectorMap(selectorMap);

    const elementsList = Object.values(selectorMap);
    console.log(`[MCP Server] Mapped ${elementsList.length} elements.`);

    // Read PII data
    const piiPath = require('path').join(__dirname, 'PII.json');
    let piiData = {};
    try {
      if (fs.existsSync(piiPath)) {
        piiData = JSON.parse(fs.readFileSync(piiPath, 'utf8'));
      }
    } catch (e) {
      console.error('[MCP Server] Failed to read PII.json:', e.message);
    }

    // STEP 1: Deterministic code-based form fill (covers all known PII fields reliably)
    const { checkForFormFilling } = require('./multi_field_filling');
    const deterministicResult = checkForFormFilling(elementsList, piiData);
    const deterministicFills = deterministicResult ? deterministicResult.fills : [];

    console.log(`[MCP Server] Deterministic fill resolved ${deterministicFills.length} fields.`);

    // Check history to see which indices have already been filled in this task session
    const history = context.getState().history || [];
    const executedIndices = new Set(history.map(step => Number(step.index)));

    // Find all deterministic actions that haven't been executed yet
    const unexecutedDeterministicFills = [];
    for (const fill of deterministicFills) {
      if (!executedIndices.has(Number(fill.index))) {
        unexecutedDeterministicFills.push({
          index: fill.index,
          value: fill.value
        });
      }
    }

    if (unexecutedDeterministicFills.length > 0) {
      const responsePayload = { actions: unexecutedDeterministicFills };
      console.log(`[MCP Server] Returning batch deterministic actions: ${JSON.stringify(responsePayload)}`);
      return res.json({ success: true, action: JSON.stringify(responsePayload) });
    }

    // STEP 2: If all deterministic fills are done, fall back to LLM to decide the next action (e.g. click submit)
    console.log('[MCP Server] All deterministic fields filled. Invoking LLM for next action...');
    const invokeLLM = require('./invokeLLM');
    const actionText = await invokeLLM(elementsList);
    console.log('[MCP Server] LLM responded:', actionText);

    // Extract single action from LLM response
    let finalAction = '';
    try {
      let cleanStr = actionText.trim();
      const lastActionsIdx = cleanStr.lastIndexOf('"actions"');
      if (lastActionsIdx !== -1) {
        const ob = cleanStr.lastIndexOf('{', lastActionsIdx);
        const cb = cleanStr.lastIndexOf('}');
        if (ob !== -1 && cb > ob) cleanStr = cleanStr.substring(ob, cb + 1);
      } else {
        const s = cleanStr.indexOf('{');
        const e = cleanStr.lastIndexOf('}');
        if (s !== -1 && e > s) cleanStr = cleanStr.substring(s, e + 1);
      }
      const parsed = JSON.parse(cleanStr);
      if (parsed.actions && Array.isArray(parsed.actions)) {
        const formattedActions = parsed.actions.map(item => {
          if (item.action === 'click') {
            return { action: 'click', index: item.index };
          } else if (item.action === 'done' || item.action === 'none') {
            return item;
          } else {
            return { index: item.index, value: item.value };
          }
        });
        finalAction = JSON.stringify({ actions: formattedActions });
      } else {
        if (parsed.action === 'click') {
          finalAction = JSON.stringify({ action: 'click', index: parsed.index });
        } else if (parsed.action === 'otp_prompt' || parsed.action === 'human_prompt' || parsed.action === 'option_select_prompt' || parsed.action === 'done' || parsed.action === 'none') {
          finalAction = JSON.stringify(parsed);
        } else {
          finalAction = JSON.stringify({ index: parsed.index, value: parsed.value });
        }
      }
    } catch (parseErr) {
      console.warn('[MCP Server] Could not parse LLM output as JSON, returning raw text:', parseErr.message);
      finalAction = actionText.trim();
    }

    res.json({ success: true, action: finalAction });
  } catch (err) {
    console.error('[MCP Server] Auto-navigation query failed:', err.stack || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Proxy open-product-tabs request to Port 2001
app.post('/api/open-product-tabs', async (req, res) => {
  const { urls, maxTabs } = req.body;
  try {
    const response = await fetch('http://localhost:2001/open-product-tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, maxTabs })
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route: Call function dynamically from the Command Panel
app.post('/api/call-function', handleFunctionCall);

// Route: Orchestration Chat endpoint
app.post('/api/orchestrate', async (req, res) => {
  const { message, history, selectedSheets, selectedJsonFiles, maxTabs } = req.body;
  try {
    const reply = await orchestrateChat(message, history, selectedSheets, selectedJsonFiles, maxTabs);
    res.json({ success: true, reply });
  } catch (err) {
    console.error('[Orchestration API] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MCP Server running at http://localhost:${PORT}`);
});