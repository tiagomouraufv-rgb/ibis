// Cadernos: páginas com modelos, caneta, caixas de texto (Markdown + LaTeX), imagens, áudio.
import * as S from './store.js';
import { db } from './db.js';
import { h, clear, btn, icon, toast, uid, safeName, popMenu } from './util.js';
import { renderMarkdown, numberAll, markdownForObsidian, toggleTask } from './md.js';
import { strokePath, strokeWidth } from './viewer.js';
import { MdEditBase, inMathAt } from './mdedit.js';

export const TEMPLATES = [['blank', 'Em branco'], ['lined', 'Pautada'], ['grid', 'Quadriculada'], ['dots', 'Pontilhada'], ['cornell', 'Cornell']];
const A4 = { w: 595.28, h: 841.89 };
export const TEXT_SIZE = 11;   // tamanho base do texto (pontos), escala junto com o zoom

export function isNotebook(doc) { return doc && doc.kind === 'notebook'; }

export function newPage(tpl = 'lined', w = A4.w, h = A4.h) { return { id: uid(''), tpl, w, h }; }

// cores da capa (estilo caderno de capa marmorizada, tipo "composition book")
export const COVER_COLORS = [['#1b1b1d', 'Preto'], ['#1f3f7a', 'Azul'], ['#8e1f24', 'Vermelho'], ['#1f5a3a', 'Verde'], ['#4b2a6b', 'Roxo'], ['#6b4226', 'Marrom'], ['#a87a12', 'Mostarda'], ['#4a5058', 'Cinza']];
export function coverPage() { const p = newPage('cover'); return p; }

export async function createNotebook(name, tpl = 'lined', coverColor = '#1b1b1d') {
  const pages = coverColor ? [coverPage(), newPage(tpl)] : [newPage(tpl)];
  const doc = {
    id: uid('d'), kind: 'notebook', name: name || 'Caderno', added: Date.now(), opened: 0,
    lastKey: '', lastY: 0, meta: {}, projects: [], bookmarks: [], blanks: [], margins: {}, briefing: '',
    pages, tpl, coverColor: coverColor || '',
  };
  doc.lastKey = 'n' + doc.pages[doc.pages.length - 1].id;
  await S.saveDoc(doc);
  return doc;
}

// lista de páginas no formato do visualizador
export function nbPageList(doc) {
  let n = 0;
  return (doc.pages || []).map((p, i) => {
    const cover = p.tpl === 'cover';
    if (!cover) n++;
    return { key: 'n' + p.id, kind: 'nb', id: p.id, tpl: p.tpl, w: p.w, h: p.h, index: i, n: cover ? 0 : n, label: cover ? 'Capa' : String(n) };
  });
}
export function nbPageLabel(doc, key) {
  const p = nbPageList(doc).find(x => x.key === key);
  return p ? (p.n ? 'p. ' + p.n : 'capa') : 'página do caderno';
}

// muda a cor da capa; se o caderno não tem capa, cria uma no começo
export async function setCover(doc, color) {
  if (!color) {
    const i = doc.pages.findIndex(p => p.tpl === 'cover');
    if (i >= 0) { await deletePage(doc, i); }
    doc.coverColor = '';
    await S.saveDoc(doc);
    return;
  }
  doc.coverColor = color;
  if (!doc.pages.some(p => p.tpl === 'cover')) doc.pages.unshift(coverPage());
  await S.saveDoc(doc);
}

