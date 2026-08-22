const fs = require('fs');
const path = require('path');
const { listTabs } = require('./Components/Function');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: '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',
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

/**
 * Handles the Auto Navigation logic.
 * Checks if a headed browser tab is active/selected.
 * If not, returns a 'Page is not selected' error.
 */
async function handleAutoNavigation(req, res) {
  console.log('[Navigation Handler] Received auto navigation request');
  try {
    const result = await listTabs();
    
    if (!result.success || !result.tabs || result.tabs.length === 0) {
      console.warn('[Navigation Handler] No tabs found or browser not connected');
      return res.json({ success: false, error: 'Page is not selected' });
    }

    // Find the tab marked active in the browser context
    const activeTab = result.tabs.find(t => t.isActive);
    if (!activeTab) {
      console.warn('[Navigation Handler] No active tab is selected');
      return res.json({ success: false, error: 'Page is not selected' });
    }

    // Success! Tab is active
    console.log(`[Navigation Handler] Auto-navigating on active tab index ${activeTab.index}: "${activeTab.title}"`);
    return res.json({ 
      success: true, 
      tabIndex: activeTab.index,
      tabTitle: activeTab.title,
      message: `Auto-navigating on active tab: "${activeTab.title}"` 
    });
  } catch (err) {
    console.error('[Navigation Handler] Error during tab check:', err.message);
    return res.json({ success: false, error: 'Page is not selected' });
  }
}

async function main() {
  const completionParams = {
    model: "meta/llama-3.1-8b-instruct",
    messages: [{"role":"user","content":"Hello, response test!"}],
    temperature: 0.2,
    top_p: 0.7,
    max_tokens: 1024,
  };

  try {
    const completion = await openai.chat.completions.create(completionParams);
    process.stdout.write(completion.choices[0]?.message?.content || '');
  } catch (err) {
    console.error('Test completion failed:', err);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  handleAutoNavigation
};
