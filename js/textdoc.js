// Documento de texto (estilo "documento de texto" do GoodNotes, mas todo em Markdown):
// blocos que aparecem formatados e viram texto editável ao toque; equações LaTeX numeradas,
// tabelas, imagens/GIF, vídeo do YouTube, notas de voz, caixas de nota, links e sumário automático.
import { calloutMenu, calloutMd, listCallouts, calloutIcon } from './callouts.js';
import * as S from './store.js';
import { h, clear, btn, icon, toast, modal, popMenu, promptBox, copyText, uid, downloadBlob, shareFile, safeName, bindTwoFingerSwipe } from './util.js';
import { renderMarkdown, numberAll, headings, slugify, youtubeId, toggleTask, markdownForObsidian, plainText } from './md.js';
import { MdEditBase, parseTable, tableMarkdown, inMathAt } from './mdedit.js';
import { hydrate, parseGo } from './embeds.js';
import { buildMathPal } from './mathpal.js';
import * as NB from './notebook.js';
import { recordVoiceNote } from './audio.js';
import { digestPanel } from './digestui.js';
import { openExternal, openUri } from './platform.js';
import { translatePop, wikiPop } from './lookup.js';
import { openPdf, pageList, pageLabel } from './pdfdoc.js';
import { makeDraggable, quoteMd, sourceLink } from './dnd.js';

export function isText(doc) { return !!doc && doc.kind === 'text'; }

export async function createTextDoc(name) {
  const n = name || 'Texto';
  const doc = { id: uid('d'), kind: 'text', name: n, added: Date.now(), opened: 0, lastKey: '', lastY: 0, meta: {}, projects: [], bookmarks: [], blanks: [], margins: {}, briefing: '', md: '# ' + n + '\n\n' };
  await S.saveDoc(doc);
  return doc;
}

// arquivos (imagens, áudios) usados no texto
export function textFileIds(md) {
  const ids = new Set();
  String(md || '').replace(/\]\((?:img|audio):([\w-]+)\)/g, (m, id) => { ids.add(id); return m; });
  return [...ids];
}

// páginas de destino para links: início e títulos
export function textTargets(doc) {
  return [{ key: 'top', kind: 'hd', n: 0, label: 'Início do texto' }].concat(headings(doc.md || '').map(x => ({ key: x.id, kind: 'hd', n: 0, label: ' '.repeat(x.level - 1) + x.text })));
}

// divide o Markdown em blocos (parágrafos, títulos, listas, tabelas, equações, código)
export function splitBlocks(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = []; let cur = []; let fence = null; let math = false; let env = false;
  const flush = () => { if (cur.length) { out.push(cur.join('\n')); cur = []; } };
  for (const line of lines) {
    const t = line.trim();
    if (fence) { cur.push(line); if (t.startsWith(fence)) fence = null; continue; }
    if (math) { cur.push(line); if (((line.match(/\$\$/g) || []).length % 2) === 1) math = false; continue; }
    if (env) { cur.push(line); if (/\\end\{equation\*?\}/.test(line)) env = false; continue; }
    if (/^(```|~~~)/.test(t)) { fence = t.slice(0, 3); cur.push(line); continue; }
    if (((line.match(/\$\$/g) || []).length % 2) === 1) { math = true; cur.push(line); continue; }
    if (/\\begin\{equation\*?\}/.test(line) && !/\\end\{equation/.test(line)) { env = true; cur.push(line); continue; }
    if (t === '') { flush(); continue; }
    if (/^#{1,6}\s/.test(t)) { flush(); out.push(line); continue; }
    cur.push(line);
  }
  flush();
  return out;
}
function openStructure(v) { return ((v.match(/```/g) || []).length % 2 === 1) || ((v.match(/\$\$/g) || []).length % 2 === 1); }

