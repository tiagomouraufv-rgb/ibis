// Leitura dos arquivos de página do reMarkable (formato "lines" versão 6, OS 3.x).
// O formato não é publicado pela reMarkable; esta leitura segue o que a comunidade documentou
// (projeto rmscene) e foi conferida com um arquivo de um rM2 com OS 3.28.
// Devolve só o que o app usa: traços (caneta, marca-texto à mão) e destaques presos ao texto (glifos).
// Coordenadas no sistema da página do reMarkable: x a partir do meio, y a partir do topo, 226 por polegada.

const HEADER = 'reMarkable .lines file, version=6';

class Rd {
  constructor(u8, i = 0, end = u8.length) { this.u = u8; this.i = i; this.end = end; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  more() { return this.i < this.end; }
  u8() { return this.u[this.i++]; }
  vu() { let r = 0, sh = 0; for (;;) { const c = this.u[this.i++]; r += (c & 0x7f) * Math.pow(2, sh); sh += 7; if (c < 0x80 || this.i >= this.end) return r; } }
  // campo marcado: (índice << 4) | tipo. Tipos: 1 byte, 4 = 4 bytes, 8 = 8 bytes, 0xC = sub-bloco, 0xF = id
  fields() {
    const out = [];
    while (this.i < this.end) {
      const t = this.vu(), idx = Math.floor(t / 16), typ = t & 15;
      let v;
      if (typ === 1) v = this.u8();
      else if (typ === 4) { v = { i: this.dv.getInt32(this.i, true), f: this.dv.getFloat32(this.i, true) }; this.i += 4; }
      else if (typ === 8) { v = this.dv.getFloat64(this.i, true); this.i += 8; }
      else if (typ === 0xC) { const n = this.dv.getUint32(this.i, true); this.i += 4; v = { s: this.i, e: this.i + n }; this.i += n; }
      else if (typ === 0xF) { const a = this.u8(); v = a + ':' + this.vu(); }
      else throw new Error('campo desconhecido ' + typ);
      out.push({ idx, typ, v });
    }
    return out;
  }
}
const get = (fs, idx, typ) => { const f = fs.find(x => x.idx === idx && (typ === undefined || x.typ === typ)); return f ? f.v : undefined; };

function utf8(u8) { try { return new TextDecoder('utf-8').decode(u8); } catch (e) { let s = ''; for (const c of u8) s += String.fromCharCode(c); return s; } }

export function parseRmV6(u8) {
  const out = { lines: [], glyphs: [] };
  let head = ''; for (let i = 0; i < 43 && i < u8.length; i++) head += String.fromCharCode(u8[i]);
  if (!head.startsWith(HEADER)) throw new Error('não é um arquivo .rm versão 6');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 43;
  while (p + 8 <= u8.length) {
    const len = dv.getUint32(p, true), ver = u8[p + 6], type = u8[p + 7];
    const s = p + 8, e = Math.min(u8.length, s + len);
    p = s + len;
    if (type !== 5 && type !== 3) continue;
    let fs;
    try { fs = new Rd(u8, s, e).fields(); } catch (x) { continue; }
    const item = get(fs, 2, 0xF);
    const val = get(fs, 6, 0xC);
    if (!val) continue;            // item apagado (só o registro de que existiu)
    const kind = u8[val.s];
    let vf;
    try { vf = new Rd(u8, val.s + 1, val.e).fields(); } catch (x) { continue; }
    if (type === 5 && kind === 3) {
      const tool = (get(vf, 1, 4) || {}).i, color = (get(vf, 2, 4) || {}).i, thick = get(vf, 3, 8);
      const argbF = get(vf, 8, 4);
      const pts = get(vf, 5, 0xC);
      const list = [];
      if (pts) {
        const size = ver >= 2 ? 14 : 24;
        for (let q = pts.s; q + size <= pts.e; q += size) {
          if (size === 14) list.push([dv.getFloat32(q, true), dv.getFloat32(q + 4, true), dv.getUint16(q + 10, true) / 4, u8[q + 13] / 255]);
          else list.push([dv.getFloat32(q, true), dv.getFloat32(q + 4, true), dv.getFloat32(q + 16, true), dv.getFloat32(q + 20, true)]);
        }
      }
      if (list.length) out.lines.push({ id: item, tool, color, argb: argbF ? argbF.i >>> 0 : null, thick, pts: list });
    } else if (type === 3 && kind === 1) {
      const color = (get(vf, 4, 4) || {}).i;
      const argbF = get(vf, 10, 4);
      const tx = get(vf, 5, 0xC);
      let text = '';
      if (tx) { const r = new Rd(u8, tx.s, tx.e); const n = r.vu(); r.u8(); text = utf8(u8.subarray(r.i, Math.min(r.i + n, tx.e))); }
      const rc = get(vf, 6, 0xC);
      const rects = [];
      if (rc) { const r = new Rd(u8, rc.s, rc.e); const n = r.vu(); for (let k = 0; k < n && r.i + 32 <= rc.e; k++) { rects.push([dv.getFloat64(r.i, true), dv.getFloat64(r.i + 8, true), dv.getFloat64(r.i + 16, true), dv.getFloat64(r.i + 24, true)]); r.i += 32; } }
      out.glyphs.push({ id: item, text, rects, color, argb: argbF ? argbF.i >>> 0 : null });
    }
  }
  return out;
}

// ferramentas do reMarkable -> app
const MARKERS = new Set([5, 18]);           // marca-texto (v1 e v2)
export function isHighlighterTool(t) { return MARKERS.has(t); }
const PALETTE = { 0: '#16191D', 1: '#7F7F7F', 2: '#FFFFFF', 3: '#FBE84B', 4: '#8BD17C', 5: '#F48FB1', 6: '#3B6FD8', 7: '#D33B3B', 8: '#9E9E9E', 10: '#5BB85B', 11: '#4FC3D9', 12: '#C04FC0', 13: '#F2D33B' };
const HL_PALETTE = { 3: '#FBE84B', 4: '#A6E3A1', 5: '#F7A8C8', 8: '#C8C8C8', 9: '#FBE84B' };
export function rmColor(color, argb, highlighter) {
  if (argb !== null && argb !== undefined && (argb >>> 24) > 0) return '#' + (argb & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  return (highlighter ? HL_PALETTE[color] : PALETTE[color]) || (highlighter ? '#FBE84B' : '#16191D');
}

// sistema do reMarkable -> pontos do PDF (origem em cima à esquerda), para uma página de largura w (pt)
export const RM_K = 72 / 226;
export function toPdf(x, y, w) { return [x * RM_K + w / 2, y * RM_K]; }

export function b64ToU8(b64) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
