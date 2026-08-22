let activePageRef = null;

/**
 * Injects a tab focus detection script into the browser context.
 * Enables the Node server to automatically detect which tab is actively focused by the user.
 */
async function registerTabFocusHook(page) {
  if (!page || page.isClosed()) return;
  try {
    await page.exposeFunction('onTabFocused', () => {
      console.log(`[Tab Switcher] Active tab focused manually by user: ${page.url()}`);
      activePageRef = page;
    });
  } catch (err) {
    // exposeFunction might throw if function already exists in this context
  }

  // Set up console log forwarding to aid in debugging page interactions
  try {
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Tab Switcher]') || msg.type() === 'error') {
        console.log(`[Browser Console - ${page.url().substring(0, 50)}] ${msg.type().toUpperCase()}: ${text}`);
      }
    });
  } catch (err) {
    // Console listener assignment might fail on closed pages
  }

  const focusScript = () => {
    let lastNotify = 0;
    function notify() {
      const now = Date.now();
      if (now - lastNotify > 500) {
        lastNotify = now;
        if (typeof window.onTabFocused === 'function') {
          window.onTabFocused().catch(() => {});
        } else {
          // Retry in case the binding is still initializing
          setTimeout(() => {
            if (typeof window.onTabFocused === 'function') {
              window.onTabFocused().catch(() => {});
            }
          }, 100);
        }
      }
    }
    
    // Wire up all possible events that signal user tab interaction
    window.addEventListener('focus', notify);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        notify();
      }
    });
    window.addEventListener('mousedown', notify, { capture: true });
    window.addEventListener('keydown', notify, { capture: true });
  };

  try {
    await page.addInitScript(focusScript);
    await page.evaluate(focusScript).catch(() => {});
  } catch (err) {
    console.warn(`[Tab Switcher] Focus tracking script inject failed: ${err.message}`);
  }
}

/**
 * Opens a new tab in the browser context and loads the specified URL.
 * Exposes this page so commands can be executed directly on it.
 */
async function openNewTab(context, url) {
  console.log(`[newtabaccess] Opening new tab for: ${url}`);
  const newPage = await context.newPage();
  activePageRef = newPage;
  await registerTabFocusHook(newPage).catch(() => {});
  try {
    await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  } catch (err) {
    console.warn(`[newtabaccess] Note: Tab navigation completed: ${err.message}`);
  }
  await newPage.bringToFront().catch(() => {});
  return newPage;
}

/**
 * Executes a custom JavaScript snippet directly on the active new tab.
 */
async function runCommandInNewTab(code, browser, context) {
  if (!activePageRef) {
    throw new Error('No active new tab has been initialized in newtabaccess.');
  }
  console.log(`[newtabaccess] Executing command in new tab: ${code}`);
  const executeCode = new Function('page', 'browser', 'context', `
    return (async () => {
      ${code}
    })();
  `);
  return await executeCode(activePageRef, browser, context);
}

/**
 * Returns the active new tab page.
 */
function getActiveVideoPage() {
  return activePageRef;
}

/**
 * Resets the active new tab reference (e.g. when the browser is closed/re-initialized).
 */
function reset() {
  activePageRef = null;
}

/**
 * Determines if we should disable screenshot capturing.
 * Returning true tells the server to skip taking screenshots of the tab,
 * ensuring high-quality, lag-free YouTube video streaming on the headed Chrome window.
 */
function shouldDisableScreenshots() {
  return activePageRef !== null;
}

/**
 * Queries all open browser tabs from the context and tags the active tab.
 */
async function getTabList(context) {
  if (!context) return [];
  const pages = context.pages();
  const list = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.isClosed()) continue;
    const title = await p.title().catch(() => 'Untitled');
    const url = p.url();
    list.push({
      index: i,
      title: title,
      url: url,
      isActive: p === activePageRef || (activePageRef === null && i === pages.length - 1)
    });
  }
  return list;
}

/**
 * Focuses and sets the active tab pointer to the given index.
 */
async function switchToTab(context, index) {
  if (!context) throw new Error('No browser context available.');
  const pages = context.pages();
  const targetPage = pages[index];
  if (!targetPage || targetPage.isClosed()) {
    throw new Error(`Tab index ${index} is not available.`);
  }
  activePageRef = targetPage;
  await targetPage.bringToFront().catch(() => {});
  const title = await targetPage.title().catch(() => 'Untitled');
  return { success: true, title };
}

/**
 * Automates YouTube video playback: handles cookie consent popups, 
 * performs a user gesture to start playback, and sets the active new tab.
 */
async function playYouTubeVideoInNewTab(context, url) {
  // 1. Open the new tab using our existing helper
  const newTab = await openNewTab(context, url);

  // 2. Consent/Cookies Popup detection
  console.log('[newtabaccess] Checking for YouTube cookies/consent popup...');
  try {
    const consentButton = newTab.locator([
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      '[aria-label="Accept all"]',
      '[aria-label="Accept the use of cookies and other data for the purposes described"]'
    ].join(', '));

    // Wait up to 5 seconds for consent dialog
    await consentButton.waitFor({ state: 'visible', timeout: 5000 });
    await consentButton.click();
    console.log('[newtabaccess] Consent popup accepted!');
  } catch (err) {
    console.log('[newtabaccess] No consent popup appeared (or timed out).');
  }

  // 3. Trigger playback with a user gesture
  console.log('[newtabaccess] Locating video player elements...');
  try {
    const largePlayButton = newTab.locator('.ytp-large-play-button');
    const mainVideoElement = newTab.locator('video.html5-main-video');

    await mainVideoElement.waitFor({ state: 'attached', timeout: 10000 });

    if (await largePlayButton.isVisible()) {
      console.log('[newtabaccess] Clicking the large play button...');
      await largePlayButton.click();
    } else {
      console.log('[newtabaccess] Large play button not visible. Clicking main video player element...');
      await mainVideoElement.click();
    }
    console.log('[newtabaccess] User gesture click performed.');
  } catch (err) {
    console.error('[newtabaccess] Could not locate or click play elements:', err.message);
  }

  return newTab;
}

module.exports = {
  openNewTab,
  runCommandInNewTab,
  getActiveVideoPage,
  reset,
  shouldDisableScreenshots,
  playYouTubeVideoInNewTab,
  getTabList,
  switchToTab,
  registerTabFocusHook
};
