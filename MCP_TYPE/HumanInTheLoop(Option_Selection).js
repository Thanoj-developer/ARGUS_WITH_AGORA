/**
 * Human-In-The-Loop Option Selection helper functions (Payment-scoped).
 */

/**
 * Checks if a radio element's metadata matches payment-related keywords.
 */
function isPaymentRelated(el) {
  const paymentKeywords = [
    'payment',
    'method',
    'instrument',
    'netbanking',
    'net banking',
    'cash on delivery',
    'pay on delivery',
    'cod',
    'credit',
    'debit',
    'card',
    'upi',
    'emi',
    'wallet',
    'bank',
    'pay',
    'checkout'
  ];

  const name = (el.name || '').toLowerCase();
  const value = (el.value || '').toLowerCase();
  const selector = (el.selector || '').toLowerCase();

  return paymentKeywords.some(keyword => 
    name.includes(keyword) || 
    value.includes(keyword) || 
    selector.includes(keyword)
  );
}

/**
 * Normalizes element value/selector to construct a readable option name if el.name is missing.
 */
function getFriendlyOptionName(el) {
  if (el.name && el.name.trim() !== 'null' && el.name.trim() !== '') {
    return el.name.trim();
  }
  
  if (el.value) {
    // Try to extract paymentMethod
    const methodMatch = el.value.match(/paymentMethod=([^&]+)/);
    if (methodMatch) {
      const method = methodMatch[1];
      return method.replace(/([A-Z])/g, ' $1').trim();
    }
    
    // Try to extract instrumentId
    const instrumentMatch = el.value.match(/instrumentId=([^&]+)/);
    if (instrumentMatch) {
      return instrumentMatch[1].split('.')[0].replace(/([A-Z])/g, ' $1').trim();
    }
  }

  // Fallback: clean up selector
  if (el.selector) {
    const idMatch = el.selector.match(/#([a-zA-Z0-9_\-]+)/);
    if (idMatch) {
      return `Option (${idMatch[1]})`;
    }
  }
  
  return `Option (Index ${el.index})`;
}

/**
 * Detects if there are multiple active payment radio options on the page.
 *
 * @param {Array} elementsList - List of interactive accessibility elements on the page.
 * @param {Array} history - List of executed steps from the orchestrator state.
 * @returns {Object|null} - The option details list if payment radio buttons are detected, otherwise null.
 */
function checkForOptionSelection(elementsList, history) {
  if (!elementsList || !Array.isArray(elementsList)) return null;

  const radioElements = [];
  const executedIndices = new Set((history || []).map(step => step.index !== undefined ? Number(step.index) : -1));

  for (const el of elementsList) {
    const role = (el.role || '').toLowerCase();
    
    // Check if it's an active radio button
    if (role === 'radio') {
      // Skip if disabled
      if (el.disabled === true) continue;
      
      // Skip if not related to payment methods
      if (!isPaymentRelated(el)) continue;
      
      radioElements.push({
        index: el.index,
        name: getFriendlyOptionName(el),
        role: el.role,
        selector: el.selector
      });
    }
  }

  // Check if any payment-related radio button is already checked in the live DOM.
  // If so, a selection is already active and we do not need to show the pop-up again.
  const isOptionChecked = elementsList.some(el => {
    const role = (el.role || '').toLowerCase();
    return role === 'radio' && el.checked === true && isPaymentRelated(el);
  });

  if (isOptionChecked) {
    console.log('[Option HITL] A payment option is already checked on the live page. Bypassing prompt.');
    return null;
  }

  // Trigger only if there are 2 or more payment options available to choose from
  if (radioElements.length >= 2) {
    return {
      options: radioElements
    };
  }

  return null;
}

module.exports = {
  checkForOptionSelection
};
