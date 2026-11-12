// Turns any audio Chrome can play (WhatsApp uses OGG/Opus) into a 16 kHz mono WAV,
// the format whisper.cpp reads.
const WTAudio = (() => {
  const RATE = 16000;

  async function toWav16k(arrayBuffer) {
    const ctx = new AudioContext();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer);
    } finally {
      ctx.close();
    }
    const length = Math.max(1, Math.ceil(decoded.duration * RATE));
    const offline = new OfflineAudioContext(1, length, RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return { wav: encodeWav(rendered.getChannelData(0), RATE), seconds: decoded.duration };
  }

  function encodeWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  // Native, asynchronous base64 (FileReader) so long notes don't block the page.
  function toBase64(buffer) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(new Blob([buffer]));
    });
  }

  return { toWav16k, toBase64 };
})();
