// Borracha por área: apaga só o pedaço do traço que fica dentro do círculo (o resto continua).

// pontos mais próximos uns dos outros, para o corte não "pular" o círculo
export function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i) {
      const q = pts[i - 1];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      const n = Math.floor(d / step);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push([+(q[0] + (p[0] - q[0]) * t).toFixed(2), +(q[1] + (p[1] - q[1]) * t).toFixed(2), p[2], Math.round(q[3] + ((p[3] || 0) - (q[3] || 0)) * t)]);
      }
    }
    out.push(p);
  }
  return out;
}

// corta uma lista de trechos (cada trecho = lista de pontos) por um círculo; devolve os trechos que sobram
export function cutSegments(segs, cx, cy, r) {
  const out = [];
  let changed = false;
  for (const seg of segs) {
    let cur = [];
    for (const p of seg) {
      if (Math.hypot(p[0] - cx, p[1] - cy) <= r) { changed = true; if (cur.length > 1) out.push(cur); cur = []; }
      else cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
    else if (cur.length === 1 && seg.length === 1) out.push(cur);
  }
  return { segs: out, changed };
}

export function segPath(segs, strokePath) { return segs.map(s => strokePath(s)).join(' '); }

// tamanhos da borracha (em pixels da tela)
export const ERASER_SIZES = [10, 20, 36, 60];