// ---------- desenho da capa ----------
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seedOf(s) { let x = 7; for (const c of String(s)) x = (Math.imul(x, 31) + c.charCodeAt(0)) | 0; return x; }
function mix(hex, to, k) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = sh => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k);
  return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
}
export function drawCover(ctx, p, doc) {
  const col = (doc && doc.coverColor) || '#1b1b1d';
  const R = mulberry(seedOf((doc && doc.id) || 'x'));
  const W = p.w, H = p.h;
  ctx.save();
  ctx.fillStyle = col; ctx.fillRect(0, 0, W, H);
  // marmorizado: manchas claras irregulares e, por cima, rachaduras na cor da capa
  const flake = (x, y, r, fill) => {
    const n = 5 + Math.floor(R() * 4); const rot = R() * 6.28;
    ctx.beginPath();
    for (let k = 0; k < n; k++) { const ang = rot + k * 6.283 / n; const rr = r * (0.45 + R() * 0.8); const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  const light = mix(col, '#ffffff', 0.9), light2 = mix(col, '#ffffff', 0.6);
  for (let i = 0; i < 5200; i++) flake(R() * W, R() * H, 0.9 + Math.pow(R(), 2.6) * 6.5, i % 4 ? light : light2);
  for (let i = 0; i < 4200; i++) flake(R() * W, R() * H, 0.5 + Math.pow(R(), 2.2) * 3.2, col);
  for (let i = 0; i < 1800; i++) flake(R() * W, R() * H, 0.4 + R() * 1.3, light);
  // lombada
  const sw = W * 0.095;
  ctx.fillStyle = mix(col, '#000000', 0.45); ctx.fillRect(0, 0, sw, H);
  ctx.globalAlpha = 0.12; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.5;
  for (let y = 2; y < H; y += 3) { ctx.beginPath(); ctx.moveTo(0, y + R()); ctx.lineTo(sw, y + R()); ctx.stroke(); }
  ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(sw, 0, 1.2, H);
  // etiqueta
  const lx = W * 0.27, ly = H * 0.12, lw = W * 0.58, lh = H * 0.17, rad = 12;
  const rr = (x, y, w, hh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1.5;
  rr(lx, ly, lw, lh, rad); ctx.fillStyle = '#fbfaf6'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#2a2a2a'; ctx.stroke();
  rr(lx + 5, ly + 5, lw - 10, lh - 10, rad - 4); ctx.lineWidth = 0.6; ctx.stroke();
  ctx.fillStyle = '#4a4a4a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '600 8.5px "IBM Plex Sans", Arial, sans-serif';
  ctx.fillText('C A D E R N O', lx + lw / 2, ly + 22);
  ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(lx + 18, ly + 28); ctx.lineTo(lx + lw - 18, ly + 28); ctx.stroke();
  // título: até 3 linhas, o maior tamanho que couber
  const title = (doc && doc.name) || 'Caderno';
  let size = 26, lines = [];
  const wrap = sz => { ctx.font = '600 ' + sz + 'px "Source Serif 4", Georgia, serif'; const out = []; let cur = ''; for (const w of title.split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > lw - 36 && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; };
  for (; size >= 11; size -= 1) { lines = wrap(size); if (lines.length <= 3 && lines.every(l => ctx.measureText(l).width <= lw - 36) && lines.length * size * 1.15 <= lh - 52) break; }
  ctx.fillStyle = '#16191D';
  const y0 = ly + 28 + (lh - 28 - 22 - lines.length * size * 1.15) / 2 + size;
  lines.forEach((l, i) => ctx.fillText(l, lx + lw / 2, y0 + i * size * 1.15, lw - 30));
  ctx.beginPath(); ctx.moveTo(lx + 18, ly + lh - 20); ctx.lineTo(lx + lw - 18, ly + lh - 20); ctx.stroke();
  ctx.font = '8px "IBM Plex Sans", Arial, sans-serif'; ctx.fillStyle = '#6a6a6a';
  ctx.fillText(new Date((doc && doc.added) || Date.now()).toLocaleDateString('pt-BR'), lx + lw / 2, ly + lh - 9);
  ctx.restore();
}
const coverCache = new Map();
export function coverUrl(doc, p, k = 1.6) {
  const key = [doc.id, doc.coverColor, doc.name, p.w, p.h, k].join('|');
  if (coverCache.has(key)) return coverCache.get(key);
  const c = document.createElement('canvas'); c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
  const ctx = c.getContext('2d'); ctx.scale(k, k); drawCover(ctx, p, doc);
  const u = c.toDataURL('image/jpeg', 0.88);
  coverCache.set(key, u);
  return u;
}

export async function addPage(doc, index, tpl) {
  const ref = doc.pages[Math.max(0, Math.min(doc.pages.length - 1, index))] || {};
  const p = newPage(tpl || (ref.tpl !== 'cover' && ref.tpl) || doc.tpl || 'lined', ref.w || A4.w, ref.h || A4.h);
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
  // GIF fica como está (para continuar animado)
  if (blob.type !== 'image/gif' && (Math.max(w, hh) > MAX || !/png|jpe?g|gif|webp/.test(blob.type))) {
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
export class TextEditor extends MdEditBase {
  constructor(reader) { super(); this.reader = reader; this.cur = null; this._bar = null; this.idleHint = 'Toque na página (ferramenta Texto) para criar ou editar uma caixa.'; }

  get active() { return !!this.cur; }
  // barra de formatação: fica no topo da tela, ao lado do título, enquanto a ferramenta Texto está ativa
  get bar() { if (!this._bar) this._bar = this.toolbar(); return this._bar; }

  open(v, a, el) {
    if (this.cur) this.close();
    const ta = h('textarea.tbox-edit', { spellcheck: true, 'aria-label': 'Texto (Markdown)' });
    ta.value = a.md || '';
    const prev = h('div.tbox-prev.md');
    const wrap = h('div.tbox-editwrap', ta, prev);
    el.classList.add('editing');
    clear(el); el.appendChild(wrap);
    const bar = this.bar;
    // alças para mudar a largura da caixa (arraste as bordas)
    for (const side of ['l', 'r']) {
      const hd = h('div.tbox-handle.' + side, { title: 'Arraste para mudar a largura' });
      hd.addEventListener('pointerdown', e => this.dragWidth(e, side));
      el.appendChild(hd);
    }
    // alça para mover a caixa (arraste a barrinha no alto)
    const mv = h('div.tbox-move', { title: 'Arraste para mover a caixa', role: 'button', 'aria-label': 'Mover a caixa' }, '⠿ mover');
    mv.addEventListener('pointerdown', e => this.dragMove(e));
    el.appendChild(mv);
    this.cur = { v, a, el, ta, prev, bar, showPrev: false };
    this.reader.showTextBar && this.reader.showTextBar();
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
      if (wrap.contains(e.target) || bar.contains(e.target) || (e.target.closest && e.target.closest('.popmenu, .modal-back, .tbox-handle, .tbox-move, .mathpal, .toolpanel, .rtop'))) return;
      this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
    grow();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
  }

  toolbar() {
    const b = (...a) => this.btn(...a);
    return h('div.fmtbar', { role: 'toolbar', 'aria-label': 'Formatação' },
      b('½', 'Caixa com metade da largura da página', () => this.setWidth('half')),
      b('↔', 'Caixa com a largura toda da página', () => this.setWidth('full')),
      h('span.fsep'),
      ...this.commonButtons(),
      h('span.fsep'),
      b('Σ', 'Mostrar/esconder os símbolos de matemática', () => this.reader.toggleMathPal && this.reader.toggleMathPal(), '.toggle'),
      b('Prévia', 'Mostrar como fica enquanto digita', () => this.togglePrev()),
      b('Concluir', 'Concluir edição', () => this.close(), '.done'));
  }

  // fontes para numerar/citar equações: todas as caixas do caderno, em ordem de leitura
  async sources() {
    const { v, a, ta } = this.cur;
    let anns = (await S.annots(v.doc.id)).filter(x => x.kind === 'tbox');
    if (!anns.some(x => x.id === a.id)) anns = anns.concat([a]);
    return readingOrder(v.doc, anns).map(x => ({ id: x.id, md: x.id === a.id ? ta.value : (x.md || '') }));
  }
  isCurrent(id) { return this.cur && this.cur.a.id === id; }
  async setSource(id, md) {
    const x = (await S.annots(this.cur.v.doc.id)).find(q => q.id === id);
    if (x) { x.md = md; await S.putAnnot(x); }
  }

  // largura da caixa: metade ou página inteira (margens de 36 pt)
  setWidth(mode) {
    const { v, a, el } = this.cur;
    const p = v.pages.find(q => q.key === a.pageKey); if (!p) return;
    const M = 36, full = p.w - 2 * M;
    if (mode === 'full') { a.x = M; a.w = full; }
    else { a.w = Math.round(full / 2); if (a.x + a.w > p.w - M) a.x = Math.max(M, p.w - M - a.w); }
    this.applyBox();
    this.cur.ta.focus();
  }
  applyBox() {
    const { a, el } = this.cur;
    el.style.left = `calc(var(--s) * ${a.x}px)`; el.style.width = `calc(var(--s) * ${a.w}px)`;
  }
  dragWidth(e, side) {
    if (!this.cur) return;
    e.preventDefault(); e.stopPropagation();
    const { v, a } = this.cur;
    const p = v.pages.find(q => q.key === a.pageKey);
    const t = e.currentTarget;
    try { t.setPointerCapture(e.pointerId); } catch (er) {}
    const x0 = a.x, w0 = a.w, cx = e.clientX;
    const mv = ev => {
      const d = (ev.clientX - cx) / v.scale;
      if (side === 'r') a.w = Math.max(60, Math.min(p.w - a.x - 2, w0 + d));
      else { const nx = Math.max(2, Math.min(x0 + w0 - 60, x0 + d)); a.w = w0 - (nx - x0); a.x = nx; }
      this.applyBox();
    };
    const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); if (this.cur) this.cur.ta.focus(); };
    t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
  }

  dragMove(e) {
    if (!this.cur) return;
    e.preventDefault(); e.stopPropagation();
    const { v, a, el } = this.cur;
    const p = v.pages.find(q => q.key === a.pageKey);
    const t = e.currentTarget;
    try { t.setPointerCapture(e.pointerId); } catch (er) {}
    const x0 = a.x, y0 = a.y, cx = e.clientX, cy = e.clientY;
    const k = (v.k ? v.k(v.slots.get(a.pageKey)) : v.scale);
    const move = ev => {
      a.x = Math.max(0, Math.min(p.w - 40, x0 + (ev.clientX - cx) / k));
      a.y = Math.max(0, Math.min(p.h - 20, y0 + (ev.clientY - cy) / k));
      el.style.left = `calc(var(--s) * ${a.x}px)`; el.style.top = `calc(var(--s) * ${a.y}px)`;
    };
    const up = () => { t.removeEventListener('pointermove', move); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); if (this.cur) this.cur.ta.focus(); };
    t.addEventListener('pointermove', move); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
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
    c.el.classList.remove('editing');
    c.el.querySelectorAll('.tbox-handle, .tbox-move').forEach(x => x.remove());
    this.reader.showTextBar && this.reader.showTextBar();
    const md = c.ta.value.replace(/\s+$/, '');
    if (!md.trim()) { if (c.a.id && (await S.annots(c.a.docId)).some(x => x.id === c.a.id)) await S.delAnnot(c.a); else c.v.redrawOverlays(c.a.pageKey); return; }
    c.a.md = md;
    await S.putAnnot(c.a);
  }
}

export { inMathAt };

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
  if (opts.template) { if (page.tpl === 'cover') drawCover(ctx, page, doc); else drawTemplate(ctx, page); }
  for (const a of items.filter(x => x.kind === 'img')) {
    try {
      const img = await loadImg(await fileUrl(a.fileId));
      if (a.rot) { ctx.save(); ctx.translate(a.x + a.w / 2, a.y + a.h / 2); ctx.rotate(a.rot * Math.PI / 180); ctx.drawImage(img, -a.w / 2, -a.h / 2, a.w, a.h); ctx.restore(); }
      else ctx.drawImage(img, a.x, a.y, a.w, a.h);
    } catch (e) {}
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

const BOX_CSS = `.r{display:flow-root;font-family:'Source Serif 4',Georgia,serif;font-size:${TEXT_SIZE}px;line-height:1.45;color:#16191D;word-wrap:break-word}
.r h1{font-size:1.6em;margin:.3em 0}.r h2{font-size:1.35em;margin:.3em 0}.r h3{font-size:1.15em;margin:.3em 0}.r p{margin:.35em 0}
.r ul,.r ol{margin:.3em 0;padding-left:1.4em}.r blockquote{margin:.4em 0;padding-left:.8em;border-left:3px solid #9AA3AD;color:#3A4048}
.r code{font-family:monospace;background:#eef0f2;padding:0 .2em;border-radius:3px}.r mark{background:#FFE36E}
.r li:has(> input[type=checkbox]){list-style:none;margin-left:-1.2em}.r input[type=checkbox]{width:1em;height:1em;margin:0 .35em 0 0}.r table{border-collapse:collapse}.r td,.r th{border:1px solid #c9ced4;padding:2px 6px}.r .katex-display{margin:.5em 0}`;

// devolve { png: Uint8Array, h } com a caixa desenhada na largura w (pontos)
export async function rasterBox(html, w, k = 3, opts = {}) {
  const css = await katexCss();
  const holder = h('div', { style: { position: 'fixed', left: '-10000px', top: '0', width: w + 'px' } });
  const inner = h('div.r', { html });
  const st = h('style'); st.textContent = BOX_CSS;
  holder.append(st, inner);
  document.body.appendChild(holder);
  const hgt = Math.ceil(inner.getBoundingClientRect().height) + 4;
  const words = opts.words ? measureWords(inner) : null;
  const xhtml = new XMLSerializer().serializeToString(inner);
  holder.remove();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * k}" height="${hgt * k}"><foreignObject width="${w}" height="${hgt}" transform="scale(${k})"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}\n${BOX_CSS}</style>${xhtml}</div></foreignObject></svg>`;
  const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = document.createElement('canvas'); c.width = Math.ceil(w * k); c.height = Math.ceil(hgt * k);
  c.getContext('2d').drawImage(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { png: new Uint8Array(await blob.arrayBuffer()), h: hgt, words };
}

// posição de cada palavra (fora das fórmulas), relativa à caixa: serve para a camada de texto invisível do PDF
// (para dar para selecionar, buscar e destacar o texto no reMarkable e em outros leitores)
function measureWords(root) {
  const base = root.getBoundingClientRect();
  const out = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('.katex, svg, style, script')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const rg = document.createRange();
  let n;
  while ((n = tw.nextNode())) {
    const t = n.nodeValue; if (!t || !t.trim()) continue;
    const cs = getComputedStyle(n.parentElement);
    const fs = parseFloat(cs.fontSize) || 14;
    const mono = /mono|courier/i.test(cs.fontFamily);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
    const re = /\S+/g; let m;
    while ((m = re.exec(t))) {
      rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const rs = rg.getClientRects(); if (!rs.length) continue;
      const r = rs[0];
      if (r.width <= 0) continue;
      out.push({ t: m[0], x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, fs, mono, bold });
    }
  }
  return out;
}

// ---------- exportar caderno em PDF ----------
export async function notebookPdf(doc) {
  const { PDFDocument, rgb, LineCapStyle, BlendMode, StandardFonts, degrees } = await import('../vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.name); pdf.setCreator('Leitor de Pesquisa');
  const anns = await S.annots(doc.id);
  const num = numbering(doc, anns);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const hex = c => { const n = parseInt(c.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  for (const p of doc.pages) {
    const page = pdf.addPage([p.w, p.h]);
    const H = p.h;
    if (p.tpl === 'cover') {
      try { const u = coverUrl(doc, p, 2.2); const im = await pdf.embedJpg(Uint8Array.from(atob(u.split(',')[1]), ch => ch.charCodeAt(0))); page.drawImage(im, { x: 0, y: 0, width: p.w, height: p.h }); } catch (e) { console.warn('capa', e); }
    }
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
        if (a.rot) {
          // pdf-lib gira em torno do canto de baixo à esquerda (sentido anti-horário)
          const phi = -a.rot * Math.PI / 180, cx = a.x + a.w / 2, cy = H - a.y - a.h / 2;
          const bx = cx + (-a.w / 2) * Math.cos(phi) - (-a.h / 2) * Math.sin(phi), by = cy + (-a.w / 2) * Math.sin(phi) + (-a.h / 2) * Math.cos(phi);
          page.drawImage(im, { x: bx, y: by, width: a.w, height: a.h, rotate: degrees(-a.rot) });
        } else page.drawImage(im, { x: a.x, y: H - a.y - a.h, width: a.w, height: a.h });
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
    if (p.tpl === 'cover' && !mine.length) continue;
    if (doc.pages.length > 1) lines.push('## ' + (p.tpl === 'cover' ? 'Capa' : 'Página ' + nbPageList(doc)[i].n), '');
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
