// Tela do leitor: ferramentas, menu de seleção, painel lateral, Digest, links, notas, voz, IA.
import { Viewer, darker } from './viewer.js';
import * as S from './store.js';
import { openPdf, getPage, pageList, pageText, resolveDest, outline, pageLabel, pageNum } from './pdfdoc.js';
import { h, clear, icon, btn, toast, modal, popMenu, promptBox, confirmBox, copyText, cleanText, fold, CATS, catInfo, INK_COLORS, uid, fmtTime, debounce, downloadBlob, safeName } from './util.js';
import { recordVoiceNote, SessionRecorder, playAudio } from './audio.js';
import * as AI from './ai.js';
import { openExportDialog, openObsidianDialog, openMetaDialog, showAiResult, openBriefing } from './dialogs.js';
import { digestPanel } from './digestui.js';
import { speak, stopSpeak } from './tts.js';
import { openExternal, openUri } from './platform.js';
import { translatePop, wikiPop } from './lookup.js';
import * as NB from './notebook.js';
import { headings, plainText } from './md.js';
import { openNotebookExport } from './dialogs.js';
import { bindTwoFingerSwipe } from './util.js';
import { parseGo } from './embeds.js';
import { textTargets } from './textdoc.js';
import { makeDraggable, quoteMd, sourceLink } from './dnd.js';
import { buildMathPal } from './mathpal.js';
import { ERASER_SIZES } from './eraser.js';
import { isEink, fastPen, flash } from './eink.js';
import { form } from './form.js';

