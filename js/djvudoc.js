// DjVu no app: o livro DjVu "se apresenta" ao resto do app como um PDF do pdf.js (mesmas funções que o app usa:
// getPage, getViewport, render, getTextContent…). Assim valem para o DjVu, sem mudar nada nelas: virar e rolar
// página, zoom, cortar bordas, e-ink, destaques, notas, escrita, recorte para o caderno, busca, seleção de texto,
// tradução, IA e Digest. O desenho das páginas é feito num worker com o djvu-rs (WebAssembly, licença MIT).
// Medidas: como no PDF, em pontos (1/72 de polegada), a partir do tamanho e da resolução gravados no arquivo.
import { pdfjs } from './pdfdoc.js';

export const DJVU_RE = /\.(djvu|djv)$/i;
// arquivo DjVu: começa com "AT&TFORM"
export function isDjvuBytes(b) {
  return b && b.length > 8 && b[0] === 0x41 && b[1] === 0x54 && b[2] === 0x26 && b[3] === 0x54 && b[4] === 0x46 && b[5] === 0x4F && b[6] === 0x52 && b[7] === 0x4D;
}

let worker = null, seq = 0;
const waiting = new Map();   // job -> {res, rej}
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./djvuworker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const m = e.data, w = waiting.get(m.job);
    if (!w) return;
    waiting.delete(m.job);
    if (m.ok) w.res(m);
    else { const err = new Error(m.cancelled ? 'Desenho cancelado' : (m.error || 'Erro no DjVu')); if (m.cancelled) err.name = 'RenderingCancelledException'; w.rej(err); }
  };
  worker.onerror = e => {
    const err = new Error('Não foi possível ler o DjVu: ' + (e.message || 'erro no leitor'));
    for (const w of waiting.values()) w.rej(err);
    waiting.clear();
  };
  return worker;
}
function call(msg, transfer) {
  const job = ++seq;
  const p = new Promise((res, rej) => waiting.set(job, { res, rej }));
  getWorker().postMessage(Object.assign({ job }, msg), transfer || []);
  return { job, promise: p };
}

// a classe PageViewport do pdf.js (não é exportada; vem pelo getXfaPageViewport, que cria uma)
let PV = null;
function PageViewport(o) {
  if (!PV) PV = pdfjs.getXfaPageViewport({ attributes: { style: { width: '10px', height: '10px' } } }, { scale: 1 }).constructor;
  return new PV(o);
}

const STYLE = { djvu: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } };
let docSeq = 0;

class DjvuPage {
  constructor(doc, n, info) {
    this.doc = doc; this.pageNumber = n; this._index = n - 1; this.rotate = 0; this.info = info;
    this.w = info.w * 72 / info.dpi; this.h = info.h * 72 / info.dpi;
    this.view = [0, 0, this.w, this.h];
    this.userUnit = 1;
    this._text = null;
  }
  getViewport({ scale = 1, rotation = 0, offsetX = 0, offsetY = 0, dontFlip = false } = {}) {
    return PageViewport({ viewBox: this.view, userUnit: 1, scale, rotation, offsetX, offsetY, dontFlip });
  }
  // como o render do pdf.js: desenha no canvas na posição do viewport (com o deslocamento do "transform", se houver)
  render({ canvasContext: ctx, viewport, transform }) {
    const tr = transform || [1, 0, 0, 1, 0, 0];
    const k = tr[0] || 1;
    const s = viewport.scale * k;
    const ox = (viewport.offsetX || 0) * k + tr[4], oy = (viewport.offsetY || 0) * k + tr[5];
    const W = Math.round(this.w * s), H = Math.round(this.h * s);
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const x0 = Math.max(0, Math.floor(-ox)), y0 = Math.max(0, Math.floor(-oy));
    const x1 = Math.min(W, Math.ceil(cw - ox)), y1 = Math.min(H, Math.ceil(ch - oy));
    let job = 0, done = false;
    const promise = (async () => {
      if (x1 <= x0 || y1 <= y0) return;
      const c = call({ op: 'render', id: this.doc.id, n: this.pageNumber, dpi: 72 * s, region: [x0, y0, x1 - x0, y1 - y0] });
      job = c.job;
      const r = await c.promise;
      done = true;
      const img = new ImageData(new Uint8ClampedArray(r.px.buffer || r.px), r.w, r.h);
      const tmp = document.createElement('canvas');
      tmp.width = r.w; tmp.height = r.h;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(tmp, ox + x0, oy + y0);
      tmp.width = tmp.height = 0;
    })();
    return { promise, cancel: () => { if (job && !done) getWorker().postMessage({ op: 'cancel', job }); } };
  }
  // camada de texto (OCR) do DjVu no formato do pdf.js: cada trecho com a mesma caixa vira um item
  async getTextContent() {
    if (this._text) return this._text;
    const { promise } = call({ op: 'text', id: this.doc.id, n: this.pageNumber });
    const r = await promise;
    const items = [];
    const z = r.zones || [];
    const f = 72 / 288;
    let i = 0;
    while (i < z.length) {
      const a = z[i];
      const words = [a.t];
      let j = i + 1;
      while (j < z.length && z[j].x === a.x && z[j].y === a.y && z[j].w === a.w && z[j].h === a.h) { words.push(z[j].t); j++; }
      const x = a.x * f, y = a.y * f, w = a.w * f, h = Math.max(1, a.h * f);
      const str = words.join(' ').replace(/\s+/g, ' ').trim();
      if (str) items.push({ str, dir: 'ltr', width: w, height: h, transform: [h, 0, 0, h, x, this.h - (y + h * 0.8)], fontName: 'djvu', hasEOL: false, _y: y, _h: h });
      i = j;
    }
    // fim de linha: o próximo trecho começa noutra altura
    for (let k = 0; k < items.length; k++) {
      const a = items[k], b = items[k + 1];
      a.hasEOL = !b || Math.abs((b._y + b._h / 2) - (a._y + a._h / 2)) > Math.min(a._h, b._h) * 0.5;
      delete a._y; delete a._h;
    }
    this._text = { items, styles: STYLE, lang: null };
    return this._text;
  }
  streamTextContent() {
    const self = this;
    return new ReadableStream({ async start(c) { try { c.enqueue(await self.getTextContent()); } catch (e) { c.enqueue({ items: [], styles: STYLE, lang: null }); } c.close(); } });
  }
  // links da própria página (mapareas do DjVu), no formato das anotações de link do pdf.js
  async getAnnotations() {
    const L = (this.doc.meta && this.doc.meta.links && this.doc.meta.links[this.pageNumber]) || [];
    const k = 72 / this.info.dpi;
    const out = [];
    for (const l of L) {
      const a = { subtype: 'Link', rect: [l.x * k, l.y * k, (l.x + l.w) * k, (l.y + l.h) * k] };
      const t = this.doc.target(l.url);
      if (t.dest) a.dest = t.dest; else if (t.url) a.url = t.url; else continue;
      out.push(a);
    }
    return out;
  }
  cleanup() { this._text = null; }
}

