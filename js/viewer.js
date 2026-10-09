// Visualizador de PDF: páginas, zoom, escrita com a S Pen, seleção de texto e toques nas anotações.
import { pdfjs, openPdf, getPage, pageList, pageLinks } from './pdfdoc.js';
import * as S from './store.js';
import { h, clear, icon, catInfo, uid } from './util.js';
import { registerTextLayer, unregisterTextLayer } from './textsel.js';
import { hydrate } from './embeds.js';
import { nbPageList, isNotebook, fileUrl, fileUrlSync, renderBoxHtml, numbering, TEXT_SIZE, onTaskClick, coverUrl, readingOrder } from './notebook.js';
import { headings } from './md.js';
import { isEink, turnViewer, tapZone, swipeDir, freezeIfGif } from './eink.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const MARGIN_FRAC = 0.5;    // margem expandida = metade da largura da página
const GAP = 18;

function sv(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

export function strokePath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) { const [x, y] = pts[0]; return `M${x} ${y}l0.01 0`; }
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const l = pts[pts.length - 1];
  d += `L${l[0].toFixed(2)} ${l[1].toFixed(2)}`;
  return d;
}

export function strokeWidth(a) {
  if (a.tool === 'marker') return a.width;
  const ps = a.pts.map(p => p[2]).filter(p => p > 0);
  const avg = ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : 0.5;
  return a.width * (0.55 + 0.9 * avg);
}

export class Viewer {
  constructor(app, host) {
    this.app = app;
    this.el = h('div.pane');
    this.scroller = h('div.pane-scroll');
    this.pagesEl = h('div.pages');
    this.scroller.appendChild(this.pagesEl);
    this.el.appendChild(this.scroller);
    host.appendChild(this.el);
    this.doc = null; this.hd = null; this.pages = []; this.slots = new Map();
    this.zoom = 1; this.scale = 1; this.hist = [];
    this.penDown = false; this.pointers = new Map();
    this.bindInput();
    this.io = new IntersectionObserver(es => this.onIntersect(es), { root: this.scroller, rootMargin: '900px 0px' });
    this.ro = new ResizeObserver(() => { if (this.doc && Math.abs(this.lastWidth - this.scroller.clientWidth) > 4) this.relayout(true); });
    this.ro.observe(this.scroller);
    this.offAnn = S.on('annots', e => { if (this.doc && e.docId === this.doc.id) this.redrawOverlays(e.pageKey); });
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // celular/tablet/e-ink mudou (Fold aberto, Boox): refaz o modo e o encaixe da página
    this.offForm = S.on('form', () => { if (!this.doc) return; this.applyMode(); this.relayout(true); });
  }

  // e-ink: a página vira (não rola)
  get paged() { return isEink(); }
  turn(dir) {
    const ok = turnViewer(this, dir);
    if (ok) this.app.onNav && this.app.onNav(this);
    return ok;
  }
  // artigos em duas colunas: zoom numa coluna por vez, descendo a da esquerda e depois a da direita
  async setColumns(on) {
    if (!this.hd) return;
    const k = this.currentKey();
    this.columns = !!on;
    if (on && !this.cropBox) await this.setCrop(true);
    const W = this.scroller.clientWidth, avail = Math.max(200, W - 28);
    this.zoom = on ? (2 * W) / avail * 0.985 : 1;
    this.relayout(false);
    requestAnimationFrame(() => {
      const s = this.slots.get(k);
      if (!s) return;
      this.scroller.scrollTop = s.wrap.offsetTop;
      this.scroller.scrollLeft = on ? s.wrap.offsetLeft : 0;
    });
  }

  destroy() { this.offAnn(); this.offForm && this.offForm(); this.io.disconnect(); this.ro.disconnect(); this.el.remove(); }

  async open(doc, at) {
    this.cropBox = null;
    this.doc = doc;
    this.clearSelection();
    this.hd = isNotebook(doc) ? null : await openPdf(doc);
    this.anns = await S.annots(doc.id);
    this.pages = this.listPages();
    this.hist = [];
    this.build();
    let key = (at && at.key) || doc.lastKey || (this.pages[0] && this.pages[0].key);
    if (!this.slots.has(key)) key = this.pages[0] && this.pages[0].key;
    const y = at ? (at.y || 0) : (doc.lastY || 0);
    requestAnimationFrame(() => this.goTo(key, y, { noHist: true, exact: !at }));
    doc.opened = Date.now();
    S.saveDoc(doc);
  }

  // ---------- cortar as bordas (como na Boox): o texto ocupa a largura do painel ----------
  async setCrop(on) {
    on = !!on && !!this.hd;
    if (on === !!this.cropBox) return;
    const k = this.currentKey(), off = this.currentOffset();
    if (on) {
      const docId = this.doc.id;
      const box = cropCache.get(docId) || await detectCrop(this.hd);
      if (!this.doc || this.doc.id !== docId) return;
      cropCache.set(docId, box);
      this.cropBox = box;
    } else this.cropBox = null;
    this.scale = this.fitScale() * this.zoom;
    for (const sl of this.slots.values()) { this.sizeSlot(sl); sl.rendered = 0; }
    this.renderVisible();
    requestAnimationFrame(() => this.goTo(k, off, { noHist: true, exact: true }));
  }

  // reconstrói a lista (depois de inserir/remover página em branco)
  async refreshPages() {
    const k = this.currentKey();
    this.pages = this.listPages();
    this.build();
    this.goTo(this.slots.has(k) ? k : this.pages[0].key, 0, { noHist: true });
  }

  listPages() { return isNotebook(this.doc) ? nbPageList(this.doc) : pageList(this.doc, this.hd); }
  get isNb() { return isNotebook(this.doc); }

  fitScale() {
    const anyMargin = this.doc && this.doc.margins && Object.keys(this.doc.margins).some(k => this.doc.margins[k]);
    const maxW = Math.max(...this.pages.map(p => p.w * (this.cropBox && p.kind === 'pdf' ? this.cropBox[2] : 1)), 1) * (anyMargin ? 1 + MARGIN_FRAC : 1);
    const avail = Math.max(200, this.scroller.clientWidth - 28);
    // e-ink com "página inteira": a página cabe na altura da tela (sem rolar dentro dela)
    if (this.paged && (this.app.settings || {}).pageFit && !this.columns) {
      const maxH = Math.max(...this.pages.map(p => p.h * (this.cropBox && p.kind === 'pdf' ? this.cropBox[3] : 1)), 1);
      const availH = Math.max(200, this.scroller.clientHeight - 40);
      return Math.min(avail / maxW, availH / maxH);
    }
    return avail / maxW;
  }

