// Biblioteca: documentos, projetos, busca geral, gravações.
import * as S from './store.js';
import { h, clear, btn, icon, toast, popMenu, promptBox, confirmBox, fold, fmtDate, fmtTime, debounce } from './util.js';
import { openPdf, getPage, pageLabel } from './pdfdoc.js';
import { openExportDialog, openObsidianDialog, openMetaDialog, openProjectsDialog, openBriefing, openSettings } from './dialogs.js';
import { playAudio } from './audio.js';
import { vaultZip } from './obsidian.js';
import { downloadBlob } from './util.js';

export class Library {
  constructor(app) {
    this.app = app;
    this.root = h('div.screen.library');
    this.view = 'todos';   // todos | projeto:<id> | gravacoes
    this.q = '';
    S.on('docs', () => { if (this.root.isConnected && !this.busy) this.renderMain(); });
    S.on('projects', () => { if (this.root.isConnected) this.render(); });
  }

  async render() {
    clear(this.root);
    this.nav = h('nav.lnav', { 'aria-label': 'Seções' });
    this.main = h('main.lmain');
    this.root.append(this.nav, this.main);
    await this.renderNav();
    await this.renderMain();
  }

  async renderNav() {
    const n = this.nav; clear(n);
    const item = (id, ic, label, extra) => h('button.navitem', { type: 'button', 'aria-pressed': String(this.view === id), onclick: () => { this.view = id; this.q = ''; this.renderNav(); this.renderMain(); } }, icon(ic, 20), h('span.grow', label), extra || null);
    n.append(h('div.brand', 'Leitor de Pesquisa'),
      item('todos', 'library', 'Biblioteca'),
      h('button.navitem', { type: 'button', onclick: () => this.app.showDigest() }, icon('digest', 20), h('span.grow', 'Digest')),
      item('gravacoes', 'mic', 'Gravações'),
      h('div.navhead', h('span', 'PROJETOS'), btn('plus', '', async () => { const name = await promptBox('Novo projeto', 'Nome do projeto', '', 'Criar'); if (name && name.trim()) { const p = await S.saveProject({ name: name.trim() }); this.view = 'projeto:' + p.id; this.render(); } }, { iconOnly: true, title: 'Novo projeto', cls: 'ibtn small' })));
    for (const p of await S.projects()) n.appendChild(item('projeto:' + p.id, 'folder', p.name));
    n.append(h('div.grow'), h('button.navitem', { type: 'button', onclick: () => openSettings() }, icon('gear', 20), h('span.grow', 'Configurações')));
  }

