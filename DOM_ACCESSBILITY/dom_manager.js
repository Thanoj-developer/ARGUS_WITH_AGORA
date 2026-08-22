/**
 * DOM_ACCESSBILITY/dom_manager.js
 * 
 * Central coordinator for Step-by-Step DOM & Accessibility Management.
 */

const { captureAccessibilitySnapshot } = require('./Capturing_DOM_Snapshot');
const { extractAccessibilityRoles } = require('./accessibility');
const { assignSelectorIndices } = require('./Assign_selector_indices');
const { resolveTargetElement } = require('./Resolve_Target_element');
const { resolveTarget, formatSelectorMapForLLM } = require('./Resolve_For_LLM');
const { runClickOrFill } = require('./Run_Action_Execution');

// Module-level cache to share state across steps for the active page
let stateCache = {
  page: null,
  url: null,
  tree: null,
  roles: null,
  indexed: null
};

function getCache(page) {
  const currentUrl = page.url();
  if (stateCache.page !== page || stateCache.url !== currentUrl) {
    stateCache = {
      page: page,
      url: currentUrl,
      tree: null,
      roles: null,
      indexed: null
    };
  }
  return stateCache;
}

function updateCache(page, updates) {
  const cached = getCache(page);
  Object.assign(cached, updates);
}

function clearCache() {
  stateCache = {
    page: null,
    url: null,
    tree: null,
    roles: null,
    indexed: null
  };
}

/**
 * Step 1: Capture DOM & Accessibility Tree Snapshot
 */
async function captureDomSnapshot(page, params) {
  const tree = await captureAccessibilitySnapshot(page, params || {});
  updateCache(page, { tree, roles: null, indexed: null });
  return tree;
}

/**
 * Step 2: Extract & Filter Accessibility Roles
 */
async function extractRoles(page, params) {
  const cached = getCache(page);
  if (!cached.tree) {
    cached.tree = await captureAccessibilitySnapshot(page, params || {});
  }

  if (cached.roles) {
    return cached.roles;
  }

  const roles = await extractAccessibilityRoles(cached.tree, params || {});
  updateCache(page, { roles });
  return roles;
}

/**
 * Step 3: Assign Numeric Selector Indices
 */
async function assignIndices(page, params) {
  const cached = getCache(page);
  if (!cached.roles) {
    cached.roles = await extractRoles(page, params);
  }

  if (cached.indexed) {
    return cached.indexed;
  }

  const indexed = await assignSelectorIndices(cached.roles, params || {});
  updateCache(page, { indexed });
  return indexed;
}

/**
 * Step 4: Resolve Target Element from User / LLM Intent
 */
async function resolveElement(page, params) {
  const cached = getCache(page);
  if (!cached.indexed) {
    cached.indexed = await assignIndices(page, params);
  }

  // Pass cached indexed results directly to avoid re-snapshotting the page
  return await resolveTargetElement(cached.indexed, params || {});
}

/**
 * Step 5: Run Click or Fill (Action Execution)
 */
async function executeAction(page, params, context) {
  let parsed = params;
  if (typeof params === 'string') {
    try {
      parsed = JSON.parse(params);
    } catch (e) {
      parsed = { index: parseInt(params, 10) || undefined, name: params };
    }
  }

  // Handle batch execution of actions
  if (parsed && parsed.actions && Array.isArray(parsed.actions)) {
    const cached = getCache(page);
    if (!cached.indexed) {
      cached.indexed = await assignIndices(page, parsed);
    }
    const selectorMap = cached.indexed.selectorMap;
    
    // Resolve selectors for all actions in the batch
    for (const actionItem of parsed.actions) {
      if (!actionItem.selector && actionItem.index !== undefined) {
        const resolved = resolveTarget(actionItem, selectorMap);
        if (resolved) {
          Object.assign(actionItem, resolved);
        }
      }
    }

    const { executeBatchActions } = require('../MCP_TYPE/multi_field_filling');
    console.log(`[dom_manager] Executing batch of ${parsed.actions.length} actions...`);
    await executeBatchActions(page, selectorMap, parsed.actions);
    
    clearCache();
    return {
      success: true,
      message: `Successfully executed batch of ${parsed.actions.length} actions.`
    };
  }

  // Pre-resolve selector using cached index mappings to avoid runClickOrFill triggering a fresh snapshot
  if (parsed && !parsed.selector) {
    const cached = getCache(page);
    if (!cached.indexed) {
      cached.indexed = await assignIndices(page, parsed);
    }
    const resolved = resolveTarget(parsed, cached.indexed.selectorMap);
    if (resolved) {
      parsed = { ...parsed, ...resolved };
    }
  }

  const result = await runClickOrFill(page, parsed || {}, context);

  // Invalidate cache immediately after executing a DOM-modifying action
  clearCache();

  return result;
}

module.exports = {
  captureDomSnapshot,
  extractAccessibilityRoles: extractRoles,
  extractRoles,
  assignSelectorIndices: assignIndices,
  assignIndices,
  resolveTargetElement: resolveElement,
  resolveElement,
  resolveTarget,
  formatSelectorMapForLLM,
  runClickOrFill: executeAction,
  executeAction
};
