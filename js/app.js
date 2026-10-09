// Ponto de entrada: telas, importação, indexação para a busca, índice de links.
import * as S from './store.js';
import { persistStorage } from './db.js';
import { h, toast } from './util.js';
import { Library } from './library.js';
import { Reader } from './reader.js';
import { DigestScreen } from './digestui.js';
import { importPdfBytes } from './export.js';
import { openPdf, pageText } from './pdfdoc.js';
import { openSettings } from './dialogs.js';
import { vaultZip } from './obsidian.js';
import { downloadBlob } from './util.js';
import { isAndroidApp, b64ToBytes } from './platform.js';
import { startAutoSync } from './sync.js';

const VERSION = '0.4.0';

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.library = new Library(this);
    this.reader = new Reader(this);
    this.digestScreen = new DigestScreen(this);
    this.linkIndex = [];
  }

  async start() {
    await S.deviceId();
    const st = await S.settings();
    this.applyTheme(st);
    S.on('settings', s => this.applyTheme(s));
    await this.refreshLinkIndex();
    S.on('annots', debounceLinks(() => this.refreshLinkIndex()));
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
      await this.importFiles([new File([b64ToBytes(o.b64)], o.name || 'documento.pdf', { type: 'application/pdf' })]);
    } catch (e) { toast('Não foi possível abrir o arquivo recebido: ' + e.message, 5000); }
  }

  // botão voltar do Android: fecha janelas, painéis e volta para a biblioteca. Retorna true se tratou.
  androidBack() {
    const pop = document.querySelector('.popmenu, .refpop, .lookpop');
    if (pop) { pop.remove(); return true; }
    const mb = [...document.querySelectorAll('.modal-back')].pop();
    if (mb) { const c = mb.querySelector('.modal-head .ibtn'); if (c) c.click(); else mb.remove(); return true; }
    if (this.reader.root.isConnected) {
      if (this.reader.right.classList.contains('open')) { this.reader.right.classList.remove('open'); return true; }
      if (this.reader.sideOpen) { this.reader.toggleSide(); return true; }
      this.showLibrary(); return true;
    }
    if (this.digestScreen.root.isConnected) { this.showLibrary(); return true; }
    return false;
  }

  applyTheme(st) {
    const dark = st.theme === 'escuro' || (st.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  mount(el) {
    document.querySelectorAll('.lookpop, .refpop, .popmenu').forEach(e => e.remove());
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

  async openDoc(id, at) {
    const doc = await S.getDoc(id);
    if (!doc) { toast('Documento não encontrado.'); return; }
    this.mount(this.reader.root);
    try { await this.reader.open(doc, at); }
    catch (e) { console.error(e); toast('Não foi possível abrir o PDF: ' + e.message, 5000); this.showLibrary(); return; }
    history.pushState({ screen: 'reader', id }, '');
  }

  openAt(docId, pageKey, y) { return this.openDoc(docId, { key: pageKey || 'p1', y: y || 0 }); }

  onPop() {
    // botão "voltar" do Android: do leitor/Digest para a biblioteca
    if (this.reader.root.isConnected || this.digestScreen.root.isConnected) { this.mount(this.library.root); this.library.render(); }
  }

  openSettings(tab) { return openSettings(tab); }

  async importFiles(files, projectId) {
    let n = 0, restored = 0, last = null;
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { toast(f.name + ' não é um PDF.'); continue; }
      toast('Importando ' + f.name + '…', 10000);
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const doc = await importPdfBytes(f.name, bytes);
        if (projectId) { doc.projects = [projectId]; await S.saveDoc(doc); }
        restored += doc.restored || 0; n++; last = doc;
      } catch (e) { console.error(e); toast('Erro ao importar ' + f.name + ': ' + e.message, 5000); }
    }
    if (n) toast(n + ' PDF(s) adicionado(s)' + (restored ? ' · ' + restored + ' anotações recuperadas do PDF' : '') + '.', 4000);
    await this.refreshLinkIndex();
    if (this.library.root.isConnected) this.library.renderMain();
    this.indexAll();
    if (n === 1 && last) this.openDoc(last.id);
  }

  // texto de todas as páginas, para a busca geral (roda aos poucos, em segundo plano)
  async indexDoc(doc) {
    if (!doc || doc.kind === 'notebook' || await S.getTexts(doc.id)) return;
    try {
      const hd = await openPdf(doc);
      const pages = [];
      for (let n = 1; n <= hd.pdf.numPages; n++) { pages.push(await pageText(hd, n)); if (n % 5 === 0) await new Promise(r => setTimeout(r, 30)); }
      await S.saveTexts(doc.id, pages);
    } catch (e) { console.warn('indexar', e); }
  }
  async indexAll() {
    if (this.indexing) return;
    this.indexing = true;
    try { for (const d of await S.allDocs()) await this.indexDoc(d); } finally { this.indexing = false; }
  }

  async refreshLinkIndex() {
    this.linkIndex = (await S.allAnnots()).filter(a => a.kind === 'link');
  }

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
