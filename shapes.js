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
  ['geom', 'Óptica geométrica (lentes, espelhos, imagens)'],
  ['quant', 'Mecânica quântica'], ['hidro', 'Mecânica quântica · hidrogênio e harmônicos esféricos'], ['em', 'Eletromagnetismo'], ['quim', 'Química'], ['med', 'Física médica'],
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
  let mn = 0; if (sh.signed) { for (const v of vals) if (-v > mn) mn = -v; mx = Math.max(mx, mn); }
  for (let k = 0; k < vals.length; k++) {
    if (sh.signed) {   // ψ com sinal: azul (−), branco (0), vermelho (+)
      let v = vals[k] / (mx || 1); const a = Math.pow(Math.abs(v), sh.gamma || 0.6);
      const [r, g, b] = v >= 0 ? [255, 255 - 200 * a, 255 - 215 * a] : [255 - 215 * a, 255 - 160 * a, 255];
      img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
      continue;
    }
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

// =====================================================================================
// 1.0.2: letras em traço (rótulos), óptica geométrica, hidrogênio, harmônicos esféricos,
// eletromagnetismo 3D e química
// =====================================================================================

// ---------- letras em traço (caixa 0,6 × 1; y para baixo) ----------
const arcG = (cx, cy, rx, ry, a0, a1, n = 18) => { const o = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; o.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return o; };
const GLYPH = {
  A: [[[0, 1], [0.3, 0], [0.6, 1]], [[0.12, 0.6], [0.48, 0.6]]],
  B: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.86], [0.6, 0.64], [0.45, 0.5], [0, 0.5]], [[0, 0], [0.4, 0], [0.55, 0.12], [0.55, 0.38], [0.4, 0.5]]],
  C: [arcG(0.32, 0.5, 0.3, 0.5, -0.25 * Math.PI, -1.75 * Math.PI)],
  E: [[[0.6, 0], [0, 0], [0, 1], [0.6, 1]], [[0, 0.5], [0.45, 0.5]]],
  F: [[[0.6, 0], [0, 0], [0, 1]], [[0, 0.5], [0.45, 0.5]]],
  H: [[[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.5], [0.6, 0.5]]],
  I: [[[0.3, 0], [0.3, 1]], [[0.12, 0], [0.48, 0]], [[0.12, 1], [0.48, 1]]],
  K: [[[0, 0], [0, 1]], [[0.6, 0], [0, 0.6]], [[0.18, 0.45], [0.6, 1]]],
  L: [[[0, 0], [0, 1], [0.6, 1]]],
  N: [[[0, 1], [0, 0], [0.6, 1], [0.6, 0]]],
  O: [arcG(0.3, 0.5, 0.3, 0.5, 0, 2 * Math.PI, 28)],
  P: [[[0, 1], [0, 0], [0.45, 0], [0.6, 0.13], [0.6, 0.37], [0.45, 0.5], [0, 0.5]]],
  R: [[[0, 1], [0, 0], [0.45, 0], [0.6, 0.13], [0.6, 0.37], [0.45, 0.5], [0, 0.5]], [[0.3, 0.5], [0.6, 1]]],
  S: [[[0.6, 0.15], [0.45, 0], [0.15, 0], [0, 0.15], [0, 0.33], [0.15, 0.48], [0.45, 0.52], [0.6, 0.67], [0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85]]],
  V: [[[0, 0], [0.3, 1], [0.6, 0]]],
  X: [[[0, 0], [0.6, 1]], [[0.6, 0], [0, 1]]],
  Y: [[[0, 0], [0.3, 0.5], [0.6, 0]], [[0.3, 0.5], [0.3, 1]]],
  Z: [[[0, 0], [0.6, 0], [0, 1], [0.6, 1]]],
  a: [arcG(0.28, 0.72, 0.26, 0.28, 0, 2 * Math.PI, 20), [[0.54, 0.42], [0.54, 1]]],
  d: [arcG(0.28, 0.72, 0.26, 0.28, 0, 2 * Math.PI, 20), [[0.54, 0], [0.54, 1]]],
  e: [[[0.04, 0.7], [0.54, 0.7], [0.5, 0.52], [0.3, 0.44], [0.1, 0.52], [0.03, 0.72], [0.1, 0.92], [0.3, 1], [0.52, 0.94]]],
  f: [[[0.5, 0.05], [0.38, 0], [0.26, 0.08], [0.26, 1]], [[0.08, 0.45], [0.46, 0.45]]],
  g: [arcG(0.28, 0.66, 0.24, 0.24, 0, 2 * Math.PI, 20), [[0.52, 0.42], [0.52, 1.1], [0.4, 1.25], [0.12, 1.22]]],
  k: [[[0.05, 0], [0.05, 1]], [[0.5, 0.42], [0.05, 0.78]], [[0.2, 0.66], [0.55, 1]]],
  l: [[[0.3, 0], [0.3, 1]]],
  m: [[[0, 1], [0, 0.45]], [[0, 0.6], [0.12, 0.45], [0.3, 0.5], [0.3, 1]], [[0.3, 0.6], [0.42, 0.45], [0.6, 0.5], [0.6, 1]]],
  n: [[[0.05, 1], [0.05, 0.42]], [[0.05, 0.6], [0.2, 0.44], [0.42, 0.44], [0.55, 0.6], [0.55, 1]]],
  p: [[[0.05, 0.42], [0.05, 1.25]], arcG(0.3, 0.7, 0.25, 0.28, 0, 2 * Math.PI, 20)],
  s: [[[0.5, 0.48], [0.3, 0.42], [0.08, 0.5], [0.12, 0.66], [0.45, 0.76], [0.52, 0.9], [0.3, 1], [0.05, 0.94]]],
  v: [[[0, 0.42], [0.3, 1], [0.6, 0.42]]],
  x: [[[0.05, 0.42], [0.55, 1]], [[0.55, 0.42], [0.05, 1]]],
  y: [[[0, 0.42], [0.3, 0.95]], [[0.6, 0.42], [0.2, 1.25]]],
  z: [[[0.05, 0.42], [0.55, 0.42], [0.05, 1], [0.55, 1]]],
  '0': [arcG(0.3, 0.5, 0.28, 0.5, 0, 2 * Math.PI, 24)],
  '1': [[[0.12, 0.2], [0.35, 0], [0.35, 1]]],
  '2': [[[0.02, 0.2], [0.15, 0.02], [0.45, 0.02], [0.6, 0.2], [0.58, 0.38], [0, 1], [0.6, 1]]],
  '3': [[[0, 0.1], [0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.35], [0.4, 0.5], [0.6, 0.65], [0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.9]], [[0.25, 0.5], [0.4, 0.5]]],
  '4': [[[0.45, 1], [0.45, 0], [0, 0.7], [0.6, 0.7]]],
  '5': [[[0.58, 0], [0.05, 0], [0.02, 0.45], [0.3, 0.38], [0.55, 0.5], [0.6, 0.72], [0.5, 0.95], [0.25, 1], [0, 0.92]]],
  '6': [[[0.55, 0.05], [0.3, 0], [0.08, 0.2], [0.02, 0.6], [0.1, 0.92], [0.3, 1], [0.5, 0.92], [0.58, 0.7], [0.48, 0.5], [0.28, 0.45], [0.05, 0.6]]],
  '+': [[[0, 0.55], [0.6, 0.55]], [[0.3, 0.25], [0.3, 0.85]]],
  '-': [[[0.05, 0.55], [0.55, 0.55]]],
  '=': [[[0.05, 0.42], [0.55, 0.42]], [[0.05, 0.68], [0.55, 0.68]]],
  "'": [[[0.3, 0], [0.22, 0.28]]],
  '>': [[[0.05, 0.3], [0.55, 0.58], [0.05, 0.86]]],
  '<': [[[0.55, 0.3], [0.05, 0.58], [0.55, 0.86]]],
  '∞': [[[0.3, 0.6], [0.45, 0.42], [0.6, 0.5], [0.6, 0.7], [0.45, 0.78], [0.3, 0.6], [0.15, 0.42], [0, 0.5], [0, 0.7], [0.15, 0.78], [0.3, 0.6]]],
  'θ': [arcG(0.3, 0.5, 0.26, 0.5, 0, 2 * Math.PI, 24), [[0.04, 0.5], [0.56, 0.5]]],
  'λ': [[[0.05, 0], [0.55, 1]], [[0.3, 0.5], [0.02, 1]]],
  'φ': [arcG(0.3, 0.6, 0.27, 0.3, 0, 2 * Math.PI, 20), [[0.3, 0.15], [0.3, 1.2]]],
  'ψ': [[[0.02, 0.4], [0.05, 0.75], [0.3, 0.88], [0.55, 0.75], [0.58, 0.4]], [[0.3, 0.15], [0.3, 1.2]]],
  '·': [arcG(0.3, 0.55, 0.06, 0.06, 0, 2 * Math.PI, 8)],
  '×': [[[0.1, 0.3], [0.5, 0.8]], [[0.5, 0.3], [0.1, 0.8]]],
};
// texto em traços: (x, y) = canto de cima à esquerda; hgt = altura da letra (na caixa unitária).
// "_" antes de um caractere: subscrito; "^": sobrescrito.
export function textPl(str, x, y, hgt, xsc = 1) {
  const out = []; let cx = x;
  for (let i = 0; i < str.length; i++) {
    let ch = str[i], hh = hgt, dy = 0;
    if ((ch === '_' || ch === '^') && i + 1 < str.length) { dy = ch === '_' ? hgt * 0.55 : -hgt * 0.25; ch = str[++i]; hh = hgt * 0.62; }
    if (ch === ' ') { cx += hgt * 0.5 * xsc; continue; }
    const g = GLYPH[ch] || GLYPH[ch.toUpperCase()];
    if (g) for (const pl of g) out.push(pl.map(([u, v]) => P(cx + u * hh * xsc, y + dy + v * hh)));
    cx += (0.6 + 0.28) * hh * xsc;
  }
  return out;
}
const tW = (str, hgt, xsc = 1) => str.replace(/[_^]/g, '').length * 0.88 * hgt * xsc;
// rótulo centrado; xsc compensa o esticamento da caixa (aspect) para as letras não ficarem tortas
const label = (str, cx, cy, hgt, xsc = 1) => textPl(str, cx - tW(str, hgt, xsc) / 2, cy - hgt / 2, hgt, xsc);

