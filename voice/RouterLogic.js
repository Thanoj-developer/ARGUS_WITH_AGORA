/**
 * RouterLogic.js
 * ---------------------------------------------------------------------------
 * Classifies an incoming voice query and routes it to the correct inbox:
 *
 *  ORCHESTRATION INBOX  (runOrchestrator)
 *  -> "Open amazon"  / "Go to youtube"  / "Launch gmail"
 *  -> Navigation / initial-state intents
 *
 *  AUTO-NAVIGATION INBOX  (runAutoNavigationLoop)
 *  -> "Book this product" / "Click buy now"
 *  -> In-page actions on the currently open browser state
 *
 *  Classification is done by a fast LLM call, with keyword heuristics
 *  as a zero-latency fallback so the router NEVER blocks.
 * ---------------------------------------------------------------------------
 */

const OpenAI = require('openai');
const { runOrchestrator } = require('./orcastrator');
const { runAutoNavigationLoop } = require('./AutoNavigation');

// ── Constants ─────────────────────────────────────────────────────────────────

const INBOX = {
  ORCHESTRATION:  'ORCHESTRATION',
  AUTO_NAVIGATION: 'AUTO_NAVIGATION',
  UNKNOWN:         'UNKNOWN',
};

// Keywords that strongly suggest ORCHESTRATION (initial navigation) intent
const ORCHESTRATION_KEYWORDS = [
  'open', 'launch', 'go to', 'navigate to', 'visit', 'load',
  'start', 'show me', 'take me to', 'search for', 'find',
];

// Keywords that strongly suggest AUTO-NAVIGATION (in-page action) intent
const AUTO_NAV_KEYWORDS = [
  'click', 'book', 'buy', 'add to cart', 'select', 'fill',
  'type', 'scroll', 'submit', 'checkout', 'purchase', 'tap',
  'press', 'enter', 'choose', 'pick', 'order', 'apply',
];

// ── LLM Classifier ────────────────────────────────────────────────────────────

function getOpenAIClient() {
  const apiKey = process.env.NVIDIA_API_KEY || '';
  return new OpenAI({
    apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
}

/**
 * Ask the LLM to classify the intent.
 * Returns 'ORCHESTRATION' | 'AUTO_NAVIGATION' | 'UNKNOWN'
 */
async function classifyWithLLM(query) {
  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [
        {
          role: 'system',
          content: `You are a voice-command router for a browser automation system.
Classify the user voice command into exactly ONE category:

ORCHESTRATION   -> User wants to navigate to a new website or start a fresh task.
                   Examples: "open amazon", "go to youtube", "launch gmail", "search flipkart"

AUTO_NAVIGATION -> User wants to perform an action on the currently open page.
                   Examples: "book this product", "click buy now", "add to cart",
                   "scroll down", "fill my name", "submit the form", "checkout"

Reply with ONLY ONE WORD: either ORCHESTRATION or AUTO_NAVIGATION.
No explanation. No punctuation.`,
        },
        { role: 'user', content: query },
      ],
      temperature: 0.0,
      max_tokens: 5,
    });

    const raw = completion.choices[0].message.content.trim().toUpperCase();
    if (raw.includes('ORCHESTRATION'))  return INBOX.ORCHESTRATION;
    if (raw.includes('AUTO_NAVIGATION') || raw.includes('AUTO')) return INBOX.AUTO_NAVIGATION;
    return INBOX.UNKNOWN;
  } catch (err) {
    console.error('[RouterLogic] LLM classification failed:', err.message);
    return INBOX.UNKNOWN;
  }
}

// ── Keyword Heuristic (fast fallback) ─────────────────────────────────────────

/**
 * Check if a query contains a keyword phrase with proper word boundaries.
 * Works for both single words ('open') and multi-word phrases ('go to', 'add to cart').
 */
function queryContainsKeyword(lower, kw) {
  // Exact start: "open amazon", "go to youtube"
  if (lower.startsWith(kw + ' ') || lower === kw) return true;
  // Anywhere mid-sentence: "please open amazon", "i want to go to youtube"
  if (lower.includes(' ' + kw + ' ')) return true;
  // At the very end: "the product i want to buy"
  if (lower.endsWith(' ' + kw)) return true;
  return false;
}

/**
 * Lightning-fast keyword-based classification.
 * Used when LLM is unavailable or returns UNKNOWN.
 *
 * Examples that NOW correctly match:
 *   "open amazon"          -> ORCHESTRATION  (startsWith 'open')
 *   "go to youtube"        -> ORCHESTRATION  (startsWith 'go to')
 *   "search for shoes"     -> ORCHESTRATION  (startsWith 'search for')
 *   "book this product"    -> AUTO_NAVIGATION (startsWith 'book')
 *   "add to cart"          -> AUTO_NAVIGATION (startsWith 'add to cart')
 *   "click the buy button" -> AUTO_NAVIGATION (startsWith 'click')
 */
