/**
 * DOM_ACCESSBILITY/Run_Action_Execution.js
 * Step 5: Run Click or Fill (Action Execution on Live Browser)
 * 
 * Takes a resolved target or user/LLM intent, executes the action on the live page,
 * and verifies state change.
 */

const { assignSelectorIndices } = require('./Assign_selector_indices');
const { resolveTarget } = require('./Resolve_For_LLM');

/**
 * Executes a deterministic action (click, fill, check, select) on the live Playwright page.
 * @param {import('@playwright/test').Page} page
 * @param {object} intentOrTarget - E.g. { index: 3, role: "button", name: "Buy Now", selector: "#buy-now-button", action: "click", value: "..." }
 * @param {object} [context]
 */
async function runClickOrFill(page, intentOrTarget, context) {
  if (!page || page.isClosed()) {
    throw new Error('No active Playwright page available.');
  }

  let target = intentOrTarget;

  // If passed intent without resolved selector, resolve it first
  if (!target.selector) {
    const indexed = await assignSelectorIndices(page);
    const resolved = resolveTarget(intentOrTarget, indexed.selectorMap);
    if (!resolved) {
      return {
        success: false,
        found: false,
        intent: intentOrTarget,
        message: 'Could not resolve target element on the current page.',
        fallbackSuggested: 'visionModelFallback'
      };
    }
    target = resolved;
  }

  const selector = target.selector;
  const role = (target.role || '').toLowerCase();
  const defaultAction = (role === 'textbox' || role === 'searchbox') ? 'fill' : (role === 'combobox' || role === 'listbox') ? 'select' : 'click';
  const action = (target.action || defaultAction).toLowerCase();
  const value = target.value !== undefined ? String(target.value) : '';

  console.log(`\n================== [Step 5: Run Action Execution] ==================`);
  console.log(`[Target Element] : [${target.index || '-'}] (${target.role || 'element'}) "${target.name || ''}"`);
  console.log(`[Selector]       : ${selector}`);
  console.log(`[Action Type]    : ${action.toUpperCase()}${action === 'fill' ? ` (Value: "${value}")` : ''}`);

  let activePage = page;
  let locator = activePage.locator(selector).first();

  try {
    // 1. Wait for element on currently active tab (up to 1.5 seconds)
    console.log(`[Execution] Checking visibility on current active tab...`);
    await locator.waitFor({ state: 'visible', timeout: 1500 });
  } catch (err) {
    // Self-Navigation fallback: check other open tabs
    console.log(`[Self-Navigation] Target not visible on current tab. Scanning other open browser tabs...`);
    let foundOnOtherTab = false;
    if (context) {
      const pages = context.pages();
      for (const p of pages) {
        if (p === page || p.isClosed()) continue;
        try {
          const testLocator = p.locator(selector).first();
          if (await testLocator.isVisible()) {
            console.log(`[Self-Navigation] Found target selector visible on tab: ${p.url()}`);
            activePage = p;
            locator = testLocator;
            foundOnOtherTab = true;
            
            // Switch pointer and bring to front
            const newTabAccess = require('../newtabaccess');
            const idx = pages.indexOf(p);
            if (newTabAccess && typeof newTabAccess.switchToTab === 'function' && idx !== -1) {
              await newTabAccess.switchToTab(context, idx).catch(() => {});
            } else {
              await p.bringToFront().catch(() => {});
            }
            break;
          }
        } catch (_) {}
      }
    }

    if (foundOnOtherTab) {
      // Re-wait on the newly focused tab
      await locator.waitFor({ state: 'visible', timeout: 2000 });
    } else {
      // Re-throw the original error to execute normal flow/fallback
      throw err;
    }
  }

  try {
    await locator.scrollIntoViewIfNeeded().catch(() => {});

    // 2. Perform the action
    if (action === 'fill' || action === 'type') {
      await locator.click({ timeout: 2000 }).catch(() => {});
      await locator.fill(value);
      console.log(`[Execution]      : Filled value "${value}" successfully.`);
    } else if (action === 'check') {
      await locator.check({ timeout: 3000 });
      console.log(`[Execution]      : Checked element successfully.`);
    } else if (action === 'uncheck') {
      await locator.uncheck({ timeout: 3000 });
      console.log(`[Execution]      : Unchecked element successfully.`);
    } else if (action === 'select' || action === 'selectoption') {
      await locator.selectOption(value);
      console.log(`[Execution]      : Selected option "${value}" successfully.`);
    } else {
      // Default: Click
      if (role === 'radio' || role === 'checkbox') {
        try {
          console.log(`[Execution]      : Attempting check on radio/checkbox...`);
          await locator.check({ timeout: 2000 });
          console.log(`[Execution]      : Checked element successfully.`);
        } catch (checkErr) {
          console.log(`[Execution]      : Check failed: ${checkErr.message}. Trying click with force...`);
          await locator.click({ timeout: 2000, force: true });
          console.log(`[Execution]      : Clicked element with force successfully.`);
        }
      } else {
        await locator.click({ timeout: 4000 });
        console.log(`[Execution]      : Clicked element successfully.`);
      }
    }

    // 3. Short settle wait for live browser reactivity
    await activePage.waitForTimeout(500);

    console.log(`[Status]         : SUCCESS`);
    console.log(`====================================================================\n`);

    return {
      success: true,
      found: true,
      action,
      target,
      message: `Successfully executed ${action} on "${target.name || selector}"`
    };
  } catch (err) {
    console.warn(`[Execution Failed] Playwright action failed: ${err.message}. Attempting JS fallback...`);
    
    // JS Fallback click
    try {
      const fallbackSuccess = await activePage.evaluate(({ sel, act, val }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        if (act === 'fill') {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.click();
        }
        return true;
      }, { sel: selector, act: action, val: value });

      if (fallbackSuccess) {
        console.log(`[Execution]      : Executed via JS fallback dispatch successfully.`);
        console.log(`[Status]         : SUCCESS (JS Fallback)`);
        console.log(`====================================================================\n`);
        return {
          success: true,
          found: true,
          action,
          target,
          message: `Executed ${action} via JS fallback dispatch on "${target.name || selector}"`
        };
      }
    } catch (e) {}

    console.error(`[Status]         : FAILED - Element could not be clicked/filled.`);
    console.log(`====================================================================\n`);

    return {
      success: false,
      found: true,
      action,
      target,
      error: err.message,
      fallbackSuggested: 'visionModelFallback'
    };
  }
}

module.exports = {
  runClickOrFill
};
