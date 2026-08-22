const { test, expect } = require('@playwright/test');

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title to contain "Example Domain".
  await expect(page).toHaveTitle(/Example Domain/);
});
