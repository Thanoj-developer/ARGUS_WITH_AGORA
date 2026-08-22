/**
 * DOM_ACCESSBILITY/Resolve_Target_element.js
 * Step 4: Resolve Target Element
 * 
 * Matches user intent (role, name, value, state) against the indexed selector map.
 * Returns the resolved target element or signals for Vision Model fallback.
 */

const { assignSelectorIndices } = require('./Assign_selector_indices');

/**
 * Escapes regex special characters in search patterns.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if the entry's accessible name matches the intent name.
 * @param {string} entryName
 * @param {string} intentName
 * @returns {boolean}
 */
function nameMatches(entryName, intentName) {
  if (!entryName || !intentName) return false;
  const a = entryName.toLowerCase().trim();
  const b = intentName.toLowerCase().trim();

  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  try {
    const escaped = escapeRegex(b);
    return new RegExp(`\\b${escaped}\\b`, 'i').test(a);
  } catch (e) {
    return a.includes(b);
  }
}

/**
 * Disambiguates between multiple matching candidate elements.
 * @param {Array<object>} candidates
 * @param {object} intent
 * @returns {object}
 */
function disambiguate(candidates, intent) {
  if (!candidates || candidates.length === 0) return undefined;

  // 1. Match checked/disabled state if specified
  if (intent.checked !== undefined) {
    const stateMatch = candidates.find(c => c.checked === intent.checked);
    if (stateMatch) return stateMatch;
  }

  // 2. Exact name match preference over partial match
  if (intent.name) {
    const exact = candidates.find(c => (c.name || '').toLowerCase().trim() === intent.name.toLowerCase().trim());
    if (exact) return exact;
  }

  // 3. Fallback: First match
  return candidates[0];
}

/**
 * Resolves target element from an intent against the selector map.
 * @param {object|string} intent - E.g. { role: 'button', name: 'Submit' } or "Gmail"
 * @param {Record<number, object>} selectorMap
 * @returns {object|undefined}
 */
function resolveTarget(intent, selectorMap) {
  if (!selectorMap || typeof selectorMap !== 'object') return undefined;

  // Normalize intent if passed as simple string
  let parsedIntent = typeof intent === 'string' 
    ? { name: intent.trim() } 
    : { ...intent };

  // 1. Direct Index resolution
  if (parsedIntent.index !== undefined) {
    const idx = parseInt(parsedIntent.index, 10);
    if (!isNaN(idx) && selectorMap[idx]) {
      return selectorMap[idx];
    }
  }

  const pool = Object.values(selectorMap).filter(e => e && e.matchable !== false);

  const candidates = pool.filter(e => {
    // If role is specified, verify role matches
    if (parsedIntent.role && parsedIntent.role !== '*' && e.role !== parsedIntent.role) {
      return false;
    }
    // If name is specified, verify name matches
    if (parsedIntent.name && !nameMatches(e.name || '', parsedIntent.name)) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  return disambiguate(candidates, parsedIntent);
}

/**
 * Step 4 Runner: Resolves intent against live page or selector map.
 * @param {import('@playwright/test').Page | object} pageOrMap
 * @param {object|string} intent
 */
async function resolveTargetElement(pageOrMap, intent) {
  let selectorMap = {};
  let pageTitle = 'Page';

  // Parse parameters if passed as string JSON from UI
  let parsedIntent = intent;
  if (typeof intent === 'string') {
    try {
      parsedIntent = JSON.parse(intent);
    } catch (e) {
      parsedIntent = { name: intent };
    }
  }

  if (pageOrMap && typeof pageOrMap.url === 'function') {
    // Live page: run pipeline up to Step 3
    const indexed = await assignSelectorIndices(pageOrMap);
    selectorMap = indexed.selectorMap;
    pageTitle = indexed.pageTitle;
  } else if (pageOrMap && pageOrMap.selectorMap) {
    selectorMap = pageOrMap.selectorMap;
    pageTitle = pageOrMap.pageTitle || 'Page';
  } else {
    selectorMap = pageOrMap || {};
  }

  const target = resolveTarget(parsedIntent || { name: '' }, selectorMap);
  const found = Boolean(target);

  console.log(`\n================== [Step 4: Resolve Target Element] ==================`);
  console.log(`[Target Query Intent] :`, JSON.stringify(parsedIntent));
  console.log(`[Resolution Status]   : ${found ? 'FOUND (Fast DOM Path)' : 'NOT FOUND (Requires Vision Fallback)'}`);
  if (found) {
    console.log(`[Resolved Element]    : [${target.index}] (${target.role}) "${target.name}" -> ${target.selector}`);
    console.log(`[Playwright Action]   : ${target.playCode}`);
  }
  console.log(`=======================================================================\n`);

  return {
    found,
    pageTitle,
    intent: parsedIntent,
    target: target || null,
    fallbackSuggested: found ? null : 'visionModelFallback'
  };
}

module.exports = {
  nameMatches,
  disambiguate,
  resolveTarget,
  resolveTargetElement
};