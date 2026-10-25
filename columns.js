// Modo artigo, como no NeoReader da Boox: as bordas brancas são cortadas e cada página é dividida
// em colunas iguais (com a divisão no lugar da calha do texto). Cada coluna aparece sozinha, na
// largura da tela, na ordem de leitura. A divisão pode ser ajustada à mão (1, 2 ou 3 colunas).
// Recortes em frações da página: [x, y, largura, altura].
import { getPage } from './pdfdoc.js';

async function pageItems(hd, n) {
  const pg = await getPage(hd, n);
  const vp = pg.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const tc = await pg.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !(it.width > 0)) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const fs = Math.hypot(tr[2], tr[3]) || it.height || 8;
    const yb = H - tr[5];
    items.push({ x0: tr[4] / W, x1: (tr[4] + it.width) / W, y0: (yb - fs) / H, y1: (yb + fs * 0.25) / H, n: it.str.length });
  }
  return items;
}

// posição (fração da largura da página) da calha entre duas colunas, ou null
function gutterFrom(items) {
  if (items.length < 20) return null;
  const B = 240, bins = new Float32Array(B);
  for (const i of items) {
    const a = Math.max(0, Math.floor(i.x0 * B)), b = Math.min(B - 1, Math.floor(i.x1 * B));
    for (let k = a; k <= b; k++) bins[k] += i.n / Math.max(1, b - a + 1);
  }
  const total = bins.reduce((s, v) => s + v, 0), avg = total / B;
  const lo = Math.floor(B * 0.33), hi = Math.ceil(B * 0.67);
  let best = null;
  // a faixa central com menos texto (linhas largas que cruzam a calha só diminuem o vão, não o apagam)
  const thr = avg * 0.25;
  for (let a = lo; a < hi; a++) {
    if (bins[a] > thr) continue;
    let b = a; while (b + 1 < hi && bins[b + 1] <= thr) b++;
    if (!best || b - a > best[1] - best[0]) best = [a, b];
    a = b;
  }
  if (!best) return null;
  const mid = (best[0] + best[1] + 1) / 2 / B;
  const left = items.filter(i => i.x1 <= mid).reduce((s, i) => s + i.n, 0);
  const right = items.filter(i => i.x0 >= mid).reduce((s, i) => s + i.n, 0);
  if (left < total * 0.2 || right < total * 0.2) return null;
  return mid;
}

// faixa larga no alto (título, autores, resumo) que atravessa a calha — só na 1ª página
function headerFrom(items, mid) {
  const spans = items.filter(i => i.x0 < mid - 0.02 && i.x1 > mid + 0.02);
  if (!spans.length) return null;
  const bottom = Math.max(...spans.filter(i => i.y1 < 0.6).map(i => i.y1), 0);
  if (!bottom) return null;
  const below = items.filter(i => i.y0 > bottom && (i.x1 <= mid || i.x0 >= mid));
  if (!below.length) return null;
  return (bottom + Math.min(...below.map(i => i.y0))) / 2;
}

// configuração automática: número de colunas e a posição da calha (média de algumas páginas)
export async function detectSetup(hd) {
  const N = hd.pdf.numPages;
  const sample = [2, 3, 4, 5, 6, 1].filter(p => p <= N);
  const gs = [];
  for (const n of sample) { try { const g = gutterFrom(await pageItems(hd, n)); if (g) gs.push(g); } catch (e) {} }
  if (!gs.length) return { n: 1, splits: [], header: true };
  gs.sort((a, b) => a - b);
  return { n: 2, splits: [gs[Math.floor(gs.length / 2)]], header: true };
}

// recortes de todas as páginas a partir da configuração (e do corte de bordas)
export async function layoutFromSetup(hd, setup, crop) {
  const N = hd.pdf.numPages;
  const [cx, cy, cw, ch] = crop || [0, 0, 1, 1];
  const n = Math.max(1, Math.min(3, setup.n || 1));
  const cuts = [cx];
  for (let k = 1; k < n; k++) {
    const s = setup.splits && setup.splits[k - 1] ? setup.splits[k - 1] : cx + cw * k / n;
    cuts.push(Math.max(cx + 0.05, Math.min(cx + cw - 0.05, s)));
  }
  cuts.push(cx + cw);
  const ov = 0.006;   // um pouco de sobra dos dois lados da calha
  const cols = [];
  for (let k = 0; k < n; k++) {
    const x0 = Math.max(cx, cuts[k] - (k ? ov : 0)), x1 = Math.min(cx + cw, cuts[k + 1] + (k < n - 1 ? ov : 0));
    cols.push([x0, x1]);
  }
  let head = null;
  if (n > 1 && setup.header !== false) {
    try { const items = await pageItems(hd, 1); head = headerFrom(items, cuts[1]); } catch (e) {}
  }
  const m = new Map();
  for (let p = 1; p <= N; p++) {
    if (n === 1) { m.set(p, [[cx, cy, cw, ch]]); continue; }
    const boxes = [];
    let top = cy;
    if (p === 1 && head && head > cy + 0.03) { boxes.push([cx, cy, cw, head - cy, 1]); top = head; }
    for (const [x0, x1] of cols) boxes.push([x0, top, x1 - x0, cy + ch - top]);
    m.set(p, boxes);
  }
  return m;
}
