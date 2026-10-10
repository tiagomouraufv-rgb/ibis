// Biblioteca: documentos, projetos, busca geral, gravações.
import * as S from './store.js';
import { h, clear, btn, icon, toast, popMenu, promptBox, confirmBox, fold, fmtDate, fmtTime, debounce, uid } from './util.js';
import { openPdf, getPage, pageLabel } from './pdfdoc.js';
import { openExportDialog, openObsidianDialog, openMetaDialog, openProjectsDialog, openBriefing, openSettings } from './dialogs.js';
import { playAudio } from './audio.js';
import { vaultZip } from './obsidian.js';
import { downloadBlob } from './util.js';
import * as NB from './notebook.js';
import { plainText, headings } from './md.js';
import { openNotebookExport } from './dialogs.js';
import * as SY from './sync.js';
import * as TX from './textdoc.js';
import { openExternal } from './platform.js';

export class Library {
  constructor(app) {
    this.app = app;
    this.root = h('div.screen.library');
    this.view = 'todos';   // todos | projeto:<id> | gravacoes
    this.q = '';
    S.on('docs', () => { if (this.root.isConnected && !this.busy) this.renderMain(); });
    S.on('projects', () => { if (this.root.isConnected) this.render(); });
    S.on('readLater', () => { if (this.root.isConnected && (this.view === 'lerdepois' || this.ptab === 'ler')) this.renderMain(); });
    S.on('sync', () => this.paintSync());
  }

  paintSync() {
    const b = this.syncBtn; if (!b) return;
    const st = SY.syncStatus();
    const label = { off: 'Sincronizar (desligada)', idle: 'Sincronizado', busy: 'Sincronizando…', error: 'Erro na sincronização', login: 'Toque para sincronizar' }[st.state] || 'Sincronizar';
    clear(b);
    b.dataset.state = st.state;
    b.title = st.msg || (st.last ? 'Última: ' + new Date(st.last).toLocaleString('pt-BR') : '');
    b.append(icon('sync', 20), h('span.grow', label));
  }

  async syncClick() {
    const st = SY.syncStatus();
    if (st.state === 'off') return openSettings('sync');
    try { const r = await SY.syncNow({ interactive: true }); if (r && !r.skipped) toast('Sincronizado.'); }
    catch (e) { toast(e.message, 6000); if (e.code === 'noclient') openSettings('sync'); }
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
    const item = (id, ic, label, extra) => h('button.navitem', { type: 'button', 'aria-pressed': String(this.view === id), onclick: () => { this.view = id; this.q = ''; n.classList.remove('open'); this.renderNav(); this.renderMain(); } }, icon(ic, 20), h('span.grow', label), extra || null);
    n.append(h('div.brand', 'Leitor de Pesquisa'),
      item('todos', 'library', 'Biblioteca'),
      h('button.navitem', { type: 'button', onclick: () => this.app.showDigest() }, icon('digest', 20), h('span.grow', 'Digest')),
      item('gravacoes', 'mic', 'Gravações'),
      item('lerdepois', 'bookmark', 'Ler depois'),
      h('div.navhead', h('span', 'PROJETOS'), btn('plus', '', async () => { const name = await promptBox('Novo projeto', 'Nome do projeto', '', 'Criar'); if (name && name.trim()) { const p = await S.saveProject({ name: name.trim() }); this.view = 'projeto:' + p.id; this.render(); } }, { iconOnly: true, title: 'Novo projeto', cls: 'ibtn small' })));
    for (const p of await S.projects()) n.appendChild(item('projeto:' + p.id, 'folder', p.name));
    this.syncBtn = h('button.navitem.syncitem', { type: 'button', onclick: () => this.syncClick() });
    this.paintSync();
    n.append(h('div.grow'), this.syncBtn, h('button.navitem', { type: 'button', onclick: () => openSettings() }, icon('gear', 20), h('span.grow', 'Configurações')));
  }

