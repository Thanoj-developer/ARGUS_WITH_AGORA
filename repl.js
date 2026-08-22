const { chromium } = require('@playwright/test');
const repl = require('repl');

console.log('Launching headed browser...');
(async () => {
  // Launch Chromium in headed mode so you can see it live
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('\n======================================================');
  console.log('          PLAYWRIGHT INTERACTIVE REPL                 ');
  console.log('======================================================');
  console.log('A headed browser window has opened on your desktop.');
  console.log('Type Playwright commands here to execute them live.');
  console.log('Available globals: browser, context, page');
  console.log('\nTry typing these commands one by one:\n');
  console.log('  await page.goto("https://google.com")');
  console.log('  await page.fill("[name=\\"q\\"]", "Playwright test")');
  console.log('  await page.press("[name=\\"q\\"]", "Enter")');
  console.log('======================================================\n');

  // Start Node REPL
  const r = repl.start({
    prompt: 'playwright> ',
    useGlobal: true
  });

  // Expose Playwright objects to the REPL context
  r.context.browser = browser;
  r.context.context = context;
  r.context.page = page;

  r.on('exit', async () => {
    console.log('Closing browser...');
    await browser.close();
    process.exit();
  });
})().catch(console.error);
