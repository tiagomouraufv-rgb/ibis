// Digest: painel de captura (no leitor) e tela de navegação (Recentes, Fontes, Áreas, Tags, Revisar).
import * as S from './store.js';
import { h, clear, btn, icon, toast, modal, confirmBox, fold, fmtDate } from './util.js';
import { recordVoiceNote, playAudio } from './audio.js';
import { storeImage, fileUrl, clipboardImage, pickImageFile } from './notebook.js';

export const imgId = name => String(name).split('.')[0];
export async function imageName(blob) {
  const im = await storeImage(blob);
  return im.fileId + (/jpe?g/.test(im.type) ? '.jpg' : '.png');
}

// imagens do trecho (equação, figura): colar, escolher arquivo, remover
export function imagesEditor(images, onchange) {
  const box = h('div.imged');
  const grid = h('div.imgs');
  const add = async blob => {
    if (!blob) return;
    try { images.push(await imageName(blob)); onchange(images); render(); } catch (e) { toast(e.message); }
  };
  const render = () => {
    clear(grid);
    images.forEach((n, i) => {
      const img = h('img', { alt: 'Imagem ' + (i + 1) });
      fileUrl(imgId(n)).then(u => { img.src = u; });
      grid.appendChild(h('div.imgth', img, h('button', { type: 'button', 'aria-label': 'Remover imagem', onclick: () => { images.splice(i, 1); onchange(images); render(); } }, '×')));
    });
  };
  box.append(grid, h('div.btnrow',
    h('button.sbtn.small', { type: 'button', onclick: async () => { const b = await clipboardImage(); if (b) add(b); else toast('Nenhuma imagem na área de transferência (ou sem permissão). No PC, Ctrl+V também cola.', 5000); } }, icon('copy', 16), 'Colar imagem'),
    h('button.sbtn.small', { type: 'button', onclick: async () => add(await pickImageFile()) }, icon('image', 16), 'Escolher arquivo')));
  // Ctrl+V / colar enquanto o editor estiver na tela
  const onPaste = e => {
    if (!box.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(x => x.type.startsWith('image/'));
    if (it) { e.preventDefault(); add(it.getAsFile()); }
  };
  document.addEventListener('paste', onPaste);
  render();
  return box;
}

// editor de área hierárquica + tags + nota, reaproveitado no painel e no detalhe
function areaEditor(st, area, onchange) {
  const box = h('div.areaed');
  const render = () => {
    clear(box);
    const crumbs = h('div.crumbs');
    if (!area.length) crumbs.appendChild(h('span.muted', 'Sem área'));
    area.forEach((a, i) => {
      if (i) crumbs.appendChild(icon('fwd', 14));
      crumbs.appendChild(h('span.crumb' + (i === area.length - 1 ? '.last' : ''), a));
    });
    if (area.length) crumbs.appendChild(btn('close', '', () => { area.pop(); onchange(area); render(); }, { iconOnly: true, title: 'Remover o último nível', cls: 'ibtn small' }));
    box.appendChild(crumbs);
    const kids = dgAreaChildren(st, area);
    if (kids.length) box.appendChild(h('div.chips', kids.map(k => h('button.chip', { type: 'button', onclick: () => { area.push(k.name); onchange(area); render(); } }, k.name + ' (' + k.count + ')'))));
    const inp = h('input', { type: 'text', placeholder: area.length ? 'Nova subárea de ' + area[area.length - 1] : 'Nova área (nível 1), ex.: Física' });
    const add = () => { const v = inp.value.trim(); if (!v) return; area.push(...dgNormArea([v])); onchange(area); render(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    box.appendChild(h('div.inrow', inp, h('button.sbtn', { type: 'button', onclick: add }, '+ Adicionar')));
  };
  render();
  return box;
}

function tagEditor(st, tags, onchange) {
  const box = h('div.taged');
  const render = () => {
    clear(box);
    box.appendChild(h('div.chips', tags.map((t, i) => h('span.tagchip', '#' + t, h('button', { type: 'button', 'aria-label': 'Remover ' + t, onclick: () => { tags.splice(i, 1); onchange(tags); render(); } }, '×')))));
    const inp = h('input', { type: 'text', placeholder: 'Nova tag (Enter para adicionar)' });
    const add = () => { for (const t of dgParseTags(inp.value)) if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) tags.push(t); inp.value = ''; onchange(tags); render(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    box.appendChild(h('div.inrow', inp, h('button.sbtn', { type: 'button', onclick: add }, '+ Tag')));
    const sug = dgTagCounts(st).filter(t => !tags.some(x => x.toLowerCase() === t.tag.toLowerCase())).slice(0, 12);
    if (sug.length) box.appendChild(h('div.chips.sug', sug.map(t => h('button.chip', { type: 'button', onclick: () => { tags.push(t.tag); onchange(tags); render(); } }, '#' + t.tag))));
  };
  render();
  return box;
}

export async function digestPanel(host, d, cb) {
  const st = await S.digest();
  clear(host);
  const note = h('textarea', { rows: 4, placeholder: 'Sua nota sobre o trecho…' }); note.value = d.note || '';
  const audioRow = h('div.audiorow');
  const renderAudio = () => {
    clear(audioRow);
    if (d.audio) audioRow.append(btn('play', 'Ouvir', () => playAudio(d.audio, 0, 'Nota de voz'), { cls: 'sbtn' }), btn('trash', 'Remover', () => { d.audio = ''; renderAudio(); }, { cls: 'sbtn' }));
    else audioRow.append(btn('mic', 'Gravar nota de voz', async () => { const r = await recordVoiceNote(); if (r) { d.audio = r.audioId; renderAudio(); } }, { cls: 'sbtn' }));
  };
  renderAudio();
  host.append(
    h('div.rp-head', h('h2', 'Novo trecho no Digest'), btn('close', '', () => cb.onClose(), { iconOnly: true, title: 'Fechar' })),
    h('div.rp-body',
      h('div.quotebox', d.quote ? h('div.qtext', '“' + d.quote + '”') : null, h('div.muted', d.name + ' · ' + (dgPages(d) || 'página em branco'))),
      h('div.flabel', 'IMAGENS (EQUAÇÃO, FIGURA)'), imagesEditor(d.images = d.images || [], im => { d.images = im; }),
      h('button.dashed', { type: 'button', onclick: () => { d.note = note.value; cb.onContinue(d); } }, icon('plus', 16), 'Continuação (outra página ou coluna)'),
      h('div.flabel', 'ÁREA'), areaEditor(st, d.area, a => { d.area = a; }),
      h('div.flabel', 'TAGS'), tagEditor(st, d.tags, t => { d.tags = t; }),
      h('div.flabel', 'NOTA'), note, audioRow),
    h('div.rp-foot', h('button.sbtn', { type: 'button', onclick: () => cb.onClose() }, 'Cancelar'),
      h('button.pbtn', { type: 'button', onclick: async () => {
        const cur = await S.digest();
        const r = dgAdd(cur, { doc: d.doc, name: d.name, page: d.page, pageEnd: d.pageEnd, pageKey: d.pageKey, pageKeyEnd: d.pageKeyEnd, quote: d.quote, note: note.value, tags: d.tags, area: d.area, audio: d.audio, images: d.images || [] }, Date.now());
        if (!r.item) { toast('Trecho vazio.'); return; }
        await S.saveDigest(r.store);
        cb.onSaved(r.item);
      } }, 'Salvar no Digest')));
}

// ---------- tela do Digest ----------
export class DigestScreen {
  constructor(app) {
    this.app = app;
    this.root = h('div.screen.digest');
    this.tab = 'recentes'; this.q = ''; this.areaPath = []; this.tagSel = []; this.source = ''; this.project = '';
    S.on('digest', () => { if (this.root.isConnected) this.render(); });
  }

  async show(openId) {
    await this.render();
    if (openId) { const st = await S.digest(); const it = dgFind(st, openId); if (it) this.detail(it); }
  }

  async render() {
    const all = await S.digest();
    // filtro por projeto: trechos cujo documento de origem está no projeto escolhido
    const projs = await S.projects();
    if (this.project && !projs.some(p => p.id === this.project)) this.project = '';
    let st = all;
    if (this.project) {
      const inProj = new Set((await S.allDocs()).filter(d => (d.projects || []).includes(this.project)).map(d => d.id));
      st = Object.assign({}, all, { items: all.items.filter(it => inProj.has(it.src.doc)) });
    }
    const psel = h('select.projsel', { 'aria-label': 'Filtrar por projeto', onchange: () => { this.project = psel.value; this.source = ''; this.areaPath = []; this.tagSel = []; this.render(); } },
      h('option', { value: '' }, 'Todos os projetos'), projs.map(p => h('option', { value: p.id }, p.name)));
    psel.value = this.project;
    clear(this.root);
    const tabs = [['recentes', 'Recentes'], ['fontes', 'Fontes'], ['areas', 'Áreas'], ['tags', 'Tags'], ['revisar', 'Revisar']];
    const search = h('input', { type: 'search', placeholder: 'Buscar no Digest…', value: this.q });
    search.addEventListener('input', () => { this.q = search.value; this.renderList(st, list); });
    const list = h('div.dlist');
    this.root.append(
      h('header.top', btn('back', '', () => this.app.showLibrary(), { iconOnly: true, title: 'Voltar' }), h('h1', 'Digest'), h('span.muted', st.items.length + ' trechos'), h('div.grow'), h('label.projpick', icon('folder', 18), psel), search,
        btn('share', 'Obsidian', () => this.app.exportObsidianAll(), { cls: 'sbtn' })),
      h('div.tabsrow', { role: 'tablist' }, tabs.map(([id, l]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => { this.tab = id; this.render(); } }, l))),
      h('div.dbody', this.side(st), list));
    this.renderList(st, list);
  }

  side(st) {
    const s = h('nav.dside');
    if (this.tab === 'fontes') {
      for (const src of dgSources(st)) s.appendChild(h('button.srow', { type: 'button', 'aria-pressed': String(this.source === src.key), onclick: () => { this.source = this.source === src.key ? '' : src.key; this.render(); } }, h('span.grow.clamp', src.name), h('span.muted', String(src.count))));
    } else if (this.tab === 'areas') {
      const crumbs = h('div.crumbs', h('button.crumb', { type: 'button', onclick: () => { this.areaPath = []; this.render(); } }, 'Todas'));
      this.areaPath.forEach((a, i) => crumbs.append(icon('fwd', 14), h('button.crumb', { type: 'button', onclick: () => { this.areaPath = this.areaPath.slice(0, i + 1); this.render(); } }, a)));
      s.appendChild(crumbs);
      for (const k of dgAreaChildren(st, this.areaPath)) s.appendChild(h('button.srow', { type: 'button', onclick: () => { this.areaPath = this.areaPath.concat([k.name]); this.render(); } }, h('span.grow', k.name), h('span.muted', String(k.count)), k.deeper ? icon('fwd', 14) : null));
      if (!this.areaPath.length) { const n = dgFilter(st, { noArea: true }).length; if (n) s.appendChild(h('div.muted.pad', n + ' trecho(s) sem área')); }
    } else if (this.tab === 'tags') {
      for (const t of dgTagCounts(st)) s.appendChild(h('button.srow', { type: 'button', 'aria-pressed': String(this.tagSel.includes(t.tag)), onclick: () => { this.tagSel = this.tagSel.includes(t.tag) ? this.tagSel.filter(x => x !== t.tag) : this.tagSel.concat([t.tag]); this.render(); } }, h('span.grow', '#' + t.tag), h('span.muted', String(t.count))));
      if (!dgTagCounts(st).length) s.appendChild(h('p.muted.pad', 'Nenhuma tag ainda.'));
    } else return h('span');
    return s;
  }

  async renderList(st, list) {
    clear(list);
    if (this.tab === 'revisar') return this.review(st, list);
    const f = { text: this.q };
    if (this.tab === 'fontes' && this.source) f.source = this.source;
    if (this.tab === 'areas' && this.areaPath.length) f.area = this.areaPath;
    if (this.tab === 'tags' && this.tagSel.length) f.tags = this.tagSel;
    const items = dgFilter(st, f, this.tab === 'fontes' && this.source ? 'pagina' : 'recentes');
    if (!items.length) list.appendChild(h('p.muted.pad', st.items.length ? 'Nenhum trecho com esse filtro.' : 'O Digest está vazio. No leitor, selecione um trecho e toque em “Digest”.'));
    for (const it of items.slice(0, 400)) list.appendChild(this.card(it));
  }

  card(it, big) {
    return h('article.dcard' + (big ? '.big' : ''), { onclick: e => { if (!e.target.closest('button')) this.detail(it); } },
      it.quote ? h('div.qtext', '“' + it.quote + '”') : null,
      (it.images && it.images.length) ? h('div.imgs.small', it.images.map(n => { const img = h('img', { alt: '' }); fileUrl(imgId(n)).then(u => { img.src = u; }); return img; })) : null,
      h('div.dmeta', h('span', it.src.name), it.page ? h('span', '· ' + dgPages(it)) : null, it.area.length ? h('span.area', dgAreaText(it.area)) : null, h('div.grow'), it.tags.map(t => h('span.tagchip', '#' + t))),
      it.note ? h('div.dnote', it.note) : null,
      it.audio ? h('button.sbtn.small', { type: 'button', onclick: () => playAudio(it.audio, 0, 'Nota de voz') }, icon('play', 14), 'Nota de voz') : null);
  }

  async review(st, list) {
    if (!st.items.length) { list.appendChild(h('p.muted.pad', 'Nada para revisar ainda.')); return; }
    const reviews = await (await import('./db.js')).db.kvGet('reviews', {});
    const now = Date.now();
    // prioriza trechos antigos e pouco revisados
    const scored = st.items.map(it => {
      const r = reviews[it.id] || { n: 0, last: 0 };
      const age = (now - (r.last || Date.parse(it.created) || now)) / 864e5;
      return { it, w: (age + 1) / (r.n + 1) * (0.6 + Math.random() * 0.8) };
    }).sort((a, b) => b.w - a.w);
    const it = scored[0].it;
    const r = reviews[it.id] || { n: 0, last: 0 };
    list.append(h('p.muted.pad', 'Releia o trecho e tente lembrar o contexto. Revisado ' + r.n + ' vez(es)' + (r.last ? ', última em ' + fmtDate(r.last) : '') + '.'), this.card(it, true),
      h('div.btnrow',
        h('button.sbtn', { type: 'button', onclick: () => this.app.openAt(it.src.doc, it.pageKey || ('p' + it.page)) }, 'Abrir no PDF'),
        h('button.sbtn', { type: 'button', onclick: () => this.renderList(st, list) }, 'Outro'),
        h('button.pbtn', { type: 'button', onclick: async () => { reviews[it.id] = { n: r.n + 1, last: Date.now() }; await (await import('./db.js')).db.kvSet('reviews', reviews); toast('Marcado como revisado.'); this.renderList(st, list); } }, 'Revisado ✓')));
  }

  async detail(it) {
    const st = await S.digest();
    const d = JSON.parse(JSON.stringify(it));
    const note = h('textarea', { rows: 4 }); note.value = d.note;
    const audioRow = h('div.audiorow');
    const renderAudio = () => {
      clear(audioRow);
      if (d.audio) audioRow.append(btn('play', 'Ouvir', () => playAudio(d.audio, 0, 'Nota de voz'), { cls: 'sbtn' }), btn('trash', 'Remover', () => { d.audio = ''; renderAudio(); }, { cls: 'sbtn' }));
      else audioRow.append(btn('mic', 'Gravar nota de voz', async () => { const r = await recordVoiceNote(); if (r) { d.audio = r.audioId; renderAudio(); } }, { cls: 'sbtn' }));
    };
    renderAudio();
    modal('Trecho do Digest', h('div',
      d.quote ? h('blockquote.q', d.quote) : null, h('p.muted', d.src.name + ' · ' + (dgPages(d) || '') + ' · ' + dgDate(d.created)),
      h('div.flabel', 'IMAGENS'), imagesEditor(d.images = d.images || [], im => { d.images = im; }),
      h('div.flabel', 'ÁREA'), areaEditor(st, d.area, a => { d.area = a; }),
      h('div.flabel', 'TAGS'), tagEditor(st, d.tags, t => { d.tags = t; }),
      h('div.flabel', 'NOTA'), note, audioRow), [
      { label: 'Apagar', danger: true, onclick: async c => { if (await confirmBox('Apagar trecho', 'Apagar este trecho do Digest?', 'Apagar', true)) { c(); await S.saveDigest(dgDelete(await S.digest(), it.id)); } } },
      { label: 'Abrir no PDF', onclick: c => { c(); this.app.openAt(it.src.doc, it.pageKey || ('p' + it.page)); } },
      { label: 'Salvar', primary: true, onclick: async c => { c(); const r = dgUpdate(await S.digest(), it.id, { note: note.value, tags: d.tags, area: d.area, audio: d.audio, images: d.images }, Date.now()); await S.saveDigest(r.store); toast('Salvo.'); } },
    ], { wide: true, focus: false });
  }
}

export { fold };
