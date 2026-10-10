// Modo artigo: acha as colunas de texto de cada página do PDF para mostrar uma coluna por vez.
// Usa a posição das palavras (camada de texto do PDF). Devolve, por página, a lista de recortes na
// ordem de leitura: [x, y, largura, altura] em frações da página.
import { getPage } from './pdfdoc.js';

const cache = new Map();   // docId -> Map(n -> boxes)

export async function columnLayout(hd, docId, onProgress) {
  if (!cache.has(docId)) cache.set(docId, new Map());
  const m = cache.get(docId);
  const N = hd.pdf.numPages;
  for (let n = 1; n <= N; n++) {
    if (!m.has(n)) {
      try { m.set(n, await pageColumns(hd, n)); } catch (e) { m.set(n, null); }
      if (onProgress && n % 4 === 0) onProgress(n, N);
      if (n % 8 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }
  return m;
}

export async function pageColumns(hd, n) {
  const pg = await getPage(hd, n);
  const vp = pg.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const tc = await pg.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !(it.width > 0)) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const fs = Math.hypot(tr[2], tr[3]) || it.height || 8;
    const x0 = tr[4], x1 = tr[4] + it.width;
    const yb = H - tr[5];
    items.push({ x0, x1, y0: yb - fs, y1: yb + fs * 0.25, n: it.str.length });
  }
  if (items.length < 12) return null;
  // limites do texto
  const tx0 = Math.min(...items.map(i => i.x0)), tx1 = Math.max(...items.map(i => i.x1));
  const ty0 = Math.min(...items.map(i => i.y0)), ty1 = Math.max(...items.map(i => i.y1));
  const tw = tx1 - tx0;
  if (tw < W * 0.3) return null;
  // cobertura horizontal (quantos caracteres cobrem cada faixa de x)
  const B = 200, bins = new Float32Array(B);
  for (const i of items) {
    const a = Math.max(0, Math.floor((i.x0 - tx0) / tw * B)), b = Math.min(B - 1, Math.floor((i.x1 - tx0) / tw * B));
    for (let k = a; k <= b; k++) bins[k] += i.n / Math.max(1, b - a + 1);
  }
  // procura o vão (calha) entre colunas na faixa central
  const lo = Math.floor(B * 0.3), hi = Math.ceil(B * 0.7);
  const total = bins.reduce((s, v) => s + v, 0);
  const avg = total / B;
  let best = null;
  for (let a = lo; a < hi; a++) {
    if (bins[a] > avg * 0.06) continue;
    let b = a; while (b + 1 < hi && bins[b + 1] <= avg * 0.06) b++;
    if (!best || b - a > best[1] - best[0]) best = [a, b];
    a = b;
  }
  if (!best) return null;
  const gL = tx0 + best[0] / B * tw, gR = tx0 + (best[1] + 1) / B * tw;
  const mid = (gL + gR) / 2;
  // linhas que atravessam a calha (título, resumo, figuras largas): ficam numa faixa inteira no alto
  const spans = items.filter(i => i.x0 < gL - 4 && i.x1 > gR + 4);
  const left = items.filter(i => i.x1 <= mid + 2), right = items.filter(i => i.x0 >= mid - 2);
  const leftChars = left.reduce((s, i) => s + i.n, 0), rightChars = right.reduce((s, i) => s + i.n, 0);
  if (leftChars < total * 0.2 || rightChars < total * 0.2) return null;   // não é página de duas colunas
  const padX = W * 0.012, padY = H * 0.01;
  let headBottom = null;
  if (spans.length) {
    const spanBottom = Math.max(...spans.map(i => i.y1));
    // só conta como cabeçalho se as linhas largas estiverem acima das colunas
    const colTop = Math.min(...left.concat(right).filter(i => i.y0 > spanBottom - 2).map(i => i.y0), Infinity);
    if (spanBottom < ty0 + (ty1 - ty0) * 0.6 && isFinite(colTop)) headBottom = (spanBottom + colTop) / 2;
    else return null;   // colunas misturadas com linhas largas no meio: deixa a página inteira
  }
  const top = headBottom !== null ? headBottom : ty0 - padY;
  const bottom = ty1 + padY;
  const box = (x0, x1, y0, y1) => [clamp01((x0 - padX) / W), clamp01(y0 / H), Math.min(1, (x1 - x0 + 2 * padX) / W), Math.min(1, (y1 - y0) / H)];
  const out = [];
  if (headBottom !== null) out.push(box(tx0, tx1, ty0 - padY, headBottom));
  const lx1 = Math.max(...left.map(i => i.x1)), rx0 = Math.min(...right.map(i => i.x0));
  out.push(box(tx0, Math.min(lx1, gR), top, bottom));
  out.push(box(Math.max(rx0, gL), tx1, top, bottom));
  return out;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
