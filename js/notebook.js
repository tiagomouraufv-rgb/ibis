// Cadernos: páginas com modelos, caneta, caixas de texto (Markdown + LaTeX), imagens, áudio.
import * as S from './store.js';
import { db } from './db.js';
import { h, clear, btn, icon, toast, uid, safeName, popMenu } from './util.js';
import { renderMarkdown, numberAll, markdownForObsidian, toggleTask } from './md.js';
import { strokePath, strokeWidth } from './viewer.js';

export const TEMPLATES = [['blank', 'Em branco'], ['lined', 'Pautada'], ['grid', 'Quadriculada'], ['dots', 'Pontilhada'], ['cornell', 'Cornell']];
const A4 = { w: 595.28, h: 841.89 };
export const TEXT_SIZE = 11;   // tamanho base do texto (pontos), escala junto com o zoom

export function isNotebook(doc) { return doc && doc.kind === 'notebook'; }

export function newPage(tpl = 'lined', w = A4.w, h = A4.h) { return { id: uid(''), tpl, w, h }; }

export async function createNotebook(name, tpl = 'lined') {
  const doc = {
    id: uid('d'), kind: 'notebook', name: name || 'Caderno', added: Date.now(), opened: 0,
    lastKey: '', lastY: 0, meta: {}, projects: [], bookmarks: [], blanks: [], margins: {}, briefing: '',
    pages: [newPage(tpl)], tpl,
  };
  doc.lastKey = 'n' + doc.pages[0].id;
  await S.saveDoc(doc);
  return doc;
}

// lista de páginas no formato do visualizador
export function nbPageList(doc) {
  return (doc.pages || []).map((p, i) => ({ key: 'n' + p.id, kind: 'nb', id: p.id, tpl: p.tpl, w: p.w, h: p.h, index: i, n: i + 1, label: String(i + 1) }));
}

export async function addPage(doc, index, tpl) {
  const ref = doc.pages[Math.max(0, Math.min(doc.pages.length - 1, index))] || {};
  const p = newPage(tpl || ref.tpl || doc.tpl || 'lined', ref.w || A4.w, ref.h || A4.h);
  doc.pages.splice(index + 1, 0, p);
  await S.saveDoc(doc);
  return p;
}

export async function duplicatePage(doc, index) {
  const src = doc.pages[index];
  const p = newPage(src.tpl, src.w, src.h);
  doc.pages.splice(index + 1, 0, p);
  await S.saveDoc(doc);
  for (const a of (await S.annots(doc.id)).filter(x => x.pageKey === 'n' + src.id)) {
    const c = JSON.parse(JSON.stringify(a)); c.id = uid('a'); c.pageKey = 'n' + p.id; delete c.rec;
    await S.putAnnot(c, { noUndo: true });
  }
  return p;
}

export async function deletePage(doc, index) {
  const p = doc.pages[index];
  const anns = (await S.annots(doc.id)).filter(x => x.pageKey === 'n' + p.id);
  await S.delAnnots(anns);
  doc.pages.splice(index, 1);
  if (!doc.pages.length) doc.pages.push(newPage(doc.tpl || 'lined'));
  doc.bookmarks = (doc.bookmarks || []).filter(b => b.key !== 'n' + p.id);
  await S.saveDoc(doc);
}

export async function movePage(doc, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= doc.pages.length) return false;
  const [p] = doc.pages.splice(index, 1);
  doc.pages.splice(j, 0, p);
  await S.saveDoc(doc);
  return true;
}

export async function setTemplate(doc, index, tpl) { doc.pages[index].tpl = tpl; await S.saveDoc(doc); }

// ordem de leitura: página, depois de cima para baixo, depois da esquerda para a direita
export function readingOrder(doc, anns) {
  const pidx = {};
  (doc.pages || []).forEach((p, i) => { pidx['n' + p.id] = i; });
  return anns.slice().sort((a, b) => ((pidx[a.pageKey] ?? 1e9) - (pidx[b.pageKey] ?? 1e9)) || ((a.y || 0) - (b.y || 0)) || ((a.x || 0) - (b.x || 0)));
}

export function numbering(doc, anns) {
  const boxes = readingOrder(doc, anns.filter(a => a.kind === 'tbox'));
  return numberAll(boxes.map(b => ({ id: b.id, md: b.md })));
}

