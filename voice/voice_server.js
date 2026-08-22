const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { getLlmResponse } = require('./LLM_FOR_VOICE');
const { runOrchestrator } = require('./orcastrator');
const { runAutoNavigationLoop } = require('./AutoNavigation');
const { routeVoiceQuery, classifyQuery, INBOX } = require('./RouterLogic');
const { synthesizeSpeech } = require('./Text-To-Speech');

// Load environment variables from .env files
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'Controlled_By_LLM', '.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const index = trimmed.indexOf('=');
            if (index !== -1) {
              const key = trimmed.substring(0, index).trim();
              const val = trimmed.substring(index + 1).trim();
              process.env[key] = val;
            }
          }
        }
      } catch (err) {
        console.error(`Failed to load env file from ${envPath}:`, err);
      }
    }
  }
}
loadEnv();

const app = express();
const PORT = 2003;

// Enable CORS for all routes (necessary for frontend integration on port 2001/2002)
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static assets/dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Root route: Serve a beautiful dashboard for the Voice commanding server
app.get('/', (req, res) => {
  const { RtcTokenBuilder, RtcRole } = require('agora-token');
  const appId = process.env.AGORA_APP_ID ? process.env.AGORA_APP_ID.replace(/"/g, '') : '';
  const appCertificate = process.env.AGORA_APP_CERTIFICATE ? process.env.AGORA_APP_CERTIFICATE.replace(/"/g, '') : '';
  const channelName = process.env.AGORA_CHANNEL ? process.env.AGORA_CHANNEL.replace(/"/g, '') : 'demo-channel';
  
  let dynamicToken = process.env.AGORA_TOKEN ? process.env.AGORA_TOKEN.replace(/"/g, '') : '';
  
  if (appId && appCertificate) {
    try {
      const expirationTimeInSeconds = 3600 * 24; // 24 hours
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
      
      dynamicToken = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        1001,
        RtcRole.PUBLISHER,
        privilegeExpiredTs
      );
      console.log(`[Voice Server] Dynamically generated fresh token for client: ${dynamicToken.substring(0, 20)}...`);
    } catch (err) {
      console.error('[Voice Server] Failed to build token dynamically:', err.message);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Voice Command Mode</title>
        <!-- Import Agora RTC Web SDK -->
        <script src="https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js"></script>
        <style>
            body {
                background-color: #151515;
                margin: 0;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                overflow-y: auto;
                font-family: Inter, system-ui, sans-serif;
                color: white;
                padding: 40px 0;
                box-sizing: border-box;
                gap: 24px;
            }

            /* --- Voice UI styles --- */
            .voice-ui {
                width: 760px;
                height: 520px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }

            .voice-card {
                position: relative;
                width: 600px;
                height: 360px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: radial-gradient(circle, rgba(90, 140, 180, 0.12), transparent 35%),
                    linear-gradient(90deg, #171717, #211d1a, #171717);
                overflow: hidden;
                border-radius: 16px;
                border: 1px solid rgba(255, 255, 255, 0.05);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
            }

            .outer-ring,
            .inner-ring {
                position: absolute;
                border: 2px solid rgba(255, 255, 255, 0.08);
                border-radius: 140px;
                animation: ringPulse 2.6s ease-in-out infinite;
                animation-play-state: paused;
            }

            .outer-ring {
                width: 594px;
                height: 300px;
            }

            .inner-ring {
                width: 455px;
                height: 235px;
                animation-delay: 0.3s;
            }

            .mic-capsule {
                position: relative;
                width: 164px;
                height: 275px;
                border-radius: 90px;
                background: linear-gradient(
                    180deg,
                    rgba(120, 135, 145, 0.52),
                    rgba(85, 90, 88, 0.42),
                    rgba(80, 70, 55, 0.35)
                );
                border: 2px solid rgba(210, 220, 225, 0.22);
                box-shadow:
                    0 0 45px rgba(120, 165, 200, 0.38),
                    inset 0 0 30px rgba(255, 255, 255, 0.08);
                animation: micFloat 1.25s ease-in-out infinite;
                animation-play-state: paused;
                z-index: 4;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
            }
            .mic-capsule:hover {
                transform: scale(1.02) translateY(var(--hover-translate, -12px));
                box-shadow:
                    0 0 55px rgba(120, 165, 200, 0.48),
                    inset 0 0 40px rgba(255, 255, 255, 0.12);
            }

            .side-line {
                position: absolute;
                top: 68px;
                width: 3px;
                height: 136px;
                background: linear-gradient(
                    180deg,
                    rgba(235, 245, 255, 0.65),
                    rgba(235, 245, 255, 0.25)
                );
            }

            .side-line.left {
                left: -2px;
            }

            .side-line.right {
                right: -2px;
            }

            .inner-capsule {
                position: absolute;
                left: 50%;
                top: 50%;
                width: 68px;
                height: 144px;
                transform: translate(-50%, -50%);
                border-radius: 42px;
                background: linear-gradient(180deg, #78b9ee 0%, #8da2bd 52%, #bd7b41 100%);
                box-shadow:
                    0 0 55px rgba(112, 178, 238, 0.48),
                    0 0 90px rgba(186, 118, 65, 0.22);
                animation: innerPulse 1.25s ease-in-out infinite;
                animation-play-state: paused;
            }

            .light-dot {
                position: absolute;
                left: 50%;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                transform: translateX(-50%);
                background: rgba(255, 255, 255, 0.09);
            }

            .light-dot.top {
                top: 28px;
            }

            .light-dot.bottom {
                bottom: 28px;
            }

            .bars {
                position: absolute;
                top: 145px;
                display: flex;
                gap: 16px;
                align-items: center;
                z-index: 3;
            }

            .bars-left {
                left: 130px;
            }

            .bars-right {
                right: 130px;
            }

            .bars span {
                width: 10px;
                border-radius: 20px;
                background: linear-gradient(180deg, #6fa7d8, #a2683f);
                box-shadow: 0 0 18px rgba(107, 162, 215, 0.35);
                animation: barListen 1.05s ease-in-out infinite;
                animation-play-state: paused;
            }

            .bars span:nth-child(1) {
                height: 48px;
                animation-delay: 0s;
            }

            .bars span:nth-child(2) {
                height: 120px;
                animation-delay: 0.15s;
            }

            .bars span:nth-child(3) {
                height: 112px;
                animation-delay: 0.3s;
            }

            .bars-right span:nth-child(1) {
                height: 120px;
                animation-delay: 0.28s;
            }

            .bars-right span:nth-child(2) {
                height: 106px;
                animation-delay: 0.12s;
            }

            .bars-right span:nth-child(3) {
                height: 96px;
                animation-delay: 0.22s;
            }

            .bottom-arc {
                position: absolute;
                bottom: -20px;
                width: 115px;
                height: 105px;
                border: 1px solid rgba(180, 205, 220, 0.14);
                border-top: none;
                border-radius: 0 0 70px 70px;
            }

            .status {
                margin-top: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
                color: #8f8f8f;
                font-size: 14px;
            }

            .status-dot {
                width: 11px;
                height: 11px;
                border-radius: 50%;
                background: #555;
                box-shadow: none;
                animation: dotPulse 1.2s ease-in-out infinite;
                animation-play-state: paused;
            }

            .pause-btn {
                margin-top: 24px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                padding: 8px 16px;
                background: rgba(255, 255, 255, 0.08);
                color: #e5e5e5;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s ease;
                outline: none;
            }
            .pause-btn:hover {
                background: rgba(255, 255, 255, 0.15);
                color: white;
            }

            .strength {
                margin-top: 16px;
                width: 338px;
            }

            .strength-top {
                display: flex;
                justify-content: space-between;
                font-size: 14px;
                margin-bottom: 10px;
                color: #a0a0a0;
            }

            .slider {
                position: relative;
                height: 4px;
                background: rgba(255, 255, 255, 0.08);
                border-radius: 2px;
            }

            .slider-fill {
                width: 0%;
                height: 100%;
                background: linear-gradient(90deg, #78b9ee, #bd7b41);
                border-radius: 2px;
                transition: width 0.1s ease;
            }

            .slider-thumb {
                position: absolute;
                left: 0%;
                top: 50%;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background: white;
                transform: translate(-50%, -50%);
                box-shadow: 0 0 8px rgba(120, 165, 200, 0.8);
                transition: left 0.1s ease;
            }

            /* --- Chat and Control Layout styles --- */
            .chat-container, .controls-container {
                width: 100%;
                max-width: 600px;
                z-index: 2;
                box-sizing: border-box;
            }

            .chat-box {
                background: rgba(25, 25, 25, 0.6);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(120, 165, 200, 0.2);
                border-radius: 16px;
                padding: 20px;
                min-height: 120px;
                max-height: 200px;
                overflow-y: auto;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                display: flex;
                flex-direction: column;
                gap: 12px;
                transition: all 0.3s ease;
            }
            .chat-box.active {
                border-color: rgba(120, 165, 200, 0.5);
                box-shadow: 0 0 25px rgba(120, 165, 200, 0.15);
            }
            .message {
                font-size: 0.95rem;
                line-height: 1.4;
                opacity: 0;
                transform: translateY(10px);
                animation: fadeIn 0.4s forwards ease-out;
            }
            .user-msg {
                color: #78b9ee;
            }
            .llm-msg {
                color: #e5c4a5;
            }
            .system-message {
                color: #71717a;
                text-align: center;
                font-size: 0.9rem;
                font-style: italic;
                margin-top: 30px;
            }
            @keyframes fadeIn {
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .controls-container {
                display: flex;
                flex-direction: column;
                gap: 15px;
            }

            .control-card, .log-card {
                background: rgba(25, 25, 25, 0.5);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 12px;
                padding: 16px;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
            }
            .control-card h3, .log-card h3 {
                margin: 0 0 10px 0;
                font-size: 0.85rem;
                letter-spacing: 1px;
                color: #94A3B8;
                font-weight: 600;
            }
            .control-card h3 {
                color: #bd7b41;
            }
            .control-card:nth-child(3) h3 {
                color: #78b9ee;
            }
            .log-card h3 {
                color: #94A3B8;
            }
            .input-row {
                display: flex;
                gap: 8px;
            }
            .input-row input {
                flex: 1;
                background: rgba(15, 15, 15, 0.8);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 6px;
                padding: 8px 12px;
                color: #fff;
                font-family: monospace;
                font-size: 0.8rem;
                outline: none;
                transition: border-color 0.2s;
            }
            .input-row input:focus {
                border-color: rgba(120, 165, 200, 0.4);
            }
            .input-row button {
                padding: 8px 16px;
                border: none;
                border-radius: 6px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                white-space: nowrap;
            }
            #orchSubmitBtn {
                background: linear-gradient(135deg, #bd7b41, #8c5b30);
                color: #fff;
            }
            #orchSubmitBtn:hover {
                box-shadow: 0 0 15px rgba(189, 123, 65, 0.4);
            }
            #autoNavWakeupBtn {
                background: linear-gradient(135deg, #78b9ee, #5a8cb4);
                color: #fff;
            }
            #autoNavWakeupBtn:hover {
                box-shadow: 0 0 15px rgba(120, 165, 200, 0.4);
            }

            /* ── Voice→Orchestration Toggle ─────────────────────── */
            .voice-orch-toggle-card {
                background: rgba(189, 123, 65, 0.06);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(189, 123, 65, 0.25);
                border-radius: 14px;
                padding: 14px 18px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                box-shadow: 0 0 20px rgba(189, 123, 65, 0.08);
                transition: all 0.3s ease;
            }
            .voice-orch-toggle-card.active {
                border-color: rgba(189, 123, 65, 0.6);
                box-shadow: 0 0 30px rgba(189, 123, 65, 0.25), inset 0 0 20px rgba(189, 123, 65, 0.05);
            }
            .toggle-label-group {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .toggle-title {
                font-size: 0.82rem;
                font-weight: 700;
                letter-spacing: 0.8px;
                color: #bd7b41;
            }
            .toggle-subtitle {
                font-size: 0.68rem;
                color: #71717a;
                line-height: 1.3;
            }
            .toggle-switch {
                position: relative;
                width: 56px;
                height: 28px;
                flex-shrink: 0;
            }
            .toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .toggle-slider {
                position: absolute;
                inset: 0;
                background: rgba(255,255,255,0.08);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 28px;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            .toggle-slider::before {
                content: '';
                position: absolute;
                width: 20px;
                height: 20px;
                left: 4px;
                top: 3px;
                background: #475569;
                border-radius: 50%;
                transition: all 0.3s ease;
            }
            .toggle-switch input:checked + .toggle-slider {
                background: rgba(189, 123, 65, 0.3);
                border-color: #bd7b41;
                box-shadow: 0 0 14px rgba(189, 123, 65, 0.5);
            }
            .toggle-switch input:checked + .toggle-slider::before {
                transform: translateX(28px);
                background: #bd7b41;
                box-shadow: 0 0 8px rgba(189, 123, 65, 0.8);
            }
            .toggle-status-badge {
                font-size: 0.62rem;
                font-weight: 700;
                letter-spacing: 1px;
                padding: 2px 7px;
                border-radius: 6px;
                margin-left: 8px;
                background: rgba(255,255,255,0.05);
                color: #475569;
                transition: all 0.3s;
                vertical-align: middle;
            }
            .toggle-status-badge.on {
                background: rgba(189, 123, 65, 0.2);
                color: #bd7b41;
            }
            @keyframes orchPulseRing {
                0%   { box-shadow: 0 0 0 0 rgba(189,123,65,0.6); }
                70%  { box-shadow: 0 0 0 8px rgba(189,123,65,0); }
                100% { box-shadow: 0 0 0 0 rgba(189,123,65,0); }
            }
            .orch-input-pulse {
                animation: orchPulseRing 0.6s ease-out;
            }
            #automationLogs {
                width: 100%;
                height: 120px;
                background: rgba(15, 15, 15, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 6px;
                padding: 8px;
                color: #78b9ee;
                font-family: monospace;
                font-size: 0.75rem;
                resize: none;
                box-sizing: border-box;
                outline: none;
            }
            .tab-btn {
                background: rgba(20, 20, 20, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 6px;
                padding: 8px 12px;
                color: #ccc;
                font-size: 0.75rem;
                text-align: left;
                cursor: pointer;
                transition: all 0.2s;
                width: 100%;
                box-sizing: border-box;
                margin-bottom: 4px;
            }
            .tab-btn.active {
                border-color: #78b9ee;
                background: rgba(120, 165, 200, 0.08);
                color: #fff;
                box-shadow: 0 0 10px rgba(120, 165, 200, 0.2);
            }
            .tab-btn:hover {
                background: rgba(255, 255, 255, 0.05);
            }
            .tab-title {
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                display: block;
            }
            .tab-url {
                font-size: 0.65rem;
                color: #666;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                display: block;
                margin-top: 2px;
            }

            @keyframes micFloat {
                0%, 100% {
                    transform: translateY(-12px);
                }

                50% {
                    transform: translateY(12px);
                }
            }

            @keyframes innerPulse {
                0%, 100% {
                    height: 144px;
                    opacity: 1;
                }

                50% {
                    height: 118px;
                    opacity: 0.86;
                }
            }

            @keyframes barListen {
                0%, 100% {
                    transform: scaleY(1);
                    opacity: 1;
                }

                50% {
                    transform: scaleY(0.48);
                    opacity: 0.6;
                }
            }

            @keyframes ringPulse {
                0%, 100% {
                    transform: scale(0.98);
                    opacity: 0.75;
                }

                50% {
                    transform: scale(1.04);
                    opacity: 0.35;
                }
            }

            @keyframes dotPulse {
                0%, 100% {
                    opacity: 1;
                }

                50% {
                    opacity: 0.45;
                }
            }
        </style>
    </head>
    <body>
        <div class="voice-ui">
          <div class="voice-card">
            <div class="outer-ring"></div>
            <div class="inner-ring"></div>

            <div class="bars bars-left">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div class="mic-capsule" id="micBtn" style="cursor: pointer;">
              <div class="side-line left"></div>
              <div class="side-line right"></div>
              <div class="inner-capsule">
                <span class="light-dot top"></span>
                <span class="light-dot bottom"></span>
              </div>
            </div>

            <div class="bars bars-right">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div class="bottom-arc"></div>
          </div>

          <div class="status">
            <span class="status-dot" id="statusDot"></span>
            <span id="statusText">Tap capsule to speak</span>
          </div>

          <button class="pause-btn">Pause motion</button>

          <div class="strength">
            <div class="strength-top">
              <span>Movement strength</span>
              <span>0%</span>
            </div>
            <div class="slider">
              <div class="slider-fill" style="width: 0%;"></div>
              <div class="slider-thumb" style="left: 0%;"></div>
            </div>
          </div>
        </div>

        <div class="chat-container">
            <div class="chat-box" id="chatBox">
                <div class="system-message">Tap the mic capsule and speak to start.</div>
            </div>
        </div>

        <!-- OTP Modal -->
        <div id="otpModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(8px); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:rgba(20,20,20,0.95); border:1px solid rgba(120, 165, 200, 0.4); border-radius:16px; padding:32px; width:340px; box-shadow:0 0 40px rgba(120, 165, 200, 0.25); font-family:'Segoe UI',sans-serif; color: white;">
                <div style="font-size:1.5rem; margin-bottom:8px;">🔑 OTP / 2FA Verification Required</div>
                <div id="otpModalDesc" style="color:#94A3B8; font-size:0.85rem; margin-bottom:18px;">Please enter the OTP sent to your device.</div>
                <input id="otpModalInput" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="Enter OTP code..." style="width:100%; box-sizing:border-box; padding:10px 14px; background:rgba(30,30,30,0.8); border:1px solid rgba(120,165,200,0.3); border-radius:8px; color:#fff; font-size:1rem; outline:none; margin-bottom:16px;">
                <div style="display:flex; gap:10px;">
                    <button id="otpModalCancel" style="flex:1; padding:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#94A3B8; cursor:pointer; font-size:0.85rem;">Cancel</button>
                    <button id="otpModalSubmit" style="flex:2; padding:10px; background:linear-gradient(135deg,#78b9ee,#bd7b41); border:none; border-radius:8px; color:#fff; font-size:0.85rem; font-weight:700; cursor:pointer; box-shadow:0 0 15px rgba(120, 165, 200, 0.3);">✓ Submit OTP</button>
                </div>
            </div>
        </div>

        <!-- Option Select Modal -->
        <div id="optionModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(8px); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:rgba(20,20,20,0.95); border:1px solid rgba(120, 165, 200, 0.4); border-radius:16px; padding:32px; width:360px; box-shadow:0 0 40px rgba(120, 165, 200, 0.25); font-family:'Segoe UI',sans-serif; color: white;">
                <div style="font-size:1.5rem; margin-bottom:8px;">📝 Select Option</div>
                <div id="optionModalDesc" style="color:#94A3B8; font-size:0.85rem; margin-bottom:18px;">The automation requires you to select one of the choices below:</div>
                <div id="optionModalList" style="display:flex; flex-direction:column; gap:8px; margin-bottom:18px;"></div>
                <button id="optionModalCancel" style="width:100%; padding:10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#94A3B8; cursor:pointer; font-size:0.85rem;">Cancel</button>
            </div>
        </div>

        <!-- Success Modal -->
        <div id="successModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(8px); z-index:9999; align-items:center; justify-content:center;">
            <div style="background:rgba(20,20,20,0.95); border:1px solid rgba(120, 165, 200, 0.4); border-radius:16px; padding:32px; width:340px; text-align:center; box-shadow:0 0 40px rgba(120, 165, 200, 0.25); color: white;">
                <div style="font-size:3rem; margin-bottom:12px;">✅</div>
                <div id="successModalMsg" style="color:#78b9ee; font-size:1rem; font-weight:600; margin-bottom:20px;">Task Completed!</div>
                <button id="successModalClose" style="padding:10px 28px; background:linear-gradient(135deg,#78b9ee,#bd7b41); border:none; border-radius:8px; color:#fff; font-size:0.9rem; cursor:pointer;">Close</button>
            </div>
        </div>

        <div class="controls-container">

            <!-- ── Voice Smart Router Toggle ── -->
            <div class="voice-orch-toggle-card" id="voiceOrchCard">
                <div class="toggle-label-group">
                    <span class="toggle-title">🧠 VOICE SMART ROUTER</span>
                    <span class="toggle-subtitle">ON → classifies speech &amp; routes to Orchestration or Auto-Nav automatically</span>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="toggle-status-badge" id="voiceOrchBadge">OFF</span>
                    <label class="toggle-switch">
                        <input type="checkbox" id="voiceOrchToggle">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div class="control-card">
                <h3>🔮 ORCHESTRATION MODE</h3>
                <div class="input-row">
                    <input type="text" id="orchQueryInput" placeholder="Enter high-level orchestration goal...">
                    <button id="orchSubmitBtn">🚀 Orchestrate</button>
                </div>
            </div>
            
            <div class="control-card">
                <h3>🧭 AUTO NAVIGATION MODE</h3>
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span id="autoNavStatusDot" style="width:8px; height:8px; border-radius:50%; background:#444; display:inline-block;"></span>
                    <span id="autoNavStatusText" style="font-size:0.7rem; color:#666;">Idle</span>
                </div>
                <div class="input-row">
                    <input type="text" id="autoNavQueryInput" placeholder="Enter auto-navigation query...">
                    <button id="autoNavWakeupBtn">🚀 Wakeup LLM</button>
                </div>
            </div>

            <div class="control-card">
                <h3>🌐 ACTIVE BROWSER TABS</h3>
                <div id="tabsListContainer" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto;">
                    <div style="color: #666; font-size: 0.75rem; text-align: center; padding: 10px;">Loading tabs...</div>
                </div>
                <button id="refreshTabsBtn" style="margin-top: 10px; width: 100%; padding: 6px; background: rgba(120, 165, 200, 0.1); border: 1px solid rgba(120, 165, 200, 0.3); color: #78b9ee; border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">🔄 Refresh Tabs</button>
            </div>

            <div class="log-card">
                <h3>📋 AUTOMATION TERMINAL LOGS</h3>
                <textarea id="automationLogs" readonly placeholder="Automation logs will appear here..."></textarea>
            </div>

        <script>
            const APP_ID = "${appId || 'a1cf13a1338444508e9b76b94be084b4'}";
            const CHANNEL = "${channelName || 'demo-channel'}";
            const TOKEN = "${dynamicToken}";

            // Set Agora SDK log level to show warnings/errors only (filters out verbose debug messages)
            AgoraRTC.setLogLevel(2);

            const micBtn = document.getElementById('micBtn');
            const chatBox = document.getElementById('chatBox');
            
            // New selectors
            const orchQueryInput = document.getElementById('orchQueryInput');
            const orchSubmitBtn = document.getElementById('orchSubmitBtn');
            const autoNavQueryInput = document.getElementById('autoNavQueryInput');
            const autoNavWakeupBtn = document.getElementById('autoNavWakeupBtn');
            const automationLogs = document.getElementById('automationLogs');
            const tabsListContainer = document.getElementById('tabsListContainer');
            const refreshTabsBtn = document.getElementById('refreshTabsBtn');

            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');
            const pauseBtn = document.querySelector('.pause-btn');

            let client = null;
            let localAudioTrack = null;
            let recognition = null;
            let isRecording = false;
            let transcribedText = "";
            let silenceTimeout = null;
            let isConnecting = false;
            let isSpeaking = false;
            let speakingTimeout = null;
            let volumeInterval = null;
            let motionPaused = false;

            function updateAnimations() {
                const isRunning = isRecording && !motionPaused;
                document.querySelectorAll('.voice-card .outer-ring, .voice-card .inner-ring, .voice-card .mic-capsule, .voice-card .inner-capsule, .voice-card .bars span').forEach(el => {
                    el.style.animationPlayState = isRunning ? 'running' : 'paused';
                });
            }

            if (pauseBtn) {
                pauseBtn.addEventListener('click', () => {
                    motionPaused = !motionPaused;
                    document.querySelector('.voice-card').classList.toggle('motion-paused', motionPaused);
                    pauseBtn.textContent = motionPaused ? 'Play motion' : 'Pause motion';
                    updateAnimations();
                });
            }

            // Stop animations initially
            updateAnimations();

            // Helpers to append neon styled messages
            function addUserMessage(text) {
                const placeholder = chatBox.querySelector('.system-message');
                if (placeholder) placeholder.remove();

                const userDiv = document.createElement('div');
                userDiv.className = 'message user-msg';
                userDiv.innerHTML = '<strong>User:</strong> ' + text;
                chatBox.appendChild(userDiv);
                chatBox.scrollTop = chatBox.scrollHeight;
                chatBox.classList.add('active');
            }

            function addAgoraMessage(text) {
                const agoraDiv = document.createElement('div');
                agoraDiv.className = 'message llm-msg';
                agoraDiv.innerHTML = '<strong>AGORA:</strong> ' + text;
                chatBox.appendChild(agoraDiv);
                chatBox.scrollTop = chatBox.scrollHeight;
                chatBox.classList.remove('active');

                // Trigger Text-to-Speech audio playback
                try {
                    if (window.currentAudio) {
                        try { window.currentAudio.pause(); } catch(e) {}
                    }
                    
                    isSpeaking = true;
                    // Abort Speech Recognition during playback to prevent feedback loop
                    if (recognition && isRecording) {
                        try { recognition.abort(); console.log('[STT] Aborted recognition for TTS playback'); } catch(e) {}
                    }

                    const audio = new Audio('/api/speech-audio?text=' + encodeURIComponent(text));
                    window.currentAudio = audio;
                    if (speakingTimeout) clearTimeout(speakingTimeout);

                    audio.addEventListener('ended', () => {
                        // Keep isSpeaking true for 1 additional second to clear room echoes
                        speakingTimeout = setTimeout(() => {
                            isSpeaking = false;
                            window.currentAudio = null;
                            
                            // Resume Speech Recognition once speaking has ended
                            if (recognition && isRecording) {
                                try {
                                    recognition.start();
                                    console.log('[STT] Resumed speech recognition');
                                } catch(startErr) {}
                            }
                        }, 1000);
                    });

                    audio.addEventListener('error', () => {
                        isSpeaking = false;
                        window.currentAudio = null;
                        if (recognition && isRecording) {
                            try { recognition.start(); } catch(startErr) {}
                        }
                    });

                    audio.play().catch(playErr => {
                        console.warn('[TTS Playback] Audio play blocked or failed:', playErr.message);
                        isSpeaking = false;
                        window.currentAudio = null;
                        if (recognition && isRecording) {
                            try { recognition.start(); } catch(startErr) {}
                        }
                    });
                } catch (audioErr) {
                    console.error('[TTS Playback] Audio initialization failed:', audioErr.message);
                    isSpeaking = false;
                    window.currentAudio = null;
                    if (recognition && isRecording) {
                        try { recognition.start(); } catch(startErr) {}
                    }
                }
            }

            function logAutomation(text, type = 'info') {
                const time = new Date().toLocaleTimeString();
                automationLogs.value += '[' + time + '] [' + type.toUpperCase() + '] ' + text + '\\n';
                automationLogs.scrollTop = automationLogs.scrollHeight;
            }

            // ── Voice Smart Router Toggle ─────────────────────────────────────
            const voiceOrchToggle = document.getElementById('voiceOrchToggle');
            const voiceOrchBadge  = document.getElementById('voiceOrchBadge');
            const voiceOrchCard   = document.getElementById('voiceOrchCard');

            let voiceOrchEnabled = false;

            voiceOrchToggle.addEventListener('change', () => {
                voiceOrchEnabled = voiceOrchToggle.checked;
                voiceOrchBadge.textContent = voiceOrchEnabled ? 'ON' : 'OFF';
                voiceOrchBadge.classList.toggle('on', voiceOrchEnabled);
                voiceOrchCard.classList.toggle('active', voiceOrchEnabled);
                logAutomation(
                    'Voice Smart Router: ' + (voiceOrchEnabled
                        ? 'ENABLED — mic speech will be classified & auto-routed to Orchestration or Auto-Nav.'
                        : 'DISABLED.'),
                    voiceOrchEnabled ? 'success' : 'info'
                );
            });

            // ── Client-side keyword classifier (mirrors RouterLogic.js) ──────────
            const ORCH_KEYWORDS = [
                'open', 'launch', 'go to', 'navigate to', 'visit', 'load',
                'start', 'show me', 'take me to', 'search for', 'find',
            ];
            const AUTO_NAV_KEYWORDS = [
                'click', 'book', 'buy', 'add to cart', 'select', 'fill',
                'type', 'scroll', 'submit', 'checkout', 'purchase', 'tap',
                'press', 'enter', 'choose', 'pick', 'order', 'apply',
            ];

            function kwMatch(lower, kw) {
                if (lower.startsWith(kw + ' ') || lower === kw) return true;
                if (lower.includes(' ' + kw + ' '))              return true;
                if (lower.endsWith(' ' + kw))                    return true;
                return false;
            }

            /**
             * Classify voice text as 'ORCHESTRATION' or 'AUTO_NAVIGATION'.
             * AUTO_NAV keywords take priority (they are more specific actions).
             */
            function classifyVoiceCommand(text) {
                const lower = text.toLowerCase().trim();
                for (const kw of AUTO_NAV_KEYWORDS) {
                    if (kwMatch(lower, kw)) return 'AUTO_NAVIGATION';
                }
                for (const kw of ORCH_KEYWORDS) {
                    if (kwMatch(lower, kw)) return 'ORCHESTRATION';
                }
                return 'ORCHESTRATION'; // safe default
            }

            /** Show a brief routing chip in the chat box so user sees where it went */
            function showRoutingChip(inbox) {
                const isOrch = inbox === 'ORCHESTRATION';
                const chip = document.createElement('div');
                chip.style.cssText = [
                    'display:inline-block; padding:3px 10px; border-radius:20px; font-size:0.7rem;',
                    'font-weight:700; letter-spacing:0.6px; margin-top:4px; opacity:0;',
                    'animation:fadeIn 0.3s forwards;',
                    isOrch
                        ? 'background:rgba(189,123,65,0.15); border:1px solid rgba(189,123,65,0.4); color:#bd7b41;'
                        : 'background:rgba(120,165,200,0.15); border:1px solid rgba(120,165,200,0.4); color:#78b9ee;',
                ].join('');
                chip.textContent = isOrch ? '🔮 → ORCHESTRATION MODE' : '🧭 → AUTO NAVIGATION MODE';
                chatBox.appendChild(chip);
                chatBox.scrollTop = chatBox.scrollHeight;
            }

            /** Pulse animation helper for any input */
            function pulseInput(inputEl) {
                inputEl.classList.remove('orch-input-pulse');
                void inputEl.offsetWidth;
                inputEl.classList.add('orch-input-pulse');
                inputEl.addEventListener('animationend', () => inputEl.classList.remove('orch-input-pulse'), { once: true });
            }

            /**
             * Master voice router — called when Smart Router toggle is ON.
             * Classifies the text and dispatches to the correct inbox.
             */
            async function autoRouteVoice(voiceText) {
                const inbox = classifyVoiceCommand(voiceText);
                logAutomation('[SmartRouter] "' + voiceText + '" → classified as: ' + inbox, 'info');
                showRoutingChip(inbox);

                if (inbox === 'ORCHESTRATION') {
                    await autoRouteToOrchestration(voiceText);
                } else {
                    await autoRouteToAutoNav(voiceText);
                }
            }

            /** Route voice text → ORCHESTRATION MODE input → submit */
            async function autoRouteToOrchestration(voiceText) {
                orchQueryInput.value = voiceText;
                pulseInput(orchQueryInput);
                logAutomation('[Voice→Orch] Executing: "' + voiceText + '"', 'info');

                orchSubmitBtn.disabled = true;
                orchSubmitBtn.innerText = '🚀 Orchestrating...';
                try {
                    const response = await fetch('/api/voice-orchestrate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: voiceText })
                    });
                    const result = await response.json();
                    if (result.success) {
                        logAutomation('[Voice→Orch] Orchestration finished!', 'success');
                        if (result.executedSteps && result.executedSteps.length > 0) {
                            result.executedSteps.forEach(s => {
                                logAutomation('  Step: ' + s.step.func + ' -> ' + (s.message || s.error), s.success ? 'success' : 'error');
                            });
                        }
                        if (result.response) {
                            addAgoraMessage(result.response);
                        }
                    } else {
                        logAutomation('[Voice→Orch] Failed: ' + (result.error || 'unknown'), 'error');
                        if (result.response) {
                            addAgoraMessage(result.response);
                        }
                    }
                } catch (err) {
                    logAutomation('[Voice→Orch] Connection Error: ' + err.message, 'error');
                } finally {
                    orchSubmitBtn.disabled = false;
                    orchSubmitBtn.innerText = '🚀 Orchestrate';
                    orchQueryInput.value = '';
                    loadActiveTabs();
                }
            }

            /** Route voice text → AUTO NAVIGATION MODE input → trigger SSE wakeup */
            function autoRouteToAutoNav(voiceText) {
                // If an agent is already running, abort first
                if (currentEventSource) {
                    currentEventSource.close();
                    currentEventSource = null;
                }

                autoNavQueryInput.value = voiceText;
                pulseInput(autoNavQueryInput);
                logAutomation('[Voice→AutoNav] Executing: "' + voiceText + '"', 'info');

                // Reuse exactly the same SSE wakeup flow as the manual button
                currentSessionId = Date.now().toString();
                autoNavWakeupBtn.disabled = true;
                autoNavWakeupBtn.innerText = 'Agent Active...';
                setAutoNavStatus(true);

                const url = '/api/voice-autonavigate/stream?query=' + encodeURIComponent(voiceText) + '&sessionId=' + currentSessionId;
                const es = new EventSource(url);
                currentEventSource = es;

                es.addEventListener('log', (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation(d.message, d.type || 'info');
                });
                es.addEventListener('step', (e) => {
                    const d = JSON.parse(e.data);
                    const detail = d.action ? JSON.stringify(d.action) : (d.error || d.reason || d.status);
                    logAutomation('Step ' + d.step + ': ' + d.status + ' -> ' + detail, d.success !== false ? 'success' : 'error');
                });
                es.addEventListener('otp_prompt', async (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation('[HITL] OTP required: "' + (d.name || '') + '"', 'info');
                    const val = await showOtpModal('OTP required for: "' + (d.name || '') + '"', d.sessionId);
                    await sendHitlResponse(d.sessionId, val || '');
                });
                es.addEventListener('human_prompt', async (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation('[HITL] Input required: "' + (d.name || '') + '"', 'info');
                    const val = await showOtpModal('Input required for: "' + (d.name || '') + '"', d.sessionId);
                    await sendHitlResponse(d.sessionId, val || '');
                });
                es.addEventListener('option_select_prompt', async (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation('[HITL] Option selection required.', 'info');
                    const idx = await showOptionModal(d.options || [], d.sessionId);
                    await sendHitlResponse(d.sessionId, idx);
                });
                es.addEventListener('done', (e) => {
                    const d = JSON.parse(e.data);
                    es.close(); currentEventSource = null;
                    autoNavWakeupBtn.disabled = false;
                    autoNavWakeupBtn.innerText = '🚀 Wakeup LLM';
                    setAutoNavStatus(false);
                    logAutomation('[Voice→AutoNav] Finished! Status: ' + d.status, 'success');
                    if (d.status === 'completed') {
                        const buyingKeywords = ['buy', 'book', 'purchase', 'checkout', 'order', 'add to cart'];
                        const isBuying = buyingKeywords.some(kw => voiceText.toLowerCase().includes(kw));
                        showSuccessModal(d.response || 'Task completed successfully!', isBuying);
                    }
                    if (d.response) {
                        addAgoraMessage(d.response);
                    }
                    loadActiveTabs();
                    autoNavQueryInput.value = '';
                });
                es.addEventListener('error', (e) => {
                    let msg = 'Stream error';
                    try { const d = JSON.parse(e.data); msg = d.error || msg; } catch(_) {}
                    logAutomation('[Voice→AutoNav] Error: ' + msg, 'error');
                    es.close(); currentEventSource = null;
                    autoNavWakeupBtn.disabled = false;
                    autoNavWakeupBtn.innerText = '🚀 Wakeup LLM';
                    setAutoNavStatus(false);
                });
                es.onerror = () => {
                    if (es.readyState === EventSource.CLOSED) {
                        autoNavWakeupBtn.disabled = false;
                        autoNavWakeupBtn.innerText = '🚀 Wakeup LLM';
                        setAutoNavStatus(false);
                    }
                };
            }

            // ── Bind automation actions ───────────────────────────────────────────
            orchSubmitBtn.addEventListener('click', async () => {
                const query = orchQueryInput.value.trim();
                if (!query) return;
                
                logAutomation('Starting Orchestration: "' + query + '"', 'info');
                orchSubmitBtn.disabled = true;
                orchSubmitBtn.innerText = '🚀 Orchestrating...';
                
                try {
                    const response = await fetch('/api/voice-orchestrate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query })
                    });
                    const result = await response.json();
                    if (result.success) {
                        logAutomation('Orchestration finished!', 'success');
                        if (result.executedSteps && result.executedSteps.length > 0) {
                            result.executedSteps.forEach(s => {
                                logAutomation('Step executed: ' + s.step.func + ' -> ' + (s.message || s.error), s.success ? 'success' : 'error');
                            });
                        }
                        if (result.response) {
                            addAgoraMessage(result.response);
                        }
                    } else {
                        logAutomation('Orchestration Failed: ' + result.error, 'error');
                        if (result.response) {
                            addAgoraMessage(result.response);
                        }
                    }
                } catch (err) {
                    logAutomation('Connection Error: ' + err.message, 'error');
                } finally {
                    orchSubmitBtn.disabled = false;
                    orchSubmitBtn.innerText = '🚀 Orchestrate';
                    loadActiveTabs();
                }
            });

            // --- HITL Modal Helpers ---
            const otpModal = document.getElementById('otpModal');
            const otpModalInput = document.getElementById('otpModalInput');
            const otpModalSubmit = document.getElementById('otpModalSubmit');
            const otpModalCancel = document.getElementById('otpModalCancel');
            const otpModalDesc = document.getElementById('otpModalDesc');
            const optionModal = document.getElementById('optionModal');
            const optionModalList = document.getElementById('optionModalList');
            const optionModalCancel = document.getElementById('optionModalCancel');
            const successModal = document.getElementById('successModal');
            const successModalMsg = document.getElementById('successModalMsg');
            const successModalClose = document.getElementById('successModalClose');
            const autoNavStatusDot = document.getElementById('autoNavStatusDot');
            const autoNavStatusText = document.getElementById('autoNavStatusText');

            let currentSessionId = null;
            let currentEventSource = null;

            function setAutoNavStatus(active) {
                autoNavStatusDot.style.background = active ? '#78b9ee' : '#444';
                autoNavStatusDot.style.boxShadow = active ? '0 0 6px #78b9ee' : 'none';
                autoNavStatusText.textContent = active ? 'Agent Active' : 'Idle';
                autoNavStatusText.style.color = active ? '#78b9ee' : '#666';
            }

            function showOtpModal(desc, sessionId) {
                otpModalDesc.textContent = desc || 'Please enter the OTP sent to your device.';
                otpModalInput.value = '';
                otpModal.style.display = 'flex';
                otpModalInput.focus();

                return new Promise((resolve) => {
                    function submit() {
                        const val = otpModalInput.value.trim();
                        if (!val) return;
                        otpModal.style.display = 'none';
                        cleanup();
                        resolve(val);
                    }
                    function cancel() {
                        otpModal.style.display = 'none';
                        cleanup();
                        resolve(null);
                    }
                    function onKey(e) { if (e.key === 'Enter') submit(); }
                    function cleanup() {
                        otpModalSubmit.removeEventListener('click', submit);
                        otpModalCancel.removeEventListener('click', cancel);
                        otpModalInput.removeEventListener('keydown', onKey);
                    }
                    otpModalSubmit.addEventListener('click', submit);
                    otpModalCancel.addEventListener('click', cancel);
                    otpModalInput.addEventListener('keydown', onKey);
                });
            }

            function showOptionModal(options, sessionId) {
                optionModalList.innerHTML = '';
                optionModal.style.display = 'flex';

                return new Promise((resolve) => {
                    options.forEach((opt, i) => {
                        const btn = document.createElement('button');
                        btn.textContent = opt.label || opt.name || opt;
                        btn.style.cssText = 'width:100%; padding:10px 14px; background:rgba(120,165,200,0.08); border:1px solid rgba(120,165,200,0.3); border-radius:8px; color:#78b9ee; cursor:pointer; font-size:0.85rem; text-align:left; transition:all 0.2s;';
                        btn.onmouseover = () => btn.style.background = 'rgba(120,165,200,0.2)';
                        btn.onmouseout = () => btn.style.background = 'rgba(120,165,200,0.08)';
                        btn.addEventListener('click', () => {
                            optionModal.style.display = 'none';
                            const idx = typeof opt === 'object' && opt.index !== undefined ? opt.index : (options[i] && options[i].index !== undefined ? options[i].index : i);
                            resolve(idx);
                        });
                        optionModalList.appendChild(btn);
                    });
                    optionModalCancel.onclick = () => {
                        optionModal.style.display = 'none';
                        resolve(null);
                    };
                });
            }

            function showSuccessModal(msg, isBuying = false) {
                try {
                    const innerDiv = successModal.firstElementChild;
                    if (innerDiv && innerDiv.firstElementChild) {
                        innerDiv.firstElementChild.textContent = isBuying ? '🛒' : '✅';
                    }
                } catch (e) {}

                if (isBuying) {
                    successModalMsg.innerHTML = 
                        '<div style="font-size: 1.4rem; color: #10B981; font-weight: 700; margin-bottom: 8px;">Product Buying Completed!</div>' +
                        '<div style="font-size: 0.95rem; color: #94A3B8;">' + (msg || 'Your purchase was completed successfully.') + '</div>';
                } else {
                    successModalMsg.innerHTML = 
                        '<div style="font-size: 1.4rem; color: #78b9ee; font-weight: 700; margin-bottom: 8px;">Task Completed!</div>' +
                        '<div style="font-size: 0.95rem; color: #94A3B8;">' + (msg || 'The task completed successfully.') + '</div>';
                }
                successModal.style.display = 'flex';
                successModalClose.onclick = () => { successModal.style.display = 'none'; };
            }

            // Send HITL response back to server
            async function sendHitlResponse(sessionId, value) {
                try {
                    await fetch('/api/voice-autonavigate/hitl-response', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessionId, value })
                    });
                } catch (e) {
                    logAutomation('HITL send error: ' + e.message, 'error');
                }
            }

            // --- AutoNav SSE Wakeup ---
            autoNavWakeupBtn.addEventListener('click', () => {
                const query = autoNavQueryInput.value.trim();
                if (!query) return;

                if (currentEventSource) {
                    currentEventSource.close();
                    currentEventSource = null;
                }

                currentSessionId = Date.now().toString();
                logAutomation('Starting Auto Navigation (HITL mode): "' + query + '"', 'info');
                autoNavWakeupBtn.disabled = true;
                autoNavWakeupBtn.innerText = 'Agent Active...';
                setAutoNavStatus(true);

                const url = '/api/voice-autonavigate/stream?query=' + encodeURIComponent(query) + '&sessionId=' + currentSessionId;
                const es = new EventSource(url);
                currentEventSource = es;

                es.addEventListener('log', (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation(d.message, d.type || 'info');
                });

                es.addEventListener('step', (e) => {
                    const d = JSON.parse(e.data);
                    const detail = d.action ? JSON.stringify(d.action) : (d.error || d.reason || d.status);
                    logAutomation('Step ' + d.step + ': ' + d.status + ' -> ' + detail, d.success !== false ? 'success' : 'error');
                });

                es.addEventListener('otp_prompt', async (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation('[HITL] OTP required for field: "' + (d.name || 'Enter OTP') + '"', 'info');
                    const val = await showOtpModal('The automation requires an OTP for: "' + (d.name || 'Enter OTP') + '"', d.sessionId);
                    if (val) {
                        logAutomation('[HITL] OTP submitted.', 'info');
                        await sendHitlResponse(d.sessionId, val);
                    } else {
                        logAutomation('[HITL] OTP cancelled by user.', 'error');
                        await sendHitlResponse(d.sessionId, '');
                    }
                });

                es.addEventListener('human_prompt', async (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation('[HITL] User input required for: "' + (d.name || '') + '"', 'info');
                    const val = await showOtpModal('Input required for: "' + (d.name || '') + '"', d.sessionId);
                    if (val) {
                        await sendHitlResponse(d.sessionId, val);
                    } else {
                        await sendHitlResponse(d.sessionId, '');
                    }
                });

                es.addEventListener('option_select_prompt', async (e) => {
                    const d = JSON.parse(e.data);
                    logAutomation('[HITL] Option selection required.', 'info');
                    const idx = await showOptionModal(d.options || [], d.sessionId);
                    await sendHitlResponse(d.sessionId, idx);
                });

                es.addEventListener('done', (e) => {
                    const d = JSON.parse(e.data);
                    es.close();
                    currentEventSource = null;
                    autoNavWakeupBtn.disabled = false;
                    autoNavWakeupBtn.innerText = '🚀 Wakeup LLM';
                    setAutoNavStatus(false);
                    logAutomation('Auto Navigation finished! Status: ' + d.status, 'success');
                    if (d.status === 'completed') {
                        const buyingKeywords = ['buy', 'book', 'purchase', 'checkout', 'order', 'add to cart'];
                        const isBuying = buyingKeywords.some(kw => query.toLowerCase().includes(kw));
                        showSuccessModal(d.response || 'Task completed successfully!', isBuying);
                    }
                    if (d.response) {
                        addAgoraMessage(d.response);
                    }
                    loadActiveTabs();
                });

                es.addEventListener('error', (e) => {
                    let msg = 'Stream error';
                    try { const d = JSON.parse(e.data); msg = d.error || msg; } catch(_) {}
                    logAutomation('Auto Navigation Error: ' + msg, 'error');
                    es.close();
                    currentEventSource = null;
                    autoNavWakeupBtn.disabled = false;
                    autoNavWakeupBtn.innerText = '🚀 Wakeup LLM';
                    setAutoNavStatus(false);
                });

                es.onerror = () => {
                    if (es.readyState === EventSource.CLOSED) {
                        autoNavWakeupBtn.disabled = false;
                        autoNavWakeupBtn.innerText = '🚀 Wakeup LLM';
                        setAutoNavStatus(false);
                    }
                };
            });

            async function loadActiveTabs() {
                try {
                    const response = await fetch('/api/list-tabs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const result = await response.json();
                    if (result.success && result.tabs && result.tabs.length > 0) {
                        tabsListContainer.innerHTML = '';
                        result.tabs.forEach(tab => {
                            const btn = document.createElement('button');
                            btn.className = 'tab-btn' + (tab.isActive ? ' active' : '');
                            
                            const titleSpan = document.createElement('span');
                            titleSpan.className = 'tab-title';
                            titleSpan.innerText = tab.title || '(No Title)';
                            
                            const urlSpan = document.createElement('span');
                            urlSpan.className = 'tab-url';
                            urlSpan.innerText = tab.url;
                            
                            btn.appendChild(titleSpan);
                            btn.appendChild(urlSpan);
                            
                            btn.addEventListener('click', async () => {
                                btn.disabled = true;
                                titleSpan.innerText = 'Switching...';
                                try {
                                    const switchRes = await fetch('/api/switch-tab', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ index: tab.index })
                                    });
                                    const switchResult = await switchRes.json();
                                    if (switchResult.success) {
                                        logAutomation('Switched to tab: ' + (tab.title || tab.url), 'success');
                                    }
                                } catch (e) {
                                    logAutomation('Failed to switch tab: ' + e.message, 'error');
                                } finally {
                                    loadActiveTabs();
                                }
                            });
                            
                            tabsListContainer.appendChild(btn);
                        });
                    } else {
                        tabsListContainer.innerHTML = '<div style="color: #666; font-size: 0.75rem; text-align: center; padding: 10px;">No active tabs.</div>';
                    }
                } catch (err) {
                    tabsListContainer.innerHTML = '<div style="color: #ef4444; font-size: 0.75rem; text-align: center; padding: 10px;">Failed to load tabs: ' + err.message + '</div>';
                }
            }

            refreshTabsBtn.addEventListener('click', loadActiveTabs);
            // Load tabs initially
            loadActiveTabs();

            // Initialize Speech Recognition
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = false;
                recognition.lang = 'en-US';

                recognition.onresult = (event) => {
                    if (isSpeaking) {
                        console.log('[STT] Speech recognition input ignored because AGORA is speaking.');
                        transcribedText = "";
                        clearTimeout(silenceTimeout);
                        return;
                    }

                    let resultText = "";
                    for (let i = 0; i < event.results.length; i++) {
                        resultText += event.results[i][0].transcript + " ";
                    }
                    transcribedText = resultText.trim();
                    console.log('[STT] Transcribed:', transcribedText);

                    // Reset 3-second silence timer
                    clearTimeout(silenceTimeout);
                    silenceTimeout = setTimeout(async () => {
                        if (transcribedText) {
                            console.log('[STT] 3 seconds of silence. Processing...');
                            addUserMessage(transcribedText);
                            
                            const textToSend = transcribedText;
                            transcribedText = ""; // Clear early to avoid duplicates

                            // ── If Voice Smart Router toggle is ON, classify & auto-route ──
                            if (voiceOrchEnabled) {
                                console.log('[STT] Smart Router ON — classifying and routing: "' + textToSend + '"');
                                await autoRouteVoice(textToSend);
                            } else {
                                // Default: send to conversational LLM assistant
                                try {
                                    const response = await fetch('/api/speech-to-text', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ text: textToSend })
                                    });
                                    const result = await response.json();
                                    if (result.success && result.response) {
                                        addAgoraMessage(result.response);
                                    }
                                } catch (err) {
                                    console.error('Failed to send text to server:', err);
                                }
                            }
                        }
                        // Stop recognition to clear the internal buffer/history
                        if (isRecording) {
                            recognition.stop();
                        }
                    }, 3000);
                };

                recognition.onend = () => {
                    // Auto-restart recognition if user is still actively recording (e.g. after a silence stop)
                    // But do not restart if the system is currently speaking (TTS is active)
                    if (isRecording && !isSpeaking) {
                        try {
                            recognition.start();
                            console.log('[STT] Recognition restarted for a new sentence.');
                        } catch (err) {
                            // Already started, ignore
                        }
                    }
                };

                recognition.onerror = (event) => {
                    if (event.error === 'aborted') return;
                    console.error('[STT] Error:', event.error);
                };
            } else {
                console.warn('[STT] Web Speech API is not supported in this browser.');
            }

            micBtn.addEventListener('click', async () => {
                if (isConnecting) return;

                if (isSpeaking) {
                    console.log('[STT] Mic button clicked during TTS playback. Interrupting voice.');
                    if (window.currentAudio) {
                        try { window.currentAudio.pause(); } catch(e) {}
                        window.currentAudio = null;
                    }
                    isSpeaking = false;
                    if (speakingTimeout) clearTimeout(speakingTimeout);
                    transcribedText = "";
                    clearTimeout(silenceTimeout);
                    logAutomation('AI Voice interrupted by click.', 'info');
                    return;
                }
                
                if (!isRecording) {
                    try {
                        isConnecting = true;
                        micBtn.style.pointerEvents = 'none';
                        
                        console.log('[Agora] Connecting...');
                        client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
                        await client.join(APP_ID, CHANNEL, TOKEN, 1001);
                        
                        console.log('[Agora] Capturing and publishing audio...');
                        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
                        await client.publish([localAudioTrack]);

                        if (recognition) {
                            transcribedText = "";
                            recognition.start();
                            console.log('[STT] Local SpeechRecognition started...');
                        }

                        isRecording = true;

                        // Visual styling
                        if (statusText) statusText.textContent = 'Recognizing voice';
                        if (statusDot) {
                            statusDot.style.background = '#72baff';
                            statusDot.style.boxShadow = '0 0 14px rgba(114, 186, 255, 0.7)';
                        }
                        updateAnimations();

                        // Start volume listener interval
                        if (volumeInterval) clearInterval(volumeInterval);
                        volumeInterval = setInterval(() => {
                            if (localAudioTrack) {
                                const level = localAudioTrack.getVolumeLevel();
                                const percentage = Math.round(level * 100);
                                const strengthLabel = document.querySelector('.strength-top span:last-child');
                                const sliderFill = document.querySelector('.slider-fill');
                                const sliderThumb = document.querySelector('.slider-thumb');
                                if (strengthLabel) strengthLabel.textContent = percentage + '%';
                                if (sliderFill) sliderFill.style.width = percentage + '%';
                                if (sliderThumb) sliderThumb.style.left = percentage + '%';
                            }
                        }, 100);
                    } catch (err) {
                        console.error('Failed to initialize voice session:', err);
                        alert('Error starting session: ' + err.message);
                    } finally {
                        isConnecting = false;
                        micBtn.style.pointerEvents = 'auto';
                    }
                } else {
                    try {
                        isConnecting = true;
                        micBtn.style.pointerEvents = 'none';
                        
                        console.log('[Agora] Stopping capture and leaving channel...');
                        
                        // Clear silence timer immediately
                        clearTimeout(silenceTimeout);

                        if (localAudioTrack) {
                            localAudioTrack.stop();
                            localAudioTrack.close();
                        }
                        if (client) {
                            await client.leave();
                        }

                        isRecording = false;

                        if (recognition) {
                            recognition.stop();
                        }

                        // Reset visual styling
                        if (statusText) statusText.textContent = 'Tap capsule to speak';
                        if (statusDot) {
                            statusDot.style.background = '#555';
                            statusDot.style.boxShadow = 'none';
                        }
                        updateAnimations();

                        // Clear volume listener interval
                        if (volumeInterval) {
                            clearInterval(volumeInterval);
                            volumeInterval = null;
                        }
                        // Reset volume meter
                        const strengthLabel = document.querySelector('.strength-top span:last-child');
                        const sliderFill = document.querySelector('.slider-fill');
                        const sliderThumb = document.querySelector('.slider-thumb');
                        if (strengthLabel) strengthLabel.textContent = '0%';
                        if (sliderFill) sliderFill.style.width = '0%';
                        if (sliderThumb) sliderThumb.style.left = '0%';

                        // Wait 500ms for final transcription event to resolve before sending
                        setTimeout(async () => {
                            if (transcribedText) {
                                addUserMessage(transcribedText);
                                const textToSend = transcribedText;
                                transcribedText = "";

                                // ── Same Smart Router check on mic-stop ──
                                if (voiceOrchEnabled) {
                                    console.log('[STT] Smart Router ON — classifying and routing on mic stop');
                                    await autoRouteVoice(textToSend);
                                } else {
                                    try {
                                        const response = await fetch('/api/speech-to-text', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ text: textToSend })
                                        });
                                        const result = await response.json();
                                        if (result.success && result.response) {
                                            addAgoraMessage(result.response);
                                        }
                                    } catch (err) {
                                        console.error('Failed to send text to server:', err);
                                    }
                                }
                            }
                        }, 500);
                    } catch (err) {
                        console.error('Error stopping session:', err);
                    } finally {
                        isConnecting = false;
                        micBtn.style.pointerEvents = 'auto';
                    }
                }
            });
        </script>
    </body>
    </html>
  `);
});

// Endpoint: Generate Agora RTC/RTM tokens
app.post('/api/generate-token', (req, res) => {
  const { RtcTokenBuilder, RtcRole } = require('agora-token');
  const { channelName = 'demo-channel', uid = 0, role = 'publisher' } = req.body;
  
  const appId = process.env.AGORA_APP_ID ? process.env.AGORA_APP_ID.replace(/"/g, '') : '';
  const appCertificate = process.env.AGORA_APP_CERTIFICATE ? process.env.AGORA_APP_CERTIFICATE.replace(/"/g, '') : '';
  
  if (!appId || !appCertificate) {
    return res.status(400).json({ success: false, error: 'App ID or App Certificate is missing on server' });
  }

  try {
    const expirationTimeInSeconds = 3600 * 24; // 24 hours
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
    
    const rtcRole = role === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      parseInt(uid, 10) || 0,
      rtcRole,
      privilegeExpiredTs
    );
    
    console.log(`[Voice Server] Dynamically generated token for channel: ${channelName}, uid: ${uid}`);
    res.json({
      success: true,
      token,
      channelName,
      uid
    });
  } catch (err) {
    console.error('[Voice Server] Token generation failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint: Synthesize speech from text (Text-to-Speech)
app.get('/api/speech-audio', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).send('Text parameter is required');
  }

  console.log(`[Voice Server] Synthesizing speech for: "${text}"`);
  try {
    const audioBuffer = await synthesizeSpeech(text);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'public, max-age=31536000'
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error('[Voice Server] TTS endpoint error:', err.message);
    res.status(500).send(err.message);
  }
});

// Endpoint: Speech-to-Text conversion (Logs user speech and bridges to Nvidia LLM)
// Also passes the transcript through RouterLogic to classify & dispatch automatically.
app.post('/api/speech-to-text', async (req, res) => {
  const { text, autoRoute } = req.body;

  console.log(`\n==================================================`);
  console.log(`[Voice Server] User: "${text || ''}"`);
  console.log(`==================================================\n`);

  if (!text) {
    return res.json({ success: true, text: "", response: "" });
  }

  // Get LLM conversational response
  const llmResponse = await getLlmResponse(text);

  console.log(`\n==================================================`);
  console.log(`[Voice Server] AGORA: "${llmResponse}"`);
  console.log(`==================================================\n`);

  // If autoRoute flag is set, also classify and dispatch to correct inbox
  let routeInfo = null;
  if (autoRoute) {
    try {
      const { inbox, confidence } = await classifyQuery(text);
      routeInfo = { inbox, confidence };
      console.log(`[Voice Server] Router preview: "${text}" -> ${inbox} (confidence: ${confidence})`);
    } catch (routeErr) {
      console.error('[Voice Server] Router classify error:', routeErr.message);
    }
  }

  res.json({ success: true, text, response: llmResponse, routeInfo });
});

// Endpoint: Voice Route — classify and dispatch a voice query to the correct inbox
// POST /api/voice-route
// Body: { query: string, useLLM?: boolean }
app.post('/api/voice-route', async (req, res) => {
  const { query, useLLM = true } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'query is required' });
  }

  console.log(`[Voice Server] /api/voice-route received: "${query}"`);

  try {
    const { inbox, result } = await routeVoiceQuery(query, { useLLM });
    res.json({ success: true, inbox, query, result });
  } catch (err) {
    console.error('[Voice Server] /api/voice-route error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint: Voice Route (SSE streaming) — classify and dispatch with live step logs
// GET /api/voice-route/stream?query=...&useLLM=true
app.get('/api/voice-route/stream', async (req, res) => {
  const query = req.query.query;
  const useLLM = req.query.useLLM !== 'false';
  const sessionId = req.query.sessionId || Date.now().toString();

  if (!query) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  console.log(`[Voice Server] SSE voice-route started. Session: ${sessionId}, Query: "${query}"`);
  sendEvent('log', { message: `Classifying command: "${query}"`, type: 'info' });

  // Classify first so we can immediately tell the UI which inbox
  let inbox;
  try {
    const { inbox: classified, confidence } = await classifyQuery(query, useLLM);
    inbox = classified;
    sendEvent('classified', { inbox, confidence, query });
    console.log(`[Voice Server] SSE route classified: ${inbox} (${confidence})`);
  } catch (err) {
    inbox = INBOX.ORCHESTRATION; // safe default
    sendEvent('classified', { inbox, confidence: 'default', query });
  }

  // Build HITL callbacks for auto-nav (mirrors /api/voice-autonavigate/stream)
  const hitlCallbacks = {
    onOtpPrompt: (action) => new Promise((resolve) => {
      sendEvent('otp_prompt', { index: action.index, name: action.name, sessionId });
      hitlPending.set(sessionId + '_hitl', resolve);
    }),
    onHumanPrompt: (action) => new Promise((resolve) => {
      sendEvent('human_prompt', { index: action.index, name: action.name, sessionId });
      hitlPending.set(sessionId + '_hitl', resolve);
    }),
    onOptionSelect: (action) => new Promise((resolve) => {
      sendEvent('option_select_prompt', { index: action.index, options: action.options, sessionId });
      hitlPending.set(sessionId + '_hitl', resolve);
    }),
  };

  try {
    const { result } = await routeVoiceQuery(query, {
      useLLM: false, // already classified above
      hitlCallbacks,
      onStepLog: (logEntry) => sendEvent('step', logEntry),
    });
    let llmResponse = "";
    try {
      if (result && (result.status === 'completed' || result.success)) {
        const confirmPrompt = `The user asked to perform: "${query}". This action was completed successfully. Write a 1-sentence natural confirmation response back to the user letting them know it's done. Keep it under 15 words.`;
        llmResponse = await getLlmResponse(confirmPrompt);
      } else {
        const failPrompt = `The user asked to perform: "${query}". This action failed. Write a 1-sentence natural response back to the user explaining that it failed. Keep it under 15 words.`;
        llmResponse = await getLlmResponse(failPrompt);
      }
    } catch (llmErr) {
      console.error('[Voice Server] LLM confirmation error:', llmErr.message);
    }
    sendEvent('done', { inbox, query, result, response: llmResponse });
  } catch (err) {
    console.error('[Voice Server] SSE voice-route error:', err.message);
    sendEvent('error', { error: err.message });
  } finally {
    hitlPending.delete(sessionId + '_hitl');
    res.end();
  }
});

