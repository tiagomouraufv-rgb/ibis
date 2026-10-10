// Formas do usuário: categorias próprias e figuras próprias.
// Fontes de uma figura nova:
//   • a seleção feita na página (traços desenhados com a caneta, ou uma imagem) — o jeito mais fácil;
//   • um arquivo SVG (desenho vetorial: vira traços, dá para mudar a cor e apagar pedaços);
//   • uma imagem PNG/JPG/WebP (entra como imagem).
// Fica guardado no aparelho (e vai na cópia de segurança). Formato ideal: SVG com linhas (traço, sem
// preenchimento), uma cor só e viewBox definido; para imagens, PNG com fundo transparente, ≥ 400 px.
import { db } from './db.js';
import { uid, toast } from './util.js';

const KEY = 'myShapes';
let cache = null;
export async function load() { if (!cache) cache = await db.kvGet(KEY, { cats: [], items: [] }); return cache; }
async function save() { await db.kvSet(KEY, cache); window.dispatchEvent(new CustomEvent('myshapes')); }

export async function addCat(name) { const st = await load(); const c = { id: uid('uc'), name: name.trim().slice(0, 60) || 'Minhas formas' }; st.cats.push(c); await save(); return c; }
export async function renameCat(id, name) { const st = await load(); const c = st.cats.find(x => x.id === id); if (c) { c.name = name.trim().slice(0, 60) || c.name; await save(); } }
export async function delCat(id) { const st = await load(); st.cats = st.cats.filter(c => c.id !== id); st.items = st.items.filter(i => i.cat !== id); await save(); }
export async function renameItem(id, label) { const st = await load(); const i = st.items.find(x => x.id === id); if (i) { i.label = label.trim().slice(0, 60) || i.label; await save(); } }
export async function moveItem(id, cat) { const st = await load(); const i = st.items.find(x => x.id === id); if (i) { i.cat = cat; await save(); } }
export async function delItem(id) { const st = await load(); st.items = st.items.filter(i => i.id !== id); await save(); }

// forma no formato do catálogo (shapes.js)
export function asShape(it) {
  if (it.kind === 'img') return { id: it.id, cat: it.cat, label: it.label, kind: 'uimg', fileId: it.fileId, aspect: it.aspect, keepAspect: true, user: true };
  return { id: it.id, cat: it.cat, label: it.label, gen: () => it.pl, aspect: it.aspect, keepAspect: true, user: true };
}

// polilinhas (em qualquer escala) -> caixa unitária + proporção
function normalize(lines) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of lines) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = Math.max(1e-6, x1 - x0), hh = Math.max(1e-6, y1 - y0);
  // linha reta (sem altura ou sem largura): deixa uma caixa mínima
  const W = Math.max(w, hh * 0.05), H = Math.max(hh, w * 0.05);
  const pl = lines.map(l => l.map(([x, y]) => [+((x - x0) / W).toFixed(4), +((y - y0) / H).toFixed(4)]));
  return { pl, aspect: +(H / W).toFixed(4) };
}
// menos pontos (Douglas–Peucker), para não pesar
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let idx = -1, md = 0;
  const L = Math.hypot(bx - ax, by - ay);
  for (let i = 1; i < pts.length - 1; i++) {
    // traço fechado (começo = fim): distância até o ponto inicial
    const d = L < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
    if (d > md) { md = d; idx = i; }
  }
  if (md <= eps) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

export async function addFromStrokes(cat, label, strokes) {
  const lines = strokes.map(a => a.pts.map(p => [p[0], p[1]])).filter(l => l.length > 1);
  if (!lines.length) throw new Error('A seleção não tem traços.');
  const span = Math.max(...lines.flat().map(p => p[0])) - Math.min(...lines.flat().map(p => p[0]));
  const { pl, aspect } = normalize(lines.map(l => simplify(l, span * 0.002)));
  const st = await load();
  const it = { id: uid('us'), cat, label: label || 'Forma', kind: 'vec', pl, aspect, created: Date.now() };
  st.items.push(it); await save(); return it;
}

export async function addFromImage(cat, label, blob) {
  const NB = await import('./notebook.js');
  const im = await NB.storeImage(blob);
  const asp = im.h && im.w ? im.h / im.w : await new Promise(res => { const u = URL.createObjectURL(blob); const i = new Image(); i.onload = () => { res(i.naturalHeight / i.naturalWidth || 1); URL.revokeObjectURL(u); }; i.onerror = () => res(1); i.src = u; });
  const st = await load();
  const it = { id: uid('us'), cat, label: label || 'Imagem', kind: 'img', fileId: im.fileId, aspect: +asp.toFixed(4), created: Date.now() };
  st.items.push(it); await save(); return it;
}

// SVG -> traços: mede cada elemento (path, linha, círculo…) e amostra pontos ao longo dele
export async function addFromSvg(cat, label, text) {
  const { default: DOMPurify } = await import('../vendor/purify.es.mjs');
  const clean = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: false } });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:800px;visibility:hidden;pointer-events:none';
  host.innerHTML = clean;
  document.body.appendChild(host);
  try {
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('O arquivo não parece ser um SVG.');
    if (!svg.getAttribute('width')) svg.setAttribute('width', '800');
    if (!svg.getAttribute('height')) svg.setAttribute('height', '800');
    const els = [...svg.querySelectorAll('path, line, polyline, polygon, circle, ellipse, rect')].filter(e => !e.closest('defs, clipPath, mask, symbol'));
    const lines = [];
    let total = 0;
    for (const el of els) {
      let len = 0; try { len = el.getTotalLength(); } catch (e) { continue; }
      if (!(len > 0)) continue;
      const m = el.getCTM();
      const n = Math.max(6, Math.min(600, Math.round(len / 1.5)));
      const step = len / n;
      let cur = [], last = null;
      for (let i = 0; i <= n; i++) {
        const q = el.getPointAtLength(Math.min(len, i * step));
        // vários pedaços no mesmo path (M … M …): pulo grande = traço novo (medido antes da transformação)
        if (last && Math.hypot(q.x - last.x, q.y - last.y) > step * 4 + 1e-6) { if (cur.length > 1) lines.push(cur); cur = []; }
        const p = m ? q.matrixTransform(m) : q;
        cur.push([p.x, p.y]); last = q;
      }
      if (cur.length > 1) lines.push(cur);
      total += n;
      if (total > 20000) break;
    }
    if (!lines.length) throw new Error('Não achei linhas no SVG (texto e imagens dentro do SVG não entram).');
    const span = Math.max(...lines.flat().map(p => p[0])) - Math.min(...lines.flat().map(p => p[0]));
    const { pl, aspect } = normalize(lines.map(l => simplify(l, span * 0.0015)));
    const st = await load();
    const it = { id: uid('us'), cat, label: label || 'Forma SVG', kind: 'vec', pl, aspect, created: Date.now() };
    st.items.push(it); await save();
    return it;
  } finally { host.remove(); }
}

// escolher arquivo (SVG ou imagem) e adicionar
export function pickFile(cat) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) { res(null); return; }
      const label = f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
      try {
        const it = /svg/i.test(f.type) || /\.svg$/i.test(f.name) ? await addFromSvg(cat, label, await f.text()) : await addFromImage(cat, label, f);
        toast('Forma “' + it.label + '” adicionada.', 2000); res(it);
      } catch (e) { toast(e.message, 4000); res(null); }
    };
    inp.click();
  });
}