// ---------- imagens ----------
const urlCache = new Map();
export async function fileUrl(fileId) {
  if (urlCache.has(fileId)) return urlCache.get(fileId);
  const b = await S.audioBlob(fileId);
  if (!b) return '';
  const u = URL.createObjectURL(b);
  urlCache.set(fileId, u);
  return u;
}
export function fileUrlSync(fileId) { return urlCache.get(fileId) || ''; }

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida.')); i.src = src; });
}

// guarda a imagem no aparelho (reduz se for enorme) e devolve {fileId, w, h} em pixels
export async function storeImage(blob) {
  if (!blob || !/^image\//.test(blob.type)) throw new Error('O arquivo não é uma imagem.');
  const u = URL.createObjectURL(blob);
  let img;
  try { img = await loadImg(u); } finally { URL.revokeObjectURL(u); }
  let w = img.naturalWidth, hh = img.naturalHeight;
  let out = blob;
  const MAX = 2400;
  if (Math.max(w, hh) > MAX || !/png|jpe?g|gif|webp/.test(blob.type)) {
    const k = Math.min(1, MAX / Math.max(w, hh));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = await new Promise(r => c.toBlob(r, blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9));
    w = c.width; hh = c.height;
  }
  const fileId = uid('im');
  await db.put('files', { id: fileId, blob: out });
  return { fileId, w, h: hh, type: out.type };
}

export async function clipboardImage() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) return null;
    const items = await navigator.clipboard.read();
    for (const it of items) for (const t of it.types) if (t.startsWith('image/')) return await it.getType(t);
  } catch (e) { /* sem permissão ou vazio */ }
  return null;
}

export function pickImageFile() {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
    document.body.appendChild(inp); inp.click();
  });
}

// insere imagem numa página do caderno, centralizada em (cx, cy)
export async function insertImage(doc, pageKey, blob, cx, cy, pageW) {
  const im = await storeImage(blob);
  const maxW = pageW * 0.6;
  const w = Math.min(maxW, im.w * 0.75);
  const hh = w * im.h / im.w;
  const a = { kind: 'img', docId: doc.id, pageKey, fileId: im.fileId, x: Math.max(10, cx - w / 2), y: Math.max(10, cy - hh / 2), w, h: hh };
  await S.putAnnot(a);
  return a;
}

// ---------- caixas de texto ----------
export function renderBoxHtml(a, num) {
  return renderMarkdown(a.md || '', (num && num.starts[a.id]) || 0, (num && num.labels) || {});
}

// Editor de texto dentro da página (Markdown + LaTeX), com barra de formatação
export class TextEditor {
  constructor(reader) { this.reader = reader; this.cur = null; }

  get active() { return !!this.cur; }