  async renderMain() {
    const m = this.main; if (!m) return;
    clear(m);
    const search = h('input', { type: 'search', placeholder: 'Buscar em tudo: títulos, texto dos PDFs, notas, Digest…', value: this.q });
    const fileIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: { display: 'none' } });
    fileIn.addEventListener('change', () => this.app.importFiles([...fileIn.files], this.view.startsWith('projeto:') ? this.view.slice(8) : null));
    m.append(h('header.ltop', h('button.ibtn.menubtn', { type: 'button', 'aria-label': 'Menu', onclick: () => this.nav.classList.toggle('open') }, icon('menu', 22)), h('h1', await this.title()), h('div.grow'),
      h('div.newgroup', { role: 'group', 'aria-label': 'Novo' },
        h('button.ng', { type: 'button', onclick: () => fileIn.click() }, icon('plus', 18), h('span', 'Abrir PDF')),
        h('button.ng', { type: 'button', onclick: () => this.newText() }, icon('text', 18), h('span', 'Novo texto')),
        h('button.ng', { type: 'button', onclick: () => this.newNotebook() }, icon('notebook', 18), h('span', 'Novo caderno'))), fileIn),
      h('div.lsearch', h('div.searchbox', icon('search', 18), search)));
    const body = h('div.lbody');
    m.appendChild(body);
    search.addEventListener('input', debounce(() => { this.q = search.value; this.renderBody(body); }, 350));
    await this.renderBody(body);
  }

  async title() {
    if (this.view === 'gravacoes') return 'Gravações';
    if (this.view === 'lerdepois') return 'Ler depois';
    if (this.view.startsWith('projeto:')) { const p = (await S.projects()).find(x => x.id === this.view.slice(8)); return p ? p.name : 'Projeto'; }
    return 'Biblioteca';
  }

  async renderBody(body) {
    clear(body);
    if (this.q.trim().length >= 2) return this.renderSearch(body, this.q.trim());
    if (this.view === 'gravacoes') return this.renderRecordings(body);
    if (this.view === 'lerdepois') {
      const all = (await S.readLater()).slice().sort((a, b) => a.added - b.added);
      body.appendChild(h('p.muted', 'Artigos citados que você marcou com “Ler depois” (toque numa citação de um PDF para ver o artigo). Os de PDFs que estão em projetos aparecem também na aba “Para ler” do projeto.'));
      this.renderReadLater(body, all, true);
      return;
    }
    let docs = await S.allDocs();
    let proj = null;
    if (this.view.startsWith('projeto:')) {
      const pid = this.view.slice(8);
      proj = (await S.projects()).find(p => p.id === pid);
      if (!proj) { this.view = 'todos'; return this.render(); }
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
      const items = dgFilter(dg, {}, 'recentes').filter(it => ids.has(it.src.doc));
      const rl = (await S.readLater()).filter(x => (x.projects || []).includes(pid)).sort((a, b) => a.added - b.added);
      this.ptab = this.ptab || 'docs';
      const tabs = [['docs', 'Documentos (' + docs.length + ')'], ['digest', 'Digest (' + items.length + ')'], ['ler', 'Para ler (' + rl.length + ')']];
      body.appendChild(h('div.tabsrow.ptabs', { role: 'tablist' }, tabs.map(([id, l]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(this.ptab === id), onclick: () => { this.ptab = id; this.renderBody(body); } }, l))));
      if (this.ptab === 'digest') {
        if (!items.length) body.appendChild(h('p.muted.pad', 'Nenhum trecho do Digest vem dos documentos deste projeto ainda.'));
        const list = h('div.dlist.pdigest');
        for (const it of items) list.appendChild(this.app.digestScreen.card(it));
        body.appendChild(list);
        return;
      }
      if (this.ptab === 'ler') {
        if (!rl.length) body.appendChild(h('p.muted.pad', 'Nada aqui ainda. Num PDF deste projeto, toque numa citação (o número da referência) e use “Ler depois”.'));
        else this.renderReadLater(body, rl, false);
        return;
      }
    }
    const all = await S.allAnnots();
    const annCount = new Map(), annEdit = new Map();
    for (const a of all) { annCount.set(a.docId, (annCount.get(a.docId) || 0) + 1); annEdit.set(a.docId, Math.max(annEdit.get(a.docId) || 0, a.updated || a.created || 0)); }
    this.annCount = annCount; this.annEdit = annEdit;
    if (proj) return this.renderProject(body, proj, docs);
    if (!docs.length) {
      body.appendChild(h('div.empty', h('p', 'Nenhum documento ainda.'),
        h('p.muted', 'Toque em “Abrir PDF”, “Novo texto” ou “Novo caderno”. O seletor do Android mostra o tablet, o Google Drive e o OneDrive.')));
      return;
    }
    // continuar lendo: os últimos abertos
    const recent = docs.filter(d => d.opened).sort((a, b) => b.opened - a.opened).slice(0, 4);
    if (recent.length) {
      body.appendChild(h('div.flabel', 'CONTINUAR'));
      body.appendChild(h('div.resume', recent.map(d => h('button.resumecard', { type: 'button', onclick: () => this.app.openDoc(d.id) },
        icon(kindIcon(d), 18), h('span.clamp', S.docTitle(d)), h('span.muted', resumeWhere(d))))));
    }
    // biblioteca principal: três colunas (PDF, caderno, texto), em ordem alfabética
    const cols = h('div.libcols');
    for (const [kind, label, ic] of [['pdf', 'PDFs', 'doc'], ['notebook', 'Cadernos', 'notebook'], ['text', 'Textos', 'text']]) {
      const list = sortDocs(docs.filter(d => docKind(d) === kind), 'alfa');
      const col = h('section.libcol', h('h2.libcolh', icon(ic, 18), h('span', label), h('span.muted', String(list.length))));
      const sc = h('div.libcolscroll');
      if (!list.length) sc.appendChild(h('p.muted.pad', kind === 'pdf' ? 'Nenhum PDF.' : kind === 'notebook' ? 'Nenhum caderno.' : 'Nenhum texto.'));
      for (const d of list) sc.appendChild(this.row(d));
      col.appendChild(sc);
      cols.appendChild(col);
    }
    body.appendChild(cols);
  }

  // linha compacta (biblioteca principal)
  row(d) {
    const thumb = h('div.rowthumb');
    const n = (this.annCount && this.annCount.get(d.id)) || 0;
    const r = h('div.docrow', { 'data-id': d.id },
      h('button.docrowopen', { type: 'button', onclick: () => this.app.openDoc(d.id), 'aria-label': 'Abrir ' + S.docTitle(d) }, thumb,
        h('span.docrowtxt', h('span.ctitle', (d.fav ? '★ ' : '') + S.docTitle(d)), h('span.cmeta', metaLine(d) + (n ? ' · ' + n + ' anot.' : '')))),
      h('button.ibtn.small', { type: 'button', 'aria-label': 'Opções', onclick: e => this.docMenu(d, e.clientX, e.clientY) }, icon('more', 18)));
    r.addEventListener('contextmenu', e => { e.preventDefault(); this.docMenu(d, e.clientX + 220, e.clientY); });
    this.dragCard(r, d);
    this.thumb(d, thumb, true);
    return r;
  }

  // cartão grande (projetos)
  card(d) {
    const n = (this.annCount && this.annCount.get(d.id)) || 0;
    const thumb = h('div.cover');
    const card = h('div.card', { 'data-id': d.id },
      h('button.cardopen', { type: 'button', onclick: () => this.app.openDoc(d.id), 'aria-label': 'Abrir ' + S.docTitle(d) }, thumb),
      h('div.cardinfo',
        h('div.ctitle', S.docTitle(d)),
        h('div.cmeta', metaLine(d)),
        h('div.cmeta', (d.opened ? 'Aberto em ' + fmtDate(d.opened) : 'Novo') + (n ? ' · ' + n + ' anotações' : ''))),
      h('button.ibtn.cardmenu', { type: 'button', 'aria-label': 'Opções', onclick: e => this.docMenu(d, e.clientX, e.clientY) }, icon('more', 20)));
    card.addEventListener('contextmenu', e => { e.preventDefault(); this.docMenu(d, e.clientX + 220, e.clientY); });
    this.dragCard(card, d);
    this.thumb(d, thumb);
    return card;
  }

  // arrastar um documento (mouse) para uma pasta do projeto
  dragCard(el, d) {
    if (!matchMedia('(pointer: fine)').matches) return;
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-leitor-doc', d.id); e.dataTransfer.effectAllowed = 'move'; });
  }

  // ---------- projeto: ordem, pastas e subpastas ----------
  async renderProject(body, proj, docs) {
    const pid = proj.id;
    const folders = proj.folders || [];
    if (this.folderOf !== pid) { this.folderOf = pid; this.folder = null; }
    if (this.folder && !folders.some(f => f.id === this.folder)) this.folder = null;
    const st = await S.settings();
    const sort = st.projSort || 'alfa';
    const inFolder = d => { const f = (d.pfolders || {})[pid]; return f && folders.some(x => x.id === f) ? f : null; };
    const here = docs.filter(d => inFolder(d) === this.folder);
    const subs = folders.filter(f => (f.parent || null) === this.folder).sort((a, b) => cmp(a.name, b.name));
    const countIn = fid => { const ids = new Set([fid]); let grew = true; while (grew) { grew = false; for (const f of folders) if (f.parent && ids.has(f.parent) && !ids.has(f.id)) { ids.add(f.id); grew = true; } } return docs.filter(d => ids.has(inFolder(d))).length; };
    // barra: caminho, ordem, nova pasta
    const crumbs = [h('button.crumb', { type: 'button', onclick: () => { this.folder = null; this.renderBody(body); } }, icon('folder', 16), proj.name)];
    const chain = []; let f = folders.find(x => x.id === this.folder);
    while (f) { chain.unshift(f); f = folders.find(x => x.id === f.parent); }
    for (const c of chain) crumbs.push(h('span.muted', '›'), h('button.crumb', { type: 'button', onclick: () => { this.folder = c.id; this.renderBody(body); } }, c.name));
    const sortBtn = (id, l) => h('button', { type: 'button', 'aria-pressed': String(sort === id), onclick: async () => { await S.setSettings({ projSort: id }); this.renderBody(body); } }, l);
    body.appendChild(h('div.projbar',
      h('nav.crumbs', { 'aria-label': 'Pasta atual' }, crumbs),
      h('div.grow'),
      h('div.seg', { role: 'group', 'aria-label': 'Ordem' }, h('span.muted', 'Ordem:'), sortBtn('alfa', 'A–Z'), sortBtn('edit', 'Última edição'), sortBtn('tipo', 'Tipo')),
      h('button.sbtn', { type: 'button', onclick: () => this.newFolder(proj, this.folder) }, icon('plus', 16), 'Nova pasta')));
    if (subs.length) {
      const fl = h('div.folders');
      for (const sf of subs) {
        const tile = h('div.foldertile', { 'data-folder': sf.id },
          h('button.folderopen', { type: 'button', onclick: () => { this.folder = sf.id; this.renderBody(body); } }, icon('folder', 22), h('span.clamp', sf.name), h('span.muted', String(countIn(sf.id)))),
          h('button.ibtn.small', { type: 'button', 'aria-label': 'Opções da pasta', onclick: e => this.folderMenu(proj, sf, e.clientX, e.clientY) }, icon('more', 18)));
        tile.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-leitor-doc')) { e.preventDefault(); tile.classList.add('dropok'); } });
        tile.addEventListener('dragleave', () => tile.classList.remove('dropok'));
        tile.addEventListener('drop', async e => { const id = e.dataTransfer.getData('application/x-leitor-doc'); if (!id) return; e.preventDefault(); await this.moveDoc(id, pid, sf.id); });
        fl.appendChild(tile);
      }
      body.appendChild(fl);
    }
    if (!here.length && !subs.length) {
      body.appendChild(h('div.empty', h('p', this.folder ? 'Pasta vazia.' : 'Nenhum documento neste projeto.'),
        h('p.muted', this.folder ? 'Use ⋯ > “Mover para pasta…” num documento do projeto (ou arraste com o mouse até a pasta).' : 'Use “Abrir PDF”, “Novo texto”, “Novo caderno” ou “Adicionar da biblioteca”.')));
      return;
    }
    const groups = sort === 'tipo'
      ? [['text', 'Textos'], ['notebook', 'Cadernos'], ['pdf', 'PDFs']].map(([k, l]) => [l, sortDocs(here.filter(d => docKind(d) === k), 'alfa')]).filter(g => g[1].length)
      : [[null, sortDocs(here, sort, this.annEdit)]];
    for (const [label, list] of groups) {
      if (label) body.appendChild(h('h2.sech', label + ' (' + list.length + ')'));
      const grid = h('div.grid');
      for (const d of list) grid.appendChild(this.card(d));
      body.appendChild(grid);
    }
  }

  async newFolder(proj, parent) {
    const name = await promptBox('Nova pasta', 'Nome da pasta', '', 'Criar');
    if (!name || !name.trim()) return;
    proj.folders = (proj.folders || []).concat([{ id: uid('pf'), name: name.trim(), parent: parent || null }]);
    await S.saveProject(proj);
  }

  folderMenu(proj, f, x, y) {
    popMenu(x - 220, y, [
      { icon: 'note', label: 'Renomear', onclick: async () => { const n = await promptBox('Renomear pasta', 'Nome', f.name, 'Salvar'); if (n && n.trim()) { f.name = n.trim(); proj.folders = proj.folders.map(x => x.id === f.id ? f : x); await S.saveProject(proj); } } },
      { icon: 'folder', label: 'Mover para…', onclick: () => this.pickFolder(proj, 'Mover a pasta “' + f.name + '” para', f.id, async dest => { f.parent = dest; proj.folders = proj.folders.map(x => x.id === f.id ? f : x); await S.saveProject(proj); }) },
      '-',
      { icon: 'trash', label: 'Apagar pasta (o conteúdo sobe um nível)', danger: true, onclick: async () => {
        if (!(await confirmBox('Apagar pasta', 'Apagar a pasta “' + f.name + '”? Os documentos e subpastas dela passam para a pasta de cima. Nada é apagado da biblioteca.', 'Apagar pasta', true))) return;
        const up = f.parent || null;
        proj.folders = proj.folders.filter(x => x.id !== f.id).map(x => x.parent === f.id ? Object.assign({}, x, { parent: up }) : x);
        await S.saveProject(proj);
        for (const d of await S.allDocs()) if ((d.pfolders || {})[proj.id] === f.id) await this.moveDoc(d.id, proj.id, up, true);
        this.renderMain();
      } },
    ]);
  }

  // escolher uma pasta do projeto (exclui a própria pasta e as filhas dela, ao mover uma pasta)
  async pickFolder(proj, title, exclude, onPick) {
    const { modal } = await import('./util.js');
    const folders = proj.folders || [];
    const banned = new Set();
    if (exclude) { banned.add(exclude); let grew = true; while (grew) { grew = false; for (const f of folders) if (f.parent && banned.has(f.parent) && !banned.has(f.id)) { banned.add(f.id); grew = true; } } }
    const rows = [h('button.pickrow', { type: 'button', onclick: () => { m.close(); onPick(null); } }, icon('folder', 16), h('b', proj.name + ' (raiz)'))];
    const walk = (parent, depth) => {
      for (const f of folders.filter(x => (x.parent || null) === parent).sort((a, b) => cmp(a.name, b.name))) {
        if (banned.has(f.id)) continue;
        rows.push(h('button.pickrow', { type: 'button', style: { paddingLeft: (12 + depth * 18) + 'px' }, onclick: () => { m.close(); onPick(f.id); } }, icon('folder', 16), h('span', f.name)));
        walk(f.id, depth + 1);
      }
    };
    walk(null, 1);
    const m = modal(title, h('div.picklist', rows));
  }

  async moveDoc(docId, pid, folderId, quiet) {
    const d = await S.getDoc(docId);
    if (!d) return;
    d.pfolders = Object.assign({}, d.pfolders || {});
    if (folderId) d.pfolders[pid] = folderId; else delete d.pfolders[pid];
    if (!(d.projects || []).includes(pid)) d.projects = (d.projects || []).concat([pid]);
    await S.saveDoc(d);
    if (!quiet) { toast('Movido.'); this.renderMain(); }
  }

  async newNotebook() {
    const { modal } = await import('./util.js');
    const name = h('input', { type: 'text', value: 'Caderno ' + new Date().toLocaleDateString('pt-BR') });
    let tpl = 'lined', color = NB.COVER_COLORS[0][0];
    const tpls = h('div.chips');
    const cols = h('div.chips');
    const prev = h('img.coverprev', { alt: 'Prévia da capa' });
    const paintPrev = () => { if (!color) { prev.style.visibility = 'hidden'; return; } prev.style.visibility = ''; prev.src = NB.coverUrl({ id: 'previa', name: name.value || 'Caderno', coverColor: color, added: Date.now() }, { w: 595.28, h: 841.89 }, 0.5); };
    const render = () => {
      clear(tpls); for (const [id, l] of NB.TEMPLATES) tpls.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(tpl === id), onclick: () => { tpl = id; render(); } }, l));
      clear(cols);
      for (const [c, l] of NB.COVER_COLORS) cols.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(color === c), onclick: () => { color = c; render(); } }, h('span.swatch', { style: { background: c } }), l));
      cols.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(!color), onclick: () => { color = ''; render(); } }, 'Sem capa'));
      paintPrev();
    };
    name.addEventListener('input', paintPrev);
    render();
    modal('Novo caderno', h('div.newnb', h('div.grow', h('label.field', h('span', 'Nome'), name), h('div.flabel', 'MODELO DAS PÁGINAS'), tpls, h('div.flabel', 'CAPA'), cols), prev), [
      { label: 'Cancelar' },
      { label: 'Criar', primary: true, onclick: async c => {
        c();
        const doc = await NB.createNotebook(name.value.trim() || 'Caderno', tpl, color);
        this.placeNew(doc); await S.saveDoc(doc);
        this.app.openDoc(doc.id);
      } },
    ]);
  }

  // tabela "ler depois", na ordem em que foram marcados
  renderReadLater(body, items, showProj) {
    if (!items.length) { body.appendChild(h('p.muted.pad', 'Nenhum artigo marcado ainda.')); return; }
    const tbl = h('table.rltab', h('thead', h('tr', h('th', '#'), h('th', 'Artigo'), h('th', 'Resumo'), h('th', 'Citado em'), h('th', ''))));
    const tb = h('tbody');
    items.forEach((it, i) => {
      const au = (it.authors || []).length > 3 ? it.authors[0] + ' et al.' : (it.authors || []).join(', ');
      tb.appendChild(h('tr' + (it.done ? '.done' : ''),
        h('td.num', String(i + 1)),
        h('td', h('div.rlt', it.title || it.ref || '(sem título)'), h('div.muted.small', [au, it.venue, it.year].filter(Boolean).join(' · ')), typeof it.cites === 'number' ? h('div.small.refcites', 'citado ' + it.cites.toLocaleString('pt-BR') + ' vezes') : null),
        h('td', it.abstract ? h('details', h('summary', 'Ver resumo'), h('div.rlabs', it.abstract)) : h('span.muted.small', '—')),
        h('td', it.fromDocId ? h('button.linkbtn', { type: 'button', onclick: () => this.app.openAt(it.fromDocId, it.fromPage ? 'p' + it.fromPage : '') }, (it.fromTitle || 'documento') + (it.fromPage ? ', p. ' + it.fromPage : '')) : h('span.muted', '—')),
        h('td.acts',
          it.url ? h('button.ibtn.small', { type: 'button', title: 'Abrir o artigo', onclick: () => openExternal(it.url) }, icon('fwd', 16)) : null,
          h('button.ibtn.small', { type: 'button', title: it.done ? 'Marcar como não lido' : 'Marcar como lido', onclick: async () => { it.done = !it.done; await S.saveReadLaterItem(it); this.renderMain(); } }, icon('check', 16)),
          h('button.ibtn.small', { type: 'button', title: 'Tirar da lista', onclick: async () => { await S.delReadLater(it.id); this.renderMain(); } }, icon('trash', 16)))));
    });
    tbl.appendChild(tb);
    body.appendChild(h('div.rlwrap', tbl));
    void showProj;
  }

  async newText() {
    const name = await promptBox('Novo texto', 'Nome', 'Texto ' + new Date().toLocaleDateString('pt-BR'), 'Criar');
    if (name === null) return;
    const doc = await TX.createTextDoc(name.trim() || 'Texto');
    this.placeNew(doc); await S.saveDoc(doc);
    this.app.openDoc(doc.id);
  }

  // documento novo criado dentro de um projeto (e da pasta aberta)
  placeNew(doc) {
    if (!this.view.startsWith('projeto:')) return;
    const pid = this.view.slice(8);
    doc.projects = [pid];
    if (this.folder && this.folderOf === pid) doc.pfolders = { [pid]: this.folder };
  }

  async thumb(d, el, small) {
    if (small && d.kind === 'text') { el.classList.add('txcover'); el.appendChild(icon('text', 22)); return; }
    if (d.kind === 'text') {
      const md = d.md || '';
      const first = (md.match(/^#{1,3}\s+(.+)$/m) || [])[1] || S.docTitle(d);
      el.classList.add('txcover');
      el.appendChild(h('div.txthumb', h('div.txt-t', first.replace(/[*_`=$]/g, '')), h('div.txt-b', plainText(md.replace(/^#{1,3}\s+.+$/m, '')).slice(0, 320))));
      return;
    }
    if (d.kind === 'notebook') {
      try { el.appendChild(h('img', { src: await NB.coverDataUrl(d), alt: '' })); } catch (e) { el.appendChild(icon('notebook', 40)); }
      el.classList.add('nbcover');
      if (small) el.style.background = d.coverColor || '#fff';
      return;
    }
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
      { icon: 'share', label: 'Compartilhar… (menu do Android)', onclick: async () => (await import('./share.js')).shareDoc(d) },
      { icon: 'bookmark', label: d.fav ? 'Tirar dos favoritos' : 'Favoritar ★', onclick: async () => { d.fav = !d.fav; await S.saveDoc(d); } },
      { icon: 'pages', label: 'Abrir em nova janela', onclick: () => this.app.newWindow(d.id) },
      d.kind ? null : { icon: 'tag', label: 'Dados do artigo (DOI, ABNT, BibTeX)', onclick: () => openMetaDialog(d) },
      { icon: 'folder', label: 'Projetos…', onclick: () => openProjectsDialog(d) },
      this.view.startsWith('projeto:') ? { icon: 'folder', label: 'Mover para pasta…', onclick: async () => { const pid = this.view.slice(8); const proj = (await S.projects()).find(p => p.id === pid); if (proj) this.pickFolder(proj, 'Mover “' + S.docTitle(d) + '” para', null, f => this.moveDoc(d.id, pid, f)); } } : null,
      d.kind === 'text' ? { icon: 'upload', label: 'Exportar texto (Markdown / Obsidian / PDF)', onclick: () => TX.openTextExport(d) } : d.kind === 'notebook' ? { icon: 'upload', label: 'Exportar caderno (PDF / Obsidian)', onclick: () => openNotebookExport(d) } : { icon: 'upload', label: 'Exportar PDF anotado', onclick: () => openExportDialog(d) },
      d.kind ? null : { icon: 'share', label: 'Enviar ao Obsidian', onclick: () => openObsidianDialog(d) },
      d.kind === 'notebook' ? { icon: 'notebook', label: 'Capa…', onclick: () => this.app.reader.coverMenu(d, x - 220, y, () => this.renderMain()) } : null,
      { icon: 'ai', label: 'Resumo das anotações (IA)', onclick: () => openBriefing([d], S.docTitle(d)) },
      d.kind ? null : { icon: 'ai', label: 'Resumo por capítulo/seção (IA)', onclick: async () => { const { openSectionBriefing } = await import('./dialogs.js'); openSectionBriefing(d); } },
      { icon: 'note', label: 'Renomear', onclick: async () => { const n = await promptBox('Renomear', 'Nome', d.name, 'Salvar'); if (n && n.trim()) { d.name = n.trim(); await S.saveDoc(d); } } },
      '-',
      { icon: 'trash', label: 'Apagar da biblioteca', danger: true, onclick: async () => { if (await confirmBox('Apagar PDF', 'Apagar “' + S.docTitle(d) + '” e todas as anotações dele? Com a sincronização ligada, ele some também dos outros aparelhos. Cópias que você salvou fora do app não são afetadas.', 'Apagar', true)) await S.deleteDoc(d.id); } },
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
    // textos
    const tx = [];
    for (const d of docs.filter(x => x.kind === 'text')) {
      const blocks = TX.splitBlocks(d.md || '');
      let key = 'top'; let hi = 0;
      const hs = headings(d.md || '');
      for (const b of blocks) {
        if (/^#{1,6}\s+/.test(b) && hs[hi]) key = hs[hi++].id;
        const p = plainText(b); if (words.every(w => fold(p).includes(w))) tx.push({ d, p, k: fold(p).indexOf(words[0]), key });
      }
    }
    body.appendChild(sec('Nos textos', tx.length));
    for (const r of tx.slice(0, 100)) {
      const s = Math.max(0, r.k - 50);
      body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.openAt(r.d.id, r.key) }, icon('text', 18),
        h('div.grow', h('div.clamp', (s ? '…' : '') + r.p.slice(s, r.k), h('mark', r.p.slice(r.k, r.k + words[0].length)), r.p.slice(r.k + words[0].length, r.k + 120)), h('div.muted', S.docTitle(r.d)))));
    }
    const pending = docs.filter(d => !d.kind && !texts.some(t => t.docId === d.id)).length;
    if (pending) body.appendChild(h('p.muted', pending + ' PDF(s) ainda sendo indexados para a busca.'));
    // anotações
    const anns = (await S.allAnnots()).filter(a => has((a.text || '') + ' ' + (a.note || '') + ' ' + (a.md ? plainText(a.md) : '')));
    body.appendChild(sec('Destaques e notas', anns.length));
    for (const a of anns.slice(0, 100)) {
      const d = docs.find(x => x.id === a.docId); if (!d) continue;
      body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.openAt(d.id, a.pageKey, a.rects ? a.rects[0][1] : a.y) }, icon('note', 18),
        h('div.grow', h('div.clamp', a.text || (a.md ? plainText(a.md) : '')), a.note ? h('div.clamp.muted', 'Nota: ' + a.note) : null, h('div.muted', S.docTitle(d) + ' · ' + (d.kind === 'notebook' ? 'caderno' : pageLabel(a.pageKey))))));
    }
    // Digest
    const dg = await S.digest();
    const its = dgFilter(dg, { text: q }, 'recentes');
    body.appendChild(sec('Digest', its.length));
    for (const it of its.slice(0, 100)) body.appendChild(h('button.srow.big', { type: 'button', onclick: () => this.app.showDigest(it.id) }, icon('digest', 18), h('div.grow', h('div.clamp', it.quote), h('div.muted', it.src.name + ' · ' + dgPages(it)))));
  }
}

// ---------- ordem e rótulos ----------
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
function cmp(a, b) { return collator.compare(a || '', b || ''); }
export function docKind(d) { return d.kind === 'notebook' ? 'notebook' : d.kind === 'text' ? 'text' : 'pdf'; }
function kindIcon(d) { return docKind(d) === 'notebook' ? 'notebook' : docKind(d) === 'text' ? 'text' : 'doc'; }
// campos que só registram leitura (não contam como edição)
const VIEW_FIELDS = new Set(['opened', 'lastKey', 'lastY', 'thumb', 'textPos', 'updated', 'fts', 'colSetup', 'colMode', 'inkOpen', 'fav']);
export function lastEdit(d, annEdit) {
  let t = d.added || 0;
  for (const [k, v] of Object.entries(d.fts || {})) if (!VIEW_FIELDS.has(k) && v > t) t = v;
  return Math.max(t, (annEdit && annEdit.get(d.id)) || 0);
}
export function sortDocs(list, how, annEdit) {
  const out = list.slice();
  if (how === 'edit') out.sort((a, b) => lastEdit(b, annEdit) - lastEdit(a, annEdit));
  else out.sort((a, b) => cmp(S.docTitle(a), S.docTitle(b)));
  return out;
}
function metaLine(d) {
  if (d.kind === 'text') return 'Texto · ' + plainText(d.md || '').split(/\s+/).filter(Boolean).length + ' palavras';
  if (d.kind === 'notebook') return 'Caderno · ' + (d.pages || []).length + ' página(s)';
  return [d.meta && d.meta.year, d.meta && d.meta.journal].filter(Boolean).join(' · ') || (d.fileName || 'PDF');
}
function resumeWhere(d) {
  if (d.kind === 'text') return 'texto';
  const k = d.lastKey || '';
  if (d.kind === 'notebook') return 'caderno';
  return /^p\d+$/.test(k) ? 'p. ' + k.slice(1) : 'PDF';
}