// Endpoint: Voice Orchestrate (invokes runOrchestrator from voice/orcastrator.js)
app.post('/api/voice-orchestrate', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }
  
  console.log(`[Voice Server] Received Voice Orchestration query: "${query}"`);
  try {
    const result = await runOrchestrator(query);
    let llmResponse = "";
    try {
      if (result.success) {
        const confirmPrompt = `The user asked to: "${query}". This action was executed successfully. Write a 1-sentence natural confirmation response back to the user letting them know it's done. Keep it under 15 words.`;
        llmResponse = await getLlmResponse(confirmPrompt);
      } else {
        const failPrompt = `The user asked to: "${query}". This action failed due to error: "${result.error}". Write a 1-sentence natural response back to the user explaining that it failed. Keep it under 15 words.`;
        llmResponse = await getLlmResponse(failPrompt);
      }
    } catch (llmErr) {
      console.error('[Voice Server] LLM confirmation error:', llmErr.message);
    }
    res.json({ ...result, response: llmResponse });
  } catch (err) {
    console.error(`[Voice Server] Orchestration error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint: Proxy list-tabs to localhost:2002
app.post('/api/list-tabs', async (req, res) => {
  try {
    const response = await fetch('http://localhost:2002/api/list-tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    console.error('[Voice Server] Proxy list-tabs failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint: Proxy switch-tab to localhost:2002
app.post('/api/switch-tab', async (req, res) => {
  try {
    const response = await fetch('http://localhost:2002/api/switch-tab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    console.error('[Voice Server] Proxy switch-tab failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// HITL state: pending promise resolvers keyed by session ID
const hitlPending = new Map();

// Endpoint: Voice AutoNavigate via SSE streaming (supports HITL OTP/option popups)
app.get('/api/voice-autonavigate/stream', async (req, res) => {
  const query = req.query.query;
  const sessionId = req.query.sessionId || Date.now().toString();

  if (!query) {
    return res.status(400).end();
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  console.log(`[Voice Server] SSE AutoNav started. Session: ${sessionId}, Query: "${query}"`);
  sendEvent('log', { message: `Starting Auto Navigation for: "${query}"`, type: 'info' });

  // Build HITL callbacks that pause execution and wait for browser response
  const hitlCallbacks = {
    onOtpPrompt: (action) => new Promise((resolve) => {
      console.log(`[Voice Server HITL] OTP required for index ${action.index}`);
      sendEvent('otp_prompt', { index: action.index, name: action.name, sessionId });
      hitlPending.set(sessionId + '_hitl', resolve);
    }),
    onHumanPrompt: (action) => new Promise((resolve) => {
      console.log(`[Voice Server HITL] Human input required for: ${action.name}`);
      sendEvent('human_prompt', { index: action.index, name: action.name, sessionId });
      hitlPending.set(sessionId + '_hitl', resolve);
    }),
    onOptionSelect: (action) => new Promise((resolve) => {
      console.log(`[Voice Server HITL] Option selection required`);
      sendEvent('option_select_prompt', { index: action.index, options: action.options, sessionId });
      hitlPending.set(sessionId + '_hitl', resolve);
    }),
  };

  try {
    const result = await runAutoNavigationLoop(query, hitlCallbacks, (logEntry) => {
      sendEvent('step', logEntry);
    });
    let llmResponse = "";
    try {
      if (result.status === 'completed') {
        const confirmPrompt = `The user asked to navigate and perform: "${query}". This action was completed successfully. Write a 1-sentence natural confirmation response back to the user letting them know it's done. Keep it under 15 words.`;
        llmResponse = await getLlmResponse(confirmPrompt);
      } else {
        const failPrompt = `The user asked to navigate and perform: "${query}". This action stopped with status: "${result.status}". Write a 1-sentence natural response back to the user explaining that it stopped. Keep it under 15 words.`;
        llmResponse = await getLlmResponse(failPrompt);
      }
    } catch (llmErr) {
      console.error('[Voice Server] LLM confirmation error:', llmErr.message);
    }
    sendEvent('done', { ...result, response: llmResponse });
    console.log(`[Voice Server] SSE AutoNav completed. Session: ${sessionId}`);
  } catch (err) {
    console.error(`[Voice Server] SSE AutoNav error:`, err);
    sendEvent('error', { error: err.message });
  } finally {
    hitlPending.delete(sessionId + '_hitl');
    res.end();
  }
});

// Endpoint: Receive HITL response from browser (OTP code / option index)
app.post('/api/voice-autonavigate/hitl-response', (req, res) => {
  const { sessionId, value } = req.body;
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId required' });

  const resolve = hitlPending.get(sessionId + '_hitl');
  if (resolve) {
    hitlPending.delete(sessionId + '_hitl');
    resolve(value);
    console.log(`[Voice Server HITL] Received response for session ${sessionId}: ${value}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'No pending HITL for this session' });
  }
});

// Keep old endpoint for backward compatibility (no HITL)
app.post('/api/voice-autonavigate', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is required' });
  }
  console.log(`[Voice Server] Received Voice AutoNavigation query (non-streaming): "${query}"`);
  try {
    const result = await runAutoNavigationLoop(query);
    res.json(result);
  } catch (err) {
    console.error(`[Voice Server] AutoNavigation error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Voice Commanding Server running at http://localhost:${PORT}`);
});
