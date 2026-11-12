const $ = (id) => document.getElementById(id);
const CADA_MS = 3000;
let conectado = false;
let timer = null;
let enCurso = false;

function pasos(e1, e2, e3) {
  $('p1').dataset.e = e1;
  $('p2').dataset.e = e2;
  $('p3').dataset.e = e3;
}

function pintar(ok, primera) {
  if (ok) {
    conectado = true;
    pasos('hecho', 'hecho', 'activo');
    $('p2-est').dataset.s = 'ok';
    $('p2-est-t').textContent = '¡Listo, conectado!';
    $('p2-txt').textContent = 'OpenWhispr está abierta y lista.';
    $('resumen').textContent = primera
      ? 'Ya tienes OpenWhispr abierta. Solo falta abrir WhatsApp Web.'
      : '¡Todo listo! Ahora abre WhatsApp Web.';
    $('resumen').dataset.s = 'ok';
  } else {
    conectado = false;
    pasos('activo', 'pendiente', 'pendiente');
    $('p2-est').dataset.s = 'espera';
    $('p2-est-t').textContent = 'Esperando a OpenWhispr…';
    $('p2-txt').textContent = 'Mantén OpenWhispr abierta. Aquí lo notaremos solos, no tienes que hacer nada.';
    $('resumen').textContent = '';
    $('resumen').dataset.s = '';
  }
}

async function sondear(primera) {
  if (enCurso) return;
  enCurso = true;
  let r = null;
  try { r = await chrome.runtime.sendMessage({ type: 'detect' }); } catch { /* sin respuesta */ }
  enCurso = false;
  const ok = !!(r && r.ok);
  if (ok !== conectado || primera) pintar(ok, primera);
  if (ok) detener();
}

function iniciar() {
  if (!timer) timer = setInterval(() => sondear(false), CADA_MS);
}
function detener() {
  if (timer) { clearInterval(timer); timer = null; }
}

$('reintentar').addEventListener('click', async () => {
  $('reintentar').disabled = true;
  await sondear(false);
  $('reintentar').disabled = false;
  if (!conectado) { $('p2-est-t').textContent = 'Todavía no la encuentro. Sigo mirando…'; iniciar(); }
});

// Pausa el sondeo si la pestaña está oculta; al volver, mira de inmediato.
document.addEventListener('visibilitychange', () => {
  if (conectado) return;
  if (document.hidden) detener(); else { sondear(false); iniciar(); }
});

pintar(false, true);
sondear(true).then(() => { if (!conectado) iniciar(); });