export class TextScreen extends MdEditBase {
  constructor(app, side = 0) {
    super();
    this.app = app;
    this.sideIdx = side;
    this.cur = null; this.doc = null; this.blocks = [];
    this.hist = []; this.fut = [];
    this.idleHint = 'Toque no texto para editar (ou no fim da página para continuar escrevendo).';
    this.root = h('div.reader.textdoc.textbar');
    this.build();
    S.on('links', () => { if (this.root.isConnected && this.doc && !this.cur) this.paintBacklinks(); });
    S.on('docRemote', d => {
      if (!this.doc || d.id !== this.doc.id || !this.root.isConnected) return;
      Object.assign(this.doc, JSON.parse(JSON.stringify(d)));
      if (!this.cur) { this.blocks = splitBlocks(this.doc.md || ''); this.doc.md = this.joined(); this.renderAll(); this.titleEl.textContent = S.docTitle(this.doc); }
    });
    document.addEventListener('selectionchange', () => { clearTimeout(this.selT); this.selT = setTimeout(() => this.onSelection(), 250); });
    document.addEventListener('keydown', e => {
      if (!this.root.isConnected || this.cur || e.target.closest('input, textarea') || (this.app.split && this.app.side !== this.sideIdx)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); this.redo(); }
    });
    // tocar fora do bloco em edição conclui a edição
    document.addEventListener('pointerdown', e => {
      if (!this.cur || !this.root.isConnected) return;
      const t = e.target;
      if (this.cur.el.contains(t) || (t.closest && t.closest('.fmtbar, .mathpal, .popmenu, .modal-back, .tablepick, .rtop, .rail'))) return;
      if (t.closest && t.closest('.tblock, .tdtail')) return;   // o clique no outro bloco cuida disso
      this.commit();
    }, true);
  }

  // ---------- estrutura da tela ----------
  build() {
    this.titleEl = h('div.rtitle');
    this.infoEl = h('div.rpage');
    this.fmtSlot = h('div.fmtslot');
    this.bar = this.toolbar();
    this.fmtSlot.appendChild(this.bar);
    const top = h('header.rtop',
      btn('back', '', () => this.app.showLibrary(), { title: 'Biblioteca', iconOnly: true }),
      btn('list', '', () => this.toggleSide(), { title: 'Painel lateral: sumário, ligações, busca', iconOnly: true }),
      h('div.rtitles', this.titleEl, this.infoEl),
      this.fmtSlot,
      btn('split', '', () => this.app.split ? this.app.exitSplit(this.sideIdx) : this.app.chooseSplit(this.doc), { title: 'Dividir a tela / fechar a divisão', iconOnly: true, cls: 'ibtn no-eink' }),
      btn('swap', '', () => this.app.reader.recentMenu(null, this.doc && this.doc.id, this.sideIdx), { title: 'Arquivos recentes (ou deslize dois dedos na página)', iconOnly: true }),
      btn('upload', 'Exportar', () => openTextExport(this.doc), { cls: 'pbtn' }),
      this.fitBtn = btn('fitpage', '', () => this.bestFit(), { title: 'Melhor ajuste: o texto ocupa a largura da tela. Toque de novo para a coluna de leitura.', iconOnly: true }),
      btn('more', '', e => this.moreMenu(e), { title: 'Mais opções', iconOnly: true }));
    this.side = h('aside.side');
    this.article = h('article.tdoc.md', { 'aria-label': 'Documento de texto' });
    this.flow = h('div.tdflow', this.article);
    this.pane = h('main.tdpane', this.flow);
    new ResizeObserver(() => { if (this.inkPad && this.inkPad.on) this.inkPad.layout(); }).observe(this.article);
    this.mathPal = buildMathPal(code => this.insertMath(code), () => this.toggleMathPal(), {
      ai: { kind: 'text', doc: () => { if (this.doc) { try { this.doc.md = this.joined(); } catch (e) {} } return this.doc; }, viewer: () => null, selection: () => String(window.getSelection() || '').trim(), goTo: () => {} } });
    this.mathPal.classList.add('open');
    this.right = h('aside.rpanel');
    // barra lateral: inserir coisas no texto
    const rb = (ic, label, fn) => btn(ic, '', fn, { title: label, iconOnly: true, cls: 'ibtn tool' });
    const tblBtn = rb('table', 'Tabela: escolha linhas e colunas', e => this.tableMenu(e));
    this.rail = h('nav.rail', { 'aria-label': 'Inserir' },
      rb('undo', 'Desfazer', () => this.undo()),
      rb('redo', 'Refazer', () => this.redo()),
      h('div.rsep'),
      rb('image', 'Imagem ou GIF (colar ou arquivo)', e => this.imageMenu(e)),
      rb('video', 'Vídeo do YouTube', () => this.addVideo()),
      rb('mic', 'Nota de voz', () => this.addAudio()),
      rb('callout', 'Caixa de nota (callout): Nota, Dica, Atenção, Pergunta, Exemplo…', e => { const r = e.currentTarget.getBoundingClientRect(); calloutMenu(r.right + 8, r.top, t => this.addBlock(calloutMd(t, '@'))); }),
      tblBtn,
      rb('link', 'Link (selecione o texto antes, ou toque num bloco)', e => this.need() && this.linkMenu(e)),
      rb('list', 'Sumário automático (pelos títulos #, ##, ###)', () => this.addBlock('[[sumario]]')),
      h('div.rsep'),
      rb('sigma', 'Mostrar/esconder os símbolos de matemática', () => { this.mathPal.setTab('math'); this.toggleMathPal(); }),
      rb('calc', 'Calculadora física: λ ↔ eV ↔ cm⁻¹, feixe gaussiano, pinças, física médica, unidades', () => { const open = this.mathPal.classList.contains('open') && this.mathPal.dataset.tab === 'calc'; this.mathPal.setTab(open ? 'math' : 'calc'); this.mathPal.classList.toggle('open', !open || this.mathPrefOpen !== false); this.mathPal.classList.toggle('wide', !open); }),
      this.inkBtn = rb('pen', 'Folha de escrita à mão ao lado do texto (S Pen)', () => this.toggleInk()),
      this.aiRail = rb('ai', 'IA: perguntar ao texto (sua chave) ou mandar ao NotebookLM / Gemini', () => { const open = this.mathPal.classList.contains('open') && this.mathPal.dataset.tab === 'ai'; this.mathPal.setTab(open ? 'math' : 'ai'); this.mathPal.classList.toggle('open', !open || this.mathPrefOpen !== false); this.mathPal.classList.toggle('wide', !open); }),
      this.fitRail = rb('fitpage', 'Melhor ajuste: o texto ocupa a largura da tela', () => this.bestFit()),
      h('div.grow'),
      h('div.penhint', 'Toque num bloco para editar'));
    this.selMenu = h('div.selmenu.tdsel', { role: 'toolbar', 'aria-label': 'Ações do trecho selecionado' });
    this.root.append(top, h('div.rbody', this.rail, this.side, this.pane, this.mathPal, this.right), this.selMenu);
    this.article.addEventListener('click', e => this.onClick(e));
    this.pane.addEventListener('scroll', () => { clearTimeout(this.scT); this.scT = setTimeout(() => this.savePos(), 500); }, { passive: true });
    bindTwoFingerSwipe(this.pane, () => this.app.reader.quickSwitch(this.doc && this.doc.id, this.sideIdx), () => this.app.reader.recentMenu(null, this.doc && this.doc.id, this.sideIdx));
  }

  toolbar() {
    const b = (...a) => this.btn(...a);
    return h('div.fmtbar', { role: 'toolbar', 'aria-label': 'Formatação' },
      ...this.commonButtons(),
      b('Link', 'Link: seção deste texto, outro PDF, caderno ou texto, Digest, Obsidian ou site', e => this.linkMenu(e)),
      h('span.fsep'),
      b('Concluir', 'Concluir a edição do bloco', () => this.commit(), '.done'));
  }
  toggleMathPal() { this.mathPrefOpen = !this.mathPal.classList.contains('open'); this.mathPal.classList.toggle('open', this.mathPrefOpen); }

  // ---------- abrir ----------
  async open(doc, at) {
    try { if (localStorage.getItem('leitor-textfit')) this.bestFit(true); } catch (e) {}
    if (this.cur) this.commit();
    this.doc = doc;
    this.blocks = splitBlocks(doc.md || '');
    this.hist = []; this.fut = [];
    this.titleEl.textContent = S.docTitle(doc);
    this.right.classList.remove('open');
    this.mathPal.classList.toggle('open', this.app.split ? !!this.mathPrefSplit : this.mathPrefOpen !== false);
    this.renderAll();
    this.toggleInk(!!doc.inkOpen, true);
    doc.opened = Date.now();
    S.saveDoc(doc);
    this.app.reader.noteRecent(doc.id);
    requestAnimationFrame(() => {
      if (at && at.key && at.key !== 'top') this.scrollToKey(at.key, true);
      else if (at && at.key === 'top') this.pane.scrollTop = 0;
      else this.pane.scrollTop = doc.lastY || 0;
    });
    if (this.sideOpen) this.renderSide();
  }

  // ---------- folha de escrita à mão ----------
  bestFit(force) {
    const on = force !== undefined ? force : !this.root.classList.contains('fitwide');
    this.root.classList.toggle('fitwide', on);
    if (this.fitBtn) this.fitBtn.setAttribute('aria-pressed', String(on));
    if (this.fitRail) this.fitRail.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('leitor-textfit', on ? '1' : ''); } catch (e) {}
    if (force === undefined) {
      toast(on ? 'Melhor ajuste: texto na largura da tela.' : 'Coluna de leitura.', 1500);
      if (this.app.split) for (const r of this.app.readers) if (r.root.isConnected && r.active && r.active.doc) r.active.bestFit(on);
    }
    return on;
  }

  async toggleInk(on, silent) {
    on = on === undefined ? !(this.inkPad && this.inkPad.on) : !!on;
    if (on && !this.app.reader.settings) this.app.reader.settings = await S.settings();
    if (on && !this.inkPad) { const { InkPad } = await import('./inkpad.js'); this.inkPad = new InkPad(this); }
    if (!this.inkPad) { this.inkBtn.setAttribute('aria-pressed', 'false'); return; }
    if (on) { if (!this.inkPad.on) this.flow.appendChild(this.inkPad.col); this.inkPad.renderBar(); await this.inkPad.load(); }
    else this.inkPad.col.remove();
    this.flow.classList.toggle('withink', on);
    this.inkBtn.setAttribute('aria-pressed', String(on));
    if (!silent && this.doc && !!this.doc.inkOpen !== on) { this.doc.inkOpen = on; S.saveDoc(this.doc); }
    if (!silent && on) toast('Folha de escrita aberta: escreva com a S Pen ao lado do texto. Cada traço acompanha o parágrafo ao lado.', 3500);
  }

  // ---------- desenho ----------
  sourcesNow() { return this.blocks.map((md, i) => ({ id: i, md: this.cur && this.cur.i === i ? this.cur.ta.value : md })); }

  renderAll() {
    this.imgDeselect && this.imgSel && this.imgDeselect();
    const srcs = this.sourcesNow();
    const num = numberAll(srcs);
    const all = headings(srcs.map(s => s.md).join('\n\n'));
    let hp = 0;
    const editingEl = this.cur ? this.cur.el : null;
    const scroll = this.pane.scrollTop;
    clear(this.article);
    const tocEl = () => this.tocElement(all);
    srcs.forEach((s, i) => {
      const nh = headings(s.md).length;
      if (editingEl && this.cur.i === i) { this.article.appendChild(editingEl); hp += nh; return; }
      const el = h('div.tblock', { 'data-i': i });
      el.innerHTML = renderMarkdown(s.md, num.starts[i] || 0, num.labels);
      const mine = all.slice(hp, hp + nh); hp += nh; let k = 0, c = 0;
      hydrate(el, { headingId: () => (mine[k++] || {}).id, calloutIds: () => 'co-' + i + '-' + (c++), toc: tocEl, onLink: href => this.onLink(href), onTask: idx => this.toggleTask(i, idx) });
      el.querySelectorAll('table').forEach(t => { t.classList.add('tedit'); t.title = 'Toque para editar a tabela'; });
      this.article.appendChild(el);
    });
    this.article.appendChild(h('div.tdtail', this.blocks.length ? 'Toque aqui para continuar escrevendo' : 'Toque aqui para começar a escrever'));
    this.paintBacklinks();
    this.pane.scrollTop = scroll;
    if (this.inkPad) this.inkPad.layout();
    this.updateInfo();
    if (this.sideOpen && this.sideTab === 'sumario') this.renderSide();
  }

  // links que chegam a este texto: faixa no topo e marcas "←" ao lado dos títulos de destino
  paintBacklinks() {
    this.article.querySelectorAll('.backbar, .inmark').forEach(e => e.remove());
    if (!this.doc || !this.app.linksTo) return;
    const inc = this.app.linksTo(this.doc.id).filter(l => l.docId !== this.doc.id);
    if (!inc.length) return;
    const go = l => this.app.openAt(l.docId, l.pageKey, l.rects ? l.rects[0][1] : 0);
    const bar = h('div.backbar', h('span.bbl', '← Links de volta:'),
      inc.slice(0, 6).map(l => h('button.bbchip', { type: 'button', title: (l.text ? '“' + l.text + '”' : '') + ' → ' + pageLabel(l.target.pageKey, this.doc), onclick: e => { e.stopPropagation(); go(l); } }, l.srcTitle + (l.srcLabel ? ' · ' + l.srcLabel : ''))),
      inc.length > 6 ? h('button.bbchip', { type: 'button', onclick: e => { e.stopPropagation(); this.toggleSide('ligacoes'); } }, '+' + (inc.length - 6)) : null);
    this.article.prepend(bar);
    const byKey = new Map();
    for (const l of inc) if (l.target.pageKey && l.target.pageKey !== 'top') { if (!byKey.has(l.target.pageKey)) byKey.set(l.target.pageKey, []); byKey.get(l.target.pageKey).push(l); }
    for (const [key, ls] of byKey) {
      const hd = this.article.querySelector('#' + CSS.escape(key));
      if (!hd) continue;
      hd.appendChild(h('button.inmark', { type: 'button', title: 'Links que chegam aqui', onclick: e => { e.stopPropagation(); if (ls.length === 1) go(ls[0]); else popMenu(e.clientX, e.clientY + 8, ls.map(l => ({ icon: 'back', label: 'De: ' + l.srcTitle + ' · ' + l.srcLabel, onclick: () => go(l) }))); } }, '← ' + ls.length));
    }
  }

  tocElement(list) {
    if (!list.length) return h('div.toc.muted', 'Sumário: escreva títulos com #, ## ou ### e eles aparecem aqui.');
    return h('nav.toc', h('div.toctitle', 'Sumário'), list.map(x => h('a.toclvl' + Math.min(x.level, 4), { href: '#' + x.id, onclick: e => { e.preventDefault(); e.stopPropagation(); this.scrollToKey(x.id, true); } }, x.text)));
  }

  updateInfo() {
    const words = plainText(this.blocks.join('\n')).split(/\s+/).filter(Boolean).length;
    this.infoEl.textContent = words + ' palavra' + (words === 1 ? '' : 's') + (this.dirty ? ' · salvando…' : '');
  }

  scrollToKey(key, flash) {
    const el = key === 'top' ? this.article.firstElementChild : this.article.querySelector('#' + CSS.escape(key));
    if (!el) return;
    this.pane.scrollTop = Math.max(0, el.getBoundingClientRect().top - this.pane.getBoundingClientRect().top + this.pane.scrollTop - 16);
    if (flash) { el.classList.add('flashblock'); setTimeout(() => el.classList.remove('flashblock'), 1600); }
  }

  savePos() {
    if (!this.doc || !this.root.isConnected) return;
    this.doc.lastY = Math.round(this.pane.scrollTop);
    let key = 'top';
    const top = this.pane.getBoundingClientRect().top + 40;
    for (const hd of this.article.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')) { if (hd.getBoundingClientRect().top <= top) key = hd.id; else break; }
    this.doc.lastKey = key;
    S.saveDoc(this.doc);
  }

  // ---------- salvar e desfazer ----------
  joined() { return this.blocks.join('\n\n') + '\n'; }
  scheduleSave() { this.dirty = true; this.updateInfo(); clearTimeout(this.svT); this.svT = setTimeout(() => this.saveNow(), 700); }
  async saveNow() {
    clearTimeout(this.svT);
    if (!this.doc) return;
    const md = this.joined();
    if (md !== this.doc.md) { this.doc.md = md; await S.saveDoc(this.doc); this.app.refreshLinkIndex && this.app.refreshLinkIndex(); }
    this.dirty = false; this.updateInfo();
  }
  snapshot() {
    if (this.doc) S.breakUndo(this.doc.id);
    const md = this.joined();
    if (this.hist[this.hist.length - 1] !== md) { this.hist.push(md); if (this.hist.length > 80) this.hist.shift(); this.fut = []; }
  }
  // desfazer/refazer do documento inteiro (texto e escrita à mão), passo a passo
  async undo() {
    if (this.cur) this.commit();
    await this.saveNow();
    if (!this.doc || !(await S.undo(this.doc.id))) toast('Nada para desfazer.', 1500);
  }
  async redo() {
    if (this.cur) this.commit();
    await this.saveNow();
    if (!this.doc || !(await S.redo(this.doc.id))) toast('Nada para refazer.', 1500);
  }

  // ---------- edição por blocos ----------
  onClick(e) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && this.article.contains(sel.anchorNode) && !(this.cur && this.cur.el.contains(sel.anchorNode))) return;
    if (e.target.closest('.tdtail')) { this.editBlock(this.blocks.length); return; }
    const bl = e.target.closest('.tblock');
    if (!bl || bl.classList.contains('editing')) return;
    const i = +bl.dataset.i;
    if (e.target.closest('table.tedit')) { this.tableEditor(i); return; }
    const img = e.target.closest('img.mdimg');
    if (img) { this.imgSelect(i, img); return; }
    if (e.target.closest('a, button, iframe, audio, video, input, .ytbox, .audbox, nav.toc')) return;
    this.editBlock(i, this.caretFromPoint(i, e.clientX, e.clientY));
  }

  // posição aproximada do cursor no Markdown a partir do ponto tocado no texto formatado
  caretFromPoint(i, x, y) {
    const src = this.blocks[i] || '';
    try {
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (!r || r.startContainer.nodeType !== 3) return src.length;
      const t = r.startContainer.textContent; const o = r.startOffset;
      for (const len of [16, 10, 6, 3]) {
        const before = t.slice(Math.max(0, o - len), o);
        if (before.length < 2) continue;
        const k = src.indexOf(before);
        if (k >= 0 && src.indexOf(before, k + 1) < 0) return k + before.length;
      }
      const after = t.slice(o, o + 8);
      if (after.length >= 3) { const k = src.indexOf(after); if (k >= 0) return k; }
    } catch (er) {}
    return src.length;
  }

  editBlock(i, caret) {
    this.hideSel();
    if (this.cur) {
      if (this.cur.i === i) return;
      const j = this.cur.i;
      const d = this.commit();
      if (i > j) i += d;
    }
    if (i >= this.blocks.length) { this.snapshot(); this.blocks.push(''); i = this.blocks.length - 1; this.renderAll(); }
    const el = this.article.querySelector(`.tblock[data-i="${i}"]`);
    if (!el) return;
    const ta = h('textarea.tdedit', { spellcheck: true, 'aria-label': 'Texto do bloco (Markdown)' });
    ta.value = this.blocks[i];
    clear(el); el.classList.add('editing'); el.appendChild(ta);
    this.cur = { i, ta, el };
    this.lastI = i;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 34) + 'px'; };
    ta.addEventListener('input', () => { if (!this.cur || this.cur.ta !== ta) return; this.blocks[this.cur.i] = ta.value; grow(); this.scheduleSave(); });
    ta.addEventListener('keydown', e => this.onKey(e, ta));
    ta.addEventListener('paste', async e => {
      const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(x => x.type.startsWith('image/'));
      if (!it) return;
      e.preventDefault();
      try { const im = await NB.storeImage(it.getAsFile()); this.blockAt('![](img:' + im.fileId + ')@'); this.commit(); this.selectImage(im.fileId); } catch (er) { toast(er.message); }
    });
    grow();
    ta.focus({ preventScroll: true });
    const c = caret === undefined || caret === null ? ta.value.length : Math.max(0, Math.min(ta.value.length, caret));
    ta.setSelectionRange(c, c);
    const r = el.getBoundingClientRect(), pr = this.pane.getBoundingClientRect();
    if (r.bottom > pr.bottom - 20) this.pane.scrollTop += r.bottom - pr.bottom + 60;
    if (r.top < pr.top) this.pane.scrollTop -= pr.top - r.top + 20;
  }

  // conclui o bloco em edição; devolve quantos blocos a mais ele virou (pode ser -1 se ficou vazio)
  commit() {
    const c = this.cur; if (!c) return 0;
    this.cur = null;
    this.snapshot();
    const val = c.ta.value.replace(/\s+$/, '');
    const parts = val.trim() ? splitBlocks(val) : [];
    this.blocks.splice(c.i, 1, ...parts);
    this.renderAll();
    this.saveNow();
    this.snapshot();
    return parts.length - 1;
  }

  onKey(e, ta) {
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); this.wrapSel('**', '**'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); this.wrapSel('*', '*'); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.commit(); return; }
    if (e.key === 'Tab') { e.preventDefault(); this.insert('  '); return; }
    const i = this.cur.i;
    if (e.key === 'Enter' && !e.shiftKey && s === en) {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(ls, s);
      const lm = line.match(/^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?/);
      if (lm && !openStructure(v.slice(0, s))) {
        e.preventDefault();
        if (line.trim() === lm[0].trim()) { ta.setRangeText('', ls, s, 'end'); ta.dispatchEvent(new Event('input')); return; }   // item vazio: termina a lista
        let mark = lm[2]; const nm = mark.match(/^(\d+)([.)])$/); if (nm) mark = (+nm[1] + 1) + nm[2];
        this.insert('\n' + lm[1] + mark + ' ' + (lm[3] ? '[ ] ' : ''));
        return;
      }
      // Enter numa linha vazia no fim do bloco: começa um bloco novo
      if (s === v.length && (v === '' || v.endsWith('\n')) && !openStructure(v)) {
        e.preventDefault();
        ta.value = v.replace(/\n+$/, '');
        const d = this.commit();
        const ni = i + d + 1;
        this.blocks.splice(ni, 0, '');
        this.renderAll();
        this.editBlock(ni, 0);
        return;
      }
    }
    if (e.key === 'ArrowUp' && s === 0 && en === 0 && i > 0) { e.preventDefault(); const d = this.commit(); this.editBlock(Math.max(0, i - 1 + Math.min(0, d))); return; }
    if (e.key === 'ArrowDown' && s === v.length && i < this.blocks.length - 1) { e.preventDefault(); const d = this.commit(); this.editBlock(i + 1 + d, 0); return; }
    if (e.key === 'Backspace' && s === 0 && en === 0 && i > 0) {
      e.preventDefault();
      const prev = this.blocks[i - 1];
      this.cur.ta.value = '';
      this.cur = null;
      this.snapshot();
      this.blocks.splice(i - 1, 2, v ? prev + '\n' + v : prev);
      this.renderAll();
      this.editBlock(i - 1, prev.length + (v ? 1 : 0));
      this.saveNow();
    }
  }

  // MdEditBase: fontes para numerar e citar equações
  async sources() { return this.sourcesNow(); }
  isCurrent(id) { return this.cur && this.cur.i === id; }
  async setSource(id, md) { this.blocks[id] = md; this.renderAll(); await this.saveNow(); }

  toggleTask(i, idx) { this.snapshot(); this.blocks[i] = toggleTask(this.blocks[i], idx); this.renderAll(); this.saveNow(); }

  // insere um bloco novo (imagem, vídeo, nota…) depois do bloco atual; '@' = cursor
  addBlock(text, edit) {
    if (this.cur) { this.blockAt(text.includes('@') ? text : text + '@'); return; }
    this.snapshot();
    const at = Math.min(this.blocks.length, (this.lastI === undefined ? this.blocks.length - 1 : this.lastI) + 1);
    const caret = text.indexOf('@');
    this.blocks.splice(at, 0, text.replace('@', ''));
    this.lastI = at;
    this.renderAll();
    this.saveNow();
    if (caret >= 0 || edit) this.editBlock(at, caret >= 0 ? caret : undefined);
    else { const el = this.article.querySelector(`.tblock[data-i="${at}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  }

  imageMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const put = async blob => {
      if (!blob) return;
      try { const im = await NB.storeImage(blob); this.addBlock('![](img:' + im.fileId + ')'); if (!this.cur) this.selectImage(im.fileId); }
      catch (er) { toast(er.message); }
    };
    popMenu(r.left, r.bottom + 4, [
      { icon: 'copy', label: 'Colar imagem copiada', onclick: async () => { const b = await NB.clipboardImage(); if (b) put(b); else toast('Nenhuma imagem copiada. Copie uma imagem (ou use Ctrl+V dentro do texto).'); } },
      { icon: 'image', label: 'Escolher arquivo (foto, figura, GIF)…', onclick: async () => put(await NB.pickImageFile()) },
    ]);
  }

  async addVideo() {
    const url = await promptBox('Vídeo do YouTube', 'Cole o endereço do vídeo (ex.: https://youtu.be/… ou https://www.youtube.com/watch?v=…)', '', 'Inserir');
    if (!url) return;
    const y = youtubeId(url.trim());
    if (!y) { toast('Não reconheci um vídeo do YouTube nesse endereço.'); return; }
    this.addBlock('https://youtu.be/' + y.id + (y.t ? '?t=' + y.t : ''));
  }

  async addAudio() {
    const keep = this.cur ? { ta: this.cur.ta, s: this.cur.ta.selectionStart } : null;
    const r = await recordVoiceNote('Nota de voz');
    if (!r) return;
    const line = '![Nota de voz · ' + new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + '](audio:' + r.audioId + ')';
    if (keep && this.cur && this.cur.ta === keep.ta) { keep.ta.focus(); keep.ta.setSelectionRange(keep.s, keep.s); }
    this.addBlock(line);
  }

  insertTable(rows, cols) { if (this.cur) super.insertTable(rows, cols); else this.addBlock(this.tableText(rows, cols)); }

  // figura ou trecho arrastado para cá: entra entre os blocos, onde foi solto
  async dropAt(x, y, p) {
    if (this.cur) this.commit();
    let at = this.blocks.length;
    for (const el of this.article.querySelectorAll('.tblock')) { const r = el.getBoundingClientRect(); if (y < r.top + r.height / 2) { at = +el.dataset.i; break; } }
    const src = p.docId && p.docId !== this.doc.id ? sourceLink(p) : '';
    this.snapshot();
    if (p.kind === 'image' && p.blob) {
      let im;
      try { im = await NB.storeImage(p.blob); } catch (e) { toast(e.message); return; }
      this.blocks.splice(at, 0, '![](img:' + im.fileId + ')', ...(src ? ['*Fonte: ' + src + '*'] : []));
      this.renderAll(); await this.saveNow(); this.snapshot();
      this.selectImage(im.fileId);
      toast('Figura inserida no texto.');
      return;
    }
    if (p.text) {
      this.blocks.splice(at, 0, p.docId === this.doc.id ? '> ' + p.text : quoteMd(p));
      this.renderAll(); await this.saveNow(); this.snapshot();
      toast('Trecho inserido no texto.');
    }
  }

  // ---------- links ----------
  async linkMenu() {
    const ta = this.ta; const s = ta.selectionStart, e = ta.selectionEnd;
    const selText = ta.value.slice(s, e);
    const r = await pickLinkTarget(this.doc);
    if (!r) return;
    if (!this.cur) return;
    ta.focus(); ta.setSelectionRange(s, e);
    if (r.wiki) this.insert('[[#' + r.wiki + (selText ? '|' + selText : '') + ']]');
    else this.insert('[' + (selText || r.label) + '](' + r.href + ')');
  }

  onLink(href) {
    if (/^#h-/.test(href)) { this.scrollToKey(href.slice(1), true); return; }
    const g = parseGo(href);
    if (g) {
      if (this.app.split) { this.app.openInOther(this.sideIdx, { docId: g.docId, pageKey: g.key || 'top', y: g.y }); return; }
      if (g.docId === this.doc.id) { this.scrollToKey(g.key || 'top', true); return; }
      this.app.linkTarget({ docId: g.docId, pageKey: g.key || 'top', y: g.y }).then(done => { if (!done) this.app.openAt(g.docId, g.key, g.y); });
      return;
    }
    if (/^#dg=/.test(href)) { this.app.showDigest(href.slice(4)); return; }
    if (/^#ob=/.test(href)) { openUri('obsidian://' + decodeURIComponent(href.slice(4))); return; }
    if (/^(https?:|mailto:)/i.test(href)) openExternal(href);
  }

  // ---------- tamanho das imagens: ![legenda|largura](img:ID) ----------
  imgSelect(i, img) {
    this.imgDeselect();
    const id = img.dataset.file; if (!id) return;
    const wrap = h('div.imgsel');
    const place = () => {
      const r = img.getBoundingClientRect(), a = this.article.getBoundingClientRect();
      Object.assign(wrap.style, { left: (r.left - a.left) + 'px', top: (r.top - a.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
    };
    const full = () => { const cs = getComputedStyle(this.article); return this.article.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); };
    const set = w => { this.setImgWidth(i, id, Math.round(w)); };
    const handle = h('div.imghandle', { title: 'Arraste para mudar o tamanho' });
    handle.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
      const mv = ev => { img.style.width = Math.max(40, Math.min(full(), w0 + (ev.clientX - x0))) + 'px'; place(); };
      const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); set(img.getBoundingClientRect().width); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });
    const bar = h('div.imgbar', [25, 50, 75, 100].map(p => h('button', { type: 'button', onclick: ev => { ev.stopPropagation(); set(full() * p / 100); } }, p + '%')),
      h('button', { type: 'button', title: 'Tamanho original', onclick: ev => { ev.stopPropagation(); this.setImgWidth(i, id, 0); } }, 'Original'),
      h('button.danger', { type: 'button', onclick: ev => { ev.stopPropagation(); this.snapshot(); this.blocks[i] = this.blocks[i].replace(new RegExp('!\\[[^\\]]*\\]\\(img:' + id + '\\)\\n?'), ''); if (!this.blocks[i].trim()) this.blocks.splice(i, 1); this.imgDeselect(); this.renderAll(); this.saveNow(); } }, 'Remover'));
    wrap.append(handle, bar);
    this.article.appendChild(wrap);
    place();
    this.imgSel = { wrap, i, id };
    setTimeout(() => {
      this.imgOff = ev => { if (!wrap.contains(ev.target) && ev.target !== img) this.imgDeselect(); };
      document.addEventListener('pointerdown', this.imgOff, true);
    }, 0);
  }
  imgDeselect() {
    if (this.imgSel) { this.imgSel.wrap.remove(); this.imgSel = null; }
    if (this.imgOff) { document.removeEventListener('pointerdown', this.imgOff, true); this.imgOff = null; }
  }
  setImgWidth(i, id, w) {
    const re = new RegExp('!\\[([^\\]|]*)(?:\\|\\d+)?\\]\\(img:' + id + '\\)');
    if (!re.test(this.blocks[i])) return;
    this.snapshot();
    this.blocks[i] = this.blocks[i].replace(re, (m, alt) => '![' + alt + (w ? '|' + w : '') + '](img:' + id + ')');
    this.renderAll(); this.saveNow();
    const img = this.article.querySelector(`.tblock[data-i="${i}"] img.mdimg[data-file="${id}"]`);
    if (img) { const go = () => this.imgSelect(i, img); if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true }); }
  }
  // depois de inserir/colar: já mostra o ajuste de tamanho
  selectImage(id) {
    const img = this.article.querySelector(`img.mdimg[data-file="${id}"]`);
    if (!img) return;
    const bl = img.closest('.tblock'); if (!bl) return;
    const go = () => { img.scrollIntoView({ block: 'nearest' }); this.imgSelect(+bl.dataset.i, img); };
    if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true });
  }

  // ---------- tabela ----------
  tableEditor(i) {
    const src = this.blocks[i];
    const lines = src.split('\n');
    const a = lines.findIndex(l => l.trim().startsWith('|'));
    let b = a; while (b + 1 < lines.length && lines[b + 1].trim().startsWith('|')) b++;
    const t = a >= 0 ? parseTable(lines.slice(a, b + 1).join('\n')) : null;
    if (!t) { this.editBlock(i); return; }
    const grid = h('div.tegrid');
    const render = () => {
      clear(grid);
      grid.style.gridTemplateColumns = 'repeat(' + t.head.length + ', minmax(110px, 1fr)) 36px';
      const cell = (row, j, isHead) => { const inp = h('input' + (isHead ? '.th' : ''), { type: 'text', value: row[j] || '' }); inp.addEventListener('input', () => { row[j] = inp.value; }); return inp; };
      t.head.forEach((_, j) => grid.appendChild(cell(t.head, j, true)));
      grid.appendChild(h('span'));
      t.rows.forEach((row, ri) => {
        row.forEach((_, j) => grid.appendChild(cell(row, j)));
        grid.appendChild(h('button.ibtn.small', { type: 'button', title: 'Apagar esta linha', onclick: () => { t.rows.splice(ri, 1); render(); } }, icon('trash', 16)));
      });
      t.head.forEach((_, j) => grid.appendChild(h('button.sbtn.small', { type: 'button', title: 'Apagar esta coluna', onclick: () => { if (t.head.length < 2) return; t.head.splice(j, 1); t.align.splice(j, 1); t.rows.forEach(r => r.splice(j, 1)); render(); } }, '✕ col.')));
    };
    render();
    const m = modal('Tabela', h('div.teditor',
      h('p.muted', 'Edite as células. Pode usar $equações$ e **negrito** dentro delas.'),
      h('div.tescroll', grid),
      h('div.btnrow',
        h('button.sbtn', { type: 'button', onclick: () => { t.rows.push(t.head.map(() => '')); render(); } }, '+ Linha'),
        h('button.sbtn', { type: 'button', onclick: () => { t.head.push('Coluna ' + (t.head.length + 1)); t.align.push('l'); t.rows.forEach(r => r.push('')); render(); } }, '+ Coluna'),
        h('button.sbtn', { type: 'button', onclick: () => { m.close(); this.editBlock(i); } }, 'Editar como texto'))), [
      { label: 'Cancelar' },
      { label: 'Salvar', primary: true, onclick: c => {
        c();
        this.snapshot();
        lines.splice(a, b - a + 1, ...tableMarkdown(t).split('\n'));
        this.blocks[i] = lines.join('\n');
        this.renderAll(); this.saveNow();
      } },
    ], { wide: true, focus: false });
  }

  // ---------- seleção no texto formatado: Digest, realce, link, nota… ----------
  hideSel() { this.selMenu.classList.remove('show'); }
  onSelection() {
    if (!this.root.isConnected || this.cur) { this.hideSel(); return; }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { this.hideSel(); return; }
    const rg = sel.getRangeAt(0);
    if (!this.article.contains(rg.commonAncestorContainer)) { this.hideSel(); return; }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) { this.hideSel(); return; }
    const node = rg.startContainer.nodeType === 3 ? rg.startContainer.parentElement : rg.startContainer;
    const bl = node && node.closest('.tblock');
    const i = bl ? +bl.dataset.i : -1;
    const rect = rg.getBoundingClientRect();
    const b = (ic, label, fn) => h('button.mbtn', { type: 'button', onpointerdown: e => e.preventDefault(), onclick: () => { this.hideSel(); fn(); } }, icon(ic, 18), h('span', label));
    clear(this.selMenu);
    this.selMenu.append(
      b('digest', 'Digest', () => this.toDigest(i, text)),
      b('marker', 'Realçar', () => this.wrapText(i, text, '==', '==')),
      b('link', 'Link', async () => { const r = await pickLinkTarget(this.doc); if (r) this.wrapText(i, text, r.wiki ? '[[#' + r.wiki + '|' : '[', r.wiki ? ']]' : '](' + r.href + ')'); }),
      b('callout', 'Caixa', () => calloutMenu(Math.max(8, rect.left), rect.bottom + 8, t => this.calloutFromSel(i, text, t))),
      b('note', 'Nota', () => { this.lastI = i; this.addBlock('> [!note] Sobre “' + text.slice(0, 60) + (text.length > 60 ? '…' : '') + '”\n> @'); }),
      b('copy', 'Copiar', () => { copyText(text); toast('Copiado.'); }),
      b('translate', 'Traduzir', () => translatePop(text, rect, this.doc)),
      b('wiki', 'Wikipédia', () => wikiPop(text, rect)),
      b('sigma', 'Índice n,k', async () => (await import('./nkdb.js')).nkPop(text, rect)));
    const dg = h('button.mbtn', { type: 'button', title: 'Arraste o trecho para um caderno ou outro texto' }, icon('grip', 18), h('span', 'Arrastar'));
    makeDraggable(dg, () => ({ kind: 'text', text, docId: this.doc.id, pageKey: this.nearestHeading(i), y: 0, title: S.docTitle(this.doc), label: pageLabel(this.nearestHeading(i), this.doc) }));
    dg.addEventListener('pointerdown', e => (e.pointerType !== 'mouse' || window.AndroidBridge) && setTimeout(() => this.hideSel(), 60));
    this.selMenu.appendChild(dg);
    this.selMenu.classList.add('show');
    const mr = this.selMenu.getBoundingClientRect();
    this.selMenu.style.left = Math.max(8, Math.min(innerWidth - mr.width - 8, rect.left + rect.width / 2 - mr.width / 2)) + 'px';
    this.selMenu.style.top = (rect.top - mr.height - 10 > 60 ? rect.top - mr.height - 10 : rect.bottom + 10) + 'px';
  }

  // acha o trecho no Markdown do bloco e põe marcas em volta
  wrapText(i, text, a, z) {
    if (i < 0) return;
    const src = this.blocks[i];
    let k = src.indexOf(text), len = text.length;
    if (k < 0) {
      const re = new RegExp(text.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
      const m = re.exec(src);
      if (m) { k = m.index; len = m[0].length; }
    }
    if (k < 0) { toast('Não consegui marcar esse trecho aqui (há formatação no meio). Toque no bloco para editar o texto.', 4500); return; }
    this.snapshot();
    this.blocks[i] = src.slice(0, k) + a + src.slice(k, k + len) + z + src.slice(k + len);
    window.getSelection().removeAllRanges();
    this.renderAll(); this.saveNow();
  }

  // o trecho selecionado vira uma caixa de nota (o resto do parágrafo fica antes e depois)
  calloutFromSel(i, text, t) {
    if (i < 0) return;
    const src = this.blocks[i];
    let k = src.indexOf(text), len = text.length;
    if (k < 0) {
      const re = new RegExp(text.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
      const m = re.exec(src); if (m) { k = m.index; len = m[0].length; }
    }
    this.snapshot();
    let parts;
    if (k < 0) parts = [calloutMd(t, src.replace(/^>\s?/gm, ''))];      // não achou o trecho exato: o bloco inteiro vira caixa
    else parts = [src.slice(0, k).trim(), calloutMd(t, src.slice(k, k + len).trim()), src.slice(k + len).trim()].filter(Boolean);
    this.blocks.splice(i, 1, ...parts);
    window.getSelection().removeAllRanges();
    this.renderAll(); this.saveNow();
    toast('Caixa “' + t.label + '” criada.');
  }

  nearestHeading(i) {
    let key = 'top';
    const all = headings(this.blocks.slice(0, i + 1).join('\n\n'));
    if (all.length) key = all[all.length - 1].id;
    return key;
  }

  toDigest(i, text) {
    const d = { doc: this.doc.id, name: S.docTitle(this.doc), page: 0, pageKey: this.nearestHeading(i), quote: text, note: '', tags: [], area: [] };
    digestPanel(this.right, d, {
      onContinue: () => toast('Continuação não se aplica a textos: selecione o trecho inteiro.'),
      onClose: () => this.right.classList.remove('open'),
      onSaved: it => { this.right.classList.remove('open'); toast('Salvo no Digest.'); if (it) this.wrapText(i, text, '[', '](digest:' + it.id + ')'); },
    });
    this.right.classList.add('open');
  }

  // ---------- painel lateral ----------
  toggleSide(tab) {
    if (tab && this.sideOpen && this.sideTab !== tab) { this.sideTab = tab; this.renderSide(); return; }
    this.sideOpen = !this.sideOpen;
    if (tab) this.sideTab = tab;
    this.sideTab = this.sideTab || 'sumario';
    this.side.classList.toggle('open', this.sideOpen);
    if (this.sideOpen) this.renderSide();
  }
  async renderSide() {
    const sd = this.side; clear(sd);
    const tabs = [['sumario', 'Sumário'], ['ligacoes', 'Ligações'], ['busca', 'Busca']];
    sd.appendChild(h('div.stabs', { role: 'tablist' }, tabs.map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.sideTab === id), onclick: () => { this.sideTab = id; this.renderSide(); } }, l))));
    const body = h('div.sbody'); sd.appendChild(body);
    if (this.sideTab === 'sumario') {
      // títulos e caixas de nota, na ordem do texto
      const f = this.tocFilter || 'tudo';
      body.appendChild(h('div.chips.pad', [['tudo', 'Tudo'], ['titulos', 'Títulos'], ['caixas', 'Caixas de nota']].map(([id, l]) => h('button.chip', { type: 'button', 'aria-pressed': String(f === id), onclick: () => { this.tocFilter = id; this.renderSide(); } }, l))));
      const srcs = this.blocks;
      const all = headings(srcs.join('\n\n'));
      const cos = listCallouts(srcs);
      let hp = 0, any = false;
      const cCount = {};
      srcs.forEach((md, i) => {
        const nh = headings(md).length;
        if (f !== 'caixas') for (const x of all.slice(hp, hp + nh)) { any = true; body.appendChild(h('button.srow.toc' + Math.min(x.level, 4), { type: 'button', onclick: () => this.scrollToKey(x.id, true) }, h('span.clamp', x.text))); }
        hp += nh;
        if (f !== 'titulos') for (const c of cos.filter(x => x.i === i)) {
          any = true;
          const n = cCount[i] = (cCount[i] || 0); cCount[i]++;
          const ic = calloutIcon(c.t, 16); ic.style.color = c.t.color;
          body.appendChild(h('button.srow.cotoc', { type: 'button', onclick: () => this.scrollToKey('co-' + i + '-' + n, true) }, ic, h('div.grow', h('div.clamp', c.title), c.text ? h('div.muted.clamp', c.text.slice(0, 90)) : null)));
        }
      });
      if (!any) body.appendChild(h('p.muted.pad', f === 'caixas' ? 'Nenhuma caixa de nota. Use o botão ▣ da barra lateral, “Caixa” no menu de seleção ou “▣ Caixa” na barra de edição.' : 'Escreva títulos com #, ## ou ### (no começo da linha) e o sumário aparece aqui.'));
    } else if (this.sideTab === 'ligacoes') {
      const docs = await S.allDocs();
      const md = this.joined();
      const out = [];
      md.replace(/\[([^\]]*)\]\((leitor:\/\/[^)]+|digest:[\w-]+|https?:[^)\s]+)\)/g, (m, t, href) => { out.push({ t, href }); return m; });
      body.appendChild(h('div.shead', h('span', 'Saindo deste texto')));
      if (!out.length) body.appendChild(h('p.muted.pad', 'Use o botão 🔗 da barra (ou selecione um trecho e toque em Link).'));
      for (const o of out) {
        const go = /^leitor:\/\/([\w-]+)\/([\w-]*)/.exec(o.href);
        const d = go && docs.find(x => x.id === go[1]);
        const where = go ? (d ? S.docTitle(d) + (go[2] ? ', ' + pageLabel(go[2], d) : '') : 'documento apagado') : o.href.startsWith('digest:') ? 'Digest' : o.href;
        body.appendChild(h('button.srow', { type: 'button', onclick: () => this.onLink(go ? '#go=' + go[1] + '~' + go[2] + '~0' : o.href.startsWith('digest:') ? '#dg=' + o.href.slice(7) : o.href) }, icon('fwd', 16), h('div.grow', h('div.clamp', o.t || '(link)'), h('div.muted.clamp', '→ ' + where))));
      }
      body.appendChild(h('div.shead', h('span', 'Chegando aqui')));
      await this.app.refreshLinkIndex();
      const inc = this.app.linksTo(this.doc.id).filter(a => a.docId !== this.doc.id);
      if (!inc.length) body.appendChild(h('p.muted.pad', 'Nenhum link aponta para este texto.'));
      for (const a of inc) {
        body.appendChild(h('button.srow', { type: 'button', onclick: () => this.app.openAt(a.docId, a.pageKey, a.rects ? a.rects[0][1] : 0) }, icon('back', 16), h('div.grow', h('div.clamp', a.srcTitle + ' · ' + a.srcLabel), h('div.muted.clamp', (a.text ? '“' + a.text + '” ' : '') + '→ ' + pageLabel(a.target.pageKey, this.doc)))));
      }
    } else {
      const inp = h('input', { type: 'search', placeholder: 'Buscar neste texto…', value: this.q || '' });
      const res = h('div');
      const run = () => {
        clear(res); this.q = inp.value;
        const q = inp.value.trim().toLowerCase(); if (q.length < 2) return;
        this.blocks.forEach((b, i) => {
          const t = plainText(b); const k = t.toLowerCase().indexOf(q);
          if (k >= 0) res.appendChild(h('button.srow', { type: 'button', onclick: () => { const el = this.article.querySelector(`.tblock[data-i="${i}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flashblock'); setTimeout(() => el.classList.remove('flashblock'), 1600); } } },
            h('div.clamp', (k > 30 ? '…' : '') + t.slice(Math.max(0, k - 30), k), h('mark', t.slice(k, k + q.length)), t.slice(k + q.length, k + 80))));
        });
        if (!res.children.length) res.appendChild(h('p.muted.pad', 'Nada encontrado.'));
      };
      inp.addEventListener('input', run);
      body.append(h('div.pad', inp), res);
      run(); setTimeout(() => inp.focus(), 30);
    }
  }

  moreMenu(e) {
    popMenu(e.clientX - 220, e.clientY + 10, [
      { icon: 'note', label: 'Renomear', onclick: async () => { const n = await promptBox('Renomear', 'Nome', this.doc.name, 'Salvar'); if (n && n.trim()) { this.doc.name = n.trim(); await S.saveDoc(this.doc); this.titleEl.textContent = n.trim(); } } },
      { icon: 'doc', label: 'Editar tudo como Markdown', onclick: () => this.sourceMode() },
      { icon: 'bookmark', label: this.doc.fav ? 'Tirar dos favoritos' : 'Favoritar ★', onclick: async () => { this.doc.fav = !this.doc.fav; await S.saveDoc(this.doc); toast(this.doc.fav ? 'Nos favoritos.' : 'Fora dos favoritos.'); } },
      { icon: 'share', label: 'Compartilhar… (menu do Android)', onclick: async () => { await this.saveNow(); (await import('./share.js')).shareDoc(this.doc); } },
      { icon: 'list', label: 'Sumário, ligações e busca', onclick: () => this.toggleSide() },
      { icon: 'folder', label: 'Projetos…', onclick: async () => { const { openProjectsDialog } = await import('./dialogs.js'); openProjectsDialog(this.doc); } },
      { icon: 'digest', label: 'Abrir o Digest', onclick: () => this.app.showDigest() },
      document.documentElement.dataset.eink ? null : { icon: 'pages', label: 'Abrir em nova janela (DeX, computador)', onclick: () => this.app.newWindow(this.doc.id) },
      { icon: 'gear', label: 'Configurações', onclick: () => this.app.openSettings() },
    ]);
  }

  // o texto inteiro numa caixa só (para colar ou reorganizar muita coisa de uma vez)
  sourceMode() {
    if (this.cur) this.commit();
    const ta = h('textarea.tdsource', { spellcheck: true });
    ta.value = this.joined();
    modal('Markdown do texto inteiro', ta, [
      { label: 'Cancelar' },
      { label: 'Aplicar', primary: true, onclick: c => { c(); this.snapshot(); this.blocks = splitBlocks(ta.value); this.renderAll(); this.saveNow(); this.snapshot(); } },
    ], { wide: true });
  }
}

