# API Keys & Environment Variables Reference Guide

This reference guide documents all the API keys, environment variables, and credentials used across different components of the repository. Use the clickable links below to navigate directly to each configuration file.

---

## 1. Environment Config Files (.env)

The application spans multiple modules, each maintaining its own `.env` file for localized configurations.

### 🔑 Root Environment Configuration
* **File Path**: [.env](../.env)
* **API Keys Defined**:
  * `GEMINI_API_KEY`: Used by the main Playwright automation server to translate natural language commands to raw Playwright executable JS code.

### 🔑 Controlled By LLM Configuration
* **File Path**: [Controlled_By_LLM/.env](../Controlled_By_LLM/.env)
* **API Keys Defined**:
  * `NVIDIA_API_KEY`: NIM Platform token used by the Orchestrator and the Auto-Navigation agent to trigger Llama-3.1 model completions.
  * `EMBEDDING_API`: JWT token used for semantic matching of pages and queries.
  * `Redis_cache_API`: Access key used by the Semantic caching layer to store and retrieve historical query/playwright translations.

### 🔑 Data Extracting System Configuration
* **File Path**: [DATA_Extracting_System/.env](../DATA_Extracting_System/.env)
* **API Keys Defined**:
  * `LLM_API_FOR_DATA_CLEANING`: Nvidia NIM key used specifically by the data extraction system to clean and structure raw scraped page details.
  * `GOOGLE_SHEET_API`: Google API key for reading/authenticating sheets connection.
  * `GOOGLE_SHEETS_WEBAPP_URL`: Google Apps Script web app endpoint deployed to write cleaned JSON arrays directly to spreadsheet tabs.

### 🔑 Google Cloud Connections Configuration
* **File Path**: [GOOGLE_CLOUD_CONNECTIONS/.env](../GOOGLE_CLOUD_CONNECTIONS/.env)
* **API Keys Defined**:
  * `GOOGLE_SHEET_API`: Dedicated API key for cloud sheets connector.
  * `GOOGLE_SHEETS_WEBAPP_URL`: Apps Script URL endpoint.

---

## 2. ⚠️ Critical Discovery: Hardcoded Fallbacks in JS Code

During analysis, we found that some JavaScript files have **hardcoded API key values** as fallbacks. If you change a key in `.env` but the environment variables are not loaded, the server will continue using these hardcoded keys:

### 🚫 Navigation Agent API Key Fallback
* **File Path**: [LLM_FOR_NAVIGATING.js:L6](../MCP_TYPE/LLM_FOR_NAVIGATING.js#L6)
* **Code**:
  ```javascript
  const API_KEY = process.env.NVIDIA_API_KEY || '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';
  ```

### 🚫 Navigation Handler Hardcoded Client Key
* **File Path**: [Navigation_Handeler.js:L6-L9](../MCP_TYPE/Navigation_Handeler.js#L6-L9)
* **Code**:
  ```javascript
  const openai = new OpenAI({
    apiKey: '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',
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
  ```

### 🚫 Orchestrator Chat API Key Fallback
* **File Path**: [LLM_oracastration.js:L6-L7](../MCP_TYPE/LLM_oracastration.js#L6-L7)
* **Code**:
  ```javascript
  const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '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';
  ```

---

## 💡 Best Practices to Update Keys

1. **Change inside the Environment Files**: Always update the keys inside the respective `.env` files listed above.
2. **Update Hardcoded Fallbacks**: If you change the Nvidia NIM API key, make sure to update the string fallback in [LLM_FOR_NAVIGATING.js](../MCP_TYPE/LLM_FOR_NAVIGATING.js#L6), [Navigation_Handeler.js](../MCP_TYPE/Navigation_Handeler.js#L6-L9), and [LLM_oracastration.js](../MCP_TYPE/LLM_oracastration.js#L6-L7).
3. **Restart Servers**: Any changes to `.env` files or JS files require restarting both `node server.js` and `node MCP_TYPE/MCP_Server.js` to clear the process environment cache.
