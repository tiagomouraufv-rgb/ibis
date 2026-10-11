// Trazer do reMarkable: o PDF que o reMarkable exporta (e-mail, app do computador) leva a escrita e os
// destaques feitos lá desenhados na página, como caminhos vetoriais acrescentados no fim de cada página
// (gerados pelo pdfium, com estados gráficos chamados /FXE…). Se o PDF tinha saído do app pelo
// "Enviar ao reMarkable", ele ainda guarda o pacote /LeitorRM com o código do documento original.
// Aqui: reconhecemos o documento, lemos só o que o reMarkable acrescentou e transformamos em anotações
// do app (traços de caneta editáveis e destaques com o texto de baixo), no documento original.
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from '../vendor/pdf-lib.esm.min.js';
import { openPdf, getPage, pageList } from './pdfdoc.js';
import * as S from './store.js';
import { uid } from './util.js';

const BEG = '%%LEITOR-RM-PKG-BEGIN%%', END = '%%LEITOR-RM-PKG-END%%';
const latin1 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
const streamText = st => { if (!(st instanceof PDFRawStream)) return ''; try { return latin1(st.dict.get(PDFName.of('Filter')) ? decodePDFRawStream(st).decode() : st.getContents()); } catch (e) { return ''; } };

// Este PDF veio do reMarkable e foi enviado por este app? Devolve { appDocId, name, pdfDoc } ou null.
export async function rmReturnInfo(bytes) {
  let pdfDoc;
  try { pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { return null; }
  const st = pdfDoc.catalog.lookup(PDFName.of('LeitorRM'));
  if (!st) return null;
  const t = streamText(st);
  const b = t.indexOf(BEG), e = t.lastIndexOf(END);
  if (b < 0 || e < b) return null;
  let pkg; try { pkg = JSON.parse(t.slice(b + BEG.length, e)); } catch (x) { return null; }
  if (!pkg || pkg.app !== 'leitor-pesquisa' || !pkg.doc || !pkg.doc.id) return null;
  return { appDocId: pkg.doc.id, name: pkg.doc.name || '', pkg, pdfDoc, marks: countRmPages(pdfDoc) };
}

// páginas com algo acrescentado pelo reMarkable (streams com /FXE no fim da página)
function rmStreamsOf(pdfDoc, pg) {
  const c = pg.node.Contents();
  const arr = c instanceof PDFArray ? c.asArray().map(r => pdfDoc.context.lookup(r)) : (c ? [c] : []);
  const out = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const t = streamText(arr[i]);
    if (t.indexOf('/FXE') < 0) break;
    out.unshift(t);
  }
  // página de uma só stream (o reMarkable reescreveu tudo): não dá para separar com segurança
  return out.length && out.length < arr.length ? out : [];
}
function countRmPages(pdfDoc) { return pdfDoc.getPages().filter(pg => rmStreamsOf(pdfDoc, pg).length).length; }

// ---- leitura dos caminhos ----
const OPS = new Set(['q', 'Q', 'cm', 'rg', 'RG', 'g', 'G', 'gs', 'm', 'l', 'c', 'v', 'y', 'h', 're', 'f', 'f*', 'F', 'B', 'B*', 'b', 'b*', 'S', 's', 'n', 'w', 'k', 'K', 'BDC', 'EMC', 'BMC', 'Do']);
function tokenize(t) {
  const out = [];
  const re = /\/[^\s/<>\[\]()]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*]+|<<|>>|\[|\]/g;
  let m; while ((m = re.exec(t))) out.push(m[0]);
  return out;
}
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// devolve [{ polys: [[[x,y],…], …] (uma forma por operação de preenchimento, com buracos), color, blend, alpha }]
export function parsePaths(text, gsInfo) {
  const shapes = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let fill = [0, 0, 0], gs = { blend: 'Normal', alpha: 1 };
  let sub = [], subs = [];
  const nums = [];
  const flush = (doFill) => {
    if (sub.length) subs.push(sub); sub = [];
    const ps = subs.filter(s => s.length >= 3);
    if (doFill && ps.length) shapes.push({ polys: ps, color: fill.slice(), blend: gs.blend, alpha: gs.alpha });
    subs = [];
  };
  for (const tk of tokenize(text)) {
    if (/^[-+.\d]/.test(tk)) { nums.push(+tk); continue; }
    if (tk[0] === '/') { nums.push(tk); continue; }
    if (!OPS.has(tk)) { nums.length = 0; continue; }
    const a = nums.splice(0);
    switch (tk) {
      case 'q': stack.push({ ctm: ctm.slice(), fill: fill.slice(), gs: Object.assign({}, gs) }); break;
      case 'Q': { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; gs = s.gs; } break; }
      case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
      case 'rg': if (a.length >= 3) fill = a.slice(-3); break;
      case 'g': if (a.length >= 1) fill = [a[a.length - 1], a[a.length - 1], a[a.length - 1]]; break;
      case 'gs': { const n = a[a.length - 1]; gs = Object.assign({ blend: 'Normal', alpha: 1 }, gsInfo[String(n).slice(1)] || {}); break; }
      case 'm': if (sub.length) subs.push(sub); sub = [apply(ctm, a[0], a[1])]; break;
      case 'l': sub.push(apply(ctm, a[0], a[1])); break;
      case 'c': sub.push(apply(ctm, a[4], a[5])); break;
      case 'v': case 'y': sub.push(apply(ctm, a[2], a[3])); break;
      case 're': { if (sub.length) subs.push(sub); const [x, y, w, hh] = a; sub = [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + hh), apply(ctm, x, y + hh)]; subs.push(sub); sub = []; break; }
      case 'h': break;
      case 'f': case 'f*': case 'F': case 'B': case 'B*': case 'b': case 'b*': flush(true); break;
      case 'S': case 's': case 'n': flush(false); break;
      default: break;
    }
  }
  return shapes;
}

