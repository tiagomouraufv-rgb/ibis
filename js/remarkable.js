// Enviar ao reMarkable: um PDF para o leitor nativo do reMarkable 2.
// - PDF: destaques, sublinhados, escrita e figuras vão desenhados na página; destaque com nota sai
//   destacado E sublinhado; links internos continuam clicáveis.
// - Texto: o Markdown vira PDF (com camada de texto invisível, para dar para selecionar e destacar lá).
// - As notas digitadas e o Digest deste documento vão num pacote escondido dentro do PDF. No reMarkable, o
//   RM2 Notas (0.9+) lê o pacote ao abrir o documento: notas de destaque vão para a margem, notas adesivas
//   ficam no mesmo ponto, e os trechos vão para o RM2 Digest (0.3+).
// O PDF é entregue pelo menu de compartilhar: escolha o app do reMarkable.
import * as S from './store.js';
import { toast, shareFile, downloadBlob, safeName } from './util.js';

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

export async function sendToRemarkable(doc) {
  if (!canSendToRemarkable(doc)) { toast('Cadernos não vão para o reMarkable (só PDFs e textos).'); return; }
  toast('Preparando o PDF para o reMarkable…', 20000);
  let r;
  try { r = await buildRemarkablePdf(doc); }
  catch (e) { console.error(e); toast('Não consegui gerar o PDF: ' + e.message, 6000); return; }
  const what = [r.notes ? r.notes + ' nota(s)' : '', r.digest ? r.digest + ' trecho(s) do Digest' : ''].filter(Boolean).join(' e ');
  const blob = new Blob([r.bytes], { type: 'application/pdf' });
  const ok = await shareFile(blob, r.name, 'application/pdf');
  if (!ok) await downloadBlob(blob, r.name);
  toast((ok ? 'Escolha o app do reMarkable. ' : 'PDF salvo: envie pelo app do reMarkable. ') + (what ? 'Vão junto ' + what + ' (precisa do RM2 Notas 0.9 no reMarkable).' : ''), 7000);
}
