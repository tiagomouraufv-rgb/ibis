// Notas feitas em outros programas (Adobe Acrobat/Reader, Foxit, Edge, Xodo…): converte para anotações
// do app, que ficam editáveis aqui, e tira as originais do PDF guardado para não aparecerem duas vezes.
//   Destaque / Sublinhado / Tachado / Ondulado (com ou sem comentário) -> destaque do app (+ nota)
//   Nota adesiva (ícone "Text")                                         -> nota do app
//   Respostas a um comentário                                           -> juntadas na nota
//   Desenho à mão (Ink)                                                 -> traço do app
// Caixas de texto, carimbos, formas e anexos ficam como estão (aparecem desenhados na página).
import { PDFDocument, PDFName, PDFRef, PDFDict } from '../vendor/pdf-lib.esm.min.js';
import { pdfjs, PDF_OPTS } from './pdfdoc.js';

const MARKUP = { Highlight: 'highlight', Underline: 'underline', Squiggly: 'underline', StrikeOut: 'strike' };
const MY_AUTHOR = 'Leitor de Pesquisa';

const hex = c => c && c.length >= 3 ? '#' + [0, 1, 2].map(i => Math.round(c[i]).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
const refKey = (num, gen) => gen ? `${num}R${gen}` : `${num}R`;
const str = o => (o && typeof o === 'object' ? o.str : o) || '';
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// pdf.js 4: lista plana [x1,y1,…,x4,y4] por quadrilátero; versões antigas: [[{x,y}×4],…]
function quads(q) {
  if (!q || !q.length) return [];
  if (typeof q[0] === 'number') { const out = []; for (let i = 0; i + 7 < q.length; i += 8) out.push([[q[i], q[i + 1]], [q[i + 2], q[i + 3]], [q[i + 4], q[i + 5]], [q[i + 6], q[i + 7]]]); return out; }
  return q.map(pts => pts.map(p => [p.x, p.y]));
}
function inkLines(l) {
  return (l || []).map(line => {
    if (!line || !line.length) return [];
    if (typeof line[0] === 'number') { const out = []; for (let i = 0; i + 1 < line.length; i += 2) out.push([line[i], line[i + 1]]); return out; }
    return line.map(p => [p.x, p.y]);
  }).filter(l => l.length);
}

// texto da página que fica debaixo dos retângulos (para o destaque ter o trecho, como no app)
function textUnder(items, vp, rects) {
  const out = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tr = it.transform, fs = Math.hypot(tr[2], tr[3]) || it.height || 8;
    const n = it.str.length || 1, cw = (it.width || 0) / n;
    // por letra, para pegar só o pedaço destacado de uma linha
    let piece = '';
    for (let k = 0; k < n; k++) {
      const [x, y] = vp.convertToViewportPoint(tr[4] + cw * (k + 0.5), tr[5] + fs * 0.3);
      if (rects.some(r => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])) piece += it.str[k];
      else if (piece) { out.push(piece); piece = ''; }
    }
    if (piece) out.push(piece);
  }
  return out.join(' ').replace(/\s+/g, ' ').replace(/- (\p{Ll})/gu, '$1').trim();
}

/**
 * Lê as notas de outros programas.
 * Retorna { annots: [anotação do app sem docId], bytes: PDF sem essas notas, count } ou null se não houver.
 */
