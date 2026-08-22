# 👁️ ARGUS: Voice-Controlled AI Web Assistant

ARGUS is an intelligent, voice-controlled web assistant designed to make web browsing and online tasks entirely hands-free. By simply speaking to the assistant, users can command it to navigate websites, search for items, extract information, and automate complex online tasks as if a human helper were operating the browser.

---

## 🚀 Key Features

* **🎙️ Natural Voice Control**: Speak commands directly to the assistant and receive spoken, verbal responses in real-time.
* **🤖 Automatic Browser Actions**: Converts spoken commands into precise actions on the screen (such as typing, searching, and clicking).
* **🧠 Smart Element Finder**: Automatically reads and analyzes the structure of active web pages, focusing only on interactive elements to ensure speed and accuracy.
* **⚡ Smart Workflow Memory**: Remembers previously executed workflows to speed up repeat tasks and reduce response delays.
* **📊 Spreadsheet Data Exporter**: Automatically cleans and structures gathered web data, saving it directly to cloud spreadsheets for you.
* **🔒 Human-in-the-Loop Safeguards**: Intercepts critical actions (like making payments or final bookings) to ask for user validation before proceeding.

---

## 📐 How It Works (High-Level Architecture)

The assistant operates in a continuous loop of listening, understanding, acting, and speaking:

```mermaid
flowchart TD
    User([🎙️ User Speaks Command]) --> VoiceIn[Voice Receiver]
    VoiceIn --> AI_Brain[AI Understanding & Planning Engine]
    
    AI_Brain -->|Reads Page State| PageParser[Web Page Analyzer]
    PageParser -->|Identifies Buttons & Fields| ActionEngine[Action Executor]
    ActionEngine -->|Performs Clicks & Input| WebBrowser[Virtual Browser Session]
    
    WebBrowser -->|Action Result| AI_Brain
    AI_Brain -->|Speaks Results| VoiceOut[Voice Synthesizer]
    VoiceOut --> UserFeedback([🔊 Agent Speaks Back to User])
```

### 1. Speak (Listening & Routing)
You speak a command (e.g., *"Search for a black leather wallet under $50"*). The voice interface captures your audio, translates it, and routes the request to the central AI brain.

### 2. Think (AI Planning)
The AI brain processes your request, determines what needs to be done, and breaks down the goal into a series of smaller steps.

### 3. Parse (Web Page Analysis)
The page analyzer scans the current web page, identifying all links, input fields, and buttons, discarding background noise to focus only on parts of the page that can be interacted with.

### 4. Act (Execution)
The action engine executes the clicks, scroll actions, or keyboard entries on the virtual browser screen.

### 5. Respond (Voice Feedback)
Once the task is complete, the voice synthesizer converts the text result into speech and speaks it back to you.

---

## 📂 Project Structure

For developers working on this project, here is how the modules are organized:

```bash
├── voice/                          # Voice receiving, routing, and speech synthesis
├── MCP_TYPE/                       # AI task planning, tool handlers, and navigation controllers
├── DOM_ACCESSBILITY/               # Web page analyzer and element parsing system
├── Redis_Query_caching/            # Workflow memory and semantic cache engine
├── DATA_Extracting_System/         # Data cleaning and spreadsheet exporter
├── WEBSCRAPING/                    # Scraper targets and data collection scripts
├── commanding.html                 # Main admin dashboard interface
└── server.js                       # Primary application orchestrator
```

---

## ⚙️ Configuration (.env)

Set up a `.env` file in the root folder with your specific API endpoints and credentials:

```ini
# Central AI APIs
AI_API_KEY=your_ai_api_key

# Voice Streaming Credentials
VOICE_SERVICE_ID=your_voice_service_id
VOICE_SERVICE_CERTIFICATE=your_voice_service_certificate

# Spreadsheet Integrations
SPREADSHEET_EXPORT_URL=your_spreadsheet_webhook_url
```

---

## 🛠️ Setup & Execution

### 1. Install Dependencies
Make sure you have Node.js installed, then run:
```bash
npm install
```

### 2. Configure Virtual Browsers
Initialize the virtual browser execution environment:
```bash
npx playwright install chromium
```

### 3. Launch the Application
Start the primary application orchestrator:
```bash
node server.js
```

### 4. Launch the Voice Gateway
In a separate terminal, launch the voice receiver gateway:
```bash
node voice/voice_server.js
```