// ---------- escolher destino de link (usado no texto) ----------
export async function pickLinkTarget(doc) {
  const docs = await S.allDocs();
  const dg = await S.digest();
  const st = await S.settings();
  return new Promise(resolve => {
    let type = 'secao', done = false;
    const state = { docId: '', key: '', url: 'https://', file: '', dg: '', sec: '' };
    const tabs = h('div.chips'); const panel = h('div.lbpanel');
    const render = async () => {
      clear(tabs); clear(panel);
      for (const [id, l] of [['secao', 'Seção deste texto'], ['doc', 'PDF, caderno ou texto'], ['digest', 'Digest'], ['obsidian', 'Obsidian'], ['url', 'Site']]) tabs.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(type === id), onclick: () => { type = id; render(); } }, l));
      if (type === 'secao') {
        const hs = headings(doc.md || '');
        if (!hs.length) { panel.appendChild(h('p.muted', 'Este texto ainda não tem títulos (#, ##, ###).')); return; }
        if (!state.sec) state.sec = hs[0].text;
        const sel = h('select', { onchange: () => { state.sec = sel.value; } }, hs.map(x => h('option', { value: x.text }, ' '.repeat(x.level - 1) + x.text)));
        sel.value = state.sec;
        panel.appendChild(h('label.field', h('span', 'Título'), sel));
      } else if (type === 'doc') {
        const others = docs.filter(d => d.id !== doc.id);
        if (!others.length) { panel.appendChild(h('p.muted', 'Não há outros documentos na biblioteca.')); return; }
        if (!state.docId) state.docId = others[0].id;
        const ds = h('select', { onchange: () => { state.docId = ds.value; state.key = ''; render(); } }, others.map(d => h('option', { value: d.id }, (d.kind === 'notebook' ? '📓 ' : d.kind === 'text' ? '📝 ' : '📄 ') + S.docTitle(d))));
        ds.value = state.docId;
        const d = others.find(x => x.id === state.docId);
        let pages = [];
        try { pages = d.kind === 'notebook' ? NB.nbPageList(d) : d.kind === 'text' ? textTargets(d) : pageList(d, await openPdf(d)); } catch (e) { pages = []; }
        if (!state.key && pages[0]) state.key = pages[0].key;
        const ps = h('select', { onchange: () => { state.key = ps.value; } }, pages.map(p => h('option', { value: p.key }, p.kind === 'hd' ? p.label : p.kind === 'nb' ? (p.n ? 'Página ' + p.n : 'Capa') : p.kind === 'pdf' ? 'Página ' + p.n : 'Página em branco')));
        ps.value = state.key;
        panel.append(h('label.field', h('span', 'Documento'), ds), h('label.field', h('span', d.kind === 'text' ? 'Seção' : 'Página'), ps));
      } else if (type === 'digest') {
        const inp = h('input', { type: 'search', placeholder: 'Buscar no Digest…' });
        const list = h('div.picklist.short');
        const fill = () => { clear(list); for (const it of dgFilter(dg, { text: inp.value }, 'recentes').slice(0, 40)) list.appendChild(h('button.pickrow', { type: 'button', 'aria-pressed': String(state.dg === it.id), onclick: () => { state.dg = it.id; fill(); } }, h('span.clamp', it.quote || it.note), h('span.muted', it.src.name))); };
        inp.addEventListener('input', fill); fill();
        panel.append(inp, list);
      } else if (type === 'obsidian') {
        const inp = h('input', { type: 'text', placeholder: 'Nome da nota no Obsidian', value: state.file });
        inp.addEventListener('input', () => { state.file = inp.value; });
        panel.append(h('label.field', h('span', 'Nota do Obsidian'), inp));
      } else {
        const inp = h('input', { type: 'url', value: state.url });
        inp.addEventListener('input', () => { state.url = inp.value; });
        panel.append(h('label.field', h('span', 'Endereço do site'), inp));
      }
    };
    render();
    modal('Link', h('div', tabs, panel), [
      { label: 'Cancelar' },
      { label: 'Inserir link', primary: true, onclick: c => {
        let r = null;
        if (type === 'secao') { if (!state.sec) return; r = { wiki: state.sec, label: state.sec }; }
        else if (type === 'doc') { const d = docs.find(x => x.id === state.docId); if (!d) return; r = { href: 'leitor://' + d.id + '/' + (state.key === 'top' ? '' : state.key), label: S.docTitle(d) + (state.key && state.key !== 'top' ? ', ' + pageLabel(state.key, d) : '') }; }
        else if (type === 'digest') { if (!state.dg) { toast('Escolha um trecho do Digest.'); return; } const it = dgFind(dg, state.dg); r = { href: 'digest:' + state.dg, label: 'Digest: ' + ((it && (it.quote || it.note)) || '').slice(0, 40) }; }
        else if (type === 'obsidian') { if (!state.file.trim()) return; r = { href: 'obsidian://open?' + (st.obsidianVault ? 'vault=' + encodeURIComponent(st.obsidianVault) + '&' : '') + 'file=' + encodeURIComponent(state.file.trim()), label: state.file.trim() }; }
        else { if (!/^https?:\/\/.+\..+/.test(state.url)) { toast('Endereço inválido.'); return; } r = { href: state.url.trim(), label: state.url.trim() }; }
        done = true; c(); resolve(r);
      } },
    ], { wide: true, focus: false, onclose: () => { if (!done) resolve(null); } });
  });
}