const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
const isHighlighter = s => s.blend === 'Darken' || s.blend === 'Multiply' || s.alpha < 0.95 || (Math.max(...s.color) - Math.min(...s.color) > 0.25 && Math.min(...s.color) > 0.2);

// Converte as marcas do reMarkable em anotações do documento `doc`. As marcas trazidas antes (rm: true)
// são trocadas pelas novas (o PDF do reMarkable sempre traz tudo o que foi feito lá).
export async function importRmMarks(doc, info) {
  const pdfDoc = info.pdfDoc;
  const hd = await openPdf(doc);
  const list = pageList(doc, hd);
  const pages = pdfDoc.getPages();
  // páginas inseridas no reMarkable mudam a numeração: aí não dá para saber onde cada marca vai
  if (info.pkg && Array.isArray(info.pkg.pages) && info.pkg.pages.length && info.pkg.pages.length !== pages.length)
    throw new Error('o PDF do reMarkable tem ' + pages.length + ' páginas e o enviado tinha ' + info.pkg.pages.length + ' (páginas inseridas ou apagadas lá). Importe como documento novo.');
  const news = [];
  let inks = 0, hls = 0;
  for (let i = 0; i < pages.length && i < list.length; i++) {
    const texts = rmStreamsOf(pdfDoc, pages[i]);
    if (!texts.length) continue;
    const p = list[i];
    const gsInfo = {};
    try {
      const egs = pages[i].node.Resources().lookup(PDFName.of('ExtGState'));
      if (egs) for (const [k, v] of egs.entries()) { const dct = pdfDoc.context.lookup(v); const bm = dct.get(PDFName.of('BM')); const ca = dct.get(PDFName.of('ca')); gsInfo[k.asString().slice(1)] = { blend: bm ? bm.asString().slice(1) : 'Normal', alpha: ca ? ca.asNumber() : 1 }; }
    } catch (e) { }
    let vp = null, tc = null;
    if (p.kind === 'pdf') { const pg = await getPage(hd, p.n); vp = pg.getViewport({ scale: 1 }); try { tc = await pg.getTextContent(); } catch (e) { } }
    const toV = (x, y) => vp ? vp.convertToViewportPoint(x, y) : [x, p.h - y];
    const shapes = parsePaths(texts.join('\n'), gsInfo);
    let lastHl = null;
    for (const s of shapes) {
      const polys = s.polys.map(pl => pl.map(q => toV(q[0], q[1])));
      const pts = polys.flat();
      if (isHighlighter(s)) {
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        const r = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
        if (r[2] < 1 || r[3] < 1) continue;
        const color = hex(s.color);
        // linhas seguidas do mesmo destaque viram um destaque só
        const prev = lastHl && lastHl.color === color ? lastHl.rects[lastHl.rects.length - 1] : null;
        if (prev && r[1] - (prev[1] + prev[3]) < r[3] * 1.6 && r[1] >= prev[1]) lastHl.rects.push(r);
        else { lastHl = { kind: 'hl', rm: true, docId: doc.id, pageKey: p.key, rects: [r], color, cat: '', style: 'highlight', text: '', id: uid('a') }; news.push(lastHl); hls++; }
        continue;
      }
      lastHl = null;
      // traço da caneta: o reMarkable manda o contorno da tinta (com buracos onde o traço se cruza);
      // vira um traço "preenchido" do app (dá para mover, mudar de cor, apagar e desfazer)
      const r2 = q => [+q[0].toFixed(2), +q[1].toFixed(2)];
      news.push({ kind: 'ink', rm: true, tool: 'pen', docId: doc.id, pageKey: p.key, color: hex(s.color), width: 1, fill: polys.map(pl => pl.map(r2)), pts: pts.map(r2), id: uid('a') });
      inks++;
    }
    // texto debaixo de cada destaque (para a citação, o Digest e a busca)
    if (tc && vp) {
      for (const a of news.filter(x => x.kind === 'hl' && x.pageKey === p.key)) {
        const words = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const [x0, y0] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
          const hgt = Math.hypot(it.transform[2], it.transform[3]) || 10;
          const cy = y0 - hgt * 0.35;
          for (const r of a.rects) if (cy >= r[1] - 2 && cy <= r[1] + r[3] + 2 && x0 + (it.width || 0) > r[0] && x0 < r[0] + r[2]) { words.push(it.str.trim()); break; }
        }
        a.text = words.join(' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  const old = (await S.annots(doc.id)).filter(a => a.rm);
  if (old.length) await S.delAnnots(old);
  if (news.length) await S.putAnnotsGroup(news);
  return { inks, hls, replaced: old.length, pages: countRmPages(pdfDoc) };
}