export async function extractForeign(bytes) {
  let pdf;
  try { pdf = await pdfjs.getDocument(Object.assign({ data: bytes.slice() }, PDF_OPTS)).promise; } catch (e) { return null; }
  const out = [], remove = new Set();
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n);
      const vp = pg.getViewport({ scale: 1 });
      let list;
      try { list = await pg.getAnnotations({ intent: 'display' }); } catch (e) { continue; }
      if (!list.length) continue;
      const byId = new Map(list.map(a => [a.id, a]));
      const conv = (x, y) => vp.convertToViewportPoint(x, y);
      let items = null;
      const made = new Map();   // id da nota no PDF -> anotação do app (para juntar respostas)
      for (const a of list) {
        if (!a.id || a.inReplyTo) continue;
        const author = str(a.titleObj) || a.title || '';
        if (author === MY_AUTHOR) continue;
        const contents = str(a.contentsObj) || a.contents || '';
        const created = a.creationDate || a.modificationDate;
        const t = PDFDateMs(created);
        const sub = a.subtype;
        let ap = null;
        if (MARKUP[sub]) {
          let qs = quads(a.quadPoints);
          if (!qs.length && a.rect) { const r = a.rect; qs = [[[r[0], r[3]], [r[2], r[3]], [r[0], r[1]], [r[2], r[1]]]]; }
          const rects = qs.map(q => {
            const pts = q.map(p => conv(p[0], p[1]));
            const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
            const x = Math.min(...xs), y = Math.min(...ys);
            return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
          }).filter(r => r[2] > 0.5 && r[3] > 0.5);
          if (!rects.length) continue;
          if (!items) { try { items = (await pg.getTextContent()).items; } catch (e) { items = []; } }
          const text = textUnder(items, vp, rects);
          // o Acrobat às vezes copia o próprio trecho para o comentário: aí não é nota
          const note = contents && norm(contents) !== norm(text) ? contents : '';
          ap = { kind: 'hl', pageKey: 'p' + n, rects, text: text || '(trecho destacado)', note, cat: '', style: MARKUP[sub], color: hex(a.color) || undefined };
        } else if (sub === 'Text') {
          const r = a.rect || [0, 0, 0, 0];
          const [x, y] = conv(r[0], r[3]);
          ap = { kind: 'note', pageKey: 'p' + n, x: Math.max(0, x), y: Math.max(0, y), text: contents };
        } else if (sub === 'Ink') {
          const lines = inkLines(a.inkLists);
          if (!lines.length) continue;
          const w = (a.borderStyle && a.borderStyle.width) || 1;
          const marker = a.opacity != null && a.opacity < 0.8;
          // um traço do app por linha; agrupados pelo mesmo id de origem
          for (const l of lines) {
            const pts = l.map(p => { const q = conv(p[0], p[1]); return [q[0], q[1], 0.5]; });
            out.push({ kind: 'ink', tool: marker ? 'marker' : 'pen', pageKey: 'p' + n, color: hex(a.color) || '#16191D', width: marker ? Math.max(4, w) : w, pts, from: 'adobe', created: t || undefined });
          }
          remove.add(a.id);
          continue;
        } else continue;
        if (author) ap.author = author;
        ap.from = 'adobe';
        if (t) ap.created = t;
        made.set(a.id, ap);
        out.push(ap);
        remove.add(a.id);
      }
      // respostas (e respostas de respostas), na ordem da página
      for (const a of list) {
        if (!a.inReplyTo) continue;
        let root = a.inReplyTo, guard = 0;
        while (byId.get(root) && byId.get(root).inReplyTo && guard++ < 20) root = byId.get(root).inReplyTo;
        const ap = made.get(root);
        if (!ap) continue;
        const who = str(a.titleObj) || a.title || '';
        const txt = str(a.contentsObj) || a.contents || '';
        if (!txt) { remove.add(a.id); continue; }
        const line = (who ? who + ': ' : '↳ ') + txt;
        if (ap.kind === 'note') ap.text = (ap.text ? ap.text + '\n\n' : '') + line;
        else ap.note = (ap.note ? ap.note + '\n\n' : '') + line;
        remove.add(a.id);
      }
      // quem escreveu (se não for você mesmo) fica no começo da nota
      for (const ap of made.values()) {
        if (!ap.author) continue;
        if (ap.kind === 'note' && ap.text) ap.text = ap.author + ': ' + ap.text;
        if (ap.kind === 'hl' && ap.note) ap.note = ap.author + ': ' + ap.note;
      }
    }
  } finally { try { await pdf.destroy(); } catch (e) {} }
  if (!out.length) return null;

  // tira as notas convertidas (e os balões "Popup" delas) do PDF
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  for (const pg of doc.getPages()) {
    const arr = pg.node.Annots();
    if (!arr) continue;
    const keep = [];
    let changed = false;
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i);
      if (ref instanceof PDFRef) {
        if (remove.has(refKey(ref.objectNumber, ref.generationNumber))) { changed = true; continue; }
        const an = ctx.lookup(ref);
        if (an instanceof PDFDict) {
          const st = an.get(PDFName.of('Subtype'));
          const par = an.get(PDFName.of('Parent'));
          if (st === PDFName.of('Popup') && par instanceof PDFRef && remove.has(refKey(par.objectNumber, par.generationNumber))) { changed = true; continue; }
        }
      }
      keep.push(ref);
    }
    if (changed) pg.node.set(PDFName.of('Annots'), ctx.obj(keep));
  }
  const clean = await doc.save({ useObjectStreams: true });
  return { annots: out, bytes: clean, count: out.length };
}

function PDFDateMs(d) {
  if (!d) return 0;
  const m = /D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(d));
  if (!m) return 0;
  const t = new Date(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0).getTime();
  return isFinite(t) ? t : 0;
}