  open(v, a, el) {
    if (this.cur) this.close();
    const ta = h('textarea.tbox-edit', { spellcheck: true, 'aria-label': 'Texto (Markdown)' });
    ta.value = a.md || '';
    const prev = h('div.tbox-prev.md');
    const wrap = h('div.tbox-editwrap', ta, prev);
    el.classList.add('editing');
    clear(el); el.appendChild(wrap);
    const bar = this.toolbar(ta, prev);
    document.body.appendChild(bar);
    this.cur = { v, a, el, ta, prev, bar, showPrev: false };
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 40) + 'px'; };
    ta.addEventListener('input', () => { grow(); if (this.cur && this.cur.showPrev) this.updatePrev(); });
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); this.wrapSel('**', '**'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); this.wrapSel('*', '*'); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      if (e.key === 'Tab') { e.preventDefault(); this.insert('  '); }
    });
    ta.addEventListener('paste', async e => {
      const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(x => x.type.startsWith('image/'));
      if (!it) return;
      e.preventDefault();
      const blob = it.getAsFile();
      const p = v.pages.find(q => q.key === a.pageKey);
      const r = el.getBoundingClientRect();
      const im = await insertImage(v.doc, a.pageKey, blob, a.x + a.w / 2, a.y + r.height / v.scale + 80, p.w);
      toast('Imagem colada abaixo da caixa.'); void im;
    });
    this.outside = e => {
      if (!this.cur) return;
      if (wrap.contains(e.target) || bar.contains(e.target) || (e.target.closest && e.target.closest('.popmenu, .modal-back, .tbox-handle'))) return;
      this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
    grow();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
  }

  toolbar(ta, prev) {
    const b = (label, title, fn, cls = '') => h('button.fmt' + cls, { type: 'button', title, 'aria-label': title, onpointerdown: e => e.preventDefault(), onclick: fn }, label);
    return h('div.fmtbar', { role: 'toolbar', 'aria-label': 'Formatação' },
      b('H1', 'Título 1', () => this.linePrefix('# ')),
      b('H2', 'Título 2', () => this.linePrefix('## ')),
      b('H3', 'Título 3', () => this.linePrefix('### ')),
      h('span.fsep'),
      b('B', 'Negrito (Ctrl+B)', () => this.wrapSel('**', '**'), '.bold'),
      b('I', 'Itálico (Ctrl+I)', () => this.wrapSel('*', '*'), '.ital'),
      b('Realce', 'Realce ==texto==', () => this.wrapSel('==', '==')),
      h('span.fsep'),
      b('• Lista', 'Lista', () => this.linePrefix('- ')),
      b('☐ Tarefa', 'Lista de tarefas', () => this.linePrefix('- [ ] ')),
      b('❝', 'Citação', () => this.linePrefix('> ')),
      b('</>', 'Código', () => this.wrapSel('`', '`')),
      h('span.fsep'),
      b('$x$', 'Equação no texto', () => this.wrapSel('$', '$')),
      b('$$', 'Equação destacada', () => this.block('$$\n', '\n$$')),
      b('(n)', 'Equação numerada (\\eqn)', () => this.block('$$\n', '\n\\eqn\n$$')),
      b('ref', 'Citar equação numerada (\\eqref)', e => this.refMenu(e)),
      h('span.fsep'),
      b('Prévia', 'Mostrar como fica enquanto digita', () => this.togglePrev()),
      b('Concluir', 'Concluir edição', () => this.close(), '.done'));
  }

  wrapSel(a, z) {
    const ta = this.cur.ta; const s = ta.selectionStart, e = ta.selectionEnd;
    const t = ta.value.slice(s, e) || '';
    ta.setRangeText(a + t + z, s, e, 'end');
    if (!t) ta.setSelectionRange(s + a.length, s + a.length);
    ta.dispatchEvent(new Event('input')); ta.focus();
  }
  insert(t) { const ta = this.cur.ta; ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); ta.focus(); }
  block(a, z) {
    const ta = this.cur.ta; const s = ta.selectionStart, e = ta.selectionEnd;
    const before = ta.value.slice(0, s);
    const pre = before && !before.endsWith('\n') ? '\n' : '';
    const t = ta.value.slice(s, e);
    ta.setRangeText(pre + a + t + z + '\n', s, e, 'end');
    const pos = s + pre.length + a.length + t.length;
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input')); ta.focus();
  }
  linePrefix(p) {
    const ta = this.cur.ta; const s = ta.selectionStart;
    const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
    const line = ta.value.slice(ls).split('\n')[0];
    if (line.startsWith(p)) ta.setRangeText('', ls, ls + p.length, 'end');
    else ta.setRangeText(p, ls, ls, 'end');
    ta.dispatchEvent(new Event('input')); ta.focus();
  }
  async refMenu(e) {
    const { v } = this.cur;
    const anns = await S.annots(v.doc.id);
    const labels = Object.keys(numbering(v.doc, anns).labels);
    const r = e.currentTarget.getBoundingClientRect();
    if (!labels.length) { toast('Nenhuma equação com nome. Escreva \\label{nome} dentro de uma equação numerada.', 4500); return; }
    popMenu(r.left, r.bottom + 4, labels.map(l => ({ label: l, onclick: () => this.insert('\\eqref{' + l + '}') })));
  }
  togglePrev() { this.cur.showPrev = !this.cur.showPrev; this.cur.prev.style.display = this.cur.showPrev ? 'block' : 'none'; if (this.cur.showPrev) this.updatePrev(); }
  async updatePrev() {
    const { v, a, ta, prev } = this.cur;
    const anns = await S.annots(v.doc.id);
    const list = anns.some(x => x.id === a.id) ? anns.map(x => x.id === a.id ? Object.assign({}, x, { md: ta.value }) : x) : anns.concat([Object.assign({}, a, { md: ta.value })]);
    const num = numbering(v.doc, list);
    prev.innerHTML = renderMarkdown(ta.value, num.starts[a.id] || 0, num.labels);
  }

  async close() {
    const c = this.cur; if (!c) return;
    this.cur = null;
    document.removeEventListener('pointerdown', this.outside, true);
    c.bar.remove();
    c.el.classList.remove('editing');
    const md = c.ta.value.replace(/\s+$/, '');
    if (!md.trim()) { if (c.a.id && (await S.annots(c.a.docId)).some(x => x.id === c.a.id)) await S.delAnnot(c.a); else c.v.redrawOverlays(c.a.pageKey); return; }
    c.a.md = md;
    await S.putAnnot(c.a);
  }
}

