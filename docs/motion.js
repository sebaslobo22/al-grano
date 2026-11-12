// Motion layer for the landing: scroll-linked morphs (both directions), a cursor that trails
// the pointer, and a halo that lights the section under it. Everything reads layout once per
// frame and only writes transforms, opacity and CSS variables, so it stays on the compositor.
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var vh = innerHeight;
  var root = document.documentElement;

  // Ambient light and progress bar
  var amb = document.createElement('div');
  amb.className = 'ambient'; amb.setAttribute('aria-hidden', 'true');
  amb.innerHTML = '<i></i><i></i>';
  document.body.prepend(amb);
  var bar = document.createElement('div');
  bar.className = 'progress'; bar.setAttribute('aria-hidden', 'true');
  document.body.append(bar);

  // Step drawings trace themselves: real lengths, so Safari and Chrome agree.
  $$('.steps .s-line, .steps .s-amber').forEach(function (el) {
    try {
      var len = el.getTotalLength();
      if (len > 0) { el.style.setProperty('--len', len.toFixed(1)); el.classList.add('draw'); }
    } catch (e) {}
  });

  // ---- scroll ----
  var morphs = $$('.morph'), fills = $$('[data-fill]');
  var hero = document.querySelector('.hero'), stage = document.querySelector('.stage');
  function pIn(el) { var r = el.getBoundingClientRect(); return clamp((vh - r.top) / (vh * 0.55)); }
  function visible(el) { var r = el.getBoundingClientRect(); return r.bottom > -vh * 0.5 && r.top < vh * 1.5; }

  function frame() {
    var y = scrollY, max = root.scrollHeight - vh;
    bar.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max) : 0).toFixed(4) + ')';
    if (reduce) return;
    morphs.forEach(function (m) { if (visible(m)) m.style.setProperty('--r', ease(pIn(m)).toFixed(4)); });
    fills.forEach(function (f) {
      if (!visible(f)) return;
      var r = f.getBoundingClientRect();
      var v = clamp((vh * 0.62 - r.top) / r.height);
      f.style.setProperty('--f', v.toFixed(4));
      f.toggleAttribute('data-on', v > 0.02);
    });
    if (y < vh * 1.6) {
      var q = clamp(y / (vh * 0.9));
      hero.style.opacity = (1 - q * 0.85).toFixed(3);
      hero.style.transform = 'translate3d(0,' + (-y * 0.2).toFixed(1) + 'px,0) scale(' + (1 - q * 0.05).toFixed(4) + ')';
      var e = ease(clamp(y / (vh * 0.75)));
      stage.style.transform = 'perspective(1600px) rotateX(' + lerp(16, 0, e).toFixed(2) + 'deg) scale(' + lerp(0.92, 1, e).toFixed(4) + ')';
      stage.style.setProperty('--lift', e.toFixed(3));
    }
  }
  var ticking = false;
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(function () { ticking = false; frame(); }); } }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', function () { vh = innerHeight; onScroll(); });
  frame();
  root.classList.add('motion-on');

  // ---- halo: light follows the pointer inside each section card ----
  var lastHalo = null;
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var h = e.target.closest ? e.target.closest('.halo') : null;
    if (lastHalo && lastHalo !== h) lastHalo.classList.remove('lit');
    lastHalo = h;
    if (!h) return;
    var b = h.getBoundingClientRect();
    h.style.setProperty('--mx', (e.clientX - b.left).toFixed(0) + 'px');
    h.style.setProperty('--my', (e.clientY - b.top).toFixed(0) + 'px');
    h.classList.add('lit');
  }, { passive: true });
  document.addEventListener('pointerleave', function () { if (lastHalo) lastHalo.classList.remove('lit'); lastHalo = null; });

  if (!fine || reduce) return;

  // ---- cursor: a ring that trails the pointer, plus a soft glow ----
  var ring = document.createElement('div'), glow = document.createElement('div');
  ring.className = 'cur-ring'; glow.className = 'cur-glow';
  ring.setAttribute('aria-hidden', 'true'); glow.setAttribute('aria-hidden', 'true');
  document.body.append(glow, ring);
  root.classList.add('has-cur');

  var tx = -100, ty = -100, rx = -100, ry = -100, gx = -100, gy = -100, s = 1, ts = 1, running = false;
  var HOT = 'a, button, summary, [role="button"], label';
  function loop() {
    rx = lerp(rx, tx, 0.22); ry = lerp(ry, ty, 0.22);
    gx = lerp(gx, tx, 0.08); gy = lerp(gy, ty, 0.08);
    s = lerp(s, ts, 0.2);
    ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0) scale(' + s.toFixed(3) + ')';
    glow.style.transform = 'translate3d(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px,0)';
    var still = Math.abs(rx - tx) < 0.1 && Math.abs(ry - ty) < 0.1 && Math.abs(gx - tx) < 0.3 && Math.abs(gy - ty) < 0.3 && Math.abs(s - ts) < 0.002;
    if (still) { running = false; return; }
    requestAnimationFrame(loop);
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    if (rx < -50) { rx = gx = tx; ry = gy = ty; }
    var hot = e.target.closest && e.target.closest(HOT);
    ring.classList.toggle('hot', !!hot);
    ts = ring.classList.contains('down') ? 0.7 : hot ? 1.9 : 1;
    root.classList.add('cur-in');
    kick();
  }, { passive: true });
  document.addEventListener('pointerdown', function () { ring.classList.add('down'); ts = 0.7; kick(); });
  document.addEventListener('pointerup', function () { ring.classList.remove('down'); ts = ring.classList.contains('hot') ? 1.9 : 1; kick(); });
  document.documentElement.addEventListener('mouseleave', function () { root.classList.remove('cur-in'); });

  // Magnetic call-to-action buttons
  $$('.cta .pill').forEach(function (p) {
    p.addEventListener('pointermove', function (e) {
      var b = p.getBoundingClientRect();
      p.style.setProperty('--tx', ((e.clientX - b.left - b.width / 2) * 0.22).toFixed(1) + 'px');
      p.style.setProperty('--ty', ((e.clientY - b.top - b.height / 2) * 0.3).toFixed(1) + 'px');
    });
    p.addEventListener('pointerleave', function () { p.style.setProperty('--tx', '0px'); p.style.setProperty('--ty', '0px'); });
  });
})();
