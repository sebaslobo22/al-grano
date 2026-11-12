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

    if (fresh.length) {
      const res = await pageCall('classify', { ids: fresh }, 5000);
      let audioIds;
      if (res.api) {
        fresh.forEach((id) => seen.add(id));
        audioIds = res.audio;
      } else {
        // Without WhatsApp's modules only the DOM tells; a row that is still an empty
        // placeholder (virtualized) is looked at again on the next scan.
        audioIds = [];
        for (const id of fresh) {
          const r = rowFor(id);
          if (!r || !r.childElementCount || !r.innerText.trim()) continue;
          seen.add(id);
          if (r.querySelector(VOICE_SELECTOR)) audioIds.push(id);
        }
      }
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
  // A note you just recorded is still uploading, and a fresh chat may not be loaded yet:
  // keep the loader and try again a few times before asking for a play.
  const RETRY_MS = [3000, 6000, 12000, 24000, 48000];
  const tries = new Map();
  async function process(id) {
    set(id, { status: 'working', startedAt: Date.now() });
    const res = await pageCall('download', { id });
    if (!res.ok) {
      const n = tries.get(id) || 0;
      if (n < RETRY_MS.length && res.error !== 'not-audio') {
        tries.set(id, n + 1);
        set(id, { status: 'pending' });
        setTimeout(() => { if (notes.get(id) && notes.get(id).status === 'pending') enqueue(id); }, RETRY_MS[n]);
        return;
      }
      set(id, { status: 'needs-play' });
      return;
    }
    tries.delete(id);
    await transcribeBuffer(id, res.buffer);
  }

  const MIN_LOADER_MS = 700;
  async function transcribeBuffer(id, buffer) {
    if ((notes.get(id) || {}).status !== 'working') set(id, { status: 'working', startedAt: Date.now() });
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
    const shown = Date.now() - ((notes.get(id) || {}).startedAt || 0);
    if (shown < MIN_LOADER_MS) await new Promise((r) => setTimeout(r, MIN_LOADER_MS - shown));
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
    // Waiting in line and working look the same: retries must not restart the loader.
    const look = n.status === 'pending' ? 'working' : n.status;
    const state = look + '|' + (resultText || n.error || '');
    let box = row.querySelector('.ag-box');
    // A box hung on the row itself (bubble not found at the time) is moved into the bubble.
    if (box && box.parentElement === row) { box.remove(); box = null; }
    if (box && box.dataset.state === state) return;
    if (!box) {
      // Only measure the bubble (forces layout) when the box has to be created.
      const host = bubbleOf(row);
      if (!host) return; // not laid out yet: the next scan tries again
      box = document.createElement('div');
      box.className = 'ag-box';
      host.appendChild(box);
    }
    const fresh = !box.dataset.state;
    const from = fresh ? 0 : box.getBoundingClientRect().height;
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
    // WhatsApp rebuilds rows while scrolling: a box we already showed comes back without replaying.
    if (n.shown !== state) morph(box, from, !fresh || n.status !== 'done');
    n.shown = state;
  }

  // Height glides from the old state to the new one and the new content fades in from a blur.
  // Uses the Web Animations API (Chrome and Safari), touches only height, opacity and filter.
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  function morph(box, from, emphasize) {
    if (still.matches || !box.animate) return;
    const to = box.getBoundingClientRect().height;
    const ease = 'cubic-bezier(.22,.8,.24,1)';
    if (Math.abs(to - from) > 1) {
      box.animate([{ height: from + 'px', overflow: 'hidden' }, { height: to + 'px', overflow: 'hidden' }],
        { duration: emphasize ? 460 : 320, easing: ease });
    }
    const parts = box.querySelectorAll('.ag-head, .ag-asks, .ag-body > *, .ag-more, .ag-skeleton, .ag-small, .ag-pill, .ag-error');
    parts.forEach((el, i) => {
      el.animate([
        { opacity: 0, transform: 'translateY(6px)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ], { duration: 420, delay: Math.min(i, 8) * 45, easing: ease, fill: 'backwards' });
    });
  }

  // The bubble is the outermost ancestor of the play button that paints a background and is
  // narrower than the chat. WhatsApp's class names are obfuscated, so go by looks.
  // Never returns the row itself: the text must stay inside the bubble, or wait.
  function bubbleOf(row) {
    const legacy = row.querySelector('.message-in, .message-out');
    if (legacy) return legacy;
    const rowWidth = row.getBoundingClientRect().width;
    let el = row.querySelector(VOICE_SELECTOR);
    if (!rowWidth || !el) return null;
    let painted = null;
    let narrow = null;
    while (el && el !== row) {
      const w = el.getBoundingClientRect().width;
      if (w && w < rowWidth * 0.9) {
        narrow = el;
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) painted = el;
      }
      el = el.parentElement;
    }
    return painted || narrow;
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
