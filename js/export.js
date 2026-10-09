// Exporta o PDF com as anotações (editável = anotações padrão de PDF; achatado = desenhado na página)
// e reimporta um PDF exportado pelo app, devolvendo tudo editável.
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } from '../vendor/pdf-lib.esm.min.js';
import { openPdf, getPage, pageList, pdfjs, embeddedData, pageLabel } from './pdfdoc.js';
import * as S from './store.js';
import { catInfo, uid } from './util.js';
import { strokeWidth } from './viewer.js';
import { audioExt } from './audio.js';

const DATA_NAME = 'leitor-dados.json';
const NM = 'leitor:';

function rgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function f(v) { return (Math.round(v * 100) / 100).toString(); }
function pdfDate(ms) {
  const d = new Date(ms); const p = n => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// conversão de coordenadas (tela, escala 1, origem no topo) -> espaço do PDF
async function makeConverter(hd, p) {
  if (p.kind === 'blank') return (x, y) => [x, p.h - y];
  const pg = await getPage(hd, p.n);
  const vp = pg.getViewport({ scale: 1 });
  return (x, y) => vp.convertToPdfPoint(x, y);
}

function bounds(pts, pad = 0) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/**
 * opts: { mode: 'editable'|'flat', hl, ink, notes, audio, links }
 * retorna Uint8Array
 */
export async function exportPdf(doc, opts) {
  const hd = await openPdf(doc);
  const list = pageList(doc, hd);
  const anns = (await S.annots(doc.id)).slice();
  const fileBlob = await S.audioBlob(doc.fileId);
  if (!fileBlob) throw new Error('Arquivo do PDF não encontrado no aparelho.');
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = pdfDoc.context;

  // 1) páginas em branco inseridas
  let idx = 0;
  const pageOf = new Map();
  for (const p of list) {
    if (p.kind === 'blank') pdfDoc.insertPage(idx, [p.w, p.h]);
    pageOf.set(p.key, idx);
    idx++;
  }
  const pages = pdfDoc.getPages();

  // 2) margens expandidas (só páginas sem rotação)
  const origBoxes = {};
  for (const p of list) {
    if (!doc.margins || !doc.margins[p.key]) continue;
    const pg = pages[pageOf.get(p.key)];
    if (pg.getRotation().angle % 360 !== 0) continue;
    const mb = pg.getMediaBox();
    origBoxes[p.key] = [mb.x, mb.y, mb.width, mb.height];
    const extra = p.w * 0.5;
    pg.setMediaBox(mb.x, mb.y, mb.width + extra, mb.height);
    const cb = pg.getCropBox();
    pg.setCropBox(cb.x, cb.y, cb.width + extra, cb.height);
    const tb = pg.getTrimBox(); pg.setTrimBox(tb.x, tb.y, tb.width + extra, tb.height);
    const bb = pg.getBleedBox(); pg.setBleedBox(bb.x, bb.y, bb.width + extra, bb.height);
    // linha separando a margem
    const sep = `q 0.75 0.78 0.82 RG 0.6 w ${f(mb.x + mb.width)} ${f(mb.y)} m ${f(mb.x + mb.width)} ${f(mb.y + mb.height)} l S Q`;
    addFlatOps(pdfDoc, pg, sep, {});
  }

  const flat = opts.mode === 'flat';
  const author = PDFHexString.fromText('Leitor de Pesquisa');
  const audioNames = {};

  for (const p of list) {
    const pg = pages[pageOf.get(p.key)];
    const conv = await makeConverter(hd, p);
    const mine = anns.filter(a => a.pageKey === p.key);
    let flatOps = '';
    const gs = {};
    const gsName = (ca, bm) => { const k = 'G' + Math.round(ca * 100) + (bm ? 'M' : ''); gs[k] = { ca, CA: ca, BM: bm ? 'Multiply' : 'Normal' }; return k; };

    for (const a of mine) {
      if (a.kind === 'hl' && opts.hl) {
        const ci = catInfo(a.cat);
        const col = rgb(a.color || ci.color);
        const quads = a.rects.map(([x, y, w, hh]) => [conv(x, y), conv(x + w, y), conv(x, y + hh), conv(x + w, y + hh)]);
        let ops = '';
        if (a.style === 'underline' || a.style === 'strike') {
          const c = a.style === 'strike' ? rgb('#B4232C') : col.map(v => v * 0.55);
          ops += `${c.map(f).join(' ')} RG `;
          for (const [x, y, w, hh] of a.rects) {
            const yy = a.style === 'strike' ? y + hh * 0.55 : y + hh;
            const p1 = conv(x, yy), p2 = conv(x + w, yy);
            ops += `${f(Math.max(0.8, hh * 0.08))} w ${f(p1[0])} ${f(p1[1])} m ${f(p2[0])} ${f(p2[1])} l S `;
          }
        } else {
          const g = gsName(0.55, true);
          ops += `/${g} gs ${col.map(f).join(' ')} rg `;
          for (const q of quads) ops += `${f(q[0][0])} ${f(q[0][1])} m ${f(q[1][0])} ${f(q[1][1])} l ${f(q[3][0])} ${f(q[3][1])} l ${f(q[2][0])} ${f(q[2][1])} l h f `;
        }
        if (flat) flatOps += 'q ' + ops + 'Q\n';
        else {
          const all = quads.flat();
          const rect = bounds(all, 1);
          const sub = a.style === 'underline' ? 'Underline' : a.style === 'strike' ? 'StrikeOut' : 'Highlight';
          const contents = [a.cat ? '[' + ci.label + '] ' : '', a.note || '', a.note ? '' : (a.text || '')].join('').trim();
          const ap = formXObject(ctx, rect, ops, a.style ? {} : { [gsName(0.55, true)]: gs[gsName(0.55, true)] });
          const annot = ctx.obj({
            Type: 'Annot', Subtype: sub, Rect: rect, F: 4, C: a.style === 'strike' ? rgb('#B4232C') : col,
            QuadPoints: quads.flatMap(q => [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]]),
            AP: { N: ap },
          });
          annot.set(PDFName.of('Contents'), PDFHexString.fromText(contents));
          annot.set(PDFName.of('T'), author);
          annot.set(PDFName.of('NM'), PDFString.of(NM + a.id));
          annot.set(PDFName.of('M'), PDFString.of(pdfDate(a.updated || a.created)));
          if (a.cat) annot.set(PDFName.of('Subj'), PDFHexString.fromText(ci.label));
          pg.node.addAnnot(ctx.register(annot));
        }
        if (a.audioId && opts.audio) await addAudioAnnot(pdfDoc, pg, a, conv(Math.max(0, a.rects[0][0] - 14), a.rects[0][1]), audioNames);
      }
      if (a.kind === 'ink' && opts.ink) {
        const pts = a.pts.map(q => conv(q[0], q[1]));
        const w = strokeWidth(a);
        const col = rgb(a.color);
        const marker = a.tool === 'marker';
        let ops = '';
        if (marker) ops += `/${gsName(0.42, true)} gs `;
        ops += `${col.map(f).join(' ')} RG ${f(w)} w ${marker ? 0 : 1} J 1 j `;
        ops += `${f(pts[0][0])} ${f(pts[0][1])} m `;
        if (pts.length === 1) ops += `${f(pts[0][0] + 0.01)} ${f(pts[0][1])} l `;
        for (let i = 1; i < pts.length; i++) ops += `${f(pts[i][0])} ${f(pts[i][1])} l `;
        ops += 'S';
        if (flat) flatOps += 'q ' + ops + ' Q\n';
        else {
          const rect = bounds(pts, w);
          const ap = formXObject(ctx, rect, ops, marker ? { [gsName(0.42, true)]: gs[gsName(0.42, true)] } : {});
          const annot = ctx.obj({
            Type: 'Annot', Subtype: 'Ink', Rect: rect, F: 4, C: col, BS: { W: w }, InkList: [pts.flat()], AP: { N: ap },
          });
          if (marker) annot.set(PDFName.of('CA'), ctx.obj(0.42));
          annot.set(PDFName.of('T'), author);
          annot.set(PDFName.of('NM'), PDFString.of(NM + a.id));
          pg.node.addAnnot(ctx.register(annot));
        }
      }
      if (a.kind === 'note' && opts.notes) {
        const [X, Y] = conv(a.x, a.y);
        if (a.text) {
          const rect = [X - 9, Y - 9, X + 9, Y + 9];
          const icon = `0.11 0.35 0.54 rg ${f(X - 9)} ${f(Y - 9)} 18 18 re f 1 1 1 RG 1.2 w ${f(X - 5)} ${f(Y + 3)} m ${f(X + 5)} ${f(Y + 3)} l ${f(X - 5)} ${f(Y)} m ${f(X + 5)} ${f(Y)} l ${f(X - 5)} ${f(Y - 3)} m ${f(X + 2)} ${f(Y - 3)} l S`;
          const annot = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, F: 28, Name: 'Comment', Open: false, C: [0.11, 0.35, 0.54], AP: { N: formXObject(ctx, rect, icon, {}) } });
          annot.set(PDFName.of('Contents'), PDFHexString.fromText(a.text));
          annot.set(PDFName.of('T'), author);
          annot.set(PDFName.of('NM'), PDFString.of(NM + a.id));
          pg.node.addAnnot(ctx.register(annot));
        }
        if (a.audioId && opts.audio) await addAudioAnnot(pdfDoc, pg, a, a.text ? [X + 12, Y] : [X, Y], audioNames, true);
      }
      if (a.kind === 'link' && opts.links) {
        const t = a.target || {};
        const quads = a.rects.map(([x, y, w, hh]) => [conv(x, y), conv(x + w, y), conv(x, y + hh), conv(x + w, y + hh)]);
        const rect = bounds(quads.flat(), 0);
        let action = null;
        if (t.type === 'page' && t.docId === doc.id && pageOf.has(t.pageKey)) {
          const tp = list.find(q => q.key === t.pageKey);
          const tconv = await makeConverter(hd, tp);
          const top = tconv(0, t.y || 0)[1];
          action = ctx.obj({ S: 'GoTo', D: [pages[pageOf.get(t.pageKey)].ref, 'XYZ', null, top, null] });
        } else if (t.type === 'url') action = ctx.obj({ S: 'URI', URI: PDFString.of(t.url) });
        else if (t.type === 'obsidian' && t.uri) action = ctx.obj({ S: 'URI', URI: PDFString.of(t.uri) });
        if (action) {
          const annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4, A: action });
          annot.set(PDFName.of('NM'), PDFString.of(NM + a.id));
          pg.node.addAnnot(ctx.register(annot));
        } else {
          // link para outro PDF ou para o Digest: vira um comentário explicando o destino
          const [X, Y] = [rect[2], rect[3]];
          const r2 = [X, Y - 14, X + 14, Y];
          const annot = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: r2, F: 28, Name: 'Note', Open: false, C: [0.11, 0.35, 0.54] });
          annot.set(PDFName.of('Contents'), PDFHexString.fromText('Ligação: ' + (a.targetLabel || 'outro documento')));
          annot.set(PDFName.of('NM'), PDFString.of(NM + a.id));
          pg.node.addAnnot(ctx.register(annot));
        }
        // contorno azul discreto do link
        const ops = `0.11 0.35 0.54 RG 0.7 w [2 1.5] 0 d ` + quads.map(q => `${f(q[0][0])} ${f(q[0][1])} m ${f(q[1][0])} ${f(q[1][1])} l ${f(q[3][0])} ${f(q[3][1])} l ${f(q[2][0])} ${f(q[2][1])} l h S`).join(' ');
        flatOps += 'q ' + ops + ' Q\n';
      }
    }
    if (flatOps) addFlatOps(pdfDoc, pg, flatOps, gs);
  }

  // 3) dados escondidos para reabrir tudo editável no app (só no modo editável)
  if (!flat) {
    const dg = await S.digest();
    const data = {
      app: 'leitor-pesquisa', v: 1, exported: Date.now(),
      doc: { id: doc.id, name: doc.name, meta: doc.meta, bookmarks: doc.bookmarks, blanks: doc.blanks, margins: doc.margins, briefing: doc.briefing },
      pages: list.map(p => ({ key: p.key, kind: p.kind })), origBoxes,
      annots: anns.filter(a => (a.kind === 'hl' && opts.hl) || (a.kind === 'ink' && opts.ink) || (a.kind === 'note' && opts.notes) || (a.kind === 'link' && opts.links)),
      audioNames, digest: dg.items.filter(it => it.src.doc === doc.id),
    };
    await pdfDoc.attach(new TextEncoder().encode(JSON.stringify(data)), DATA_NAME, { mimeType: 'application/json', description: 'Anotações editáveis do Leitor de Pesquisa', creationDate: new Date(), modificationDate: new Date() });
  }
  return pdfDoc.save({ useObjectStreams: true });
}

