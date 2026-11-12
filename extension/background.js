// Talks to the transcription engine OpenWhispr is running on this computer. One note at a time.
// OpenWhispr runs one of two local engines, depending on the model the person picked in it:
//   - whisper.cpp (Whisper models): HTTP on 127.0.0.1:8178-8199, answers GET / with "Server: whisper.cpp".
//   - sherpa-onnx (Parakeet, Orukeet, Cohere…): WebSocket on 127.0.0.1:6006-6029.
// Only loopback addresses are ever contacted: audio never leaves the computer.
const DEFAULTS = { server: 'http://127.0.0.1:8178', mode: 'auto', language: 'auto' };
const WHISPER_PORTS = [8178, 8199];
const SHERPA_PORTS = [6006, 6029];

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

function isLocal(url) {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

const engineOf = (url) => (/^wss?:/.test(url) ? 'sherpa' : 'whisper');

async function isWhisper(base, ms = 800) {
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(ms) });
    return /whisper\.cpp/i.test(r.headers.get('server') || '');
  } catch {
    return false;
  }
}

function isSherpa(url, ms = 800) {
  return new Promise((resolve) => {
    let ws;
    const done = (ok) => { clearTimeout(t); try { ws && ws.close(); } catch {} resolve(ok); };
    const t = setTimeout(() => done(false), ms);
    try {
      ws = new WebSocket(url);
      ws.onopen = () => done(true);
      ws.onerror = () => done(false);
    } catch {
      done(false);
    }
  });
}

const alive = (url) => (engineOf(url) === 'sherpa' ? isSherpa(url) : isWhisper(url));

function range([from, to], scheme) {
  const out = [];
  for (let p = from; p <= to; p++) out.push(scheme + '://127.0.0.1:' + p);
  return out;
}

// Keeps the saved engine while it answers; otherwise looks for whichever OpenWhispr has running.
async function detect({ fresh = false } = {}) {
  const saved = (await settings()).server;
  if (!fresh && isLocal(saved) && (await alive(saved))) return { ok: true, server: saved, engine: engineOf(saved) };
  const [whisper, sherpa] = await Promise.all([
    Promise.all(range(WHISPER_PORTS, 'http').map(async (u) => ((await isWhisper(u)) ? u : null))),
    Promise.all(range(SHERPA_PORTS, 'ws').map(async (u) => ((await isSherpa(u)) ? u : null))),
  ]);
  // A running sherpa engine means a non-Whisper model was chosen; Whisper's may still be warm.
  const hit = sherpa.find(Boolean) || whisper.find(Boolean);
  if (!hit) return { ok: false, server: saved, engine: null };
  await chrome.storage.sync.set({ server: hit });
  return { ok: true, server: hit, engine: engineOf(hit) };
}

// ---- engines ----
function wavToFloat32(bytes) {
  // Our own 16 kHz mono PCM16 WAV: 44-byte header, then samples.
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.byteLength - 44) >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

async function viaWhisper(server, bytes, language) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'nota.wav');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language && language !== 'auto') form.append('language', language);
  const res = await fetch(server.replace(/\/$/, '') + '/inference', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!res.ok) throw new Error('http-' + res.status);
  const data = await res.json();
  const segments = (data.segments || []).map((s) => [s.start, s.end, String(s.text || '').trim()]);
  return { text: String(data.text || '').trim(), segments, seconds: data.duration };
}

// sherpa-onnx offline protocol (same as OpenWhispr): [int32 rate][int32 bytes][float32 samples],
// the server answers with the text, the client replies "Done" and the server closes.
function viaSherpa(server, bytes) {
  const samples = wavToFloat32(bytes);
  const msg = new ArrayBuffer(8 + samples.byteLength);
  const view = new DataView(msg);
  view.setInt32(0, 16000, true);
  view.setInt32(4, samples.byteLength, true);
  new Float32Array(msg, 8).set(samples);
  return new Promise((resolve, reject) => {
    let text = '';
    const ws = new WebSocket(server);
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, 5 * 60 * 1000);
    ws.onopen = () => ws.send(msg);
    ws.onmessage = (ev) => { text += typeof ev.data === 'string' ? ev.data : ''; ws.send('Done'); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('offline')); };
    ws.onclose = () => {
      clearTimeout(t);
      let out = text.trim();
      try { const j = JSON.parse(out); if (typeof j.text === 'string') out = j.text.trim(); } catch {}
      resolve({ text: out, segments: [], seconds: samples.length / 16000 });
    };
  });
}

let queue = Promise.resolve();

function transcribe(wavBase64) {
  const job = queue.then(async () => {
    const { language } = await settings();
    const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
    const run = (server) => {
      if (!isLocal(server)) throw new Error('offline');
      return engineOf(server) === 'sherpa' ? viaSherpa(server, bytes) : viaWhisper(server, bytes, language);
    };
    try {
      return await run((await settings()).server);
    } catch (e) {
      if (/^http-/.test(e.message)) throw e;
      // The engine or its port may have changed (another model picked in OpenWhispr): look again once.
      const found = await detect({ fresh: true });
      if (!found.ok) throw new Error('offline');
      try {
        return await run(found.server);
      } catch {
        throw new Error('offline');
      }
    }
  });
  queue = job.catch(() => {});
  return job;
}

// ---- cache housekeeping: keep the newest transcripts, drop the oldest past the limit ----
const CACHE_LIMIT = 3000;
async function pruneCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => /^(t|h):/.test(k));
  if (keys.length <= CACHE_LIMIT) return;
  keys.sort((a, b) => ((all[a] && all[a].at) || 0) - ((all[b] && all[b].at) || 0));
  await chrome.storage.local.remove(keys.slice(0, keys.length - CACHE_LIMIT));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'transcribe') {
    transcribe(msg.wav).then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e.message })
    );
    return true;
  }
  if (msg.type === 'ping' || msg.type === 'detect') {
    detect({ fresh: msg.type === 'detect' && msg.fresh }).then((r) => sendResponse(r), () => sendResponse({ ok: false }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(pruneCache);

// First install: open the step-by-step welcome page.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('bienvenida.html') });
  pruneCache();
});