  build() {
    this.io.disconnect();
    clear(this.pagesEl);
    this.slots.clear();
    this.lastWidth = this.scroller.clientWidth;
    this.scale = this.fitScale() * this.zoom;
    this.applyMode();
    for (const p of this.pages) {
      const head = h('div.slot-head',
        h('span.pl', pageTitle(p)),
        h('span.bm'),
        h('button.ibtn.small', { type: 'button', 'aria-label': 'Opções da página', onclick: e => this.app.pageMenu(this, p, e.clientX, e.clientY) }, icon('more', 18)));
      const pg = h('div.pg' + (p.kind === 'blank' ? '.blank' : '') + (p.kind === 'nb' ? '.nb.tpl-' + (p.tpl || 'blank') : ''));
      if (p.kind === 'nb' && p.tpl === 'cover') { pg.style.backgroundImage = 'url(' + coverUrl(this.doc, p) + ')'; pg.style.backgroundSize = '100% 100%'; }
      const mg = h('div.mg');
      const svg = sv('svg', { class: 'ov' });
      const live = sv('g', { class: 'live' });
      const tbl = h('div.tbl');
      const iml = h('div.iml');   // imagens (HTML, para GIFs animados)
      const slot = h('div.slot', pg, mg, iml);
      slot.appendChild(svg);
      slot.appendChild(tbl);
      svg.appendChild(sv('g', { class: 'ann' }));
      svg.appendChild(live);
      const clip = h('div.slotclip', slot);   // recorte das margens (modo "cortar bordas")
      const wrap = h('div.slotwrap', head, clip);
      wrap.dataset.key = p.key;
      slot.dataset.key = p.key;
      this.pagesEl.appendChild(wrap);
      const s = { p, wrap, slot, clip, pg, mg, svg, live, head, tbl, iml, rendered: 0, renderTask: null };
      this.slots.set(p.key, s);
      this.sizeSlot(s);
      this.io.observe(wrap);
      this.drawOverlay(s);
    }
    this.updateBookmarks();
  }

  hasMargin(key) { return !!(this.doc.margins && this.doc.margins[key]); }

  sizeSlot(s) {
    const { p } = s;
    const sc = this.scale;
    const mw = this.hasMargin(p.key) ? p.w * MARGIN_FRAC : 0;
    const cb = this.cropBox && p.kind === 'pdf' && !mw ? this.cropBox : null;
    if (cb) {
      const [fx, fy, fw, fh] = cb;
      s.wrap.style.width = (p.w * fw * sc) + 'px';
      s.clip.style.width = (p.w * fw * sc) + 'px'; s.clip.style.height = (p.h * fh * sc) + 'px'; s.clip.style.overflow = 'hidden';
      s.slot.style.marginLeft = (-p.w * fx * sc) + 'px'; s.slot.style.marginTop = (-p.h * fy * sc) + 'px';
    } else {
      s.clip.style.width = ''; s.clip.style.height = ''; s.clip.style.overflow = '';
      s.slot.style.marginLeft = ''; s.slot.style.marginTop = '';
    }
    s.wrap.style.width = cb ? s.wrap.style.width : ((p.w + mw) * sc) + 'px';
    s.slot.style.width = ((p.w + mw) * sc) + 'px';
    s.slot.style.height = (p.h * sc) + 'px';
    s.pg.style.width = (p.w * sc) + 'px';
    s.pg.style.height = (p.h * sc) + 'px';
    s.mg.style.left = (p.w * sc) + 'px';
    s.mg.style.width = (mw * sc) + 'px';
    s.mg.style.height = (p.h * sc) + 'px';
    s.mg.style.display = mw ? 'block' : 'none';
    s.svg.setAttribute('viewBox', `0 0 ${p.w + mw} ${p.h}`);
    s.svg.setAttribute('width', (p.w + mw) * sc);
    s.svg.setAttribute('height', p.h * sc);
    s.pg.style.setProperty('--scale-factor', sc);
    s.slot.style.setProperty('--s', sc);
    if (this.sel && this.sel.s === s) this.drawSelection();
  }

  relayout(keepPos) {
    const k = this.currentKey(), off = this.currentOffset();
    this.lastWidth = this.scroller.clientWidth;
    this.scale = this.fitScale() * this.zoom;
    for (const s of this.slots.values()) { this.sizeSlot(s); s.rendered = 0; }
    this.renderVisible();
    if (keepPos) this.goTo(k, off, { noHist: true, exact: true });
  }

  setZoom(z, focus) {
    z = Math.max(0.5, Math.min(5, z));
    if (Math.abs(z - this.zoom) < 0.001) return;
    const sc = this.scroller;
    const fx = focus ? focus.x : sc.clientWidth / 2, fy = focus ? focus.y : sc.clientHeight / 2;
    const ratio = z / this.zoom;
    const cx = sc.scrollLeft + fx, cy = sc.scrollTop + fy;
    this.zoom = z;
    this.scale = this.fitScale() * z;
    for (const s of this.slots.values()) { this.sizeSlot(s); s.rendered = 0; }
    sc.scrollLeft = cx * ratio - fx;
    sc.scrollTop = cy * ratio - fy;
    this.renderVisible();
    this.app.onZoom && this.app.onZoom(this);
  }

  // ----- renderização -----
  onIntersect(es) {
    for (const e of es) {
      const s = this.slots.get(e.target.dataset.key);
      if (!s) continue;
      s.visible = e.isIntersecting;
    }
    this.renderVisible();
  }

  renderVisible() {
    const vis = [...this.slots.values()].filter(s => s.visible);
    for (const s of vis) if (s.rendered !== this.scale) this.renderSlot(s);
    // libera memória de páginas distantes
    const idx = vis.map(s => s.p.index);
    if (idx.length) {
      const lo = Math.min(...idx) - 4, hi = Math.max(...idx) + 4;
      for (const s of this.slots.values()) if ((s.p.index < lo || s.p.index > hi) && s.canvas) {
        s.canvas.remove(); s.canvas = null; if (s.text) { s.text.remove(); s.text = null; } s.rendered = 0;
      }
    }
  }

