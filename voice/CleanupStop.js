if (window.localAudioTrack) {
    window.localAudioTrack.stop();    // Stops playing audio locally
    window.localAudioTrack.close();   // Releases the microphone stream hardware
}
if (window.client) {
    await window.client.leave();      // Leaves the Agora channel
}