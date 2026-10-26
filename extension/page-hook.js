// Runs inside WhatsApp Web's own page (MAIN world).
// Two jobs:
//  1. Answer the content script: "which of these message ids are voice notes?"
//     and "give me the decrypted audio of this one", using WhatsApp's internal modules.
//  2. Fallback: catch audio blobs WhatsApp creates when the user presses play.
(() => {
  const TAG = 'wa-transcriptor';

  function mod(name) {
    try {
      return typeof window.require === 'function' ? window.require(name) : null;
    } catch {
      return null;
    }
  }

  function msgCollection() {
    const c = mod('WAWebCollections');
    return c && c.Msg ? c.Msg : null;
  }

  // WhatsApp's DOM rows carry only the short message id (e.g. "3EB0…"); older builds used the
  // full "false_<chat>_<id>" form. Accept both.
  function getMsg(id) {
    const Msg = msgCollection();
    if (!Msg) return null;
    try {
      const direct = Msg.get(id);
      if (direct) return direct;
      return Msg.getModelsArray().find((m) => m.id && m.id.id === id) || null;
    } catch {
      return null;
    }
  }

  // downloadAndMaybeDecrypt requires a performance-logging object; give it one that ignores everything.
  const noopLogger = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => noopLogger) });

  const isAudioType = (t) => t === 'ptt' || t === 'audio';

  async function blobFromMediaData(msg) {
    const mb = msg.mediaData && msg.mediaData.mediaBlob;
    if (!mb) return null;
    try {
      if (typeof mb.forceToBlob === 'function') return mb.forceToBlob();
      if (mb._blob instanceof Blob) return mb._blob;
      if (mb instanceof Blob) return mb;
    } catch {}
    return null;
  }

  async function downloadAudio(id) {
    const msg = getMsg(id);
    if (!msg) throw new Error('no-api');
    if (!isAudioType(msg.type)) throw new Error('not-audio');

    let blob = await blobFromMediaData(msg);
    if (blob) return { buffer: await blob.arrayBuffer(), mime: blob.type || msg.mimetype || 'audio/ogg' };

    const dm = mod('WAWebDownloadManager');
    const manager = dm && (dm.downloadManager || dm.default);
    if (manager && typeof manager.downloadAndMaybeDecrypt === 'function') {
      const buffer = await manager.downloadAndMaybeDecrypt({
        directPath: msg.directPath,
        encFilehash: msg.encFilehash,
        filehash: msg.filehash,
        mediaKey: msg.mediaKey,
        mediaKeyTimestamp: msg.mediaKeyTimestamp,
        type: msg.type,
        mimetype: msg.mimetype,
        signal: new AbortController().signal,
        downloadQpl: noopLogger,
      });
      return { buffer, mime: msg.mimetype || 'audio/ogg' };
    }

    if (typeof msg.downloadMedia === 'function') {
      await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true });
      blob = await blobFromMediaData(msg);
      if (blob) return { buffer: await blob.arrayBuffer(), mime: blob.type || 'audio/ogg' };
    }
    throw new Error('no-api');
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.tag !== TAG || ev.data.dir !== 'to-page') return;
    const { kind, reqId, ids, id } = ev.data;
    const reply = (payload, transfer) =>
      window.postMessage({ tag: TAG, dir: 'to-content', reqId, ...payload }, '*', transfer || []);

    if (kind === 'classify') {
      if (!msgCollection()) return reply({ api: false });
      const byShort = new Map();
      try {
        for (const m of msgCollection().getModelsArray()) if (m.id && isAudioType(m.type)) byShort.set(m.id.id, m);
      } catch {}
      const audio = ids.filter((i) => byShort.has(i) || (getMsg(i) && isAudioType(getMsg(i).type)));
      return reply({ api: true, audio });
    }

    if (kind === 'download') {
      try {
        const { buffer, mime } = await downloadAudio(id);
        if (!buffer || !buffer.byteLength) throw new Error('empty');
        // Send a copy: WhatsApp caches this buffer and reuses it for playback, so never transfer it.
        reply({ ok: true, buffer: buffer.slice(0), mime });
      } catch (e) {
        reply({ ok: false, error: String((e && e.message) || e) });
      }
    }
  });

  // Fallback: when WhatsApp turns a decrypted voice note into a blob: URL (on play), pass it on.
  const original = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = original.apply(this, arguments);
    try {
      if (obj instanceof Blob && /^audio\//.test(obj.type)) {
        window.postMessage({ tag: TAG, dir: 'to-content', kind: 'blob', blob: obj, url }, '*');
      }
    } catch {}
    return url;
  };
})();
