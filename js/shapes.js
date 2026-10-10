// Formas para desenhar nos cadernos e PDFs: geométricas, óptica (perfis 1D, campos 2D, componentes),
// quântica, eletromagnetismo e física médica.
// Formas de linha viram traços comuns (dá para apagar, mover com o laço, mudar de lugar).
// Campos 2D (intensidade) viram imagem.
// Coordenadas: caixa unitária (0..1 em x e y, y para baixo); depois a forma é esticada no retângulo desenhado.

// ---------- funções matemáticas ----------
export function besselJ(n, x) {   // J_n(x) = (1/π)∫0^π cos(nτ − x sin τ) dτ
  const N = 120; let s = 0;
  for (let i = 0; i <= N; i++) { const t = Math.PI * i / N; const w = i === 0 || i === N ? 0.5 : 1; s += w * Math.cos(n * t - x * Math.sin(t)); }
  return s / N;
}
let airyTab = null;   // Ai(x) de −14 a 6, integrando Ai'' = x·Ai a partir de x = 5 (decai para a direita)
function airy(x) {
  if (!airyTab) {
    const h = 0.002, x0 = 5, x1 = -14, n = Math.round((x0 - x1) / h);
    const ys = new Float64Array(n + 1);
    let y = 1.0834e-4, yp = -2.4741e-4, xx = x0;
    ys[0] = y;
    const f = (xv, a, b) => [b, xv * a];
    for (let i = 1; i <= n; i++) {
      const hh = -h;
      const k1 = f(xx, y, yp), k2 = f(xx + hh / 2, y + hh / 2 * k1[0], yp + hh / 2 * k1[1]);
      const k3 = f(xx + hh / 2, y + hh / 2 * k2[0], yp + hh / 2 * k2[1]), k4 = f(xx + hh, y + hh * k3[0], yp + hh * k3[1]);
      y += hh / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); yp += hh / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]); xx += hh;
      ys[i] = y;
    }
    airyTab = { ys, h, x0 };
  }
  if (x > 5) return 0;
  const i = Math.round((airyTab.x0 - x) / airyTab.h);
  return airyTab.ys[Math.max(0, Math.min(airyTab.ys.length - 1, i))];
}
function laguerre(p, l, x) { if (p === 0) return 1; let a = 1, b = 1 + l - x; for (let k = 2; k <= p; k++) { const c = ((2 * k - 1 + l - x) * b - (k - 1 + l) * a) / k; a = b; b = c; } return b; }
function hermite(n, x) { if (n === 0) return 1; let a = 1, b = 2 * x; for (let k = 2; k <= n; k++) { const c = 2 * x * b - 2 * (k - 1) * a; a = b; b = c; } return b; }

