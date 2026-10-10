// Folha de escrita à mão ao lado de um documento de texto (como a margem expandida dos PDFs).
// Cada traço fica preso ao parágrafo ao lado do qual foi escrito: se o texto crescer ou encolher
// acima dele, o traço acompanha. Fica só no app (não vai para o Obsidian).
import * as S from './store.js';
import { h, clear, icon, btn, uid, INK_COLORS, toast } from './util.js';
import { strokePath, strokeWidth } from './viewer.js';
import { densify, cutSegments, segPath, ERASER_SIZES } from './eraser.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (t, a) => { const e = document.createElementNS(SVGNS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const KEY = 'textink';

// chave estável de um parágrafo: começo do texto + quantas vezes esse começo já apareceu
export function blockKeys(blocks) {
  const seen = {};
  return blocks.map(md => {
    const base = String(md || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(vazio)';
    seen[base] = (seen[base] || 0) + 1;
    return base + '#' + seen[base];
  });
}

export class InkPad {
  constructor(screen) {
    this.t = screen;                    // TextScreen
    this.tool = 'pen';
    this.col = h('div.inkcol', { 'aria-label': 'Folha de escrita à mão' });
    this.bar = h('div.inkbar');
    this.svg = sv('svg', { class: 'inksvg' });
    this.g = sv('g', {}); this.live = sv('g', {});
    this.svg.append(this.g, this.live);
    this.col.append(this.bar, this.svg);
    this.anns = [];
    this.bind();
    this.renderBar();
    this.off = S.on('annots', e => { if (this.on && this.t.doc && e && e.docId === this.t.doc.id) this.load(); });
  }

  get on() { return !!this.col.isConnected; }

  renderBar() {
    clear(this.bar);
    const st = this.t.app.reader.settings || {};
    // a folha nunca deixa o navegador rolar sozinho: a caneta só escreve; o dedo rola (feito aqui mesmo)
    this.svg.style.touchAction = 'none';
    const tb = (id, ic, label) => btn(ic, '', () => { this.tool = id; this.renderBar(); }, { title: label, iconOnly: true, cls: 'ibtn small', pressed: this.tool === id });
    this.bar.append(tb('pen', 'pen', 'Caneta'), tb('marker', 'marker', 'Marca-texto'), tb('eraser', 'eraser', 'Borracha'),
      h('span.inksep'),
      ...INK_COLORS.slice(0, 5).map(c => h('button.dot.small', { type: 'button', 'aria-label': 'Cor ' + c, style: { background: c }, 'aria-pressed': String((st.penColor || INK_COLORS[0]) === c), onclick: async () => { await S.setSettings({ penColor: c }); this.t.app.reader.settings = await S.settings(); this.renderBar(); } })),
      this.tool === 'eraser' ? h('span.inksep') : null,
      this.tool === 'eraser' ? h('button.ebtn', { type: 'button', 'aria-pressed': String((st.eraserMode || 'stroke') === 'stroke'), onclick: async () => { await S.setSettings({ eraserMode: 'stroke' }); this.t.app.reader.settings = await S.settings(); this.renderBar(); } }, 'Traço') : null,
      this.tool === 'eraser' ? h('button.ebtn', { type: 'button', 'aria-pressed': String(st.eraserMode === 'area'), onclick: async () => { await S.setSettings({ eraserMode: 'area' }); this.t.app.reader.settings = await S.settings(); this.renderBar(); } }, 'Área') : null,
      ...(this.tool === 'eraser' && st.eraserMode === 'area' ? ERASER_SIZES.map(z => h('button.wbtn', { type: 'button', 'aria-label': 'Tamanho ' + z, 'aria-pressed': String((st.eraserSize || 20) === z), onclick: async () => { await S.setSettings({ eraserSize: z }); this.t.app.reader.settings = await S.settings(); this.renderBar(); } }, h('span.esz', { style: { width: Math.min(24, z / 2 + 4) + 'px', height: Math.min(24, z / 2 + 4) + 'px' } }))) : []),
      h('span.grow'),
      btn('undo', '', () => this.t.undo(), { title: 'Desfazer', iconOnly: true, cls: 'ibtn small' }),
      btn('close', '', () => this.t.toggleInk(false), { title: 'Fechar a folha de escrita', iconOnly: true, cls: 'ibtn small' }));
  }

  async load() {
    if (!this.t.doc) return;
    this.anns = (await S.annots(this.t.doc.id)).filter(a => a.kind === 'ink' && a.pageKey === KEY);
    this.layout();
  }

  // posição (topo) de cada parágrafo, relativa ao topo da folha
  blockTops() {
    const keys = blockKeys(this.t.blocks);
    const base = this.col.getBoundingClientRect().top;
    const map = new Map();
    this.t.article.querySelectorAll('.tblock, .tdedit').forEach(el => {
      const i = +((el.dataset && el.dataset.i) || (this.t.cur && this.t.cur.i));
      if (!isNaN(i) && keys[i]) map.set(keys[i], el.getBoundingClientRect().top - base);
    });
    return { map, keys };
  }

  layout() {
    if (!this.on) return;
    const H = Math.max(this.t.article.offsetHeight, this.t.pane.clientHeight);
    this.col.style.height = H + 'px';
    const W = this.col.clientWidth;
    this.svg.setAttribute('width', W); this.svg.setAttribute('height', H);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.tops = this.blockTops();
    clear(this.g);
    for (const a of this.anns) {
      const top = this.tops.map.has(a.anchor) ? this.tops.map.get(a.anchor) : (a.y0 || 0);
      const p = sv('path', { d: strokePath(a.pts), stroke: a.color, 'stroke-width': strokeWidth(a), fill: 'none', 'stroke-linecap': a.tool === 'marker' ? 'butt' : 'round', 'stroke-linejoin': 'round', transform: `translate(0 ${top.toFixed(1)})`, 'data-id': a.id });
      if (a.tool === 'marker') p.setAttribute('opacity', '0.42');
      this.g.appendChild(p);
    }
  }

  // parágrafo ao lado do ponto y (o último que começa acima dele)
  anchorAt(y) {
    let best = null, top = 0;
    for (const [k, t] of this.tops.map) if (t <= y + 4 && (best === null || t >= top)) { best = k; top = t; }
    return best ? { key: best, top } : { key: '', top: 0 };
  }

  bind() {
    const el = this.svg;
    const pt = e => { const r = this.svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const canDraw = e => e.pointerType === 'pen' || e.pointerType === 'mouse' || !((this.t.app.reader.settings || {}).penOnly);
    const erasing = e => this.tool === 'eraser' || (e.pointerType === 'pen' && (((e.buttons || 0) & 32) || ((e.buttons || 0) & 2) || window.__penBtn === true));
    el.addEventListener('pointerdown', e => {
      if (!canDraw(e)) {   // dedo com "só a caneta escreve": rola o texto
        if (e.pointerType === 'touch') { this.pan = { id: e.pointerId, y: e.clientY }; try { el.setPointerCapture(e.pointerId); } catch (er) {} }
        return;
      }
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
      this.tops = this.blockTops();
      const [x, y] = pt(e);
      if (erasing(e)) { const st0 = this.t.app.reader.settings || {}; this.op = { erase: true, ids: new Set(), id: e.pointerId, area: st0.eraserMode === 'area', size: st0.eraserSize || 20, cuts: new Map() }; this.eraseAt(x, y); return; }
      const st = this.t.app.reader.settings || {};
      const marker = this.tool === 'marker';
      const an = this.anchorAt(y);
      const a = { kind: 'ink', tool: marker ? 'marker' : 'pen', docId: this.t.doc.id, pageKey: KEY, anchor: an.key, y0: an.top, color: marker ? (st.markerColor || '#F2C94C') : (st.penColor || INK_COLORS[0]), width: marker ? 11 : (st.penWidth || 2), pts: [] };
      const path = sv('path', { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      if (marker) path.setAttribute('opacity', '0.42');
      this.live.appendChild(path);
      this.op = { a, path, top: an.top, t0: Date.now(), id: e.pointerId };
      this.add(e);
    });
    el.addEventListener('pointermove', e => {
      if (this.pan && this.pan.id === e.pointerId) { this.t.pane.scrollTop -= e.clientY - this.pan.y; this.pan.y = e.clientY; return; }
      const op = this.op; if (!op || op.id !== e.pointerId) return;
      e.preventDefault();
      if (op.erase) { const [x, y] = pt(e); this.eraseAt(x, y); return; }
      this.add(e);
    });
    const end = async (e, cancel) => {
      if (this.pan && this.pan.id === e.pointerId) { this.pan = null; return; }
      const op = this.op; if (!op || op.id !== e.pointerId) return;
      this.op = null;
      if (op.erase && op.area) {
        const olds = [], news = [];
        for (const [id, segs] of op.cuts) { const a = this.anns.find(x => x.id === id); if (!a) continue; olds.push(a); for (const sg of segs) if (sg.length > 1) news.push(Object.assign(JSON.parse(JSON.stringify(a)), { id: uid('a'), pts: sg })); }
        if (olds.length) await S.group(this.t.doc.id, async () => { await S.delAnnots(olds); if (news.length) await S.putAnnotsGroup(news); });
        return;
      }
      if (op.erase) { const del = this.anns.filter(a => op.ids.has(a.id)); if (del.length) await S.delAnnots(del); return; }
      op.path.remove();
      if (cancel || !op.a.pts.length) return;
      op.a.id = uid('a');
      this.anns.push(op.a); this.layout();
      await S.putAnnot(op.a);
    };
    el.addEventListener('pointerup', e => end(e));
    el.addEventListener('pointercancel', e => end(e, true));
  }

  add(e) {
    const op = this.op;
    const r = this.svg.getBoundingClientRect();
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (!evs || !evs.length) evs = [e];
    for (const ev of evs) {
      const x = ev.clientX - r.left, y = ev.clientY - r.top - op.top;
      const p = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
      const last = op.a.pts[op.a.pts.length - 1];
      if (last && Math.hypot(last[0] - x, last[1] - y) < 0.7) continue;
      op.a.pts.push([+x.toFixed(1), +y.toFixed(1), +p.toFixed(2), Date.now() - op.t0]);
    }
    op.path.setAttribute('d', strokePath(op.a.pts.map(q => [q[0], q[1] + op.top, q[2]])));
    op.path.setAttribute('stroke-width', strokeWidth(op.a));
  }

  eraseAt(x, y) {
    if (this.op.area) {
      const R = this.op.size / 2;
      for (const a of this.anns) {
        const top = this.tops.map.has(a.anchor) ? this.tops.map.get(a.anchor) : (a.y0 || 0);
        let segs = this.op.cuts.get(a.id);
        if (!segs) { if (!a.pts.some(q => Math.hypot(q[0] - x, q[1] + top - y) < R + a.width + 6)) continue; segs = [densify(a.pts, Math.max(0.5, R / 3))]; }
        const r = cutSegments(segs, x, y - top, R);
        if (!r.changed) continue;
        this.op.cuts.set(a.id, r.segs);
        const el = this.g.querySelector(`[data-id="${a.id}"]`); if (el) el.setAttribute('d', r.segs.length ? segPath(r.segs, strokePath) : 'M0 0');
      }
      return;
    }
    for (const a of this.anns) {
      if (this.op.ids.has(a.id)) continue;
      const top = this.tops.map.has(a.anchor) ? this.tops.map.get(a.anchor) : (a.y0 || 0);
      if (a.pts.some(q => Math.hypot(q[0] - x, q[1] + top - y) < 9 + a.width / 2)) {
        this.op.ids.add(a.id);
        const el = this.g.querySelector(`[data-id="${a.id}"]`); if (el) el.style.display = 'none';
      }
    }
  }
}