export class Reader {
  constructor(app, side = 0) {
    this.app = app;
    this.sideIdx = side;
    this.tool = 'read';
    this.viewers = [];
    this.active = null;
    this.docHist = [];
    this.picking = null;
    this.recorder = new SessionRecorder(() => this.updateRecBtn());
    this.textEditor = new NB.TextEditor(this);
    // colar imagem (Ctrl+V / colar) no caderno
    document.addEventListener('paste', async e => {
      if (!this.root.isConnected || !this.isFront() || !this.doc || !NB.isNotebook(this.doc) || this.textEditor.active) return;
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(x => x.type.startsWith('image/'));
      if (!it) return;
      e.preventDefault();
      this.placeImage(it.getAsFile());
    });
    this.root = h('div.reader');
    this.buildChrome();
    S.on('settings', st => { this.settings = st; this.applyPdfMode(); });
    S.on('annots', () => { if (this.sideTab && this.sideOpen) this.renderSide(); });
    // documento alterado em outro aparelho (sincronização): atualiza o que está aberto
    S.on('docRemote', d => {
      for (const v of this.viewers) {
        if (!v.doc || v.doc.id !== d.id) continue;
        const relay = JSON.stringify(v.doc.pages) !== JSON.stringify(d.pages) || JSON.stringify(v.doc.margins) !== JSON.stringify(d.margins) || JSON.stringify(v.doc.blanks) !== JSON.stringify(d.blanks);
        for (const k of Object.keys(v.doc)) if (!(k in d)) delete v.doc[k];
        Object.assign(v.doc, JSON.parse(JSON.stringify(d)));
        if (relay) v.refreshPages();
        if (v === this.active) this.titleEl.textContent = S.docTitle(v.doc);
      }
    });
    document.addEventListener('selectionchange', debounce(() => this.onSelection(), 220));
    // enquanto arrasta a seleção, o menu fica escondido; ao soltar, aparece
    const sc = e => { if (this.root.isConnected && e.target.closest && e.target.closest('.textLayer')) this.selDragging = true; };
    const up = () => { if (this.selDragging) { this.selDragging = false; setTimeout(() => this.onSelection(), 30); } };
    document.addEventListener('pointerdown', sc, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', e => {
      if (!this.root.isConnected || !this.isFront()) return;
      if (e.target.closest && e.target.closest('input, textarea')) return;   // dentro de um campo vale o desfazer do próprio campo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); this.redo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); this.pageJump(this.pagePill); }
      // Delete (ou Backspace): apaga o que está selecionado (forma, traços, imagem…)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const v = this.viewers.find(x => x.sel);
        if (!v || (this.textEditor && this.textEditor.active)) return;
        e.preventDefault();
        this.deleteSelection(v);
      }
    });
  }

  get doc() { return this.active && this.active.doc; }

  async saveAsShape(list) {
    const MY = await import('./myshapes.js');
    const st = await MY.load();
    const go = async catId => {
      const label = await promptBox('Nova forma', 'Nome da forma (ex.: Montagem da pinça)', ''); if (label === null) return;
      try {
        const ink = list.filter(a => a.kind === 'ink');
        if (ink.length) await MY.addFromStrokes(catId, label, ink);
        else { const b = await S.audioBlob(list[0].fileId); await MY.addFromImage(catId, label, b); }
        toast('Forma salva em “' + ((await MY.load()).cats.find(c => c.id === catId) || {}).name + '”.', 2500);
      } catch (e) { toast(e.message, 3500); }
    };
    const newCat = async () => { const n = await promptBox('Nova categoria de formas', 'Nome (ex.: Montagens do laboratório)', ''); if (n) go((await MY.addCat(n)).id); };
    if (!st.cats.length) return newCat();
    popMenu(innerWidth / 2 - 120, 120, st.cats.map(c => ({ icon: 'folder', label: c.name, onclick: () => go(c.id) })).concat([{ icon: 'plus', label: 'Nova categoria…', onclick: newCat }]));
  }

  // melhor ajuste (tela simples, dividida ou modo artigo): vale para os dois lados da tela dividida
  async bestFit() {
    const v = this.active; if (!v) return;
    const on = await v.bestFit();
    if (this.app.split) {
      for (const r of this.app.readers) if (r !== this && r.root.isConnected && r.active && r.active.doc) await r.active.bestFit(on);
      for (const t of this.app.texts) if (t.root.isConnected) t.bestFit(on);
    }
    this.fitBtn.setAttribute('aria-pressed', String(on));
    if (this.fitRail) this.fitRail.setAttribute('aria-pressed', String(on));
    toast(on ? 'Melhor ajuste: bordas cortadas e texto na largura da tela.' : 'Página inteira.', 1500);
  }

  async deleteSelection(v) {
    const sel = v.sel; if (!sel) return;
    const list = v.annsOf(sel.s.p.key).filter(a => sel.ids.has(a.id));
    v.clearSelection();
    document.querySelectorAll('.popmenu.objmenu').forEach(e => e.remove());
    if (list.length) { await S.delAnnots(list); toast(list.length + ' item(ns) apagado(s). Ctrl+Z desfaz.', 1800); }
  }

  // ---------- estrutura ----------
  buildChrome() {
    const r = this.root;
    this.titleEl = h('div.rtitle');
    this.pageEl = h('button.rpage', { type: 'button', title: 'Ir para a página… (Ctrl+G)', onclick: e => this.pageJump(e.currentTarget) });
    this.pagePill = h('button.pagepill', { type: 'button', title: 'Ir para a página…', onclick: e => this.pageJump(e.currentTarget) });
    this.backBtn = btn('undo', 'Voltar', () => this.goBack(), { cls: 'sbtn backlink', title: 'Voltar ao ponto anterior' });
    this.backBtn.style.display = 'none';
    this.recBtn = btn('rec', '', () => this.toggleRec(), { title: 'Gravar sessão (áudio sincronizado com a escrita)', iconOnly: true });
    this.recBtn.classList.add('recbtn');
    this.modeBtn = btn('sun', '', () => this.cyclePdfMode(), { title: 'Modo da página: normal, sépia, escuro', iconOnly: true });
    this.fmtSlot = h('div.fmtslot');
    const hideTb = el => { el.classList.add('hide-tb'); return el; };
    const top = h('header.rtop',
      btn('back', '', () => this.app.showLibrary(), { title: 'Biblioteca', iconOnly: true }),
      btn('list', '', () => this.toggleSide(), { title: 'Painel lateral: sumário, páginas, anotações, busca', iconOnly: true }),
      h('div.rtitles', this.titleEl, this.pageEl),
      this.backBtn,
      btn('back', '', () => this.turn(-1), { title: 'Página anterior', iconOnly: true, cls: 'ibtn eink-only' }),
      btn('fwd', '', () => this.turn(1), { title: 'Próxima página', iconOnly: true, cls: 'ibtn eink-only' }),
      this.fmtSlot,
      h('div.grow.hide-tb'),
      btn('swap', '', e => this.recentMenu(e), { title: 'Arquivos recentes (ou deslize dois dedos na página)', iconOnly: true }),
      hideTb(btn('search', '', () => this.toggleSide('busca'), { title: 'Buscar no PDF', iconOnly: true })),
      hideTb(btn('split', '', () => this.toggleSplit(), { title: 'Lado a lado', iconOnly: true, cls: 'ibtn no-eink' })),
      this.fitBtn = btn('fitpage', '', () => this.bestFit(), { title: 'Melhor ajuste: o texto ocupa a largura da tela (corta as bordas brancas). Toque de novo para a página inteira.', iconOnly: true }),
      this.articleBtn = hideTb(btn('columns', '', () => this.openArticle(), { title: 'Modo artigo: uma coluna do PDF por vez, na largura da tela', iconOnly: true, cls: 'ibtn notnb' })),
      hideTb(this.modeBtn),
      hideTb(this.recBtn),
      hideTb(btn('digest', 'Digest', () => this.app.showDigest(), { cls: 'sbtn hide-sm' })),
      btn('upload', 'Exportar', () => NB.isNotebook(this.doc) ? openNotebookExport(this.doc) : openExportDialog(this.doc), { cls: 'pbtn' }),
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
      tb('lasso', 'lasso', 'Laço: selecionar, mover, apagar, duplicar'),
      this.textTool = tb('text', 'text', 'Texto (Markdown e equações): toque no lugar'),
      tb('linkrect', 'link', 'Criar link: desenhe um retângulo'),
      this.cropTool = tb('crop', 'crop', 'Recortar imagem da página (equação, figura)'),
      tb('note', 'note', 'Nota ou nota de voz: toque no lugar'),
      btn('shapes', '', () => this.openTools('shapes'), { title: 'Formas: geométricas, óptica (Gauss, LG, Bessel, Airy…), quântica, eletromagnetismo, física médica', iconOnly: true, cls: 'ibtn tool' }),
      btn('calc', '', () => this.openTools('calc'), { title: 'Calculadora física: λ ↔ eV ↔ cm⁻¹, feixe gaussiano, pinças, física médica, unidades', iconOnly: true, cls: 'ibtn tool' }),
      this.aiRail = btn('ai', '', () => this.openTools('ai'), { title: 'IA: perguntar ao documento (sua chave), Adobe Acrobat ou NotebookLM / Gemini', iconOnly: true, cls: 'ibtn tool notnb' }),
      this.fitRail = btn('fitpage', '', () => this.bestFit(), { title: 'Melhor ajuste: o texto (ou o que está escrito) ocupa a largura da tela', iconOnly: true, cls: 'ibtn tool' }),
      this.imgBtn = btn('image', '', e => this.imageMenu(e), { title: 'Inserir imagem', iconOnly: true, cls: 'ibtn tool' }),
      h('div.rsep'), this.colorBox, this.widthBox, h('div.rsep'),
      btn('undo', '', () => this.undo(), { title: 'Desfazer', iconOnly: true, cls: 'ibtn tool' }),
      btn('redo', '', () => this.redo(), { title: 'Refazer', iconOnly: true, cls: 'ibtn tool' }),
      this.marginBtn = btn('margin', '', () => this.toggleMargin(), { title: 'Margem expandida nesta página', iconOnly: true, cls: 'ibtn tool' }),
      h('div.grow'),
      this.penHint = h('div.penhint'),
    );
    this.side = h('aside.side');
    this.panes = h('div.panes');
    this.right = h('aside.rpanel');
    this.pill = h('div.pill');
    this.selMenu = h('div.selmenu', { role: 'toolbar', 'aria-label': 'Ações do trecho selecionado' });
    this.mathPal = buildMathPal(code => this.textEditor.insertMath(code), () => this.toggleMathPal(), { onShape: (s, done) => this.armShape(s, done), getSelected: () => { const v = this.viewers.find(x => x.sel); return v ? v.annsOf(v.sel.s.p.key).filter(a => v.sel.ids.has(a.id)) : null; },
      ai: { kind: 'pdf', doc: () => this.doc && !NB.isNotebook(this.doc) ? this.doc : null, viewer: () => this.active, selection: () => (this.sel && this.sel.text ? cleanText(this.sel.text) : String(window.getSelection() || '')).trim(), goTo: n => { const v = this.active; if (v) { v.goTo('p' + n, 0, { flash: true }); this.onNav(v); } } } });
    r.append(top, h('div.rbody', rail, this.side, h('div.panewrap', this.panes, this.pagePill), this.mathPal, this.right), this.selMenu, this.pill);
    this.bindSwipe();
  }

  // ---------- barra de texto no topo + painel de matemática ----------
  showTextBar() {
    const on = !!(this.doc && NB.isNotebook(this.doc) && (this.tool === 'text' || this.textEditor.active));
    this.root.classList.toggle('textbar', on);
    if (on && !this.fmtSlot.contains(this.textEditor.bar)) this.fmtSlot.appendChild(this.textEditor.bar);
    if (!on && this.textEditor._bar) this.textEditor._bar.remove();
    if (on && !this.toolsOpen && this.mathPal.dataset.tab !== 'math') this.mathPal.setTab('math');
    this.mathPal.classList.toggle('open', (on && !this.mathHidden) || !!this.toolsOpen);
    this.mathPal.classList.toggle('wide', this.mathPal.dataset.tab !== 'math');
  }
  toggleMathPal() { if (this.toolsOpen) this.toolsOpen = false; else this.mathHidden = !this.mathHidden; this.showTextBar(); }
  // painel da direita em Formas ou Calculadora (botões da barra lateral)
  async openTools(tab) {
    if (this.toolsOpen && this.mathPal.dataset.tab === tab) { this.toolsOpen = false; this.showTextBar(); return; }
    this.toolsOpen = true;
    await this.mathPal.setTab(tab);
    this.showTextBar();
  }
  // forma escolhida no painel: arraste na página para desenhá-la
  armShape(s, done) {
    if (this.shapeDone) this.shapeDone();
    this.shapePending = s; this.shapeDone = done;
    this.setTool('shape');
    this.penHint.textContent = 'Arraste na página para desenhar: ' + s.label;
    toast('Arraste na página para desenhar: ' + s.label, 2500);
  }
  async placeShape(v, slot, r) {
    const sh = this.shapePending; if (!sh) return;
    let [x, y, w, hh] = r;
    const asp = sh.aspect || (sh.kind === 'img' ? 1 : 0.8);
    if (w < 8 && hh < 8) { w = 140; hh = 140 * asp; x -= w / 2; y -= hh / 2; }   // só um toque: tamanho padrão
    if (sh.square || sh.kind === 'img') { const m = Math.max(w, hh); w = m; hh = m; }
    if (sh.keepAspect && sh.aspect) { if (hh / w > sh.aspect) w = hh / sh.aspect; else hh = w * sh.aspect; }
    if (sh.kind === 'uimg') {
      const b = await S.audioBlob(sh.fileId);
      if (!b) { toast('A imagem desta forma não está mais no aparelho.'); return; }
      const im = await NB.storeImage(b);   // cópia própria (apagar o documento não apaga a forma)
      const a = await S.putAnnot({ kind: 'img', docId: v.doc.id, pageKey: slot.p.key, fileId: im.fileId, x, y, w, h: hh, shape: sh.id });
      this.setTool('read');
      await v.selectNew(slot, [a.id], { quiet: true });
      return;
    }
    const st = this.settings || {};
    if (sh.kind === 'img') {
      const SH = await import('./shapes.js');
      const c = SH.renderField(sh, 400);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const im = await NB.storeImage(blob);
      const a = await S.putAnnot({ kind: 'img', docId: v.doc.id, pageKey: slot.p.key, fileId: im.fileId, x, y, w, h: hh, shape: sh.id });
      this.setTool('read');   // volta para o Selecionar: outro toque não cria outra forma
      await v.selectNew(slot, [a.id], { quiet: true });
      return;
    }
    const SH = await import('./shapes.js');
    const lines = SH.placeShape(sh, x, y, w, hh);
    const sgroup = uid('sg');   // os traços da forma andam juntos (selecionar um pega todos)
    const list = lines.filter(pts => pts.length > 1).map(pts => ({ kind: 'ink', tool: 'pen', shape: sh.id, sgroup, docId: v.doc.id, pageKey: slot.p.key, color: st.penColor || '#16191D', width: st.penWidth || 2, pts }));
    await S.putAnnotsGroup(list);
    // já fica selecionada: arraste para mover, canto para o tamanho, bolinha para girar
    this.setTool('read');   // volta para o Selecionar: outro toque não cria outra forma
    await v.selectNew(slot, list.map(a => a.id), { quiet: true });
  }

  // ---------- arquivos recentes (troca rápida) ----------
  async noteRecent(id) {
    const { db } = await import('./db.js');
    const list = (await db.kvGet('recent', [])).filter(x => x !== id);
    list.unshift(id);
    await db.kvSet('recent', list.slice(0, 12));
  }
  async recentDocs() {
    const { db } = await import('./db.js');
    const ids = await db.kvGet('recent', []);
    const out = [];
    for (const id of ids) { const d = await S.getDoc(id); if (d) out.push(d); }
    return out;
  }
  // troca rápida (em cada lado da tela dividida, separadamente)
  async switchTo(id, side) {
    side = side === undefined ? this.sideIdx : side;
    const scr = this.app.screenOn ? this.app.screenOn(side) : null;
    if (scr === this && this.root.isConnected && this.active && this.active.doc) { const v = this.active; v.doc.lastKey = v.currentKey(); v.doc.lastY = v.currentOffset(); await S.saveDoc(v.doc); }
    if (this.textEditor.active) await this.textEditor.close();
    await this.app.openDoc(id, null, side);
    const d = await S.getDoc(id);
    if (d) toast('↔ ' + S.docTitle(d), 1600);
  }
  async otherDocs(curId, side) {
    const other = this.app.split && this.app.docOnSide ? this.app.docOnSide(1 - side) : '';
    return (await this.recentDocs()).filter(d => d.id !== curId && d.id !== other);
  }
  async quickSwitch(curId, side) {
    side = side === undefined ? this.sideIdx : side;
    curId = curId || (this.root.isConnected && this.doc ? this.doc.id : '');
    const list = await this.otherDocs(curId, side);
    if (!list.length) { toast('Nenhum outro arquivo aberto recentemente.'); return; }
    this.switchTo(list[0].id, side);
  }
  async recentMenu(e, curId, side) {
    side = side === undefined ? this.sideIdx : side;
    document.querySelectorAll('.recentbar').forEach(x => x.remove());
    curId = curId || (this.root.isConnected && this.doc ? this.doc.id : '');
    const list = (await this.otherDocs(curId, side)).slice(0, 8);
    if (!list.length) { toast('Nenhum outro arquivo aberto recentemente.'); return; }
    const bar = h('div.recentbar', { role: 'dialog', 'aria-label': 'Arquivos recentes' },
      h('div.rbhead', h('b', 'Recentes' + (this.app.split ? (side ? ' — lado direito' : ' — lado esquerdo') : '')), h('span.muted', 'Dica: deslize dois dedos para a esquerda na página para voltar ao anterior'), h('div.grow'), btn('close', '', () => bar.remove(), { iconOnly: true, title: 'Fechar' })),
      h('div.rbrow', list.map((d, i) => {
        const th = h('div.rbthumb');
        this.app.library.thumb(d, th).catch(() => {});
        const card = h('button.rbcard' + (i === 0 ? '.first' : ''), { type: 'button', onclick: () => { if (card.dragged) return; bar.remove(); this.switchTo(d.id, side); } }, th, h('span.clamp', S.docTitle(d)), h('span.muted', NB.isNotebook(d) ? 'Caderno' : d.kind === 'text' ? 'Texto' : 'PDF'));
        card.addEventListener('pointerdown', ev => this.dragRecent(ev, card, d, bar, side));
        card.addEventListener('dragstart', ev => ev.preventDefault());   // a miniatura (imagem) não pode iniciar o arrastar do navegador
        return card;
      })),
      h('div.rbtip.muted', 'Arraste um arquivo para a direita ou para a esquerda da tela para abrir lado a lado.'));
    document.body.appendChild(bar);
    if (this.app.split) { const r = this.app.slots[side].getBoundingClientRect(); bar.style.left = (r.left + r.width / 2) + 'px'; }
    setTimeout(() => {
      const off = ev => { if (!bar.contains(ev.target)) { bar.remove(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    }, 0);
  }
  // arrastar um arquivo dos recentes para um lado da tela: abre lado a lado
  dragRecent(e0, card, d, bar, side) {
    if (isEink() || this.app.split === undefined) return;
    const x0 = e0.clientX, y0 = e0.clientY, pid = e0.pointerId;
    let ghost = null, zones = null, zone = null;
    const mv = e => {
      if (e.pointerId !== pid) return;
      if (!ghost) {
        const dx = e.clientX - x0, dy = e.clientY - y0;
        // na horizontal, o dedo rola a fileira de recentes; para cima ou para baixo, começa o arrastar
        if (Math.abs(dy) < 14 || Math.abs(dy) < Math.abs(dx)) { if (Math.abs(dx) > 6) { const row = bar.querySelector('.rbrow'); row.scrollLeft -= e.clientX - (this._rx || x0); this._rx = e.clientX; card.dragged = true; } return; }
        card.dragged = true;
        ghost = h('div.dragghost.txt', S.docTitle(d));
        zones = h('div.splitzones', h('div.szone.l', h('span', this.app.split ? 'Abrir à esquerda' : 'Abrir aqui (no lugar)')), h('div.szone.r', h('span', 'Abrir ao lado (tela dividida)')));
        document.body.append(zones, ghost);
        bar.style.opacity = '.35';
      }
      e.preventDefault();
      ghost.style.left = (e.clientX + 12) + 'px'; ghost.style.top = (e.clientY + 12) + 'px';
      zone = e.clientX > innerWidth / 2 ? 'r' : 'l';
      zones.querySelector('.szone.l').classList.toggle('on', zone === 'l');
      zones.querySelector('.szone.r').classList.toggle('on', zone === 'r');
    };
    const up = async e => {
      if (e.pointerId !== pid) return;
      document.removeEventListener('pointermove', mv, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
      this._rx = null;
      if (!ghost) { setTimeout(() => { card.dragged = false; }, 50); return; }
      ghost.remove(); zones.remove(); bar.remove();
      setTimeout(() => { card.dragged = false; }, 50);
      if (zone === 'r') {
        if (this.app.split) await this.app.openDoc(d.id, null, 1);
        else { if (form.form === 'phone') { toast('No celular a tela dividida fica desligada.'); return; } await this.app.openSplit(d.id); }
      } else {
        if (this.app.split) await this.app.openDoc(d.id, null, 0);
        else this.switchTo(d.id, side);
      }
    };
    document.addEventListener('pointermove', mv, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
  }

  // dois dedos deslizando na horizontal: esquerda = arquivo anterior; direita = lista de recentes
  bindSwipe() { bindTwoFingerSwipe(this.panes, () => this.quickSwitch(), () => this.recentMenu()); }

  isFront() { return !this.app.split || this.app.side === this.sideIdx; }

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
    if (this.toolsOpen && this.mathPal && this.mathPal.dataset.tab === 'ai') this.mathPal.setTab('ai');
    const fon = !!(this.active && this.active.fitOn);
    if (this.fitBtn) this.fitBtn.setAttribute('aria-pressed', String(fon));
    if (this.fitRail) this.fitRail.setAttribute('aria-pressed', String(fon));
    const nb = NB.isNotebook(this.doc);
    this.root.classList.toggle('isnb', nb);
    this.textTool.style.display = nb ? '' : 'none';
    this.imgBtn.style.display = nb ? '' : 'none';
    this.cropTool.style.display = nb ? 'none' : '';
    if (nb && this.tool === 'crop') this.tool = 'read';
    this.marginBtn.style.display = nb ? 'none' : '';
    if (!nb && this.tool === 'text') this.tool = 'read';
    this.setTool(this.tool);
    this.applyPdfMode();
    this.onNav(this.active);
    if (this.sideOpen) this.renderSide();
    if (!nb) this.app.indexDoc(this.doc);
    this.noteRecent(this.doc.id);
    // tela dividida: PDF com as bordas cortadas (texto na largura do painel)
    if (!nb && this.active) this.active.setCrop(this.cropManual !== undefined ? this.cropManual : (this.app.split && (this.settings || {}).cropInSplit !== false)).then(() => { if (this.active && this.active.doc && this.active.doc.colMode && !this.active.colMode) this.openArticle(true); });
    this.articleBtn.setAttribute('aria-pressed', 'false');
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
    if (id === 'text') this.penHint.textContent = 'Toque na página para escrever com o teclado (Markdown, $equações$)';
    if (id === 'lasso') this.penHint.textContent = 'Contorne com a S Pen o que quer selecionar';
    if (id === 'crop') this.penHint.textContent = 'Desenhe um retângulo em volta da equação ou figura';
    if (id !== 'shape' && this.shapePending) { this.shapePending = null; if (this.shapeDone) { this.shapeDone(); this.shapeDone = null; } }
    if (id !== 'lasso') this.viewers.forEach(v => v.clearSelection());
    if (this.textEditor && this.textEditor.active && id !== 'text' && id !== 'read') this.textEditor.close();
    this.showTextBar();
    fastPen.update(this);
  }

  // e-ink: virar a página (botões, toques, teclas)
  turn(dir) {
    const v = this.active;
    if (!v) return;
    if (v.paged) { if (!v.turn(dir)) toast(dir > 0 ? 'Última página.' : 'Primeira página.', 1200); return; }
    v.scroller.scrollBy({ top: dir * (v.scroller.clientHeight - 40) });
  }
  // ajuste das colunas (como no NeoReader): bordas, número de colunas e posição da divisão
  async columnSetup() {
    const v = this.active; if (!v || !v.hd) return;
    const doc = v.doc;
    const crop0 = await v.docCrop();
    let setup = JSON.parse(JSON.stringify(doc.colSetup || await v.autoSetup()));
    if (!setup.crop) setup.crop = crop0.slice(0, 4);
    const k = v.currentKey(); const pn = /^p\d+$/.test(k) ? +k.slice(1) : 1;
    const pg = await getPage(v.hd, pn);
    const vp0 = pg.getViewport({ scale: 1 });
    const W = Math.min(520, innerWidth - 80), sc = W / vp0.width;
    const vp = pg.getViewport({ scale: sc * (devicePixelRatio || 1) });
    const cv = h('canvas.colcv'); cv.width = vp.width; cv.height = vp.height;
    cv.style.width = W + 'px'; cv.style.height = (vp0.height * sc) + 'px';
    pg.render({ canvasContext: cv.getContext('2d'), viewport: vp });
    const ov = h('div.colov');
    const stage = h('div.colstage', { style: { width: W + 'px', height: (vp0.height * sc) + 'px' } }, cv, ov);
    const draw = () => {
      clear(ov);
      const [x, y, w, hh] = setup.crop;
      const box = h('div.colcrop', { style: { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: hh * 100 + '%' } });
      ov.appendChild(box);
      // alças das bordas
      for (const side of ['l', 'r', 't', 'b']) {
        const hd = h('div.colh.' + side);
        hd.addEventListener('pointerdown', e => drag(e, f => {
          const c = setup.crop; let [x0, y0, x1, y1] = [c[0], c[1], c[0] + c[2], c[1] + c[3]];
          if (side === 'l') x0 = Math.min(x1 - 0.1, f.x); if (side === 'r') x1 = Math.max(x0 + 0.1, f.x);
          if (side === 't') y0 = Math.min(y1 - 0.1, f.y); if (side === 'b') y1 = Math.max(y0 + 0.1, f.y);
          setup.crop = [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1) - Math.max(0, x0), Math.min(1, y1) - Math.max(0, y0)];
        }));
        box.appendChild(hd);
      }
      // divisões entre colunas
      const n = setup.n || 1;
      setup.splits = (setup.splits || []).slice(0, n - 1);
      for (let i = 0; i < n - 1; i++) {
        if (!setup.splits[i]) setup.splits[i] = x + w * (i + 1) / n;
        const ln = h('div.colsplit', { style: { left: setup.splits[i] * 100 + '%', top: y * 100 + '%', height: hh * 100 + '%' } });
        ln.addEventListener('pointerdown', e => drag(e, f => { setup.splits[i] = Math.max(setup.crop[0] + 0.05, Math.min(setup.crop[0] + setup.crop[2] - 0.05, f.x)); }));
        ov.appendChild(ln);
      }
    };
    const drag = (e, fn) => {
      e.preventDefault(); e.stopPropagation();
      const t = e.currentTarget; try { t.setPointerCapture(e.pointerId); } catch (er) {}
      const r = stage.getBoundingClientRect();
      const mv = ev => { fn({ x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height }); draw(); };
      const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); };
      t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up);
    };
    const nBtns = h('div.chips');
    const head = h('input', { type: 'checkbox' }); head.checked = setup.header !== false;
    head.addEventListener('change', () => { setup.header = head.checked; });
    const paintN = () => { clear(nBtns); for (const n of [1, 2, 3]) nBtns.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String((setup.n || 1) === n), onclick: () => { setup.n = n; setup.splits = []; paintN(); draw(); } }, n === 1 ? '1 coluna (só corta as bordas)' : n + ' colunas')); };
    paintN(); draw();
    modal('Ajustar colunas do modo artigo', h('div.colsetup',
      h('p.muted', 'Como no NeoReader da Boox: arraste as bordas do quadro para cortar as margens e a linha do meio para marcar a divisão entre as colunas. Vale para todas as páginas deste PDF.'),
      nBtns, stage,
      h('label.check', head, h('span', 'Na 1ª página, mostrar o título e o resumo inteiros antes das colunas'))), [
      { label: 'Automático', onclick: async () => { const a = await v.autoSetup(); setup = Object.assign(a, { crop: crop0.slice(0, 4) }); head.checked = true; paintN(); draw(); } },
      { label: 'Aplicar', primary: true, onclick: async c => { c(); doc.colSetup = setup; await S.saveDoc(doc); doc.colMode = true; await v.reapplyArticle(); this.articleBtn.setAttribute('aria-pressed', 'true'); } },
    ], { wide: true });
  }

  // modo artigo: liga/desliga o recorte por colunas (fica lembrado no documento)
  async openArticle(force) {
    const v = this.active;
    if (!v || !v.hd) { toast('O modo artigo é para PDFs.'); return; }
    const on = force === undefined ? !v.colMode : !!force;
    await v.setArticle(on);
    this.articleBtn.setAttribute('aria-pressed', String(!!v.colMode));
    if (force === undefined) {
      v.doc.colMode = on; S.saveDoc(v.doc);
      if (on) { const any = v.colLayout && [...v.colLayout.values()].some(Boolean); toast(any ? 'Modo artigo: uma coluna por vez. Toque de novo no botão para voltar à página inteira.' : 'Não achei duas colunas neste PDF: mostrando as páginas com as bordas cortadas.', 3500); }
    }
  }

  renderColors() {
    clear(this.colorBox); clear(this.widthBox);
    const st = this.settings || {};
    if (this.tool === 'pen') {
      for (const c of INK_COLORS) this.colorBox.appendChild(h('button.dot', { type: 'button', 'aria-label': 'Cor ' + c, style: { background: c }, 'aria-pressed': String(st.penColor === c), onclick: () => S.setSettings({ penColor: c }).then(() => this.renderColors()) }));
      for (const w of [1.2, 2, 3.5]) this.widthBox.appendChild(h('button.wbtn', { type: 'button', 'aria-label': 'Espessura ' + w, 'aria-pressed': String(st.penWidth === w), onclick: () => S.setSettings({ penWidth: w }).then(() => this.renderColors()) }, h('span', { style: { height: (w * 1.6) + 'px', background: st.penColor } })));
    } else if (this.tool === 'eraser') {
      const mode = st.eraserMode || 'stroke', size = st.eraserSize || 20;
      const set = async o => { await S.setSettings(o); this.settings = await S.settings(); this.renderColors(); };
      this.colorBox.append(
        h('button.ebtn', { type: 'button', title: 'Apaga o traço inteiro', 'aria-pressed': String(mode === 'stroke'), onclick: () => set({ eraserMode: 'stroke' }) }, 'Traço'),
        h('button.ebtn', { type: 'button', title: 'Apaga só a área que a borracha toca', 'aria-pressed': String(mode === 'area'), onclick: () => set({ eraserMode: 'area' }) }, 'Área'));
      if (mode === 'area') for (const z of ERASER_SIZES) this.widthBox.appendChild(h('button.wbtn', { type: 'button', 'aria-label': 'Tamanho ' + z, title: 'Tamanho da borracha', 'aria-pressed': String(size === z), onclick: () => set({ eraserSize: z }) }, h('span.esz', { style: { width: Math.min(30, z / 2 + 4) + 'px', height: Math.min(30, z / 2 + 4) + 'px' } })));
    } else if (this.tool === 'marker') {
      for (const c of CATS.map(x => x.color)) this.colorBox.appendChild(h('button.dot', { type: 'button', 'aria-label': 'Cor ' + c, style: { background: c }, 'aria-pressed': String(st.markerColor === c), onclick: () => S.setSettings({ markerColor: c }).then(() => this.renderColors()) }));
    }
  }

  async undo() {
    if (this.textEditor && this.textEditor.active) await this.textEditor.close();
    const id = this.doc && this.doc.id;
    if (!id || !(await S.undo(id))) toast('Nada para desfazer neste documento.', 1500);
  }
  async redo() {
    const id = this.doc && this.doc.id;
    if (!id || !(await S.redo(id))) toast('Nada para refazer.', 1500);
  }

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
    const N = v.hd ? v.hd.pdf.numPages : v.pages.length;
    this.pageEl.textContent = p ? (p.kind === 'pdf' ? 'p. ' + p.n + ' de ' + N : p.kind === 'nb' ? 'Página ' + p.n + ' de ' + N : 'página em branco') : '';
    const idx = p ? (p.kind === 'pdf' || p.kind === 'nb' ? p.n : null) : null;
    this.pagePill.textContent = idx ? idx + ' / ' + N : '—';
    this.backBtn.style.display = (v.hist.length || this.docHist.length) ? '' : 'none';
    this.toolBtns && this.root.querySelector('[title="Margem expandida nesta página"]').setAttribute('aria-pressed', String(!!(v.doc.margins && v.doc.margins[k])));
  }
  onZoom() {}

  // link no formato do app ([Título, p. 3](leitor://…)): colado num texto ou numa caixa de caderno, vira link (e link de volta)
  copyPageLink(v, key, y) {
    const md = '[' + S.docTitle(v.doc) + ', ' + pageLabel(key, v.doc) + '](leitor://' + v.doc.id + '/' + key + (y ? '?y=' + Math.round(y) : '') + ')';
    copyText(md);
    toast('Link copiado. Cole num texto ou numa caixa de texto de caderno.');
  }

  // mostrador de página: digitar o número (ou arrastar) e ir
  pageJump(anchor) {
    const v = this.active; if (!v || !v.doc) return;
    document.querySelectorAll('.pagejump').forEach(x => x.remove());
    const nums = v.pages.filter(p => p.kind === 'pdf' || p.kind === 'nb');
    const N = nums.length; if (!N) return;
    const cur = v.pages.find(p => p.key === v.currentKey());
    const curN = cur && cur.n ? cur.n : 1;
    const inp = h('input', { type: 'number', min: 1, max: N, value: curN, inputmode: 'numeric', 'aria-label': 'Número da página' });
    const rng = h('input', { type: 'range', min: 1, max: N, value: curN, 'aria-label': 'Página' });
    const go = n => {
      n = Math.max(1, Math.min(N, Math.round(+n || 1)));
      const p = nums.find(x => x.n === n) || nums[n - 1];
      if (p) { v.goTo(p.key, 0, { exact: true }); this.onNav(v); }
      box.remove(); document.removeEventListener('pointerdown', off, true);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(inp.value); if (e.key === 'Escape') { box.remove(); } });
    rng.addEventListener('input', () => { inp.value = rng.value; });
    rng.addEventListener('change', () => go(rng.value));
    const box = h('div.pagejump', { role: 'dialog', 'aria-label': 'Ir para a página' },
      h('div.pjrow', h('span', 'Página'), inp, h('span.muted', 'de ' + N), h('button.pbtn', { type: 'button', onclick: () => go(inp.value) }, 'Ir')),
      rng,
      h('div.pjrow.small', h('button.linkbtn', { type: 'button', onclick: () => go(1) }, 'Primeira'), h('div.grow'), v.hist.length ? h('button.linkbtn', { type: 'button', onclick: () => { box.remove(); this.goBack(); } }, 'Voltar ao ponto anterior') : null, h('div.grow'), h('button.linkbtn', { type: 'button', onclick: () => go(N) }, 'Última')));
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(innerWidth - br.width - 8, r.left + r.width / 2 - br.width / 2)) + 'px';
    box.style.top = (r.bottom + br.height + 12 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - br.height - 8)) + 'px';
    const off = e => { if (!box.contains(e.target) && e.target !== anchor) { box.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => { document.addEventListener('pointerdown', off, true); inp.focus(); inp.select(); }, 0);
  }

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
    if (this.app.split) { this.app.openInOther(this.sideIdx, target); return; }
    if (target.docId !== v.doc.id && await this.app.linkTarget(target)) return;
    if (d.kind === 'text') { this.app.openAt(d.id, target.pageKey, target.y); return; }
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
    if (this.app.split) { this.app.exitSplit(this.sideIdx); return; }
    if (isEink()) { toast('No e-ink a tela dividida fica desligada. Use o modo artigo ou o modo colunas.'); return; }
    this.app.chooseSplit(this.doc);
  }
  async toggleSplitOld() {
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
    if (v.isNb) {
      const anns = NB.readingOrder(v.doc, (await S.annots(v.doc.id)).filter(a => a.kind === 'tbox'));
      body.appendChild(h('div.shead', h('span', 'Títulos do caderno')));
      let any = false;
      for (const a of anns) for (const t of headings(a.md)) {
        any = true;
        body.appendChild(h('button.srow' + (t.level === 1 ? '.bold' : ''), { type: 'button', style: { paddingLeft: (10 + (t.level - 1) * 14) + 'px' }, onclick: () => v.goTo(a.pageKey, a.y, { flash: true }) }, h('span.grow', t.text), h('span.muted', 'p. ' + (v.pages.findIndex(p => p.key === a.pageKey) + 1))));
      }
      if (!any) body.appendChild(h('p.muted.pad', 'Os títulos (# Título) das caixas de texto aparecem aqui.'));
    }
    const bms = (v.doc.bookmarks || []);
    body.appendChild(h('div.shead', h('span', 'Marcadores'), btn('bookmark', 'Marcar esta página', () => this.toggleBookmark(v.currentKey()), { cls: 'sbtn small' })));
    if (!bms.length) body.appendChild(h('p.muted.pad', 'Nenhum marcador. Use “Marcar esta página” ou o menu ⋯ de cada página.'));
    for (const b of bms.slice().sort((a, c) => v.pages.findIndex(p => p.key === a.key) - v.pages.findIndex(p => p.key === c.key))) {
      body.appendChild(h('button.srow', { type: 'button', onclick: () => v.goTo(b.key, 0) }, icon('bookmark', 16), h('span.grow', b.label || 'Marcador'), h('span.muted', pageLabel(b.key))));
    }
    if (v.isNb) return;
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
        if (p.kind === 'nb') {
          const pageObj = v.doc.pages.find(q => 'n' + q.id === p.key);
          const c = await NB.rasterPage(v.doc, pageObj, await S.annots(v.doc.id), { scale: 110 / p.w, template: true });
          if (c) e.target.querySelector('.tpage').appendChild(c);
          continue;
        }
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
      if (v.isNb && p.index === 0) grid.parentNode.insertBefore(h('div.btnrow.pad', h('button.sbtn.small', { type: 'button', onclick: () => this.nbAddPage(v, v.pages.length - 1) }, icon('plus', 16), 'Nova página no fim')), grid);
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
    // links de volta aparecem junto (em "Todas" e em "Links")
    const showInc = f === 'todas' || f === 'link';
    for (const a of list) {
      const ci = catInfo(a.cat);
      const y = a.rects ? a.rects[0][1] : a.y || 0;
      const sw = a.kind === 'hl' ? h('span.sw', { style: { background: a.style === 'strike' ? '#B4232C' : (a.color || ci.color) } }, ci.sym) : icon(a.kind === 'note' ? (a.audioId && !a.text ? 'mic' : 'note') : a.kind === 'link' ? 'link' : 'pen', 16);
      const txt = a.kind === 'hl' ? (a.text || '') : a.kind === 'note' ? (a.text || 'Nota de voz') : a.kind === 'link' ? ('→ ' + (a.targetLabel || 'link')) : '';
      body.appendChild(h('button.srow.ann', { type: 'button', onclick: () => v.goTo(a.pageKey, y, { flash: true }) }, sw,
        h('div.grow', h('div.clamp', txt), a.note ? h('div.muted.clamp', 'Nota: ' + a.note) : null),
        h('span.muted', pageLabel(a.pageKey))));
    }
    if (showInc) { const inc = this.app.linksTo(v.doc.id); if (inc.length || f === 'link') this.renderIncoming(body, v, inc); }
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
      if (v.isNb) {
        for (const a of await S.annots(v.doc.id)) {
          const t = a.kind === 'tbox' ? plainText(a.md) : (a.text || '') + ' ' + (a.note || '');
          if (fold(t).includes(fq)) out.push({ ann: a, t });
        }
      }
      for (let n = 1; v.hd && n <= v.hd.pdf.numPages; n++) {
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
    await this.app.refreshLinkIndex();
    const out = this.app.linksFrom(v.doc.id);
    const inc = this.app.linksTo(v.doc.id);
    body.appendChild(h('div.shead', h('span', 'Saindo deste documento'), btn('plus', 'Novo link', () => this.linkBuilder(v, { pageKey: v.currentKey(), rects: [[10, 10, 60, 14]], text: '', pageLink: true }), { cls: 'sbtn small' })));
    if (!out.length) body.appendChild(h('p.muted.pad', 'Selecione um trecho e toque em “Link”, ou use a ferramenta de link (retângulo) na barra lateral.'));
    const docs = await S.allDocs();
    for (const a of out) {
      const td = a.target && a.target.docId ? docs.find(d => d.id === a.target.docId) : null;
      const where = a.targetLabel || (td ? S.docTitle(td) + ' · ' + pageLabel(a.target.pageKey, td) : (a.target && a.target.type) || '');
      body.appendChild(h('div.srow', h('button.grow.linkrow', { type: 'button', onclick: () => v.goTo(a.pageKey, a.rects[0][1], { flash: true }) }, h('div.clamp', (a.text ? '“' + a.text.slice(0, 60) + '” ' : '') + '→ ' + where), h('div.muted', pageLabel(a.pageKey, v.doc) + (a.fromMd ? ' · caixa de texto' : ''))),
        btn('fwd', '', () => a.fromMd ? this.jump(a.target, v) : this.followLink(v, a), { iconOnly: true, title: 'Seguir o link' })));
    }
    this.renderIncoming(body, v, inc);
  }

  // lista dos links que chegam a este documento (painel Ligações e painel Anotações)
  renderIncoming(body, v, inc) {
    body.appendChild(h('div.shead', h('span', 'Chegando aqui (links de volta) · ' + inc.length)));
    if (!inc.length) body.appendChild(h('p.muted.pad', 'Nenhum link aponta para este documento.'));
    for (const a of inc) {
      body.appendChild(h('button.srow', { type: 'button', onclick: () => this.jump({ docId: a.docId, pageKey: a.pageKey, y: a.rects[0][1] }, v) },
        icon('back', 16), h('div.grow', h('div.clamp', a.srcTitle + ' · ' + a.srcLabel), h('div.muted.clamp', (a.text ? '“' + a.text.slice(0, 60) + '” ' : '') + '→ ' + pageLabel(a.target.pageKey, v.doc)))));
    }
  }

  incomingLinks(docId, pageKey) {
    const all = this.app.linkIndex || [];
    return all.filter(a => a.target && a.target.type === 'page' && a.target.docId === docId && a.target.pageKey === pageKey && !(a.docId === docId && a.pageKey === pageKey));
  }

  // ---------- menu da página ----------
  pageMenu(v, p, x, y) {
    if (p.kind === 'nb') return this.nbPageMenu(v, p, x, y);
    const bm = (v.doc.bookmarks || []).some(b => b.key === p.key);
    const mg = !!(v.doc.margins && v.doc.margins[p.key]);
    popMenu(x, y, [
      { icon: 'bookmark', label: bm ? 'Remover marcador' : 'Marcar esta página', onclick: () => this.toggleBookmark(p.key, v) },
      { icon: 'link', label: 'Copiar link desta página (colar num texto ou caderno)', onclick: () => this.copyPageLink(v, p.key) },
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
    if (v.isNb) return this.nbAddPage(v, p.index);
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
    const ws = window.getSelection();
    if (ws && ws.rangeCount && ws.anchorNode && !this.root.contains(ws.anchorNode)) { this.hideSel(); return; }
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
      btn('sigma', 'Índice n,k', async () => { const b2 = this.sel.box; (await import('./nkdb.js')).nkPop(cleanText(this.sel.text), b2); }, { cls: 'mbtn lbl', title: 'Índice de refração do material (refractiveindex.info) — Alt+N' }),
      btn('ai', 'IA', e => this.aiMenu(e), { cls: 'mbtn lbl' }),
    );
    const dragB = btn('grip', 'Arrastar', () => {}, { cls: 'mbtn lbl', title: 'Arraste o trecho para um caderno ou texto' });
    const s0 = this.sel;
    makeDraggable(dragB, () => ({ kind: 'text', text: cleanText(s0.text), docId: s0.v.doc.id, pageKey: s0.segs[0].pageKey, y: s0.segs[0].rects[0] ? s0.segs[0].rects[0][1] : 0, title: S.docTitle(s0.v.doc), label: pageLabel(s0.segs[0].pageKey, s0.v.doc) }));
    dragB.addEventListener('pointerdown', e => (e.pointerType !== 'mouse' || window.AndroidBridge) && setTimeout(() => this.hideSel(), 60));
    row2.appendChild(dragB);
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
    if (t.type === 'tbox') { const el = v.boxEl(t.s, a.id); if (el) this.textEditor.open(v, a, el); return; }
    if (t.type === 'img') { v.setSelection(t.s, new Set([a.id])); return; }
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

  // link interno do PDF: citação -> cartão do artigo citado; figura/seção -> prévia da página
  async previewPdfLink(v, l, x, y) {
    if (!l.url && (this.settings || {}).refPopup !== false) {
      const d = await resolveDest(v.hd, l.dest);
      if (d) {
        try {
          const { referenceText, looksLikeReference, refPopup } = await import('./refs.js');
          const t = await referenceText(v.hd, d);
          if (looksLikeReference(t)) {
            refPopup({ text: t, box: { left: x, right: x, top: y, bottom: y }, fromDoc: v.doc, fromPage: pageNum(v.currentKey()), onShowPdf: () => { document.querySelectorAll('.lookpop.ref').forEach(e => e.remove()); this.previewPdfImage(v, l, x, y); } });
            return;
          }
        } catch (e) { console.warn('ref', e); }
      }
    }
    return this.previewPdfImage(v, l, x, y);
  }

  async previewPdfImage(v, l, x, y) {
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
    const pageSelect = (pages, doc) => {
      const sel = h('select');
      for (const p of pages) sel.appendChild(h('option', { value: p.key }, p.kind === 'pdf' ? 'Página ' + p.n : p.kind === 'hd' ? p.label : p.kind === 'nb' ? (p.n ? 'Página ' + p.n : 'Capa') : 'Página em branco (depois da ' + (doc.blanks.find(b => 'b' + b.id === p.key) || {}).after + ')'));
      if (!pages.some(p => p.key === state.pageKey) && pages[0]) state.pageKey = pages[0].key;
      sel.value = state.pageKey;
      sel.addEventListener('change', () => { state.pageKey = sel.value; state.y = 0; });
      return sel;
    };
    const render = async () => {
      clear(tabs); clear(panel);
      for (const [id, l] of [['page', 'Neste documento'], ['doc', 'Outro PDF ou caderno'], ['digest', 'Digest'], ['obsidian', 'Obsidian'], ['url', 'Site']]) tabs.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(type === id), onclick: () => { type = id; if (id === 'page') { state.docId = v.doc.id; } render(); } }, l));
      if (type === 'page' || type === 'doc') {
        if (type === 'doc') {
          const others = docs.filter(d => d.id !== v.doc.id);
          if (!others.length) { panel.appendChild(h('p.muted', 'Não há outros documentos na biblioteca.')); return; }
          if (state.docId === v.doc.id) { state.docId = others[0].id; state.pageKey = ''; }
          const ds = h('select', { onchange: async () => { state.docId = ds.value; state.pageKey = ''; render(); } }, others.map(d => h('option', { value: d.id }, (NB.isNotebook(d) ? '📓 ' : '') + S.docTitle(d))));
          ds.value = state.docId;
          panel.appendChild(h('label.field', h('span', 'Documento'), ds));
        }
        const d = docs.find(x => x.id === state.docId) || v.doc;
        let pages;
        try { pages = NB.isNotebook(d) ? NB.nbPageList(d) : d.kind === 'text' ? textTargets(d) : pageList(d, await openPdf(d)); }
        catch (e) { panel.appendChild(h('p.err', 'Não consegui abrir este documento: ' + e.message)); return; }
        panel.appendChild(h('label.field', h('span', 'Página'), pageSelect(pages, d)));
        const bms = d.bookmarks || [];
        if (bms.length) panel.appendChild(h('div.chips', h('span.muted', 'Marcadores: '), bms.map(b => h('button.chip', { type: 'button', onclick: () => { state.pageKey = b.key; state.y = 0; render(); } }, (b.label || 'marcador') + ' · ' + pageLabel(b.key, d)))));
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
    if (target.type === 'page') { const d = (docs || []).find(x => x.id === target.docId) || v.doc; label = (d.id === v.doc.id ? '' : S.docTitle(d) + ', ') + pageLabel(target.pageKey, d); }
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

  // ---------- recorte da página (imagem para o Digest/caderno) ----------
  async cropImage(v, s, [x, y, w, hh]) {
    const p = s.p;
    if (p.kind !== 'pdf') throw new Error('O recorte funciona nas páginas do PDF.');
    const pg = await getPage(v.hd, p.n);
    const k = Math.min(4, 2400 / Math.max(w, hh));
    const vp = pg.getViewport({ scale: k });
    const full = h('canvas'); full.width = Math.ceil(p.w * k); full.height = Math.ceil(p.h * k);
    // só renderiza a área recortada (transform desloca a página)
    full.width = Math.ceil(w * k); full.height = Math.ceil(hh * k);
    const ctx = full.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, full.width, full.height);
    await pg.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x * k, -y * k] }).promise;
    return new Promise(r => full.toBlob(r, 'image/png'));
  }

  async cropDone(v, s, rect, cx, cy) {
    let blob;
    try { blob = await this.cropImage(v, s, rect); } catch (e) { toast(e.message); return; }
    const url = URL.createObjectURL(blob);
    const pm = popMenu(cx, cy, [
      { icon: 'digest', label: 'Enviar ao Digest', onclick: async () => {
        const { imageName } = await import('./digestui.js');
        const name = await imageName(blob);
        this.openDigestPanel({ doc: v.doc.id, name: v.doc.name, page: pageNum(s.p.key) || 0, pageKey: s.p.key, quote: '', note: '', tags: [], area: [], images: [name] });
      } },
      { icon: 'notebook', label: 'Inserir num caderno…', onclick: () => this.cropToNotebook(blob, v, s) },
      { icon: 'copy', label: 'Copiar imagem', onclick: async () => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Imagem copiada. Cole no caderno ou em outro app.'); }
        catch (e) { toast('O navegador não deixou copiar imagem. Use “Salvar imagem”.'); }
      } },
      { icon: 'download', label: 'Salvar imagem', onclick: () => downloadBlob(blob, safeName(v.doc.name) + '-p' + pageNum(s.p.key) + '.png') },
    ]);
    const pv = h('img.croppreview', { src: url, alt: 'Recorte' });
    makeDraggable(pv, () => ({ kind: 'image', blob, docId: v.doc.id, pageKey: s.p.key, y: rect[1], title: S.docTitle(v.doc), label: pageLabel(s.p.key, v.doc) }));
    pv.addEventListener('pointerdown', e => (e.pointerType !== 'mouse' || window.AndroidBridge) && setTimeout(() => pm.remove(), 50));
    pm.prepend(pv, h('div.draghint', 'Arraste a figura para um caderno ou texto (também na tela dividida ou noutra janela)'));
  }

  async cropToNotebook(blob, v, s) {
    const nbs = (await S.allDocs()).filter(d => NB.isNotebook(d));
    const go = async d => {
      const last = d.pages[d.pages.length - 1];
      const a = await NB.insertImage(d, 'n' + last.id, blob, last.w / 2, 140, last.w);
      // legenda com a fonte, como caixa de texto logo abaixo
      await S.putAnnot({ kind: 'tbox', docId: d.id, pageKey: 'n' + last.id, x: a.x, y: a.y + a.h + 4, w: Math.max(160, a.w), md: '*' + S.docTitle(v.doc) + ', ' + pageLabel(s.p.key) + '*' });
      toast('Inserido no fim de “' + d.name + '”.');
    };
    const m = modal('Inserir num caderno', h('div.picklist',
      nbs.map(d => h('button.pickrow', { type: 'button', onclick: async () => { m.close(); await go(d); } }, h('b', d.name), h('span.muted', (d.pages || []).length + ' página(s)'))),
      h('button.pickrow', { type: 'button', onclick: async () => { m.close(); const d = await NB.createNotebook('Caderno ' + new Date().toLocaleDateString('pt-BR')); await go(d); } }, h('b', '+ Novo caderno'))));
  }

  // figura ou trecho arrastado para uma página de caderno
  async dropOnNotebook(v, hit, p) {
    const pg = hit.s.p;
    if (p.kind === 'image' && p.blob) {
      const a = await NB.insertImage(v.doc, pg.key, p.blob, hit.x, hit.y, pg.w);
      const src = sourceLink(p);
      if (src) await S.putAnnot({ kind: 'tbox', docId: v.doc.id, pageKey: pg.key, x: a.x, y: a.y + a.h + 4, w: Math.max(160, a.w), md: '*Fonte: ' + src + '*' });
      toast('Figura inserida no caderno.');
      return;
    }
    if (p.text) {
      const w = Math.max(160, Math.min(pg.w - hit.x - 20, 380));
      await S.putAnnot({ kind: 'tbox', docId: v.doc.id, pageKey: pg.key, x: Math.max(12, Math.min(hit.x, pg.w - w - 12)), y: Math.max(8, hit.y - 8), w, md: quoteMd(p) });
      toast('Trecho inserido no caderno.');
    }
  }

  // ---------- caderno ----------
  async textAt(v, hit) {
    const t = v.hitTest(hit);
    if (t && t.type === 'tbox') { const el = v.boxEl(t.s, t.a.id); if (el) this.textEditor.open(v, t.a, el); return; }
    if (this.textEditor.active) { await this.textEditor.close(); return; }
    const p = hit.s.p;
    const w = Math.min(p.w - hit.x - 24, p.w * 0.84);
    const a = { kind: 'tbox', docId: v.doc.id, pageKey: p.key, x: Math.max(12, hit.x), y: Math.max(8, hit.y - 8), w: Math.max(120, w), md: '' };
    a.id = uid('a');
    const el = h('div.tbox.md', { 'data-id': a.id });
    el.style.left = `calc(var(--s) * ${a.x}px)`; el.style.top = `calc(var(--s) * ${a.y}px)`;
    el.style.width = `calc(var(--s) * ${a.w}px)`; el.style.fontSize = `calc(var(--s) * ${NB.TEXT_SIZE}px)`;
    hit.s.tbl.appendChild(el);
    this.textEditor.open(v, a, el);
  }

  openLink(href) {
    if (!href) return;
    const g = parseGo(href);
    if (g) { this.jump({ docId: g.docId, pageKey: g.key || '', y: g.y }); return; }
    if (/^#h-/.test(href) && this.active && NB.isNotebook(this.doc)) {
      const v = this.active;
      const b = NB.readingOrder(v.doc, (v.anns || []).filter(a => a.kind === 'tbox')).find(a => headings(a.md || '').some(x => x.id === href.slice(1) || href.slice(1).startsWith(x.id + '-')));
      if (b) { v.goTo(b.pageKey, b.y, { flash: true }); this.onNav(v); } else toast('Título não encontrado neste caderno.');
      return;
    }
    if (/^#dg=/.test(href)) { this.app.showDigest(href.slice(4)); return; }
    if (/^#ob=/.test(href)) { openUri('obsidian://' + decodeURIComponent(href.slice(4))); return; }
    if (/^https?:|^mailto:/i.test(href)) openExternal(href);
  }

  onObjectSelection(v, sel, x, y) {
    document.querySelectorAll('.popmenu.objmenu').forEach(e => e.remove());
    if (!sel) return;
    const r = sel.s.slot.getBoundingClientRect();
    const [bx, by, bw, bh] = sel.bbox;
    const px = x || (r.left + (bx + bw) * v.scale + 8), py = y || (r.top + by * v.scale);
    const list = () => v.annsOf(sel.s.p.key).filter(a => sel.ids.has(a.id));
    const hasInk = list().some(a => a.kind === 'ink');
    const items = [
      { icon: 'copy', label: 'Duplicar', onclick: async () => {
        const gmap = {};
        const copies = list().map(a => { const c = JSON.parse(JSON.stringify(a)); c.id = uid('a'); delete c.rec; if (c.sgroup) c.sgroup = gmap[c.sgroup] || (gmap[c.sgroup] = uid('sg')); if (c.kind === 'ink') c.pts = c.pts.map(p => [p[0] + 14, p[1] + 14, p[2], p[3]]); else { c.x += 14; c.y += 14; } return c; });
        await S.putAnnotsGroup(copies);
        await v.selectNew(sel.s, copies.map(c => c.id));
      } },
      hasInk ? { icon: 'pen', label: 'Mudar cor do traço', onclick: () => {
        const m = popMenu(px, py, INK_COLORS.map(c => ({ label: '●', onclick: async () => { const ch = list().filter(a => a.kind === 'ink').map(a => Object.assign(JSON.parse(JSON.stringify(a)), { color: c })); await S.putAnnotsGroup(ch); } })));
        [...m.querySelectorAll('button')].forEach((b, i) => { b.style.color = INK_COLORS[i]; b.style.fontSize = '22px'; });
      } } : null,
      sel.canRot ? { icon: 'refresh', label: 'Girar 90°', onclick: () => v.rotateSel(90) } : null,
      (hasInk || (list().length === 1 && list()[0].kind === 'img')) ? { icon: 'shapes', label: 'Salvar como forma (nas minhas categorias)…', onclick: () => this.saveAsShape(list()) } : null,
      hasInk ? { icon: 'swap', label: 'Espelhar (esquerda ↔ direita)', onclick: () => v.flipSel(true) } : null,
      hasInk ? { icon: 'swap', label: 'Espelhar (cima ↔ baixo)', onclick: () => v.flipSel(false) } : null,
      { icon: 'link', label: 'Criar link a partir da seleção', onclick: () => { const bb = sel.bbox; const s0 = sel.s; v.clearSelection(); this.linkBuilder(v, { pageKey: s0.p.key, rects: [[bb[0], bb[1], bb[2], bb[3]]], text: '' }); } },
      { icon: 'trash', label: 'Apagar (Delete)', danger: true, onclick: () => this.deleteSelection(v) },
    ];
    const m = popMenu(Math.min(px, innerWidth - 260), Math.max(70, py), items);
    m.classList.add('objmenu');
    m.prepend(h('div.popnote', sel.ids.size + ' item(ns) selecionado(s). Arraste para mover; o quadradinho no canto muda o tamanho' + (sel.canRot ? '; a bolinha em cima gira' : '') + '.'));
  }

  imageMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    popMenu(r.right + 6, r.top, [
      { icon: 'folder', label: 'Escolher arquivo (ou foto)', onclick: async () => { const f = await NB.pickImageFile(); if (f) this.placeImage(f); } },
      { icon: 'copy', label: 'Colar da área de transferência', onclick: async () => {
        const b = await NB.clipboardImage();
        if (b) this.placeImage(b); else toast('Nenhuma imagem na área de transferência (ou o navegador não deu permissão). Dica: no PC, Ctrl+V cola direto.', 5000);
      } },
    ]);
  }

  async placeImage(blob) {
    const v = this.active;
    if (!v || !v.isNb) return;
    const key = v.currentKey();
    const s = v.slots.get(key);
    const p = s.p;
    const sc = v.scroller;
    const top = (sc.scrollTop - s.slot.offsetTop) / v.scale;
    const cy = Math.max(60, Math.min(p.h - 60, top + sc.clientHeight / v.scale / 2));
    try {
      const a = await NB.insertImage(v.doc, key, blob, p.w / 2, cy, p.w);
      setTimeout(() => v.setSelection(s, new Set([a.id])), 200);
      toast('Imagem inserida. Arraste para posicionar.');
    } catch (err) { toast(err.message); }
  }

  async nbAddPage(v, index, tpl, opts = {}) {
    const p = await NB.addPage(v.doc, index, tpl);
    const keep = opts.stay ? { k: v.currentKey(), y: v.currentOffset() } : null;
    for (const x of this.viewers) if (x.doc && x.doc.id === v.doc.id) { x.doc = v.doc; await x.refreshPages(); }
    if (keep) v.goTo(keep.k, keep.y, { noHist: true, exact: true });
    else v.goTo('n' + p.id, 0, { noHist: true });
    if (opts.stay) toast('Nova página no fim do caderno.', 1500);
    if (this.sideOpen) this.renderSide();
  }

  async nbRefresh(v) {
    for (const x of this.viewers) if (x.doc && x.doc.id === v.doc.id) { x.doc = v.doc; await x.refreshPages(); }
    if (this.sideOpen) this.renderSide();
  }

  nbPageMenu(v, p, x, y) {
    const bm = (v.doc.bookmarks || []).some(b => b.key === p.key);
    popMenu(x, y, [
      { icon: 'plus', label: 'Nova página depois desta', onclick: () => this.nbAddPage(v, p.index) },
      { icon: 'link', label: 'Copiar link desta página (colar num texto ou caderno)', onclick: () => this.copyPageLink(v, p.key) },
      { icon: 'copy', label: 'Duplicar página', onclick: async () => { await S.group(v.doc.id, () => NB.duplicatePage(v.doc, p.index)); await this.nbRefresh(v); } },
      p.tpl === 'cover' ? { icon: 'notebook', label: 'Cor da capa…', onclick: () => this.coverMenu(v.doc, x, y, () => this.nbRefresh(v)) } : null,
      p.tpl === 'cover' ? null : { icon: 'pages', label: 'Modelo da página…', onclick: () => popMenu(x, y, NB.TEMPLATES.map(([id, l]) => ({ label: (p.tpl === id ? '✓ ' : '') + l, onclick: async () => { await NB.setTemplate(v.doc, p.index, id); await this.nbRefresh(v); } }))) },
      p.index > 0 ? { icon: 'back', label: 'Mover para cima', onclick: async () => { await NB.movePage(v.doc, p.index, -1); await this.nbRefresh(v); v.goTo(p.key, 0, { noHist: true }); } } : null,
      p.index < v.pages.length - 1 ? { icon: 'fwd', label: 'Mover para baixo', onclick: async () => { await NB.movePage(v.doc, p.index, 1); await this.nbRefresh(v); v.goTo(p.key, 0, { noHist: true }); } } : null,
      { icon: 'bookmark', label: bm ? 'Remover marcador' : 'Marcar esta página', onclick: () => this.toggleBookmark(p.key, v) },
      '-',
      { icon: 'trash', label: 'Apagar página', danger: true, onclick: async () => {
        if (!(await confirmBox('Apagar página', 'Apagar ' + (p.n ? 'a página ' + p.n : 'a capa') + ' e tudo o que há nela?', 'Apagar', true))) return;
        await NB.deletePage(v.doc, p.index); await this.nbRefresh(v);
      } },
    ]);
  }

  coverMenu(doc, x, y, after) {
    const m = popMenu(x, y, NB.COVER_COLORS.map(([c, l]) => ({ label: (doc.coverColor === c ? '✓ ' : '') + l, onclick: async () => { await NB.setCover(doc, c); if (after) await after(); } }))
      .concat(['-', { label: 'Sem capa', onclick: async () => { await NB.setCover(doc, ''); if (after) await after(); } }]));
    [...m.querySelectorAll('button')].slice(0, NB.COVER_COLORS.length).forEach((b, i) => { b.prepend(h('span.swatch', { style: { background: NB.COVER_COLORS[i][0] } })); });
    return m;
  }

  // ---------- menu "mais" ----------
  // notas feitas no Acrobat (destaques com comentário, notas adesivas, respostas, desenhos) viram notas do app
  async convertAdobe() {
    const d = this.doc;
    toast('Procurando notas do Adobe…', 8000);
    try {
      const { convertForeignInDoc } = await import('./export.js');
      const k = this.active && this.active.currentKey();
      const n = await convertForeignInDoc(d);
      if (!n) { toast('Nenhuma nota do Adobe (ou de outro programa) neste PDF.', 4000); return; }
      await this.app.openDoc(d.id, { key: k || 'p1', y: 0 });
      toast(n + ' nota(s) do Adobe convertida(s) — agora dá para editar aqui.', 5000);
    } catch (err) { console.error(err); toast('Não consegui ler as notas: ' + err.message, 5000); }
  }

  moreMenu(e) {
    const d = this.doc;
    const nb = NB.isNotebook(d);
    const eink = isEink();
    popMenu(e.clientX - 200, e.clientY + 10, [
      nb ? { icon: 'plus', label: 'Nova página no fim', onclick: () => this.nbAddPage(this.active, this.active.pages.length - 1) } : { icon: 'doc', label: 'Dados do artigo (DOI, ABNT, BibTeX)', onclick: () => openMetaDialog(d) },
      nb ? { icon: 'notebook', label: 'Capa do caderno…', onclick: () => this.coverMenu(d, e.clientX - 200, e.clientY + 10, () => this.nbRefresh(this.active)) } : null,
      { icon: 'ai', label: 'Resumo das minhas anotações (IA)', onclick: () => openBriefing([d], S.docTitle(d)) },
      nb || d.kind ? null : { icon: 'ai', label: 'Resumo por capítulo/seção (IA)' + (this.active && this.active.hd && this.active.hd.pdf.numPages > 40 ? ' — recomendado para este PDF' : ''), onclick: async () => { const { openSectionBriefing } = await import('./dialogs.js'); openSectionBriefing(d); } },
      { icon: 'share', label: 'Compartilhar… (menu do Android)', onclick: async () => (await import('./share.js')).shareDoc(d) },
      { icon: 'bookmark', label: d.fav ? 'Tirar dos favoritos' : 'Favoritar ★', onclick: async () => { d.fav = !d.fav; await S.saveDoc(d); toast(d.fav ? 'Nos favoritos.' : 'Fora dos favoritos.'); } },
      { icon: 'share', label: 'Enviar ao Obsidian', onclick: () => nb ? openNotebookExport(d) : openObsidianDialog(d) },
      nb ? null : { icon: 'speak', label: 'Ler a página atual em voz alta', onclick: async () => { const k = this.active.currentKey(); if (k[0] === 'p') speak(await pageText(this.active.hd, pageNum(k))); } },
      { icon: 'stop', label: 'Parar leitura em voz alta', onclick: () => stopSpeak() },
      nb ? null : { icon: 'blank', label: 'Inserir página em branco depois desta', onclick: () => { const v = this.active; this.insertBlank(v, v.pages.find(p => p.key === v.currentKey()), false); } },
      { icon: 'bookmark', label: 'Marcar esta página', onclick: () => this.toggleBookmark(this.active.currentKey()) },
      nb ? null : { icon: 'crop', label: (this.active && this.active.cropBox ? '✓ ' : '') + 'Cortar as bordas (texto na largura da tela)', onclick: () => { this.cropManual = !(this.active && this.active.cropBox); this.active.setCrop(this.cropManual); } },
      nb ? null : { icon: 'columns', label: (this.active && this.active.colMode ? '✓ ' : '') + 'Modo artigo (uma coluna por vez)', onclick: () => this.openArticle() },
      nb ? null : { icon: 'columns', label: 'Ajustar colunas do modo artigo…', onclick: () => this.columnSetup() },
      nb || d.kind ? null : { icon: 'note', label: 'Trazer as notas do Adobe deste PDF', onclick: () => this.convertAdobe() },
      !eink ? null : { icon: 'fitpage', label: ((this.settings || {}).pageFit ? '✓ ' : '') + 'Página inteira na tela', onclick: async () => { await S.setSettings({ pageFit: !(this.settings || {}).pageFit }); this.settings = await S.settings(); this.viewers.forEach(x => x.relayout(true)); } },
      !eink ? null : { icon: 'refresh', label: 'Limpar a tela agora (atualização completa)', onclick: () => flash() },
      eink ? null : { icon: 'split', label: this.app.split ? 'Fechar a tela dividida' : 'Dividir a tela', onclick: () => this.toggleSplit() },
      eink ? null : { icon: 'pages', label: 'Abrir em nova janela (DeX, computador)', onclick: () => this.app.newWindow(d.id) },
      document.documentElement.dataset.form === 'phone' ? '-' : null,
      document.documentElement.dataset.form === 'phone' ? { icon: 'search', label: 'Buscar no documento', onclick: () => this.toggleSide('busca') } : null,
      document.documentElement.dataset.form === 'phone' ? { icon: 'sun', label: 'Modo da página (normal, sépia, escuro)', onclick: () => this.cyclePdfMode() } : null,
      document.documentElement.dataset.form === 'phone' ? { icon: 'rec', label: 'Gravar a sessão (áudio)', onclick: () => this.toggleRec() } : null,
      document.documentElement.dataset.form === 'phone' ? { icon: 'digest', label: 'Abrir o Digest', onclick: () => this.app.showDigest() } : null,
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
