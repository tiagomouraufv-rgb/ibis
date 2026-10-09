// Tela do leitor: ferramentas, menu de seleção, painel lateral, Digest, links, notas, voz, IA.
import { Viewer, darker } from './viewer.js';
import * as S from './store.js';
import { openPdf, getPage, pageList, pageText, resolveDest, outline, pageLabel, pageNum } from './pdfdoc.js';
import { h, clear, icon, btn, toast, modal, popMenu, promptBox, confirmBox, copyText, cleanText, fold, CATS, catInfo, INK_COLORS, uid, fmtTime, debounce } from './util.js';
import { recordVoiceNote, SessionRecorder, playAudio } from './audio.js';
import * as AI from './ai.js';
import { openExportDialog, openObsidianDialog, openMetaDialog, showAiResult, openBriefing } from './dialogs.js';
import { digestPanel } from './digestui.js';
import { speak, stopSpeak } from './tts.js';
import { openExternal, openUri } from './platform.js';
import { translatePop, wikiPop } from './lookup.js';

export class Reader {
  constructor(app) {
    this.app = app;
    this.tool = 'read';
    this.viewers = [];
    this.active = null;
    this.docHist = [];
    this.picking = null;
    this.recorder = new SessionRecorder(() => this.updateRecBtn());
    this.root = h('div.reader');
    this.buildChrome();
    S.on('settings', st => { this.settings = st; this.applyPdfMode(); });
    S.on('annots', () => { if (this.sideTab && this.sideOpen) this.renderSide(); });
    document.addEventListener('selectionchange', debounce(() => this.onSelection(), 220));
    // enquanto arrasta a seleção, o menu fica escondido; ao soltar, aparece
    const sc = e => { if (this.root.isConnected && e.target.closest && e.target.closest('.textLayer')) this.selDragging = true; };
    const up = () => { if (this.selDragging) { this.selDragging = false; setTimeout(() => this.onSelection(), 30); } };
    document.addEventListener('pointerdown', sc, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', e => {
      if (!this.root.isConnected) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); this.redo(); }
    });
  }

  get doc() { return this.active && this.active.doc; }

  // ---------- estrutura ----------
  buildChrome() {
    const r = this.root;
    this.titleEl = h('div.rtitle');
    this.pageEl = h('div.rpage');
    this.backBtn = btn('undo', 'Voltar', () => this.goBack(), { cls: 'sbtn backlink', title: 'Voltar ao ponto anterior' });
    this.backBtn.style.display = 'none';
    this.recBtn = btn('rec', '', () => this.toggleRec(), { title: 'Gravar sessão (áudio sincronizado com a escrita)', iconOnly: true });
    this.recBtn.classList.add('recbtn');
    this.modeBtn = btn('sun', '', () => this.cyclePdfMode(), { title: 'Modo da página: normal, sépia, escuro', iconOnly: true });
    const top = h('header.rtop',
      btn('back', '', () => this.app.showLibrary(), { title: 'Biblioteca', iconOnly: true }),
      btn('list', '', () => this.toggleSide(), { title: 'Painel lateral: sumário, páginas, anotações, busca', iconOnly: true }),
      h('div.rtitles', this.titleEl, this.pageEl),
      this.backBtn,
      h('div.grow'),
      btn('search', '', () => this.toggleSide('busca'), { title: 'Buscar no PDF', iconOnly: true }),
      btn('split', '', () => this.toggleSplit(), { title: 'Lado a lado', iconOnly: true }),
      this.modeBtn,
      this.recBtn,
      btn('digest', 'Digest', () => this.app.showDigest(), { cls: 'sbtn hide-sm' }),
      btn('upload', 'Exportar', () => openExportDialog(this.doc), { cls: 'pbtn' }),
      btn('more', '', e => this.moreMenu(e), { title: 'Mais opções', iconOnly: true }),
    );
    // barra de ferramentas (lateral)
    this.toolBtns = {};
    const tb = (id, ic, label) => { const b = btn(ic, '', () => this.setTool(id), { title: label, iconOnly: true, cls: 'ibtn tool' }); this.toolBtns[id] = b; return b; };
    this.colorBox = h('div.colors');
    this.widthBox = h('div.widths');
    const rail = h('nav.rail', { 'aria-label': 'Ferramentas' },
      tb('read', 'select', 'Ler e selecionar texto'),
      tb('pen', 'pen', 'Caneta (só a S Pen escreve)'),
      tb('marker', 'marker', 'Marca-texto livre'),
      tb('eraser', 'eraser', 'Borracha'),
      tb('linkrect', 'link', 'Criar link: desenhe um retângulo'),
      tb('note', 'note', 'Nota: toque no lugar'),
      h('div.rsep'), this.colorBox, this.widthBox, h('div.rsep'),
      btn('undo', '', () => this.undo(), { title: 'Desfazer', iconOnly: true, cls: 'ibtn tool' }),
      btn('redo', '', () => this.redo(), { title: 'Refazer', iconOnly: true, cls: 'ibtn tool' }),
      btn('margin', '', () => this.toggleMargin(), { title: 'Margem expandida nesta página', iconOnly: true, cls: 'ibtn tool' }),
      h('div.grow'),
      this.penHint = h('div.penhint'),
    );
    this.side = h('aside.side');
    this.panes = h('div.panes');
    this.right = h('aside.rpanel');
    this.pill = h('div.pill');
    this.selMenu = h('div.selmenu', { role: 'toolbar', 'aria-label': 'Ações do trecho selecionado' });
    r.append(top, h('div.rbody', rail, this.side, this.panes, this.right), this.selMenu, this.pill);
  }

  async open(doc, at) {
    this.settings = await S.settings();
    if (!this.viewers.length) this.addViewer();
    for (const v of this.viewers.slice(1)) this.closeViewer(v);
    this.active = this.viewers[0];
    await this.active.open(doc, at);
    this.afterOpen();
  }

  afterOpen() {
    this.titleEl.textContent = S.docTitle(this.doc);
    this.setTool(this.tool);
    this.applyPdfMode();
    this.onNav(this.active);
    if (this.sideOpen) this.renderSide();
    this.app.indexDoc(this.doc);
  }

  addViewer() {
    const v = new Viewer(this, this.panes);
    this.viewers.push(v);
    this.panes.classList.toggle('two', this.viewers.length > 1);
    return v;
  }

  closeViewer(v) {
    v.destroy();
    this.viewers = this.viewers.filter(x => x !== v);
    if (this.active === v) this.active = this.viewers[0];
    this.panes.classList.toggle('two', this.viewers.length > 1);
    this.viewers.forEach(x => x.relayout(true));
  }

  setActiveViewer(v) {
    if (this.active === v) return;
    this.active = v;
    this.viewers.forEach(x => x.el.classList.toggle('active', x === v && this.viewers.length > 1));
    this.titleEl.textContent = S.docTitle(this.doc);
    this.onNav(v);
    if (this.sideOpen) this.renderSide();
  }

  // ---------- ferramentas ----------
  setTool(id) {
    this.tool = id;
    for (const k in this.toolBtns) this.toolBtns[k].setAttribute('aria-pressed', String(k === id));
    this.viewers.forEach(v => v.applyMode());
    this.renderColors();
    const st = this.settings || {};
    this.penHint.textContent = id === 'read' ? 'Dedo e caneta selecionam texto' : (st.penOnly ? 'Só a S Pen escreve · o dedo arrasta e dá zoom' : 'Dedo e caneta escrevem');
    if (id !== 'read') { window.getSelection().removeAllRanges(); this.hideSel(); }
  }

  renderColors() {
    clear(this.colorBox); clear(this.widthBox);
    const st = this.settings || {};
    if (this.tool === 'pen') {
      for (const c of INK_COLORS) this.colorBox.appendChild(h('button.dot', { type: 'button', 'aria-label': 'Cor ' + c, style: { background: c }, 'aria-pressed': String(st.penColor === c), onclick: () => S.setSettings({ penColor: c }).then(() => this.renderColors()) }));
      for (const w of [1.2, 2, 3.5]) this.widthBox.appendChild(h('button.wbtn', { type: 'button', 'aria-label': 'Espessura ' + w, 'aria-pressed': String(st.penWidth === w), onclick: () => S.setSettings({ penWidth: w }).then(() => this.renderColors()) }, h('span', { style: { height: (w * 1.6) + 'px', background: st.penColor } })));
    } else if (this.tool === 'marker') {
      for (const c of CATS.map(x => x.color)) this.colorBox.appendChild(h('button.dot', { type: 'button', 'aria-label': 'Cor ' + c, style: { background: c }, 'aria-pressed': String(st.markerColor === c), onclick: () => S.setSettings({ markerColor: c }).then(() => this.renderColors()) }));
    }
  }

  async undo() { if (!(await S.undo())) toast('Nada para desfazer.'); }
  async redo() { if (!(await S.redo())) toast('Nada para refazer.'); }

  async toggleMargin(key) {
    const v = this.active; if (!v) return;
    key = key || v.currentKey();
    v.doc.margins = v.doc.margins || {};
    if (v.doc.margins[key]) {
      const outside = (await S.annots(v.doc.id)).filter(a => a.pageKey === key && a.kind === 'ink' && a.pts.some(p => p[0] > (v.pages.find(x => x.key === key) || { w: 1e9 }).w));
      if (outside.length && !(await confirmBox('Fechar a margem', 'Há escrita na margem desta página. Ela continua guardada e volta quando você abrir a margem de novo.', 'Fechar margem'))) return;
      delete v.doc.margins[key];
    } else v.doc.margins[key] = true;
    await S.saveDoc(v.doc);
    this.viewers.filter(x => x.doc && x.doc.id === v.doc.id).forEach(x => { x.doc = v.doc; x.relayout(true); });
    toast(v.doc.margins[key] ? 'Margem aberta nesta página. Escreva nela com a S Pen.' : 'Margem fechada.');
  }

  applyPdfMode() {
    const m = (this.settings && this.settings.pdfMode) || 'normal';
    this.root.dataset.pdfmode = m;
  }
  cyclePdfMode() {
    const order = ['normal', 'sepia', 'escuro'];
    const cur = (this.settings && this.settings.pdfMode) || 'normal';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    S.setSettings({ pdfMode: next });
    toast('Página: ' + { normal: 'normal', sepia: 'sépia', escuro: 'escura' }[next]);
  }

  // ---------- navegação ----------
  onNav(v) {
    if (v !== this.active || !v.doc) return;
    const k = v.currentKey();
    const p = v.pages.find(x => x.key === k);
    const N = v.hd ? v.hd.pdf.numPages : 0;
    this.pageEl.textContent = p ? (p.kind === 'pdf' ? 'p. ' + p.n + ' de ' + N : 'página em branco') : '';
    this.backBtn.style.display = (v.hist.length || this.docHist.length) ? '' : 'none';
    this.toolBtns && this.root.querySelector('[title="Margem expandida nesta página"]').setAttribute('aria-pressed', String(!!(v.doc.margins && v.doc.margins[k])));
  }
  onZoom() {}

  async goBack() {
    const v = this.active;
    if (v.hist.length) { v.back(); return; }
    const p = this.docHist.pop();
    if (p) { const d = await S.getDoc(p.docId); if (d) { await v.open(d, { key: p.key, y: p.y }); this.afterOpen(); } }
    this.onNav(v);
  }

  // abre um destino (página de um documento); usa o outro painel quando estiver lado a lado
  async jump(target, fromViewer) {
    const v = fromViewer || this.active;
    if (target.docId === v.doc.id) { v.goTo(target.pageKey, target.y || 0, { flash: true }); this.onNav(v); return; }
    const d = await S.getDoc(target.docId);
    if (!d) { toast('O documento de destino não está mais na biblioteca.'); return; }
    if (this.viewers.length > 1) {
      const other = this.viewers.find(x => x !== v);
      if (other.doc && other.doc.id === d.id) other.goTo(target.pageKey, target.y || 0, { flash: true });
      else await other.open(d, { key: target.pageKey, y: target.y || 0 });
      return;
    }
    this.docHist.push({ docId: v.doc.id, key: v.currentKey(), y: v.currentOffset() });
    await v.open(d, { key: target.pageKey, y: target.y || 0 });
    this.afterOpen();
    setTimeout(() => { const s = v.slots.get(target.pageKey); if (s && target.y) v.flashAt(s, target.y); }, 300);
  }

  async toggleSplit() {
    if (this.viewers.length > 1) { this.closeViewer(this.viewers[1]); return; }
    const docs = await S.allDocs();
    const list = h('div.picklist',
      h('button.pickrow', { type: 'button', onclick: async () => { m.close(); const v = this.addViewer(); await v.open(this.doc, { key: this.active.currentKey(), y: 0 }); this.viewers[0].relayout(true); } }, h('b', 'Este mesmo documento'), h('span.muted', 'para ver duas partes ao mesmo tempo')),
      docs.filter(d => d.id !== this.doc.id).map(d => h('button.pickrow', { type: 'button', onclick: async () => { m.close(); const v = this.addViewer(); await v.open(d); this.viewers[0].relayout(true); } }, h('b', S.docTitle(d)), h('span.muted', d.fileName || ''))));
    const m = modal('Abrir lado a lado', list);
  }

  // ---------- painel lateral ----------
  toggleSide(tab) {
    if (tab && this.sideOpen && this.sideTab !== tab) { this.sideTab = tab; this.renderSide(); return; }
    this.sideOpen = !this.sideOpen;
    if (tab) this.sideTab = tab;
    this.sideTab = this.sideTab || 'sumario';
    this.side.classList.toggle('open', this.sideOpen);
    if (this.sideOpen) this.renderSide();
    setTimeout(() => this.viewers.forEach(v => v.relayout(true)), 260);
  }

  async renderSide() {
    const tabs = [['sumario', 'Sumário'], ['paginas', 'Páginas'], ['anotacoes', 'Anotações'], ['busca', 'Busca'], ['ligacoes', 'Ligações']];
    clear(this.side);
    const head = h('div.stabs', { role: 'tablist' }, tabs.map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.sideTab === id), onclick: () => { this.sideTab = id; this.renderSide(); } }, l)));
    const body = h('div.sbody');
    this.side.append(head, body);
    const v = this.active; if (!v || !v.doc) return;
    const fn = { sumario: this.sideOutline, paginas: this.sidePages, anotacoes: this.sideAnnots, busca: this.sideSearch, ligacoes: this.sideLinks }[this.sideTab];
    await fn.call(this, body, v);
  }

  async sideOutline(body, v) {
    const bms = (v.doc.bookmarks || []);
    body.appendChild(h('div.shead', h('span', 'Marcadores'), btn('bookmark', 'Marcar esta página', () => this.toggleBookmark(v.currentKey()), { cls: 'sbtn small' })));
    if (!bms.length) body.appendChild(h('p.muted.pad', 'Nenhum marcador. Use “Marcar esta página” ou o menu ⋯ de cada página.'));
    for (const b of bms.slice().sort((a, c) => v.pages.findIndex(p => p.key === a.key) - v.pages.findIndex(p => p.key === c.key))) {
      body.appendChild(h('button.srow', { type: 'button', onclick: () => v.goTo(b.key, 0) }, icon('bookmark', 16), h('span.grow', b.label || 'Marcador'), h('span.muted', pageLabel(b.key))));
    }
    body.appendChild(h('div.shead', h('span', 'Sumário do PDF')));
    const ol = await outline(v.hd);
    if (!ol.length) { body.appendChild(h('p.muted.pad', 'Este PDF não tem sumário interno (índice com links).')); return; }
    const walk = (items, depth, parent) => {
      for (const it of items) {
        const row = h('button.srow', { type: 'button', style: { paddingLeft: (10 + depth * 16) + 'px' }, onclick: async () => {
          if (it.dest) { const d = await resolveDest(v.hd, it.dest); if (d) v.goTo('p' + d.n, d.y, { flash: true }); }
          else if (it.url) openExternal(it.url);
        } }, h('span.grow', it.title));
        if (depth === 0) row.classList.add('bold');
        parent.appendChild(row);
        if (it.items && it.items.length) walk(it.items, depth + 1, parent);
      }
    };
    walk(ol, 0, body);
  }

  async sidePages(body, v) {
    const grid = h('div.thumbs');
    body.appendChild(grid);
    const io = new IntersectionObserver(async es => {
      for (const e of es) if (e.isIntersecting && !e.target.dataset.done) {
        e.target.dataset.done = '1';
        const p = v.pages.find(x => x.key === e.target.dataset.key);
        if (p.kind !== 'pdf') continue;
        const pg = await getPage(v.hd, p.n);
        const vp = pg.getViewport({ scale: 110 / p.w });
        const c = h('canvas'); c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        e.target.querySelector('.tpage').appendChild(c);
      }
    }, { root: body, rootMargin: '300px' });
    const anns = await S.annots(v.doc.id);
    for (const p of v.pages) {
      const n = anns.filter(a => a.pageKey === p.key).length;
      const bm = (v.doc.bookmarks || []).some(b => b.key === p.key);
      const t = h('div.thumb', { 'data-key': p.key },
        h('button.tpage' + (p.kind === 'blank' ? '.blank' : ''), { type: 'button', 'aria-label': 'Ir para ' + pageLabel(p.key), style: { aspectRatio: p.w + ' / ' + p.h }, onclick: () => v.goTo(p.key, 0) }),
        h('div.tlabel', h('span', (bm ? '🔖 ' : '') + (p.kind === 'pdf' ? p.n : 'branco')), n ? h('span.badge', String(n)) : null,
          h('button.ibtn.small', { type: 'button', 'aria-label': 'Opções', onclick: e => this.pageMenu(v, p, e.clientX, e.clientY) }, icon('more', 16))));
      grid.appendChild(t); io.observe(t);
    }
  }

  async sideAnnots(body, v) {
    const f = this.annFilter || 'todas';
    const chips = [['todas', 'Todas'], ...CATS.map(c => ['cat:' + c.id, c.label]), ['underline', 'Sublinhado'], ['strike', 'Tachado'], ['note', 'Notas'], ['voz', 'Voz'], ['ink', 'Escrita'], ['link', 'Links'], ['rec', 'Gravações']];
    body.appendChild(h('div.chips', chips.map(([id, l]) => h('button.chip', { type: 'button', 'aria-pressed': String(f === id), onclick: () => { this.annFilter = id; this.renderSide(); } }, l))));
    if (f === 'rec') {
      const recs = await S.recordings(v.doc.id);
      if (!recs.length) body.appendChild(h('p.muted.pad', 'Nenhuma gravação neste documento. Use o botão ● no topo para gravar enquanto escreve.'));
      for (const r of recs) body.appendChild(h('div.srow', btn('play', '', () => playAudio(r.fileId, 0, r.title), { iconOnly: true, title: 'Ouvir' }), h('span.grow', r.title), h('span.muted', fmtTime(r.duration)), btn('trash', '', async () => { if (await confirmBox('Apagar gravação', 'Apagar “' + r.title + '”? Os traços continuam, mas perdem o áudio.', 'Apagar', true)) { await S.deleteRecording(r); this.renderSide(); } }, { iconOnly: true, title: 'Apagar' })));
      return;
    }
    let list = (await S.annots(v.doc.id)).slice();
    const order = k => v.pages.findIndex(p => p.key === k);
    list.sort((a, b) => (order(a.pageKey) - order(b.pageKey)) || ((a.rects ? a.rects[0][1] : a.y || (a.pts ? a.pts[0][1] : 0)) - (b.rects ? b.rects[0][1] : b.y || (b.pts ? b.pts[0][1] : 0))));
    list = list.filter(a => {
      if (f === 'todas') return a.kind !== 'ink';
      if (f.startsWith('cat:')) return a.kind === 'hl' && (a.cat || '') === f.slice(4) && (!a.style || a.style === 'highlight');
      if (f === 'underline' || f === 'strike') return a.kind === 'hl' && a.style === f;
      if (f === 'note') return a.kind === 'note' || (a.kind === 'hl' && a.note);
      if (f === 'voz') return !!a.audioId;
      return a.kind === f;
    });
    if (f === 'ink') {
      const pages = [...new Set(list.map(a => a.pageKey))];
      if (!pages.length) body.appendChild(h('p.muted.pad', 'Nenhuma escrita à mão.'));
      for (const k of pages) body.appendChild(h('button.srow', { type: 'button', onclick: () => v.goTo(k, 0) }, icon('pen', 16), h('span.grow', list.filter(a => a.pageKey === k).length + ' traços'), h('span.muted', pageLabel(k))));
      return;
    }
    if (!list.length) body.appendChild(h('p.muted.pad', 'Nada aqui ainda.'));
    for (const a of list) {
      const ci = catInfo(a.cat);
      const y = a.rects ? a.rects[0][1] : a.y || 0;
      const sw = a.kind === 'hl' ? h('span.sw', { style: { background: a.style === 'strike' ? '#B4232C' : (a.color || ci.color) } }, ci.sym) : icon(a.kind === 'note' ? (a.audioId && !a.text ? 'mic' : 'note') : a.kind === 'link' ? 'link' : 'pen', 16);
      const txt = a.kind === 'hl' ? (a.text || '') : a.kind === 'note' ? (a.text || 'Nota de voz') : a.kind === 'link' ? ('→ ' + (a.targetLabel || 'link')) : '';
      body.appendChild(h('button.srow.ann', { type: 'button', onclick: () => v.goTo(a.pageKey, y, { flash: true }) }, sw,
        h('div.grow', h('div.clamp', txt), a.note ? h('div.muted.clamp', 'Nota: ' + a.note) : null),
        h('span.muted', pageLabel(a.pageKey))));
    }
  }

  async sideSearch(body, v) {
    const inp = h('input', { type: 'search', placeholder: 'Buscar neste PDF…', value: this.lastQuery || '' });
    const res = h('div');
    body.append(h('div.pad', inp), res);
    const run = async () => {
      const q = inp.value.trim(); this.lastQuery = q; clear(res);
      if (q.length < 2) return;
      const fq = fold(q);
      res.appendChild(h('p.muted.pad', 'Buscando…'));
      const out = [];
      for (let n = 1; n <= v.hd.pdf.numPages; n++) {
        const t = await pageText(v.hd, n);
        const ft = fold(t);
        let i = ft.indexOf(fq), c = 0;
        while (i >= 0 && c < 20) { out.push({ n, i, t }); c++; i = ft.indexOf(fq, i + fq.length); }
      }
      // anotações e notas também
      for (const a of await S.annots(v.doc.id)) {
        const t = (a.text || '') + ' ' + (a.note || '');
        if (fold(t).includes(fq)) out.push({ ann: a, t });
      }
      clear(res);
      res.appendChild(h('p.muted.pad', out.length + ' resultado(s)'));
      for (const r of out.slice(0, 300)) {
        if (r.ann) {
          res.appendChild(h('button.srow', { type: 'button', onclick: () => v.goTo(r.ann.pageKey, r.ann.rects ? r.ann.rects[0][1] : r.ann.y || 0, { flash: true }) }, icon('note', 16), h('span.grow.clamp', r.t.trim()), h('span.muted', pageLabel(r.ann.pageKey))));
          continue;
        }
        const s = Math.max(0, r.i - 40);
        const snip = (s > 0 ? '…' : '') + r.t.slice(s, r.i) ;
        const row = h('button.srow', { type: 'button', onclick: async () => { const y = await this.findY(v, r.n, q); v.goTo('p' + r.n, y, { flash: true }); } },
          h('span.grow.clamp', snip, h('mark', r.t.slice(r.i, r.i + q.length)), r.t.slice(r.i + q.length, r.i + q.length + 60) + '…'), h('span.muted', 'p. ' + r.n));
        res.appendChild(row);
      }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    inp.addEventListener('input', debounce(run, 500));
    setTimeout(() => inp.focus(), 50);
    if (inp.value) run();
  }

  async findY(v, n, q) {
    try {
      const pg = await getPage(v.hd, n);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const fq = fold(q);
      for (const it of tc.items) if (fold(it.str).includes(fq.slice(0, Math.min(fq.length, 12)))) {
        const [, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return Math.max(0, y - (it.height || 10));
      }
    } catch (e) {}
    return 0;
  }

  async sideLinks(body, v) {
    const docs = await S.allDocs();
    const all = await S.allAnnots();
    const out = all.filter(a => a.kind === 'link' && a.docId === v.doc.id);
    const inc = all.filter(a => a.kind === 'link' && a.target && a.target.type === 'page' && a.target.docId === v.doc.id);
    body.appendChild(h('div.shead', h('span', 'Saindo deste documento'), btn('plus', 'Novo link', () => this.linkBuilder(v, { pageKey: v.currentKey(), rects: [[10, 10, 60, 14]], text: '', pageLink: true }), { cls: 'sbtn small' })));
    if (!out.length) body.appendChild(h('p.muted.pad', 'Selecione um trecho e toque em “Link”, ou use a ferramenta de link (retângulo) na barra lateral.'));
    for (const a of out) body.appendChild(h('div.srow', h('button.grow.linkrow', { type: 'button', onclick: () => v.goTo(a.pageKey, a.rects[0][1], { flash: true }) }, h('div.clamp', (a.text ? '“' + a.text.slice(0, 60) + '” ' : '') + '→ ' + (a.targetLabel || '')), h('div.muted', pageLabel(a.pageKey))),
      btn('fwd', '', () => this.followLink(v, a), { iconOnly: true, title: 'Seguir o link' })));
    body.appendChild(h('div.shead', h('span', 'Chegando aqui (links de volta)')));
    if (!inc.length) body.appendChild(h('p.muted.pad', 'Nenhum link aponta para este documento.'));
    for (const a of inc) {
      const sd = docs.find(d => d.id === a.docId);
      body.appendChild(h('button.srow', { type: 'button', onclick: () => this.jump({ docId: a.docId, pageKey: a.pageKey, y: a.rects[0][1] }) },
        icon('back', 16), h('div.grow', h('div.clamp', (sd ? S.docTitle(sd) : '?') + ' · ' + pageLabel(a.pageKey)), h('div.muted.clamp', (a.text || '') + ' → ' + pageLabel(a.target.pageKey)))));
    }
  }

  incomingLinks(docId, pageKey) {
    const all = this.app.linkIndex || [];
    return all.filter(a => a.target && a.target.type === 'page' && a.target.docId === docId && a.target.pageKey === pageKey && !(a.docId === docId && a.pageKey === pageKey));
  }

  // ---------- menu da página ----------
  pageMenu(v, p, x, y) {
    const bm = (v.doc.bookmarks || []).some(b => b.key === p.key);
    const mg = !!(v.doc.margins && v.doc.margins[p.key]);
    popMenu(x, y, [
      { icon: 'bookmark', label: bm ? 'Remover marcador' : 'Marcar esta página', onclick: () => this.toggleBookmark(p.key, v) },
      { icon: 'blank', label: 'Inserir página em branco depois', onclick: () => this.insertBlank(v, p, false) },
      p.index === 0 ? { icon: 'blank', label: 'Inserir página em branco antes', onclick: () => this.insertBlank(v, p, true) } : null,
      { icon: 'margin', label: mg ? 'Fechar margem expandida' : 'Abrir margem expandida', onclick: () => { this.active = v; this.toggleMargin(p.key); } },
      p.kind === 'pdf' ? { icon: 'speak', label: 'Ler esta página em voz alta', onclick: async () => speak(await pageText(v.hd, p.n)) } : null,
      p.kind === 'blank' ? '-' : null,
      p.kind === 'blank' ? { icon: 'trash', label: 'Apagar página em branco', danger: true, onclick: () => this.deleteBlank(v, p) } : null,
    ]);
  }

  async toggleBookmark(key, v = this.active) {
    v.doc.bookmarks = v.doc.bookmarks || [];
    const i = v.doc.bookmarks.findIndex(b => b.key === key);
    if (i >= 0) v.doc.bookmarks.splice(i, 1);
    else {
      const label = await promptBox('Marcar página', 'Nome do marcador (opcional)', '', 'Marcar');
      if (label === null) return;
      v.doc.bookmarks.push({ key, label: label.trim(), created: Date.now() });
    }
    await S.saveDoc(v.doc);
    v.updateBookmarks();
    if (this.sideOpen) this.renderSide();
  }

  async insertBlank(v, p, before) {
    let after;
    if (p.kind === 'pdf') after = before ? p.n - 1 : p.n;
    else { const b = v.doc.blanks.find(x => x.id === p.id); after = b.after; }
    v.doc.blanks = v.doc.blanks || [];
    const nb = { id: uid(''), after, w: p.w, h: p.h, created: Date.now() };
    v.doc.blanks.push(nb);
    await S.saveDoc(v.doc);
    await v.refreshPages();
    v.goTo('b' + nb.id, 0, { noHist: true });
    toast('Página em branco inserida. Ela aparece no PDF exportado.');
  }

  async deleteBlank(v, p) {
    const anns = (await S.annots(v.doc.id)).filter(a => a.pageKey === p.key);
    if (!(await confirmBox('Apagar página em branco', anns.length ? 'Esta página tem ' + anns.length + ' anotação(ões), que também serão apagadas.' : 'Apagar esta página em branco?', 'Apagar', true))) return;
    await S.delAnnots(anns);
    v.doc.blanks = v.doc.blanks.filter(b => b.id !== p.id);
    await S.saveDoc(v.doc);
    await v.refreshPages();
  }

  // ---------- gravação de sessão ----------
  async toggleRec() {
    if (this.recorder.active) {
      const r = await this.recorder.stop();
      if (r) toast('Gravação salva (' + fmtTime(r.duration) + '). Toque num traço feito durante a gravação para ouvir aquele momento.', 5000);
      return;
    }
    try {
      await this.recorder.start(this.doc.id);
      toast('Gravando. Escreva normalmente: cada traço guarda o instante do áudio.', 4000);
      if (this.tool === 'read') this.setTool('pen');
    } catch (e) { toast('Não foi possível gravar: ' + (e.message || e.name)); }
  }
  updateRecBtn() {
    const on = this.recorder.active;
    this.recBtn.classList.toggle('on', on);
    this.recBtn.title = on ? 'Parar gravação (' + fmtTime(this.recorder.elapsed()) + ')' : 'Gravar sessão (áudio sincronizado com a escrita)';
    let t = this.recBtn.querySelector('span');
    if (on) { if (!t) { t = h('span'); this.recBtn.appendChild(t); } t.textContent = fmtTime(this.recorder.elapsed()); } else if (t) t.remove();
  }

  // ---------- seleção de texto ----------
  onSelection() {
    if (!this.root.isConnected || this.tool !== 'read') return;
    if (this.selDragging) { this.selMenu.classList.remove('show'); return; }   // o menu só aparece ao soltar
    let seg = null, sv = null;
    for (const v of this.viewers) { const s = v.selectionSegments(); if (s) { seg = s; sv = v; break; } }
    if (!seg) { this.hideSel(); return; }
    this.sel = { v: sv, ...seg };
    this.setActiveViewer(sv);
    this.showSelMenu();
  }

  hideSel() { this.selMenu.classList.remove('show'); this.sel = null; }

  // anotações que já existem sobre o trecho selecionado (para oferecer "desfazer")
  async existingFor(s) {
    const list = await S.annots(s.v.doc.id);
    const hit = a => a.rects && s.segs.some(sg => sg.pageKey === a.pageKey && sg.rects.some(r1 => a.rects.some(r2 => overlap(r1, r2))));
    const on = list.filter(hit);
    const hl = on.filter(a => a.kind === 'hl');
    const dg = await S.digest();
    const fq = fold(cleanText(s.text)).slice(0, 60);
    const dItem = dg.items.find(it => it.src.doc === s.v.doc.id && s.segs.some(sg => sg.pageKey === it.pageKey || (it.pageKeyEnd && sg.pageKey === it.pageKeyEnd))
      && fq.length > 3 && (fold(it.quote).includes(fq) || fq.includes(fold(it.quote).slice(0, 60))));
    return {
      mark: hl.find(a => !a.style || a.style === 'highlight'),
      underline: hl.find(a => a.style === 'underline'),
      strike: hl.find(a => a.style === 'strike'),
      note: hl.find(a => a.note),
      voice: hl.find(a => a.audioId),
      anyHl: hl[0],
      link: on.find(a => a.kind === 'link'),
      digest: dItem,
    };
  }

  async showSelMenu() {
    const s = this.sel;
    const ex = await this.existingFor(s);
    if (this.sel !== s) return;
    this.selEx = ex;
    const m = this.selMenu;
    clear(m);
    const row1 = h('div.selrow');
    for (const c of CATS) {
      const isOn = ex.mark && (ex.mark.cat || '') === c.id;
      row1.appendChild(h('button.catbtn' + (isOn ? '.on' : ''), {
        type: 'button', title: isOn ? 'Tirar destaque' : 'Destacar: ' + c.label, 'aria-label': isOn ? 'Tirar destaque ' + c.label : 'Destacar como ' + c.label,
        style: { background: c.color }, onclick: () => isOn ? this.undoAnn(ex.mark, 'destaque') : this.highlight({ cat: c.id }),
      }, isOn ? '✕' : (c.sym || '')));
    }
    row1.appendChild(h('span.vsep'));
    const tog = (key, ic, verb, noun) => {
      const a = ex[key];
      return btn(ic, '', () => a ? this.undoAnn(a, noun) : this.highlight({ style: key }), { iconOnly: true, title: a ? 'Tirar ' + noun : verb, cls: 'mbtn' + (a ? ' on' : '') });
    };
    row1.appendChild(tog('underline', 'underline', 'Sublinhar', 'sublinhado'));
    row1.appendChild(tog('strike', 'strike', 'Tachar', 'tachado'));
    const pending = this.digestPending;
    const act = (on, ic, label, offLabel, fnOn, fnOff) => btn(ic, on ? offLabel : label, on ? fnOff : fnOn, { cls: 'mbtn lbl' + (on ? ' undo' : '') });
    const row2 = h('div.selrow',
      pending ? btn('digest', 'Continuar', () => this.toDigest(), { cls: 'mbtn lbl hot' })
        : act(!!ex.digest, 'digest', 'Digest', 'Tirar do Digest', () => this.toDigest(), () => this.undoDigest(ex.digest)),
      act(!!ex.note, 'note', 'Nota', 'Tirar nota', () => this.selNote(), () => this.undoNote(ex.note)),
      act(!!ex.voice, 'mic', 'Voz', 'Tirar voz', () => this.selVoice(), () => this.undoVoice(ex.voice)),
      act(!!ex.link, 'link', 'Link', 'Tirar link', () => { const s2 = this.sel; this.linkBuilder(s2.v, { pageKey: s2.segs[0].pageKey, rects: s2.segs[0].rects, text: cleanText(s2.text) }); }, () => this.undoAnn(ex.link, 'link')),
      btn('copy', 'Copiar', () => { copyText(cleanText(this.sel.text)); toast('Copiado.'); this.clearSel(); }, { cls: 'mbtn lbl' }),
      btn('speak', 'Ouvir', () => { speak(cleanText(this.sel.text)); }, { cls: 'mbtn lbl' }),
      btn('translate', 'Traduzir', () => { const b2 = this.sel.box; translatePop(cleanText(this.sel.text), b2, this.selDoc()); }, { cls: 'mbtn lbl' }),
      btn('wiki', 'Wikipédia', () => { const b2 = this.sel.box; wikiPop(cleanText(this.sel.text), b2); }, { cls: 'mbtn lbl' }),
      btn('ai', 'IA', e => this.aiMenu(e), { cls: 'mbtn lbl' }),
    );
    m.append(row1, row2);
    m.classList.add('show');
    const b = this.sel.box;
    const mr = m.getBoundingClientRect();
    let top = b.top - mr.height - 14;
    if (top < 64) top = Math.min(innerHeight - mr.height - 10, b.bottom + 56);   // abaixo (o menu do Android fica em cima)
    m.style.top = Math.max(60, Math.min(innerHeight - mr.height - 8, top)) + 'px';
    m.style.left = Math.max(8, Math.min(innerWidth - mr.width - 8, (b.left + b.right) / 2 - mr.width / 2)) + 'px';
  }

  selDoc() { return this.sel ? this.sel.v.doc : this.doc; }

  clearSel() { window.getSelection().removeAllRanges(); this.hideSel(); }

  async undoAnn(a, what) {
    if (a.kind === 'hl' && (a.note || a.audioId) && !(await confirmBox('Tirar ' + what, 'Este destaque tem nota ou nota de voz, que também serão apagadas.', 'Tirar', true))) return;
    await S.delAnnot(a);
    if (a.kind === 'link') this.app.refreshLinkIndex();
    toast('Removido: ' + what + '. (Desfazer na barra lateral traz de volta.)');
    this.clearSel();
  }

  async undoNote(a) {
    a.note = '';
    if (a.madeBy === 'note' && !a.cat && !a.audioId) await S.delAnnot(a); else await S.putAnnot(a);
    toast('Nota removida.'); this.clearSel();
  }

  async undoVoice(a) {
    a.audioId = null; a.audioDur = 0;
    if (a.madeBy === 'voice' && !a.cat && !a.note) await S.delAnnot(a); else await S.putAnnot(a);
    toast('Nota de voz removida.'); this.clearSel();
  }

  async undoDigest(it) {
    if (!(await confirmBox('Tirar do Digest', 'Remover este trecho do Digest?\n“' + (it.quote || '').slice(0, 120) + '”', 'Remover', true))) return;
    await S.saveDigest(dgDelete(await S.digest(), it.id));
    toast('Removido do Digest.'); this.clearSel();
  }

  async highlight(opt) {
    const s = this.sel; if (!s) return;
    const ex = this.selEx || {};
    // já existe destaque no trecho: muda o tipo/estilo em vez de duplicar
    const same = opt.style === 'underline' ? ex.underline : opt.style === 'strike' ? ex.strike : (opt.madeBy ? ex.anyHl : ex.mark);
    if (same) {
      if (opt.cat !== undefined && !opt.madeBy) { same.cat = opt.cat; same.color = null; await S.putAnnot(same); }
      this.clearSel();
      return same;
    }
    const group = s.segs.length > 1 ? uid('g') : undefined;
    const rec = this.recorder.stamp(s.v.doc.id);
    let first = null;
    for (let i = 0; i < s.segs.length; i++) {
      const sg = s.segs[i];
      const a = { kind: 'hl', docId: s.v.doc.id, pageKey: sg.pageKey, rects: sg.rects, text: i === 0 ? cleanText(s.text) : '(continuação)', cat: opt.cat || '', style: opt.style || 'highlight', group };
      if (opt.madeBy) a.madeBy = opt.madeBy;
      if (rec) a.rec = rec;
      await S.putAnnot(a);
      if (!first) first = a;
    }
    this.clearSel();
    return first;
  }

  async selNote() {
    const s = this.sel; if (!s) return;
    const a = await this.highlight({ cat: '', madeBy: 'note' });
    this.editNote(a);
  }

  async selVoice() {
    const s = this.sel; if (!s) return;
    const a = await this.highlight({ cat: '', madeBy: 'voice' });
    const r = await recordVoiceNote('Nota de voz sobre o trecho');
    if (r) { a.audioId = r.audioId; a.audioDur = r.duration; await S.putAnnot(a); toast('Nota de voz salva.'); }
    else if (a.madeBy === 'voice' && !a.note && !a.audioId && !a.cat) await S.delAnnot(a, { noUndo: true });
  }

  aiMenu(e) {
    const s = this.sel; if (!s) return;
    const text = cleanText(s.text);
    const v = s.v;
    popMenu(e.clientX, e.clientY - 10, AI.AI_ACTIONS.map(a => ({ label: a.label, onclick: async () => {
      let q = '';
      if (a.id === 'ask') { q = await promptBox('Perguntar à IA', 'Sua pergunta sobre o trecho', '', 'Perguntar', true); if (!q) return; }
      showAiResult(a.label, async signal => AI.runAction(a.id, text, S.docTitle(v.doc) + ' (' + pageLabel(s.segs[0].pageKey) + ')', q, signal, await AI.contextFor(v.doc)), {
        onSaveNote: async (out) => {
          const hl = { kind: 'hl', docId: v.doc.id, pageKey: s.segs[0].pageKey, rects: s.segs[0].rects, text, cat: '', style: 'highlight', note: (q ? 'Pergunta: ' + q + '\n\n' : '') + a.label + ' (IA):\n' + out };
          await S.putAnnot(hl); toast('Salvo como nota do trecho.');
        },
      });
    } })));
  }

  // ---------- Digest ----------
  async toDigest(fromAnnot) {
    let quote, pageKey, v = this.active;
    if (fromAnnot) { quote = fromAnnot.text; pageKey = fromAnnot.pageKey; }
    else { const s = this.sel; if (!s) return; v = s.v; quote = cleanText(s.text); pageKey = s.segs[0].pageKey; this.clearSel(); }
    if (this.digestPending) {
      const d = this.digestPending; this.digestPending = null; this.hidePill();
      d.quote = dgJoinQuote(d.quote, quote);
      if (pageNum(pageKey) > d.page) d.pageEnd = pageNum(pageKey);
      d.pageKeyEnd = pageKey;
      this.openDigestPanel(d);
      return;
    }
    this.openDigestPanel({ doc: v.doc.id, name: v.doc.name, page: pageNum(pageKey) || 0, pageKey, quote, note: '', tags: [], area: [] });
  }

  openDigestPanel(draft) {
    digestPanel(this.right, draft, {
      onContinue: d => {
        this.digestPending = d;
        this.right.classList.remove('open');
        this.showPill('Continuação do trecho: selecione o resto (em outra página ou coluna) e toque em “Continuar”.', () => { this.digestPending = null; this.hidePill(); });
      },
      onClose: () => { this.right.classList.remove('open'); setTimeout(() => this.viewers.forEach(v => v.relayout(true)), 260); },
      onSaved: () => { this.right.classList.remove('open'); toast('Salvo no Digest.'); setTimeout(() => this.viewers.forEach(v => v.relayout(true)), 260); },
    });
    this.right.classList.add('open');
  }

  showPill(text, onCancel) {
    clear(this.pill);
    this.pill.append(h('span', text), h('button.sbtn.small', { type: 'button', onclick: onCancel }, 'Cancelar'));
    this.pill.classList.add('show');
  }
  hidePill() { this.pill.classList.remove('show'); }

  // ---------- notas ----------
  async noteAt(v, pageKey, x, y) {
    const a = { kind: 'note', docId: v.doc.id, pageKey, x, y, text: '' };
    const rec = this.recorder.stamp(v.doc.id); if (rec) a.rec = rec;
    this.editNote(a, true);
  }

  editNote(a, isNew) {
    const ta = h('textarea', { rows: 6, placeholder: 'Escreva a nota…' });
    ta.value = a.kind === 'note' ? (a.text || '') : (a.note || '');
    const audioRow = h('div.audiorow');
    const renderAudio = () => {
      clear(audioRow);
      if (a.audioId) audioRow.append(btn('play', 'Ouvir nota de voz', () => playAudio(a.audioId, 0, 'Nota de voz'), { cls: 'sbtn' }), btn('trash', 'Remover áudio', () => { a.audioId = null; renderAudio(); }, { cls: 'sbtn' }));
      else audioRow.append(btn('mic', 'Gravar nota de voz', async () => { const r = await recordVoiceNote(); if (r) { a.audioId = r.audioId; a.audioDur = r.duration; renderAudio(); } }, { cls: 'sbtn' }));
    };
    renderAudio();
    const body = h('div', a.kind === 'hl' ? h('blockquote.q', a.text) : null, ta, audioRow);
    modal(a.kind === 'hl' ? 'Nota do trecho' : 'Nota', body, [
      !isNew ? { label: 'Apagar', danger: true, onclick: async c => { c(); if (a.kind === 'note') await S.delAnnot(a); else { a.note = ''; a.audioId = null; await S.putAnnot(a); } } } : null,
      { label: 'Cancelar' },
      { label: 'Salvar', primary: true, onclick: async c => {
        if (a.kind === 'note') { a.text = ta.value.trim(); if (!a.text && !a.audioId) { c(); if (!isNew) await S.delAnnot(a); return; } }
        else a.note = ta.value.trim();
        c(); await S.putAnnot(a);
      } },
    ].filter(Boolean));
  }

  // ---------- toques em anotações ----------
  async onTapTarget(v, t, x, y) {
    const a = t.a;
    if (t.type === 'note') {
      const items = [];
      if (a.text) items.push({ icon: 'note', label: 'Ver/editar nota', onclick: () => this.editNote(a) });
      if (a.audioId) items.push({ icon: 'play', label: 'Ouvir nota de voz', onclick: () => playAudio(a.audioId, 0, 'Nota de voz') });
      if (!a.text) items.push({ icon: 'note', label: 'Escrever texto', onclick: () => this.editNote(a) });
      items.push('-', { icon: 'trash', label: 'Apagar nota', danger: true, onclick: () => S.delAnnot(a) });
      const pm = popMenu(x, y, items);
      if (a.text) pm.prepend(h('div.popnote', a.text));
      return;
    }
    if (t.type === 'hl') {
      const pm = popMenu(x, y, [
        { icon: 'note', label: a.note ? 'Ver/editar nota' : 'Adicionar nota', onclick: () => this.editNote(a) },
        a.audioId ? { icon: 'play', label: 'Ouvir nota de voz', onclick: () => playAudio(a.audioId, 0, 'Nota de voz') } : { icon: 'mic', label: 'Gravar nota de voz', onclick: async () => { const r = await recordVoiceNote(); if (r) { a.audioId = r.audioId; await S.putAnnot(a); } } },
        { icon: 'digest', label: 'Enviar ao Digest', onclick: () => this.toDigest(a) },
        { icon: 'link', label: 'Criar link a partir deste trecho', onclick: () => this.linkBuilder(v, { pageKey: a.pageKey, rects: a.rects, text: a.text }) },
        { icon: 'copy', label: 'Copiar texto', onclick: () => { copyText(a.text || ''); toast('Copiado.'); } },
        { icon: 'speak', label: 'Ouvir o trecho', onclick: () => speak(a.text || '') },
        { icon: 'translate', label: 'Traduzir', onclick: () => translatePop(a.text || '', { left: x, right: x, top: y, bottom: y }, v.doc) },
        { icon: 'wiki', label: 'Wikipédia', onclick: () => wikiPop(a.text || '', { left: x, right: x, top: y, bottom: y }) },
        a.rec ? { icon: 'play', label: 'Ouvir a gravação deste momento', onclick: () => this.playRecAt(a.rec) } : null,
        '-',
        { icon: 'trash', label: 'Apagar destaque', danger: true, onclick: () => S.delAnnot(a) },
      ]);
      const cats = h('div.popcats', CATS.map(c => h('button.catbtn', { type: 'button', title: c.label, 'aria-label': c.label, style: { background: c.color }, onclick: async () => { pm.remove(); a.cat = c.id; a.color = null; a.style = 'highlight'; await S.putAnnot(a); } }, c.sym)),
        btn('underline', '', async () => { pm.remove(); a.style = 'underline'; await S.putAnnot(a); }, { iconOnly: true, title: 'Sublinhado', cls: 'mbtn' }),
        btn('strike', '', async () => { pm.remove(); a.style = 'strike'; await S.putAnnot(a); }, { iconOnly: true, title: 'Tachado', cls: 'mbtn' }));
      pm.prepend(cats);
      if (a.note) pm.prepend(h('div.popnote', a.note));
      return;
    }
    if (t.type === 'link') { this.followLink(v, a); return; }
    if (t.type === 'incoming') {
      const docs = await S.allDocs();
      popMenu(x, y, t.links.map(l => ({ icon: 'back', label: 'De: ' + ((docs.find(d => d.id === l.docId) && S.docTitle(docs.find(d => d.id === l.docId))) || '?') + ' · ' + pageLabel(l.pageKey), onclick: () => this.jump({ docId: l.docId, pageKey: l.pageKey, y: l.rects[0][1] }, v) })));
      return;
    }
    if (t.type === 'pdflink') { this.previewPdfLink(v, t.l, x, y); return; }
    if (t.type === 'ink' && a.rec) {
      popMenu(x, y, [{ icon: 'play', label: 'Ouvir a gravação a partir deste traço', onclick: () => this.playRecAt(a.rec) }]);
    }
  }

  async playRecAt(rec) {
    const r = (await S.allRecordings()).find(x => x.id === rec.id);
    if (!r) { toast('A gravação deste traço não existe mais.'); return; }
    playAudio(r.fileId, Math.max(0, rec.t / 1000 - 3), r.title);
  }

  async followLink(v, a) {
    const t = a.target || {};
    if (t.type === 'page') return this.jump(t, v);
    if (t.type === 'url') { openExternal(t.url); return; }
    if (t.type === 'obsidian') { openUri(t.uri); return; }
    if (t.type === 'digest') { this.app.showDigest(t.id); return; }
  }

  // pré-visualização de referência / figura (links internos do PDF)
  async previewPdfLink(v, l, x, y) {
    if (l.url) {
      popMenu(x, y, [{ icon: 'fwd', label: 'Abrir ' + l.url.slice(0, 50), onclick: () => openExternal(l.url) }, { icon: 'copy', label: 'Copiar endereço', onclick: () => copyText(l.url) }]);
      return;
    }
    const d = await resolveDest(v.hd, l.dest);
    if (!d) return;
    const pg = await getPage(v.hd, d.n);
    const base = pg.getViewport({ scale: 1 });
    const sc = Math.min(2.2, 520 / base.width) * (window.devicePixelRatio || 1);
    const vp = pg.getViewport({ scale: sc });
    const full = h('canvas'); full.width = vp.width; full.height = vp.height;
    await pg.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
    const y0 = Math.max(0, (d.y - 30) * sc), hh = Math.min(full.height - y0, 260 * sc);
    const c = h('canvas.preview'); c.width = full.width; c.height = Math.max(10, hh);
    c.getContext('2d').drawImage(full, 0, y0, full.width, hh, 0, 0, full.width, hh);
    const box = h('div.refpop', h('div.refhead', h('b', 'p. ' + d.n), h('div.grow'),
      h('button.pbtn.small', { type: 'button', onclick: () => { box.remove(); v.goTo('p' + d.n, d.y, { flash: true }); this.onNav(v); } }, 'Ir para lá'),
      btn('close', '', () => box.remove(), { iconOnly: true, title: 'Fechar' })), c);
    document.querySelectorAll('.refpop').forEach(e => e.remove());
    document.body.appendChild(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    box.style.top = (y + 20 + r.height < innerHeight ? y + 20 : Math.max(8, y - r.height - 20)) + 'px';
    setTimeout(() => {
      const off = e => { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    }, 0);
  }

  // ---------- construtor de links ----------
  async linkBuilder(v, src) {
    const docs = await S.allDocs();
    const st = await S.settings();
    const dg = await S.digest();
    let type = 'page';
    const tabs = h('div.chips');
    const panel = h('div.lbpanel');
    const state = { docId: v.doc.id, pageKey: v.currentKey(), y: 0, url: 'https://', file: '', digestId: '' };
    const pageSelect = (docId, hd, doc) => {
      const sel = h('select');
      for (const p of pageList(doc, hd)) sel.appendChild(h('option', { value: p.key }, p.kind === 'pdf' ? 'Página ' + p.n : 'Página em branco (depois da ' + (doc.blanks.find(b => 'b' + b.id === p.key) || {}).after + ')'));
      sel.value = state.pageKey;
      sel.addEventListener('change', () => { state.pageKey = sel.value; state.y = 0; });
      return sel;
    };
    const render = async () => {
      clear(tabs); clear(panel);
      for (const [id, l] of [['page', 'Página deste PDF'], ['doc', 'Outro PDF'], ['digest', 'Digest'], ['obsidian', 'Obsidian'], ['url', 'Site']]) tabs.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(type === id), onclick: () => { type = id; if (id === 'page') { state.docId = v.doc.id; } render(); } }, l));
      if (type === 'page' || type === 'doc') {
        if (type === 'doc') {
          const others = docs.filter(d => d.id !== v.doc.id);
          if (!others.length) { panel.appendChild(h('p.muted', 'Não há outros PDFs na biblioteca.')); return; }
          if (state.docId === v.doc.id) { state.docId = others[0].id; state.pageKey = 'p1'; }
          const ds = h('select', { onchange: async () => { state.docId = ds.value; state.pageKey = 'p1'; render(); } }, others.map(d => h('option', { value: d.id }, S.docTitle(d))));
          ds.value = state.docId;
          panel.appendChild(h('label.field', h('span', 'Documento'), ds));
        }
        const d = docs.find(x => x.id === state.docId) || v.doc;
        const hd = await openPdf(d);
        panel.appendChild(h('label.field', h('span', 'Página'), pageSelect(d.id, hd, d)));
        const bms = d.bookmarks || [];
        if (bms.length) panel.appendChild(h('div.chips', h('span.muted', 'Marcadores: '), bms.map(b => h('button.chip', { type: 'button', onclick: () => { state.pageKey = b.key; state.y = 0; render(); } }, (b.label || 'marcador') + ' · ' + pageLabel(b.key)))));
        panel.appendChild(h('button.sbtn', { type: 'button', onclick: () => {
          m.close();
          this.showPill('Toque no ponto exato de destino. Você pode rolar, mudar de página ou abrir outro PDF lado a lado.', () => { this.picking = null; this.hidePill(); });
          this.picking = (pv, hit) => {
            this.picking = null; this.hidePill();
            this.saveLink(v, src, { type: 'page', docId: pv.doc.id, pageKey: hit.s.p.key, y: Math.max(0, hit.y - 10) }, docs);
          };
        } }, icon('fwd', 18), 'Escolher o destino tocando na página'));
        if (state.y) panel.appendChild(h('p.muted', 'Posição escolhida na página.'));
      } else if (type === 'digest') {
        const inp = h('input', { type: 'search', placeholder: 'Buscar no Digest…' });
        const list = h('div.picklist.short');
        const fill = () => { clear(list); for (const it of dgFilter(dg, { text: inp.value }, 'recentes').slice(0, 40)) list.appendChild(h('button.pickrow', { type: 'button', 'aria-pressed': String(state.digestId === it.id), onclick: () => { state.digestId = it.id; fill(); } }, h('span.clamp', it.quote || it.note), h('span.muted', it.src.name + ' · ' + dgPages(it)))); };
        inp.addEventListener('input', fill); fill();
        panel.append(inp, list);
      } else if (type === 'obsidian') {
        const inp = h('input', { type: 'text', placeholder: 'Nome da nota no Obsidian (ex.: Pinças ópticas)', value: state.file });
        inp.addEventListener('input', () => { state.file = inp.value; });
        panel.append(h('label.field', h('span', 'Nota do Obsidian'), inp), h('p.muted', st.obsidianVault ? 'Cofre: ' + st.obsidianVault : 'Dica: informe o nome do cofre em Configurações para o link abrir direto.'));
      } else if (type === 'url') {
        const inp = h('input', { type: 'url', value: state.url });
        inp.addEventListener('input', () => { state.url = inp.value; });
        panel.append(h('label.field', h('span', 'Endereço do site'), inp));
      }
    };
    await render();
    const m = modal('Criar link', h('div', src.text ? h('blockquote.q', src.text.slice(0, 300)) : h('p.muted', 'Área marcada na página.'), tabs, panel), [
      { label: 'Cancelar' },
      { label: 'Criar link', primary: true, onclick: async c => {
        let target;
        if (type === 'page' || type === 'doc') target = { type: 'page', docId: state.docId, pageKey: state.pageKey, y: state.y };
        else if (type === 'digest') { if (!state.digestId) { toast('Escolha um trecho do Digest.'); return; } target = { type: 'digest', id: state.digestId }; }
        else if (type === 'obsidian') { if (!state.file.trim()) { toast('Escreva o nome da nota.'); return; } target = { type: 'obsidian', file: state.file.trim() }; }
        else { if (!/^https?:\/\/.+\..+/.test(state.url)) { toast('Endereço inválido.'); return; } target = { type: 'url', url: state.url.trim() }; }
        c(); this.saveLink(v, src, target, docs);
      } },
    ], { wide: true, focus: false });
  }

  async saveLink(v, src, target, docs) {
    const st = await S.settings();
    const dg = await S.digest();
    let label = '';
    if (target.type === 'page') { const d = (docs || []).find(x => x.id === target.docId) || v.doc; label = (d.id === v.doc.id ? '' : S.docTitle(d) + ', ') + pageLabel(target.pageKey); }
    else if (target.type === 'url') label = target.url;
    else if (target.type === 'obsidian') { label = 'Obsidian: ' + target.file; target.uri = 'obsidian://open?' + (st.obsidianVault ? 'vault=' + encodeURIComponent(st.obsidianVault) + '&' : '') + 'file=' + encodeURIComponent(target.file); }
    else if (target.type === 'digest') { const it = dgFind(dg, target.id); label = 'Digest: ' + (it ? (it.quote || it.note).slice(0, 50) : target.id); }
    const a = { kind: 'link', docId: v.doc.id, pageKey: src.pageKey, rects: src.rects, text: src.text || '', target, targetLabel: label };
    if (src.pageLink) { a.rects = [[6, 6, 70, 16]]; a.text = a.text || 'link da página'; }
    await S.putAnnot(a);
    this.app.refreshLinkIndex();
    this.clearSel();
    toast('Link criado → ' + label);
  }

  // ---------- menu "mais" ----------
  moreMenu(e) {
    const d = this.doc;
    popMenu(e.clientX - 200, e.clientY + 10, [
      { icon: 'doc', label: 'Dados do artigo (DOI, ABNT, BibTeX)', onclick: () => openMetaDialog(d) },
      { icon: 'ai', label: 'Resumo das minhas anotações (IA)', onclick: () => openBriefing([d], S.docTitle(d)) },
      { icon: 'share', label: 'Enviar ao Obsidian', onclick: () => openObsidianDialog(d) },
      { icon: 'speak', label: 'Ler a página atual em voz alta', onclick: async () => { const k = this.active.currentKey(); if (k[0] === 'p') speak(await pageText(this.active.hd, pageNum(k))); } },
      { icon: 'stop', label: 'Parar leitura em voz alta', onclick: () => stopSpeak() },
      { icon: 'blank', label: 'Inserir página em branco depois desta', onclick: () => { const v = this.active; this.insertBlank(v, v.pages.find(p => p.key === v.currentKey()), false); } },
      { icon: 'bookmark', label: 'Marcar esta página', onclick: () => this.toggleBookmark(this.active.currentKey()) },
      { icon: 'gear', label: 'Configurações', onclick: () => this.app.openSettings() },
    ]);
  }
}

// dois retângulos [x,y,w,h] se sobrepõem em boa parte?
function overlap(a, b) {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = x * y;
  return inter > 0.4 * Math.min(a[2] * a[3], b[2] * b[3]);
}
