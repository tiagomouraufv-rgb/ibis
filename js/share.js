// Compartilhar um documento pelo menu do Android (ou do navegador): PDF anotado, caderno em PDF, texto em PDF ou Markdown.
import * as S from './store.js';
import { h, toast, modal, shareFile, downloadBlob, safeName } from './util.js';

async function build(doc, fmt) {
  if (doc.kind === 'notebook') { const NB = await import('./notebook.js'); return { blob: new Blob([await NB.notebookPdf(doc)], { type: 'application/pdf' }), name: safeName(S.docTitle(doc)) + '.pdf' }; }
  if (doc.kind === 'text') {
    const T = await import('./textdoc.js');
    if (fmt === 'md') return { blob: new Blob([doc.md || ''], { type: 'text/markdown' }), name: safeName(S.docTitle(doc)) + '.md' };
    return { blob: new Blob([await T.textPdf(doc)], { type: 'application/pdf' }), name: safeName(S.docTitle(doc)) + '.pdf' };
  }
  const E = await import('./export.js');
  const bytes = await E.exportPdf(doc, { mode: 'editable', hl: true, ink: true, notes: true, audio: true, links: true });
  return { blob: new Blob([bytes], { type: 'application/pdf' }), name: E.annotatedName(doc).replace(/\.pdf$/i, '') + '.pdf' };
}

export async function shareDoc(doc, fmt) {
  if (doc.kind === 'text' && !fmt) {
    const m = modal('Compartilhar “' + S.docTitle(doc) + '”', h('p.muted', 'Escolha o formato. O menu do Android abre em seguida (Drive, e-mail, WhatsApp, Obsidian…).'), [
      { label: 'Markdown (.md)', onclick: c => { c(); shareDoc(doc, 'md'); } },
      { label: 'PDF', primary: true, onclick: c => { c(); shareDoc(doc, 'pdf'); } },
    ]);
    void m; return;
  }
  toast('Preparando para compartilhar…', 8000);
  try {
    const r = await build(doc, fmt);
    const ok = await shareFile(r.blob, r.name, r.blob.type);
    if (!ok) { await downloadBlob(r.blob, r.name); toast('Este navegador não abre o menu de compartilhar; o arquivo foi salvo.'); }
  } catch (e) { console.error(e); toast('Não foi possível compartilhar: ' + e.message, 5000); }
}