// ---------- exportar ----------
async function obsidianMd(doc, files, folder) {
  const docs = await S.allDocs();
  const name = safeName(doc.name);
  let md = doc.md || '';
  const blocks = splitBlocks(md);
  const num = numberAll([{ id: 0, md }]);
  md = markdownForObsidian(md, 0, num.labels);
  void blocks;
  for (const id of textFileIds(md)) {
    const b = await S.audioBlob(id);
    if (!b) continue;
    const ext = /png/.test(b.type) ? 'png' : /jpe?g/.test(b.type) ? 'jpg' : /gif/.test(b.type) ? 'gif' : /webp/.test(b.type) ? 'webp' : /mp4/.test(b.type) ? 'm4a' : /ogg/.test(b.type) ? 'ogg' : 'webm';
    const fn = name + '-' + id + '.' + ext;
    if (files) files[folder + '/Anexos/' + fn] = new Uint8Array(await b.arrayBuffer());
    md = md.replace(new RegExp('!\\[([^\\]]*)\\]\\((?:img|audio):' + id + '\\)', 'g'), (m, alt) => { const w = (alt.match(/\|(\d+)$/) || [])[1]; return '![[' + fn + (w ? '|' + w : '') + ']]'; });
  }
  md = md.replace(/\[([^\]]*)\]\(leitor:\/\/([\w-]+)\/([\w-]*)[^)]*\)/g, (m, t, id, key) => { const d = docs.find(x => x.id === id); return t + (d ? ' (→ ' + S.docTitle(d) + (key ? ', ' + pageLabel(key, d) : '') + ')' : ''); });
  md = md.replace(/\[([^\]]*)\]\(digest:[\w-]+\)/g, '$1');
  md = md.replace(/^[ \t]*(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/\S+)[ \t]*$/gm, '![]($1)');
  md = md.replace(/^[ \t]*\[\[(?:sumario|sumário|toc)\]\][ \t]*$/gim, '');
  return md;
}

