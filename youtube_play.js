const { chromium } = require('@playwright/test');

(async () => {
  console.log('Launching browser with autoplay policy bypassed...');
  // 1. Launch in headed mode (headless: false) and bypass autoplay policy
  const browser = await chromium.launch({
    headless: false,
    args: ['--autoplay-policy=no-user-gesture-required']
  });

  const context = await browser.newContext();
  
  // 2. Open a default page (first tab)
  console.log('Opening first tab...');
  const firstTab = await context.newPage();
  await firstTab.goto('about:blank');

  // 3. Open a second tab and navigate to the YouTube video URL
  console.log('Opening second tab...');
  const newTab = await context.newPage();
  const youtubeUrl = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Accepts video URL as a command line argument
  console.log(`Navigating second tab to: ${youtubeUrl}`);
  await newTab.goto(youtubeUrl);

  // 4. Consent/Cookies Popup detection
  console.log('Checking for YouTube cookies/consent popup...');
  try {
    // Look for common "Accept all" or "I agree" buttons
    const consentButton = newTab.locator([
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      '[aria-label="Accept all"]',
      '[aria-label="Accept the use of cookies and other data for the purposes described"]'
    ].join(', '));

    // Wait up to 5 seconds to see if a popup appears
    await consentButton.waitFor({ state: 'visible', timeout: 5000 });
    await consentButton.click();
    console.log('Consent popup accepted!');
  } catch (err) {
    console.log('No consent popup appeared (or timed out). Proceeding...');
  }

  // 5. Trigger playback with a user gesture
  console.log('Locating video player elements...');
  try {
    const largePlayButton = newTab.locator('.ytp-large-play-button');
    const mainVideoElement = newTab.locator('video.html5-main-video');

    // Wait for the video element to be attached
    await mainVideoElement.waitFor({ state: 'attached', timeout: 10000 });

    if (await largePlayButton.isVisible()) {
      console.log('Clicking the large play button...');
      await largePlayButton.click();
    } else {
      console.log('Large play button not visible. Clicking main video player element...');
      await mainVideoElement.click();
    }
    console.log('User gesture click performed.');
  } catch (err) {
    console.error('Could not locate or click play elements:', err.message);
  }

  // 6. Keep the browser open for 30 seconds to play the video
  const playDuration = 30000; // 30 seconds
  console.log(`Watching the video for ${playDuration / 1000} seconds...`);
  await newTab.waitForTimeout(playDuration);

  console.log('Closing browser.');
  await browser.close();
})();