export function onTaskClick(a, idx) { a.md = toggleTask(a.md || '', idx); return S.putAnnot(a); }

// ---------- desenho da página em imagem (capa, Obsidian) ----------
export async function rasterPage(doc, page, anns, opts = {}) {
  const k = opts.scale || 2;
  const items = anns.filter(a => a.pageKey === 'n' + page.id && (a.kind === 'ink' || (opts.images !== false && a.kind === 'img')));
  let bb = [0, 0, page.w, page.h];
  if (opts.crop) {
    if (!items.length) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const a of items) {
      if (a.kind === 'ink') for (const p of a.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      else { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h); }
    }
    const pad = 12;
    bb = [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(page.w * 1.5, x1 + pad) - Math.max(0, x0 - pad), Math.min(page.h, y1 + pad) - Math.max(0, y0 - pad)];
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bb[2] * k)); c.height = Math.max(1, Math.round(bb[3] * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(k, k); ctx.translate(-bb[0], -bb[1]);
  if (opts.template) drawTemplate(ctx, page);
  for (const a of items.filter(x => x.kind === 'img')) {
    try { const img = await loadImg(await fileUrl(a.fileId)); ctx.drawImage(img, a.x, a.y, a.w, a.h); } catch (e) {}
  }
  for (const a of items.filter(x => x.kind === 'ink')) {
    ctx.save();
    ctx.strokeStyle = a.color; ctx.lineWidth = strokeWidth(a); ctx.lineCap = a.tool === 'marker' ? 'butt' : 'round'; ctx.lineJoin = 'round';
    if (a.tool === 'marker') { ctx.globalAlpha = 0.42; ctx.globalCompositeOperation = 'multiply'; }
    ctx.stroke(new Path2D(strokePath(a.pts)));
    ctx.restore();
  }
  return c;
}

function drawTemplate(ctx, p) {
  ctx.save();
  ctx.strokeStyle = '#d6dbe0'; ctx.fillStyle = '#c4cad1'; ctx.lineWidth = 0.6;
  if (p.tpl === 'lined' || p.tpl === 'cornell') { for (let y = 72; y < p.h - 30; y += 24) { ctx.beginPath(); ctx.moveTo(p.tpl === 'cornell' ? 0 : 36, y); ctx.lineTo(p.w - 36, y); ctx.stroke(); } }
  if (p.tpl === 'cornell') { ctx.beginPath(); ctx.moveTo(p.w * 0.3, 40); ctx.lineTo(p.w * 0.3, p.h * 0.8); ctx.moveTo(0, p.h * 0.8); ctx.lineTo(p.w, p.h * 0.8); ctx.stroke(); }
  if (p.tpl === 'grid') { for (let x = 0; x < p.w; x += 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, p.h); ctx.stroke(); } for (let y = 0; y < p.h; y += 18) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(p.w, y); ctx.stroke(); } }
  if (p.tpl === 'dots') { for (let x = 18; x < p.w; x += 18) for (let y = 18; y < p.h; y += 18) { ctx.beginPath(); ctx.arc(x, y, 0.9, 0, 6.3); ctx.fill(); } }
  ctx.restore();
}

export async function coverDataUrl(doc) {
  const anns = await S.annots(doc.id);
  const c = await rasterPage(doc, doc.pages[0], anns, { scale: 0.4, template: true });
  // texto da primeira página como linhas cinzas (resumo visual)
  return c.toDataURL('image/jpeg', 0.7);
}

// ---------- caixa de texto em imagem (para o PDF) ----------
let katexCssCache = null;
async function katexCss() {
  if (katexCssCache) return katexCssCache;
  const base = new URL('../vendor/katex/', import.meta.url);
  let css = await (await fetch(new URL('katex.min.css', base))).text();
  const urls = [...new Set((css.match(/url\(fonts\/[^)]+\.woff2\)/g) || []))];
  for (const u of urls) {
    const name = u.slice(4, -1);
    try {
      const b = new Uint8Array(await (await fetch(new URL(name, base))).arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      css = css.split(u).join('url(data:font/woff2;base64,' + btoa(s) + ')');
    } catch (e) {}
  }
  css = css.replace(/,url\(fonts\/[^)]+\.(woff|ttf)\) format\("(woff|truetype)"\)/g, '');
  katexCssCache = css;
  return css;
}

