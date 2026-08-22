const newLlm = require('./newllm');

module.exports = {
  translateInstruction: newLlm.translateInstruction,
  getSystemPrompt: newLlm.getSystemPrompt
};

