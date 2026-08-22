// NVIDIA NIM / Resemble.AI Chatterbox TTS Integration Helper
const fallbackApiKey = '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';

async function synthesizeSpeech(text) {
  const apiKey = process.env.RESEMBLE_API_KEY || process.env.NVIDIA_API_KEY || fallbackApiKey;
  
  // 1. Try Resemble.AI Official API if it looks like a Resemble Key (not starting with nvapi-)
  if (apiKey && !apiKey.startsWith('nvapi-')) {
    try {
      console.log(`[TTS Helper] Attempting Resemble.AI Cloud API...`);
      const voiceUuid = process.env.RESEMBLE_VOICE_UUID || 'b9a6747d-8153-488b-82ef-d34509748b6d'; // fallback voice UUID
      const response = await fetch('https://f.cluster.resemble.ai/synthesize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          voice_uuid: voiceUuid,
          data: text,
          output_format: 'mp3',
          sample_rate: 22050
        })
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        console.log(`[TTS Helper] Resemble.AI Cloud API success. Buffer size: ${arrayBuffer.byteLength} bytes.`);
        return Buffer.from(arrayBuffer);
      } else {
        console.warn(`[TTS Helper] Resemble.AI API returned status ${response.status}`);
      }
    } catch (err) {
      console.warn(`[TTS Helper] Resemble.AI Cloud API failed:`, err.message);
    }
  }

  // 2. Try Local NIM Container (e.g. localhost:9000 or localhost:8000)
  const localNimUrls = [
    'http://localhost:9000/v1/tts',
    'http://localhost:8000/v1/audio/speech',
    'http://localhost:9000/v1/audio/speech'
  ];
  for (const localUrl of localNimUrls) {
    try {
      console.log(`[TTS Helper] Attempting Local NIM API at ${localUrl}...`);
      const response = await fetch(localUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
        },
        body: JSON.stringify({
          text: text,
          input: text,
          model: 'resembleai/chatterbox-multilingual-tts',
          voice: 'Chatterbox-Multilingual.en-US.Male',
          language_code: 'en-US'
        })
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        console.log(`[TTS Helper] Local NIM Success at ${localUrl}. Buffer size: ${arrayBuffer.byteLength} bytes.`);
        return Buffer.from(arrayBuffer);
      }
    } catch (err) {
      // expected if container is not running locally
    }
  }

  // 3. Try NVIDIA Cloud Functions (NVCF) as a best-effort
  if (apiKey && apiKey.startsWith('nvapi-')) {
    try {
      console.log(`[TTS Helper] Attempting NVIDIA NVCF Cloud API...`);
      const response = await fetch('https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions/ddacc747-1269-4fab-bfd9-8f593dead106', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/wav'
        },
        body: JSON.stringify({
          text: text,
          voice_name: 'Chatterbox-Multilingual.en-US.Male',
          language_code: 'en-US',
          encoding: 1,
          sample_rate_hz: 22050
        })
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        console.log(`[TTS Helper] NVCF success. Buffer size: ${arrayBuffer.byteLength} bytes.`);
        return Buffer.from(arrayBuffer);
      }
    } catch (err) {
      console.warn(`[TTS Helper] NVCF failed:`, err.message);
    }
  }

  // 4. Fallback: Google Translate TTS API (Zero key, 100% reliable)
  try {
    console.log(`[TTS Helper] Falling back to free reliable Google Translate TTS...`);
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(text)}`;
    const response = await fetch(googleTtsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      console.log(`[TTS Helper] Google TTS success. Buffer size: ${arrayBuffer.byteLength} bytes.`);
      return Buffer.from(arrayBuffer);
    }
  } catch (err) {
    console.error(`[TTS Helper] Google TTS fallback failed:`, err.message);
  }

  throw new Error('All Text-to-Speech generation methods failed.');
}

module.exports = { synthesizeSpeech };
