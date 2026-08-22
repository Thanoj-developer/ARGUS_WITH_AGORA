const fs = require('fs');
const path = require('path');
const https = require('https');
const Context = require('./Context');

// Cache system prompt contents
let systemPromptCache = '';

function loadEnv() {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env')
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
      } catch (_) {}
    }
  }
}

function getSystemPrompt() {
  if (systemPromptCache) return systemPromptCache;
  try {
    const promptPath = path.join(__dirname, 'system_prompt.txt');
    systemPromptCache = fs.readFileSync(promptPath, 'utf8');
    return systemPromptCache;
  } catch (err) {
    console.error('Failed to read system_prompt.txt:', err);
    return 'Translate the user request into Playwright JS code.';
  }
}

/**
 * Fast request helper that queries the Nvidia NIM OpenAI-compatible API
 */
function callNvidiaModel(apiKey, model, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.1,
      top_p: 0.95,
      max_tokens: 4096
    });

    const options = {
      method: 'POST',
      hostname: 'integrate.api.nvidia.com',
      path: '/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Nvidia API error status ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const json = JSON.parse(body);
          const content = json.choices?.[0]?.message?.content || '';
          resolve(content);
        } catch (e) {
          reject(new Error(`Failed to parse JSON response from ${model}: ${e.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to model ${model} timed out after 30s.`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Translates natural language instructions into Playwright JS code using responsive Nvidia NIM models.
 */
async function translateInstruction(userTask) {
  loadEnv();
  const apiKey = process.env.NVIDIA_API_KEY || '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';

  const systemPrompt = getSystemPrompt();
  const messages = Context.getFormattedMessages(systemPrompt, userTask);

  // Candidate models prioritized by task complexity, responsiveness, and compliance
  const candidateModels = (userTask.includes('Connected Google Sheets Data') || userTask.includes('Connected JSON Data') || userTask.includes('Max Tabs'))
    ? [
        'meta/llama-3.1-70b-instruct',
        'meta/llama-3.1-8b-instruct',
        'mistralai/mixtral-8x7b-instruct-v0.1'
      ]
    : [
        'meta/llama-3.1-8b-instruct',
        'meta/llama-3.1-70b-instruct',
        'mistralai/mixtral-8x7b-instruct-v0.1'
      ];

  let rawOutput = '';
  let successfulModel = '';
  let lastError = null;

  for (const model of candidateModels) {
    try {
      console.log(`[LLM: newllm.js] Translating via Nvidia NIM (${model}): "${userTask}"...`);
      rawOutput = await callNvidiaModel(apiKey, model, messages);
      if (rawOutput && rawOutput.trim()) {
        successfulModel = model;
        break;
      }
    } catch (err) {
      console.warn(`[LLM: newllm.js] Model ${model} failed: ${err.message}. Trying next candidate...`);
      lastError = err;
    }
  }

  if (!rawOutput || !rawOutput.trim()) {
    throw new Error(`All LLM models failed to generate Playwright commands: ${lastError?.message || 'Unknown error'}`);
  }

const DISMISS_POPUP_CLEAN = `async function dismissPopupIfPresent(page) {
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
    '[data-testid="close-button"]'
  ];
  for (const selector of closeSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        break;
      }
    } catch (e) {
      // selector not present or not visible in time — try next
    }
  }
}`;

/**
 * Formats raw AI output into clean, beautifully-indented multi-line JavaScript code.
 */
function formatPlaywrightCode(code) {
  if (!code) return '';
  let str = code.trim();

  // 1. Strip markdown code fences if present
  const fenceMatch = str.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) str = fenceMatch[1].trim();

  // 2. Ensure newlines after single-line comments // ... (ignore // inside URLs like https://)
  str = str.replace(/(?<!https?:)(\/\/[^\r\n]*?)(?=(?:async\s+function|const\s+|let\s+|var\s+|await\s+|try\s*\{|catch\s*\(|for\s*\(|if\s*\(|\/\*))/g, '$1\n');

  // 3. If dismissPopupIfPresent is present, replace any inline/collapsed version with standard formatted block
  if (str.includes('dismissPopupIfPresent') && str.includes('closeSelectors')) {
    str = str.replace(/async\s+function\s+dismissPopupIfPresent\s*\([^\)]*\)\s*\{[\s\S]*?\n?\s*\}\s*\}\s*\}/, DISMISS_POPUP_CLEAN);
  }

  // 4. Ensure newlines after closing brace } before comments or statements
  str = str.replace(/\}\s*(?=(?:\/\/\s*|await\s+|const\s+|let\s+|var\s+|async\s+function))/g, '}\n\n');

  // 5. Ensure newlines after semicolons before next comments or statements (only if not inside a URL or string)
  str = str.replace(/;\s*(?=(?:\/\/\s*|await\s+|const\s+|let\s+|var\s+|try\s*\{|if\s*\())/g, ';\n\n');

  // 6. Normalize multiple blank lines
  str = str.replace(/\n{3,}/g, '\n\n');

  return str.trim();
}

  let generatedText = formatPlaywrightCode(rawOutput);

  // Ensure output contains valid executable actions or format as comment
  const hasPlaywrightActions = generatedText.includes('page.') || 
                                generatedText.includes('context.') || 
                                generatedText.includes('browser.') || 
                                generatedText.includes('newTabAccess.');

  if (!hasPlaywrightActions && !generatedText.trim().startsWith('//') && !generatedText.trim().startsWith('/*')) {
    console.warn('[LLM: newllm.js] Generated text was conversational. Wrapping in JS comment.');
    generatedText = `/* Conversational Output (${successfulModel}):\n${generatedText}\n*/\nconsole.log(${JSON.stringify(generatedText)});`;
  }

  console.log(`[LLM: newllm.js] Playwright Code successfully generated using ${successfulModel}:\n${generatedText}`);

  // Persist interaction into Context history
  Context.addInteraction(userTask, generatedText);

  return generatedText;
}

module.exports = {
  translateInstruction,
  getSystemPrompt
};