// ---------- peças de desenho ----------
const P = (x, y) => [x, y];
const line = (x1, y1, x2, y2) => [[P(x1, y1), P(x2, y2)]];
function arrow(x1, y1, x2, y2, hs = 0.07) {
  const a = Math.atan2(y2 - y1, x2 - x1), b = 0.45;
  return [[P(x1, y1), P(x2, y2)], [P(x2 - hs * Math.cos(a - b), y2 - hs * Math.sin(a - b)), P(x2, y2), P(x2 - hs * Math.cos(a + b), y2 - hs * Math.sin(a + b))]];
}
function ell(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 72) { const o = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; o.push(P(cx + rx * Math.cos(t), cy + ry * Math.sin(t))); } return [o]; }
function dashed(pl, on = 0.03, off = 0.025) {   // polilinha tracejada
  const out = []; let cur = [], acc = 0, draw = true;
  for (let i = 1; i < pl.length; i++) {
    let [x0, y0] = pl[i - 1]; const [x1, y1] = pl[i];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (seg > 0) {
      const lim = (draw ? on : off) - acc, step = Math.min(lim, seg), t = step / seg;
      const nx = x0 + (x1 - x0) * t, ny = y0 + (y1 - y0) * t;
      if (draw) { if (!cur.length) cur.push(P(x0, y0)); cur.push(P(nx, ny)); }
      acc += step; seg -= step; x0 = nx; y0 = ny;
      if (acc >= (draw ? on : off) - 1e-9) { if (draw && cur.length > 1) out.push(cur); cur = []; draw = !draw; acc = 0; }
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
const poly = (pts, closed = true) => [closed ? pts.concat([pts[0]]) : pts];
function regular(n, cx = 0.5, cy = 0.5, r = 0.48, rot = -Math.PI / 2) { const o = []; for (let i = 0; i < n; i++) { const t = rot + i * 2 * Math.PI / n; o.push(P(cx + r * Math.cos(t), cy + r * Math.sin(t))); } return poly(o); }
// curva y = f(x) na caixa, com o domínio [a, b] e o eixo embaixo
function profile(f, a, b, opts = {}) {
  const n = 200, ys = [];
  for (let i = 0; i <= n; i++) ys.push(f(a + (b - a) * i / n));
  const mx = Math.max(...ys.map(Math.abs)) || 1, mn = Math.min(0, ...ys);
  const base = opts.signed ? 0.5 : 0.92, top = 0.06;
  const map = v => opts.signed ? 0.5 - (v / mx) * 0.42 : base - (v - mn) / (mx - mn || 1) * (base - top);
  const curve = ys.map((v, i) => P(0.02 + 0.96 * i / n, map(v)));
  const out = [curve];
  out.push(...arrow(0.0, base, 1.0, base, 0.04));
  if (opts.center !== false) out.push(...dashed([P(0.5, 0.02), P(0.5, base)]));
  return out;
}
const sq = v => v * v;

// ---------- catálogo ----------
// kind 'vec': gen() → lista de polilinhas na caixa unitária; aspect = altura/largura sugerida
// kind 'img': field(x, y) → intensidade (x, y de −1 a 1), mostrada em mapa de cores
export const SHAPE_CATS = [
  ['geo', 'Geométricas'], ['perfil', 'Óptica · perfis do feixe (1D)'], ['campo', 'Óptica · campos (2D)'], ['comp', 'Óptica · componentes'],
  ['quant', 'Mecânica quântica'], ['em', 'Eletromagnetismo'], ['med', 'Física médica'],
];

export const SHAPES = [
  // geométricas
  { id: 'linha', cat: 'geo', label: 'Linha', gen: () => line(0, 1, 1, 0) },
  { id: 'seta', cat: 'geo', label: 'Seta', gen: () => arrow(0, 0.5, 1, 0.5, 0.12), aspect: 0.3 },
  { id: 'seta2', cat: 'geo', label: 'Seta dupla', gen: () => [...arrow(0.5, 0.5, 1, 0.5, 0.12), ...arrow(0.5, 0.5, 0, 0.5, 0.12)], aspect: 0.3 },
  { id: 'ret', cat: 'geo', label: 'Retângulo', gen: () => poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]), aspect: 0.6 },
  { id: 'quad', cat: 'geo', label: 'Quadrado', gen: () => poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]), aspect: 1, square: true },
  { id: 'circ', cat: 'geo', label: 'Círculo', gen: () => ell(0.5, 0.5, 0.5, 0.5), aspect: 1, square: true },
  { id: 'elip', cat: 'geo', label: 'Elipse', gen: () => ell(0.5, 0.5, 0.5, 0.5), aspect: 0.6 },
  { id: 'tri', cat: 'geo', label: 'Triângulo', gen: () => poly([P(0.5, 0), P(1, 1), P(0, 1)]), aspect: 0.87 },
  { id: 'trir', cat: 'geo', label: 'Triângulo retângulo', gen: () => [...poly([P(0, 0), P(0, 1), P(1, 1)]), [P(0, 0.88), P(0.12, 0.88), P(0.12, 1)]], aspect: 0.8 },
  { id: 'losango', cat: 'geo', label: 'Losango', gen: () => poly([P(0.5, 0), P(1, 0.5), P(0.5, 1), P(0, 0.5)]), aspect: 1 },
  { id: 'pent', cat: 'geo', label: 'Pentágono', gen: () => regular(5), aspect: 1, square: true },
  { id: 'hexa', cat: 'geo', label: 'Hexágono', gen: () => regular(6, 0.5, 0.5, 0.48, 0), aspect: 1, square: true },
  { id: 'estrela', cat: 'geo', label: 'Estrela', gen: () => { const o = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.2 : 0.5, t = -Math.PI / 2 + i * Math.PI / 5; o.push(P(0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t))); } return poly(o); }, aspect: 1, square: true },
  { id: 'esfera', cat: 'geo', label: 'Esfera', gen: () => [...ell(0.5, 0.5, 0.5, 0.5), ...ell(0.5, 0.5, 0.5, 0.14, 0, Math.PI), ...dashed(ell(0.5, 0.5, 0.5, 0.14, Math.PI, 2 * Math.PI)[0]), ...ell(0.5, 0.5, 0.17, 0.5, -Math.PI / 2, Math.PI / 2)], aspect: 1, square: true },
  { id: 'cubo', cat: 'geo', label: 'Cubo', gen: () => { const d = 0.28; return [...poly([P(0, d), P(1 - d, d), P(1 - d, 1), P(0, 1)]), [P(0, d), P(d, 0), P(1, 0), P(1 - d, d)], [P(1, 0), P(1, 1 - d), P(1 - d, 1)], ...dashed([P(d, 0), P(d, 1 - d), P(1, 1 - d)]), ...dashed([P(d, 1 - d), P(0, 1)])]; }, aspect: 1, square: true },
  { id: 'cilindro', cat: 'geo', label: 'Cilindro', gen: () => [...ell(0.5, 0.12, 0.5, 0.12), ...ell(0.5, 0.88, 0.5, 0.12, 0, Math.PI), ...dashed(ell(0.5, 0.88, 0.5, 0.12, Math.PI, 2 * Math.PI)[0]), ...line(0, 0.12, 0, 0.88), ...line(1, 0.12, 1, 0.88)], aspect: 1.2 },
  { id: 'cone', cat: 'geo', label: 'Cone', gen: () => [...ell(0.5, 0.88, 0.5, 0.12, 0, Math.PI), ...dashed(ell(0.5, 0.88, 0.5, 0.12, Math.PI, 2 * Math.PI)[0]), [P(0, 0.88), P(0.5, 0), P(1, 0.88)]], aspect: 1.1 },
  { id: 'eixos2', cat: 'geo', label: 'Eixos x-y', gen: () => [...arrow(0.06, 0.94, 1, 0.94, 0.05), ...arrow(0.06, 0.94, 0.06, 0, 0.05)], aspect: 0.8 },
  { id: 'eixos3', cat: 'geo', label: 'Eixos 3D', gen: () => [...arrow(0.35, 0.65, 1, 0.65, 0.05), ...arrow(0.35, 0.65, 0.35, 0, 0.05), ...arrow(0.35, 0.65, 0, 1, 0.05)], aspect: 1 },
  { id: 'grade', cat: 'geo', label: 'Grade', gen: () => { const o = []; for (let i = 0; i <= 8; i++) { o.push(...line(i / 8, 0, i / 8, 1)); o.push(...line(0, i / 8, 1, i / 8)); } return o; }, aspect: 1 },

  // perfis 1D (intensidade ao longo de uma linha que passa pelo centro do feixe)
  { id: 'p-gauss', cat: 'perfil', label: 'Gaussiano', gen: () => profile(x => Math.exp(-2 * x * x), -2.2, 2.2), aspect: 0.6 },
  { id: 'p-lg1', cat: 'perfil', label: 'LG ℓ=1', gen: () => profile(x => x * x * Math.exp(-2 * x * x), -2.6, 2.6), aspect: 0.6 },
  { id: 'p-lg2', cat: 'perfil', label: 'LG ℓ=2', gen: () => profile(x => x ** 4 * Math.exp(-2 * x * x), -2.8, 2.8), aspect: 0.6 },
  { id: 'p-lg3', cat: 'perfil', label: 'LG ℓ=3', gen: () => profile(x => x ** 6 * Math.exp(-2 * x * x), -3, 3), aspect: 0.6 },
  { id: 'p-lg11', cat: 'perfil', label: 'LG p=1, ℓ=1', gen: () => profile(x => x * x * sq(laguerre(1, 1, 2 * x * x)) * Math.exp(-2 * x * x), -3, 3), aspect: 0.6 },
  { id: 'p-hg1', cat: 'perfil', label: 'HG₁₀ (campo)', gen: () => profile(x => x * Math.exp(-x * x), -3, 3, { signed: true }), aspect: 0.6 },
  { id: 'p-j0', cat: 'perfil', label: 'Bessel J₀²', gen: () => profile(x => sq(besselJ(0, x)), -14, 14), aspect: 0.6 },
  { id: 'p-j1', cat: 'perfil', label: 'Bessel J₁²', gen: () => profile(x => sq(besselJ(1, x)), -14, 14), aspect: 0.6 },
  { id: 'p-airy', cat: 'perfil', label: 'Airy Ai²', gen: () => profile(x => sq(airy(x)), -12, 3, { center: false }), aspect: 0.6 },
  { id: 'p-airydisk', cat: 'perfil', label: 'Disco de Airy', gen: () => profile(x => x === 0 ? 1 : sq(2 * besselJ(1, x) / x), -11, 11), aspect: 0.6 },
  { id: 'p-sinc', cat: 'perfil', label: 'sinc² (fenda)', gen: () => profile(x => x === 0 ? 1 : sq(Math.sin(x) / x), -12, 12), aspect: 0.6 },
  { id: 'p-lor', cat: 'perfil', label: 'Lorentziana', gen: () => profile(x => 1 / (1 + x * x), -6, 6), aspect: 0.6 },
  { id: 'p-top', cat: 'perfil', label: 'Top-hat', gen: () => profile(x => Math.abs(x) < 1 ? 1 : 0, -2, 2), aspect: 0.6 },
  { id: 'p-cintura', cat: 'perfil', label: 'Feixe gaussiano (w(z))', gen: () => {
    const o = [], up = [], dn = [];
    for (let i = 0; i <= 100; i++) { const z = -2.5 + 5 * i / 100, w = 0.12 * Math.sqrt(1 + z * z); up.push(P(i / 100, 0.5 - w)); dn.push(P(i / 100, 0.5 + w)); }
    o.push(up, dn, ...dashed([P(0, 0.5), P(1, 0.5)]), ...line(0.5, 0.38, 0.5, 0.62));
    return o;
  }, aspect: 0.6 },

  // campos 2D (intensidade)
  { id: 'c-gauss', cat: 'campo', label: 'Gaussiano', kind: 'img', field: (x, y) => Math.exp(-2 * (x * x + y * y) / 0.16) },
  { id: 'c-lg1', cat: 'campo', label: 'LG ℓ=1', kind: 'img', field: (x, y) => { const r2 = (x * x + y * y) / 0.1; return r2 * Math.exp(-2 * r2); } },
  { id: 'c-lg2', cat: 'campo', label: 'LG ℓ=2', kind: 'img', field: (x, y) => { const r2 = (x * x + y * y) / 0.08; return r2 * r2 * Math.exp(-2 * r2); } },
  { id: 'c-lg3', cat: 'campo', label: 'LG ℓ=3', kind: 'img', field: (x, y) => { const r2 = (x * x + y * y) / 0.07; return r2 ** 3 * Math.exp(-2 * r2); } },
  { id: 'c-lg11', cat: 'campo', label: 'LG p=1, ℓ=1', kind: 'img', field: (x, y) => { const r2 = (x * x + y * y) / 0.06; return r2 * sq(laguerre(1, 1, 2 * r2)) * Math.exp(-2 * r2); } },
  { id: 'c-hg10', cat: 'campo', label: 'HG₁₀', kind: 'img', field: (x, y) => { const s = 1 / 0.3; return sq(hermite(1, Math.SQRT2 * x * s)) * Math.exp(-2 * (x * x + y * y) * s * s); } },
  { id: 'c-hg11', cat: 'campo', label: 'HG₁₁', kind: 'img', field: (x, y) => { const s = 1 / 0.3; return sq(hermite(1, Math.SQRT2 * x * s) * hermite(1, Math.SQRT2 * y * s)) * Math.exp(-2 * (x * x + y * y) * s * s); } },
  { id: 'c-hg21', cat: 'campo', label: 'HG₂₁', kind: 'img', field: (x, y) => { const s = 1 / 0.28; return sq(hermite(2, Math.SQRT2 * x * s) * hermite(1, Math.SQRT2 * y * s)) * Math.exp(-2 * (x * x + y * y) * s * s); } },
  { id: 'c-j0', cat: 'campo', label: 'Bessel J₀', kind: 'img', field: (x, y) => sq(besselJ(0, 16 * Math.hypot(x, y))) },
  { id: 'c-j1', cat: 'campo', label: 'Bessel J₁', kind: 'img', field: (x, y) => sq(besselJ(1, 16 * Math.hypot(x, y))) },
  { id: 'c-airydisk', cat: 'campo', label: 'Disco de Airy', kind: 'img', gamma: 0.35, field: (x, y) => { const r = 14 * Math.hypot(x, y); return r === 0 ? 1 : sq(2 * besselJ(1, r) / r); } },
  { id: 'c-airy2', cat: 'campo', label: 'Feixe de Airy', kind: 'img', gamma: 0.5, field: (x, y) => sq(airy(-x * 9 - 1) * airy(-y * 9 - 1)) },
  { id: 'c-fase1', cat: 'campo', label: 'Fase do vórtice ℓ=1', kind: 'img', phase: true, field: (x, y) => ((Math.atan2(y, x) + Math.PI) % (2 * Math.PI)) / (2 * Math.PI) },
  { id: 'c-fase3', cat: 'campo', label: 'Fase do vórtice ℓ=3', kind: 'img', phase: true, field: (x, y) => ((3 * (Math.atan2(y, x) + Math.PI)) % (2 * Math.PI)) / (2 * Math.PI) },
  { id: 'c-garfo', cat: 'campo', label: 'Holograma em garfo', kind: 'img', phase: true, field: (x, y) => { const v = (Math.atan2(y, x) + 14 * x + 40) / (2 * Math.PI); return v - Math.floor(v); } },

  // componentes ópticos
  { id: 'lente', cat: 'comp', label: 'Lente convergente', gen: () => [...ell(0.5, 0.5, 0.18, 0.5, -Math.PI / 2, Math.PI / 2), ...ell(0.5, 0.5, 0.18, 0.5, Math.PI / 2, 3 * Math.PI / 2), ...arrow(0.5, 0.5, 0.5, 0, 0.06), ...arrow(0.5, 0.5, 0.5, 1, 0.06)], aspect: 2.2 },
  { id: 'lented', cat: 'comp', label: 'Lente divergente', gen: () => [[P(0.25, 0), P(0.75, 0)], [P(0.25, 1), P(0.75, 1)], ...ell(0.12, 0.5, 0.25, 0.5, -Math.PI / 2, Math.PI / 2), ...ell(0.88, 0.5, 0.25, 0.5, Math.PI / 2, 3 * Math.PI / 2)], aspect: 2.2 },
  { id: 'espelho', cat: 'comp', label: 'Espelho', gen: () => { const o = [[P(0.3, 0), P(0.3, 1)]]; for (let i = 0; i < 9; i++) o.push(...line(0.3, 0.06 + i * 0.11, 0.55, 0.0 + i * 0.11 - 0.06 + 0.12)); return o; }, aspect: 2.5 },
  { id: 'bs', cat: 'comp', label: 'Divisor de feixe', gen: () => [...poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]), ...line(0, 1, 1, 0)], aspect: 1, square: true },
  { id: 'prisma', cat: 'comp', label: 'Prisma', gen: () => poly([P(0.5, 0), P(1, 0.87), P(0, 0.87)]), aspect: 0.87 },
  { id: 'objetiva', cat: 'comp', label: 'Objetiva', gen: () => [...poly([P(0.15, 0), P(0.85, 0), P(0.85, 0.55), P(0.65, 0.85), P(0.35, 0.85), P(0.15, 0.55)]), ...line(0.15, 0.25, 0.85, 0.25), ...line(0.35, 1, 0.65, 1)], aspect: 1.1 },
  { id: 'pinca', cat: 'comp', label: 'Pinça óptica', gen: () => [[P(0.05, 0), P(0.5, 0.62), P(0.95, 0)], [P(0.05, 1.2), P(0.5, 0.62), P(0.95, 1.2)].map(p => [p[0], Math.min(1, p[1])]), ...ell(0.5, 0.62, 0.08, 0.08), ...dashed([P(0.5, 0), P(0.5, 1)])], aspect: 1 },
  { id: 'laser', cat: 'comp', label: 'Laser', gen: () => [...poly([P(0, 0.3), P(0.45, 0.3), P(0.45, 0.7), P(0, 0.7)]), ...arrow(0.45, 0.5, 1, 0.5, 0.06), ...line(0.07, 0.4, 0.38, 0.4)], aspect: 0.35 },
  { id: 'fibra', cat: 'comp', label: 'Fibra óptica', gen: () => { const o = []; const c = []; for (let i = 0; i <= 60; i++) { const t = i / 60; c.push(P(t, 0.5 + 0.3 * Math.sin(t * Math.PI * 2))); } o.push(c, c.map(p => [p[0], p[1] + 0.12])); o.push(...poly([P(0, 0.35), P(0.08, 0.35), P(0.08, 0.75), P(0, 0.75)])); return o; }, aspect: 0.4 },
  { id: 'slm', cat: 'comp', label: 'SLM', gen: () => { const o = [...poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)])]; for (let i = 1; i < 6; i++) { o.push(...line(i / 6, 0, i / 6, 1)); o.push(...line(0, i / 6, 1, i / 6)); } return o; }, aspect: 1, square: true },
  { id: 'camera', cat: 'comp', label: 'Câmera', gen: () => [...poly([P(0.2, 0.1), P(1, 0.1), P(1, 0.9), P(0.2, 0.9)]), ...poly([P(0, 0.3), P(0.2, 0.3), P(0.2, 0.7), P(0, 0.7)]), ...ell(0.6, 0.5, 0.2, 0.25)], aspect: 0.6 },
  { id: 'raio', cat: 'comp', label: 'Raio de luz', gen: () => arrow(0, 0.5, 1, 0.5, 0.05), aspect: 0.15 },
  { id: 'ondaplana', cat: 'comp', label: 'Frentes planas', gen: () => { const o = []; for (let i = 0; i < 6; i++) o.push(...line(0.08 + i * 0.16, 0, 0.08 + i * 0.16, 1)); o.push(...arrow(0, 0.5, 1, 0.5, 0.06)); return o; }, aspect: 0.8 },
  { id: 'ondaesf', cat: 'comp', label: 'Frentes esféricas', gen: () => { const o = []; for (let i = 1; i <= 5; i++) o.push(...ell(0, 0.5, i * 0.19, i * 0.19 * 1.6, -0.9, 0.9, 30)); return o; }, aspect: 1 },
  { id: 'polar', cat: 'comp', label: 'Polarizador', gen: () => { const o = [...ell(0.5, 0.5, 0.5, 0.5)]; for (let i = -3; i <= 3; i++) o.push(...line(0.5 + i * 0.11, 0.5 - Math.sqrt(0.24 - sq(i * 0.11)), 0.5 + i * 0.11, 0.5 + Math.sqrt(0.24 - sq(i * 0.11)))); return o; }, aspect: 1, square: true },

  // mecânica quântica
  { id: 'poco', cat: 'quant', label: 'Poço infinito + níveis', gen: () => { const o = [[P(0.15, 0), P(0.15, 1), P(0.85, 1), P(0.85, 0)]]; for (let n = 1; n <= 3; n++) { const E = 1 - n * n * 0.1; o.push(...dashed([P(0.15, E), P(0.85, E)])); const c = []; for (let i = 0; i <= 80; i++) { const t = i / 80; c.push(P(0.15 + 0.7 * t, E - 0.07 * Math.sin(n * Math.PI * t))); } o.push(c); } return o; }, aspect: 1 },
  { id: 'pocof', cat: 'quant', label: 'Poço finito', gen: () => [[P(0, 0.3), P(0.3, 0.3), P(0.3, 1), P(0.7, 1), P(0.7, 0.3), P(1, 0.3)], ...dashed([P(0.3, 0.8), P(0.7, 0.8)]), ...dashed([P(0.3, 0.52), P(0.7, 0.52)])], aspect: 0.8 },
  { id: 'osc', cat: 'quant', label: 'Oscilador harmônico', gen: () => { const o = []; const par = []; for (let i = 0; i <= 80; i++) { const x = -1 + 2 * i / 80; par.push(P(0.5 + 0.45 * x, 1 - 0.95 * x * x)); } o.push(par); for (let n = 0; n < 3; n++) { const E = 0.95 - (n + 0.5) * 0.25; const xm = Math.sqrt((1 - E) / 0.95); o.push([P(0.5 - 0.45 * xm, E), P(0.5 + 0.45 * xm, E)]); const c = []; for (let i = 0; i <= 80; i++) { const x = -1 + 2 * i / 80, u = x * 3.2; c.push(P(0.5 + 0.45 * x, E - 0.08 * hermite(n, u) / (n ? 2 * n : 1) * Math.exp(-u * u / 2))); } o.push(c); } return o; }, aspect: 1 },
  { id: 'tunel', cat: 'quant', label: 'Tunelamento', gen: () => { const o = [...poly([P(0.42, 0.25), P(0.58, 0.25), P(0.58, 0.95), P(0.42, 0.95)])]; const c1 = [], c2 = [], c3 = []; for (let i = 0; i <= 60; i++) { const t = i / 60; c1.push(P(0.42 * t, 0.6 - 0.18 * Math.sin(t * 22))); c3.push(P(0.58 + 0.42 * t, 0.6 - 0.05 * Math.sin(t * 22 + 1))); c2.push(P(0.42 + 0.16 * t, 0.6 - 0.18 * Math.sin(0.42 * 22) * Math.exp(-t * 2.6))); } o.push(c1, c2, c3); o.push(...arrow(0, 0.98, 1, 0.98, 0.04)); return o; }, aspect: 0.6 },
  { id: 'degrau', cat: 'quant', label: 'Degrau de potencial', gen: () => [[P(0, 0.9), P(0.5, 0.9), P(0.5, 0.35), P(1, 0.35)], ...dashed([P(0, 0.55), P(1, 0.55)])], aspect: 0.6 },
  { id: 'niveis', cat: 'quant', label: 'Átomo de 2 níveis', gen: () => [...line(0.15, 0.15, 0.85, 0.15), ...line(0.15, 0.85, 0.85, 0.85), ...arrow(0.4, 0.85, 0.4, 0.17, 0.06), ...(() => { const c = []; for (let i = 0; i <= 40; i++) { const t = i / 40; c.push(P(0.55 + 0.35 * t, 0.3 + 0.4 * t + 0.03 * Math.sin(t * 30))); } return [c]; })()], aspect: 1 },
  { id: 'bloch', cat: 'quant', label: 'Esfera de Bloch', gen: () => [...ell(0.5, 0.5, 0.45, 0.45), ...ell(0.5, 0.5, 0.45, 0.12, 0, Math.PI), ...dashed(ell(0.5, 0.5, 0.45, 0.12, Math.PI, 2 * Math.PI)[0]), ...arrow(0.5, 0.5, 0.5, 0.02, 0.05), ...arrow(0.5, 0.5, 0.78, 0.25, 0.05), ...dashed([P(0.5, 0.5), P(0.5, 0.95)])], aspect: 1, square: true },
  { id: 'orb-s', cat: 'quant', label: 'Orbital s', gen: () => [...ell(0.5, 0.5, 0.48, 0.48), ...ell(0.5, 0.5, 0.48, 0.12, 0, Math.PI)], aspect: 1, square: true },
  { id: 'orb-p', cat: 'quant', label: 'Orbital p', gen: () => { const lobe = s => { const c = []; for (let i = 0; i <= 60; i++) { const t = -Math.PI / 2 + Math.PI * i / 60; const r = 0.46 * Math.cos(t) ** 2; c.push(P(0.5 + s * r * Math.cos(t), 0.5 + r * Math.sin(t) * 0.9)); } return c; }; return [lobe(1), lobe(-1), ...dashed([P(0, 0.5), P(1, 0.5)])]; }, aspect: 0.6 },
  { id: 'pacote', cat: 'quant', label: 'Pacote de onda', gen: () => profile(x => Math.cos(6 * x) * Math.exp(-x * x / 2), -4, 4, { signed: true, center: false }), aspect: 0.5 },
  { id: 'spin', cat: 'quant', label: 'Spins ↑↓', gen: () => [...arrow(0.3, 0.9, 0.3, 0.1, 0.12), ...arrow(0.7, 0.1, 0.7, 0.9, 0.12)], aspect: 1 },

  // eletromagnetismo
  { id: 'carga', cat: 'em', label: 'Carga pontual', gen: () => { const o = [...ell(0.5, 0.5, 0.08, 0.08), ...line(0.46, 0.5, 0.54, 0.5), ...line(0.5, 0.46, 0.5, 0.54)]; for (let i = 0; i < 8; i++) { const t = i * Math.PI / 4; o.push(...arrow(0.5 + 0.12 * Math.cos(t), 0.5 + 0.12 * Math.sin(t), 0.5 + 0.48 * Math.cos(t), 0.5 + 0.48 * Math.sin(t), 0.06)); } return o; }, aspect: 1, square: true },
  { id: 'dipolo', cat: 'em', label: 'Dipolo elétrico', gen: () => { const o = [...ell(0.3, 0.5, 0.05, 0.05), ...ell(0.7, 0.5, 0.05, 0.05), ...line(0.68, 0.5, 0.72, 0.5), ...line(0.28, 0.5, 0.32, 0.5), ...line(0.3, 0.48, 0.3, 0.52)]; for (const k of [0.12, 0.24, 0.36]) { o.push(...ell(0.5, 0.5 - k * 0.9, 0.2 / Math.cos(0.3), k, Math.PI + 0.35, 2 * Math.PI - 0.35, 40)); o.push(...ell(0.5, 0.5 + k * 0.9, 0.2 / Math.cos(0.3), k, 0.35, Math.PI - 0.35, 40)); } o.push(...line(0.35, 0.5, 0.65, 0.5)); return o; }, aspect: 0.8 },
  { id: 'capacitor', cat: 'em', label: 'Capacitor (campo)', gen: () => { const o = [...line(0.2, 0, 0.2, 1), ...line(0.8, 0, 0.8, 1)]; for (let i = 0; i < 5; i++) o.push(...arrow(0.22, 0.1 + i * 0.2, 0.78, 0.1 + i * 0.2, 0.05)); return o; }, aspect: 0.8 },
  { id: 'fio', cat: 'em', label: 'Fio com corrente', gen: () => { const o = [...arrow(0.5, 1, 0.5, 0, 0.06)]; for (const r of [0.15, 0.3, 0.45]) o.push(...ell(0.5, 0.5, r, r * 0.3, 0, Math.PI), ...dashed(ell(0.5, 0.5, r, r * 0.3, Math.PI, 2 * Math.PI)[0])); return o; }, aspect: 1, square: true },
  { id: 'solenoide', cat: 'em', label: 'Solenoide', gen: () => { const o = []; const c = []; for (let i = 0; i <= 240; i++) { const t = i / 240; c.push(P(0.1 + 0.8 * t + 0.02 * Math.cos(t * 2 * Math.PI * 8), 0.5 + 0.2 * Math.sin(t * 2 * Math.PI * 8))); } o.push(c); o.push(...arrow(0.1, 0.5, 0.95, 0.5, 0.05)); return o; }, aspect: 0.5 },
  { id: 'espira', cat: 'em', label: 'Espira e campo B', gen: () => [...ell(0.5, 0.6, 0.3, 0.1), ...arrow(0.5, 0.95, 0.5, 0.05, 0.06), ...ell(0.5, 0.5, 0.45, 0.35, -Math.PI / 2, -0.2, 30), ...ell(0.5, 0.5, 0.45, 0.35, Math.PI + 0.2, 3 * Math.PI / 2, 30)], aspect: 1 },
  { id: 'ondaem', cat: 'em', label: 'Onda EM (E e B)', gen: () => { const e = [], b = []; for (let i = 0; i <= 120; i++) { const t = i / 120; const s = Math.sin(t * 4 * Math.PI); e.push(P(0.05 + 0.9 * t, 0.45 - 0.35 * s)); b.push(P(0.05 + 0.9 * t - 0.12 * s * 0.5, 0.45 + 0.18 * s)); } return [e, b, ...arrow(0.05, 0.45, 1, 0.45, 0.04)]; }, aspect: 0.6 },
  { id: 'campo', cat: 'em', label: 'Campo vetorial', gen: () => { const o = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o.push(...arrow(0.1 + i * 0.25, 0.15 + j * 0.25, 0.25 + i * 0.25, 0.08 + j * 0.25, 0.04)); return o; }, aspect: 1 },
  { id: 'resistor', cat: 'em', label: 'Resistor', gen: () => [[P(0, 0.5), P(0.2, 0.5), P(0.25, 0.2), P(0.35, 0.8), P(0.45, 0.2), P(0.55, 0.8), P(0.65, 0.2), P(0.75, 0.8), P(0.8, 0.5), P(1, 0.5)]], aspect: 0.3 },
  { id: 'cap-circ', cat: 'em', label: 'Capacitor (circuito)', gen: () => [...line(0, 0.5, 0.42, 0.5), ...line(0.42, 0.1, 0.42, 0.9), ...line(0.58, 0.1, 0.58, 0.9), ...line(0.58, 0.5, 1, 0.5)], aspect: 0.4 },
  { id: 'indutor', cat: 'em', label: 'Indutor', gen: () => { const o = [...line(0, 0.6, 0.15, 0.6), ...line(0.85, 0.6, 1, 0.6)]; for (let k = 0; k < 4; k++) o.push(...ell(0.2375 + k * 0.175, 0.6, 0.0875, 0.35, Math.PI, 2 * Math.PI, 24)); return o; }, aspect: 0.4 },
  { id: 'fonte', cat: 'em', label: 'Fonte (bateria)', gen: () => [...line(0, 0.5, 0.42, 0.5), ...line(0.42, 0.05, 0.42, 0.95), ...line(0.56, 0.3, 0.56, 0.7), ...line(0.56, 0.5, 1, 0.5)], aspect: 0.4 },

  // física médica
  { id: 'pdp', cat: 'med', label: 'Dose × profundidade (fótons)', gen: () => profile(x => (1 - Math.exp(-x * 2.2)) * Math.exp(-0.06 * x), 0, 25, { center: false }), aspect: 0.6 },
  { id: 'bragg', cat: 'med', label: 'Pico de Bragg (prótons)', gen: () => profile(x => x < 15 ? 0.3 + 0.012 * x + 0.7 * Math.exp(-sq(x - 15) / 0.6) : 1 * Math.exp(-sq(x - 15) / 0.25), 0, 18, { center: false }), aspect: 0.6 },
  { id: 'atenua', cat: 'med', label: 'Atenuação I = I₀e^(−μx)', gen: () => profile(x => Math.exp(-x), 0, 4, { center: false }), aspect: 0.6 },
  { id: 'decai', cat: 'med', label: 'Decaimento (meias-vidas)', gen: () => { const o = profile(x => Math.pow(0.5, x), 0, 5, { center: false }); for (let k = 1; k <= 4; k++) o.push(...dashed([P(0.02 + 0.96 * k / 5, 0.92), P(0.02 + 0.96 * k / 5, 0.92 - Math.pow(0.5, k) * 0.86)])); return o; }, aspect: 0.6 },
  { id: 'raiox', cat: 'med', label: 'Espectro de raios X', gen: () => profile(x => Math.max(0, (100 - x) / 100) * (1 - Math.exp(-x / 12)) + 1.3 * Math.exp(-sq(x - 59) / 1.2) + 0.5 * Math.exp(-sq(x - 67) / 1.2), 0, 100, { center: false }), aspect: 0.6 },
  { id: 'tubo', cat: 'med', label: 'Tubo de raios X', gen: () => [...poly([P(0, 0.2), P(1, 0.2), P(1, 0.7), P(0, 0.7)]), ...poly([P(0.1, 0.35), P(0.25, 0.35), P(0.25, 0.55), P(0.1, 0.55)]), [P(0.75, 0.3), P(0.9, 0.3), P(0.75, 0.6)], ...dashed([P(0.25, 0.45), P(0.78, 0.45)]), ...arrow(0.8, 0.6, 0.7, 1, 0.06), ...arrow(0.82, 0.6, 0.9, 1, 0.06)], aspect: 0.6 },
  { id: 'isodose', cat: 'med', label: 'Curvas de isodose', gen: () => { const o = [...line(0.5, 0, 0.5, 0.08)]; for (const k of [0.2, 0.35, 0.5, 0.65]) o.push(...ell(0.5, 0.08 + k * 0.8, 0.12 + k * 0.32, k * 0.85, Math.PI, 2 * Math.PI).map(c => c.map(p => [p[0], 0.08 + Math.abs(p[1] - 0.08 - k * 0.8)]))); return o; }, aspect: 0.9 },
];