// ---------- óptica geométrica: diagramas de raios ----------
// type: 'lens' (f > 0 convergente, f < 0 divergente) ou 'mirror' (f > 0 côncavo, f < 0 convexo); d = distância do objeto (em f)
function rayDiagram(type, f, d, opts = {}) {
  const ASP = 0.55, xs = ASP;   // caixa mais larga que alta: as letras usam xsc = ASP
  const F = Math.abs(f), ho = 1;
  const di = Math.abs(d - f) < 1e-9 ? Infinity : 1 / (1 / f - 1 / d);
  const mi = isFinite(di) ? -di / d : 0, hi = isFinite(di) ? mi * ho : 0;
  const mirror = type === 'mirror';
  // faixa em x (unidades de |f|) e em y
  let xmin = -Math.max(d, 2 * F) * 1.15, xmax = mirror ? Math.max(1.2 * F, isFinite(di) && di < 0 ? -di * 1.2 : 0.8 * F) : Math.max(2 * F, isFinite(di) && di > 0 ? di : 0) * 1.15;
  if (mirror && isFinite(di) && di > 0) xmin = Math.min(xmin, -di * 1.15);
  xmin = Math.max(xmin, -6 * F); xmax = Math.min(xmax, 6 * F);
  const ymax = Math.min(3.2, Math.max(1.5, Math.abs(hi) * 1.2, ho * 1.4));
  const X = x => (x - xmin) / (xmax - xmin), Y = y => 0.5 - y / ymax * 0.46;
  const seg = (x1, y1, x2, y2) => [[P(X(x1), Y(y1)), P(X(x2), Y(y2))]];
  const dseg = (x1, y1, x2, y2) => dashed([P(X(x1), Y(y1)), P(X(x2), Y(y2))], 0.02, 0.015);
  const out = [];
  out.push(...arrow(0, 0.5, 1, 0.5, 0.025));   // eixo
  // lente / espelho
  const ly = ymax * 0.92;
  if (mirror) {
    const c = [];
    for (let i = 0; i <= 30; i++) { const t = -1 + 2 * i / 30; c.push(P(X(0) - (f > 0 ? 0.03 : -0.03) * t * t, Y(t * ly))); }
    out.push(c);
    for (let i = 0; i < 9; i++) { const t = -1 + 2 * i / 8, x0 = c[Math.round((t + 1) * 15)][0]; out.push([P(x0, Y(t * ly)), P(x0 + 0.025, Y(t * ly) - 0.03)]); }
  } else if (f > 0) out.push(...arrow(X(0), 0.5, X(0), Y(ly), 0.03), ...arrow(X(0), 0.5, X(0), Y(-ly), 0.03));
  else { out.push([P(X(0), Y(ly)), P(X(0), Y(-ly))]); out.push([P(X(0) - 0.015, Y(ly) + 0.03), P(X(0), Y(ly)), P(X(0) + 0.015, Y(ly) + 0.03)]); out.push([P(X(0) - 0.015, Y(-ly) - 0.03), P(X(0), Y(-ly)), P(X(0) + 0.015, Y(-ly) - 0.03)]); }
  // focos (e 2F / C)
  const mark = (x, t) => { if (x <= xmin || x >= xmax) return; out.push(...seg(x, -0.08 * ymax, x, 0.08 * ymax)); out.push(...label(t, X(x), Y(-0.08 * ymax) + 0.06, 0.05, xs)); };
  if (mirror) { mark(-F, 'F'); mark(-2 * F, 'C'); }
  else { mark(-F, f > 0 ? 'F' : "F'"); mark(F, f > 0 ? "F'" : 'F'); mark(-2 * F, '2F'); mark(2 * F, "2F'"); }
  // objeto
  out.push(...arrow(X(-d), 0.5, X(-d), Y(ho), 0.03));
  // raios (do topo do objeto); depois da lente: x > 0. No espelho, o que passaria para x > 0 volta (x → −x).
  const R = mirror ? (x => -x) : (x => x);
  const after = (x1, y1, x2, y2, dash) => { const a = [R(x1), y1, R(x2), y2]; out.push(...(dash ? dseg(...a) : seg(...a))); };
  const xEnd = mirror ? -xmin : xmax;
  const slopeTo = (y0, sl) => [xEnd, y0 + sl * xEnd];
  // 1) paralelo ao eixo → passa pelo foco (ou parece vir dele)
  out.push(...seg(-d, ho, 0, ho));
  { const sl = -ho / f; const [x2, y2] = slopeTo(ho, sl); after(0, ho, x2, y2); if (f < 0 || (isFinite(di) && di < 0)) after(0, ho, isFinite(di) && di < 0 ? di : f, isFinite(di) && di < 0 ? hi : 0, true); }
  // 2) pelo centro (lente) / pelo vértice (espelho)
  { const sl = -ho / d; out.push(...seg(-d, ho, 0, 0)); const [x2, y2] = slopeTo(0, sl); after(0, 0, x2, y2); if (isFinite(di) && di < 0) after(0, 0, di, hi, true); }
  // 3) pelo foco do lado do objeto → sai paralelo
  if (isFinite(di)) {
    const y3 = ho * f / (f - d);
    if (Math.abs(y3) < ymax * 1.6) {
      out.push(...seg(-d, ho, 0, y3));
      after(0, y3, xEnd, y3);
      if (di < 0) after(0, y3, di, y3, true);
    }
  }
  // imagem
  if (isFinite(di) && Math.abs(hi) < ymax * 1.05) {
    const xi = R(di);
    if (di > 0) out.push(...arrow(X(xi), 0.5, X(xi), Y(hi), 0.03));
    else { out.push(...dashed([P(X(xi), 0.5), P(X(xi), Y(hi))], 0.02, 0.015)); const a = Math.sign(hi) || 1; out.push([P(X(xi) - 0.012, Y(hi) + a * 0.03), P(X(xi), Y(hi)), P(X(xi) + 0.012, Y(hi) + a * 0.03)]); }
  }
  if (opts.tag) out.push(...label(opts.tag, 0.5, 0.95, 0.045, xs));
  return out;
}
// Snell e reflexão total
function snell(th1deg, n1, n2) {
  const o = [], A = 0.75, xs = A;
  o.push([P(0, 0.5), P(1, 0.5)]);
  o.push(...dashed([P(0.5, 0.02), P(0.5, 0.98)]));
  const t1 = th1deg * Math.PI / 180, L = 0.46;
  const ix = 0.5 - L * Math.sin(t1) * A, iy = 0.5 - L * Math.cos(t1);
  o.push(...arrow(ix, iy, 0.5 - (0.5 - ix) * 0.45, 0.5 - (0.5 - iy) * 0.45, 0.035), [P(0.5 - (0.5 - ix) * 0.45, 0.5 - (0.5 - iy) * 0.45), P(0.5, 0.5)]);
  const s2 = n1 / n2 * Math.sin(t1);
  // refletido (tracejado se houver refratado)
  const rx = 0.5 + L * Math.sin(t1) * A, ry = iy;
  if (s2 <= 1) {
    o.push(...dashed([P(0.5, 0.5), P(rx, ry)]));
    const t2 = Math.asin(s2);
    o.push(...arrow(0.5, 0.5, 0.5 + L * Math.sin(t2) * A, 0.5 + L * Math.cos(t2), 0.035));
    o.push(...ell(0.5, 0.5, 0.12 * A, 0.12, Math.PI / 2 - t2 * 0 + 0, Math.PI / 2 - t2, 12).map(c => c.map(([x, y]) => [x, y])));
    o.push(...label('θ_2', 0.5 + 0.1 * A, 0.5 + 0.22, 0.05, xs));
  } else {
    o.push(...arrow(0.5, 0.5, rx, ry, 0.035));
    o.push(...label('θ > θ_c', 0.5, 0.6, 0.05, xs));
  }
  o.push(...ell(0.5, 0.5, 0.12 * A, 0.12, -Math.PI / 2, -Math.PI / 2 - t1, 12));
  o.push(...label('θ_1', 0.5 - 0.1 * A, 0.5 - 0.22, 0.05, xs));
  o.push(...label('n_1', 0.9, 0.42, 0.05, xs), ...label('n_2', 0.9, 0.58, 0.05, xs));
  return o;
}

