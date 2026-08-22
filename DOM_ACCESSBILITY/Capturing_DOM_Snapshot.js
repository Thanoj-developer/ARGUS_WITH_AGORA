/**
 * DOM_ACCESSBILITY/Capturing_DOM_Snapshot.js
 * Step 1: Capture Accessibility Tree Snapshot
 * 
 * Extracts the true Accessibility Tree (roles, accessible names, values, and children)
 * from the live Playwright Page instance.
 */

/**
 * Captures the full accessibility tree with interactive roles and names.
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @returns {Promise<{role: string, name: string, children: Array<object>}>}
 */
async function captureAccessibilitySnapshot(page, options = {}) {
  if (!page || page.isClosed()) {
    throw new Error('Active Playwright page is closed or not available.');
  }

  // Ensure DOM is ready
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  const url = page.url();
  const pageTitle = await page.title().catch(() => 'Untitled');

  console.log(`\n================== [Step 1: Capture Accessibility Snapshot] ==================`);
  console.log(`[Target URL] : ${url}`);
  console.log(`[Page Title] : ${pageTitle}`);

  let tree = null;

  // 1. Try native page.accessibility.snapshot (available in some Playwright versions)
  if (page.accessibility && typeof page.accessibility.snapshot === 'function') {
    try {
      tree = await page.accessibility.snapshot({ 
        interestingOnly: options.interestingOnly !== undefined ? options.interestingOnly : true 
      });
    } catch (e) {
      console.warn('[Accessibility] Native snapshot failed, falling back to DOM AX Tree evaluator:', e.message);
    }
  }

  // 2. Comprehensive DOM Accessibility Tree Extraction (Modern Playwright standard)
  if (!tree || !tree.children || tree.children.length === 0) {
    tree = await page.evaluate(() => {
      // Helper: Compute Accessible Name according to W3C AccName spec basics
      function getAccessibleName(el, labelsMap) {
        // 1. aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelText = labelledBy.split(' ')
            .map(id => document.getElementById(id)?.textContent?.trim())
            .filter(Boolean)
            .join(' ');
          if (labelText) return labelText;
        }

        // 2. aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

        // 3. Native labels for form inputs
        if (el.id && labelsMap.has(el.id)) {
          const labelText = labelsMap.get(el.id);
          if (labelText) return labelText;
        }
        const parentLabel = el.closest('label');
        if (parentLabel) {
          const labelText = (parentLabel.textContent || '').trim();
          if (labelText) return labelText;
        }

        // 4. placeholder
        if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();

        // 5. title or alt
        if (el.title && el.title.trim()) return el.title.trim();
        if (el.alt && el.alt.trim()) return el.alt.trim();

        // 6. button / link / input value
        if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) {
          return el.value || el.placeholder || '';
        }

        // 7. Visible text content
        const text = el.textContent;
        return text ? text.replace(/\s+/g, ' ').trim() : '';
      }

      // Helper: Compute ARIA role
      function getRole(el) {
        const explicitRole = el.getAttribute('role');
        if (explicitRole) return explicitRole.toLowerCase();

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || 'text').toLowerCase();

        if (tag === 'button') return 'button';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';

        if (tag === 'input') {
          if (['button', 'submit', 'reset'].includes(type)) return 'button';
          if (['checkbox'].includes(type)) return 'checkbox';
          if (['radio'].includes(type)) return 'radio';
          if (['search'].includes(type)) return 'searchbox';
          if (['text', 'email', 'password', 'tel', 'number', 'url'].includes(type)) return 'textbox';
          return 'textbox';
        }

        if (tag === 'summary') return 'button';
        if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return 'generic_interactive';

        return null;
      }

      // Helper: Generate robust CSS selector
      function getSelector(el) {
        // Prioritize value-based selectors for radio buttons and checkboxes
        if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) {
          const val = el.getAttribute('value');
          if (val) {
            return `input[type="${el.type}"][value="${CSS.escape(val)}"]`;
          }
        }

        function isDynamicId(id) {
          if (!id) return false;
          return /^pp-[a-zA-Z0-9]+-/.test(id);
        }

        if (el.id && !isDynamicId(el.id)) return `#${CSS.escape(el.id)}`;
        
        // Parent ID fallback walk (up to 3 levels)
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 3) {
          if (parent.id && !isDynamicId(parent.id)) {
            return `#${CSS.escape(parent.id)} ${el.tagName.toLowerCase()}`;
          }
          parent = parent.parentElement;
          depth++;
        }


        const name = el.getAttribute('name');
        if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return `${el.tagName.toLowerCase()}[placeholder="${CSS.escape(placeholder)}"]`;
        return null;
      }

      // Precompute labels mapping once to avoid querySelector in loop
      const labelsMap = new Map();
      const allLabels = document.querySelectorAll('label');
      for (let i = 0; i < allLabels.length; i++) {
        const label = allLabels[i];
        const htmlFor = label.getAttribute('for');
        if (htmlFor) {
          labelsMap.set(htmlFor, (label.textContent || '').trim());
        }
      }

      const elements = [];
      const queried = document.querySelectorAll('button, input, select, textarea, a[href], summary, [role], [tabindex]');

      for (const el of queried) {
        const role = getRole(el);
        if (!role) continue;

        // Visibility & Size Check
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') {
          continue;
        }

        const name = getAccessibleName(el, labelsMap);
        const selector = getSelector(el);

        elements.push({
          role,
          name: name.slice(0, 150), // Trim very long labels
          value: el.value !== undefined && el.type !== 'password' ? el.value : undefined,
          disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
          checked: el.checked || el.getAttribute('aria-checked') === 'true' || undefined,
          selector: selector || undefined
        });
      }

      const text = (document.body.innerText || '').toLowerCase();
      const successKeywords = [
        'thank you for your purchase',
        'thank you for ordering',
        'order has been placed',
        'booking has been confirmed',
        'payment successful',
        'order placed',
        'booking complete',
        'transaction complete',
        'purchase complete',
        'order confirmed',
        'booking confirmed'
      ];
      let isPurchaseComplete = successKeywords.some(keyword => text.includes(keyword));

      const title = (document.title || '').toLowerCase();
      const url = (window.location.href || '').toLowerCase();
      const titleUrlKeywords = [
        'thank-you',
        'thankyou',
        'order-received',
        'checkout/complete',
        'booking-confirmed'
      ];
      const isMatch = titleUrlKeywords.some(keyword => title.includes(keyword) || url.includes(keyword));
      isPurchaseComplete = isPurchaseComplete || isMatch;

      return {
        role: 'WebArea',
        name: document.title || 'Page',
        children: elements,
        isPurchaseComplete
      };
    });
  }

  const childCount = tree?.children?.length || 0;
  console.log(`[Accessibility Tree] Extracted ${childCount} interactive elements.`);
  console.log(`[Sample Elements]    :`, JSON.stringify(tree.children.slice(0, 5), null, 2));
  console.log(`===============================================================================\n`);

  return tree;
}

module.exports = {
  captureAccessibilitySnapshot
};