class DjvuDocument {
  constructor(id, pages, meta) {
    this.id = id; this._pages = pages; this.numPages = pages.length; this.meta = meta || null;
    this._cache = new Map();
    this.isDjvu = true;
  }
  async getPage(n) {
    if (n < 1 || n > this.numPages) throw new Error('Página inexistente: ' + n);
    if (!this._cache.has(n)) this._cache.set(n, new DjvuPage(this, n, this._pages[n - 1]));
    return this._cache.get(n);
  }
  // destino de um link do DjVu: "#12" (página 12), "#p0012.djvu" (nome da página) ou endereço da internet
  target(url) {
    url = String(url || '');
    if (url[0] === '#') {
      const k = url.slice(1);
      const ids = (this.meta && this.meta.ids) || {};
      let n = ids[k];
      if (!n && /^\d+$/.test(k)) n = +k;
      return n >= 1 && n <= this.numPages ? { dest: '#' + n } : {};
    }
    return /^(https?|mailto):/i.test(url) ? { url } : {};
  }
  // sumário do livro (NAVM), no formato do pdf.js
  async getOutline() {
    const conv = list => (list || []).map(o => {
      const t = this.target(o.url);
      return { title: o.title || '(sem título)', dest: t.dest || null, url: t.url || null, items: conv(o.items), bold: false, italic: false, color: null, count: 0 };
    });
    return conv(this.meta && this.meta.outline);
  }
  async getDestination(name) {
    const m = /^#(\d+)$/.exec(String(name || ''));
    return m ? [+m[1] - 1, { name: 'Fit' }] : null;
  }
  async getPageIndex() { return 0; }
  async getAttachments() { return null; }
  async getPageLabels() { return null; }
  async getMetadata() { return { info: {}, metadata: null }; }
  async destroy() { try { await call({ op: 'close', id: this.id }).promise; } catch (e) {} this._cache.clear(); }
}

// abre um DjVu (bytes) e devolve o documento no formato que o app espera do pdf.js
export async function openDjvu(bytes) {
  const id = 'dj' + (++docSeq);
  const buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
  const r = await call({ op: 'open', id, bytes: buf }, [buf]).promise;
  if (!r.pages || !r.pages.length) throw new Error('DjVu sem páginas');
  return new DjvuDocument(id, r.pages, r.meta);
}

// PDF feito das páginas do DjVu (imagem de cada página), para exportar com as anotações e para a IA externa.
// pages: números das páginas (1…N); sem ele, todas. dpi: resolução das imagens.
export async function djvuToPdf(djdoc, { pages, dpi = 150, title = '', onProgress } = {}) {
  const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
  const out = await PDFDocument.create();
  if (title) out.setTitle(title);
  const list = pages && pages.length ? pages : Array.from({ length: djdoc.numPages }, (_, i) => i + 1);
  let k = 0;
  for (const n of list) {
    const pg = await djdoc.getPage(n);
    const s = dpi / 72;
    const vp = pg.getViewport({ scale: s });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    c.width = c.height = 0;
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const p = out.addPage([pg.w, pg.h]);
    p.drawImage(img, { x: 0, y: 0, width: pg.w, height: pg.h });
    if (onProgress) onProgress(++k, list.length);
  }
  return await out.save();
}