// ---------- campos 2D: desenho em imagem ----------
const MAP = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];   // parecido com "inferno"
function cmap(v) {
  v = Math.max(0, Math.min(1, v)) * (MAP.length - 1);
  const i = Math.floor(v), t = v - i, a = MAP[i], b = MAP[Math.min(MAP.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function renderField(sh, size = 256) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  const vals = new Float32Array(size * size); let mx = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = sh.field(-1 + 2 * (i + 0.5) / size, -1 + 2 * (j + 0.5) / size);
    vals[j * size + i] = v; if (v > mx) mx = v;
  }
  for (let k = 0; k < vals.length; k++) {
    let v = sh.phase ? vals[k] : vals[k] / (mx || 1);
    if (sh.gamma) v = Math.pow(v, sh.gamma);
    const [r, g, b] = sh.phase ? [v * 255, v * 255, v * 255] : cmap(v);
    img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// polilinhas na caixa → pontos na página
export function placeShape(sh, x, y, w, hgt) {
  return sh.gen().map(pl => pl.map(([u, v]) => [+(x + u * w).toFixed(2), +(y + v * hgt).toFixed(2), 0.5, 0]));
}

// miniatura (SVG) para o painel
export function shapePreview(sh) {
  if (sh.kind === 'img') { const c = renderField(sh, 56); return '<img alt="" src="' + c.toDataURL() + '" width="44" height="44">'; }
  const asp = sh.aspect || 0.8, W = 52, H = Math.max(12, Math.min(40, W * asp));
  const pad = 2;
  const d = sh.gen().map(pl => 'M' + pl.map(([u, v]) => (pad + u * (W - 2 * pad)).toFixed(1) + ' ' + (pad + v * (H - 2 * pad)).toFixed(1)).join('L')).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path d="${d}"/></svg>`;
}