const BOX_CSS = `.r{font-family:'Source Serif 4',Georgia,serif;font-size:${TEXT_SIZE}px;line-height:1.45;color:#16191D;word-wrap:break-word}
.r h1{font-size:1.6em;margin:.3em 0}.r h2{font-size:1.35em;margin:.3em 0}.r h3{font-size:1.15em;margin:.3em 0}.r p{margin:.35em 0}
.r ul,.r ol{margin:.3em 0;padding-left:1.4em}.r blockquote{margin:.4em 0;padding-left:.8em;border-left:3px solid #9AA3AD;color:#3A4048}
.r code{font-family:monospace;background:#eef0f2;padding:0 .2em;border-radius:3px}.r mark{background:#FFE36E}
.r li:has(> input[type=checkbox]){list-style:none;margin-left:-1.2em}.r input[type=checkbox]{width:1em;height:1em;margin:0 .35em 0 0}.r table{border-collapse:collapse}.r td,.r th{border:1px solid #c9ced4;padding:2px 6px}.r .katex-display{margin:.5em 0}`;

// devolve { png: Uint8Array, h } com a caixa desenhada na largura w (pontos)
export async function rasterBox(html, w, k = 3) {
  const css = await katexCss();
  const holder = h('div', { style: { position: 'fixed', left: '-10000px', top: '0', width: w + 'px' } });
  const inner = h('div.r', { html });
  const st = h('style'); st.textContent = BOX_CSS;
  holder.append(st, inner);
  document.body.appendChild(holder);
  const hgt = Math.ceil(inner.getBoundingClientRect().height) + 4;
  const xhtml = new XMLSerializer().serializeToString(inner);
  holder.remove();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * k}" height="${hgt * k}"><foreignObject width="${w}" height="${hgt}" transform="scale(${k})"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}\n${BOX_CSS}</style>${xhtml}</div></foreignObject></svg>`;
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = document.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(hgt * k);
  c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { png: new Uint8Array(await blob.arrayBuffer()), h: hgt };
}

