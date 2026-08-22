if (typeof AgoraRTC === "undefined") {
    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://download.agora.io/sdk/release/AgoraRTC_N-4.22.0.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Agora RTC SDK"));
        document.head.appendChild(script);
    });
}

window.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });