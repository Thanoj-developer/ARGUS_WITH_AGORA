# Build a Voice-Controlled Web Automation Assistant with Agora RTC

This recipe guides you through building a hands-free, real-time voice-controlled browser assistant using **Agora RTC** for low-latency audio streaming and an AI agent to execute actions on a web browser.

---

## 🥗 Ingredients (Prerequisites)

* **Agora Developer Account**: To get an `App ID` and `Primary Certificate`.
* **Node.js Environment**: Node v18+ installed locally.
* **Virtual Browser Environment**: Playwright for executing page actions.
* **AI API Key**: Access to a chat completion model.

---

## 🛠️ Step-by-Step Instructions

### Step 1: Initialize the Agora RTC Voice Channel
Set up the Agora Node.js SDK (or custom gateway wrapper) to join the audio channel. This establishes a low-latency gateway to receive the user's spoken commands:

```javascript
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

// Generate an authentication token for the session
const token = RtcTokenBuilder.buildTokenWithUid(
  process.env.AGORA_APP_ID,
  process.env.AGORA_PRIMARY_CERTIFICATE,
  channelName,
  uid,
  RtcRole.PUBLISHER,
  privilegeExpiredTs
);
```

### Step 2: Stream User Audio & Transcribe
Capture the real-time audio stream from the joined Agora channel, convert it into text, and route the command to the AI understanding engine.

### Step 3: Analyze Page Accessibility Elements
Before executing any action, the assistant reads the structure of the active web page. It filters out structural noise and maps only interactive elements (such as textboxes, buttons, and links) to WAI-ARIA accessibility roles:

```javascript
// Filter interactive nodes for the AI brain to analyze
const interactiveElements = domSnapshot.filter(node => {
  return ['button', 'link', 'textbox', 'searchbox', 'checkbox'].includes(node.role);
});
```

### Step 4: Generate & Execute Browser Actions
Based on the voice command and the parsed page elements, the AI brain generates the browser automation script (clicks, input entry, page navigation) and executes it within a virtual browser session.

### Step 5: Stream Verbal Feedback Back via Agora RTC
Once the browser action finishes, convert the text result (e.g. *"I have added the trimmer to your cart."*) into an audio stream. Publish the audio track back to the user via the joined **Agora RTC Channel**:

```javascript
// Publish the synthesized audio stream back to the Agora channel
const audioStream = getAudioStream(synthesizedText);
agoraClient.publish(audioStream);
```

---

## 💡 Best Practices

1. **Ultra-Low Latency Audio**: Always prioritize Agora RTC channels over standard HTTP long-polling for real-time speech interaction.
2. **Safety Gates**: Integrate a human-in-the-loop intercept mechanism before permitting the AI to submit payment pages or execute final transaction forms.
3. **Session Management**: Keep the virtual browser session state persistent across voice commands so the user can build on previous steps in a single conversation.
