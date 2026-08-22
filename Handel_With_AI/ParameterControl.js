import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: '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',
  baseURL: 'https://integrate.api.nvidia.com/v1',
})


async function main() {
  const completion = await openai.chat.completions.create({
    model: "deepseek-ai/deepseek-v4-pro",
    messages: [{ "role": "user", "content": "" }],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 16384,
    chat_template_kwargs: { "thinking": false },
    stream: false
  })

  process.stdout.write(completion.choices[0]?.message?.content || '');


}

main();