function formXObject(ctx, rect, ops, extg) {
  const res = {};
  if (extg && Object.keys(extg).length) {
    res.ExtGState = {};
    for (const k in extg) res.ExtGState[k] = { Type: 'ExtGState', ca: extg[k].ca, CA: extg[k].CA, BM: extg[k].BM };
  }
  const st = ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: res });
  return ctx.register(st);
}

function addFlatOps(pdfDoc, pg, ops, gs) {
  const ctx = pdfDoc.context;
  const mb = pg.getMediaBox();
  const res = { ExtGState: {} };
  for (const k in gs) res.ExtGState[k] = { Type: 'ExtGState', ca: gs[k].ca, CA: gs[k].CA, BM: gs[k].BM };
  const xo = ctx.register(ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [mb.x - 2000, mb.y - 2000, mb.x + mb.width + 2000, mb.y + mb.height + 2000], Resources: res }));
  const name = pg.node.newXObject('Lt', xo);
  const start = ctx.register(ctx.stream('q\n'));
  const end = ctx.register(ctx.stream(`\nQ\nq /${name.asString().slice(1)} Do Q\n`));
  pg.node.normalize();
  pg.node.wrapContentStreams(start, end);
}

async function addAudioAnnot(pdfDoc, pg, a, at, names, isNote) {
  const blob = await S.audioBlob(a.audioId);
  if (!blob) return;
  const ctx = pdfDoc.context;
  const data = new Uint8Array(await blob.arrayBuffer());
  const fname = 'nota-de-voz-' + a.id + '.' + audioExt(blob.type);
  names[a.id] = fname;
  const ef = ctx.register(ctx.stream(data, { Type: 'EmbeddedFile', Subtype: blob.type.split(';')[0] || 'audio/webm', Params: { Size: data.length } }));
  const fs = ctx.obj({ Type: 'Filespec', EF: { F: ef, UF: ef } });
  fs.set(PDFName.of('F'), PDFString.of(fname));
  fs.set(PDFName.of('UF'), PDFHexString.fromText(fname));
  fs.set(PDFName.of('Desc'), PDFHexString.fromText('Nota de voz'));
  const [X, Y] = at;
  const rect = [X - 8, Y - 8, X + 8, Y + 8];
  const icon = `0.11 0.35 0.54 rg ${f(X - 8)} ${f(Y - 8)} 16 16 re f 1 1 1 rg ${f(X - 3)} ${f(Y - 4)} m ${f(X - 3)} ${f(Y + 4)} l ${f(X + 4)} ${f(Y)} l h f`;
  const annot = ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: rect, F: 28, Name: 'Paperclip', C: [0.11, 0.35, 0.54], FS: ctx.register(fs), AP: { N: formXObject(ctx, rect, icon, {}) } });
  annot.set(PDFName.of('Contents'), PDFHexString.fromText('Nota de voz' + (a.text && isNote ? ': ' + a.text : '') + ' (abra o anexo para ouvir)'));
  annot.set(PDFName.of('T'), PDFHexString.fromText('Leitor de Pesquisa'));
  annot.set(PDFName.of('NM'), PDFString.of(NM + 'au-' + a.id));
  pg.node.addAnnot(ctx.register(annot));
}