// ---------- hidrogênio ----------
function genLaguerre(k, a, x) { if (k === 0) return 1; let L0 = 1, L1 = 1 + a - x; for (let i = 2; i <= k; i++) { const L2 = ((2 * i - 1 + a - x) * L1 - (i - 1 + a) * L0) / i; L0 = L1; L1 = L2; } return L1; }
function Rnl(n, l, r) { const rho = 2 * r / n; return Math.pow(rho, l) * Math.exp(-rho / 2) * genLaguerre(n - l - 1, 2 * l + 1, rho); }
// parte angular real no plano xz (x para a direita, z para cima)
const ANG = {
  s: () => 1, pz: (x, z, r) => r ? z / r : 0, px: (x, z, r) => r ? x / r : 0,
  dz2: (x, z, r) => r ? (3 * z * z - r * r) / (r * r) : 0, dxz: (x, z, r) => r ? x * z / (r * r) : 0, dx2: (x, z, r) => r ? x * x / (r * r) : 0,
  fz3: (x, z, r) => r ? (5 * z * z * z / (r * r * r) - 3 * z / r) : 0, fxz2: (x, z, r) => r ? x * (5 * z * z - r * r) / (r * r * r) : 0,
};
function hydrogen(n, l, ang, signed, ext) {
  const E = ext || (n * n * 2.6 + 3);
  return (x, y) => { const X1 = x * E, Z = -y * E, r = Math.hypot(X1, Z); const psi = Rnl(n, l, r) * ANG[ang](X1, Z, r); return signed ? psi : psi * psi; };
}
const radial = (n, l) => profile(r => r * r * sq(Rnl(n, l, r)), 0, n * n * 2.4 + 4, { center: false });
// harmônico esférico |Y_lm(θ)| em gráfico polar (no plano xz)
function ylmPolar(f) {
  const pts = [], N = 240; let mx = 0;
  for (let i = 0; i <= N; i++) { const t = 2 * Math.PI * i / N; const r = Math.abs(f(Math.cos(t), Math.abs(Math.sin(t)))); mx = Math.max(mx, r); pts.push([t, r]); }
  const out = [pts.map(([t, r]) => P(0.5 + 0.46 * r / mx * Math.sin(t), 0.5 - 0.46 * r / mx * Math.cos(t)))];
  out.push(...dashed([P(0.5, 0.02), P(0.5, 0.98)]), ...dashed([P(0.02, 0.5), P(0.98, 0.5)]));
  out.push(...label('z', 0.55, 0.05, 0.05));
  return out;
}

