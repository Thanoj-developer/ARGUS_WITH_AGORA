// playwright.config.js
module.exports = {
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'https://example.com',
  },
};
