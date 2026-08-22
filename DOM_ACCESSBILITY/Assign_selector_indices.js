/**
 * DOM_ACCESSBILITY/Assign_selector_indices.js
 * Step 3: Assign Selector Indices (Numeric Indexed Map)
 * 
 * Maps filtered actionable elements to 1-based numeric indices [1], [2], [3]...
 * Prioritizes high-intent buttons ("Buy Now", "Add to Cart") to index 1, 2 for top preference.
 */

const { extractAccessibilityRoles, isBuyNowRelated } = require('./accessibility');

function buildFallbackSelector(el) {
  if (el.selector) return el.selector;

  const role = el.role ? el.role.toLowerCase() : '';
  const name = el.name ? el.name.trim() : '';

  if (role === 'button' && name) {
    const escapedName = name.replace(/"/g, '\\"');
    return `button:has-text("${escapedName}"), input[value="${escapedName}"], [role="button"]:has-text("${escapedName}"), span:has-text("${escapedName}")`;
  }
  if (role === 'link' && name) {
    return `a:has-text("${name.replace(/"/g, '\\"')}")`;
  }
  if ((role === 'textbox' || role === 'searchbox') && name) {
    return `input[placeholder="${name.replace(/"/g, '\\"')}"], textarea[placeholder="${name.replace(/"/g, '\\"')}"]`;
  }
  if (role === 'combobox' && name) {
    return `select[aria-label="${name.replace(/"/g, '\\"')}"]`;
  }
  if (role === 'checkbox' && name) {
    return `input[type="checkbox"][aria-label="${name.replace(/"/g, '\\"')}"]`;
  }
  if (role === 'radio' && name) {
    return `input[type="radio"][aria-label="${name.replace(/"/g, '\\"')}"]`;
  }
  if (name) {
    return `[aria-label="${name.replace(/"/g, '\\"')}"], :has-text("${name.replace(/"/g, '\\"')}")`;
  }
  return `[role="${role}"]`;
}

/**
 * Builds selector map with Buy Now / Add to Cart prioritized to index 1.
 * @param {Array<object>} elements
 */
function buildSelectorMap(elements) {
  const selectorMap = {};
  if (!Array.isArray(elements)) return selectorMap;

  // Stable sort: high-priority "Buy Now" / "Add to Cart" elements move to the front
  const sorted = [...elements].sort((a, b) => {
    const aPri = (a.isHighPriority || isBuyNowRelated(a)) ? 1 : 0;
    const bPri = (b.isHighPriority || isBuyNowRelated(b)) ? 1 : 0;
    return bPri - aPri;
  });

  sorted.forEach((el, i) => {
    const index = i + 1;
    const resolvedSelector = el.selector || buildFallbackSelector(el);
    const isPriority = Boolean(el.isHighPriority || isBuyNowRelated(el));

    let playCode = '';
    if (el.role === 'textbox' || el.role === 'searchbox') {
      playCode = `await page.locator('${resolvedSelector}').first().fill('...');`;
    } else {
      playCode = `await page.locator('${resolvedSelector}').first().click();`;
    }

    selectorMap[index] = {
      index,
      priority: isPriority ? 'high' : 'normal',
      role: el.role,
      name: el.name || null,
      value: el.value !== undefined ? el.value : undefined,
      disabled: el.disabled || undefined,
      checked: el.checked || undefined,
      selector: resolvedSelector,
      playCode
    };
  });
  return selectorMap;
}

async function assignSelectorIndices(input, options = {}) {
  let elements = [];
  let pageTitle = 'Page';

  if (Array.isArray(input)) {
    elements = input;
  } else if (input && typeof input.url === 'function') {
    const extracted = await extractAccessibilityRoles(input, options);
    elements = extracted.allActionable || [];
    pageTitle = extracted.pageTitle || 'Page';
  } else if (input && input.allActionable) {
    elements = input.allActionable;
    pageTitle = input.pageTitle || 'Page';
  } else if (input && input.children) {
    const { extractInteractive } = require('./accessibility');
    const extracted = extractInteractive(input);
    elements = extracted.allActionable || [];
    pageTitle = input.name || 'Page';
  }

  const selectorMap = buildSelectorMap(elements);
  const totalCount = Object.keys(selectorMap).length;
  const highPriorityItems = Object.values(selectorMap).filter(item => item.priority === 'high');

  console.log(`\n================== [Step 3: Assign Selector Indices] ==================`);
  console.log(`[Page Title]       : ${pageTitle}`);
  console.log(`[Indexed Elements] : ${totalCount} assigned to numeric keys [1..${totalCount}]`);
  if (highPriorityItems.length > 0) {
    console.log(`[Top Priority ⭐]   : ${highPriorityItems.length} purchase buttons pinned to top indices:`);
    highPriorityItems.forEach(item => {
      console.log(`  ⭐ [${item.index}] (${item.role}) "${item.name}" -> ${item.selector}`);
    });
  }
  console.log(`========================================================================\n`);

  return {
    pageTitle,
    totalCount,
    highPriorityCount: highPriorityItems.length,
    selectorMap
  };
}

module.exports = {
  buildFallbackSelector,
  buildSelectorMap,
  assignSelectorIndices
};