// ---------- campo de linhas (cargas / dipolo magnético) ----------
function fieldLines(charges, starts, opts = {}) {
  // charges: [{x, y, q}] na caixa; segue E = Σ q r̂/r² a partir dos pontos de partida
  const E = (x, y) => { let ex = 0, ey = 0; for (const c of charges) { const dx = x - c.x, dy = y - c.y, r2 = dx * dx + dy * dy + 1e-6, r3 = r2 * Math.sqrt(r2); ex += c.q * dx / r3; ey += c.q * dy / r3; } return [ex, ey]; };
  const out = [];
  for (const [sx, sy, dir] of starts) {
    const pl = [P(sx, sy)]; let x = sx, y = sy;
    for (let i = 0; i < 900; i++) {
      const [ex, ey] = E(x, y); const m = Math.hypot(ex, ey) || 1;
      x += dir * 0.004 * ex / m; y += dir * 0.004 * ey / m;
      if (x < 0 || x > 1 || y < 0 || y > 1) break;
      if (charges.some(c => Math.hypot(x - c.x, y - c.y) < 0.035)) { pl.push(P(x, y)); break; }
      pl.push(P(x, y));
    }
    if (pl.length > 2) {
      out.push(pl);
      const k = Math.floor(pl.length / 2), a = pl[k], b = pl[Math.min(pl.length - 1, k + 3)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (dir < 0 ? Math.PI : 0);
      out.push([P(a[0] - 0.03 * Math.cos(ang - 0.45), a[1] - 0.03 * Math.sin(ang - 0.45)), a, P(a[0] - 0.03 * Math.cos(ang + 0.45), a[1] - 0.03 * Math.sin(ang + 0.45))].map(p => p));
    }
  }
  for (const c of charges) { out.push(...ell(c.x, c.y, 0.03, 0.03, 0, 2 * Math.PI, 16)); out.push(...line(c.x - 0.018, c.y, c.x + 0.018, c.y)); if (c.q > 0) out.push(...line(c.x, c.y - 0.018, c.x, c.y + 0.018)); }
  return out;
}
const ringStarts = (c, n, r, dir, a0 = 0) => [...Array(n)].map((_, i) => { const t = a0 + 2 * Math.PI * i / n; return [c.x + r * Math.cos(t), c.y + r * Math.sin(t), dir]; });

// ---------- onda EM em 3D (E ⊥ B ⊥ k) ----------
function emWave3D(pol) {
  const o = [], ox = 0.08, oy = 0.55, L = 0.84, dz = [-0.16, 0.12];   // eixo z da tela: diagonal
  const pt = (s, ey, bz) => P(ox + s * L + bz * dz[0], oy - ey * 0.36 + bz * dz[1] * -1 * -1);
  o.push(...arrow(ox - 0.03, oy, ox + L + 0.08, oy, 0.03));
  const e = [], b = [];
  for (let i = 0; i <= 160; i++) { const s = i / 160, ph = s * 4 * Math.PI; e.push(pt(s, Math.sin(ph), 0)); b.push(pt(s, pol === 'circ' ? Math.cos(ph) * 0 : 0, Math.sin(ph) * 1.0)); }
  o.push(e, b);
  for (let i = 1; i < 16; i++) { const s = i / 16, ph = s * 4 * Math.PI; if (Math.abs(Math.sin(ph)) < 0.15) continue; o.push([pt(s, 0, 0), pt(s, Math.sin(ph), 0)]); o.push(...dashed([pt(s, 0, 0), pt(s, 0, Math.sin(ph))], 0.012, 0.01)); }
  o.push(...label('E', ox + 0.125 * L, oy - 0.42, 0.06, 0.6), ...label('B', ox + 0.125 * L + dz[0] - 0.04, oy + dz[1] + 0.05, 0.06, 0.6), ...label('k', ox + L + 0.06, oy - 0.07, 0.06, 0.6));
  return o;
}
// tríade de vetores 3D (x→, y↑, z diagonal)
function triad(a, b, c) {
  const o = [], O = [0.42, 0.62];
  o.push(...arrow(O[0], O[1], 0.95, O[1], 0.05), ...arrow(O[0], O[1], O[0], 0.05, 0.05), ...arrow(O[0], O[1], 0.08, 0.95, 0.05));
  o.push(...label(a, 0.92, O[1] - 0.09, 0.08), ...label(b, O[0] + 0.09, 0.08, 0.08), ...label(c, 0.18, 0.95, 0.08));
  o.push(...dashed([P(O[0] + 0.12, O[1]), P(O[0] + 0.12, O[1] - 0.12), P(O[0], O[1] - 0.12)], 0.02, 0.015));
  return o;
}
const crosses = (n = 4) => { const o = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const cx = (i + 0.5) / n, cy = (j + 0.5) / n, r = 0.25 / n; o.push(...line(cx - r, cy - r, cx + r, cy + r), ...line(cx + r, cy - r, cx - r, cy + r)); } return o; };
const dots = (n = 4) => { const o = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const cx = (i + 0.5) / n, cy = (j + 0.5) / n; o.push(...ell(cx, cy, 0.2 / n, 0.2 / n, 0, 2 * Math.PI, 14), ...ell(cx, cy, 0.03 / n, 0.03 / n, 0, 2 * Math.PI, 6)); } return o; };