export async function textObsidianFiles(doc, folder = 'Textos') {
  const files = {};
  const md = await obsidianMd(doc, files, folder);
  files[folder + '/' + safeName(doc.name) + '.md'] = new TextEncoder().encode(md);
  return files;
}

// PDF: blocos desenhados em sequência numa página A4 (texto e equações viram imagem)
export async function textPdf(doc) {
  const { PDFDocument, rgb, StandardFonts } = await import('../vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.name); pdf.setCreator('Leitor de Pesquisa');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M;
  let page = pdf.addPage([W, H]); let y = M;
  const need = hh => { if (y + hh > H - M && y > M) { page = pdf.addPage([W, H]); y = M; } };
  const blocks = splitBlocks(doc.md || '');
  const num = numberAll(blocks.map((md, i) => ({ id: i, md })));
  const hs = headings(doc.md || '');
  const tocHtml = '<p><b>Sumário</b></p><ul>' + hs.map(x => '<li style="margin-left:' + (x.level - 1) * 14 + 'px;list-style:none">' + x.text.replace(/</g, '&lt;') + '</li>').join('') + '</ul>';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i].trim();
    const im = b.match(/^!\[[^\]]*?(?:\|(\d+))?\]\(img:([\w-]+)\)$/);
    const au = b.match(/^!\[([^\]]*)\]\(audio:([\w-]+)\)$/);
    const yt = youtubeId(b) && !/\s/.test(b) ? youtubeId(b) : null;
    try {
      if (im) {
        const blob = await S.audioBlob(im[2]); if (!blob) continue;
        let bytes = new Uint8Array(await blob.arrayBuffer()); let img;
        if (/png/.test(blob.type)) img = await pdf.embedPng(bytes);
        else if (/jpe?g/.test(blob.type)) img = await pdf.embedJpg(bytes);
        else { const u = URL.createObjectURL(blob); const el = await new Promise((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = rej; x.src = u; }); const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight; c.getContext('2d').drawImage(el, 0, 0); URL.revokeObjectURL(u); bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); img = await pdf.embedPng(bytes); }
        let w = Math.min(CW, im[1] ? +im[1] * 0.75 : img.width * 0.75), hh = w * img.height / img.width;
        if (hh > H - 2 * M) { hh = H - 2 * M; w = hh * img.width / img.height; }
        need(hh + 10);
        page.drawImage(img, { x: M + (CW - w) / 2, y: H - y - hh, width: w, height: hh });
        y += hh + 12;
        continue;
      }
      let html;
      if (au) { html = '<p>🎙 ' + (au[1] || 'Nota de voz') + ' <i>(áudio anexado a este PDF)</i></p>'; const blob = await S.audioBlob(au[2]); if (blob) await pdf.attach(new Uint8Array(await blob.arrayBuffer()), 'audio-' + au[2] + '.webm', { mimeType: blob.type || 'audio/webm', description: au[1] || 'Nota de voz' }); }
      else if (yt) html = '<p>▶ Vídeo do YouTube: https://youtu.be/' + yt.id + (yt.t ? '?t=' + yt.t : '') + '</p>';
      else if (/^\[\[(sumario|sumário|toc)\]\]$/i.test(b)) html = tocHtml;
      else html = renderMarkdown(b, num.starts[i] || 0, num.labels);
      const r = await NB.rasterBox(html, CW);
      let hh = r.h, w = CW;
      if (hh > H - 2 * M) { const k = (H - 2 * M) / hh; hh *= k; w *= k; }
      need(hh);
      const png = await pdf.embedPng(r.png);
      page.drawImage(png, { x: M, y: H - y - hh, width: w, height: hh });
      y += hh + 4;
    } catch (e) {
      console.warn('bloco', e);
      need(16);
      page.drawText(plainText(b).slice(0, 500), { x: M, y: H - y - 12, size: 10, font, maxWidth: CW, lineHeight: 13, color: rgb(0.1, 0.1, 0.1) });
      y += 30;
    }
  }
  return pdf.save();
}

