const APP_ID = "a1cf13a1338444508e9b76b94be084b4";
const CHANNEL = "demo-channel";
const TOKEN = "007eJxTYFjhYl1sulBv931FlS4Dl7b3s5df4lPmd150Y6n6D5kyNk8FhkTD5DRD40RDY2MLExMTUwOLVMskc7MkS5OkVAMLkySTj/dbsxoCGRlMv7owMDEwgiGIz8yQklrEABUCCbAwGBoYGAIAc2Ye9A==";

if (typeof AgoraRTC === "undefined") {
    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Agora RTC SDK"));
        document.head.appendChild(script);
    });
}

if (!window.client) {
    window.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
}

console.log("Fetching dynamic token from server...");
const tokenRes = await fetch("http://localhost:2003/api/generate-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelName: CHANNEL, uid: 1001 })
});
const tokenData = await tokenRes.json();
if (!tokenData.success || !tokenData.token) {
    throw new Error("Failed to get dynamic token: " + (tokenData.error || "unknown"));
}

await window.client.join(APP_ID, CHANNEL, tokenData.token, 1001);