// ---------- importação ----------
// Recebe os bytes de um PDF. Se for um PDF exportado pelo app (modo editável), remove as anotações
// gravadas, as páginas em branco e as margens, e devolve os dados para recriar tudo editável.
export async function importPdfBytes(name, bytes) {
  let data = null;
  try {
    const tmp = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    data = await embeddedData({ pdf: tmp });
    await tmp.destroy();
  } catch (e) { /* PDF protegido ou com erro: importa como está */ }
  if (!data || data.app !== 'leitor-pesquisa') {
    return S.addDocFromBytes(name, bytes);
  }
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = pdfDoc.context;
  const audio = {};
  const pages = pdfDoc.getPages();
  for (const pg of pages) {
    const arr = pg.node.Annots();
    if (!arr) continue;
    const keep = [];
    for (let i = 0; i < arr.size(); i++) {
      const ref = arr.get(i);
      const an = ctx.lookup(ref);
      const nm = an && an.lookup && an.lookup(PDFName.of('NM'));
      const nms = nm ? (nm.decodeText ? nm.decodeText() : String(nm)) : '';
      if (nms.startsWith(NM)) {
        if (nms.startsWith(NM + 'au-')) {
          try {
            const fs = an.lookup(PDFName.of('FS'), PDFDict);
            const ef = fs.lookup(PDFName.of('EF'), PDFDict);
            const st = ef.lookup(PDFName.of('F'));
            let bytesA = st instanceof PDFRawStream ? st.getContents() : null;
            if (st instanceof PDFRawStream && st.dict.get(PDFName.of('Filter'))) bytesA = decodePDFRawStream(st).decode();
            const sub = st.dict.get(PDFName.of('Subtype'));
            audio[nms.slice((NM + 'au-').length)] = { bytes: bytesA, type: sub ? sub.decodeText ? sub.decodeText() : sub.asString().slice(1).replace('#2F', '/') : 'audio/webm' };
          } catch (e) { console.warn('áudio', e); }
        }
        continue;
      }
      keep.push(ref);
    }
    pg.node.set(PDFName.of('Annots'), ctx.obj(keep));
  }
  // margens
  (data.pages || []).forEach((p, i) => {
    const ob = data.origBoxes && data.origBoxes[p.key];
    if (ob && pages[i]) { pages[i].setMediaBox(...ob); pages[i].setCropBox(...ob); pages[i].setTrimBox(...ob); pages[i].setBleedBox(...ob); }
  });
  // páginas em branco (de trás para frente)
  for (let i = (data.pages || []).length - 1; i >= 0; i--) if (data.pages[i].kind === 'blank') pdfDoc.removePage(i);
  // tira o anexo de dados
  try {
    const names = pdfDoc.catalog.lookup(PDFName.of('Names'), PDFDict);
    const ef = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
    const arr = ef.lookup(PDFName.of('Names'), PDFArray);
    const out = [];
    for (let i = 0; i < arr.size(); i += 2) {
      const k = arr.lookup(i); const ks = k.decodeText ? k.decodeText() : String(k);
      if (ks !== DATA_NAME) out.push(arr.get(i), arr.get(i + 1));
    }
    ef.set(PDFName.of('Names'), ctx.obj(out));
  } catch (e) {}
  const clean = await pdfDoc.save({ useObjectStreams: true });
  const d = data.doc || {};
  const doc = await S.addDocFromBytes(name.replace(/ \(anotado\)/i, ''), clean, {
    name: d.name || name.replace(/\.pdf$/i, ''), meta: d.meta || {}, bookmarks: d.bookmarks || [], blanks: d.blanks || [], margins: d.margins || {}, briefing: d.briefing || '',
  });
  // recria as anotações com ids novos
  const idMap = {};
  for (const a of data.annots || []) {
    const na = JSON.parse(JSON.stringify(a));
    idMap[a.id] = na.id = uid('a');
    na.docId = doc.id;
    if (a.audioId) {
      const au = audio[a.id];
      na.audioId = au && au.bytes ? await S.saveAudio(new Blob([au.bytes], { type: au.type })) : undefined;
    }
    if (na.target && na.target.docId === d.id) na.target.docId = doc.id;
    await S.putAnnot(na, { noUndo: true });
  }
  // Digest: acrescenta os trechos que ainda não existem
  let st = await S.digest();
  for (const it of data.digest || []) {
    if (st.items.some(x => x.quote === it.quote && x.src.name === it.src.name)) continue;
    const r = dgAdd(st, { doc: doc.id, name: it.src.name, page: it.page, pageEnd: it.pageEnd, pageKey: it.pageKey, quote: it.quote, note: it.note, tags: it.tags, area: it.area }, Date.parse(it.created) || Date.now());
    st = r.store;
  }
  await S.saveDigest(st);
  doc.restored = (data.annots || []).length;
  return doc;
}

export function annotatedName(doc) {
  return (doc.name || 'documento').replace(/\.pdf$/i, '') + ' (anotado).pdf';
}

export { pageLabel };
