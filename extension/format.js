// Turns a raw transcript into something you can scan: paragraphs where the speaker pauses,
// key data (times, days, money, emails) in bold, long notes folded. Plain rules, no AI.
const WTFormat = (() => {
  const PAUSE = 0.9; // seconds of silence that start a new paragraph
  const SOFT_MAX = 40; // words: past this, break at the next sentence end
  const HARD_MAX = 70; // words: past this, break at the next segment
  const FOLD_AT = 70; // words: longer notes start folded

  const words = (s) => (s.match(/\S+/g) || []).length;
  const tidy = (s) =>
    s.replace(/\s+/g, ' ').replace(/\s+([,.;:?!])/g, '$1').trim().replace(/^[a-záéíóúñ¿¡]/, (c) => c.toUpperCase());

  // result: { text, segments?: [[start, end, text]], seconds? } or a plain string (older cache).
  function paragraphs(result) {
    const segs = typeof result === 'object' && Array.isArray(result.segments) ? result.segments : null;
    const out = [];
    let cur = [];
    let count = 0;
    const flush = () => { if (cur.length) out.push(tidy(cur.join(' '))); cur = []; count = 0; };

    if (segs && segs.length) {
      let prevEnd = null;
      for (const [start, end, text] of segs) {
        const t = String(text || '').trim();
        if (!t) continue;
        const prev = cur[cur.length - 1] || '';
        const gap = prevEnd == null ? 0 : start - prevEnd;
        if (cur.length && (gap >= PAUSE || count >= HARD_MAX || (count >= SOFT_MAX && /[.?!]$/.test(prev)))) flush();
        cur.push(t);
        count += words(t);
        prevEnd = end;
      }
    } else {
      const text = typeof result === 'string' ? result : (result && result.text) || '';
      for (const sentence of text.replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/)) {
        if (!sentence.trim()) continue;
        if (count >= SOFT_MAX) flush();
        cur.push(sentence);
        count += words(sentence);
      }
    }
    flush();
    return out;
  }

  const DAYS = 'lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo';
  const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
  const KEY = new RegExp(
    [
      '[\\w.+-]+@[\\w-]+\\.[\\w.]+', // email
      '\\b(?:a|desde|hasta|para|antes de|después de|despues de) (?:las?|la una) \\d{1,2}(?:[:.]\\d{2})?(?: y (?:media|cuarto))?(?: (?:de la (?:mañana|tarde|noche)|a\\.? ?m\\.?|p\\.? ?m\\.?))?',
      '\\b\\d{1,2}(?::\\d{2})? ?(?:a\\.? ?m\\.?|p\\.? ?m\\.?)',
      '\\b\\d{1,2}:\\d{2}\\b',
      '\\b\\d{1,2}(?:,? \\d{1,2})? y (?:media|cuarto)(?: de la (?:mañana|tarde|noche))?',
      `\\b(?:el |este |próximo |proximo |los )?(?:${DAYS})(?: \\d{1,2}(?: de (?:${MONTHS}))?)?\\b`,
      `\\b\\d{1,2} de (?:${MONTHS})\\b`,
      '\\b(?:pasado mañana|mañana|hoy|esta noche|esta tarde|fin(?:es)? de semana|la (?:próxima|proxima|otra) semana)\\b',
      '(?:\\$|US\\$|€) ?\\d[\\d.,]*(?: ?(?:mil|millones?))?',
      '\\b\\d[\\d.,]*(?: (?:mil|millones?))? ?(?:dólares|dolares|bolívares|bolivares|bs\\.?|usd|euros|pesos)\\b',
    ].join('|'),
    'gi'
  );

  // Appends `text` to `parent`, wrapping key data in <strong>. Uses text nodes only (no innerHTML).
  function appendHighlighted(parent, text) {
    let last = 0;
    for (const m of text.matchAll(KEY)) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const b = document.createElement('strong');
      b.className = 'ag-key';
      b.textContent = m[0];
      parent.append(b);
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  function clock(seconds) {
    if (!seconds || !isFinite(seconds)) return '';
    const s = Math.round(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- tiny inline icons (SVG built with createElementNS, no innerHTML) ----
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    // The Al Grano mark without its tile, so it sits on any bubble color.
    logo: [['path', { d: 'M5 4h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8l-4.5 3.5V18H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'stroke-width': 2.2 }],
      ['path', { d: 'M8.5 9.5v3M12 8v6M15.5 9v4', 'stroke-width': 2.2 }]],
    copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2.5 }], ['path', { d: 'M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5' }]],
    check: [['path', { d: 'M4.5 12.5l5 5 10-11' }]],
    chevron: [['path', { d: 'M6 9.5l6 6 6-6' }]],
    alert: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v5.5M12 16.5h.01' }]],
    retry: [['path', { d: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' }]],
  };
  function icon(name, size = 14) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('class', 'ag-ico ag-ico-' + name);
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of ICONS[name]) {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      svg.append(el);
    }
    return svg;
  }

  function plainText(result) {
    return paragraphs(result).join('\n\n');
  }

  // Builds the finished transcript block.
  function build(result) {
    const paras = paragraphs(result);
    const total = paras.reduce((n, p) => n + words(p), 0);
    const seconds =
      (typeof result === 'object' && (result.seconds || (result.segments && result.segments.length && result.segments[result.segments.length - 1][1]))) || 0;

    const wrap = document.createElement('div');
    wrap.className = 'ag-done';

    const head = document.createElement('div');
    head.className = 'ag-head';
    const title = document.createElement('span');
    title.className = 'ag-title';
    title.append(icon('logo', 12));
    const label = document.createElement('span');
    label.textContent = 'Al Grano' + (clock(seconds) ? ' · ' + clock(seconds) : '');
    title.append(label);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ag-copy';
    copy.title = 'Copiar transcripción';
    copy.setAttribute('aria-label', 'Copiar transcripción');
    copy.append(icon('copy', 14));
    let copyTimer = null;
    copy.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(plainText(result));
      } catch {
        return;
      }
      copy.classList.add('ag-copied');
      copy.textContent = '';
      copy.append(icon('check', 13), Object.assign(document.createElement('span'), { textContent: 'Copiado' }));
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copy.classList.remove('ag-copied');
        copy.textContent = '';
        copy.append(icon('copy', 14));
      }, 1500);
    });
    head.append(title, copy);
    wrap.append(head);

    const body = document.createElement('div');
    body.className = 'ag-body';
    if (!paras.length) {
      const p = document.createElement('p');
      p.className = 'ag-empty';
      p.textContent = 'No se detectó voz en esta nota.';
      body.append(p);
    }
    for (const text of paras) {
      const p = document.createElement('p');
      appendHighlighted(p, text);
      body.append(p);
    }
    wrap.append(body);

    if (total > FOLD_AT) {
      body.classList.add('ag-folded');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ag-more';
      const moreText = document.createElement('span');
      moreText.textContent = 'Ver todo';
      more.append(moreText, icon('chevron', 12));
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const folded = body.classList.toggle('ag-folded');
        moreText.textContent = folded ? 'Ver todo' : 'Ver menos';
        more.classList.toggle('ag-open', !folded);
        more.setAttribute('aria-expanded', String(!folded));
      });
      wrap.append(more);
    }
    return wrap;
  }

  return { build, paragraphs, icon, plainText };
})();