  async renderSlot(s) {
    if (s.p.kind !== 'pdf') { s.rendered = this.scale; return; }
    const scale = this.scale;
    s.rendered = scale;
    if (s.renderTask) { try { s.renderTask.cancel(); } catch (e) {} }
    const hd = this.hd;
    if (!hd || this.slots.get(s.p.key) !== s) return;   // documento trocado no meio do caminho
    let page;
    try { page = await getPage(hd, s.p.n); } catch (e) { return; }
    if (s.rendered !== scale || this.hd !== hd) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let ps = scale * dpr;
    const maxPix = 14e6;
    if (s.p.w * s.p.h * ps * ps > maxPix) ps = Math.sqrt(maxPix / (s.p.w * s.p.h));
    const vp = page.getViewport({ scale: ps });
    const c = h('canvas.pdfc');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const task = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp });
    s.renderTask = task;
    try { await task.promise; } catch (e) { return; }
    if (s.rendered !== scale) return;
    if (s.canvas) s.canvas.replaceWith(c); else s.pg.prepend(c);
    s.canvas = c;
    // camada de texto (para selecionar)
    try {
      const tvp = page.getViewport({ scale });
      const tl = h('div.textLayer');
      s.pg.style.setProperty('--scale-factor', scale);
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: tvp });
      await layer.render();
      if (s.rendered !== scale) return;
      if (s.text) { unregisterTextLayer(s.text); s.text.replaceWith(tl); } else s.pg.appendChild(tl);
      s.text = tl;
      const end = h('div.endOfContent');
      tl.appendChild(end);
      registerTextLayer(tl, end);
    } catch (e) { console.warn('texto', e); }
    if (!s.links) s.links = await pageLinks(this.hd, s.p.n);
    this.drawOverlay(s);
  }

  // ----- sobreposição (destaques, traços, notas, links) -----
  redrawOverlays(pageKey) {
    S.annots(this.doc.id).then(list => {
      this.anns = list;
      if (this.isNb) {   // a numeração das equações pode mudar em outras páginas
        this.num = numbering(this.doc, list);
        for (const s of this.slots.values()) this.drawBoxes(s);
      }
      if (this.sel) this.refreshSelection();
      if (pageKey && this.slots.has(pageKey)) this.drawOverlay(this.slots.get(pageKey));
      else for (const s of this.slots.values()) this.drawOverlay(s);
    });
  }

  annsOf(key) { return (this.anns || []).filter(a => a.pageKey === key); }

  drawOverlay(s) {
    const g = s.svg.querySelector('g.ann');
    clear(g);
    const list = this.annsOf(s.p.key);
    if (s.iml) {
      clear(s.iml);
      for (const a of list.filter(a => a.kind === 'img')) {
        const url = fileUrlSync(a.fileId);
        if (!url) { fileUrl(a.fileId).then(u => { if (u) this.drawOverlay(s); }); continue; }
        const im = h('img.nbimg', { src: url, alt: '', draggable: 'false', 'data-id': a.id });
        im.style.left = `calc(var(--s) * ${a.x}px)`; im.style.top = `calc(var(--s) * ${a.y}px)`;
        im.style.width = `calc(var(--s) * ${a.w}px)`; im.style.height = `calc(var(--s) * ${a.h}px)`;
        s.iml.appendChild(im);
        freezeIfGif(im);
      }
    }
    const hl = list.filter(a => a.kind === 'hl');
    for (const a of hl) {
      const ci = catInfo(a.cat);
      const col = a.color || ci.color;
      const grp = sv('g', { 'data-id': a.id });
      for (const [x, y, w, hh] of a.rects) {
        if (a.style === 'underline') grp.appendChild(sv('line', { x1: x, x2: x + w, y1: y + hh, y2: y + hh, stroke: darker(col), 'stroke-width': Math.max(1, hh * 0.09) }));
        else if (a.style === 'strike') grp.appendChild(sv('line', { x1: x, x2: x + w, y1: y + hh * 0.55, y2: y + hh * 0.55, stroke: '#B4232C', 'stroke-width': Math.max(1, hh * 0.08) }));
        else grp.appendChild(sv('rect', { x, y, width: w, height: hh, fill: col, class: 'hlr' }));
      }
      const r0 = a.rects[0];
      if (r0 && (ci.sym || a.note || a.audioId || a.digestId)) {
        const bx = 3, by = r0[1] + r0[3] / 2;
        const mark = sv('g', { class: 'hlmark' });
        mark.appendChild(sv('circle', { cx: bx + 5, cy: by, r: 5.5, fill: ci.sym ? darker(col) : '#1D5A8A' }));
        const t = sv('text', { x: bx + 5, y: by + 2.6, 'text-anchor': 'middle', 'font-size': 7.5, fill: '#fff', 'font-weight': 700 });
        t.textContent = ci.sym || (a.audioId ? '♪' : a.digestId ? 'D' : '✎');
        mark.appendChild(t);
        grp.appendChild(mark);
      }
      g.appendChild(grp);
    }
    for (const a of list.filter(a => a.kind === 'link')) {
      const lg = sv('g', { 'data-id': a.id });
      if (this.isNb) {
        // caderno: símbolo de link ao lado do começo e sublinhado no resto (como nos PDFs)
        a.rects.forEach(([x, y, w, hh], k) => {
          lg.appendChild(sv('rect', { x, y, width: w, height: hh, fill: 'transparent' }));
          lg.appendChild(sv('line', { x1: x, x2: x + w, y1: y + hh + 1.5, y2: y + hh + 1.5, class: 'nblinkline' }));
          if (k === 0) {
            const cx = x - 8, cy = y + Math.min(hh, 24) / 2;
            lg.appendChild(sv('circle', { cx, cy, r: 6.2, class: 'nblinkdot' }));
            const t = sv('text', { x: cx, y: cy + 3, 'text-anchor': 'middle', 'font-size': 8, fill: '#fff', 'font-weight': 700 }); t.textContent = '↗';
            lg.appendChild(t);
          }
        });
      } else for (const [x, y, w, hh] of a.rects) lg.appendChild(sv('rect', { x, y, width: w, height: hh, class: 'ulink', rx: 1.5 }));
      g.appendChild(lg);
    }
    for (const a of list.filter(a => a.kind === 'ink')) {
      const p = sv('path', { d: strokePath(a.pts), stroke: a.color, 'stroke-width': strokeWidth(a), fill: 'none', 'stroke-linecap': a.tool === 'marker' ? 'butt' : 'round', 'stroke-linejoin': 'round', 'data-id': a.id });
      if (a.tool === 'marker') { p.setAttribute('opacity', '0.42'); p.setAttribute('class', 'mk'); }
      g.appendChild(p);
    }
    for (const a of list.filter(a => a.kind === 'note')) {
      const n = sv('g', { class: 'notepin', transform: `translate(${a.x} ${a.y})`, 'data-id': a.id });
      n.appendChild(sv('circle', { cx: 0, cy: 0, r: 8, fill: a.audioId && !a.text ? '#1D5A8A' : '#fff', stroke: '#1D5A8A', 'stroke-width': 1.4 }));
      const t = sv('text', { x: 0, y: 3.2, 'text-anchor': 'middle', 'font-size': 9, fill: a.audioId && !a.text ? '#fff' : '#1D5A8A', 'font-weight': 700 });
      t.textContent = a.audioId ? '♪' : '✎';
      n.appendChild(t);
      g.appendChild(n);
    }
    // links que chegam nesta página (de outros documentos ou deste)
    const inc = (this.app.incomingLinks && this.app.incomingLinks(this.doc.id, s.p.key)) || [];
    if (inc.length) {
      const y0 = Math.min(...inc.map(l => l.target.y || 0));
      const m = sv('g', { class: 'inlink', transform: `translate(${s.p.w - 14} ${Math.max(10, y0 + 8)})` });
      m.appendChild(sv('circle', { cx: 0, cy: 0, r: 7, fill: '#1D5A8A' }));
      const t = sv('text', { x: 0, y: 3, 'text-anchor': 'middle', 'font-size': 8, fill: '#fff', 'font-weight': 700 }); t.textContent = '←';
      m.appendChild(t);
      g.appendChild(m);
    }
    this.drawBoxes(s);
  }

  // caixas de texto (Markdown + LaTeX) dos cadernos
  drawBoxes(s) {
    if (!this.isNb) return;
    if (!this.num) this.num = numbering(this.doc, this.anns || []);
    const editing = this.app.textEditor && this.app.textEditor.cur && this.app.textEditor.cur.a;
    const keep = editing && editing.pageKey === s.p.key ? s.tbl.querySelector(`[data-id="${editing.id}"]`) : null;
    [...s.tbl.children].forEach(c => { if (c !== keep) c.remove(); });
    for (const a of this.annsOf(s.p.key).filter(a => a.kind === 'tbox')) {
      if (keep && a.id === editing.id) continue;
      const el = h('div.tbox.md', { 'data-id': a.id });
      el.style.left = `calc(var(--s) * ${a.x}px)`;
      el.style.top = `calc(var(--s) * ${a.y}px)`;
      el.style.width = `calc(var(--s) * ${a.w}px)`;
      el.style.fontSize = `calc(var(--s) * ${a.size || TEXT_SIZE}px)`;
      el.innerHTML = renderBoxHtml(a, this.num);
      hydrate(el, { onLink: href => this.app.openLink && this.app.openLink(href), onTask: i => onTaskClick(a, i), toc: () => this.nbToc() });
      s.tbl.appendChild(el);
    }
  }

  // no caderno, o link fica do tamanho do que está dentro do retângulo (escrita, texto, imagem)
  contentBox(s, [rx, ry, rw, rh]) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const inR = (x, y) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    for (const a of this.annsOf(s.p.key)) {
      if (a.kind === 'ink') for (const p of a.pts) if (inR(p[0], p[1])) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      if (a.kind === 'img' || a.kind === 'tbox') {
        const el = a.kind === 'tbox' ? this.boxEl(s, a.id) : null;
        const ah = a.kind === 'tbox' ? (el ? el.offsetHeight / this.scale : 16) : a.h;
        const ix0 = Math.max(rx, a.x), iy0 = Math.max(ry, a.y), ix1 = Math.min(rx + rw, a.x + a.w), iy1 = Math.min(ry + rh, a.y + ah);
        if (ix1 > ix0 && iy1 > iy0) { x0 = Math.min(x0, ix0); y0 = Math.min(y0, iy0); x1 = Math.max(x1, ix1); y1 = Math.max(y1, iy1); }
      }
    }
    if (x0 > x1) return [rx, ry, rw, rh];
    return [x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4];
  }

  // sumário automático do caderno ([[sumario]] numa caixa de texto)
  nbToc() {
    const boxes = readingOrder(this.doc, (this.anns || []).filter(a => a.kind === 'tbox'));
    const items = [];
    for (const b of boxes) for (const x of headings(b.md || '')) items.push({ x, b });
    if (!items.length) return h('div.toc.muted', 'Sumário: escreva títulos com #, ## ou ### nas caixas de texto.');
    const pl = nbPageList(this.doc);
    return h('nav.toc', h('div.toctitle', 'Sumário'), items.map(({ x, b }) => {
      const p = pl.find(q => q.key === b.pageKey);
      return h('a.toclvl' + Math.min(x.level, 4), { href: '#' + x.id, onclick: e => { e.preventDefault(); e.stopPropagation(); this.goTo(b.pageKey, b.y, { flash: true }); } }, x.text + (p && p.n ? ' · p. ' + p.n : ''));
    }));
  }

  boxEl(s, id) { return s.tbl.querySelector(`[data-id="${id}"]`); }

  // ----- seleção de objetos (laço, imagem tocada) -----
  bboxOf(s, ids) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const a of this.annsOf(s.p.key)) {
      if (!ids.has(a.id)) continue;
      if (a.kind === 'ink') for (const p of a.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      else if (a.kind === 'img') { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h); }
      else if (a.kind === 'tbox') { const el = this.boxEl(s, a.id); const hh = el ? el.offsetHeight / this.scale : 20; x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + hh); }
      else if (a.kind === 'note') { x0 = Math.min(x0, a.x - 9); y0 = Math.min(y0, a.y - 9); x1 = Math.max(x1, a.x + 9); y1 = Math.max(y1, a.y + 9); }
      else if (a.kind === 'link') for (const [rx, ry, rw, rh] of a.rects) { x0 = Math.min(x0, rx); y0 = Math.min(y0, ry); x1 = Math.max(x1, rx + rw); y1 = Math.max(y1, ry + rh); }
    }
    if (x0 > x1) return null;
    const pad = 6;
    return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  }

  setSelection(s, ids, poly) {
    this.clearSelection();
    if (!ids.size) return;
    this.sel = { s, ids, bbox: this.bboxOf(s, ids), poly: poly && poly.length > 4 ? poly : null };
    if (!this.sel.bbox) { this.sel = null; return; }
    this.drawSelection();
    this.applyMode();
    this.app.onObjectSelection && this.app.onObjectSelection(this, this.sel);
  }

  refreshSelection() {
    if (!this.sel) return;
    const ids = new Set([...this.sel.ids].filter(id => (this.anns || []).some(a => a.id === id)));
    if (!ids.size) { this.clearSelection(); return; }
    this.sel.ids = ids; this.sel.bbox = this.bboxOf(this.sel.s, ids);
    this.drawSelection();
  }

  drawSelection() {
    const old = this.el.querySelectorAll('.selbox'); old.forEach(e => e.remove());
    if (!this.sel || !this.sel.bbox) return;
    const [x, y, w, hh] = this.sel.bbox;
    const g = sv('g', { class: 'selbox' });
    // a seleção tem a forma que você desenhou com o laço
    if (this.sel.poly) g.appendChild(sv('path', { d: 'M' + this.sel.poly.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z', class: 'selrect selpoly' }));
    else g.appendChild(sv('rect', { x, y, width: w, height: hh, class: 'selrect' }));
    const single = this.sel.ids.size === 1 && this.annsOf(this.sel.s.p.key).find(a => this.sel.ids.has(a.id) && (a.kind === 'img' || a.kind === 'tbox'));
    if (single) g.appendChild(sv('rect', { x: x + w - 7, y: y + hh - 7, width: 14, height: 14, class: 'selhandle' }));
    this.sel.single = single || null;
    this.sel.s.live.appendChild(g);
  }

  clearSelection() {
    if (this.el) this.el.querySelectorAll('.selbox').forEach(e => e.remove());
    const had = !!this.sel;
    this.sel = null;
    if (had) this.applyMode();
    if (had && this.app.onObjectSelection) this.app.onObjectSelection(this, null);
  }

  inSel(hit, handleOnly) {
    if (!this.sel || hit.s !== this.sel.s) return null;
    const [x, y, w, hh] = this.sel.bbox;
    if (this.sel.single && Math.abs(hit.x - (x + w)) < 12 / this.scale + 6 && Math.abs(hit.y - (y + hh)) < 12 / this.scale + 6) return 'resize';
    if (handleOnly) return null;
    if (this.sel.poly && pointInPoly(this.sel.poly, hit.x, hit.y)) return 'move';
    return hit.x >= x && hit.x <= x + w && hit.y >= y && hit.y <= y + hh ? 'move' : null;
  }

  // laço: pega tudo o que está dentro da forma desenhada (mesmo que só uma parte)
  lassoSelect(s, poly) {
    const inside = (px, py) => pointInPoly(poly, px, py);
    const rectIn = (x, y, w, hh) => {
      const pts = [[x + w / 2, y + hh / 2], [x, y], [x + w, y], [x, y + hh], [x + w, y + hh], [x + w / 2, y], [x + w / 2, y + hh], [x, y + hh / 2], [x + w, y + hh / 2]];
      const n = pts.filter(p => inside(p[0], p[1])).length;
      return inside(pts[0][0], pts[0][1]) || n >= 2;
    };
    const ids = new Set();
    for (const a of this.annsOf(s.p.key)) {
      if (a.kind === 'ink') {
        if (!a.pts.length) continue;
        const n = a.pts.filter(p => inside(p[0], p[1])).length;
        const cx = a.pts.reduce((t, p) => t + p[0], 0) / a.pts.length, cy = a.pts.reduce((t, p) => t + p[1], 0) / a.pts.length;
        if (n >= Math.max(1, a.pts.length * 0.15) || inside(cx, cy)) ids.add(a.id);
      }
      else if (a.kind === 'img' && rectIn(a.x, a.y, a.w, a.h)) ids.add(a.id);
      else if (a.kind === 'tbox') { const el = this.boxEl(s, a.id); const hh = el ? el.offsetHeight / this.scale : 20; if (rectIn(a.x, a.y, a.w, hh)) ids.add(a.id); }
      else if (a.kind === 'note' && inside(a.x, a.y)) ids.add(a.id);
      else if (a.kind === 'link' && this.isNb && a.rects.some(r => rectIn(r[0], r[1], r[2], r[3]))) ids.add(a.id);
    }
    return ids;
  }

  previewMove(dx, dy) {
    const { s, ids } = this.sel;
    for (const id of ids) {
      const e = s.svg.querySelector(`g.ann [data-id="${id}"]`);
      if (e) e.setAttribute('transform', (e.dataset.base0 !== undefined ? e.dataset.base0 : (e.dataset.base0 = e.getAttribute('transform') || '')) + ` translate(${dx} ${dy})`);
      const b = this.boxEl(s, id) || (s.iml && s.iml.querySelector(`[data-id="${id}"]`));
      if (b) b.style.transform = `translate(${dx * this.scale}px, ${dy * this.scale}px)`;
    }
    const sb = s.live.querySelector('.selbox');
    if (sb) sb.setAttribute('transform', `translate(${dx} ${dy})`);
  }

  async commitMove(dx, dy) {
    const { s, ids } = this.sel;
    const list = this.annsOf(s.p.key).filter(a => ids.has(a.id));
    const changed = list.map(a => {
      const c = JSON.parse(JSON.stringify(a));
      if (c.kind === 'ink') c.pts = c.pts.map(p => [+(p[0] + dx).toFixed(2), +(p[1] + dy).toFixed(2), p[2], p[3]]);
      else if (c.kind === 'link') c.rects = c.rects.map(r => [r[0] + dx, r[1] + dy, r[2], r[3]]);
      else { c.x += dx; c.y += dy; }
      return c;
    });
    if (this.sel.poly) this.sel.poly = this.sel.poly.map(p => [p[0] + dx, p[1] + dy]);
    await S.putAnnotsGroup(changed);
  }

  async commitResize(a, nw) {
    const c = JSON.parse(JSON.stringify(a));
    nw = Math.max(30, nw);
    if (c.kind === 'img') { c.h = c.h * nw / c.w; c.w = nw; } else c.w = nw;
    await S.putAnnotsGroup([c]);
  }

  updateBookmarks() {
    const bms = this.doc.bookmarks || [];
    for (const s of this.slots.values()) {
      const b = bms.find(x => x.key === s.p.key);
      const el = s.head.querySelector('.bm');
      el.textContent = b ? ('🔖 ' + (b.label || 'marcador')) : '';
      s.head.querySelector('.pl').textContent = pageTitle(s.p);
    }
  }

  // ----- navegação -----
  currentKey() {
    const top = this.scroller.scrollTop + this.scroller.clientHeight * 0.25;
    let best = this.pages[0] && this.pages[0].key;
    for (const s of this.slots.values()) { if (s.wrap.offsetTop <= top) best = s.p.key; else break; }
    return best;
  }
  currentOffset() {
    const s = this.slots.get(this.currentKey());
    if (!s) return 0;
    return Math.max(0, (this.scroller.scrollTop - s.slot.offsetTop) / this.scale);
  }

  goTo(key, y = 0, opts = {}) {
    const s = this.slots.get(key) || this.slots.get('p1');
    if (!s) return;
    if (!opts.noHist) this.hist.push({ key: this.currentKey(), y: this.currentOffset() });
    const top = s.slot.offsetTop + y * this.scale - (opts.exact ? 0 : 40);
    this.scroller.scrollTop = Math.max(0, top);
    if (opts.flash && y) this.flashAt(s, y);
    this.app.onNav && this.app.onNav(this);
  }

  back() {
    const p = this.hist.pop();
    if (p) this.goTo(p.key, p.y, { noHist: true, exact: true });
    this.app.onNav && this.app.onNav(this);
  }

  flashAt(s, y) {
    const f = h('div.flash', { style: { top: (y * this.scale - 6) + 'px' } });
    s.slot.appendChild(f);
    setTimeout(() => f.remove(), 1600);
  }

  onScroll() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => {
      if (!this.doc) return;
      this.doc.lastKey = this.currentKey(); this.doc.lastY = this.currentOffset();
      S.saveDoc(this.doc);
      this.app.onNav && this.app.onNav(this);
    }, 400);
  }

  // ----- modos e entrada -----
  applyMode() {
    const t = this.app.tool;
    const draw = t !== 'read' || !!this.sel;
    this.el.classList.toggle('drawmode', draw);
    this.el.classList.toggle('textmode', t === 'text');
    this.el.classList.toggle('nbmode', !!(this.doc && this.isNb));
    this.scroller.classList.toggle('paged', this.paged);
    this.scroller.style.touchAction = draw || this.paged ? 'none' : 'pan-x pan-y';
  }

  slotAt(clientX, clientY) {
    for (const s of this.slots.values()) {
      const r = s.slot.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return { s, x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
    }
    return null;
  }

  // a caneta (S Pen) escreve; o dedo só navega (a menos que o ajuste "só a S Pen" esteja desligado)
  canDraw(e) {
    if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
    return !this.app.settings.penOnly;
  }

  bindInput() {
    const sc = this.scroller;
    sc.addEventListener('pointerdown', e => this.onDown(e));
    sc.addEventListener('pointermove', e => this.onMove(e));
    sc.addEventListener('pointerup', e => this.onUp(e));
    sc.addEventListener('pointercancel', e => this.onUp(e, true));
    sc.addEventListener('contextmenu', e => { if (this.app.tool !== 'read' || Date.now() - (this.lastPen || 0) < 1500) e.preventDefault(); });
    // pinça com dois dedos no modo leitura
    const readMode = () => this.app.tool === 'read';
    sc.addEventListener('touchstart', e => { if (readMode() && e.touches.length === 2) this.pinchStart(e.touches); }, { passive: true });
    sc.addEventListener('touchmove', e => {
      if (readMode() && e.touches.length === 2 && this.pinch) { if (e.cancelable) e.preventDefault(); this.pinchMove(e.touches); }
    }, { passive: false });
    sc.addEventListener('touchend', e => { if (readMode() && e.touches.length < 2 && this.pinch) this.pinchEnd(); }, { passive: true });
    sc.addEventListener('wheel', e => {
      if (e.ctrlKey) { e.preventDefault(); const r = sc.getBoundingClientRect(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX - r.left, y: e.clientY - r.top }); }
      else if (this.paged) { e.preventDefault(); const now = Date.now(); if (now - (this.wheelT || 0) > 350 && Math.abs(e.deltaY) > 4) { this.wheelT = now; this.turn(e.deltaY > 0 ? 1 : -1); } }
    }, { passive: false });
  }

  pinchStart(t) {
    const r = this.scroller.getBoundingClientRect();
    const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    this.pinch = { d0: d, z0: this.zoom, cx: (t[0].clientX + t[1].clientX) / 2 - r.left, cy: (t[0].clientY + t[1].clientY) / 2 - r.top, k: 1 };
    this.pagesEl.style.transformOrigin = `${this.scroller.scrollLeft + this.pinch.cx}px ${this.scroller.scrollTop + this.pinch.cy}px`;
  }
  pinchMove(t) {
    const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let k = d / this.pinch.d0;
    k = Math.max(0.5 / this.pinch.z0, Math.min(5 / this.pinch.z0, k));
    this.pinch.k = k;
    this.pagesEl.style.transform = `scale(${k})`;
  }
  pinchEnd() {
    const p = this.pinch; this.pinch = null;
    this.pagesEl.style.transform = '';
    if (p && Math.abs(p.k - 1) > 0.02) this.setZoom(p.z0 * p.k, { x: p.cx, y: p.cy });
  }

  onDown(e) {
    const tool = this.app.tool;
    this.app.setActiveViewer(this);
    if (e.pointerType === 'touch' && this.penDown) return;             // palma da mão encostada enquanto a caneta escreve
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType, x0: e.clientX, y0: e.clientY });
    if (this.pointers.size > 1) for (const q of this.pointers.values()) q.multi = true;
    const hit = this.slotAt(e.clientX, e.clientY);
    if (e.pointerType === 'pen') this.lastPen = Date.now();
    // botão da S Pen apertado ou ponta-borracha (ex.: caneta do reMarkable 2): apaga, em qualquer ferramenta
    if (hit && isPenEraser(e) && (this.app.settings || {}).penButtonErase !== false) {
      e.preventDefault();
      try { this.scroller.setPointerCapture(e.pointerId); } catch (er) {}
      this.penDown = true;
      window.getSelection().removeAllRanges();
      this.op = { type: 'erase', s: hit.s, ids: new Set(), id: e.pointerId };
      this.eraseAt(hit);
      return;
    }
    // objeto selecionado: arrastar move; a alça do canto redimensiona
    if (this.sel && hit && (tool === 'read' || tool === 'lasso' || tool === 'text')) {
      const where = this.inSel(hit);
      if (where && (this.canDraw(e) || this.pointers.size === 1)) {
        e.preventDefault();
        try { this.scroller.setPointerCapture(e.pointerId); } catch (er) {}
        this.op = { type: where, s: hit.s, cx0: e.clientX, cy0: e.clientY, id: e.pointerId, a: this.sel.single };
        return;
      }
      if (!where && this.pointers.size === 1 && (e.pointerType !== 'touch' || tool !== 'lasso')) { this.clearSelection(); }
    }
    if (tool === 'read' && !this.sel) return;
    if (this.canDraw(e) && hit && tool !== 'read' && tool !== 'text') {
      e.preventDefault();
      try { this.scroller.setPointerCapture(e.pointerId); } catch (er) {}
      this.penDown = e.pointerType !== 'touch';
      const erasing = tool === 'eraser' || (e.pointerType === 'pen' && ((e.buttons & 32) || (e.buttons & 2)));
      if (erasing) { this.op = { type: 'erase', s: hit.s, ids: new Set(), id: e.pointerId }; this.eraseAt(hit); return; }
      if (tool === 'pen' || tool === 'marker') {
        const st = this.app.settings;
        const a = { kind: 'ink', tool, docId: this.doc.id, pageKey: hit.s.p.key, color: tool === 'marker' ? st.markerColor : st.penColor, width: tool === 'marker' ? 11 : st.penWidth, pts: [] };
        const path = sv('path', { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': tool === 'marker' ? 'butt' : 'round', 'stroke-linejoin': 'round' });
        if (tool === 'marker') path.setAttribute('opacity', '0.42');
        hit.s.live.appendChild(path);
        this.op = { type: 'ink', s: hit.s, a, path, id: e.pointerId, t0: Date.now() };
        this.addPt(e);
        return;
      }
      if (tool === 'linkrect' || tool === 'crop') {
        const r = sv('rect', { class: tool === 'crop' ? 'croprect' : 'ulink live', x: hit.x, y: hit.y, width: 0, height: 0 });
        hit.s.live.appendChild(r);
        this.op = { type: 'rect', s: hit.s, x0: hit.x, y0: hit.y, r, id: e.pointerId, crop: tool === 'crop' };
        return;
      }
      if (tool === 'note') { this.op = { type: 'note', s: hit.s, x: hit.x, y: hit.y, id: e.pointerId }; return; }
      if (tool === 'lasso') {
        const path = sv('path', { class: 'lassop', d: '' });
        hit.s.live.appendChild(path);
        this.op = { type: 'lasso', s: hit.s, pts: [[hit.x, hit.y]], path, id: e.pointerId };
        return;
      }
    }
    // dedo em modo de escrita: arrasta a página / pinça
    if (e.pointerType === 'touch') {
      e.preventDefault();
      if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()].map(p => ({ clientX: p.x, clientY: p.y }));
        this.panOp = null; this.pinchStart(pts);
      } else { this.panOp = { x: e.clientX, y: e.clientY, vx: 0, vy: 0, t: performance.now() }; cancelAnimationFrame(this.momentum); }
    }
  }

  addPt(e) {
    const op = this.op;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const r = op.s.slot.getBoundingClientRect();
    const maxX = op.s.p.w * (this.hasMargin(op.s.p.key) ? 1 + MARGIN_FRAC : 1);
    for (const ev of (evs.length ? evs : [e])) {
      const x = Math.max(0, Math.min(maxX, (ev.clientX - r.left) / this.scale));
      const y = Math.max(0, Math.min(op.s.p.h, (ev.clientY - r.top) / this.scale));
      const p = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
      const last = op.a.pts[op.a.pts.length - 1];
      if (last && Math.hypot(last[0] - x, last[1] - y) < 0.35 / this.scale * 2) continue;
      op.a.pts.push([+x.toFixed(2), +y.toFixed(2), +p.toFixed(2), Date.now() - op.t0]);
    }
    op.path.setAttribute('d', strokePath(op.a.pts));
    op.path.setAttribute('stroke-width', strokeWidth(op.a));
  }

  eraseAt(hit) {
    const R = 6 / this.scale + 3;
    for (const a of this.annsOf(hit.s.p.key)) {
      if (a.kind !== 'ink' || this.op.ids.has(a.id)) continue;
      if (a.pts.some(p => Math.hypot(p[0] - hit.x, p[1] - hit.y) < R + a.width / 2)) {
        this.op.ids.add(a.id);
        const el = hit.s.svg.querySelector(`[data-id="${a.id}"]`);
        if (el) el.style.display = 'none';
      }
    }
  }

  onMove(e) {
    const pp = this.pointers.get(e.pointerId);
    if (pp) { pp.x = e.clientX; pp.y = e.clientY; }
    const op = this.op;
    if (op && op.id === e.pointerId) {
      e.preventDefault();
      if (op.type === 'ink' && isPenEraser(e) && (this.app.settings || {}).penButtonErase !== false) {
        // apertou o botão no meio do traço: vira borracha
        op.path.remove();
        this.op = { type: 'erase', s: op.s, ids: new Set(), id: e.pointerId };
        const hit = this.slotAt(e.clientX, e.clientY); if (hit && hit.s === op.s) this.eraseAt(hit);
        return;
      }
      if (op.type === 'ink') this.addPt(e);
      else if (op.type === 'erase') { const hit = this.slotAt(e.clientX, e.clientY); if (hit && hit.s === op.s) this.eraseAt(hit); }
      else if (op.type === 'lasso') {
        const r = op.s.slot.getBoundingClientRect();
        op.pts.push([(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale]);
        op.path.setAttribute('d', 'M' + op.pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z');
      } else if (op.type === 'move') {
        op.dx = (e.clientX - op.cx0) / this.scale; op.dy = (e.clientY - op.cy0) / this.scale;
        this.previewMove(op.dx, op.dy);
      } else if (op.type === 'resize' && op.a) {
        const dx = (e.clientX - op.cx0) / this.scale;
        op.nw = Math.max(30, op.a.w + dx);
        const el = op.a.kind === 'img' ? op.s.iml.querySelector(`[data-id="${op.a.id}"]`) : this.boxEl(op.s, op.a.id);
        if (el) el.style.width = `calc(var(--s) * ${op.nw}px)`;
        if (el && op.a.kind === 'img') el.style.height = `calc(var(--s) * ${op.a.h * op.nw / op.a.w}px)`;
      }
      else if (op.type === 'rect') {
        const r = op.s.slot.getBoundingClientRect();
        const x = (e.clientX - r.left) / this.scale, y = (e.clientY - r.top) / this.scale;
        op.r.setAttribute('x', Math.min(x, op.x0)); op.r.setAttribute('y', Math.min(y, op.y0));
        op.r.setAttribute('width', Math.abs(x - op.x0)); op.r.setAttribute('height', Math.abs(y - op.y0));
      }
      return;
    }
    if (this.app.tool !== 'read' && e.pointerType === 'touch') {
      e.preventDefault();
      if (this.pointers.size >= 2 && this.pinch) {
        const pts = [...this.pointers.values()].slice(0, 2).map(p => ({ clientX: p.x, clientY: p.y }));
        this.pinchMove(pts);
      } else if (this.panOp && this.paged) {
        // e-ink: o dedo não arrasta a página; o deslize vira a página ao soltar
      } else if (this.panOp) {
        const now = performance.now();
        const dx = e.clientX - this.panOp.x, dy = e.clientY - this.panOp.y;
        this.scroller.scrollLeft -= dx; this.scroller.scrollTop -= dy;
        const dt = Math.max(1, now - this.panOp.t);
        this.panOp.vx = dx / dt; this.panOp.vy = dy / dt;
        this.panOp.x = e.clientX; this.panOp.y = e.clientY; this.panOp.t = now;
      }
    }
  }

  async onUp(e, cancelled) {
    const pp = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (e.pointerType !== 'touch') this.penDown = false;
    const op = this.op;
    if (op && op.id === e.pointerId) {
      this.op = null;
      if (op.type === 'ink') {
        op.path.remove();
        if (!cancelled && op.a.pts.length) {
          const rec = this.app.recorder && this.app.recorder.stamp(this.doc.id);
          if (rec) op.a.rec = rec;
          op.a.id = uid('a');
          this.anns.push(op.a);           // desenha já, sem esperar o banco
          this.drawOverlay(op.s);
          await S.putAnnot(op.a);
        }
      } else if (op.type === 'erase') {
        const del = (this.anns || []).filter(a => op.ids.has(a.id));
        await S.delAnnots(del);
      } else if (op.type === 'rect') {
        op.r.remove();
        const x = +op.r.getAttribute('x'), y = +op.r.getAttribute('y'), w = +op.r.getAttribute('width'), hh = +op.r.getAttribute('height');
        if (w > 4 && hh > 4) {
          if (op.crop) this.app.cropDone(this, op.s, [x, y, w, hh], e.clientX, e.clientY);
          else this.app.linkBuilder(this, { pageKey: op.s.p.key, rects: [this.isNb ? this.contentBox(op.s, [x, y, w, hh]) : [x, y, w, hh]], text: '' });
        }
      } else if (op.type === 'note') {
        this.app.noteAt(this, op.s.p.key, op.x, op.y, e.clientX, e.clientY);
      } else if (op.type === 'lasso') {
        op.path.remove();
        const ids = op.pts.length > 4 ? this.lassoSelect(op.s, op.pts) : new Set();
        if (ids.size) this.setSelection(op.s, ids, op.pts); else this.clearSelection();
      } else if (op.type === 'move') {
        if (!cancelled && (Math.abs(op.dx || 0) > 0.5 || Math.abs(op.dy || 0) > 0.5)) await this.commitMove(op.dx, op.dy);
        else if (this.sel) { this.previewMove(0, 0); this.app.onObjectSelection && this.app.onObjectSelection(this, this.sel, e.clientX, e.clientY); }
      } else if (op.type === 'resize') {
        if (!cancelled && op.nw && op.a) await this.commitResize(op.a, op.nw);
      }
      return;
    }
    if (this.pinch && this.pointers.size < 2 && this.app.tool !== 'read') { this.pinchEnd(); return; }
    if (this.panOp && e.pointerType === 'touch' && this.paged) {
      this.panOp = null;
      const d = pp && !pp.multi ? swipeDir(e.clientX - pp.x0, e.clientY - pp.y0) : 0;
      if (d && !cancelled) this.turn(d);
      return;
    }
    if (this.panOp && e.pointerType === 'touch') {
      const p = this.panOp; this.panOp = null;
      let vx = p.vx * 16, vy = p.vy * 16;
      const step = () => {
        if (Math.abs(vx) < 0.3 && Math.abs(vy) < 0.3) return;
        this.scroller.scrollLeft -= vx; this.scroller.scrollTop -= vy; vx *= 0.94; vy *= 0.94;
        this.momentum = requestAnimationFrame(step);
      };
      if (performance.now() - p.t < 80) this.momentum = requestAnimationFrame(step);
    }
    // toque curto: ferramenta Texto cria/edita caixa; no modo leitura abre a anotação/link tocado
    const tap = !cancelled && pp && Date.now() - pp.t < 450 && Math.hypot(e.clientX - pp.x0, e.clientY - pp.y0) < 10;
    if (tap && e.target.closest && e.target.closest('input, a[href], .tbox.editing, button, iframe, audio, .ytbox, .audbox, nav.toc')) return;
    if (tap && this.app.tool === 'text') {
      const hit = this.slotAt(e.clientX, e.clientY);
      if (hit && this.isNb) this.app.textAt(this, hit);
      return;
    }
    if (tap && this.app.tool === 'read') {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim() && !(e.target.closest && e.target.closest('.tbox'))) return;
      const hit = this.slotAt(e.clientX, e.clientY);
      if (hit && this.app.picking) { this.app.picking(this, hit); return; }
      if (hit) { const target = this.hitTest(hit); if (target) { this.app.onTapTarget(this, target, e.clientX, e.clientY); return; } }
      // e-ink: toque na esquerda volta, na direita avança
      if (this.paged) { const z = tapZone(this.scroller, e.clientX); if (z) this.turn(z); }
      return;
    }
    // e-ink, modo leitura: deslizar o dedo vira a página
    if (this.paged && this.app.tool === 'read' && pp && !pp.multi && !cancelled && e.pointerType === 'touch' && Date.now() - pp.t < 900) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const d = swipeDir(e.clientX - pp.x0, e.clientY - pp.y0);
      if (d) this.turn(d);
    }
  }

  // traço vindo da caneta rápida da Boox (pontos em coordenadas da tela)
  async fastStroke(o) {
    const pts = (o && o.pts) || [];
    if (!pts.length || !this.doc) return;
    const hit = this.slotAt(pts[0][0], pts[0][1]);
    if (!hit) return;
    const s = hit.s, r = s.slot.getBoundingClientRect();
    const maxX = s.p.w * (this.hasMargin(s.p.key) ? 1 + MARGIN_FRAC : 1);
    const maxP = Math.max(...pts.map(q => q[2] || 0), 0);
    const t0 = pts[0][3] || 0;
    const loc = pts.map(q => [
      +Math.max(0, Math.min(maxX, (q[0] - r.left) / this.scale)).toFixed(2),
      +Math.max(0, Math.min(s.p.h, (q[1] - r.top) / this.scale)).toFixed(2),
      +(maxP > 1 ? Math.min(1, (q[2] || 0) / maxP) * 0.8 : (q[2] || 0.5)).toFixed(2),
      Math.max(0, Math.round((q[3] || 0) - t0))]);
    if (o.erase || this.app.tool === 'eraser') {
      this.op = { type: 'erase', s, ids: new Set() };
      for (const q of loc) this.eraseAt({ s, x: q[0], y: q[1] });
      const ids = this.op.ids; this.op = null;
      const del = (this.anns || []).filter(a => ids.has(a.id));
      if (del.length) await S.delAnnots(del);
      return;
    }
    const tool = this.app.tool === 'marker' ? 'marker' : 'pen';
    const st = this.app.settings || {};
    const a = { kind: 'ink', tool, docId: this.doc.id, pageKey: s.p.key, color: tool === 'marker' ? st.markerColor : st.penColor, width: tool === 'marker' ? 11 : st.penWidth, pts: loc, id: uid('a') };
    const rec = this.app.recorder && this.app.recorder.stamp(this.doc.id);
    if (rec) a.rec = rec;
    this.anns.push(a);
    this.drawOverlay(s);
    await S.putAnnot(a);
  }

  hitTest(hit) {
    const { s, x, y } = hit;
    const list = this.annsOf(s.p.key);
    // no modo leitura, um link desenhado por cima do texto tem prioridade
    if (this.app.tool === 'read') for (const a of list) if (a.kind === 'link' && a.rects.some(r => inRect(x, y, r, 2))) return { type: 'link', a, s };
    if (this.isNb) {
      for (const a of list.filter(a => a.kind === 'tbox').reverse()) {
        const el = this.boxEl(s, a.id); const hh = el ? el.offsetHeight / this.scale : 16;
        if (x >= a.x - 2 && x <= a.x + a.w + 2 && y >= a.y - 2 && y <= a.y + hh + 2) return { type: 'tbox', a, s };
      }
    }
    for (const a of list.filter(a => a.kind === 'img').reverse()) if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) {
      // traço por cima da imagem tem prioridade
      if (!list.some(b => b.kind === 'ink' && b.pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 6))) return { type: 'img', a, s };
    }
    for (const a of list) if (a.kind === 'note' && Math.hypot(a.x - x, a.y - y) < 12) return { type: 'note', a, s };
    const inc = (this.app.incomingLinks && this.app.incomingLinks(this.doc.id, s.p.key)) || [];
    if (inc.length && x > s.p.w - 26 && x < s.p.w) {
      const y0 = Math.max(10, Math.min(...inc.map(l => l.target.y || 0)) + 8);
      if (Math.abs(y - y0) < 12) return { type: 'incoming', links: inc, s };
    }
    for (const a of list) if (a.kind === 'link' && a.rects.some(r => inRect(x, y, r, 2))) return { type: 'link', a, s };
    for (const a of list) if (a.kind === 'hl' && (a.rects.some(r => inRect(x, y, r, 1.5)) || (a.rects[0] && Math.hypot(8 - x, a.rects[0][1] + a.rects[0][3] / 2 - y) < 8))) return { type: 'hl', a, s };
    for (const l of (s.links || [])) if (inRect(x, y, l.rect, 1)) return { type: 'pdflink', l, s };
    let best = null, bd = 10;
    for (const a of list) if (a.kind === 'ink') for (const p of a.pts) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = { type: 'ink', a, s, pt: p }; } }
    return best;
  }

  // ----- seleção de texto -> segmentos por página -----
  selectionSegments() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.scroller.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
    const segs = [];
    for (const s of this.slots.values()) {
      if (!s.text) continue;
      const pr = s.pg.getBoundingClientRect();
      const mine = rects.filter(r => r.top + r.height / 2 >= pr.top && r.top + r.height / 2 <= pr.bottom && r.left < pr.right && r.right > pr.left)
        .map(r => [(Math.max(r.left, pr.left) - pr.left) / this.scale, (r.top - pr.top) / this.scale, (Math.min(r.right, pr.right) - Math.max(r.left, pr.left)) / this.scale, r.height / this.scale]);
      if (mine.length) segs.push({ pageKey: s.p.key, rects: mergeRects(mine) });
    }
    if (!segs.length) return null;
    const last = rects[rects.length - 1], first = rects[0];
    return { text, segs, box: { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)), top: first.top, bottom: last.bottom } };
  }
}

