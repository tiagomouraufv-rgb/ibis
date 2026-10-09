// Carregamento do PDF com pdf.js e a lista de páginas (incluindo páginas em branco inseridas).
import * as pdfjs from '../vendor/pdf.min.mjs';
import { db } from './db.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
export { pdfjs };

const cache = new Map(); // docId -> Promise<PdfHandle>

export async function loadPdfBytes(doc) {
  const f = await db.get('files', doc.fileId);
  if (!f) throw new Error('Arquivo do PDF não encontrado no aparelho.');
  return new Uint8Array(await f.blob.arrayBuffer());
}

export function openPdf(doc) {
  if (cache.has(doc.id)) return cache.get(doc.id);
  const p = (async () => {
    const data = await loadPdfBytes(doc);
    const pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      sizes.push({ w: vp.width, h: vp.height, rot: pg.rotate });
    }
    return { pdf, sizes, pageCache: new Map(), linkCache: new Map(), textCache: new Map() };
  })();
  cache.set(doc.id, p);
  p.catch(() => cache.delete(doc.id));
  return p;
}

export function forgetPdf(docId) {
  const p = cache.get(docId);
  if (p) p.then(hd => hd.pdf.destroy()).catch(() => {});
  cache.delete(docId);
}

export async function getPage(hd, n) {
  if (!hd.pageCache.has(n)) hd.pageCache.set(n, hd.pdf.getPage(n));
  return hd.pageCache.get(n);
}

// Lista virtual: [{key:'p3', kind:'pdf', n:3, w, h} | {key:'bXYZ', kind:'blank', id, w, h}]
export function pageList(doc, hd) {
  const N = hd.pdf.numPages;
  const blanks = (doc.blanks || []).slice().sort((a, b) => (a.after - b.after) || (a.created - b.created));
  const out = [];
  const pushBlanks = after => {
    for (const b of blanks) if (b.after === after) {
      const ref = hd.sizes[Math.max(0, Math.min(N - 1, after === 0 ? 0 : after - 1))];
      out.push({ key: 'b' + b.id, kind: 'blank', id: b.id, w: b.w || ref.w, h: b.h || ref.h });
    }
  };
  pushBlanks(0);
  for (let n = 1; n <= N; n++) {
    out.push({ key: 'p' + n, kind: 'pdf', n, w: hd.sizes[n - 1].w, h: hd.sizes[n - 1].h });
    pushBlanks(n);
  }
  out.forEach((p, i) => { p.index = i; p.label = p.kind === 'pdf' ? String(p.n) : 'em branco'; });
  return out;
}

export function pageLabel(key, doc) {
  if (!key) return '';
  if (key[0] === 'p') return 'p. ' + key.slice(1);
  if (doc && doc.kind === 'text') {
    if (key === 'top' || !key) return 'início';
    const m = String(doc.md || '').match(/^#{1,6}\s+.+$/gm) || [];
    for (const line of m) { const t = line.replace(/^#+\s+/, '').replace(/[*_`=$]/g, '').trim(); if (slug(t) === key || key.startsWith(slug(t) + '-')) return '§ ' + t; }
    return 'seção';
  }
  if (key[0] === 'n') {
    if (doc && doc.pages) { let n = 0; for (const p of doc.pages) { if (p.tpl !== 'cover') n++; if ('n' + p.id === key) return p.tpl === 'cover' ? 'capa' : 'p. ' + n; } }
    return 'página do caderno';
  }
  return 'página em branco';
}

export function pageNum(key) {
  return key && key[0] === 'p' ? parseInt(key.slice(1), 10) : 0;
}

// Texto de uma página (para busca e para a IA)
export async function pageText(hd, n) {
  if (hd.textCache.has(n)) return hd.textCache.get(n);
  const pg = await getPage(hd, n);
  const tc = await pg.getTextContent();
  let s = '';
  for (const it of tc.items) { s += it.str; s += it.hasEOL ? '\n' : (it.str.endsWith(' ') ? '' : ' '); }
  s = s.replace(/[ \t]+/g, ' ');
  hd.textCache.set(n, s);
  return s;
}

// Links do próprio PDF (sumário clicável, referências, URLs)
export async function pageLinks(hd, n) {
  if (hd.linkCache.has(n)) return hd.linkCache.get(n);
  const pg = await getPage(hd, n);
  const vp = pg.getViewport({ scale: 1 });
  const anns = await pg.getAnnotations({ intent: 'display' });
  const out = [];
  for (const a of anns) {
    if (a.subtype !== 'Link') continue;
    const r = vp.convertToViewportRectangle(a.rect);
    const x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
    const rect = [x, y, Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])];
    if (a.url || a.unsafeUrl) out.push({ rect, url: a.url || a.unsafeUrl });
    else if (a.dest) out.push({ rect, dest: a.dest });
  }
  hd.linkCache.set(n, out);
  return out;
}

// destino interno -> {n, y} (y em coordenadas de tela na escala 1, a partir do topo)
export async function resolveDest(hd, dest) {
  try {
    let d = dest;
    if (typeof d === 'string') d = await hd.pdf.getDestination(d);
    if (!Array.isArray(d)) return null;
    const ref = d[0];
    const idx = typeof ref === 'object' ? await hd.pdf.getPageIndex(ref) : (typeof ref === 'number' ? ref : 0);
    const n = idx + 1;
    let y = 0;
    const kind = d[1] && d[1].name;
    let top = null;
    if (kind === 'XYZ') top = d[3]; else if (kind === 'FitH' || kind === 'FitBH') top = d[2]; else if (kind === 'FitR') top = d[5];
    if (top !== null && top !== undefined) {
      const pg = await getPage(hd, n);
      const vp = pg.getViewport({ scale: 1 });
      const left = kind === 'XYZ' ? (d[2] || 0) : 0;
      y = Math.max(0, vp.convertToViewportPoint(left, top)[1]);
    }
    return { n, y };
  } catch (e) { return null; }
}

export async function outline(hd) {
  try {
    const o = await hd.pdf.getOutline();
    return o || [];
  } catch (e) { return []; }
}

// Anexo com os dados do app (PDF exportado no modo editável)
export async function embeddedData(hd) {
  try {
    const at = await hd.pdf.getAttachments();
    if (!at) return null;
    for (const k in at) {
      if (at[k].filename === 'leitor-dados.json') return JSON.parse(new TextDecoder().decode(at[k].content));
    }
  } catch (e) {}
  return null;
}

function slug(t) { return 'h-' + String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