// ---------- química ----------
const atom = (x, y, sym, r = 0.07, hgt = 0.08) => [...ell(x, y, r, r, 0, 2 * Math.PI, 24), ...label(sym, x, y, hgt)];
// ligação entre dois átomos (encurtada nas bordas); n = 1, 2 ou 3 traços
function bond(a, b, n = 1, ra = 0.07, rb = 0.07) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const o = [], gap = 0.022;
  for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * gap; o.push([P(a[0] + ux * ra + nx * off, a[1] + uy * ra + ny * off), P(b[0] - ux * rb + nx * off, b[1] - uy * rb + ny * off)]); }
  return o;
}
const wedge = (a, b, w = 0.035) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * w, ny = dx / L * w; return poly([P(a[0], a[1]), P(b[0] + nx, b[1] + ny), P(b[0] - nx, b[1] - ny)]); };
const hashw = (a, b, w = 0.035) => { const o = [], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L; for (let i = 1; i <= 6; i++) { const t = i / 6, cx = a[0] + dx * t, cy = a[1] + dy * t, hw = w * t; o.push([P(cx + nx * hw, cy + ny * hw), P(cx - nx * hw, cy - ny * hw)]); } return o; };
function ringPts(n, cx, cy, r, rot = -Math.PI / 2) { return [...Array(n)].map((_, i) => { const t = rot + 2 * Math.PI * i / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }); }
function benzene(kekule) {
  const p = ringPts(6, 0.5, 0.5, 0.42, -Math.PI / 2), o = [...poly(p)];
  if (kekule) for (const i of [0, 2, 4]) { const a = p[i], b = p[(i + 1) % 6]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], k = 0.82; o.push([P(0.5 + (a[0] - 0.5) * k + (m[0] - 0.5) * 0, 0.5 + (a[1] - 0.5) * k), P(0.5 + (b[0] - 0.5) * k, 0.5 + (b[1] - 0.5) * k)]); }
  else o.push(...ell(0.5, 0.5, 0.25, 0.25));
  return o;
}
function flaskShape(kind) {
  if (kind === 'bequer') return [[P(0.15, 0.02), P(0.2, 0.08), P(0.2, 0.98), P(0.8, 0.98), P(0.8, 0.05)], ...[0.3, 0.5, 0.7].map(y => [P(0.2, y), P(0.32, y)]), ...dashed([P(0.2, 0.55), P(0.8, 0.55)], 0.04, 0.03)];
  if (kind === 'erlen') return [[P(0.4, 0.02), P(0.4, 0.35), P(0.08, 0.95), P(0.92, 0.95), P(0.6, 0.35), P(0.6, 0.02)], ...dashed([P(0.22, 0.7), P(0.78, 0.7)], 0.04, 0.03)];
  if (kind === 'balao') { const c = ell(0.5, 0.7, 0.3, 0.28, -Math.PI / 2 + 0.38, 3 * Math.PI / 2 - 0.38, 40)[0]; return [[P(0.43, 0.02), P(0.43, 0.43), ...c.slice(0).reverse().reverse(), P(0.57, 0.43), P(0.57, 0.02)].filter(Boolean), [P(0.4, 0.2), P(0.6, 0.2)]]; }
  if (kind === 'tubo') return [[P(0.35, 0.02), P(0.35, 0.82), ...ell(0.5, 0.82, 0.15, 0.15, Math.PI, 0, 16)[0].reverse().reverse(), P(0.65, 0.02)], ...dashed([P(0.35, 0.55), P(0.65, 0.55)], 0.03, 0.02)];
  return [];
}
function periodicTable() {
  const o = [], W = 1 / 18, H = 1 / 10;
  const cell = (c, r) => o.push(...poly([P(c * W, r * H), P((c + 1) * W, r * H), P((c + 1) * W, (r + 1) * H), P(c * W, (r + 1) * H)]));
  cell(0, 0); cell(17, 0);
  for (const r of [1, 2]) { cell(0, r); cell(1, r); for (let c = 12; c < 18; c++) cell(c, r); }
  for (let r = 3; r < 7; r++) for (let c = 0; c < 18; c++) cell(c, r);
  for (const r of [7.6, 8.6]) for (let c = 3; c < 17; c++) cell(c, r);
  return o;
}
function bohr(nShells, eCounts) {
  const o = [...ell(0.5, 0.5, 0.08, 0.08), ...label('+', 0.5, 0.5, 0.08)];
  for (let s = 1; s <= nShells; s++) {
    const r = 0.08 + s * 0.13; o.push(...ell(0.5, 0.5, r, r, 0, 2 * Math.PI, 60));
    const ne = eCounts[s - 1] || 0;
    for (let k = 0; k < ne; k++) { const t = 2 * Math.PI * k / ne + s * 0.4; o.push(...ell(0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t), 0.02, 0.02, 0, 2 * Math.PI, 10)); }
  }
  return o;
}
function moDiagram() {
  const o = [];
  const lvl = (x, y, w = 0.16) => o.push([P(x - w / 2, y), P(x + w / 2, y)]);
  lvl(0.15, 0.5); lvl(0.85, 0.5); lvl(0.5, 0.75); lvl(0.5, 0.25);
  o.push(...dashed([P(0.23, 0.5), P(0.42, 0.75)]), ...dashed([P(0.77, 0.5), P(0.58, 0.75)]), ...dashed([P(0.23, 0.5), P(0.42, 0.25)]), ...dashed([P(0.77, 0.5), P(0.58, 0.25)]));
  o.push(...arrow(0.47, 0.8, 0.47, 0.68, 0.02), ...arrow(0.53, 0.68, 0.53, 0.8, 0.02));
  o.push(...arrow(0.15, 0.55, 0.15, 0.43, 0.02), ...arrow(0.85, 0.55, 0.85, 0.43, 0.02));
  o.push(...label('1s', 0.15, 0.6, 0.05), ...label('1s', 0.85, 0.6, 0.05), ...arrow(0.02, 0.95, 0.02, 0.05, 0.03), ...label('E', 0.06, 0.06, 0.05));
  return o;
}
function hybrid(n) {
  const o = [];
  const lobe = (ang, big = 0.4, small = 0.12) => { const c = []; for (let i = 0; i <= 60; i++) { const t = -Math.PI / 2 + Math.PI * i / 60; const r = big * Math.cos(t) ** 2; c.push([r * Math.cos(t), r * Math.sin(t) * 0.75]); } const cs = []; for (let i = 0; i <= 30; i++) { const t = Math.PI / 2 + Math.PI * i / 30; const r = small * Math.cos(t) ** 2; cs.push([r * Math.cos(t), r * Math.sin(t) * 0.75]); } return [c, cs].map(pl => pl.map(([x, y]) => P(0.5 + x * Math.cos(ang) - y * Math.sin(ang), 0.5 + x * Math.sin(ang) + y * Math.cos(ang)))); };
  const angs = n === 2 ? [0, Math.PI] : n === 3 ? [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6] : [-Math.PI / 2, Math.PI / 2 - 0.35 + Math.PI / 2 * 0.9, 0.4, Math.PI - 0.4];
  for (const a of angs) o.push(...lobe(a));
  return o;
}
function reactionProfile() {
  const o = profile(x => 0.25 + 0.6 * Math.exp(-sq(x - 0.5) / 0.012) - 0.18 * (1 / (1 + Math.exp(-(x - 0.5) * 18))), 0, 1, { center: false });
  o.push(...dashed([P(0.02, 0.92 - 0.25 / 0.85 * 0.86), P(0.5, 0.92 - 0.25 / 0.85 * 0.86)]));
  return o;
}
function unitCell(kind) {
  const d = 0.25, o = [...poly([P(0, d), P(1 - d, d), P(1 - d, 1), P(0, 1)]), [P(0, d), P(d, 0), P(1, 0), P(1 - d, d)], [P(1, 0), P(1, 1 - d), P(1 - d, 1)], ...dashed([P(d, 0), P(d, 1 - d), P(1, 1 - d)]), ...dashed([P(d, 1 - d), P(0, 1)])];
  const corners = [[0, d], [1 - d, d], [1 - d, 1], [0, 1], [d, 0], [1, 0], [1, 1 - d], [d, 1 - d]];
  for (const [x, y] of corners) o.push(...ell(x, y, 0.045, 0.045, 0, 2 * Math.PI, 14));
  if (kind === 'ccc') o.push(...ell(0.5, 0.5, 0.05, 0.05, 0, 2 * Math.PI, 14));
  if (kind === 'cfc') for (const [x, y] of [[(1 - d) / 2, (1 + d) / 2], [(1 + d) / 2, (1 - d) / 2], [d / 2, 0.5], [1 - d / 2, 0.5], [0.5, d / 2], [0.5, 1 - d / 2]]) o.push(...ell(x, y, 0.04, 0.04, 0, 2 * Math.PI, 14));
  return o;
}

