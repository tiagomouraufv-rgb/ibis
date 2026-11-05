// DjVu: sumário (NAVM) e links das páginas (ANTa/ANTz), que o djvu-rs (WebAssembly) não entrega pronto.
// Lê a estrutura do arquivo (IFF), o diretório (DIRM) e descomprime os pedaços em BZZ.
// O decodificador BZZ/ZP abaixo é uma tradução para JavaScript do djvu-zp e do djvu-bzz (crates do djvu-rs,
// licença MIT, Copyright (c) Vladislav Matyushkin), escritos a partir da especificação pública do DjVu 3.

// ---------- ZP (codificador aritmético) ----------
const PROB = new Uint16Array([32768,32768,32768,27581,27581,23877,23877,20921,20921,18451,18451,16341,16341,14513,14513,12917,12917,11517,11517,10277,10277,9131,9131,8071,8071,7099,7099,6213,6213,5411,5411,4691,4691,4047,4047,3477,3477,2973,2973,2531,2531,2145,2145,1809,1809,1521,1521,1273,1273,1061,1061,881,881,729,729,601,601,493,493,403,403,329,329,267,267,213,213,165,165,123,123,87,87,59,59,35,35,19,19,7,7,1,1,22165,9454,32768,3376,18458,1153,13689,378,9455,123,6520,40,4298,13,2909,52,1930,160,1295,279,856,490,564,324,371,564,245,851,161,1477,282,975,426,645,646,427,979,282,1477,186,2221,122,3276,491,4866,742,7041,1118,9455,1680,10341,2526,14727,3528,11417,4298,15199,2909,22165,1930,32768,1295,9454,856,3376,564,1153,371,378,245,123,161,40,282,13,426,52,646,160,979,279,1477,490,2221,324,3276,564,4866,851,7041,1477,9455,975,11124,645,8221,427,5909,282,4023,186,2663,491,1767,742,1174,1118,781,1680,518,2526,341,3528,225,11124,148,8221,392,5909,594,4023,899,2663,1351,1767,2018,1174,3008,781,4472,518,6618,341,9455,225,12814,148,17194,392,17533,594,24270,899,32768,1351,18458,2018,13689,3008,9455,4472,6520,6618,10341,9455,14727,12814,11417,17194,15199,17533,22165,24270,32768,32768,22165,18458,18458,32768,32768,32768,32768,32768]);
const THRESHOLD = new Uint16Array([0,0,0,4261,4261,7976,7976,11219,11219,14051,14051,16524,16524,18685,18685,20573,20573,22224,22224,23665,23665,24923,24923,26021,26021,26978,26978,27810,27810,28532,28532,29158,29158,29700,29700,30166,30166,30568,30568,30914,30914,31210,31210,31463,31463,31678,31678,31861,31861,32015,32015,32145,32145,32254,32254,32346,32346,32422,32422,32486,32486,32538,32538,32581,32581,32619,32619,32653,32653,32682,32682,32707,32707,32727,32727,32743,32743,32754,32754,32762,32762,32767,32767,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
const MPS_NEXT = new Uint8Array([84,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,81,82,9,86,5,88,89,90,91,92,93,94,95,96,97,82,99,76,101,70,103,66,105,106,107,66,109,60,111,56,69,114,65,116,61,118,57,120,53,122,49,124,43,72,39,60,33,56,29,52,23,48,23,42,137,38,21,140,15,142,9,144,141,146,147,148,149,150,151,152,153,154,155,70,157,66,81,62,75,58,69,54,65,50,167,44,65,40,59,34,55,30,175,24,177,178,179,180,181,182,183,184,69,186,59,188,55,190,51,192,47,194,41,196,37,198,199,72,201,62,203,58,205,54,207,50,209,46,211,40,213,36,215,30,217,26,219,20,71,14,61,14,57,8,53,228,49,230,45,232,39,234,35,138,29,24,25,240,19,22,13,16,13,10,7,244,249,10,89,230,0,0,0,0,0]);
const LPS_NEXT = new Uint8Array([145,4,3,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,85,226,6,176,143,138,141,112,135,104,133,100,129,98,127,72,125,102,123,60,121,110,119,108,117,54,115,48,113,134,59,132,55,130,51,128,47,126,41,62,37,66,31,54,25,50,131,46,17,40,15,136,7,32,139,172,9,170,85,168,248,166,247,164,197,162,95,160,173,158,165,156,161,60,159,56,71,52,163,48,59,42,171,38,169,32,53,26,47,174,193,18,191,222,189,218,187,216,185,214,61,212,53,210,49,208,45,206,39,204,195,202,31,200,243,64,239,56,237,52,235,48,233,44,231,38,229,34,227,28,225,22,223,16,221,220,63,8,55,224,51,2,47,87,43,246,37,244,33,238,27,236,21,16,15,8,241,242,7,10,245,2,1,83,250,2,143,246,0,0,0,0,0]);

function lead1(a) { let n = 0; for (let b = 15; b >= 0 && (a >> b) & 1; b--) n++; return n; }

class Zp {
  constructor(data) {
    if (data.length < 2) throw new Error('ZP: dados curtos');
    this.d = data; this.pos = 0; this.a = 0; this.bitBuf = 0; this.bitCount = 0;
    const hi = this.rb(), lo = this.rb();
    this.c = (hi << 8) | lo;
    this.refill();
    this.fence = Math.min(this.c, 0x7fff);
  }
  rb() { const b = this.pos < this.d.length ? this.d[this.pos] : 0xff; this.pos++; return b; }
  refill() { while (this.bitCount <= 24) { this.bitBuf = ((this.bitBuf << 8) | this.rb()) >>> 0; this.bitCount += 8; } }
  renorm() {
    const shift = lead1(this.a & 0xffff);
    this.bitCount -= shift;
    this.a = (this.a << shift) & 0xffff;
    const mask = (1 << shift) - 1;
    this.c = ((this.c << shift) | ((this.bitBuf >>> this.bitCount) & mask)) & 0xffff;
    if (this.bitCount < 16) this.refill();
    this.fence = Math.min(this.c, 0x7fff);
  }
  bit(ctx, i) {
    const state = ctx[i], mps = state & 1;
    const z = this.a + PROB[state];
    if (z <= this.fence) { this.a = z; return mps; }
    const zc = Math.min(z, 0x6000 + ((this.a + z) >> 2));
    if (zc > this.c) {
      const comp = 0x10000 - zc;
      this.a = (this.a + comp) & 0xffff; this.c = (this.c + comp) & 0xffff;
      ctx[i] = LPS_NEXT[state];
      this.renorm();
      return 1 - mps;
    }
    if (this.a >= THRESHOLD[state]) ctx[i] = MPS_NEXT[state];
    this.bitCount -= 1;
    this.a = (zc << 1) & 0xffff;
    this.c = ((this.c << 1) | ((this.bitBuf >>> this.bitCount) & 1)) & 0xffff;
    if (this.bitCount < 16) this.refill();
    this.fence = Math.min(this.c, 0x7fff);
    return mps;
  }
  pass() {
    const z = (0x8000 + (this.a >> 1)) & 0xffff;
    if (z > this.c) {
      const comp = 0x10000 - z;
      this.a = (this.a + comp) & 0xffff; this.c = (this.c + comp) & 0xffff;
      this.renorm();
      return 1;
    }
    this.bitCount -= 1;
    this.a = (z * 2) & 0xffff;
    this.c = ((this.c << 1) | ((this.bitBuf >>> this.bitCount) & 1)) & 0xffff;
    if (this.bitCount < 16) this.refill();
    this.fence = Math.min(this.c, 0x7fff);
    return 0;
  }
}

// ---------- BZZ ----------
export function bzzDecode(data) {
  const zp = new Zp(data);
  const ctx = new Uint8Array(300);
  const parts = []; let total = 0;
  const raw = n => { const lim = 1 << n; let v = 1; while (v < lim) v = (v << 1) | zp.pass(); return v - lim; };
  for (;;) {
    const size = raw(24);
    if (!size) break;
    if (size > 4 * 1024 * 1024) throw new Error('BZZ: bloco grande demais');
    const blk = block(zp, ctx, size);
    parts.push(blk); total += blk.length;
    if (total > 64 * 1024 * 1024) throw new Error('BZZ: saída grande demais');
  }
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function block(zp, ctx, size) {
  let fshift = 0;
  if (zp.pass()) { fshift++; if (zp.pass()) fshift++; }
  const mtf = new Uint8Array(256); for (let i = 0; i < 256; i++) mtf[i] = i;
  const freq = new Uint32Array(4);
  let fadd = 4, last = 3, marker = -1;
  const bwt = new Uint8Array(size);
  const bits = (base, n) => { const off = base - 1, lim = 1 << n; let v = 1; while (v < lim) v = (v << 1) | zp.bit(ctx, off + v); return v - lim; };
  for (let k = 0; k < size; k++) {
    if ((k & 4095) === 0 && zp.pos - zp.d.length > 16) throw new Error('BZZ: dados cortados');
    const cid = Math.min(last, 2);
    let mp, off = 0;
    if (zp.bit(ctx, off + cid)) mp = 0;
    else {
      off += 3;
      if (zp.bit(ctx, off + cid)) mp = 1;
      else {
        off += 3;
        mp = 256;
        for (let lev = 1, add = 2; lev <= 7; lev++, add *= 2) {
          if (zp.bit(ctx, off)) { mp = add + bits(off + 1, lev); break; }
          off += add;
        }
      }
    }
    last = mp;
    if (mp === 256) { bwt[k] = 0; marker = k; continue; }
    const sym = mtf[mp];
    bwt[k] = sym;
    fadd = (fadd + (fadd >>> fshift)) >>> 0;
    if (fadd > 0x10000000) { fadd >>>= 24; for (let f = 0; f < 4; f++) freq[f] >>>= 24; }
    let comb = fadd;
    if (mp < 4) comb = Math.min(0xffffffff, comb + freq[mp]);
    let at = mp;
    if (at >= 4) { mtf.copyWithin(4, 3, at); at = 3; }
    while (at > 0) {
      const pf = freq[at - 1];
      if (comb >= pf) { mtf[at] = mtf[at - 1]; freq[at] = pf; at--; } else break;
    }
    mtf[at] = sym; freq[at] = comb;
  }
  if (marker < 0) throw new Error('BZZ: sem marcador');
  return unbwt(bwt, marker);
}

function unbwt(b, marker) {
  const n = b.length;
  if (!n) return new Uint8Array(0);
  const cnt = new Uint32Array(256), rank = new Uint32Array(n);
  for (let i = 0; i < n; i++) { if (i === marker) continue; const v = b[i]; rank[i] = (v << 24 >>> 0) | (cnt[v] & 0xffffff); cnt[v]++; }
  const start = new Uint32Array(256); let run = 1;
  for (let v = 0; v < 256; v++) { start[v] = run; run += cnt[v]; }
  const out = new Uint8Array(n - 1);
  let f = 0, rem = n - 1;
  while (rem > 0) { const e = rank[f]; const v = e >>> 24; rem--; out[rem] = v; f = start[v] + (e & 0xffffff); }
  return out;
}

// ---------- estrutura do arquivo (IFF) ----------
const u32 = (d, p) => ((d[p] << 24) >>> 0) + (d[p + 1] << 16) + (d[p + 2] << 8) + d[p + 3];
const id4 = (d, p) => String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
const utf8 = new TextDecoder('utf-8');

// filhos de um FORM: [{id, start, size, type?}] (start = início dos dados)
function chunks(d, from, to) {
  const out = [];
  let p = from;
  while (p + 8 <= to) {
    const id = id4(d, p), size = u32(d, p + 4), start = p + 8;
    if (start + size > d.length) break;
    const c = { id, start, size };
    if (id === 'FORM') c.type = id4(d, start);
    out.push(c);
    p = start + size + (size & 1);
  }
  return out;
}

function dirmComponents(d, c, nfilesOut) {
  const flags = d[c.start], n = (d[c.start + 1] << 8) | d[c.start + 2];
  const bundled = (flags & 0x80) !== 0;
  let p = c.start + 3;
  const offsets = [];
  if (bundled) { for (let i = 0; i < n; i++) offsets.push(u32(d, p + i * 4)); p += n * 4; }
  const meta = bzzDecode(d.subarray(p, c.start + c.size));
  const comps = [];
  let q = n * 3;
  const fl = [];
  for (let i = 0; i < n; i++) fl.push(meta[q + i]);
  q += n;
  const str = () => { let e = q; while (e < meta.length && meta[e]) e++; const s = utf8.decode(meta.subarray(q, e)); q = e + 1; return s; };
  for (let i = 0; i < n; i++) {
    const f = fl[i];
    const id = str();
    const name = f & 0x80 ? str() : '';
    const title = f & 0x40 ? str() : '';
    comps.push({ id, name, title, kind: f & 0x3f, offset: offsets[i] });
  }
  return comps;
}

function navm(d, c) {
  const x = bzzDecode(d.subarray(c.start, c.start + c.size));
  if (x.length < 2) return [];
  const total = (x[0] << 8) | x[1];
  let p = 2, count = 0;
  const s3 = () => { const n = (x[p] << 16) | (x[p + 1] << 8) | x[p + 2]; p += 3; const s = utf8.decode(x.subarray(p, p + n)); p += n; return s; };
  const entry = depth => {
    if (depth > 64 || p >= x.length) throw new Error('NAVM inválido');
    const nkids = x[p++];
    const title = s3(), url = s3();
    count++;
    const items = [];
    for (let i = 0; i < nkids; i++) items.push(entry(depth + 1));
    return { title, url, items };
  };
  const out = [];
  while (count < total && p < x.length) out.push(entry(0));
  return out;
}

// ---------- anotações das páginas (links) ----------
// expressão em parênteses do DjVu: (maparea "url" "comentário" (rect x y w h) ...)
function sexp(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const atom = () => {
    ws();
    if (text[i] === '"') {
      let s = ''; i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\' && i + 1 < text.length) { i++; s += ({ n: '\n', t: '\t' })[text[i]] || text[i]; } else s += text[i]; i++; }
      i++; return s;
    }
    if (text[i] === '(') {
      i++; const l = [];
      for (;;) { ws(); if (i >= text.length) break; if (text[i] === ')') { i++; break; } l.push(atom()); }
      return l;
    }
    let s = ''; while (i < text.length && !/[\s()"]/.test(text[i])) s += text[i++];
    return s;
  };
  const out = [];
  for (;;) { ws(); if (i >= text.length) break; const a = atom(); if (Array.isArray(a)) out.push(a); else if (!a) i++; }
  return out;
}

function pageLinksOf(d, form) {
  const out = [];
  let info = null;
  for (const c of chunks(d, form.start + 4, form.start + form.size)) {
    if (c.id === 'INFO' && c.size >= 4) info = { w: (d[c.start] << 8) | d[c.start + 1], h: (d[c.start + 2] << 8) | d[c.start + 3] };
    if (c.id !== 'ANTa' && c.id !== 'ANTz') continue;
    let raw = d.subarray(c.start, c.start + c.size);
    try { if (c.id === 'ANTz') raw = bzzDecode(raw); } catch (e) { continue; }
    for (const ex of sexp(utf8.decode(raw))) {
      if (ex[0] !== 'maparea') continue;
      let url = ex[1];
      if (Array.isArray(url)) url = url[1] || '';
      const area = ex.find((a, k) => k >= 3 && Array.isArray(a) && /^(rect|oval|text|poly)$/.test(a[0]));
      if (!url || !area) continue;
      const nums = area.slice(1).map(Number).filter(v => !isNaN(v));
      let x, y, w, h;
      if (area[0] === 'poly') { const xs = nums.filter((v, k) => k % 2 === 0), ys = nums.filter((v, k) => k % 2 === 1); x = Math.min(...xs); y = Math.min(...ys); w = Math.max(...xs) - x; h = Math.max(...ys) - y; }
      else [x, y, w, h] = nums;
      if (!(w > 0 && h > 0)) continue;
      out.push({ url, x, y, w, h });   // pixels do arquivo, origem embaixo à esquerda
    }
  }
  return { links: out, info };
}

// sumário e links do documento inteiro. Devolve { outline: [{title, url, items}], links: {página: [...]}, ids: {id: página} }
export function djvuMeta(d) {
  const res = { outline: [], links: {}, ids: {} };
  if (!d || d.length < 16 || id4(d, 0) !== 'AT&T' || id4(d, 4) !== 'FORM') return res;
  const top = { start: 12, size: u32(d, 8), type: id4(d, 12) };
  if (top.type === 'DJVU') {
    const r = pageLinksOf(d, { start: 12, size: top.size });
    if (r.links.length) res.links[1] = r.links;
    return res;
  }
  if (top.type !== 'DJVM') return res;
  const kids = chunks(d, 16, 12 + top.size);
  const dirm = kids.find(c => c.id === 'DIRM');
  let comps = [];
  try { if (dirm) comps = dirmComponents(d, dirm); } catch (e) { comps = []; }
  let pg = 0;
  for (const c of comps) {
    if (c.kind !== 1) continue;
    pg++;
    for (const k of [c.id, c.name, c.title]) if (k && !(k in res.ids)) res.ids[k] = pg;
    if (c.offset != null && id4(d, c.offset) === 'FORM') {
      try {
        const r = pageLinksOf(d, { start: c.offset + 8, size: u32(d, c.offset + 4) });
        if (r.links.length) res.links[pg] = r.links;
      } catch (e) { /* página sem links legíveis */ }
    }
  }
  const nav = kids.find(c => c.id === 'NAVM');
  try { if (nav) res.outline = navm(d, nav); } catch (e) { res.outline = []; }
  return res;
}
