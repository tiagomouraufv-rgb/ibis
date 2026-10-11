// Visualizador de PDF: páginas, zoom, escrita com a S Pen, seleção de texto e toques nas anotações.
import { pdfjs, openPdf, getPage, pageList, pageLinks } from './pdfdoc.js';
import * as S from './store.js';
import { h, clear, icon, catInfo, uid } from './util.js';
import { registerTextLayer, unregisterTextLayer } from './textsel.js';
import { hydrate } from './embeds.js';
import { nbPageList, isNotebook, fileUrl, fileUrlSync, renderBoxHtml, numbering, TEXT_SIZE, onTaskClick, coverUrl, readingOrder } from './notebook.js';
import { headings } from './md.js';
import { isEink, turnViewer, tapZone, swipeDir, freezeIfGif } from './eink.js';
import { detectSetup, layoutFromSetup } from './columns.js';
import { densify, cutSegments, segPath } from './eraser.js';

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
    // e-ink: prepara menos páginas fora da tela (aparelho mais lento, pouca memória)
    this.io = new IntersectionObserver(es => this.onIntersect(es), { root: this.scroller, rootMargin: isEink() ? '300px 0px' : '900px 0px' });
    this.ro = new ResizeObserver(() => { if (this.doc && Math.abs(this.lastWidth - this.scroller.clientWidth) > 4) this.relayout(true); });
    this.ro.observe(this.scroller);
    this.offAnn = S.on('annots', e => { if (this.doc && e.docId === this.doc.id) this.redrawOverlays(e.pageKey); });
    // o índice de ligações mudou (link criado aqui, em outro documento ou em outra janela): redesenha os links de volta
    this.offLinks = S.on('links', () => { if (this.doc) for (const sl of this.slots.values()) this.drawOverlay(sl); });
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // celular/tablet/e-ink mudou (Fold aberto, Boox): refaz o modo e o encaixe da página
    this.offForm = S.on('form', () => { if (!this.doc) return; this.applyMode(); this.relayout(true); });
  }

  // escala de uma parte da página (no modo artigo a faixa do título pode ser menor)
  k(s) { return (s && s.sc) || this.scale; }

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

  destroy() { this.offAnn(); this.offLinks && this.offLinks(); this.offForm && this.offForm(); this.io.disconnect(); this.ro.disconnect(); this.el.remove(); }

  async open(doc, at) {
    this.cropBox = null; this.nbCrop = null; this.fitOn = false; this.tight = false;
    this.colMode = false; this.colLayout = null;
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

  // melhor ajuste: corta as bordas brancas do PDF e encaixa o texto na largura da tela (no modo artigo,
  // a coluna; no caderno, a página). Tocar de novo volta a mostrar a página inteira.
  async bestFit(force) {
    const on = force !== undefined ? force : !this.fitOn;
    this.fitOn = on;
    const k = this.currentKey(), off = this.currentOffset();
    if (!this.isNb && this.hd && !this.colMode) await this.setCrop(on);
    // caderno: corta as laterais pela área já escrita (com folga), igual em todas as páginas
    if (this.isNb) {
      this.nbCrop = on ? this.nbContentBox() : null;
      // a capa não é cortada: fica do mesmo tamanho das páginas cortadas
      for (const p of this.pages) if (p.tpl === 'cover') p.fit = this.nbCrop ? this.nbCrop[2] : undefined;
    }
    this.zoom = 1;
    this.tight = on;   // sem a folga dos lados
    this.scale = this.fitScale();
    for (const sl of this.slots.values()) { this.sizeSlot(sl); sl.rendered = 0; }
    this.scroller.scrollLeft = 0;
    this.renderVisible();
    requestAnimationFrame(() => this.goTo(k, off, { noHist: true, exact: true }));
    this.app.onZoom && this.app.onZoom(this);
    return on;
  }

  nbContentBox() {
    const pw = Math.max(...this.pages.map(p => p.w || 0), 1);
    let x0 = Infinity, x1 = -Infinity;
    for (const a of this.anns || []) {
      if (a.kind === 'ink') for (const q of a.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
      else if (a.kind === 'img') for (const [x] of imgCorners(a)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      else if (a.kind === 'tbox') { x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x + a.w); }
      else if (a.kind === 'note') { x0 = Math.min(x0, a.x - 10); x1 = Math.max(x1, a.x + 10); }
    }
    if (!(x1 > x0)) { x0 = pw * 0.06; x1 = pw * 0.94; }   // caderno vazio: só as margens
    x0 = Math.max(0, x0 - 24); x1 = Math.min(pw, x1 + 24);
    if (x1 - x0 < pw * 0.4) { const c = (x0 + x1) / 2; x0 = Math.max(0, c - pw * 0.2); x1 = Math.min(pw, x0 + pw * 0.4); }
    return [x0 / pw, 0, (x1 - x0) / pw, 1];
  }

  // reconstrói a lista (depois de inserir/remover página em branco)
  async refreshPages() {
    const k = this.currentKey();
    this.pages = this.listPages();
    this.build();
    this.goTo(this.slots.has(k) ? k : this.pages[0].key, 0, { noHist: true });
  }

  listPages() {
    if (isNotebook(this.doc)) return nbPageList(this.doc);
    const pages = pageList(this.doc, this.hd);
    if (!this.colMode || !this.colLayout) return pages;
    // modo artigo: cada página vira suas partes (cabeçalho largo, coluna 1, coluna 2), uma embaixo da outra
    const out = [];
    for (const p of pages) {
      const boxes = p.kind === 'pdf' ? this.colLayout.get(p.n) : null;
      if (!boxes) { out.push(Object.assign({}, p, { box: p.kind === 'pdf' && this.cropBox ? this.cropBox : null })); continue; }
      const hasHead = boxes.some(b => b[4] === 1), ncol = boxes.length - (hasHead ? 1 : 0);
      boxes.forEach((b, i) => out.push(Object.assign({}, p, { sid: i ? p.key + '#' + i : p.key, box: b.slice(0, 4), part: i, parts: boxes.length, head: b[4] === 1, ncol, ci: i - (hasHead ? 1 : 0) })));
    }
    // a faixa larga do alto (título, resumo) é reduzida para caber na largura de uma coluna
    const colW = Math.max(...out.filter(p => p.box && !p.head).map(p => p.w * p.box[2]), 1);
    for (const p of out) if (p.head) p.fit = Math.min(1, colW / (p.w * p.box[2]));
    return out;
  }

  async docCrop() { const id = this.doc.id; const b = cropCache.get(id) || await detectCrop(this.hd); cropCache.set(id, b); return b; }
  async autoSetup() { return detectSetup(this.hd); }
  async reapplyArticle() { if (!this.colMode) return this.setArticle(true); this.colMode = false; this.cropBox = this.cropBefore ? this.cropBox : null; return this.setArticle(true); }

  // modo artigo: uma coluna do PDF por vez, na largura da tela (o texto não é refeito: é o próprio PDF recortado)
  async setArticle(on) {
    if (!this.hd) return false;
    on = !!on;
    if (on === !!this.colMode) return true;
    const k = this.currentKey();
    const docId = this.doc.id;
    if (on) {
      this.cropBefore = !!this.cropBox;
      const box = cropCache.get(docId) || await detectCrop(this.hd);
      cropCache.set(docId, box);
      // como no NeoReader: bordas cortadas e colunas iguais, com a divisão na calha do texto
      let setup = this.doc.colSetup;
      if (!setup) { setup = await detectSetup(this.hd); if (this.doc && this.doc.id === docId) { this.doc.colSetup = setup; S.saveDoc(this.doc); } }
      const lay = await layoutFromSetup(this.hd, setup, setup.crop || box);
      if (!this.doc || this.doc.id !== docId) return false;
      this.colLayout = lay;
      this.cropBox = box;
      if (![...lay.values()].some(Boolean)) { this.colMode = true; }
    } else if (!this.cropBefore) this.cropBox = null;
    this.colMode = on;
    this.pages = this.listPages();
    this.build();
    requestAnimationFrame(() => this.goTo(k, 0, { noHist: true, exact: true }));
    return true;
  }
  get isNb() { return isNotebook(this.doc); }

  fitScale() {
    const anyMargin = this.doc && this.doc.margins && Object.keys(this.doc.margins).some(k => this.doc.margins[k]);
    const maxW = Math.max(...this.pages.map(p => (p.w * (p.box ? p.box[2] : this.cropBox && p.kind === 'pdf' ? this.cropBox[2] : this.nbCrop && p.kind === 'nb' && p.tpl !== 'cover' ? this.nbCrop[2] : 1) + this.amOf(p).w) * (p.fit || 1)), 1) * (anyMargin && !this.colMode ? 1 + MARGIN_FRAC : 1);
    const avail = Math.max(200, this.scroller.clientWidth - (this.tight ? 10 : 28));
    // e-ink com "página inteira": a página cabe na altura da tela (sem rolar dentro dela)
    if (this.paged && (this.app.settings || {}).pageFit && !this.columns) {
      const maxH = Math.max(...this.pages.map(p => p.h * (this.cropBox && p.kind === 'pdf' ? this.cropBox[3] : 1)), 1);
      const availH = Math.max(200, this.scroller.clientHeight - 40);
      return Math.min(avail / maxW, availH / maxH);
    }
    return avail / maxW;
  }

  build() {
    this.pageKeys = null;
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
      wrap.dataset.key = p.sid || p.key;
      slot.dataset.key = p.key;
      this.pagesEl.appendChild(wrap);
      const s = { p, wrap, slot, clip, pg, mg, svg, live, head, tbl, iml, rendered: 0, renderTask: null };
      this.slots.set(p.sid || p.key, s);
      this.sizeSlot(s);
      this.io.observe(wrap);
      this.drawOverlay(s);
    }
    // caderno: botão para mais uma página no fim
    if (this.isNb && this.pages.length) {
      this.pagesEl.appendChild(h('div.nbmore', h('button.sbtn', { type: 'button', onclick: () => this.app.nbAddPage(this, this.pages[this.pages.length - 1].index) }, icon('plus', 18), h('span', 'Nova página'))));
    }
    this.updateBookmarks();
  }

  // escreveu perto do fim da última página do caderno: já cria a próxima (como um caderno sem fim)
  maybeAutoPage(s, pts) {
    if (!this.isNb || this.autoAdding || !pts || !pts.length) return;
    const last = this.pages[this.pages.length - 1];
    if (!last || s.p.key !== last.key || last.tpl === 'cover') return;
    if (Math.max(...pts.map(q => q[1])) < last.h * 0.85) return;
    this.autoAdding = true;
    Promise.resolve(this.app.nbAddPage(this, last.index, undefined, { stay: true })).finally(() => { this.autoAdding = false; });
  }

  hasMargin(key) { return !!(this.doc.margins && this.doc.margins[key]); }

  // modo artigo com a margem aberta: cada coluna ganha a sua faixa da margem da página, mostrada ao lado
  // dela (a margem da página inteira é dividida entre as colunas; o título usa a margem toda).
  // Retorna { x0, w } em unidades da página (w = 0: sem margem nesta parte).
  amOf(p) {
    if (!p.box || p.kind !== 'pdf' || !this.hasMargin(p.key)) return { x0: 0, w: 0 };
    const full = p.w * MARGIN_FRAC;
    if (p.head || !(p.ncol > 1)) return { x0: p.w, w: full };
    const w = full / p.ncol;
    return { x0: p.w + Math.max(0, p.ci) * w, w };
  }

  // ponto da tela -> ponto da página (na faixa de margem do modo artigo, cai na margem da página)
  toPage(s, cx, cy, region) {
    const r = s.slot.getBoundingClientRect(), k = this.k(s);
    if (s.am && s.amw) {
      const a = s.am.getBoundingClientRect();
      if (region === 'am' || (region === undefined && cx >= a.left)) return [s.am0 + (cx - a.left) / k, (cy - r.top) / k, 'am'];
    }
    return [(cx - r.left) / k, (cy - r.top) / k, 'pg'];
  }

  sizeSlot(s) {
    const { p } = s;
    const sc = this.scale * (p.fit || 1);
    s.sc = sc;
    const mw = this.hasMargin(p.key) && !p.box ? p.w * MARGIN_FRAC : 0;
    const cb = p.box || (this.cropBox && p.kind === 'pdf' && !mw ? this.cropBox : null) || (this.nbCrop && p.kind === 'nb' && p.tpl !== 'cover' ? this.nbCrop : null);
    s.cb = cb;
    const am = this.amOf(p);
    s.amw = am.w; s.am0 = am.x0;
    if (s.am && !am.w) { s.am.remove(); s.am = null; }
    if (cb) {
      const [fx, fy, fw, fh] = cb;
      s.wrap.style.width = ((p.w * fw + am.w) * sc) + 'px';
      s.clip.style.width = ((p.w * fw + am.w) * sc) + 'px'; s.clip.style.height = (p.h * fh * sc) + 'px'; s.clip.style.overflow = 'hidden';
      if (am.w) {
        // a faixa da margem: mostra (com <use>) o mesmo desenho da página, na região da margem
        if (!s.am) {
          if (!s.svg.id) { s.uid = s.uid || uid('sv'); s.svg.querySelector('g.ann').id = s.uid + 'a'; s.live.id = s.uid + 'l'; s.svg.id = s.uid; }
          const asv = sv('svg', { class: 'ov amov' });
          asv.appendChild(sv('use', { href: '#' + s.uid + 'a' }));
          asv.appendChild(sv('use', { href: '#' + s.uid + 'l' }));
          s.am = h('div.amg', asv);
          s.clip.style.position = 'relative';
          s.clip.appendChild(s.am);
        }
        const asv = s.am.firstChild;
        s.am.style.left = (p.w * fw * sc) + 'px'; s.am.style.width = (am.w * sc) + 'px'; s.am.style.height = (p.h * fh * sc) + 'px';
        asv.setAttribute('viewBox', `${am.x0} ${p.h * fy} ${am.w} ${p.h * fh}`);
        asv.setAttribute('width', am.w * sc); asv.setAttribute('height', p.h * fh * sc);
      }
      s.slot.style.marginLeft = (-p.w * fx * sc) + 'px'; s.slot.style.marginTop = (-p.h * fy * sc) + 'px';
    } else {
      s.clip.style.width = ''; s.clip.style.height = ''; s.clip.style.overflow = '';
      s.slot.style.marginLeft = ''; s.slot.style.marginTop = '';
    }
    s.wrap.style.width = cb ? s.wrap.style.width : ((p.w + mw) * sc) + 'px';
    if (s.am) s.am.style.setProperty('--s', sc);
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
    for (const s of vis) if (s.rendered !== this.k(s)) this.renderSlot(s);
    // libera memória de páginas distantes
    const idx = vis.map(s => s.p.index);
    if (idx.length) {
      const keep = isEink() ? 2 : 4;
      const lo = Math.min(...idx) - keep, hi = Math.max(...idx) + keep;
      for (const s of this.slots.values()) if ((s.p.index < lo || s.p.index > hi) && s.canvas) {
        s.canvas.remove(); s.canvas = null; if (s.text) { s.text.remove(); s.text = null; } s.rendered = 0;
      }
    }
  }

  async renderSlot(s) {
    if (s.p.kind !== 'pdf') { s.rendered = this.k(s); return; }
    const scale = this.k(s);
    s.rendered = scale;
    if (s.renderTask) { try { s.renderTask.cancel(); } catch (e) {} }
    const hd = this.hd;
    if (!hd || this.slots.get(s.p.sid || s.p.key) !== s) return;   // documento trocado no meio do caminho
    let page;
    try { page = await getPage(hd, s.p.n); } catch (e) { return; }
    if (s.rendered !== scale || this.hd !== hd) return;
    // e-ink: menos pixels (a tela não mostra a diferença e o aparelho fica bem mais leve)
    const eink = isEink();
    const dpr = Math.min(window.devicePixelRatio || 1, eink ? 1.5 : 2.5);
    let ps = scale * dpr;
    // página recortada (bordas cortadas ou modo artigo): desenha só a parte que aparece
    const cb = s.cb || [0, 0, 1, 1];
    const rw = s.p.w * cb[2], rh = s.p.h * cb[3];
    const maxPix = eink ? 5e6 : 14e6;
    if (rw * rh * ps * ps > maxPix) ps = Math.sqrt(maxPix / (rw * rh));
    const vp = page.getViewport({ scale: ps, offsetX: -s.p.w * cb[0] * ps, offsetY: -s.p.h * cb[1] * ps });
    const c = h('canvas.pdfc');
    c.width = Math.max(1, Math.floor(rw * ps)); c.height = Math.max(1, Math.floor(rh * ps));
    if (s.cb) Object.assign(c.style, { left: (cb[0] * 100) + '%', top: (cb[1] * 100) + '%', width: (cb[2] * 100) + '%', height: (cb[3] * 100) + '%', right: 'auto', bottom: 'auto' });
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
      if (pageKey) { for (const sl of this.slots.values()) if (sl.p.key === pageKey) this.drawOverlay(sl); }
      else for (const s of this.slots.values()) this.drawOverlay(s);
    });
  }

  // links que chegam a esta página; os que apontam para o documento inteiro aparecem na 1ª página
  incomingHere(s) {
    const app = this.app.app;
    if (!app || !app.linksTo || !this.doc) return [];
    if (!this.pageKeys) this.pageKeys = new Set(this.pages.map(p => p.key));
    const first = this.pages[0] && this.pages[0].key;
    if (s.p.sid && s.p.sid !== s.p.key) return [];   // modo artigo: só na 1ª parte da página
    return app.linksTo(this.doc.id).filter(l => (l.target.pageKey === s.p.key || (!this.pageKeys.has(l.target.pageKey) && s.p.key === first)) && !(l.docId === this.doc.id && l.pageKey === s.p.key));
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
        if (a.rot) { im.style.transform = `rotate(${a.rot}deg)`; im.dataset.rot = a.rot; }
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
    // links que chegam nesta página (de outros documentos ou deste): etiqueta "← origem" na borda direita
    s.inPills = [];
    const inc = this.incomingHere(s);
    if (inc.length) {
      const groups = [];
      for (const l of inc.slice().sort((a, b) => (a.target.y || 0) - (b.target.y || 0))) {
        const y = Math.max(12, (l.target.y || 0) + 8);
        const last = groups[groups.length - 1];
        if (last && y - last.y < 22) last.links.push(l); else groups.push({ y, links: [l] });
      }
      for (const gr of groups) {
        const l0 = gr.links[0];
        let label = '← ' + (l0.srcTitle || 'link');
        if (label.length > 26) label = label.slice(0, 25) + '…';
        if (gr.links.length > 1) label = '← ' + gr.links.length + ' links';
        const w = 12 + label.length * 5.1;
        const x0 = s.p.w - w - 4, y0 = gr.y - 8;
        const m = sv('g', { class: 'inlink' });
        m.appendChild(sv('rect', { x: x0, y: y0, width: w, height: 16, rx: 8, fill: '#1D5A8A', opacity: 0.92 }));
        const t = sv('text', { x: x0 + 6, y: y0 + 11.3, 'font-size': 9, fill: '#fff', 'font-weight': 600 });
        t.textContent = label;
        m.appendChild(t);
        g.appendChild(m);
        s.inPills.push({ x0, x1: x0 + w, y0, y1: y0 + 16, links: gr.links });
      }
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
      else if (a.kind === 'img') for (const [px, py] of imgCorners(a)) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
      else if (a.kind === 'tbox') { const el = this.boxEl(s, a.id); const hh = el ? el.offsetHeight / this.scale : 20; x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + hh); }
      else if (a.kind === 'note') { x0 = Math.min(x0, a.x - 9); y0 = Math.min(y0, a.y - 9); x1 = Math.max(x1, a.x + 9); y1 = Math.max(y1, a.y + 9); }
      else if (a.kind === 'link') for (const [rx, ry, rw, rh] of a.rects) { x0 = Math.min(x0, rx); y0 = Math.min(y0, ry); x1 = Math.max(x1, rx + rw); y1 = Math.max(y1, ry + rh); }
    }
    if (x0 > x1) return null;
    const pad = 6;
    return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  }

  setSelection(s, ids, poly, opts = {}) {
    this.clearSelection();
    if (!ids.size) return;
    ids = this.withGroups(s, ids);
    this.sel = { s, ids, bbox: this.bboxOf(s, ids), poly: poly && poly.length > 4 ? poly : null };
    if (!this.sel.bbox) { this.sel = null; return; }
    this.drawSelection();
    this.applyMode();
    if (!opts.quiet) this.app.onObjectSelection && this.app.onObjectSelection(this, this.sel);
  }

  // seleciona assim que as anotações novas chegarem do banco (forma recém-desenhada, cópia…)
  async selectNew(s, ids, opts) {
    this.anns = await S.annots(this.doc.id);
    this.setSelection(s, new Set(ids), null, opts);
  }

  // uma forma é feita de vários traços: selecionar um pega a forma inteira
  withGroups(s, ids) {
    const list = this.annsOf(s.p.key);
    const groups = new Set(list.filter(a => ids.has(a.id) && a.sgroup).map(a => a.sgroup));
    if (!groups.size) return ids;
    const out = new Set(ids);
    for (const a of list) if (a.sgroup && groups.has(a.sgroup)) out.add(a.id);
    return out;
  }

  // toque com o laço em cima de um traço/imagem: seleciona aquilo (e a forma inteira)
  pickAt(s, x, y) {
    const tol = 10 / this.k(s) + 3;
    const list = this.annsOf(s.p.key);
    for (const a of list.filter(a => a.kind === 'img').reverse()) if (pointInPoly(imgCorners(a), x, y)) return new Set([a.id]);
    let best = null, bd = tol;
    for (const a of list) {
      if (a.kind !== 'ink') continue;
      for (let i = 0; i < a.pts.length; i++) {
        const p = a.pts[i], q = a.pts[i + 1] || p;
        const d = segDist(x, y, p[0], p[1], q[0], q[1]);
        if (d < bd) { bd = d; best = a; }
      }
    }
    return best ? new Set([best.id]) : new Set();
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
    const mine = this.annsOf(this.sel.s.p.key).filter(a => this.sel.ids.has(a.id));
    const single = mine.length === 1 && (mine[0].kind === 'img' || mine[0].kind === 'tbox') ? mine[0] : null;
    this.sel.single = single;
    // canto de baixo: muda o tamanho (proporcional); bolinha em cima: gira (como na Boox/GoodNotes)
    const hs = Math.max(10, 16 / this.k(this.sel.s));
    const canScale = mine.some(a => a.kind === 'ink' || a.kind === 'img' || a.kind === 'tbox');
    if (canScale) g.appendChild(sv('rect', { x: x + w - hs / 2, y: y + hh - hs / 2, width: hs, height: hs, class: 'selhandle' }));
    this.sel.canRot = mine.some(a => a.kind === 'ink' || a.kind === 'img');
    if (this.sel.canRot) {
      const gap = Math.max(18, 28 / this.k(this.sel.s));
      const ry = y - gap >= 0 ? y - gap : y + hh + gap;
      this.sel.rotPt = [x + w / 2, ry];
      g.appendChild(sv('line', { x1: x + w / 2, y1: ry, x2: x + w / 2, y2: ry < y ? y : y + hh, class: 'selrotline' }));
      g.appendChild(sv('circle', { cx: x + w / 2, cy: ry, r: hs / 2, class: 'selrot' }));
    }
    this.sel.hs = hs;
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
    const tol = (this.sel.hs || 14) / 2 + 8 / this.k(hit.s) + 2;
    if (this.sel.canRot && this.sel.rotPt && Math.hypot(hit.x - this.sel.rotPt[0], hit.y - this.sel.rotPt[1]) < tol) return 'rotate';
    if (Math.abs(hit.x - (x + w)) < tol && Math.abs(hit.y - (y + hh)) < tol) return this.sel.single && this.sel.single.kind === 'tbox' ? 'resize' : 'scale';
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
      if (b) b.style.transform = `translate(${dx * this.k(s)}px, ${dy * this.k(s)}px)` + (b.dataset.rot ? ` rotate(${b.dataset.rot}deg)` : '');
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

  // mudar o tamanho (f) a partir do canto de cima à esquerda, ou girar (graus) em torno do centro
  xformMap(kind, v) {
    const [x, y, w, hh] = this.sel.bbox;
    if (kind === 'scale') return (px, py) => [x + (px - x) * v, y + (py - y) * v];
    const cx = x + w / 2, cy = y + hh / 2, t = v * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
    return (px, py) => [cx + (px - cx) * c - (py - cy) * sn, cy + (px - cx) * sn + (py - cy) * c];
  }
  previewXform(kind, v) {
    const { s, ids } = this.sel;
    const [x, y, w, hh] = this.sel.bbox;
    const tr = kind === 'scale' ? `translate(${x} ${y}) scale(${v}) translate(${-x} ${-y})` : `rotate(${v} ${x + w / 2} ${y + hh / 2})`;
    const M = this.xformMap(kind, v), k = this.k(s);
    for (const a of this.annsOf(s.p.key)) {
      if (!ids.has(a.id)) continue;
      const e = s.svg.querySelector(`g.ann [data-id="${a.id}"]`);
      if (e) e.setAttribute('transform', (e.dataset.base0 !== undefined ? e.dataset.base0 : (e.dataset.base0 = e.getAttribute('transform') || '')) + ' ' + tr);
      const b = this.boxEl(s, a.id) || (s.iml && s.iml.querySelector(`[data-id="${a.id}"]`));
      if (!b) continue;
      if (a.kind === 'img') {
        const c0 = [a.x + a.w / 2, a.y + a.h / 2], q = M(c0[0], c0[1]);
        const f = kind === 'scale' ? v : 1, r = (a.rot || 0) + (kind === 'rotate' ? v : 0);
        b.style.transform = `translate(${(q[0] - c0[0]) * k}px, ${(q[1] - c0[1]) * k}px) rotate(${r}deg) scale(${f})`;
      } else {
        const q = M(a.x, a.y);
        b.style.transformOrigin = '0 0';
        b.style.transform = `translate(${(q[0] - a.x) * k}px, ${(q[1] - a.y) * k}px)`;
        if (kind === 'scale' && a.kind === 'tbox') b.style.width = `calc(var(--s) * ${a.w * v}px)`;
      }
    }
    const sb = s.live.querySelector('.selbox');
    if (sb) sb.setAttribute('transform', tr);
  }
  async commitXform(kind, v) {
    const { s, ids } = this.sel;
    const M = this.xformMap(kind, v);
    const f = kind === 'scale' ? v : 1, deg = kind === 'rotate' ? v : 0;
    const changed = this.annsOf(s.p.key).filter(a => ids.has(a.id)).map(a => xformAnn(a, M, f, deg));
    this.sel.poly = null;
    await S.putAnnotsGroup(changed);
  }
  // espelhar (só traços)
  async flipSel(horiz) {
    const { s, ids } = this.sel;
    const [x, y, w, hh] = this.sel.bbox, cx = x + w / 2, cy = y + hh / 2;
    const M = horiz ? (px, py) => [2 * cx - px, py] : (px, py) => [px, 2 * cy - py];
    const changed = this.annsOf(s.p.key).filter(a => ids.has(a.id) && a.kind === 'ink').map(a => xformAnn(a, M, 1, 0));
    this.sel.poly = null;
    await S.putAnnotsGroup(changed);
  }
  async rotateSel(deg) { this.sel.poly = null; await this.commitXform('rotate', deg); }

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
    return Math.max(0, (this.scroller.scrollTop - s.slot.offsetTop) / this.k(s));
  }

  goTo(key, y = 0, opts = {}) {
    let s = this.slots.get(key) || this.slots.get('p1');
    if (!s) return;
    // modo artigo/bordas cortadas: a parte da página que contém essa altura
    if (s.p.parts > 1) { const parts = [...this.slots.values()].filter(x => x.p.key === key); s = parts.find(x => y >= x.p.box[1] * x.p.h - 2 && y <= (x.p.box[1] + x.p.box[3]) * x.p.h) || parts[0]; }
    if (!opts.noHist) this.hist.push({ key: this.currentKey(), y: this.currentOffset() });
    let top = s.slot.offsetTop + y * this.k(s) - (opts.exact ? 0 : 40);
    if (s.cb) top = Math.max(top, s.wrap.offsetTop);
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
    const f = h('div.flash', { style: { top: (y * this.k(s) - 6) + 'px' } });
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
      const c = s.cb ? s.clip.getBoundingClientRect() : r;   // página recortada: só a parte visível conta
      if (clientX >= c.left && clientX <= c.right && clientY >= c.top && clientY <= c.bottom) {
        if (s.am && s.amw) { const [x, y, region] = this.toPage(s, clientX, clientY); return { s, x, y, region }; }
        return { s, x: (clientX - r.left) / this.k(s), y: (clientY - r.top) / this.k(s), region: 'pg' };
      }
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
      this.op = this.eraseOp(hit.s, e.pointerId);
      this.eraseAt(hit);
      return;
    }
    // objeto selecionado: arrastar move; a alça do canto redimensiona
    if (this.sel && hit && (tool === 'read' || tool === 'lasso' || tool === 'text' || tool === 'shape')) {
      const where = this.inSel(hit);
      if (where && (this.canDraw(e) || this.pointers.size === 1)) {
        e.preventDefault();
        try { this.scroller.setPointerCapture(e.pointerId); } catch (er) {}
        this.op = { type: where, s: hit.s, cx0: e.clientX, cy0: e.clientY, id: e.pointerId, a: this.sel.single, region: hit.region };
        return;
      }
      if (!where && this.pointers.size === 1 && (e.pointerType !== 'touch' || (tool !== 'lasso' && tool !== 'shape'))) { this.clearSelection(); }
    }
    if (tool === 'read' && !this.sel) return;
    if (this.canDraw(e) && hit && tool !== 'read' && tool !== 'text') {
      e.preventDefault();
      try { this.scroller.setPointerCapture(e.pointerId); } catch (er) {}
      this.penDown = e.pointerType !== 'touch';
      const erasing = tool === 'eraser' || (e.pointerType === 'pen' && ((e.buttons & 32) || (e.buttons & 2)));
      if (erasing) { this.op = this.eraseOp(hit.s, e.pointerId); this.eraseAt(hit); return; }
      if (tool === 'pen' || tool === 'marker') {
        const st = this.app.settings;
        const a = { kind: 'ink', tool, docId: this.doc.id, pageKey: hit.s.p.key, color: tool === 'marker' ? st.markerColor : st.penColor, width: tool === 'marker' ? 11 : st.penWidth, pts: [] };
        const path = sv('path', { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': tool === 'marker' ? 'butt' : 'round', 'stroke-linejoin': 'round' });
        if (tool === 'marker') path.setAttribute('opacity', '0.42');
        hit.s.live.appendChild(path);
        this.op = { type: 'ink', s: hit.s, a, path, id: e.pointerId, t0: Date.now(), region: hit.region };
        this.addPt(e);
        return;
      }
      if (tool === 'linkrect' || tool === 'crop' || tool === 'shape') {
        const r = sv('rect', { class: tool === 'crop' || tool === 'shape' ? 'croprect' : 'ulink live', x: hit.x, y: hit.y, width: 0, height: 0 });
        hit.s.live.appendChild(r);
        this.op = { type: 'rect', s: hit.s, x0: hit.x, y0: hit.y, r, id: e.pointerId, crop: tool === 'crop', shape: tool === 'shape', region: hit.region };
        return;
      }
      if (tool === 'note') { this.op = { type: 'note', s: hit.s, x: hit.x, y: hit.y, id: e.pointerId }; return; }
      if (tool === 'lasso') {
        const path = sv('path', { class: 'lassop', d: '' });
        hit.s.live.appendChild(path);
        this.op = { type: 'lasso', s: hit.s, pts: [[hit.x, hit.y]], path, id: e.pointerId, region: hit.region };
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
    const maxX = op.s.p.w * (this.hasMargin(op.s.p.key) ? 1 + MARGIN_FRAC : 1);
    for (const ev of (evs.length ? evs : [e])) {
      const q = this.toPage(op.s, ev.clientX, ev.clientY, op.region);
      const x = Math.max(0, Math.min(maxX, q[0]));
      const y = Math.max(0, Math.min(op.s.p.h, q[1]));
      const p = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
      const last = op.a.pts[op.a.pts.length - 1];
      if (last && Math.hypot(last[0] - x, last[1] - y) < 0.35 / this.k(op.s) * 2) continue;
      op.a.pts.push([+x.toFixed(2), +y.toFixed(2), +p.toFixed(2), Date.now() - op.t0]);
    }
    op.path.setAttribute('d', strokePath(op.a.pts));
    op.path.setAttribute('stroke-width', strokeWidth(op.a));
  }

  // borracha: apaga o traço inteiro ou só a área (configuração da ferramenta Borracha)
  eraseOp(s, id) {
    const st = this.app.settings || {};
    return { type: 'erase', s, ids: new Set(), id, area: st.eraserMode === 'area', size: st.eraserSize || 20, cuts: new Map() };
  }
  async commitCuts(op) {
    if (!op.cuts.size) return;
    const olds = [], news = [];
    for (const [id, segs] of op.cuts) {
      const a = (this.anns || []).find(x => x.id === id); if (!a) continue;
      olds.push(a);
      for (const seg of segs) if (seg.length > 1) news.push(Object.assign(JSON.parse(JSON.stringify(a)), { id: uid('a'), pts: seg }));
    }
    if (!olds.length) return;
    await S.group(this.doc.id, async () => { await S.delAnnots(olds); if (news.length) await S.putAnnotsGroup(news); });
  }

  eraseAt(hit) {
    if (this.op && this.op.area) return this.eraseArea(hit);
    const R = 6 / this.k(hit.s) + 3;
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
        this.op = this.eraseOp(op.s, e.pointerId);
        const hit = this.slotAt(e.clientX, e.clientY); if (hit && hit.s === op.s) this.eraseAt(hit);
        return;
      }
      if (op.type === 'ink') this.addPt(e);
      else if (op.type === 'erase') { const hit = this.slotAt(e.clientX, e.clientY); if (hit && hit.s === op.s) this.eraseAt(hit); }
      else if (op.type === 'lasso') {
        const q = this.toPage(op.s, e.clientX, e.clientY, op.region);
        op.pts.push([q[0], q[1]]);
        op.path.setAttribute('d', 'M' + op.pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z');
      } else if (op.type === 'move') {
        op.dx = (e.clientX - op.cx0) / this.k(op.s); op.dy = (e.clientY - op.cy0) / this.k(op.s);
        this.previewMove(op.dx, op.dy);
      } else if (op.type === 'scale' && this.sel) {
        const [, , w, hh] = this.sel.bbox;
        const dx = (e.clientX - op.cx0) / this.k(op.s), dy = (e.clientY - op.cy0) / this.k(op.s);
        op.v = Math.max(0.1, Math.min(12, ((w + dx) / w + (hh + dy) / hh) / 2));
        this.previewXform('scale', op.v);
      } else if (op.type === 'rotate' && this.sel) {
        const [x, y, w, hh] = this.sel.bbox, cx = x + w / 2, cy = y + hh / 2;
        const q = this.toPage(op.s, e.clientX, e.clientY, op.region);
        const a0 = Math.atan2(this.sel.rotPt[1] - cy, this.sel.rotPt[0] - cx), a1 = Math.atan2(q[1] - cy, q[0] - cx);
        let deg = (a1 - a0) * 180 / Math.PI;
        deg = ((deg + 540) % 360) - 180;
        const snap = Math.round(deg / 45) * 45;
        if (Math.abs(deg - snap) < 4) deg = snap;   // encaixa em 0°, 45°, 90°…
        op.v = deg;
        this.previewXform('rotate', deg);
      } else if (op.type === 'resize' && op.a) {
        const dx = (e.clientX - op.cx0) / this.scale;
        op.nw = Math.max(30, op.a.w + dx);
        const el = op.a.kind === 'img' ? op.s.iml.querySelector(`[data-id="${op.a.id}"]`) : this.boxEl(op.s, op.a.id);
        if (el) el.style.width = `calc(var(--s) * ${op.nw}px)`;
        if (el && op.a.kind === 'img') el.style.height = `calc(var(--s) * ${op.a.h * op.nw / op.a.w}px)`;
      }
      else if (op.type === 'rect') {
        const [x, y] = this.toPage(op.s, e.clientX, e.clientY, op.region);
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
          this.maybeAutoPage(op.s, op.a.pts);
        }
      } else if (op.type === 'erase') {
        if (op.cursor) op.cursor.remove();
        if (op.area) await this.commitCuts(op);
        else { const del = (this.anns || []).filter(a => op.ids.has(a.id)); await S.delAnnots(del); }
      } else if (op.type === 'rect') {
        op.r.remove();
        const x = +op.r.getAttribute('x'), y = +op.r.getAttribute('y'), w = +op.r.getAttribute('width'), hh = +op.r.getAttribute('height');
        if (op.shape) { if (!cancelled) await this.app.placeShape(this, op.s, [x, y, w, hh]); }
        else if (w > 4 && hh > 4) {
          if (op.crop) this.app.cropDone(this, op.s, [x, y, w, hh], e.clientX, e.clientY);
          else this.app.linkBuilder(this, { pageKey: op.s.p.key, rects: [this.isNb ? this.contentBox(op.s, [x, y, w, hh]) : [x, y, w, hh]], text: '' });
        }
      } else if (op.type === 'note') {
        this.app.noteAt(this, op.s.p.key, op.x, op.y, e.clientX, e.clientY);
      } else if (op.type === 'lasso') {
        op.path.remove();
        const tap = op.pts.length <= 4 || Math.max(...op.pts.map(p => Math.hypot(p[0] - op.pts[0][0], p[1] - op.pts[0][1]))) < 6 / this.k(op.s);
        const ids = tap ? this.pickAt(op.s, op.pts[0][0], op.pts[0][1]) : this.lassoSelect(op.s, op.pts);
        if (ids.size) this.setSelection(op.s, ids, tap ? null : op.pts); else this.clearSelection();
      } else if (op.type === 'move') {
        if (!cancelled && (Math.abs(op.dx || 0) > 0.5 || Math.abs(op.dy || 0) > 0.5)) await this.commitMove(op.dx, op.dy);
        else if (this.sel) { this.previewMove(0, 0); this.app.onObjectSelection && this.app.onObjectSelection(this, this.sel, e.clientX, e.clientY); }
      } else if (op.type === 'resize') {
        if (!cancelled && op.nw && op.a) await this.commitResize(op.a, op.nw);
      } else if (op.type === 'scale' || op.type === 'rotate') {
        const moved = op.v !== undefined && (op.type === 'scale' ? Math.abs(op.v - 1) > 0.005 : Math.abs(op.v) > 0.2);
        if (!cancelled && moved && this.sel) await this.commitXform(op.type, op.v);
        else if (this.sel) { this.previewXform(op.type, op.type === 'scale' ? 1 : 0); }
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

  eraseArea(hit) {
    const op = this.op, k = this.k(hit.s);
    const R = op.size / 2 / k;
    // mostra o círculo da borracha
    if (!op.cursor) { op.cursor = sv('circle', { class: 'erasecur', r: R, fill: 'rgba(180,35,44,.08)', stroke: '#B4232C', 'stroke-width': 1 / k, 'stroke-dasharray': `${3 / k} ${3 / k}` }); hit.s.live.appendChild(op.cursor); }
    op.cursor.setAttribute('cx', hit.x); op.cursor.setAttribute('cy', hit.y);
    for (const a of this.annsOf(hit.s.p.key)) {
      if (a.kind !== 'ink') continue;
      let segs = op.cuts.get(a.id);
      if (!segs) {
        if (!a.pts.some(p => Math.hypot(p[0] - hit.x, p[1] - hit.y) < R + a.width + 6)) continue;
        segs = [densify(a.pts, Math.max(0.5, R / 3))];
      }
      const r = cutSegments(segs, hit.x, hit.y, R);
      if (!r.changed) continue;
      op.cuts.set(a.id, r.segs);
      const el = hit.s.svg.querySelector(`[data-id="${a.id}"]`);
      if (el) el.setAttribute('d', r.segs.length ? segPath(r.segs, strokePath) : 'M0 0');
    }
  }

  // traço vindo da caneta rápida da Boox (pontos em coordenadas da tela)
  async fastStroke(o) {
    const pts = (o && o.pts) || [];
    if (!pts.length || !this.doc) return;
    const hit = this.slotAt(pts[0][0], pts[0][1]);
    if (!hit) return;
    const s = hit.s;
    const maxX = s.p.w * (this.hasMargin(s.p.key) ? 1 + MARGIN_FRAC : 1);
    const maxP = Math.max(...pts.map(q => q[2] || 0), 0);
    const t0 = pts[0][3] || 0;
    const loc = pts.map(q => { const pp = this.toPage(s, q[0], q[1], hit.region); return [
      +Math.max(0, Math.min(maxX, pp[0])).toFixed(2),
      +Math.max(0, Math.min(s.p.h, pp[1])).toFixed(2),
      +(maxP > 1 ? Math.min(1, (q[2] || 0) / maxP) * 0.8 : (q[2] || 0.5)).toFixed(2),
      Math.max(0, Math.round((q[3] || 0) - t0))]; });
    if (o.erase || this.app.tool === 'eraser') {
      this.op = this.eraseOp(s);
      for (const q of loc) this.eraseAt({ s, x: q[0], y: q[1] });
      const op = this.op; this.op = null;
      if (op.cursor) op.cursor.remove();
      if (op.area) { await this.commitCuts(op); return; }
      const del = (this.anns || []).filter(a => op.ids.has(a.id));
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
    this.maybeAutoPage(s, a.pts);
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
    for (const pl of (s.inPills || [])) if (x >= pl.x0 - 2 && x <= pl.x1 + 2 && y >= pl.y0 - 3 && y <= pl.y1 + 3) return { type: 'incoming', links: pl.links, s };
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
      const cr = s.cb ? s.clip.getBoundingClientRect() : pr;
      const mine = rects.filter(r => r.top + r.height / 2 >= Math.max(pr.top, cr.top) && r.top + r.height / 2 <= Math.min(pr.bottom, cr.bottom) && r.left < Math.min(pr.right, cr.right) && r.right > Math.max(pr.left, cr.left))
        .map(r => [(Math.max(r.left, pr.left) - pr.left) / this.k(s), (r.top - pr.top) / this.k(s), (Math.min(r.right, pr.right) - Math.max(r.left, pr.left)) / this.k(s), r.height / this.k(s)]);
      if (mine.length) segs.push({ pageKey: s.p.key, rects: mergeRects(mine) });
    }
    if (!segs.length) return null;
    const last = rects[rects.length - 1], first = rects[0];
    return { text, segs, box: { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)), top: first.top, bottom: last.bottom } };
  }
}

function pageTitle(p) { return p.kind === 'pdf' ? 'p. ' + p.n + (p.parts > 1 ? ' · parte ' + (p.part + 1) + ' de ' + p.parts : '') : p.kind === 'nb' ? (p.tpl === 'cover' ? 'Capa' : 'Página ' + p.n) : 'Página em branco'; }

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

// cantos de uma imagem (girada em torno do centro)
export function imgCorners(a) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2, t = (a.rot || 0) * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const dx = u * a.w / 2, dy = v * a.h / 2; return [cx + dx * c - dy * sn, cy + dx * sn + dy * c]; });
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
// aplica mover/escala/girar a uma anotação (cópia)
export function xformAnn(a, M, f, deg) {
  const c = JSON.parse(JSON.stringify(a));
  const r2 = v => +v.toFixed(2);
  if (c.kind === 'ink') c.pts = c.pts.map(p => { const q = M(p[0], p[1]); return [r2(q[0]), r2(q[1]), p[2], p[3]]; });
  else if (c.kind === 'img') {
    const q = M(c.x + c.w / 2, c.y + c.h / 2);
    c.w *= f; c.h *= f; c.x = q[0] - c.w / 2; c.y = q[1] - c.h / 2;
    if (deg) { let r = ((c.rot || 0) + deg) % 360; if (r > 180) r -= 360; if (r < -180) r += 360; c.rot = Math.abs(r) < 0.01 ? 0 : +r.toFixed(2); }
  } else if (c.kind === 'tbox') { const q = M(c.x, c.y); c.x = q[0]; c.y = q[1]; c.w *= f; }
  else if (c.kind === 'note') { const q = M(c.x, c.y); c.x = q[0]; c.y = q[1]; }
  else if (c.kind === 'link') c.rects = c.rects.map(r => { const q = M(r[0], r[1]); return [q[0], q[1], r[2] * f, r[3] * f]; });
  return c;
}