function pageTitle(p) { return p.kind === 'pdf' ? 'p. ' + p.n : p.kind === 'nb' ? (p.tpl === 'cover' ? 'Capa' : 'Página ' + p.n) : 'Página em branco'; }

// área com conteúdo (texto, figuras) de algumas páginas, em frações da página: [x, y, largura, altura]
const cropCache = new Map();
async function detectCrop(hd) {
  const n = hd.pdf.numPages;
  const pages = n <= 2 ? [1, n] : [2, 3, 4, 5, 6, 7].filter(p => p <= n);
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0, got = 0;
  for (const num of [...new Set(pages)]) {
    try {
      const pg = await getPageCached(hd, num);
      const vp0 = pg.getViewport({ scale: 1 });
      const k = 260 / vp0.width;
      const vp = pg.getViewport({ scale: k });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let a = c.width, b = c.height, e = -1, f = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] < 600) { if (x < a) a = x; if (x > e) e = x; if (y < b) b = y; if (y > f) f = y; }
      }
      if (e < 0) continue;
      x0 = Math.min(x0, a / c.width); x1 = Math.max(x1, (e + 1) / c.width); y0 = Math.min(y0, b / c.height); y1 = Math.max(y1, (f + 1) / c.height);
      got++;
    } catch (er) {}
  }
  if (!got) return [0, 0, 1, 1];
  const px = 0.012, py = 0.01;
  x0 = Math.max(0, x0 - px); y0 = Math.max(0, y0 - py); x1 = Math.min(1, x1 + px); y1 = Math.min(1, y1 + py);
  if (x1 - x0 > 0.97 && y1 - y0 > 0.97) return [0, 0, 1, 1];
  return [x0, y0, x1 - x0, y1 - y0];
}
function getPageCached(hd, n) { return getPage(hd, n); }