export function openTextExport(doc) {
  if (!doc) return;
  const name = safeName(doc.name);
  modal('Exportar texto', h('div',
    h('p.muted', 'Markdown: o arquivo .md abre no Obsidian e em qualquer editor (equações numeradas com \\tag, imagens e áudios no pacote). PDF: o texto e as equações saem como imagem.'),
    h('div.btnrow',
      h('button.pbtn', { type: 'button', onclick: async () => { toast('Gerando…'); const { zipSync } = await import('../vendor/fflate.js'); downloadBlob(new Blob([zipSync(await textObsidianFiles(doc))], { type: 'application/zip' }), name + '-Obsidian.zip'); } }, 'Pacote Obsidian (.zip)'),
      h('button.sbtn', { type: 'button', onclick: async () => { const md = await obsidianMd(doc, null, 'Textos'); downloadBlob(new Blob([md], { type: 'text/markdown' }), name + '.md'); } }, 'Só o arquivo .md'),
      h('button.sbtn', { type: 'button', onclick: async () => { toast('Gerando o PDF…', 8000); downloadBlob(new Blob([await textPdf(doc)], { type: 'application/pdf' }), name + '.pdf'); } }, 'Salvar PDF'),
      h('button.sbtn', { type: 'button', onclick: async () => { toast('Gerando o PDF…', 8000); shareFile(new Blob([await textPdf(doc)], { type: 'application/pdf' }), name + '.pdf'); } }, 'Compartilhar PDF'))), [{ label: 'Fechar' }]);
}
