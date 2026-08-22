const OpenAI = require('openai');

const fallbackApiKey = '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';

function getOpenAIClient() {
  const apiKey = process.env.NVIDIA_API_KEY || fallbackApiKey;
  return new OpenAI({
    apiKey: apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
}

async function getLlmResponse(userPrompt) {
  try {
    const openai = getOpenAIClient();
    
    console.log(`[Voice LLM Helper] Generating assistant response for prompt: "${userPrompt}"...`);
    const completion = await openai.chat.completions.create({
      model: "meta/llama-3.1-8b-instruct",
      messages: [
        {
          role: "system",
          content: "You are AGORA, a helpful voice assistant inside the ARGUS web automation suite. Keep your response extremely concise, helpful, and natural (1 sentence maximum). Do not use markdown format, asterisks, or code."
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      temperature: 0.2,
      top_p: 0.7,
      max_tokens: 120
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log(`[Voice LLM Helper] Response: "${responseText}"`);
    return responseText;
  } catch (error) {
    console.error('[Voice LLM Helper] Error querying Nvidia NIM API:', error.message);
    return "Sorry, I had trouble reaching my brain model. Please try again.";
  }
}

module.exports = { getLlmResponse };