  async renderMain() {
    const m = this.main; if (!m) return;
    clear(m);
    const search = h('input', { type: 'search', placeholder: 'Buscar em tudo: títulos, texto dos PDFs, notas, Digest…', value: this.q });
    const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: { display: 'none' } });
    fileIn.addEventListener('change', () => this.app.importFiles([...fileIn.files], this.view.startsWith('projeto:') ? this.view.slice(8) : null));
    m.append(h('header.ltop', h('h1', await this.title()), h('div.grow'), h('div.searchbox', icon('search', 18), search),
      h('button.pbtn', { type: 'button', onclick: () => fileIn.click() }, icon('plus', 18), 'Abrir PDF'), fileIn));
    const body = h('div.lbody');
    m.appendChild(body);
    search.addEventListener('input', debounce(() => { this.q = search.value; this.renderBody(body); }, 350));
    await this.renderBody(body);
  }

  async title() {
    if (this.view === 'gravacoes') return 'Gravações';
    if (this.view.startsWith('projeto:')) { const p = (await S.projects()).find(x => x.id === this.view.slice(8)); return p ? p.name : 'Projeto'; }
    return 'Biblioteca';
  }

  async renderBody(body) {
    clear(body);
    if (this.q.trim().length >= 2) return this.renderSearch(body, this.q.trim());
    if (this.view === 'gravacoes') return this.renderRecordings(body);
    let docs = await S.allDocs();
    if (this.view.startsWith('projeto:')) {
      const pid = this.view.slice(8);
      const proj = (await S.projects()).find(p => p.id === pid);
      docs = docs.filter(d => (d.projects || []).includes(pid));
      body.appendChild(h('div.btnrow',
        h('button.sbtn', { type: 'button', onclick: () => this.projectContext(proj) }, icon('ai', 18), proj.aiContext ? 'Contexto da IA ✓' : 'Contexto da IA'),
        h('button.sbtn', { type: 'button', onclick: () => openBriefing(docs, 'Projeto ' + (proj ? proj.name : ''), { ctx: proj.aiContext }) }, icon('ai', 18), 'Resumo do projeto (IA)'),
        h('button.sbtn', { type: 'button', onclick: async () => { toast('Gerando…'); downloadBlob(await vaultZip(docs.map(d => d.id)), 'Obsidian-' + (proj ? proj.name : 'projeto') + '.zip'); } }, icon('share', 18), 'Pacote do projeto para o Obsidian'),
        h('button.sbtn', { type: 'button', onclick: () => this.addToProject(pid) }, icon('plus', 18), 'Adicionar PDFs da biblioteca'),
        h('button.sbtn', { type: 'button', onclick: async () => { const n = await promptBox('Renomear projeto', 'Nome', proj.name, 'Salvar'); if (n && n.trim()) { proj.name = n.trim(); await S.saveProject(proj); } } }, 'Renomear'),
        h('button.dbtn', { type: 'button', onclick: async () => { if (await confirmBox('Apagar projeto', 'Apagar o projeto “' + proj.name + '”? Os PDFs continuam na biblioteca.', 'Apagar', true)) { await S.deleteProject(pid); this.view = 'todos'; this.render(); } } }, 'Apagar projeto')));
      const dg = await S.digest();
      const ids = new Set(docs.map(d => d.id));
      const items = dg.items.filter(it => ids.has(it.src.doc));
      if (items.length) body.appendChild(h('p.muted', items.length + ' trecho(s) do Digest neste projeto. ', h('button.linkbtn', { type: 'button', onclick: () => this.app.showDigest() }, 'Abrir o Digest')));
    }
    if (!docs.length) {
      body.appendChild(h('div.empty', h('p', this.view === 'todos' ? 'Nenhum PDF ainda.' : 'Nenhum PDF neste projeto.'),
        h('p.muted', 'Toque em “Abrir PDF”. O seletor do Android mostra o tablet, o Google Drive e o OneDrive.')));
      return;
    }
    const grid = h('div.grid');
    body.appendChild(grid);
    const all = await S.allAnnots();
    for (const d of docs) {
      const n = all.filter(a => a.docId === d.id).length;
      const thumb = h('div.cover');
      const card = h('div.card',
        h('button.cardopen', { type: 'button', onclick: () => this.app.openDoc(d.id), 'aria-label': 'Abrir ' + S.docTitle(d) }, thumb),
        h('div.cardinfo',
          h('div.ctitle', S.docTitle(d)),
          h('div.cmeta', [d.meta && d.meta.year, d.meta && d.meta.journal].filter(Boolean).join(' · ') || (d.fileName || '')),
          h('div.cmeta', (d.opened ? 'Aberto em ' + fmtDate(d.opened) : 'Novo') + (n ? ' · ' + n + ' anotações' : ''))),
        h('button.ibtn.cardmenu', { type: 'button', 'aria-label': 'Opções', onclick: e => this.docMenu(d, e.clientX, e.clientY) }, icon('more', 20)));
      grid.appendChild(card);
      this.thumb(d, thumb);
    }
  }

  async thumb(d, el) {
    if (d.thumb) { el.appendChild(h('img', { src: d.thumb, alt: '' })); return; }
    try {
      const hd = await openPdf(d);
      const pg = await getPage(hd, 1);
      const vp = pg.getViewport({ scale: 220 / pg.getViewport({ scale: 1 }).width });
      const c = h('canvas'); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      d.thumb = c.toDataURL('image/jpeg', 0.7);
      el.appendChild(h('img', { src: d.thumb, alt: '' }));
      this.busy = true; await S.saveDoc(d); this.busy = false;
    } catch (e) { el.appendChild(h('div.muted', 'PDF')); }
  }

  docMenu(d, x, y) {
    popMenu(x - 220, y, [
      { icon: 'doc', label: 'Abrir', onclick: () => this.app.openDoc(d.id) },
      { icon: 'tag', label: 'Dados do artigo (DOI, ABNT, BibTeX)', onclick: () => openMetaDialog(d) },
      { icon: 'folder', label: 'Projetos…', onclick: () => openProjectsDialog(d) },
      { icon: 'upload', label: 'Exportar PDF anotado', onclick: () => openExportDialog(d) },
      { icon: 'share', label: 'Enviar ao Obsidian', onclick: () => openObsidianDialog(d) },
      { icon: 'ai', label: 'Resumo das anotações (IA)', onclick: () => openBriefing([d], S.docTitle(d)) },
      { icon: 'note', label: 'Renomear', onclick: async () => { const n = await promptBox('Renomear', 'Nome', d.name, 'Salvar'); if (n && n.trim()) { d.name = n.trim(); await S.saveDoc(d); } } },
      '-',
      { icon: 'trash', label: 'Apagar da biblioteca', danger: true, onclick: async () => { if (await confirmBox('Apagar PDF', 'Apagar “' + S.docTitle(d) + '” e todas as anotações dele deste tablet? O arquivo original no Drive/OneDrive não é afetado.', 'Apagar', true)) await S.deleteDoc(d.id); } },
    ]);
  }

  async projectContext(proj) {
    const st = await S.settings();
    const v = await promptBox('Contexto da IA — ' + proj.name, 'Descreva o projeto: tema, materiais, métodos, o que importa para você. As respostas da IA para os PDFs deste projeto usarão este texto. Deixe vazio para usar o contexto geral.', proj.aiContext || '', 'Salvar', true);
    if (v === null) return;
    proj.aiContext = v.trim();
    await S.saveProject(proj);
    toast(proj.aiContext ? 'Contexto do projeto salvo.' : 'O projeto usará o contexto geral.');
    void st;
  }

  async addToProject(pid) {
    const docs = (await S.allDocs()).filter(d => !(d.projects || []).includes(pid));
    if (!docs.length) { toast('Todos os PDFs já estão neste projeto.'); return; }
    const { modal } = await import('./util.js');
    const sel = new Set();
    modal('Adicionar ao projeto', h('div.picklist', docs.map(d => { const i = h('input', { type: 'checkbox' }); i.addEventListener('change', () => i.checked ? sel.add(d.id) : sel.delete(d.id)); return h('label.check', i, h('span', S.docTitle(d))); })), [
      { label: 'Adicionar', primary: true, onclick: async c => { for (const d of docs) if (sel.has(d.id)) { d.projects = (d.projects || []).concat([pid]); await S.saveDoc(d); } c(); } },
    ]);
  }

  async renderRecordings(body) {
    const recs = (await S.allRecordings()).sort((a, b) => b.started - a.started);
    const docs = await S.allDocs();
    if (!recs.length) { body.appendChild(h('div.empty', h('p', 'Nenhuma gravação.'), h('p.muted', 'No leitor, toque no botão ● para gravar enquanto escreve. Depois, tocar num traço toca o áudio daquele momento.'))); return; }
    for (const r of recs) {
      const d = docs.find(x => x.id === r.docId);
      body.appendChild(h('div.srow.big', btn('play', '', () => playAudio(r.fileId, 0, r.title), { iconOnly: true, title: 'Ouvir' }),
        h('div.grow', h('div', r.title), h('div.muted', (d ? S.docTitle(d) : 'documento removido') + ' · ' + fmtTime(r.duration))),
        d ? h('button.sbtn', { type: 'button', onclick: () => this.app.openDoc(d.id) }, 'Abrir PDF') : null,
        btn('trash', '', async () => { if (await confirmBox('Apagar gravação', 'Apagar esta gravação?', 'Apagar', true)) { await S.deleteRecording(r); this.renderMain(); } }, { iconOnly: true, title: 'Apagar' })));
    }
  }

  // busca geral
  async renderSearch(body, q) {
    const fq = fold(q);
    const words = fq.split(/\s+/).filter(Boolean);
    const has = t => { const f = fold(t); return words.every(w => f.includes(w)); };
    const docs = await S.allDocs();
    const sec = (t, n) => h('h2.sech', t + ' (' + n + ')');
    const byDoc = docs.filter(d => has(S.docTitle(d) + ' ' + (d.fileName || '') + ' ' + JSON.stringify(d.meta || {})));
    body.appendChild(sec('Documentos', byDoc.length));
    for (const d of byDoc) body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.openDoc(d.id) }, icon('doc', 18), h('span.grow', S.docTitle(d))));
    // texto dos PDFs
    const texts = await S.allTexts();
    const hits = [];
    for (const t of texts) {
      const d = docs.find(x => x.id === t.docId); if (!d) continue;
      t.pages.forEach((p, i) => {
        const f = fold(p); const k = f.indexOf(words[0]);
        if (k >= 0 && words.every(w => f.includes(w))) hits.push({ d, n: i + 1, k, p });
      });
    }
    body.appendChild(sec('No texto dos PDFs', hits.length));
    for (const r of hits.slice(0, 150)) {
      const s = Math.max(0, r.k - 50);
      body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.openAt(r.d.id, 'p' + r.n) }, icon('search', 18),
        h('div.grow', h('div.clamp', (s ? '…' : '') + r.p.slice(s, r.k), h('mark', r.p.slice(r.k, r.k + words[0].length)), r.p.slice(r.k + words[0].length, r.k + 120)), h('div.muted', S.docTitle(r.d) + ' · p. ' + r.n))));
    }
    const pending = docs.filter(d => !texts.some(t => t.docId === d.id)).length;
    if (pending) body.appendChild(h('p.muted', pending + ' PDF(s) ainda sendo indexados para a busca.'));
    // anotações
    const anns = (await S.allAnnots()).filter(a => has((a.text || '') + ' ' + (a.note || '')));
    body.appendChild(sec('Destaques e notas', anns.length));
    for (const a of anns.slice(0, 100)) {
      const d = docs.find(x => x.id === a.docId); if (!d) continue;
      body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.openAt(d.id, a.pageKey, a.rects ? a.rects[0][1] : a.y) }, icon('note', 18),
        h('div.grow', h('div.clamp', a.text || ''), a.note ? h('div.clamp.muted', 'Nota: ' + a.note) : null, h('div.muted', S.docTitle(d) + ' · ' + pageLabel(a.pageKey)))));
    }
    // Digest
    const dg = await S.digest();
    const its = dgFilter(dg, { text: q }, 'recentes');
    body.appendChild(sec('Digest', its.length));
    for (const it of its.slice(0, 100)) body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.showDigest(it.id) }, icon('digest', 18), h('div.grow', h('div.clamp', it.quote), h('div.muted', it.src.name + ' · ' + dgPages(it)))));
  }
}