function classifyWithKeywords(query) {
  const lower = query.toLowerCase().trim();

  // Check AUTO_NAV first — actions are more specific, take priority
  for (const kw of AUTO_NAV_KEYWORDS) {
    if (queryContainsKeyword(lower, kw)) {
      console.log(`[RouterLogic] Keyword match (AUTO_NAV): "${kw}" in "${lower}"`);
      return INBOX.AUTO_NAVIGATION;
    }
  }

  for (const kw of ORCHESTRATION_KEYWORDS) {
    if (queryContainsKeyword(lower, kw)) {
      console.log(`[RouterLogic] Keyword match (ORCHESTRATION): "${kw}" in "${lower}"`);
      return INBOX.ORCHESTRATION;
    }
  }

  // Default: orchestration (opening a URL is safer than clicking something unknown)
  console.log(`[RouterLogic] No keyword matched — defaulting to ORCHESTRATION`);
  return INBOX.ORCHESTRATION;
}

// ── Main Router ───────────────────────────────────────────────────────────────

/**
 * Route a voice query to the correct inbox and execute it.
 *
 * @param {string} query                      - The transcribed voice command
 * @param {object} [options]
 * @param {object}   [options.hitlCallbacks]  - HITL callbacks forwarded to AutoNavigation
 * @param {function} [options.onStepLog]      - Step log callback for AutoNavigation SSE
 * @param {boolean}  [options.useLLM=true]    - Set false to skip LLM and use keywords only
 * @returns {Promise<{ inbox: string, query: string, result: object }>}
 */
async function routeVoiceQuery(query, options = {}) {
  const { hitlCallbacks = {}, onStepLog = null, useLLM = true } = options;

  if (!query || !query.trim()) {
    return { inbox: INBOX.UNKNOWN, query, result: { success: false, error: 'Empty query' } };
  }

  const divider = '-'.repeat(60);
  console.log(`\n${divider}`);
  console.log(`[RouterLogic] Incoming voice query: "${query}"`);

  // ── Step 1: Classify ─────────────────────────────────────────────────────────
  let inbox;

  if (useLLM) {
    console.log('[RouterLogic] Classifying with LLM...');
    inbox = await classifyWithLLM(query);

    if (inbox === INBOX.UNKNOWN) {
      console.log('[RouterLogic] LLM returned UNKNOWN — falling back to keyword heuristic...');
      inbox = classifyWithKeywords(query);
    }
  } else {
    inbox = classifyWithKeywords(query);
  }

  console.log(`[RouterLogic] ✅ Routed to -> ${inbox} INBOX`);

  // ── Step 2: Dispatch ──────────────────────────────────────────────────────────
  let result;

  if (inbox === INBOX.ORCHESTRATION) {
    console.log(`[RouterLogic] [ORCHESTRATION INBOX] Pushing: "${query}"`);
    result = await runOrchestrator(query);
    console.log(`[RouterLogic] Orchestration ${result.success ? 'SUCCESS' : 'FAILED'}`);

  } else if (inbox === INBOX.AUTO_NAVIGATION) {
    console.log(`[RouterLogic] [AUTO-NAVIGATION INBOX] Pushing: "${query}"`);
    result = await runAutoNavigationLoop(query, hitlCallbacks, onStepLog);
    console.log(`[RouterLogic] AutoNav finished with status: ${result.status}`);

  } else {
    console.log(`[RouterLogic] ⚠️  Unknown inbox — defaulting to ORCHESTRATION`);
    inbox = INBOX.ORCHESTRATION;
    result = await runOrchestrator(query);
  }

  console.log(`${divider}\n`);
  return { inbox, query, result };
}

// ── Classify Only (no execution) ──────────────────────────────────────────────

/**
 * Classify a query without executing anything.
 * Useful for previewing what inbox a command will land in.
 *
 * @param {string}  query
 * @param {boolean} [useLLM=true]
 * @returns {Promise<{ inbox: string, confidence: 'llm' | 'keyword' | 'none' }>}
 */
async function classifyQuery(query, useLLM = true) {
  if (!query || !query.trim()) return { inbox: INBOX.UNKNOWN, confidence: 'none' };

  let inbox;
  let confidence;

  if (useLLM) {
    inbox = await classifyWithLLM(query);
    if (inbox === INBOX.UNKNOWN) {
      inbox = classifyWithKeywords(query);
      confidence = 'keyword';
    } else {
      confidence = 'llm';
    }
  } else {
    inbox = classifyWithKeywords(query);
    confidence = 'keyword';
  }

  return { inbox, confidence };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { routeVoiceQuery, classifyQuery, INBOX };
