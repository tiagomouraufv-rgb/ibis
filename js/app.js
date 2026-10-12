// Ponto de entrada: telas, importação, indexação para a busca, índice de links.
import * as S from './store.js';
import { persistStorage } from './db.js';
import { h, toast, modal } from './util.js';
import { Library } from './library.js';
import { Reader } from './reader.js';
import { DigestScreen } from './digestui.js';
import { importPdfBytes } from './export.js';
import { openPdf, pageText, pageLabel } from './pdfdoc.js';
import { openSettings } from './dialogs.js';
import { vaultZip } from './obsidian.js';
import { downloadBlob } from './util.js';
import { isAndroidApp, b64ToBytes } from './platform.js';
import { startAutoSync } from './sync.js';
import { TextScreen } from './textdoc.js';
import { watchForm, form } from './form.js';
import { headings } from './md.js';
import { pickDocument } from './picker.js';
import * as WIN from './windows.js';
import { bindDrop, noDrop } from './dnd.js';
import { isEink, initFastPen, syncPageKeys, turnScroller } from './eink.js';

const VERSION = '1.4.0';

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.library = new Library(this);
    this.readers = [new Reader(this, 0), new Reader(this, 1)];
    this.reader = this.readers[0];
    this.digestScreen = new DigestScreen(this);
    this.texts = [new TextScreen(this, 0), new TextScreen(this, 1)];
    this.textScreen = this.texts[0];
    // tela dividida: dois lados, cada um com um PDF, caderno ou texto
    this.split = false; this.side = 0;
    this.slots = [h('div.sideslot'), h('div.sideslot')];
    this.splitEl = h('div.splitroot', this.slots[0], h('div.splitbar'), this.slots[1]);
    this.slots.forEach((sl, i) => sl.addEventListener('pointerdown', () => this.setSide(i), true));
    this.linkIndex = [];
  }

  async start() {
    await S.deviceId();
    await watchForm();
    const st = await S.settings();
    this.applyTheme(st);
    S.on('settings', s => this.applyTheme(s));
    await this.refreshLinkIndex();
    const relink = debounceLinks(() => this.refreshLinkIndex());
    S.on('annots', relink);
    const mdSeen = new Map();
    S.on('docs', d => { if (!d) return relink(); if (d.kind !== 'text' || mdSeen.get(d.id) === d.md) return; mdSeen.set(d.id, d.md); relink(); });
    persistStorage();
    // abrir PDF compartilhado/aberto com o app (quando instalado)
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async params => {
        const files = [];
        for (const fh of params.files || []) files.push(await fh.getFile());
        if (files.length) this.importFiles(files);
      });
    }
    window.addEventListener('popstate', () => this.onPop());
    history.replaceState({ screen: 'library' }, '');
    await this.showLibrary(true);
    this.indexAll();
    document.getElementById('ver').textContent = 'v' + VERSION + (isAndroidApp ? ' · Android' : '');
    startAutoSync().catch(e => console.warn(e));
    import('./rmsync.js').then(m => m.startRmAutoReceive()).catch(e => console.warn(e));
    this.initWindows();
    bindDrop();
    initFastPen(this);
    syncPageKeys();
    S.on('settings', () => syncPageKeys());
    // ficou e-ink (ou mudou de forma): sem tela dividida no e-ink
    S.on('form', f => { syncPageKeys(); if (f.eink && this.split) this.exitSplit(this.side); });
    document.addEventListener('keydown', e => this.onPageKey(e));
    // Alt+N: índice de refração (refractiveindex.info) do texto selecionado, ou a busca vazia
    // índice de refração: confere a fonte uma vez por semana (só se você já usou)
    setTimeout(() => import('./nkdb.js').then(m => m.weeklyUpdate()).catch(() => {}), 30000);
    document.addEventListener('keydown', async e => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyN') return;
      e.preventDefault();
      const sel = String(window.getSelection && window.getSelection() || '').trim();
      (await import('./nkdb.js')).nkPop(sel.length < 60 ? sel : '');
    });
    const qd = new URLSearchParams(location.search).get('doc');
    if (qd) this.openDoc(qd);
    if (isAndroidApp) {
      window.__nativePending = () => this.takeNativeFile();
      this.takeNativeFile();
    }
  }

  // PDF aberto com o app a partir do gerenciador de arquivos / compartilhado de outro app
  async takeNativeFile() {
    const s = window.AndroidBridge.takePendingFile();
    if (!s) return;
    try {
      const o = JSON.parse(s);
      if (o.text !== undefined) { await this.receiveSharedText(o.text, o.subject); return; }
      await this.importFiles([new File([b64ToBytes(o.b64)], o.name || 'documento.pdf', { type: 'application/pdf' })]);
    } catch (e) { toast('Não foi possível abrir o arquivo recebido: ' + e.message, 5000); }
  }

  // texto compartilhado de outro app (resposta da IA do Acrobat ou do NotebookLM, um trecho…): vira nota no Digest
  async receiveSharedText(text, subject) {
    const A = await import('./aipanel.js');
    const last = A.lastSent();
    const docs = (await S.allDocs()).filter(d => d.kind !== 'notebook');
    const cur = last && docs.find(d => d.id === last.docId) || (this.reader.doc && docs.find(d => d.id === this.reader.doc.id)) || null;
    const pick = h('select', [h('option', { value: '' }, '— só no Digest, sem documento —')].concat(docs.map(d => h('option', { value: d.id }, S.docTitle(d)))));
    pick.value = cur ? cur.id : '';
    const src = last ? (last.dest === 'adobe' ? 'Resposta do Acrobat' : last.dest === 'nlm' ? 'Resposta do NotebookLM' : 'Resposta da IA') : 'Texto recebido';
    const ta = h('textarea', { rows: 10 }); ta.value = text;
    modal('Guardar o texto recebido', h('div',
      h('p.muted', last && cur ? 'Veio logo depois do envio de “' + S.docTitle(cur) + '” (' + last.scope + ').' : 'Escolha a que documento ligar a nota.'),
      h('label.field', h('span', 'Documento'), pick), h('label.field', h('span', 'Texto'), ta)), [
      { label: 'Cancelar', onclick: c => c() },
      { label: 'Guardar no Digest', primary: true, onclick: async c => {
        try {
          if (pick.value) await A.saveAnswer(pick.value, ta.value.trim(), { page: last && last.docId === pick.value ? last.page || 1 : 1, scope: last && last.docId === pick.value ? last.scope : '', source: subject || src, tag: last ? ({ adobe: 'acrobat', nlm: 'notebooklm' })[last.dest] : '' });
          else { const st = await S.digest(); /* global dgAdd */ const r = dgAdd(st, { doc: '', name: subject || src, page: 1, quote: subject || src, note: ta.value.trim(), tags: ['ia'] }, Date.now()); await S.saveDigest(r.store); }
          c(); toast('Guardado no Digest.');
        } catch (e) { toast(e.message, 4000); }
      } },
    ]);
  }

  // botão voltar do Android: fecha janelas, painéis e volta para a biblioteca. Retorna true se tratou.
  androidBack() {
    const pop = document.querySelector('.popmenu, .refpop, .lookpop, .recentbar, .tablepick, .pagejump');
    if (pop) { pop.remove(); return true; }
    if (this.split) {
      const mb0 = [...document.querySelectorAll('.modal-back')].pop();
      if (mb0) { const c = mb0.querySelector('.modal-head .ibtn'); if (c) c.click(); else mb0.remove(); return true; }
      this.exitSplit(this.side); return true;
    }
    const mb = [...document.querySelectorAll('.modal-back')].pop();
    if (mb) { const c = mb.querySelector('.modal-head .ibtn'); if (c) c.click(); else mb.remove(); return true; }
    if (this.reader.root.isConnected) {
      if (this.reader.right.classList.contains('open')) { this.reader.right.classList.remove('open'); return true; }
      if (this.reader.sideOpen) { this.reader.toggleSide(); return true; }
      this.showLibrary(); return true;
    }
    if (this.textScreen.root.isConnected) {
      const t = this.textScreen;
      if (t.right.classList.contains('open')) { t.right.classList.remove('open'); return true; }
      if (t.cur) { t.commit(); return true; }
      if (t.sideOpen) { t.toggleSide(); return true; }
      this.showLibrary(); return true;
    }
    if (this.digestScreen.root.isConnected) { this.showLibrary(); return true; }
    return false;
  }

  // ---------- virar página: botões do aparelho, teclado, controle de slides ----------
  pageKey(dir) {
    if (this.article) { this.article.turn(dir); return; }
    if (document.querySelector('.modal-back')) return;
    const sc = this.split ? this.screenOn(this.side) : this.screenOn(0);
    if (!sc) return;
    if (sc.turn) { sc.turn(dir); return; }
    if (sc.pane) turnScroller(sc.pane, dir);
  }
  onPageKey(e) {
    if (this.article || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    let dir = 0;
    if (e.key === 'PageDown') dir = 1; else if (e.key === 'PageUp') dir = -1;
    else if (isEink() && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ')) dir = 1;
    else if (isEink() && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) dir = -1;
    if (!dir) return;
    const sc = this.split ? this.screenOn(this.side) : this.screenOn(0);
    if (!sc || !(sc.turn || sc.pane) || (!isEink() && !sc.turn)) return;
    if (!isEink() && sc.active && !sc.active.paged) return;   // fora do e-ink, PageUp/PageDown rolam normalmente
    e.preventDefault();
    this.pageKey(dir);
  }

  applyTheme(st) {
    const dark = st.theme === 'escuro' || (st.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // ---------- soltar figura/texto arrastado ----------
  async dropAt(x, y, p) {
    const el = document.elementFromPoint(x, y);
    if (!el) return noDrop();
    for (const r of this.readers) {
      if (!r.root.isConnected || !r.root.contains(el)) continue;
      for (const v of r.viewers) {
        const hit = v.slotAt(x, y);
        if (hit && v.isNb) return r.dropOnNotebook(v, hit, p);
      }
      return noDrop();
    }
    for (const t of this.texts) if (t.root.isConnected && t.root.contains(el)) return t.dropAt(x, y, p);
    noDrop();
  }

  // ---------- várias janelas ----------
  initWindows() {
    WIN.initWindows(m => this.onWinMsg(m));
    for (const ev of ['annots', 'docs', 'digest', 'projects', 'readLater', 'recordings']) {
      S.on(ev, p => { if (this.fromWin) return; WIN.post({ t: 'chg', ev, docId: (p && (p.docId || (ev === 'docs' && p.id))) || '' }); });
    }
  }
  async onWinMsg(m) {
    if (m.t === 'open') { this.openDoc(m.docId, { key: m.key, y: m.y || 0 }); return; }
    if (m.t !== 'chg') return;
    this.fromWin = true;
    try {
      if (m.ev === 'annots') { S.resetAnnCache(m.docId || null); S.emit('annots', { docId: m.docId, remote: true }); }
      else if (m.ev === 'docs') { if (m.docId) { const d = await S.getDoc(m.docId); if (d) S.emit('docRemote', d); } S.emit('docs', null); }
      else if (m.ev === 'digest') { S.resetCaches(); S.emit('digest', await S.digest()); }
      else if (m.ev === 'readLater') { S.resetCaches(); S.emit('readLater', await S.readLater()); }
      else S.emit(m.ev, null);
    } finally { this.fromWin = false; }
  }
  // link: abre na outra janela, se houver uma e a opção estiver ligada
  async openElsewhere(target) {
    const st = await S.settings();
    if (st.linksOtherWindow === false) return false;
    for (const other of WIN.otherWindows().slice(0, 3)) {
      const ok = await WIN.request({ t: 'open', to: other, docId: target.docId, key: target.pageKey, y: target.y || 0 }, 1200);
      if (ok) { toast('Aberto na outra janela.', 1500); return true; }
      WIN.forget(other);   // não respondeu (fechada ou em segundo plano): esquece e tenta a próxima
    }
    return false;   // nenhuma outra janela respondeu: abre aqui
  }
  // link para outro documento, com uma janela só: abre aqui mesmo ou lado a lado (Configurações > Geral)
  async linkTarget(target) {
    if (await this.openElsewhere(target)) return true;
    const st = await S.settings();
    if (st.linkOpen === 'split' && !this.split && !isEink() && form.form !== 'phone') {
      await this.openSplit(target.docId, { key: target.pageKey || 'p1', y: target.y || 0 });
      return true;
    }
    return false;
  }
  newWindow(docId) { if (!WIN.openNewWindow(docId)) toast('O navegador bloqueou a nova janela. Permita pop-ups para este site.'); }

  // ---------- tela dividida ----------
  setSide(i) {
    if (this.side === i) return;
    this.side = i;
    this.slots.forEach((sl, k) => sl.classList.toggle('activeside', k === i));
  }
  screenOn(side) {
    if (!this.split) return [...this.readers, ...this.texts].find(x => x.root.isConnected) || null;
    const slot = this.slots[side];
    return [...this.readers, ...this.texts].find(x => x.root.parentNode === slot) || null;
  }
  docOnSide(side) { const sc = this.screenOn(side); return sc && sc.doc ? sc.doc.id : ''; }
  posOf(sc) {
    if (!sc || !sc.doc) return null;
    if (sc.active && sc.active.currentKey) return { key: sc.active.currentKey(), y: sc.active.currentOffset() };
    return null;
  }
  leaving(el) {
    const t = this.texts.find(x => x.root === el);
    if (t) { if (t.cur) t.commit(); t.hideSel(); t.imgDeselect && t.imgDeselect(); t.savePos(); }
  }
  async chooseSplit(curDoc) {
    if (isEink()) { toast('No e-ink a tela dividida fica desligada.'); return; }
    if (form.form === 'phone') { toast('Na tela estreita do celular a tela dividida fica desligada. Abra o Fold ou use o DeX.'); return; }
    const m = await pickDocument(this, {
      title: 'Dividir a tela: o que abrir do outro lado?',
      exclude: curDoc ? curDoc.id : '',
      same: curDoc && curDoc.kind !== 'text' ? { label: 'Este mesmo documento', hint: 'para ver duas partes ao mesmo tempo', onpick: () => this.openSplit(curDoc.id, this.posOf(this.screenOn(0))) } : null,
      onpick: d => this.openSplit(d.id),
    });
    void m;
  }
  async openSplit(docId, at) {
    const cur = this.screenOn(0);
    if (!cur) return;
    this.split = true;
    this.readers.forEach(r => { r.cropManual = undefined; });
    [...this.root.children].forEach(c => c.remove());
    this.root.appendChild(this.splitEl);
    this.slots[0].replaceChildren(cur.root);
    this.slots[1].replaceChildren();
    this.side = -1; this.setSide(1);
    this.texts.forEach(t => t.mathPal.classList.remove('open'));
    await this.openDoc(docId, at, 1);
    const r0 = this.readers[0];
    if (r0.root.parentNode === this.slots[0] && r0.active && r0.doc && r0.doc.kind !== 'notebook') r0.active.setCrop((await S.settings()).cropInSplit !== false);
  }
  async exitSplit(keep) {
    if (!this.split) return;
    const sc = this.screenOn(keep);
    const docId = sc && sc.doc ? sc.doc.id : '';
    const pos = this.posOf(sc);
    this.slots.forEach(sl => [...sl.children].forEach(c => this.leaving(c)));
    this.split = false;
    this.slots.forEach(sl => sl.replaceChildren());
    this.splitEl.remove();
    this.side = 0;
    this.readers.forEach(r => { r.cropManual = undefined; });
    if (docId) await this.openDoc(docId, pos || undefined, 0);
    else this.showLibrary();
    const r0 = this.readers[0];
    if (r0.root.isConnected && r0.active && r0.active.cropBox) r0.active.setCrop(false);
  }
  // link na tela dividida: abre do outro lado
  async openInOther(side, target) {
    const other = 1 - side;
    const sc = this.screenOn(other);
    if (sc && sc.doc && sc.doc.id === target.docId) {
      if (sc.active && sc.active.goTo) { sc.active.goTo(target.pageKey, target.y || 0, { flash: true }); sc.onNav && sc.onNav(sc.active); }
      else if (sc.scrollToKey) sc.scrollToKey(target.pageKey || 'top', true);
      this.setSide(other);
      return;
    }
    await this.openDoc(target.docId, { key: target.pageKey, y: target.y || 0 }, other);
    this.setSide(other);
  }

  mount(el) {
    if (this.split) {
      this.slots.forEach(sl => [...sl.children].forEach(c => this.leaving(c)));
      this.split = false; this.slots.forEach(sl => sl.replaceChildren()); this.splitEl.remove(); this.side = 0;
    }
    document.querySelectorAll('.lookpop, .refpop, .popmenu, .recentbar, .tablepick, .pagejump').forEach(e => e.remove());
    if (this.textScreen && this.textScreen.cur && el !== this.textScreen.root) this.textScreen.commit();
    if (this.textScreen && el !== this.textScreen.root) this.textScreen.hideSel();
    [...this.root.children].forEach(c => { if (c !== el) c.remove(); });
    if (!el.isConnected) this.root.appendChild(el);
  }

  async showLibrary(initial) {
    this.mount(this.library.root);
    await this.library.render();
    if (!initial && history.state && history.state.screen !== 'library') history.pushState({ screen: 'library' }, '');
  }

  async showDigest(openId) {
    this.mount(this.digestScreen.root);
    await this.digestScreen.show(openId);
    history.pushState({ screen: 'digest' }, '');
  }

  async openDoc(id, at, side) {
    const doc = await S.getDoc(id);
    if (!doc) { toast('Documento não encontrado.'); return; }
    side = this.split ? (side === undefined || side === null ? this.side : side) : 0;
    const isText = doc.kind === 'text';
    const scr = isText ? this.texts[side] : this.readers[side];
    if (this.split) {
      const slot = this.slots[side];
      for (const c of [...slot.children]) if (c !== scr.root) { this.leaving(c); c.remove(); }
      if (scr.root.parentNode !== slot) slot.appendChild(scr.root);
    } else {
      if (isText && this.textScreen.root.isConnected && this.textScreen.doc) this.textScreen.savePos();
      this.mount(scr.root);
    }
    if (isText) {
      await scr.open(doc, at);
      if (!this.split) history.pushState({ screen: 'text', id }, '');
      return;
    }
    try { await scr.open(doc, at); }
    catch (e) { console.error(e); toast('Não foi possível abrir o PDF: ' + e.message, 5000); if (!this.split) this.showLibrary(); return; }
    if (!this.split) history.pushState({ screen: 'reader', id }, '');
  }

  openAt(docId, pageKey, y) { return this.openDoc(docId, { key: pageKey || 'p1', y: y || 0 }); }

  onPop() {
    if (this.split) { this.exitSplit(this.side); return; }
    // botão "voltar" do Android: do leitor/Digest para a biblioteca
    if (this.reader.root.isConnected || this.digestScreen.root.isConnected || this.textScreen.root.isConnected) { this.mount(this.library.root); this.library.render(); }
  }

  openSettings(tab) { return openSettings(tab); }

  async importFiles(files, projectId) {
    let n = 0, restored = 0, adobe = 0, last = null;
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { toast(f.name + ' não é um PDF.'); continue; }
      toast('Importando ' + f.name + '…', 10000);
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        // PDF que voltou do reMarkable (enviado por este app): trazer as marcas para o documento original?
        if (files.length === 1) {
          const R = await import('./rmreturn.js');
          const info = await R.rmReturnInfo(bytes);
          const orig = info && await S.getDoc(info.appDocId);
          if (orig && info.marks > 0) {
            const choice = await new Promise(res => modal('PDF do reMarkable', h('div',
              h('p', 'Este PDF voltou do reMarkable: é “' + S.docTitle(orig) + '”, que você mandou por “Enviar ao reMarkable”.'),
              h('p', 'Trazer a escrita e os destaques feitos lá para o documento original? Eles viram traços e destaques normais do app (dá para apagar, mover e desfazer). Se você já trouxe antes, as marcas do reMarkable são trocadas pelas deste PDF.'),
              h('p.muted', 'As notas digitadas no reMarkable (RM2 Notas) não vêm no PDF.')), [
              { label: 'Importar como documento novo', onclick: c => { res('new'); c(); } },
              { label: 'Trazer para o original', primary: true, onclick: c => { res('merge'); c(); } },
            ], { onclose: () => res(null) }));
            if (choice === null) continue;
            if (choice === 'merge') {
              toast('Trazendo as marcas do reMarkable…', 15000);
              let r;
              try { r = await R.importRmMarks(orig, info); } catch (e) { toast('Não deu para trazer: ' + e.message, 9000); return; }
              toast('Do reMarkable: ' + r.inks + ' traço(s) e ' + r.hls + ' destaque(s) em ' + r.pages + ' página(s)' + (r.replaced ? ' (as marcas trazidas antes foram trocadas)' : '') + '.', 6000);
              this.openDoc(orig.id);
              return;
            }
          }
        }
        const doc = await importPdfBytes(f.name, bytes);
        if (projectId) { doc.projects = [projectId]; await S.saveDoc(doc); }
        restored += doc.restored || 0; adobe += doc.adobe || 0; n++; last = doc;
      } catch (e) { console.error(e); toast('Erro ao importar ' + f.name + ': ' + e.message, 5000); }
    }
    if (n) toast(n + ' PDF(s) adicionado(s)' + (restored ? ' · ' + restored + ' anotações recuperadas do PDF' : '') + (adobe ? ' · ' + adobe + ' nota(s) do Adobe convertida(s)' : '') + '.', 4000);
    await this.refreshLinkIndex();
    if (this.library.root.isConnected) this.library.renderMain();
    this.indexAll();
    if (n === 1 && last) this.openDoc(last.id);
  }

  // texto de todas as páginas, para a busca geral (roda aos poucos, em segundo plano)
  async indexDoc(doc) {
    if (!doc || doc.kind === 'notebook' || doc.kind === 'text' || await S.getTexts(doc.id)) return;
    try {
      const hd = await openPdf(doc);
      const pages = [];
      for (let n = 1; n <= hd.pdf.numPages; n++) { pages.push(await pageText(hd, n)); if (n % 5 === 0) await new Promise(r => setTimeout(r, 30)); }
      await S.saveTexts(doc.id, pages);
    } catch (e) { console.warn('indexar', e); }
  }
  // e-ink (Boox): começa depois e vai mais devagar, para não pesar enquanto você lê
  async indexAll() {
    if (this.indexing) return;
    this.indexing = true;
    try {
      if (isEink()) await new Promise(r => setTimeout(r, 45000));
      for (const d of await S.allDocs()) { await this.indexDoc(d); if (isEink()) await new Promise(r => setTimeout(r, 1500)); }
    } finally { this.indexing = false; }
  }

  // índice de todas as ligações entre documentos (para mostrar os links de volta em qualquer lugar):
  // links desenhados nos PDFs/cadernos, links escritos nos textos e nas caixas de texto dos cadernos.
  async refreshLinkIndex() {
    const anns = await S.allAnnots();
    const out = anns.filter(a => a.kind === 'link' && a.target);
    const LINK = /\[([^\]]*)\]\(leitor:\/\/([\w-]+)\/([\w-]*)(?:\?y=(\d+))?\)/g;
    const push = (srcDoc, key, y, m, n, extra) => out.push(Object.assign({ kind: 'link', id: 'mdl-' + srcDoc + '-' + n, docId: srcDoc, pageKey: key, rects: [[0, y || 0, 0, 0]], text: m[1], target: { type: 'page', docId: m[2], pageKey: m[3] || 'top', y: +(m[4] || 0) }, fromMd: true }, extra || {}));
    for (const d of (await S.allDocs()).filter(x => x.kind === 'text')) {
      const hs = headings(d.md || ''); let hi = 0, key = 'top', fence = false, k = 0;
      for (const line of String(d.md || '').split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
        if (fence) continue;
        if (/^#{1,6}\s+/.test(line) && hs[hi]) { key = hs[hi++].id; }
        let m; LINK.lastIndex = 0;
        while ((m = LINK.exec(line))) push(d.id, key, 0, m, k++);
      }
    }
    for (const a of anns) if (a.kind === 'tbox' && a.md && a.md.includes('leitor://')) {
      let m, k = 0; LINK.lastIndex = 0;
      while ((m = LINK.exec(a.md))) push(a.docId, a.pageKey, a.y, m, a.id + '-' + (k++));
    }
    const docs = new Map((await S.allDocs()).map(d => [d.id, d]));
    for (const l of out) { const sd = docs.get(l.docId); l.srcTitle = sd ? S.docTitle(sd) : '?'; l.srcLabel = sd ? pageLabel(l.pageKey, sd) : ''; }
    const sig = out.map(a => a.id + '>' + a.target.docId + '/' + a.target.pageKey + '/' + a.srcTitle).sort().join('|');
    this.linkIndex = out;
    if (sig !== this.linkSig) { this.linkSig = sig; S.emit('links', out); }
  }

  // links que chegam a um documento (todas as páginas)
  linksTo(docId) { return (this.linkIndex || []).filter(a => a.target && a.target.type === 'page' && a.target.docId === docId); }
  linksFrom(docId) { return (this.linkIndex || []).filter(a => a.docId === docId); }

  async exportObsidianAll() {
    toast('Gerando o pacote…');
    downloadBlob(await vaultZip(null), 'Obsidian-Leituras-' + new Date().toISOString().slice(0, 10) + '.zip');
  }
}

function debounceLinks(fn) { let t; return () => { clearTimeout(t); t = setTimeout(fn, 300); }; }

const app = new App();
window.leitorApp = app;
app.start().catch(e => { console.error(e); document.getElementById('app').append(h('p.err', 'Erro ao iniciar: ' + e.message)); });

if (!isAndroidApp && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