SHAPES.push(
  // óptica geométrica
  { id: 'g-conv-2f', cat: 'geom', label: 'Lente conv.: objeto além de 2F', gen: () => rayDiagram('lens', 1, 2.7), aspect: 0.55 },
  { id: 'g-conv-em2f', cat: 'geom', label: 'Lente conv.: objeto em 2F', gen: () => rayDiagram('lens', 1, 2), aspect: 0.55 },
  { id: 'g-conv-f2f', cat: 'geom', label: 'Lente conv.: entre F e 2F', gen: () => rayDiagram('lens', 1, 1.5), aspect: 0.55 },
  { id: 'g-conv-f', cat: 'geom', label: 'Lente conv.: objeto no foco', gen: () => rayDiagram('lens', 1, 1), aspect: 0.55 },
  { id: 'g-conv-lupa', cat: 'geom', label: 'Lente conv.: antes do foco (lupa)', gen: () => rayDiagram('lens', 1, 0.6), aspect: 0.55 },
  { id: 'g-div', cat: 'geom', label: 'Lente divergente', gen: () => rayDiagram('lens', -1, 2), aspect: 0.55 },
  { id: 'g-conc-c', cat: 'geom', label: 'Espelho côncavo: além de C', gen: () => rayDiagram('mirror', 1, 2.7), aspect: 0.55 },
  { id: 'g-conc-cf', cat: 'geom', label: 'Espelho côncavo: entre C e F', gen: () => rayDiagram('mirror', 1, 1.5), aspect: 0.55 },
  { id: 'g-conc-fv', cat: 'geom', label: 'Espelho côncavo: entre F e V', gen: () => rayDiagram('mirror', 1, 0.6), aspect: 0.55 },
  { id: 'g-convx', cat: 'geom', label: 'Espelho convexo', gen: () => rayDiagram('mirror', -1, 1.6), aspect: 0.55 },
  { id: 'g-plano', cat: 'geom', label: 'Espelho plano', gen: () => { const o = [[P(0.5, 0.05), P(0.5, 0.95)]]; for (let i = 0; i < 9; i++) o.push([P(0.5, 0.08 + i * 0.1), P(0.53, 0.05 + i * 0.1)]); o.push(...arrow(0.2, 0.75, 0.2, 0.35, 0.04), ...dashed([P(0.8, 0.75), P(0.8, 0.35)]), [P(0.785, 0.39), P(0.8, 0.35), P(0.815, 0.39)]); o.push([P(0.2, 0.35), P(0.5, 0.55), P(0.14, 0.79)], ...dashed([P(0.5, 0.55), P(0.8, 0.35)])); o.push([P(0.05, 0.75), P(0.95, 0.75)].length ? [P(0.05, 0.75), P(0.48, 0.75)] : []); return o; }, aspect: 0.6 },
  { id: 'g-snell', cat: 'geom', label: 'Refração (Snell)', gen: () => snell(45, 1, 1.5), aspect: 0.75 },
  { id: 'g-rti', cat: 'geom', label: 'Reflexão total interna', gen: () => snell(55, 1.5, 1), aspect: 0.75 },
  { id: 'g-prisma', cat: 'geom', label: 'Prisma (dispersão)', gen: () => { const o = poly([P(0.5, 0.05), P(0.82, 0.8), P(0.18, 0.8)]); o.push([P(0, 0.62), P(0.35, 0.45)]); const ang = [0.2, 0.28, 0.36, 0.44, 0.52]; for (const a of ang) o.push([P(0.35, 0.45), P(0.66, 0.42 + a * 0.18), P(1, 0.5 + a * 0.9)]); return o; }, aspect: 0.7 },
  { id: 'g-olho', cat: 'geom', label: 'Olho (míope/hipermétrope)', gen: () => { const o = [...ell(0.6, 0.5, 0.36, 0.42), ...ell(0.27, 0.5, 0.05, 0.16)]; o.push([P(0, 0.3), P(0.27, 0.36), P(0.95, 0.5)], [P(0, 0.7), P(0.27, 0.64), P(0.95, 0.5)]); return o; }, aspect: 0.8 },

  // hidrogênio: densidade |ψ|² no plano xz (e ψ com sinal)
  { id: 'h-1s', cat: 'hidro', label: 'H 1s |ψ|²', kind: 'img', gamma: 0.5, field: hydrogen(1, 0, 's', false, 6) },
  { id: 'h-2s', cat: 'hidro', label: 'H 2s |ψ|²', kind: 'img', gamma: 0.45, field: hydrogen(2, 0, 's', false, 16) },
  { id: 'h-2p', cat: 'hidro', label: 'H 2p_z |ψ|²', kind: 'img', gamma: 0.5, field: hydrogen(2, 1, 'pz', false, 14) },
  { id: 'h-3s', cat: 'hidro', label: 'H 3s |ψ|²', kind: 'img', gamma: 0.4, field: hydrogen(3, 0, 's', false, 28) },
  { id: 'h-3p', cat: 'hidro', label: 'H 3p_z |ψ|²', kind: 'img', gamma: 0.45, field: hydrogen(3, 1, 'pz', false, 26) },
  { id: 'h-3dz2', cat: 'hidro', label: 'H 3d_z² |ψ|²', kind: 'img', gamma: 0.5, field: hydrogen(3, 2, 'dz2', false, 22) },
  { id: 'h-3dxz', cat: 'hidro', label: 'H 3d_xz |ψ|²', kind: 'img', gamma: 0.5, field: hydrogen(3, 2, 'dxz', false, 22) },
  { id: 'h-4fz3', cat: 'hidro', label: 'H 4f_z³ |ψ|²', kind: 'img', gamma: 0.5, field: hydrogen(4, 3, 'fz3', false, 34) },
  { id: 'h-2p-s', cat: 'hidro', label: 'ψ 2p_z (sinal)', kind: 'img', signed: true, field: hydrogen(2, 1, 'pz', true, 14) },
  { id: 'h-3dz2-s', cat: 'hidro', label: 'ψ 3d_z² (sinal)', kind: 'img', signed: true, field: hydrogen(3, 2, 'dz2', true, 22) },
  { id: 'h-3dxz-s', cat: 'hidro', label: 'ψ 3d_xz (sinal)', kind: 'img', signed: true, field: hydrogen(3, 2, 'dxz', true, 22) },
  { id: 'h-r1s', cat: 'hidro', label: 'P(r) 1s', gen: () => radial(1, 0), aspect: 0.6 },
  { id: 'h-r2s', cat: 'hidro', label: 'P(r) 2s', gen: () => radial(2, 0), aspect: 0.6 },
  { id: 'h-r2p', cat: 'hidro', label: 'P(r) 2p', gen: () => radial(2, 1), aspect: 0.6 },
  { id: 'h-r3s', cat: 'hidro', label: 'P(r) 3s', gen: () => radial(3, 0), aspect: 0.6 },
  { id: 'h-r3d', cat: 'hidro', label: 'P(r) 3d', gen: () => radial(3, 2), aspect: 0.6 },
  { id: 'h-niveis', cat: 'hidro', label: 'Níveis e séries (Lyman, Balmer)', gen: () => { const o = [], Y = n => 0.94 - 0.88 * (1 - 1 / (n * n)); for (const n of [1, 2, 3, 4, 5]) { o.push([P(0.15, Y(n)), P(0.95, Y(n))]); if (n <= 3) o.push(...label('n=' + n, 0.075, Y(n), 0.035, 0.7)); } o.push(...dashed([P(0.15, 0.06), P(0.95, 0.06)])); o.push(...label('∞', 0.08, 0.06, 0.035, 0.7)); for (const [k, n] of [[0, 2], [1, 3], [2, 4]]) o.push(...arrow(0.22 + k * 0.06, Y(n), 0.22 + k * 0.06, Y(1), 0.025)); for (const [k, n] of [[0, 3], [1, 4], [2, 5]]) o.push(...arrow(0.55 + k * 0.06, Y(n), 0.55 + k * 0.06, Y(2), 0.025)); return o; }, aspect: 0.9 },
  { id: 'y00', cat: 'hidro', label: '|Y₀₀|', gen: () => ylmPolar(() => 1), aspect: 1, square: true },
  { id: 'y10', cat: 'hidro', label: '|Y₁₀| ∝ cos θ', gen: () => ylmPolar(c => c), aspect: 1, square: true },
  { id: 'y11', cat: 'hidro', label: '|Y₁±₁| ∝ sen θ', gen: () => ylmPolar((c, s) => s), aspect: 1, square: true },
  { id: 'y20', cat: 'hidro', label: '|Y₂₀| ∝ 3cos²θ−1', gen: () => ylmPolar(c => 3 * c * c - 1), aspect: 1, square: true },
  { id: 'y21', cat: 'hidro', label: '|Y₂±₁| ∝ sen θ cos θ', gen: () => ylmPolar((c, s) => s * c), aspect: 1, square: true },
  { id: 'y22', cat: 'hidro', label: '|Y₂±₂| ∝ sen²θ', gen: () => ylmPolar((c, s) => s * s), aspect: 1, square: true },
  { id: 'y30', cat: 'hidro', label: '|Y₃₀| ∝ 5cos³θ−3cos θ', gen: () => ylmPolar(c => 5 * c * c * c - 3 * c), aspect: 1, square: true },
  { id: 'y31', cat: 'hidro', label: '|Y₃±₁| ∝ sen θ(5cos²θ−1)', gen: () => ylmPolar((c, s) => s * (5 * c * c - 1)), aspect: 1, square: true },
  { id: 'q-dupla', cat: 'quant', label: 'Dupla fenda (padrão)', gen: () => profile(x => sq(Math.cos(x * 1.6)) * (x === 0 ? 1 : sq(Math.sin(x * 0.5) / (x * 0.5))), -14, 14), aspect: 0.6 },
  { id: 'q-sg', cat: 'quant', label: 'Stern–Gerlach', gen: () => [...poly([P(0.3, 0.1), P(0.55, 0.1), P(0.55, 0.38), P(0.3, 0.38)]), [P(0.3, 0.9), P(0.42, 0.62), P(0.55, 0.9)], ...arrow(0, 0.5, 0.3, 0.5, 0.04), [P(0.3, 0.5), P(0.55, 0.47), P(0.95, 0.25)], [P(0.3, 0.5), P(0.55, 0.53), P(0.95, 0.75)], ...line(0.95, 0.1, 0.95, 0.9), ...label('N', 0.42, 0.24, 0.1, 0.6), ...label('S', 0.42, 0.8, 0.1, 0.6)], aspect: 0.6 },

  // eletromagnetismo
  { id: 'em-onda3d', cat: 'em', label: 'Onda EM 3D (E ⊥ B ⊥ k)', gen: () => emWave3D('lin'), aspect: 0.6 },
  { id: 'em-ebk', cat: 'em', label: 'Tríade E, B, k', gen: () => triad('k', 'E', 'B'), aspect: 1, square: true },
  { id: 'em-poynting', cat: 'em', label: 'E × B = S (Poynting)', gen: () => triad('S', 'E', 'B'), aspect: 1, square: true },
  { id: 'em-lorentz', cat: 'em', label: 'Força de Lorentz (v, B, F)', gen: () => triad('v', 'F', 'B'), aspect: 1, square: true },
  { id: 'em-dip-lin', cat: 'em', label: 'Dipolo: linhas de campo', gen: () => { const cs = [{ x: 0.35, y: 0.5, q: 1 }, { x: 0.65, y: 0.5, q: -1 }]; return fieldLines(cs, ringStarts(cs[0], 12, 0.04, 1)); }, aspect: 0.8 },
  { id: 'em-iguais', cat: 'em', label: 'Duas cargas iguais', gen: () => { const cs = [{ x: 0.33, y: 0.5, q: 1 }, { x: 0.67, y: 0.5, q: 1 }]; return fieldLines(cs, [...ringStarts(cs[0], 10, 0.04, 1, 0.3), ...ringStarts(cs[1], 10, 0.04, 1, 0.3)]); }, aspect: 0.8 },
  { id: 'em-ima', cat: 'em', label: 'Ímã e linhas de B', gen: () => { const cs = [{ x: 0.36, y: 0.5, q: -1 }, { x: 0.64, y: 0.5, q: 1 }]; const o = fieldLines(cs, [...ringStarts(cs[1], 10, 0.04, 1, 0.3), ...ringStarts(cs[0], 10, 0.04, -1, 0.3)]); o.push(...poly([P(0.33, 0.44), P(0.67, 0.44), P(0.67, 0.56), P(0.33, 0.56)]), ...line(0.5, 0.44, 0.5, 0.56)); o.push(...label('N', 0.6, 0.5, 0.06), ...label('S', 0.4, 0.5, 0.06)); return o; }, aspect: 0.8 },
  { id: 'em-entra', cat: 'em', label: 'B entrando (×)', gen: () => crosses(4), aspect: 1, square: true },
  { id: 'em-sai', cat: 'em', label: 'B saindo (·)', gen: () => dots(4), aspect: 1, square: true },
  { id: 'em-ciclo', cat: 'em', label: 'Carga em B (movimento circular)', gen: () => { const o = crosses(5).map(pl => pl.map(([x, y]) => [x, y])); o.push(...ell(0.5, 0.5, 0.32, 0.32, 0, 2 * Math.PI, 60)); o.push(...ell(0.82, 0.5, 0.035, 0.035), ...arrow(0.82, 0.5, 0.82, 0.25, 0.04), ...arrow(0.79, 0.5, 0.6, 0.5, 0.04)); return o; }, aspect: 1, square: true },
  { id: 'em-faraday', cat: 'em', label: 'Indução (Faraday)', gen: () => { const o = [...ell(0.5, 0.65, 0.32, 0.12)]; for (const x of [0.32, 0.5, 0.68]) o.push(...arrow(x, 0.95, x, 0.1, 0.04)); o.push(...arrow(0.36, 0.78, 0.6, 0.78, 0.035)); o.push(...label('B', 0.86, 0.12, 0.08)); return o; }, aspect: 1 },
  { id: 'em-gauss', cat: 'em', label: 'Superfície gaussiana', gen: () => { const o = [...ell(0.5, 0.5, 0.05, 0.05), ...line(0.47, 0.5, 0.53, 0.5), ...line(0.5, 0.47, 0.5, 0.53), ...dashed(ell(0.5, 0.5, 0.36, 0.36, 0, 2 * Math.PI, 90)[0]), ...dashed(ell(0.5, 0.5, 0.36, 0.1, 0, 2 * Math.PI, 60)[0])]; for (let i = 0; i < 8; i++) { const t = i * Math.PI / 4; o.push(...arrow(0.5 + 0.36 * Math.cos(t), 0.5 + 0.36 * Math.sin(t), 0.5 + 0.48 * Math.cos(t), 0.5 + 0.48 * Math.sin(t), 0.04)); } return o; }, aspect: 1, square: true },
  { id: 'em-pol-lin', cat: 'em', label: 'Polarização linear', gen: () => { const o = [...dashed(ell(0.5, 0.5, 0.42, 0.42)[0])]; o.push(...arrow(0.5, 0.5, 0.8, 0.2, 0.05), ...arrow(0.5, 0.5, 0.2, 0.8, 0.05)); return o; }, aspect: 1, square: true },
  { id: 'em-pol-circ', cat: 'em', label: 'Polarização circular (hélice)', gen: () => { const c = []; for (let i = 0; i <= 200; i++) { const s = i / 200, ph = s * 6 * Math.PI; c.push(P(0.06 + 0.86 * s + 0.08 * Math.sin(ph), 0.5 - 0.3 * Math.cos(ph))); } return [c, ...arrow(0.02, 0.5, 1, 0.5, 0.03)]; }, aspect: 0.5 },
  { id: 'em-pol-elip', cat: 'em', label: 'Polarização elíptica', gen: () => [...ell(0.5, 0.5, 0.45, 0.22, 0, 2 * Math.PI, 60).map(c => c.map(([x, y]) => { const a = -0.5, dx = x - 0.5, dy = y - 0.5; return [0.5 + dx * Math.cos(a) - dy * Math.sin(a), 0.5 + dx * Math.sin(a) + dy * Math.cos(a)]; })), ...arrow(0.5, 0.5, 0.86, 0.3, 0.05)], aspect: 1, square: true },
  { id: 'em-espectro', cat: 'em', label: 'Espectro EM (faixas)', gen: () => { const o = [...poly([P(0, 0.35), P(1, 0.35), P(1, 0.65), P(0, 0.65)])]; const cuts = [0.18, 0.34, 0.5, 0.56, 0.7, 0.85]; for (const c of cuts) o.push(...line(c, 0.35, c, 0.65)); const c2 = []; for (let i = 0; i <= 300; i++) { const s = i / 300; c2.push(P(s, 0.2 - 0.08 * Math.sin(2 * Math.PI * Math.pow(3, s * 4) * s * 0.6))); } o.push(c2, ...arrow(0.02, 0.85, 0.98, 0.85, 0.03), ...label('λ', 0.03, 0.93, 0.05, 0.35)); return o; }, aspect: 0.35 },

  // química
  { id: 'qm-benz', cat: 'quim', label: 'Benzeno (aromático)', gen: () => benzene(false), aspect: 1, square: true },
  { id: 'qm-kek', cat: 'quim', label: 'Benzeno (Kekulé)', gen: () => benzene(true), aspect: 1, square: true },
  { id: 'qm-cicloh', cat: 'quim', label: 'Ciclo-hexano (cadeira)', gen: () => [[P(0.05, 0.55), P(0.3, 0.35), P(0.55, 0.5), P(0.75, 0.3), P(0.95, 0.45), P(0.7, 0.65), P(0.45, 0.5), P(0.25, 0.7), P(0.05, 0.55)].map(p => p)], aspect: 0.5 },
  { id: 'qm-agua', cat: 'quim', label: 'Água H₂O', gen: () => { const O = [0.5, 0.35], H1 = [0.2, 0.72], H2 = [0.8, 0.72]; return [...atom(...O, 'O', 0.09, 0.09), ...atom(...H1, 'H'), ...atom(...H2, 'H'), ...bond(O, H1, 1, 0.09), ...bond(O, H2, 1, 0.09), ...ell(0.5, 0.35, 0.16, 0.16, Math.PI / 2 - 0.91, Math.PI / 2 + 0.91, 20)]; }, aspect: 0.8 },
  { id: 'qm-co2', cat: 'quim', label: 'CO₂', gen: () => { const C = [0.5, 0.5], O1 = [0.15, 0.5], O2 = [0.85, 0.5]; return [...atom(...O1, 'O'), ...atom(...C, 'C'), ...atom(...O2, 'O'), ...bond(O1, C, 2), ...bond(C, O2, 2)]; }, aspect: 0.4 },
  { id: 'qm-ch4', cat: 'quim', label: 'Metano CH₄ (tetraedro)', gen: () => { const C = [0.5, 0.5]; const Hs = [[0.5, 0.1], [0.15, 0.72], [0.82, 0.78], [0.75, 0.55]]; return [...atom(...C, 'C'), ...atom(...Hs[0], 'H', 0.06, 0.07), ...atom(...Hs[1], 'H', 0.06, 0.07), ...atom(...Hs[2], 'H', 0.06, 0.07), ...atom(0.88, 0.45, 'H', 0.06, 0.07), ...bond(C, Hs[0], 1, 0.07, 0.06), ...bond(C, Hs[1], 1, 0.07, 0.06), ...wedge([0.56, 0.54], [0.78, 0.74]), ...hashw([0.57, 0.48], [0.82, 0.45])]; }, aspect: 1, square: true },
  { id: 'qm-nh3', cat: 'quim', label: 'Amônia NH₃', gen: () => { const N = [0.5, 0.35]; return [...atom(...N, 'N'), ...atom(0.2, 0.72, 'H', 0.06, 0.07), ...atom(0.8, 0.72, 'H', 0.06, 0.07), ...atom(0.55, 0.85, 'H', 0.06, 0.07), ...bond(N, [0.2, 0.72], 1, 0.07, 0.06), ...bond(N, [0.8, 0.72], 1, 0.07, 0.06), ...wedge([0.51, 0.43], [0.54, 0.78]), ...ell(0.5, 0.12, 0.05, 0.03, 0, 2 * Math.PI, 12), ...ell(0.47, 0.12, 0.008, 0.008, 0, 2 * Math.PI, 6), ...ell(0.53, 0.12, 0.008, 0.008, 0, 2 * Math.PI, 6)]; }, aspect: 1, square: true },
  { id: 'qm-eteno', cat: 'quim', label: 'Eteno C₂H₄', gen: () => { const C1 = [0.38, 0.5], C2 = [0.62, 0.5]; const o = [...atom(...C1, 'C'), ...atom(...C2, 'C'), ...bond(C1, C2, 2)]; for (const [h, c] of [[[0.12, 0.2], C1], [[0.12, 0.8], C1], [[0.88, 0.2], C2], [[0.88, 0.8], C2]]) o.push(...atom(...h, 'H', 0.06, 0.07), ...bond(c, h, 1, 0.07, 0.06)); return o; }, aspect: 0.6 },
  { id: 'qm-n2', cat: 'quim', label: 'N₂ (ligação tripla)', gen: () => [...atom(0.25, 0.5, 'N'), ...atom(0.75, 0.5, 'N'), ...bond([0.25, 0.5], [0.75, 0.5], 3)], aspect: 0.4 },
  { id: 'qm-ligacao', cat: 'quim', label: 'Ligações (simples, dupla, tripla)', gen: () => [...bond([0.05, 0.2], [0.95, 0.2], 1, 0, 0), ...bond([0.05, 0.5], [0.95, 0.5], 2, 0, 0), ...bond([0.05, 0.8], [0.95, 0.8], 3, 0, 0)], aspect: 0.5 },
  { id: 'qm-bohr', cat: 'quim', label: 'Modelo de Bohr (Na: 2, 8, 1)', gen: () => bohr(3, [2, 8, 1]), aspect: 1, square: true },
  { id: 'qm-rutherford', cat: 'quim', label: 'Átomo (órbitas)', gen: () => { const o = [...ell(0.5, 0.5, 0.05, 0.05)]; for (const a of [0, Math.PI / 3, -Math.PI / 3]) o.push(...ell(0.5, 0.5, 0.46, 0.15, 0, 2 * Math.PI, 60).map(c => c.map(([x, y]) => { const dx = x - 0.5, dy = y - 0.5; return [0.5 + dx * Math.cos(a) - dy * Math.sin(a), 0.5 + dx * Math.sin(a) + dy * Math.cos(a)]; }))); return o; }, aspect: 1, square: true },
  { id: 'qm-elemento', cat: 'quim', label: 'Quadro do elemento (C)', gen: () => [...poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)]), ...textPl('6', 0.08, 0.08, 0.14), ...label('C', 0.5, 0.5, 0.36)], aspect: 1, square: true },
  { id: 'qm-tabela', cat: 'quim', label: 'Tabela periódica (esqueleto)', gen: periodicTable, aspect: 0.56 },
  { id: 'qm-om', cat: 'quim', label: 'Orbitais moleculares (H₂)', gen: moDiagram, aspect: 0.8 },
  { id: 'qm-sp', cat: 'quim', label: 'Híbrido sp', gen: () => hybrid(2), aspect: 0.6 },
  { id: 'qm-sp2', cat: 'quim', label: 'Híbrido sp²', gen: () => hybrid(3), aspect: 1, square: true },
  { id: 'qm-sp3', cat: 'quim', label: 'Híbrido sp³', gen: () => hybrid(4), aspect: 1, square: true },
  { id: 'qm-energia', cat: 'quim', label: 'Energia de reação (Eₐ)', gen: reactionProfile, aspect: 0.6 },
  { id: 'qm-ccc', cat: 'quim', label: 'Célula cúbica de corpo centrado', gen: () => unitCell('ccc'), aspect: 1, square: true },
  { id: 'qm-cfc', cat: 'quim', label: 'Célula cúbica de faces centradas', gen: () => unitCell('cfc'), aspect: 1, square: true },
  { id: 'qm-bequer', cat: 'quim', label: 'Béquer', gen: () => flaskShape('bequer'), aspect: 1.1 },
  { id: 'qm-erlen', cat: 'quim', label: 'Erlenmeyer', gen: () => flaskShape('erlen'), aspect: 1.2 },
  { id: 'qm-balao', cat: 'quim', label: 'Balão volumétrico', gen: () => flaskShape('balao'), aspect: 1.5 },
  { id: 'qm-tubo', cat: 'quim', label: 'Tubo de ensaio', gen: () => flaskShape('tubo'), aspect: 1.6 },
);
