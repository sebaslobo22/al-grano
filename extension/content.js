// Finds voice notes in the open chat, gets their audio, and shows the transcript under each one.
(() => {
  const TAG = 'wa-transcriptor';
  const DEFAULTS = { server: 'http://127.0.0.1:8178', mode: 'auto', language: 'auto' };
  // Used only when WhatsApp's internal modules are unreachable.
  const VOICE_SELECTOR = [
    '[data-icon="audio-play"]', '[data-icon="audio-pause"]', '[data-icon*="ptt"]',
    '[aria-label*="Voice message" i]', '[aria-label*="Mensaje de voz" i]', '[aria-label*="nota de voz" i]',
  ].join(',');

  let cfg = { ...DEFAULTS };
  chrome.storage.sync.get(DEFAULTS).then((v) => { cfg = { ...DEFAULTS, ...v }; scan(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) cfg[k] = changes[k].newValue;
  });

  // id -> { status: 'pending'|'manual'|'working'|'done'|'needs-play'|'error', text, error }
  const notes = new Map();
  const seen = new Set();
  let lastClicked = { id: null, at: 0 };

  // ---- talking to page-hook.js ----
  let reqSeq = 0;
  const waiting = new Map();
  function pageCall(kind, payload, timeoutMs = 60000) {
    const reqId = ++reqSeq;
    return new Promise((resolve) => {
      const t = setTimeout(() => { waiting.delete(reqId); resolve({ ok: false, api: false, error: 'timeout' }); }, timeoutMs);
      waiting.set(reqId, (data) => { clearTimeout(t); resolve(data); });
      window.postMessage({ tag: TAG, dir: 'to-page', kind, reqId, ...payload }, '*');
    });
  }
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.tag !== TAG || ev.data.dir !== 'to-content') return;
    if (ev.data.kind === 'blob') return onPlayedBlob(ev.data.blob);
    const cb = waiting.get(ev.data.reqId);
    if (cb) { waiting.delete(ev.data.reqId); cb(ev.data); }
  });

  // ---- finding voice notes ----
  const rowFor = (id) => document.querySelector(`#main [data-id="${CSS.escape(id)}"]`);

  async function scan() {
    const rows = [...document.querySelectorAll('#main [data-id]')];
    const fresh = rows.map((r) => r.getAttribute('data-id')).filter((id) => id && !seen.has(id));
    fresh.forEach((id) => seen.add(id));

    if (fresh.length) {
      const res = await pageCall('classify', { ids: fresh }, 5000);
      const audioIds = res.api
        ? res.audio
        : fresh.filter((id) => { const r = rowFor(id); return r && r.querySelector(VOICE_SELECTOR); });
      for (const id of audioIds) await register(id, (res.hashes && res.hashes[id]) || '');
    }
    // WhatsApp re-renders rows while scrolling; put the boxes back.
    for (const [id] of notes) render(id);
  }

  // Transcripts are saved on this computer (chrome.storage.local) under the audio's fingerprint,
  // so reloading the page, restarting the browser or seeing a forwarded copy never repeats work.
  const cacheKeys = (id) => {
    const h = hashes.get(id);
    return h ? ['h:' + h, 't:' + id] : ['t:' + id];
  };
  const hashes = new Map();

  async function register(id, hash) {
    if (notes.has(id)) return;
    if (hash) hashes.set(id, hash);
    const keys = cacheKeys(id);
    const got = await chrome.storage.local.get(keys);
    const cached = keys.map((k) => got[k]).find((v) => v != null);
    if (cached != null) {
      notes.set(id, { status: 'done', result: cached });
    } else if (cfg.mode === 'auto') {
      notes.set(id, { status: 'pending' });
      enqueue(id);
    } else {
      notes.set(id, { status: 'manual' });
    }
    render(id);
  }

  // ---- work queue: one note at a time, the ones on screen first ----
  // Downloading, decoding and resampling several notes at once competes with WhatsApp for the
  // main thread and the GPU; one by one keeps scrolling smooth and the transcriber is serial anyway.
  const queue = [];
  let busy = false;
  function enqueue(id) {
    if (!queue.includes(id)) queue.push(id);
    pump();
  }
  function onScreen(id) {
    const r = rowFor(id);
    if (!r) return false;
    const b = r.getBoundingClientRect();
    return b.bottom > 0 && b.top < innerHeight;
  }
  async function pump() {
    if (busy || !queue.length) return;
    if (document.hidden) return document.addEventListener('visibilitychange', pump, { once: true });
    busy = true;
    const i = queue.findIndex(onScreen);
    const id = queue.splice(i >= 0 ? i : queue.length - 1, 1)[0];
    try { await process(id); } finally { busy = false; pump(); }
  }

  // ---- getting audio and transcribing ----
  async function process(id) {
    set(id, { status: 'working' });
    const res = await pageCall('download', { id });
    if (!res.ok) {
      set(id, { status: 'needs-play' });
      return;
    }
    await transcribeBuffer(id, res.buffer);
  }

  async function transcribeBuffer(id, buffer) {
    set(id, { status: 'working' });
    let wav, seconds;
    try {
      ({ wav, seconds } = await WTAudio.toWav16k(buffer));
    } catch {
      return set(id, { status: 'error', error: 'No se pudo leer el audio.' });
    }
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'transcribe', wav: await WTAudio.toBase64(wav) });
    } catch {
      return set(id, { status: 'error', error: 'La extensión se actualizó. Recarga WhatsApp Web.' });
    }
    if (!res || !res.ok) {
      const offline = res && res.error === 'offline';
      return set(id, {
        status: 'error',
        error: offline ? 'OpenWhispr está cerrado. Ábrelo y toca Reintentar.' : 'El transcriptor falló. Toca Reintentar.',
      });
    }
    const result = { ...res.result, seconds: res.result.seconds || seconds, at: Date.now() };
    chrome.storage.local.set({ [cacheKeys(id)[0]]: result });
    set(id, { status: 'done', result });
  }

  // Fallback path: the user pressed play, WhatsApp produced the audio blob.
  document.addEventListener('click', (ev) => {
    const row = ev.target.closest && ev.target.closest('#main [data-id]');
    if (row) lastClicked = { id: row.getAttribute('data-id'), at: Date.now() };
  }, true);

  async function onPlayedBlob(blob) {
    const { id, at } = lastClicked;
    if (!id || Date.now() - at > 15000) return;
    const n = notes.get(id);
    if (!n && !(rowFor(id) && rowFor(id).querySelector(VOICE_SELECTOR))) return;
    if (n && (n.status === 'done' || n.status === 'working' || n.status === 'manual')) return;
    if (!n) notes.set(id, { status: 'working' });
    await transcribeBuffer(id, await blob.arrayBuffer());
  }

  // ---- drawing ----
  function set(id, patch) {
    notes.set(id, { ...(notes.get(id) || {}), ...patch });
    render(id);
  }

  function render(id) {
    const row = rowFor(id);
    const n = notes.get(id);
    if (!row || !n) return;
    const resultText = n.result ? (typeof n.result === 'string' ? n.result : n.result.text) : '';
    const state = n.status + '|' + (resultText || n.error || '');
    let box = row.querySelector('.ag-box');
    if (box && box.dataset.state === state) return;
    if (!box) {
      // Only measure the bubble (forces layout) when the box has to be created.
      box = document.createElement('div');
      box.className = 'ag-box';
      bubbleOf(row).appendChild(box);
    }
    box.dataset.state = state;
    box.textContent = '';
    box.classList.remove('ag-box-work', 'ag-box-error', 'ag-box-manual', 'ag-box-hint');

    const pill = (cls, iconName, txt, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ag-pill ' + cls;
      b.append(WTFormat.icon(iconName, 13), Object.assign(document.createElement('span'), { textContent: txt }));
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const small = (txt) => Object.assign(document.createElement('span'), { className: 'ag-small', textContent: txt });

    switch (n.status) {
      case 'pending':
      case 'working': {
        box.classList.add('ag-box-work');
        const lines = document.createElement('div');
        lines.className = 'ag-skeleton';
        for (let i = 0; i < 3; i++) lines.append(document.createElement('i'));
        box.append(lines, small('Transcribiendo…'));
        break;
      }
      case 'done':
        box.append(WTFormat.build(n.result));
        break;
      case 'manual':
        box.classList.add('ag-box-manual');
        box.append(pill('ag-pill-brand', 'logo', 'Transcribir', () => process(id)));
        break;
      case 'needs-play':
        box.classList.add('ag-box-hint');
        box.append(small('Reprodúcela un segundo para transcribirla.'));
        break;
      case 'error': {
        box.classList.add('ag-box-error');
        const card = document.createElement('div');
        card.className = 'ag-error';
        card.setAttribute('role', 'alert');
        const msg = document.createElement('span');
        msg.className = 'ag-error-msg';
        msg.append(WTFormat.icon('alert', 15), Object.assign(document.createElement('span'), { textContent: n.error }));
        card.append(msg, pill('ag-pill-error', 'retry', 'Reintentar', () => process(id)));
        box.append(card);
        break;
      }
    }
  }

  // The bubble is the outermost ancestor of the play button that paints a background and is
  // narrower than the chat. WhatsApp's class names are obfuscated, so go by looks.
  function bubbleOf(row) {
    const legacy = row.querySelector('.message-in, .message-out');
    if (legacy) return legacy;
    const rowWidth = row.getBoundingClientRect().width;
    let el = row.querySelector(VOICE_SELECTOR);
    let bubble = null;
    while (el && el !== row) {
      const bg = getComputedStyle(el).backgroundColor;
      const painted = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg);
      if (painted && el.getBoundingClientRect().width < rowWidth * 0.9) bubble = el;
      el = el.parentElement;
    }
    return bubble || row;
  }

  let timer = null;
  const later = window.requestIdleCallback
    ? (fn) => requestIdleCallback(fn, { timeout: 600 })
    : (fn) => setTimeout(fn, 0);
  new MutationObserver((records) => {
    // Our own boxes changing must not trigger another scan.
    if (records.every((r) => r.target.closest && r.target.closest('.ag-box'))) return;
    clearTimeout(timer);
    timer = setTimeout(() => later(scan), 300);
  }).observe(document.body, { childList: true, subtree: true });
})();
