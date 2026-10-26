// Talks to the local whisper.cpp server (started by OpenWhispr). One note at a time.
const DEFAULTS = { server: 'http://127.0.0.1:8178', mode: 'auto', language: 'auto' };

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

// The whisper.cpp server answers GET / with the header "Server: whisper.cpp".
async function isWhisper(base, ms = 800) {
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(ms) });
    return /whisper\.cpp/i.test(r.headers.get('server') || '');
  } catch {
    return false;
  }
}

// Looks for the server on 127.0.0.1:8170-8199 and saves the first one found.
async function detect() {
  const saved = (await settings()).server;
  if (await isWhisper(saved)) return { ok: true, server: saved };
  const urls = [];
  for (let p = 8170; p <= 8199; p++) urls.push('http://127.0.0.1:' + p);
  const found = await Promise.all(urls.map(async (u) => ((await isWhisper(u)) ? u : null)));
  const hit = found.find(Boolean);
  if (!hit) return { ok: false, server: saved };
  await chrome.storage.sync.set({ server: hit });
  return { ok: true, server: hit };
}

let queue = Promise.resolve();

function transcribe(wavBase64) {
  const job = queue.then(async () => {
    const { language } = await settings();
    const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'nota.wav');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (language && language !== 'auto') form.append('language', language);

    const post = async (server) =>
      fetch(server.replace(/\/$/, '') + '/inference', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
    let res;
    try {
      res = await post((await settings()).server);
    } catch {
      // Offline: the port may have changed. Look for it once before giving up.
      const found = await detect();
      if (!found.ok) throw new Error('offline');
      try {
        res = await post(found.server);
      } catch {
        throw new Error('offline');
      }
    }
    if (!res.ok) throw new Error('http-' + res.status);
    const data = await res.json();
    const segments = (data.segments || []).map((s) => [s.start, s.end, String(s.text || '').trim()]);
    return { text: String(data.text || '').trim(), segments, seconds: data.duration };
  });
  queue = job.catch(() => {});
  return job;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'transcribe') {
    transcribe(msg.wav).then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: e.message })
    );
    return true;
  }
  if (msg.type === 'ping') {
    detect().then((r) => sendResponse(r), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'detect') {
    detect().then((r) => sendResponse(r), () => sendResponse({ ok: false }));
    return true;
  }
});
