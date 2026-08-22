/**
 * DOM_ACCESSBILITY/accessibility.js
 * Step 2: Extract & Filter Accessibility Roles
 * 
 * Filters raw snapshot down to actionable elements and prioritizes
 * high-value conversion/purchase actions ("Buy Now", "Add to Cart") at the top.
 */

const { captureAccessibilitySnapshot } = require('./Capturing_DOM_Snapshot');

const ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'radiogroup'
]);

// Patterns for high-priority purchase/conversion actions
const HIGH_PRIORITY_PATTERNS = [
  /\bbuy\s*now\b/i,
  /\badd\s*to\s*(cart|bag|basket)\b/i,
  /\b(proceed\s*to\s*)?(checkout|buy)\b/i,
  /\bplace\s*(your\s*)?order\b/i,
  /\border\s*now\b/i
];

/**
 * Returns true if the element is a primary purchase action (Buy Now / Add to Cart).
 */
function isBuyNowRelated(node) {
  if (!node) return false;
  const name = (node.name || '').toLowerCase();
  const selector = (node.selector || '').toLowerCase();
  return HIGH_PRIORITY_PATTERNS.some(p => p.test(name) || p.test(selector));
}

function extractInteractive(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.children)) {
    return { clean: [], needsReview: [], allActionable: [], stats: { totalActionable: 0 } };
  }

  const clean = [];
  const needsReview = [];
  const roleBreakdown = {};

  for (const node of snapshot.children) {
    if (!ACTIONABLE_ROLES.has(node.role)) continue;

    const hasName = node.name && node.name.trim().length > 0;
    const hasSelector = Boolean(node.selector);
    if (!hasName && !hasSelector) continue; // truly unusable, drop it

    // Track role breakdown
    roleBreakdown[node.role] = (roleBreakdown[node.role] || 0) + 1;

    const isMultiLineName = hasName && node.name.includes('\n');
    const isUnlabeled = !hasName;

    const isPriority = isBuyNowRelated(node);
    const item = {
      ...node,
      isHighPriority: isPriority || undefined
    };

    if (isMultiLineName || isUnlabeled) {
      needsReview.push(item);
    } else {
      clean.push(item);
    }
  }

  // Sort clean array so Buy Now / Add to Cart elements appear at the very top (index 1)
  clean.sort((a, b) => {
    const aPri = isBuyNowRelated(a) ? 1 : 0;
    const bPri = isBuyNowRelated(b) ? 1 : 0;
    return bPri - aPri;
  });

  const allActionable = [...clean, ...needsReview];

  // Also ensure high priority items lead allActionable
  allActionable.sort((a, b) => {
    const aPri = isBuyNowRelated(a) ? 1 : 0;
    const bPri = isBuyNowRelated(b) ? 1 : 0;
    return bPri - aPri;
  });

  const highPriorityCount = allActionable.filter(isBuyNowRelated).length;

  return {
    clean,
    needsReview,
    allActionable,
    stats: {
      totalActionable: allActionable.length,
      highPriorityCount,
      cleanCount: clean.length,
      needsReviewCount: needsReview.length,
      roleBreakdown
    }
  };
}

async function extractAccessibilityRoles(pageOrSnapshot, options = {}) {
  let snapshot;
  if (pageOrSnapshot && typeof pageOrSnapshot.url === 'function') {
    snapshot = await captureAccessibilitySnapshot(pageOrSnapshot, options);
  } else {
    snapshot = pageOrSnapshot;
  }

  const result = extractInteractive(snapshot);

  console.log(`\n================== [Step 2: Extract Accessibility Roles] ==================`);
  console.log(`[Total Actionable] : ${result.stats.totalActionable} elements`);
  console.log(`[High Priority ⭐] : ${result.stats.highPriorityCount} ("Buy Now" / "Add to Cart")`);
  console.log(`[Clean Elements]   : ${result.stats.cleanCount}`);
  console.log(`[Needs Review]     : ${result.stats.needsReviewCount}`);
  console.log(`[Role Breakdown]   :`, JSON.stringify(result.stats.roleBreakdown, null, 2));
  console.log(`===========================================================================\n`);

  return {
    pageTitle: snapshot.name || 'Untitled',
    ...result
  };
}

module.exports = {
  ACTIONABLE_ROLES,
  HIGH_PRIORITY_PATTERNS,
  isBuyNowRelated,
  extractInteractive,
  extractAccessibilityRoles
};