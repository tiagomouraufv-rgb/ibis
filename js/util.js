// Utilitários de interface e texto.

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// h('div.cls#id', {attrs}, children...)
export function h(sel, attrs, ...kids) {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    m[2].replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  fwd: '<path d="M9 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  select: '<path d="M9 4h6M9 20h6M12 4v16"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  marker: '<path d="M9 15l-4 4h6l1-1"/><path d="M9 15l3 3 8-8-3-3z"/>',
  eraser: '<path d="M8 20h12"/><path d="M5 15l9-9 5 5-9 9H8z"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  rec: '<circle cx="12" cy="12" r="7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  digest: '<path d="M4 5h11a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3z"/><path d="M8 9h6M8 13h6"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c1 4 4 7 7 8M11 5c-1 4-4 7-7 8"/><path d="M13 20l4-9 4 9M14.5 17h5"/>',
  ai: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9 10h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  speak: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  upload: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  pages: '<rect x="4" y="3" width="7" height="9" rx="1"/><rect x="13" y="3" width="7" height="9" rx="1"/><rect x="4" y="14" width="7" height="7" rx="1"/><rect x="13" y="14" width="7" height="7" rx="1"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  library: '<path d="M4 4h6v16H4zM14 4h6v16h-6z"/>',
  margin: '<rect x="3" y="4" width="12" height="16" rx="1"/><path d="M18 4v16M21 4v16" stroke-dasharray="2 2"/>',
  blank: '<path d="M6 3h9l4 4v14H6z"/><path d="M12 11v6M9 14h6"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
  strike: '<path d="M5 12h14M16 6.5A4 4 0 0 0 12 5c-2.5 0-4 1.3-4 3 0 4 8 2.5 8 7 0 1.8-1.7 3-4 3a5 5 0 0 1-4.5-2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  cards: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v10"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1" stroke-dasharray="3 2"/>',
  palm: '<path d="M7 11V5a1.5 1.5 0 0 1 3 0v5M10 10V3.5a1.5 1.5 0 0 1 3 0V10M13 10V4.5a1.5 1.5 0 0 1 3 0V12M16 11V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.6L7 14"/>',
};

export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  if (name === 'rec') s.setAttribute('fill', 'currentColor');
  if (name === 'play') s.setAttribute('fill', 'currentColor');
  return s;
}

// botão com ícone (e rótulo opcional)
export function btn(iconName, label, onclick, opts = {}) {
  const b = h('button.' + (opts.cls || 'ibtn').trim().split(/\s+/).join('.'), { type: 'button', onclick, title: opts.title || label || '', 'aria-label': opts.title || label || iconName });
  if (iconName) b.appendChild(icon(iconName, opts.size || 20));
  if (label && !opts.iconOnly) b.appendChild(h('span', label));
  if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(!!opts.pressed));
  return b;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div#toast', { role: 'status' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// janela modal simples. content: Node; actions: [{label, primary, danger, onclick(close)}]
export function modal(title, content, actions = [], opts = {}) {
  actions = actions.filter(Boolean);
  const back = h('div.modal-back');
  const box = h('div.modal' + (opts.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { back.remove(); if (opts.onclose) opts.onclose(); };
  box.appendChild(h('div.modal-head', h('h2', title), btn('close', '', close, { title: 'Fechar', iconOnly: true })));
  box.appendChild(h('div.modal-body', content));
  if (actions.length) {
    box.appendChild(h('div.modal-foot', actions.map(a => h('button.' + (a.primary ? 'pbtn' : a.danger ? 'dbtn' : 'sbtn'), {
      type: 'button', onclick: () => a.onclick ? a.onclick(close) : close(),
    }, a.label))));
  }
  back.appendChild(box);
  back.addEventListener('pointerdown', e => { if (e.target === back && !opts.sticky) close(); });
  document.body.appendChild(back);
  const f = box.querySelector('input, textarea, select');
  if (f && opts.focus !== false) setTimeout(() => f.focus(), 50);
  return { close, box };
}

export function confirmBox(title, text, okLabel = 'Confirmar', danger = false) {
  return new Promise(res => {
    modal(title, h('p', text), [
      { label: 'Cancelar', onclick: c => { c(); res(false); } },
      { label: okLabel, primary: !danger, danger, onclick: c => { c(); res(true); } },
    ], { onclose: () => res(false) });
  });
}

export function promptBox(title, label, value = '', okLabel = 'OK', multiline = false) {
  return new Promise(res => {
    const inp = multiline ? h('textarea', { rows: 4 }) : h('input', { type: 'text' });
    inp.value = value;
    let done = false;
    const m = modal(title, h('label.field', h('span', label), inp), [
      { label: 'Cancelar', onclick: c => { done = true; c(); res(null); } },
      { label: okLabel, primary: true, onclick: c => { done = true; c(); res(inp.value); } },
    ], { onclose: () => { if (!done) res(null); } });
    if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; m.close(); res(inp.value); } });
  });
}

// menu flutuante (lista de ações) ancorado num ponto da tela
export function popMenu(x, y, items) {
  document.querySelectorAll('.popmenu').forEach(e => e.remove());
  const m = h('div.popmenu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.appendChild(h('div.popsep')); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', onclick: () => { m.remove(); it.onclick(); } });
    if (it.icon) b.appendChild(icon(it.icon, 18));
    b.appendChild(h('span', it.label));
    if (it.danger) b.classList.add('danger');
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const place = () => {
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  };
  place();
  requestAnimationFrame(place);   // de novo, caso algo tenha sido acrescentado ao menu
  setTimeout(() => {
    const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  }, 0);
  return m;
}

export function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function cleanText(t) {
  return String(t || '').replace(/-\n(?=[a-zà-ú])/g, '').replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = t; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} ta.remove(); return ok;
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Compartilhar arquivo pelo menu do Android (Drive, OneDrive, e-mail...). Retorna false se não suportado.
export async function shareFile(blob, name, type) {
  try {
    const f = new File([blob], name, { type: type || blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return true; }
  return false;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

export function fmtDate(ms) {
  const d = new Date(ms); if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR');
}

export function safeName(name) {
  let s = String(name || '').replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9À-ÿ._ -]+/g, '_').replace(/\s+/g, ' ').replace(/^[ ._-]+|[ ._-]+$/g, '');
  if (s.length > 80) s = s.slice(0, 80);
  return s || 'documento';
}

// tipos de destaque (os mesmos do RM2 Notas)
export const CATS = [
  { id: '', label: 'Geral', sym: '', color: '#FFE36E', callout: 'quote' },
  { id: 'importante', label: 'Importante', sym: '!', color: '#FFB866', callout: 'important' },
  { id: 'duvida', label: 'Dúvida', sym: '?', color: '#9CCBFA', callout: 'question' },
  { id: 'citar', label: 'Citar', sym: 'C', color: '#A6E3A1', callout: 'quote' },
  { id: 'parametro', label: 'Parâmetro', sym: '#', color: '#D4BCF5', callout: 'example' },
];
export function catInfo(id) { return CATS.find(c => c.id === (id || '')) || CATS[0]; }

export const INK_COLORS = ['#16191D', '#1D5A8A', '#B4232C', '#2F7D45', '#8A4FBF'];
