// Enviar ao reMarkable: um PDF para o leitor nativo do reMarkable 2.
// - PDF: destaques, sublinhados, escrita e figuras vão desenhados na página; destaque com nota sai
//   destacado E sublinhado; links internos continuam clicáveis.
// - Texto: o Markdown vira PDF (com camada de texto invisível, para dar para selecionar e destacar lá).
// - As notas digitadas e o Digest deste documento vão num pacote escondido dentro do PDF. No reMarkable, o
//   RM2 Notas (0.9+) lê o pacote ao abrir o documento: notas de destaque vão para a margem, notas adesivas
//   ficam no mesmo ponto, e os trechos vão para o RM2 Digest (0.3+).
// O PDF é entregue pelo menu de compartilhar: escolha o app do reMarkable.
import * as S from './store.js';
import { toast, shareFile, downloadBlob, safeName, modal, h } from './util.js';

export function canSendToRemarkable(doc) {
  return !!doc && (!doc.kind || doc.kind === 'text');
}

export async function buildRemarkablePdf(doc) {
  const out = {};
  let bytes;
  if (doc.kind === 'text') {
    const { textPdf } = await import('./textdoc.js');
    bytes = await textPdf(doc, { rm: true, rmOut: out });
  } else {
    const { exportPdf } = await import('./export.js');
    bytes = await exportPdf(doc, { mode: 'flat', hl: true, ink: true, notes: false, audio: false, links: true, rm: true, rmOut: out });
  }
  return { bytes, name: safeName(S.docTitle(doc)) + '.pdf', notes: out.notes || 0, digest: out.digest || 0 };
}

// Gera o PDF e mostra as duas saídas: compartilhar (app do reMarkable no Android) ou salvar o arquivo
// (para mandar pelo app do reMarkable no computador). As duas levam as notas e o Digest escondidos.
export async function sendToRemarkable(doc) {
  if (!canSendToRemarkable(doc)) { toast('Cadernos não vão para o reMarkable (só PDFs e textos).'); return; }
  toast('Preparando o PDF para o reMarkable…', 20000);
  let r;
  try { r = await buildRemarkablePdf(doc); }
  catch (e) { console.error(e); toast('Não consegui gerar o PDF: ' + e.message, 6000); return; }
  toast('', 1);
  const what = [r.notes ? r.notes + ' nota(s)' : '', r.digest ? r.digest + ' trecho(s) do Digest' : ''].filter(Boolean).join(' e ');
  const blob = new Blob([r.bytes], { type: 'application/pdf' });
  modal('Enviar ao reMarkable', h('div',
    h('p', h('b', r.name)),
    h('p', what ? 'Vão escondidos no PDF: ' + what + '. No reMarkable, o RM2 Notas 0.9 os coloca no documento ao abri-lo.' : 'Este documento não tem notas digitadas nem trechos no Digest; vão só os destaques e a escrita, desenhados.'),
    h('p.muted', 'Use um destes dois botões (não o “Exportar PDF anotado”, que não leva as notas). Para mandar pelo computador: “Salvar o PDF” e depois arraste o arquivo para o app do reMarkable.')), [
    { label: 'Salvar o PDF', onclick: async c => { c(); await downloadBlob(blob, r.name); toast('PDF salvo: ' + r.name + '. Envie pelo app do reMarkable.', 6000); } },
    { label: 'Compartilhar…', primary: true, onclick: async c => { c(); const ok = await shareFile(blob, r.name, 'application/pdf'); if (!ok) { await downloadBlob(blob, r.name); toast('O compartilhar não abriu; o PDF foi salvo: ' + r.name, 6000); } } },
  ]);
}