// ---------- exportar caderno em PDF ----------
export async function notebookPdf(doc) {
  const { PDFDocument, rgb, LineCapStyle, BlendMode, StandardFonts } = await import('../vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.name); pdf.setCreator('Leitor de Pesquisa');
  const anns = await S.annots(doc.id);
  const num = numbering(doc, anns);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const hex = c => { const n = parseInt(c.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  for (const p of doc.pages) {
    const page = pdf.addPage([p.w, p.h]);
    const H = p.h;
    // modelo
    const line = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: 0.5, color: rgb(0.84, 0.86, 0.88) });
    if (p.tpl === 'lined' || p.tpl === 'cornell') for (let y = 72; y < p.h - 30; y += 24) line(p.tpl === 'cornell' ? 0 : 36, y, p.w - 36, y);
    if (p.tpl === 'cornell') { line(p.w * 0.3, 40, p.w * 0.3, p.h * 0.8); line(0, p.h * 0.8, p.w, p.h * 0.8); }
    if (p.tpl === 'grid') { for (let x = 0; x < p.w; x += 18) line(x, 0, x, p.h); for (let y = 0; y < p.h; y += 18) line(0, y, p.w, y); }
    if (p.tpl === 'dots') for (let x = 18; x < p.w; x += 18) for (let y = 18; y < p.h; y += 18) page.drawCircle({ x, y: H - y, size: 0.8, color: rgb(0.77, 0.79, 0.82) });
    const mine = anns.filter(a => a.pageKey === 'n' + p.id);
    for (const a of mine.filter(x => x.kind === 'img')) {
      try {
        const b = await S.audioBlob(a.fileId);
        let bytes = new Uint8Array(await b.arrayBuffer());
        let im;
        if (/png/.test(b.type)) im = await pdf.embedPng(bytes);
        else if (/jpe?g/.test(b.type)) im = await pdf.embedJpg(bytes);
        else { const c = document.createElement('canvas'); const i = await loadImg(await fileUrl(a.fileId)); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); im = await pdf.embedPng(bytes); }
        page.drawImage(im, { x: a.x, y: H - a.y - a.h, width: a.w, height: a.h });
      } catch (e) { console.warn('imagem', e); }
    }
    for (const a of readingOrder(doc, mine.filter(x => x.kind === 'tbox'))) {
      try {
        const r = await rasterBox(renderBoxHtml(a, num), a.w);
        const im = await pdf.embedPng(r.png);
        page.drawImage(im, { x: a.x, y: H - a.y - r.h, width: a.w, height: r.h });
      } catch (e) {
        console.warn('texto', e);
        page.drawText((a.md || '').slice(0, 2000), { x: a.x, y: H - a.y - 12, size: 10, font, maxWidth: a.w, lineHeight: 13, color: rgb(0.1, 0.1, 0.1) });
      }
    }
    for (const a of mine.filter(x => x.kind === 'ink')) {
      if (!a.pts.length) continue;
      page.drawSvgPath(strokePath(a.pts), {
        x: 0, y: H, borderColor: hex(a.color), borderWidth: strokeWidth(a), borderLineCap: a.tool === 'marker' ? LineCapStyle.Butt : LineCapStyle.Round,
        borderOpacity: a.tool === 'marker' ? 0.42 : 1, blendMode: a.tool === 'marker' ? BlendMode.Multiply : undefined,
      });
    }
    for (const a of mine.filter(x => x.kind === 'note')) {
      page.drawCircle({ x: a.x, y: H - a.y, size: 7, color: rgb(0.11, 0.35, 0.54) });
      if (a.text) page.drawText(a.text.slice(0, 300), { x: a.x + 10, y: H - a.y - 3, size: 8, font, maxWidth: Math.max(80, p.w - a.x - 20), lineHeight: 10, color: rgb(0.11, 0.35, 0.54) });
      if (a.audioId) {
        const b = await S.audioBlob(a.audioId);
        if (b) await pdf.attach(new Uint8Array(await b.arrayBuffer()), 'nota-de-voz-p' + (doc.pages.indexOf(p) + 1) + '-' + a.id + '.webm', { mimeType: b.type || 'audio/webm', description: 'Nota de voz' });
      }
    }
  }
  return pdf.save();
}

// ---------- Obsidian ----------
export async function notebookObsidianFiles(doc, folder = 'Cadernos') {
  const anns = await S.annots(doc.id);
  const num = numbering(doc, anns);
  const name = safeName(doc.name);
  const files = {};
  const lines = ['---', 'tags:', '  - caderno', 'paginas: ' + doc.pages.length, '---', '# ' + doc.name, ''];
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i];
    const mine = anns.filter(a => a.pageKey === 'n' + p.id);
    if (doc.pages.length > 1) lines.push('## Página ' + (i + 1), '');
    for (const a of readingOrder(doc, mine.filter(x => x.kind === 'tbox' || x.kind === 'img' || x.kind === 'note'))) {
      if (a.kind === 'tbox') lines.push(markdownForObsidian(a.md || '', num.starts[a.id] || 0, num.labels), '');
      else if (a.kind === 'img') {
        const b = await S.audioBlob(a.fileId);
        if (b) { const fn = name + '-' + a.id + '.' + (/png/.test(b.type) ? 'png' : /jpe?g/.test(b.type) ? 'jpg' : 'png'); files[folder + '/Anexos/' + fn] = new Uint8Array(await b.arrayBuffer()); lines.push('![[' + fn + ']]', ''); }
      } else if (a.kind === 'note') {
        if (a.text) lines.push('> [!note] Nota', '> ' + a.text.replace(/\n/g, '\n> '), '');
        if (a.audioId) { const b = await S.audioBlob(a.audioId); if (b) { const fn = name + '-voz-' + a.id + '.webm'; files[folder + '/Anexos/' + fn] = new Uint8Array(await b.arrayBuffer()); lines.push('![[' + fn + ']]', ''); } }
      }
    }
    if (mine.some(a => a.kind === 'ink')) {
      const c = await rasterPage(doc, p, anns, { crop: true, images: false, scale: 2 });
      if (c) {
        const fn = name + '-p' + (i + 1) + '-escrita.png';
        files[folder + '/Anexos/' + fn] = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
        lines.push('![[' + fn + ']]', '');
      }
    }
  }
  files[folder + '/' + name + '.md'] = new TextEncoder().encode(lines.join('\n'));
  return files;
}

export { icon, btn };
