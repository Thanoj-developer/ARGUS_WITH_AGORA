const fs = require('fs');
const path = require('path');

const historyFilePath = path.join(__dirname, 'history.json');

// Read history from JSON file safely
function readHistory() {
  try {
    if (fs.existsSync(historyFilePath)) {
      return JSON.parse(fs.readFileSync(historyFilePath, 'utf8'));
    }
  } catch (err) {
    console.error('[Context] Failed to read history.json:', err.message);
  }
  return [];
}

// Write history to JSON file safely
function writeHistory(history) {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('[Context] Failed to write history.json:', err.message);
  }
}

// Retrieve current interaction history
function getHistory() {
  return readHistory();
}

// Add an interaction to history
function addInteraction(userTask, generatedCode) {
  const history = readHistory();
  history.push({
    timestamp: new Date().toISOString(),
    userTask,
    generatedCode
  });
  writeHistory(history);
}

// Clear the interaction history
function clearHistory() {
  writeHistory([]);
  console.log('[Context] Conversation history cleared.');
}

// Formats history + system prompt + current userTask into standard OpenAI message format
function getFormattedMessages(systemPrompt, currentUserTask) {
  const history = readHistory();
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Map each history interaction into user and assistant turns
  for (const turn of history) {
    messages.push({
      role: 'user',
      content: turn.userTask
    });
    messages.push({
      role: 'assistant',
      content: turn.generatedCode
    });
  }

  // Append current task
  messages.push({
    role: 'user',
    content: currentUserTask
  });

  return messages;
}

module.exports = {
  getHistory,
  addInteraction,
  clearHistory,
  getFormattedMessages
};
