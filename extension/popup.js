const DEFAULTS = { server: 'http://127.0.0.1:8178', mode: 'auto', language: 'auto' };
const $ = (id) => document.getElementById(id);

// ---- connection status ----
function estado(kind, text) {
  $('estado').dataset.s = kind;
  $('estado').querySelector('b').textContent = text;
  $('ayuda').hidden = kind !== 'off';
}
async function conectar(note) {
  estado('busy', 'Buscando…');
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: 'ping' }); } catch { /* service worker unavailable */ }
  if (r && r.ok) {
    estado('ok', 'Conectado');
    $('server').value = r.server;
    if (note) $('server-nota').textContent = 'Encontrado en ' + r.server;
  } else {
    estado('off', 'OpenWhispr cerrado');
    if (note) $('server-nota').textContent = 'No se encontró. Abre OpenWhispr y prueba de nuevo.';
  }
}

// ---- segmented controls ----
function seg(id, key, value) {
  const group = $(id);
  const paint = (v) => group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  paint(value);
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    paint(b.dataset.v);
    chrome.storage.sync.set({ [key]: b.dataset.v });
  });
  group.addEventListener('keydown', (e) => {
    const items = [...group.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d || i < 0) return;
    e.preventDefault();
    items[(i + d + items.length) % items.length].focus();
    items[(i + d + items.length) % items.length].click();
  });
}

// ---- usage: counts t:* keys in local storage; old values may be plain strings ----
async function uso() {
  const all = await chrome.storage.local.get(null);
  let n = 0, seconds = 0;
  for (const k in all) {
    if (!k.startsWith('t:')) continue;
    n++;
    const s = all[k] && typeof all[k] === 'object' ? Number(all[k].seconds) : 0;
    if (isFinite(s) && s > 0) seconds += s;
  }
  const min = seconds > 0 && seconds < 60 ? '<1' : String(Math.round(seconds / 60));
  $('uso-n').textContent = n.toLocaleString('es');
  $('uso-n-l').textContent = n === 1 ? 'nota transcrita' : 'notas transcritas';
  $('uso-m').textContent = min;
}

// ---- advanced ----
$('buscar').addEventListener('click', async () => {
  $('buscar').disabled = true;
  $('server-nota').textContent = 'Buscando…';
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: 'detect' }); } catch { /* ignore */ }
  $('buscar').disabled = false;
  if (r && r.ok) {
    $('server').value = r.server;
    estado('ok', 'Conectado');
    $('server-nota').textContent = 'Encontrado en ' + r.server;
  } else {
    estado('off', 'OpenWhispr cerrado');
    $('server-nota').textContent = 'No se encontró. Abre OpenWhispr y prueba de nuevo.';
  }
});
$('server').addEventListener('change', () => {
  const v = $('server').value.trim() || DEFAULTS.server;
  chrome.storage.sync.set({ server: v });
  conectar(true);
});

$('version').textContent = 'v' + chrome.runtime.getManifest().version;
chrome.storage.sync.get(DEFAULTS).then((v) => {
  seg('modo', 'mode', v.mode);
  seg('idioma', 'language', v.language);
  $('server').value = v.server;
});
uso();
conectar(false);
