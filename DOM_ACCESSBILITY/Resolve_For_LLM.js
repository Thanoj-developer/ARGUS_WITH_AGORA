/**
 * DOM_ACCESSBILITY/Resolve_For_LLM.js
 * 
 * Strict resolution guard for LLM intent matching & Manual Index/Target selection.
 */

const { nameMatches, disambiguate } = require('./Resolve_Target_element');

/**
 * Resolves user / LLM intent into a concrete indexed target.
 * Supports:
 * - Direct index: { index: 3 }
 * - Direct selector: { selector: "#id" }
 * - Role & Name: { role: "button", name: "Buy Now" }
 * - Name only: { name: "Search" }
 * @param {object} intent
 * @param {Record<number, object>} selectorMap
 */
function resolveTarget(intent, selectorMap) {
  if (!intent || typeof intent !== 'object' || !selectorMap || typeof selectorMap !== 'object') {
    return undefined; // guard: invalid input
  }

  // 1. Direct Index resolution (Manual UI selection or LLM index output)
  if (intent.index !== undefined) {
    const idx = parseInt(intent.index, 10);
    if (!isNaN(idx) && selectorMap[idx]) {
      const match = selectorMap[idx];
      const role = (match.role || '').toLowerCase();
      const defaultAction = (role === 'textbox' || role === 'searchbox') ? 'fill' : (role === 'combobox' || role === 'listbox') ? 'select' : 'click';
      return {
        ...match,
        action: intent.action || defaultAction,
        value: intent.value !== undefined ? intent.value : match.value
      };
    }
  }

  // 2. Direct Selector resolution
  if (intent.selector) {
    const match = Object.values(selectorMap).find(e => e && e.selector === intent.selector);
    if (match) {
      const role = (match.role || '').toLowerCase();
      const defaultAction = (role === 'textbox' || role === 'searchbox') ? 'fill' : (role === 'combobox' || role === 'listbox') ? 'select' : 'click';
      return {
        ...match,
        action: intent.action || defaultAction,
        value: intent.value !== undefined ? intent.value : match.value
      };
    }
  }

  // 3. Guard: Require at least role or name for semantic matching
  if (!intent.role && !intent.name) {
    return undefined;
  }

  const pool = Object.values(selectorMap).filter(e => e && e.matchable !== false);

  const candidates = pool.filter(e => {
    if (intent.role && intent.role !== '*' && e.role !== intent.role) {
      return false;
    }
    if (intent.name && !nameMatches(e.name || "", intent.name)) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) return undefined;
  
  const chosen = candidates.length === 1 ? candidates[0] : disambiguate(candidates, intent);
  if (!chosen) return undefined;

  const role = (chosen.role || '').toLowerCase();
  const defaultAction = (role === 'textbox' || role === 'searchbox') ? 'fill' : (role === 'combobox' || role === 'listbox') ? 'select' : 'click';
  return {
    ...chosen,
    action: intent.action || defaultAction,
    value: intent.value !== undefined ? intent.value : chosen.value
  };
}

module.exports = {
  resolveTarget
};