function isPenEraser(e) { return e.pointerType === 'pen' && (((e.buttons || 0) & 32) || ((e.buttons || 0) & 2) || e.button === 5 || e.button === 2 || window.__penBtn === true); }
export function pointInPoly(poly, px, py) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi)) c = !c;
  }
  return c;
}
function inRect(x, y, r, pad = 0) { return x >= r[0] - pad && x <= r[0] + r[2] + pad && y >= r[1] - pad && y <= r[1] + r[3] + pad; }

// junta retângulos da mesma linha
export function mergeRects(rs) {
  rs = rs.slice().sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  const out = [];
  for (const r of rs) {
    const l = out[out.length - 1];
    if (l && Math.abs(l[1] - r[1]) < Math.min(l[3], r[3]) * 0.5 && r[0] <= l[0] + l[2] + Math.max(4, r[3])) {
      const x0 = Math.min(l[0], r[0]), x1 = Math.max(l[0] + l[2], r[0] + r[2]);
      const y0 = Math.min(l[1], r[1]), y1 = Math.max(l[1] + l[3], r[1] + r[3]);
      l[0] = x0; l[2] = x1 - x0; l[1] = y0; l[3] = y1 - y0;
    } else out.push(r.slice());
  }
  return out.map(r => r.map(v => +v.toFixed(2)));
}

export function darker(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.round(c * 0.55));
  return '#' + [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
}
