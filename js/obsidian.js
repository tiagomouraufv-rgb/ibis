// Exportação para o Obsidian: uma nota por documento + o Digest (mesmo formato do RM2 Notas/Digest).
import { zipSync, strToU8 } from '../vendor/fflate.js';
import * as S from './store.js';
import { catInfo, CATS } from './util.js';
import { pageLabel, pageNum } from './pdfdoc.js';
import { abnt } from './ai.js';
import { audioExt } from './audio.js';

export function noteFileName(doc) { return dgSafeFileName(doc.name); }

function pageSortKey(doc, key) {
  if (!key) return 0;
  if (key[0] === 'p') return pageNum(key) * 10;
  const b = (doc.blanks || []).find(x => 'b' + x.id === key);
  return b ? b.after * 10 + 5 : 0;
}

function quoteLines(text) { return String(text || '').split('\n').map(l => '> ' + l).join('\n'); }

export async function docMarkdown(doc, opts = {}) {
  const st = await S.settings();
  const anns = (await S.annots(doc.id)).slice().sort((a, b) => (pageSortKey(doc, a.pageKey) - pageSortKey(doc, b.pageKey)) || ((a.rects ? a.rects[0][1] : a.y || 0) - (b.rects ? b.rects[0][1] : b.y || 0)));
  const docs = await S.allDocs();
  const projs = await S.projects();
  const dg = await S.digest();
  const m = doc.meta || {};
  const audioFiles = [];
  const lines = ['---'];
  lines.push('tags:', '  - leitura');
  if (m.title) lines.push('titulo: "' + m.title.replace(/"/g, "'") + '"');
  if (m.authors && m.authors.length) lines.push('autores:', ...m.authors.map(a => '  - "' + (a.given + ' ' + a.family).trim() + '"'));
  if (m.year) lines.push('ano: ' + m.year);
  if (m.journal) lines.push('revista: "' + m.journal + '"');
  if (m.doi) lines.push('doi: "' + m.doi + '"');
  const pn = (doc.projects || []).map(id => (projs.find(p => p.id === id) || {}).name).filter(Boolean);
  if (pn.length) lines.push('projetos:', ...pn.map(n => '  - "[[' + n + ']]"'));
  lines.push('arquivo: "' + (doc.fileName || doc.name) + '"');
  lines.push('---', '', '# ' + (m.title || doc.name), '');
  if (m.doi || m.title) lines.push('**Referência (ABNT):** ' + abnt(m), '');
  if (doc.briefing) lines.push('## Resumo das anotações (IA)', '', doc.briefing.trim(), '');

  const bms = (doc.bookmarks || []);
  if (bms.length) {
    lines.push('## Marcadores', '');
    bms.forEach(b => lines.push('- ' + pageLabel(b.key) + (b.label ? ' — ' + b.label : '')));
    lines.push('');
  }

  const hls = anns.filter(a => a.kind === 'hl');
  if (hls.length) {
    lines.push('## Destaques', '');
    for (const a of hls) {
      const ci = catInfo(a.cat);
      const head = '> [!' + ci.callout + '] ' + (a.cat ? ci.label + ' · ' : '') + pageLabel(a.pageKey) + (a.style === 'underline' ? ' · sublinhado' : a.style === 'strike' ? ' · tachado' : '');
      lines.push(head, quoteLines(a.text || ''));
      if (a.note) lines.push('>', quoteLines('**Nota:** ' + a.note));
      if (a.audioId) {
        const fn = await audioName(a);
        if (fn) { audioFiles.push({ id: a.audioId, name: fn }); lines.push('>', '> ![[' + fn + ']]'); }
      }
      lines.push('');
    }
  }
  const notes = anns.filter(a => a.kind === 'note');
  if (notes.length) {
    lines.push('## Notas', '');
    for (const a of notes) {
      lines.push('- **' + pageLabel(a.pageKey) + ':** ' + (a.text || '(nota de voz)').replace(/\n/g, ' '));
      if (a.audioId) { const fn = await audioName(a); if (fn) { audioFiles.push({ id: a.audioId, name: fn }); lines.push('  ![[' + fn + ']]'); } }
    }
    lines.push('');
  }
  const links = anns.filter(a => a.kind === 'link');
  const incoming = (await S.allAnnots()).filter(a => a.kind === 'link' && a.target && a.target.type === 'page' && a.target.docId === doc.id && a.docId !== doc.id);
  if (links.length || incoming.length) {
    lines.push('## Ligações', '');
    for (const a of links) {
      const t = a.target || {};
      let dest = a.targetLabel || '';
      if (t.type === 'page') { const td = docs.find(d => d.id === t.docId); dest = td && td.id !== doc.id ? '[[' + noteFileName(td) + ']] (' + pageLabel(t.pageKey) + ')' : pageLabel(t.pageKey) + ' deste documento'; }
      else if (t.type === 'url') dest = '[' + t.url + '](' + t.url + ')';
      else if (t.type === 'obsidian') dest = '[[' + t.file + ']]';
      else if (t.type === 'digest') dest = 'Digest: ' + (a.targetLabel || t.id);
      lines.push('- ' + pageLabel(a.pageKey) + (a.text ? ' “' + a.text.slice(0, 80) + '”' : '') + ' → ' + dest);
    }
    for (const a of incoming) {
      const sd = docs.find(d => d.id === a.docId);
      if (sd) lines.push('- ← [[' + noteFileName(sd) + ']] (' + pageLabel(a.pageKey) + ') aponta para ' + pageLabel(a.target.pageKey));
    }
    lines.push('');
  }
  const inkPages = [...new Set(anns.filter(a => a.kind === 'ink').map(a => a.pageKey))];
  if (inkPages.length) lines.push('## Escrita à mão', '', 'Há anotações à mão em: ' + inkPages.map(pageLabel).join(', ') + '. Veja o PDF anotado.', '');
  const items = dgFilter(dg, { source: doc.id }, 'pagina');
  if (items.length) {
    lines.push('## Digest', '');
    for (const it of items) lines.push(dgItemMd(it, false), '');
  }
  return { text: lines.join('\n'), audioFiles };
}

async function audioName(a) {
  const blob = await S.audioBlob(a.audioId);
  return blob ? 'voz-' + a.id + '.' + audioExt(blob.type) : '';
}

// Pacote .zip com tudo, para extrair dentro do cofre do Obsidian
export async function vaultZip(docIds) {
  const st = await S.settings();
  const folder = (st.obsidianFolder || 'Leituras').replace(/^\/+|\/+$/g, '');
  const files = {};
  const docs = (await S.allDocs()).filter(d => !docIds || docIds.includes(d.id));
  for (const d of docs) {
    const anns = await S.annots(d.id);
    if (!anns.length && !d.briefing && !(d.meta && d.meta.title)) continue;
    const { text, audioFiles } = await docMarkdown(d);
    files[folder + '/' + noteFileName(d) + '.md'] = strToU8(text);
    for (const af of audioFiles) {
      const b = await S.audioBlob(af.id);
      if (b) files[folder + '/Áudios/' + af.name] = new Uint8Array(await b.arrayBuffer());
    }
  }
  const dg = await S.digest();
  for (const f of dgObsidianFiles(dg, Date.now())) files['Digest/' + f.path] = strToU8(f.text);
  for (const it of dg.items) if (it.audio) {
    const b = await S.audioBlob(it.audio);
    if (b) files['Digest/Áudios/' + it.audio + '.' + audioExt(b.type)] = new Uint8Array(await b.arrayBuffer());
  }
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

// Envia uma nota direto ao app do Obsidian (precisa do nome do cofre em Configurações)
export async function sendNoteToObsidian(doc) {
  const st = await S.settings();
  const { text } = await docMarkdown(doc);
  const folder = (st.obsidianFolder || 'Leituras').replace(/^\/+|\/+$/g, '');
  const uri = 'obsidian://new?' + (st.obsidianVault ? 'vault=' + encodeURIComponent(st.obsidianVault) + '&' : '') + 'file=' + encodeURIComponent(folder + '/' + noteFileName(doc)) + '&content=' + encodeURIComponent(text) + '&overwrite=true';
  window.location.href = uri;
}

export function obsidianOpenUri(vault, file) {
  return 'obsidian://open?' + (vault ? 'vault=' + encodeURIComponent(vault) + '&' : '') + 'file=' + encodeURIComponent(file);
}

export { CATS };
