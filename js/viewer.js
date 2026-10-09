// Visualizador de PDF: páginas, zoom, escrita com a S Pen, seleção de texto e toques nas anotações.
import { pdfjs, openPdf, getPage, pageList, pageLinks } from './pdfdoc.js';
import * as S from './store.js';
import { h, clear, icon, catInfo, uid } from './util.js';
import { registerTextLayer, unregisterTextLayer } from './textsel.js';

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
  }

  destroy() { this.offAnn(); this.io.disconnect(); this.ro.disconnect(); this.el.remove(); }

  async open(doc, at) {
    this.doc = doc;
    this.hd = await openPdf(doc);
    this.anns = await S.annots(doc.id);
    this.pages = pageList(doc, this.hd);
    this.hist = [];
    this.build();
    const key = (at && at.key) || doc.lastKey || 'p1';
    const y = at ? (at.y || 0) : (doc.lastY || 0);
    requestAnimationFrame(() => this.goTo(key, y, { noHist: true, exact: !at }));
    doc.opened = Date.now();
    S.saveDoc(doc);
  }

  // reconstrói a lista (depois de inserir/remover página em branco)
  async refreshPages() {
    const k = this.currentKey();
    this.pages = pageList(this.doc, this.hd);
    this.build();
    this.goTo(k, 0, { noHist: true });
  }

  fitScale() {
    const anyMargin = this.doc && this.doc.margins && Object.keys(this.doc.margins).some(k => this.doc.margins[k]);
    const maxW = Math.max(...this.pages.map(p => p.w), 1) * (anyMargin ? 1 + MARGIN_FRAC : 1);
    const avail = Math.max(200, this.scroller.clientWidth - 28);
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
        h('span.pl', p.kind === 'pdf' ? 'p. ' + p.n : 'Página em branco'),
        h('span.bm'),
        h('button.ibtn.small', { type: 'button', 'aria-label': 'Opções da página', onclick: e => this.app.pageMenu(this, p, e.clientX, e.clientY) }, icon('more', 18)));
      const pg = h('div.pg' + (p.kind === 'blank' ? '.blank' : ''));
      const mg = h('div.mg');
      const svg = sv('svg', { class: 'ov' });
      const live = sv('g', { class: 'live' });
      const slot = h('div.slot', pg, mg);
      slot.appendChild(svg);
      svg.appendChild(sv('g', { class: 'ann' }));
      svg.appendChild(live);
      const wrap = h('div.slotwrap', head, slot);
      wrap.dataset.key = p.key;
      slot.dataset.key = p.key;
      this.pagesEl.appendChild(wrap);
      const s = { p, wrap, slot, pg, mg, svg, live, head, rendered: 0, renderTask: null };
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
    s.wrap.style.width = ((p.w + mw) * sc) + 'px';
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
    const page = await getPage(this.hd, s.p.n);
    if (s.rendered !== scale) return;
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
      if (pageKey && this.slots.has(pageKey)) this.drawOverlay(this.slots.get(pageKey));
      else for (const s of this.slots.values()) this.drawOverlay(s);
    });
  }

  annsOf(key) { return (this.anns || []).filter(a => a.pageKey === key); }

  drawOverlay(s) {
    const g = s.svg.querySelector('g.ann');
    clear(g);
    const list = this.annsOf(s.p.key);
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
      for (const [x, y, w, hh] of a.rects) g.appendChild(sv('rect', { x, y, width: w, height: hh, class: 'ulink', rx: 1.5 }));
    }
    for (const a of list.filter(a => a.kind === 'ink')) {
      const p = sv('path', { d: strokePath(a.pts), stroke: a.color, 'stroke-width': strokeWidth(a), fill: 'none', 'stroke-linecap': a.tool === 'marker' ? 'butt' : 'round', 'stroke-linejoin': 'round', 'data-id': a.id });
      if (a.tool === 'marker') { p.setAttribute('opacity', '0.42'); p.setAttribute('class', 'mk'); }
      g.appendChild(p);
    }
    for (const a of list.filter(a => a.kind === 'note')) {
      const n = sv('g', { class: 'notepin', transform: `translate(${a.x} ${a.y})` });
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
  }

  updateBookmarks() {
    const bms = this.doc.bookmarks || [];
    for (const s of this.slots.values()) {
      const b = bms.find(x => x.key === s.p.key);
      const el = s.head.querySelector('.bm');
      el.textContent = b ? ('🔖 ' + (b.label || 'marcador')) : '';
      s.head.querySelector('.pl').textContent = s.p.kind === 'pdf' ? 'p. ' + s.p.n : 'Página em branco';
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
    const draw = t !== 'read';
    this.el.classList.toggle('drawmode', draw);
    this.scroller.style.touchAction = draw ? 'none' : 'pan-x pan-y';
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
    sc.addEventListener('contextmenu', e => { if (this.app.tool !== 'read') e.preventDefault(); });
    // pinça com dois dedos no modo leitura
    const readMode = () => this.app.tool === 'read';
    sc.addEventListener('touchstart', e => { if (readMode() && e.touches.length === 2) this.pinchStart(e.touches); }, { passive: true });
    sc.addEventListener('touchmove', e => {
      if (readMode() && e.touches.length === 2 && this.pinch) { if (e.cancelable) e.preventDefault(); this.pinchMove(e.touches); }
    }, { passive: false });
    sc.addEventListener('touchend', e => { if (readMode() && e.touches.length < 2 && this.pinch) this.pinchEnd(); }, { passive: true });
    sc.addEventListener('wheel', e => {
      if (e.ctrlKey) { e.preventDefault(); const r = sc.getBoundingClientRect(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX - r.left, y: e.clientY - r.top }); }
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
    if (tool === 'read') return;
    const hit = this.slotAt(e.clientX, e.clientY);
    if (this.canDraw(e) && hit && tool !== 'read') {
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
      if (tool === 'linkrect') {
        const r = sv('rect', { class: 'ulink live', x: hit.x, y: hit.y, width: 0, height: 0 });
        hit.s.live.appendChild(r);
        this.op = { type: 'rect', s: hit.s, x0: hit.x, y0: hit.y, r, id: e.pointerId };
        return;
      }
      if (tool === 'note') { this.op = { type: 'note', s: hit.s, x: hit.x, y: hit.y, id: e.pointerId }; return; }
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
      if (op.type === 'ink') this.addPt(e);
      else if (op.type === 'erase') { const hit = this.slotAt(e.clientX, e.clientY); if (hit && hit.s === op.s) this.eraseAt(hit); }
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
        if (w > 4 && hh > 4) this.app.linkBuilder(this, { pageKey: op.s.p.key, rects: [[x, y, w, hh]], text: '' });
      } else if (op.type === 'note') {
        this.app.noteAt(this, op.s.p.key, op.x, op.y, e.clientX, e.clientY);
      }
      return;
    }
    if (this.pinch && this.pointers.size < 2 && this.app.tool !== 'read') { this.pinchEnd(); return; }
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
    // toque curto no modo leitura: abre a anotação/link tocado
    if (!cancelled && pp && this.app.tool === 'read' && Date.now() - pp.t < 450 && Math.hypot(e.clientX - pp.x0, e.clientY - pp.y0) < 10) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
      const hit = this.slotAt(e.clientX, e.clientY);
      if (hit && this.app.picking) { this.app.picking(this, hit); return; }
      if (hit) { const target = this.hitTest(hit); if (target) this.app.onTapTarget(this, target, e.clientX, e.clientY); }
    }
  }

  hitTest(hit) {
    const { s, x, y } = hit;
    const list = this.annsOf(s.p.key);
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
