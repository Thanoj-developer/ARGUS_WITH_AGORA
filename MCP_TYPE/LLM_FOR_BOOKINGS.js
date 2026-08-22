const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

// Nvidia NIM API configuration
const API_KEY = process.env.NVIDIA_API_KEY || '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';
const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// System Prompt for ecommerce booking
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'systemprompt_bookings.txt');

function getSystemPrompt() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_PATH)) {
      return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
    }
  } catch (err) {
    console.error('[Booking LLM] Failed to load system prompt:', err);
  }
  // Default fallback system prompt
  return `You are the Auto E-Commerce Booking agent. Based on the user instruction and page accessibility tree, output the next browser action as a JSON object:
{
  "index": <number>,
  "action": "click" | "fill" | "select",
  "value": "<text_if_fill_or_select>"
}`;
}

/**
 * Streams the bookings LLM completion.
 */
async function streamNavigationAction(query, accessibilityTree, historyStr = '', onChunk) {
  let systemPrompt = getSystemPrompt();
  if (historyStr) {
    systemPrompt += `\n\n## EXECUTION HISTORY FOR CURRENT GOAL\nHere is the sequence of steps already completed. Use this to maintain context and avoid loops:\n${historyStr}`;
  }
  const userContent = `User Goal: "${query}"\n\nPage Accessibility Tree:\n${JSON.stringify(accessibilityTree, null, 2)}`;
  
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  const models = [
    'meta/llama-3.1-8b-instruct',
    'meta/llama-3.1-70b-instruct',
    'mistralai/mixtral-8x7b-instruct-v0.1'
  ];

  let lastError = null;
  for (const model of models) {
    try {
      console.log(`[Booking LLM] Querying model stream ${model}...`);
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: 2048,
        stream: true
      });

      for await (const chunk of completion) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          onChunk(text);
        }
      }
      return; // Success
    } catch (err) {
      console.warn(`[Booking LLM] Model stream ${model} failed:`, err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('All streaming candidate models failed');
}

/**
 * Non-streaming helper to get the booking action directly.
 */
async function getNavigationAction(query, accessibilityTree, historyStr = '', personalMemory = null) {
  let systemPrompt = getSystemPrompt();
  if (historyStr) {
    systemPrompt += `\n\n## EXECUTION HISTORY FOR CURRENT GOAL\nHere is the sequence of steps already completed. Use this to maintain context and avoid loops:\n${historyStr}`;
  }
  if (personalMemory && Object.keys(personalMemory).length > 0) {
    systemPrompt += `\n\n## USER PERSONAL MEMORY (PII)
You are explicitly authorized and expected to use the values in this structured memory to complete any form fields on the page. Use these specific mappings:
- First Name, Last Name, Middle Name, Full Name -> first_name, last_name, middle_initial, full_name
- Username, User ID -> contact.email
- Email Address -> contact.email
- Password -> security.password
- Phone Number, Mobile or Email inputs (e.g. "Enter mobile number or email") -> contact.cell_phone or contact.home_phone

- Company, Position -> company, position
- Address lines, City, State, Country, Zip/Postal -> address.line1, address.line2, address.city, address.state_province, address.country, address.zip
- Credit Card Type -> payment.credit_card_type (e.g. "Visa")
- Credit Card Number -> payment.credit_card_number
- Cardholder / Card User Name -> payment.card_user_name
- CVV / CVC / Security Code -> payment.card_verification_code
- Card Expiration Month / Year -> payment.card_expiration_date.month / payment.card_expiration_date.year
- Bank Name / Issuing Bank -> payment.card_issuing_bank
- Bank Phone / Card Cust Svc Phone -> payment.card_customer_service_phone
- Sex / Gender -> personal_details.sex
- SSN / Social Security Number -> personal_details.social_security_number
- Driver's License Number -> personal_details.driver_license_number
- Date of Birth (Month, Day, Year) -> personal_details.date_of_birth.month, personal_details.date_of_birth.day, personal_details.date_of_birth.year
- Age -> personal_details.age
- Birth Place / Place of Birth -> personal_details.birth_place
- Income / Salary -> personal_details.income

Memory Data:
${JSON.stringify(personalMemory, null, 2)}`;
  }
  const userContent = `User Goal: "${query}"\n\nPage Accessibility Tree:\n${JSON.stringify(accessibilityTree, null, 2)}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  const models = [
    'meta/llama-3.1-8b-instruct',
    'meta/llama-3.1-70b-instruct',
    'mistralai/mixtral-8x7b-instruct-v0.1'
  ];

  let lastError = null;
  for (const model of models) {
    try {
      console.log(`[Booking LLM] Querying model ${model}...`);
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: 2048,
        stream: false
      });

      return completion.choices[0]?.message?.content || '';
    } catch (err) {
      console.warn(`[Booking LLM] Model ${model} failed:`, err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('All candidate models failed');
}

module.exports = {
  streamNavigationAction,
  getNavigationAction,
  getSystemPrompt
};
