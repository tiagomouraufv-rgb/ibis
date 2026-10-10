// Índice de refração (n, k) dos materiais do refractiveindex.info.
// O site não deixa ser aberto dentro de outro app, mas o banco de dados dele é público (CC0) e fica no
// GitHub: o app busca ali o catálogo e os dados de cada material, faz as contas e mostra numa janelinha
// (como a da Wikipédia). Os arquivos baixados ficam guardados no aparelho para usar sem internet.
import { h, clear, toast, copyText, fold } from './util.js';
import { db } from './db.js';
import { openExternal } from './platform.js';
import { fmt, parse } from './calc.js';

const BASE = 'https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/master/database/';
const CAT_KEY = 'nk:catalog', META_KEY = 'nk:meta', WEEK = 7 * 24 * 3600e3, CAT_TTL = WEEK;
const LASERS = [405, 488, 532, 633, 785, 808, 1064, 1550];

// nomes em português -> termos do catálogo (em inglês / fórmula)
const ALIAS = {
  agua: 'water h2o', silicio: 'silicon si', germanio: 'germanium ge', ouro: 'gold au', prata: 'silver ag', aluminio: 'aluminium aluminum al',
  cobre: 'copper cu', vidro: 'glass', silica: 'sio2 silica', quartzo: 'quartz', safira: 'sapphire al2o3', diamante: 'diamond', ar: 'air',
  poliestireno: 'polystyrene', titanio: 'titanium', ferro: 'iron fe', niquel: 'nickel ni', platina: 'platinum pt', cromo: 'chromium cr',
  etanol: 'ethanol', metanol: 'methanol', acetona: 'acetone', glicerol: 'glycerol', glicerina: 'glycerol', oleo: 'oil', oxido: 'oxide',
  nitreto: 'nitride', carbono: 'carbon', grafeno: 'graphene', grafite: 'graphite', arseneto: 'arsenide', galio: 'gallium', indio: 'indium',
  zinco: 'zinc zn', estanho: 'tin sn', chumbo: 'lead pb', tungstenio: 'tungsten w', fosfeto: 'phosphide', seleneto: 'selenide',
  sulfeto: 'sulfide', telureto: 'telluride', fluoreto: 'fluoride', cloreto: 'chloride', brometo: 'bromide', iodeto: 'iodide',
  polimero: 'polymer', poliimida: 'polyimide', silicone: 'pdms silicone', perovskita: 'perovskite', calcita: 'calcite caco3',
  niobato: 'niobate', litio: 'lithium li', sodio: 'sodium na', potassio: 'potassium k', magnesio: 'magnesium mg', calcio: 'calcium ca',
  bario: 'barium ba', zirconia: 'zro2 zirconia', titania: 'tio2 titania', alumina: 'al2o3 alumina', helio: 'helium he', argonio: 'argon ar',
  nitrogenio: 'nitrogen n2', oxigenio: 'oxygen o2', hidrogenio: 'hydrogen h2', tecido: 'tissue', sangue: 'blood', pele: 'skin',
};

// ---------- catálogo ----------
const clean = s => String(s || '').trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function parseCatalog(text) {
  const books = [];
  let shelf = null, shelfName = '', book = null, last = null, bookDiv = '', pageDiv = '';
  for (const line of text.split('\n')) {
    let m = /^\s*- (SHELF|BOOK|PAGE|DIVIDER):\s*(.*)$/.exec(line);
    if (m) {
      const [, kind, v] = m;
      if (kind === 'DIVIDER') {
        const ind = line.search(/\S/);
        if (ind <= 4) bookDiv = clean(v); else pageDiv = clean(v);
        last = null;
      } else if (kind === 'SHELF') { shelf = clean(v); shelfName = ''; last = 'shelf'; }
      else if (kind === 'BOOK') { book = { s: shelf, b: clean(v), n: '', g: bookDiv, sn: shelfName, p: [] }; books.push(book); last = book; pageDiv = ''; }
      else if (kind === 'PAGE' && book) { last = { id: clean(v), n: '', d: '', g: pageDiv }; book.p.push(last); }
      continue;
    }
    m = /^\s*(name|data):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === 'name') { if (last === 'shelf') shelfName = clean(m[2]); else if (last) last.n = clean(m[2]); }
    else if (last && last !== 'shelf' && last.d !== undefined) last.d = clean(m[2]);
  }
  return books.filter(b => b.p.length);
}

let catP = null;
export function catalog(force) {
  if (catP && !force) return catP;
  catP = (async () => {
    const cached = await db.kvGet(CAT_KEY, null);
    if (cached && !force && Date.now() - cached.t < CAT_TTL) return cached.books;
    try {
      const r = await fetch(BASE + 'catalog-nk.yml', { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const books = parseCatalog(await r.text());
      if (!books.length) throw new Error('catálogo vazio');
      await db.kvSet(CAT_KEY, { t: Date.now(), books });
      if (!(await lastUpdate())) await db.kvSet(META_KEY, { t: Date.now() });
      return books;
    } catch (e) {
      if (cached) return cached.books;   // sem internet: usa o que já tinha
      catP = null;
      throw new Error('Não consegui baixar o catálogo do refractiveindex.info (sem internet?).');
    }
  })();
  return catP;
}

export function searchBooks(books, q) {
  const toks = fold(q).toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (!toks.length) return [];
  const scored = [];
  for (const b of books) {
    const hay = ' ' + fold([b.b, b.n, b.g, b.sn, b.s].join(' ')).toLowerCase() + ' ';
    const id = fold(b.b).toLowerCase();
    let sc = 0, ok = true;
    for (const t of toks) {
      const alts = [t].concat(ALIAS[t] ? ALIAS[t].split(' ') : []);
      let best = 0;
      for (const a of alts) {
        if (id === a) best = Math.max(best, 10);
        else if (hay.includes(' ' + a + ' ') || hay.includes('(' + a + ')') || hay.includes(' ' + a + ')')) best = Math.max(best, 6);
        else if (hay.includes(' ' + a)) best = Math.max(best, 3);
        else if (hay.includes(a)) best = Math.max(best, 1);
      }
      if (!best) { ok = false; break; }
      sc += best;
    }
    if (ok) scored.push([sc + (b.s === 'main' ? 1 : 0), b]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].n.localeCompare(b[1].n)).slice(0, 40).map(x => x[1]);
}

// ---------- dados de um material ----------
export function parseData(text) {
  const out = { refs: '', comments: '', data: [] };
  const lines = text.split('\n');
  let i = 0;
  const block = (ind0) => { const acc = []; while (i < lines.length && (lines[i].trim() === '' || lines[i].search(/\S/) > ind0)) { acc.push(lines[i].trim()); i++; } return acc.join('\n').trim(); };
  let cur = null;
  while (i < lines.length) {
    const line = lines[i];
    const ind = line.search(/\S/);
    if (ind < 0 || /^\s*#/.test(line)) { i++; continue; }
    let m = /^(REFERENCES|COMMENTS):\s*\|?\s*(.*)$/.exec(line);
    if (m && ind === 0) { i++; const v = m[2] ? m[2] : block(0); if (m[1] === 'REFERENCES') out.refs = v; else out.comments = v; continue; }
    m = /^\s*-\s*type:\s*(.*)$/.exec(line);
    if (m) { cur = { type: m[1].trim() }; out.data.push(cur); i++; continue; }
    m = /^\s*(data|coefficients|wavelength_range|range):\s*(\|)?\s*(.*)$/.exec(line);
    if (m && cur) {
      i++;
      const v = m[2] ? block(ind) : m[3];
      if (m[1] === 'data') cur.rows = v.split('\n').map(r => r.trim().split(/\s+/).map(Number)).filter(r => r.length >= 2 && r.every(isFinite));
      else if (m[1] === 'coefficients') cur.c = v.trim().split(/\s+/).map(Number);
      else cur.range = v.trim().split(/\s+/).map(Number);
      continue;
    }
    i++;
  }
  return out;
}

// fórmulas de dispersão do refractiveindex.info (λ em µm)
export function formulaN(id, C, l) {
  const c = C.concat(new Array(24).fill(0)), L2 = l * l;
  switch (id) {
    case 1: { let s = 1 + c[0]; for (let i = 1; i < C.length; i += 2) s += c[i] * L2 / (L2 - c[i + 1] * c[i + 1]); return Math.sqrt(s); }
    case 2: { let s = 1 + c[0]; for (let i = 1; i < C.length; i += 2) s += c[i] * L2 / (L2 - c[i + 1]); return Math.sqrt(s); }
    case 3: { let s = c[0]; for (let i = 1; i < C.length; i += 2) s += c[i] * Math.pow(l, c[i + 1]); return Math.sqrt(s); }
    case 4: {
      let s = c[0];
      for (let i = 1; i < Math.min(8, C.length); i += 4) s += c[i] * Math.pow(l, c[i + 1]) / (L2 - Math.pow(c[i + 2], c[i + 3]));
      for (let i = 9; i < C.length; i += 2) s += c[i] * Math.pow(l, c[i + 1]);
      return Math.sqrt(s);
    }
    case 5: { let n = c[0]; for (let i = 1; i < C.length; i += 2) n += c[i] * Math.pow(l, c[i + 1]); return n; }
    case 6: { let n = 1 + c[0]; for (let i = 1; i < C.length; i += 2) n += c[i] / (c[i + 1] - 1 / L2); return n; }
    case 7: { const q = 1 / (L2 - 0.028); let n = c[0] + c[1] * q + c[2] * q * q; for (let i = 3; i < C.length; i++) n += c[i] * Math.pow(l, 2 * (i - 2)); return n; }
    case 8: { const t = c[0] + c[1] * L2 / (L2 - c[2]) + c[3] * L2; return Math.sqrt((2 * t + 1) / (1 - t)); }
    case 9: return Math.sqrt(c[0] + c[1] / (L2 - c[2]) + c[3] * (l - c[4]) / ((l - c[4]) ** 2 + c[5]));
  }
  return NaN;
}
function interp(rows, col, l) {
  if (!rows || !rows.length || rows[0].length <= col) return null;
  if (l < rows[0][0] || l > rows[rows.length - 1][0]) return null;
  let a = 0, b = rows.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (rows[m][0] <= l) a = m; else b = m; }
  const [x0, x1] = [rows[a][0], rows[b][0]];
  const t = x1 > x0 ? (l - x0) / (x1 - x0) : 0;
  return rows[a][col] + t * (rows[b][col] - rows[a][col]);
}
// faixa válida de λ (µm) e função n,k(λ)
export function material(d) {
  let lo = Infinity, hi = -Infinity;
  const parts = [];
  for (const e of d.data) {
    const t = e.type || '';
    let m;
    if ((m = /^formula\s+(\d)/.exec(t)) && e.c) {
      const r = e.range || [0.2, 2]; lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]);
      parts.push({ n: l => formulaN(+m[1], e.c, l), r });
    } else if (/^tabulated/.test(t) && e.rows && e.rows.length) {
      const r = [e.rows[0][0], e.rows[e.rows.length - 1][0]]; lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]);
      if (/nk$/.test(t)) parts.push({ n: l => interp(e.rows, 1, l), k: l => interp(e.rows, 2, l), r });
      else if (/ n$/.test(t)) parts.push({ n: l => interp(e.rows, 1, l), r });
      else if (/ k$/.test(t)) parts.push({ k: l => interp(e.rows, 1, l), r });
    }
  }
  const at = l => {
    let n = null, k = null;
    for (const p of parts) {
      const inR = l >= p.r[0] && l <= p.r[1];
      if (p.n && n === null && inR) { const v = p.n(l); if (isFinite(v)) n = v; }
      if (p.k && k === null && inR) { const v = p.k(l); if (isFinite(v)) k = v; }
    }
    return { n, k };
  };
  return { lo, hi, at, hasK: parts.some(p => p.k) };
}

const pageCache = new Map();
export async function loadPage(path) {
  if (pageCache.has(path)) return pageCache.get(path);
  const key = 'nk:p:' + path;
  let cached = await db.kvGet(key, null);
  if (typeof cached === 'string') cached = { t: 0, text: cached };   // formato antigo
  let text = null;
  if (cached && Date.now() - cached.t < WEEK) text = cached.text;   // ainda novo: nem vai à internet
  else {
    try { text = await fetchPage(path); }
    catch (e) { text = cached && cached.text; if (!text) throw new Error('Não consegui baixar os dados deste material (sem internet?).'); }
  }
  const d = parseData(text);
  pageCache.set(path, d);
  return d;
}
async function fetchPage(path) {
  const r = await fetch(BASE + 'data/' + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = await r.text();
  await db.kvSet('nk:p:' + path, { t: Date.now(), text }).catch(() => {});
  return text;
}

// ---------- atualização semanal ----------
// Uma vez por semana (com internet), baixa de novo o catálogo e os materiais que você já usou, para
// acompanhar as correções e os dados novos do refractiveindex.info.
export async function lastUpdate() { const m = await db.kvGet(META_KEY, null); return m && m.t || 0; }
export async function weeklyUpdate(force) {
  if (!force && (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  const last = await lastUpdate();
  const everUsed = await db.kvGet(CAT_KEY, null);
  if (!everUsed && !force) return false;          // nunca abriu o índice: não baixa nada
  if (!force && Date.now() - last < WEEK) return false;
  await catalog(true);
  const all = await db.all('kv');
  const paths = all.filter(r => String(r.k).startsWith('nk:p:')).map(r => String(r.k).slice(5));
  let n = 0;
  for (const p of paths) { try { await fetchPage(p); pageCache.delete(p); n++; } catch (e) {} await new Promise(r => setTimeout(r, 120)); }
  await db.kvSet(META_KEY, { t: Date.now(), pages: n });
  return true;
}

// ---------- interface ----------
function plot(mat, l, onPick) {
  const W = 300, H = 130, P = { l: 34, r: 30, t: 8, b: 20 };
  const lo = mat.lo, hi = mat.hi;
  const logx = hi / lo > 15;
  const X = v => P.l + (W - P.l - P.r) * (logx ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo));
  const N = 160, ns = [], ks = [];
  for (let i = 0; i <= N; i++) {
    const v = logx ? lo * Math.pow(hi / lo, i / N) : lo + (hi - lo) * i / N;
    const r = mat.at(v);
    if (r.n !== null) ns.push([v, r.n]);
    if (r.k !== null) ks.push([v, r.k]);
  }
  const rng = a => { const ys = a.map(p => p[1]); let a0 = Math.min(...ys), a1 = Math.max(...ys); if (a1 - a0 < 1e-6) { a0 -= 0.05; a1 += 0.05; } return [a0, a1]; };
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (n, at) => { const e = document.createElementNS(svgNS, n); for (const k in at) e.setAttribute(k, at[k]); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nkplot', role: 'img', 'aria-label': 'n e k em função de λ' });
  const line = (pts, yr, cls, side) => {
    if (pts.length < 2) return;
    const Y = v => P.t + (H - P.t - P.b) * (1 - (v - yr[0]) / (yr[1] - yr[0]));
    svg.appendChild(el('path', { d: 'M' + pts.map(p => X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('L'), class: cls, fill: 'none' }));
    const tx = side === 'l' ? 2 : W - P.r + 3;
    svg.appendChild(el('text', { x: tx, y: P.t + 8, class: cls + 't' })).textContent = (side === 'l' ? 'n ' : 'k ') + fmt(yr[1], 3);
    svg.appendChild(el('text', { x: tx, y: H - P.b, class: cls + 't' })).textContent = fmt(yr[0], 3);
  };
  if (ns.length) line(ns, rng(ns), 'nkn', 'l');
  if (ks.length) line(ks, rng(ks), 'nkk', 'r');
  svg.appendChild(el('line', { x1: P.l, x2: W - P.r, y1: H - P.b, y2: H - P.b, class: 'nkax' }));
  const lab = v => (v < 1 ? fmt(v * 1000, 3) + ' nm' : fmt(v, 3) + ' µm');
  svg.appendChild(el('text', { x: P.l, y: H - 4, class: 'nkaxt' })).textContent = lab(lo);
  const t2 = el('text', { x: W - P.r, y: H - 4, class: 'nkaxt', 'text-anchor': 'end' }); t2.textContent = lab(hi); svg.appendChild(t2);
  if (l >= lo && l <= hi) svg.appendChild(el('line', { x1: X(l), x2: X(l), y1: P.t, y2: H - P.b, class: 'nkmark' }));
  // toque no gráfico: escolhe o λ
  svg.addEventListener('pointerdown', e => {
    const r = svg.getBoundingClientRect(), fx = ((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r);
    if (fx < 0 || fx > 1) return;
    onPick(logx ? lo * Math.pow(hi / lo, fx) : lo + (hi - lo) * fx);
  });
  return svg;
}

function refsNodes(html) {
  const links = [];
  String(html || '').replace(/href="(https:\/\/[^"]+)"/g, (m, u) => { links.push(u); return m; });
  const txt = clean(String(html || '').replace(/<br\s*\/?>/gi, '\n')).replace(/\s*\*\s*/g, '\n* ');
  return h('div.nkrefs', h('div.flabel', 'REFERÊNCIA'), h('div.nkreftxt', txt),
    links.length ? h('div.nklinks', links.slice(0, 4).map(u => h('button.sbtn.small', { type: 'button', onclick: () => openExternal(u) }, (u.includes('doi.org') ? 'DOI' : 'Link') + ' ↗'))) : null);
}

const siteUrl = (b, p) => 'https://refractiveindex.info/?shelf=' + encodeURIComponent(b.s) + '&book=' + encodeURIComponent(b.b) + '&page=' + encodeURIComponent(p.id);

/** Monta a busca + resultado dentro de host. opts: { query, onClose } */
export function buildNk(host, opts = {}) {
  clear(host);
  host.classList.add('nkwrap');
  let lam = 0.532;   // µm
  try { const v = parseFloat(localStorage.getItem('leitor-nk-l')); if (v > 0) lam = v; } catch (e) {}
  const q = h('input', { type: 'search', placeholder: 'Material: Si, água, ouro, SiO2, MEH-PPV…', 'aria-label': 'Buscar material', value: opts.query || '' });
  const body = h('div.nkbody');
  host.append(h('div.nksearch', q), body);
  const recent = () => { try { return JSON.parse(localStorage.getItem('leitor-nk-recent') || '[]'); } catch (e) { return []; } };
  const pushRecent = (b, p) => { try { const l = recent().filter(x => !(x.b === b.b && x.p === p.id && x.s === b.s)); l.unshift({ s: b.s, b: b.b, p: p.id, n: b.n, pn: p.n }); localStorage.setItem('leitor-nk-recent', JSON.stringify(l.slice(0, 8))); } catch (e) {} };

  const showList = async () => {
    clear(body);
    const term = q.value.trim();
    if (!term) {
      const r = recent();
      body.appendChild(h('p.muted', 'Digite o nome do material (em português ou inglês) ou a fórmula. Dados: refractiveindex.info (domínio público).'));
      const lu = await lastUpdate();
      const upd = h('button.sbtn.small', { type: 'button', onclick: async () => { upd.disabled = true; upd.textContent = 'Atualizando…'; try { await weeklyUpdate(true); toast('Dados do refractiveindex.info atualizados.', 2000); } catch (e) { toast('Sem conexão para atualizar.', 2500); } showList(); } }, 'Atualizar agora');
      body.appendChild(h('div.cnote', (lu ? 'Dados atualizados em ' + new Date(lu).toLocaleDateString('pt-BR') + '. ' : '') + 'O app confere a fonte uma vez por semana, sozinho. ', upd));
      if (r.length) {
        body.appendChild(h('div.flabel', 'USADOS POR ÚLTIMO'));
        for (const x of r) body.appendChild(h('button.srow', { type: 'button', onclick: async () => { const books = await catalog(); const b = books.find(y => y.s === x.s && y.b === x.b); const p = b && b.p.find(y => y.id === x.p); if (p) showPage(b, p); } }, h('div.grow', h('div', x.n), h('div.muted.clamp', x.pn))));
      }
      return;
    }
    body.appendChild(h('p.muted', 'Buscando…'));
    let books;
    try { books = await catalog(); } catch (e) { clear(body); body.appendChild(h('p.err', e.message)); return; }
    if (q.value.trim() !== term) return;
    const res = searchBooks(books, term);
    clear(body);
    if (!res.length) { body.appendChild(h('p', 'Nada encontrado para “' + term + '”. Tente o nome em inglês ou a fórmula (ex.: Ge, TiO2, polystyrene).')); return; }
    for (const b of res) body.appendChild(h('button.srow', { type: 'button', onclick: () => showBook(b) },
      h('div.grow', h('div', h('b', b.n || b.b)), h('div.muted.clamp', [b.sn || b.s, b.g].filter(Boolean).join(' · ') + ' · ' + b.p.length + ' conjunto(s) de dados'))));
  };

  const showBook = (b) => {
    clear(body);
    body.appendChild(h('button.sbtn.small', { type: 'button', onclick: showList }, '‹ Resultados'));
    body.appendChild(h('h3.nktitle', b.n || b.b));
    body.appendChild(h('p.muted', 'Escolha o conjunto de dados (artigo, faixa de λ):'));
    let g = null;
    for (const p of b.p) {
      if (p.g && p.g !== g) { g = p.g; body.appendChild(h('div.flabel', g)); }
      body.appendChild(h('button.srow', { type: 'button', onclick: () => showPage(b, p) }, h('div.grow', h('div', p.n || p.id))));
    }
  };

  const showPage = async (b, p) => {
    clear(body);
    body.appendChild(h('button.sbtn.small', { type: 'button', onclick: () => showBook(b) }, '‹ ' + (b.n || b.b)));
    body.appendChild(h('p.muted', 'Carregando…'));
    let d;
    try { d = await loadPage(p.d); } catch (e) { body.lastChild.replaceWith(h('p.err', e.message)); return; }
    pushRecent(b, p);
    const mat = material(d);
    clear(body);
    body.appendChild(h('button.sbtn.small', { type: 'button', onclick: () => showBook(b) }, '‹ ' + (b.n || b.b)));
    body.appendChild(h('h3.nktitle', b.n || b.b));
    body.appendChild(h('div.muted', p.n + (d.comments ? ' · ' + clean(d.comments) : '')));
    const lin = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Comprimento de onda em nm' });
    const chips = h('div.nkchips', LASERS.map(v => h('button.chip', { type: 'button', onclick: () => { lam = v / 1000; lin.value = fmt(v); run(); } }, String(v))));
    const out = h('div.nkout');
    const plotHost = h('div.nkplotwrap');
    body.append(h('label.crow', h('span.cl', 'λ (vácuo)'), lin, h('span.cu', 'nm')), chips, out, plotHost);
    body.appendChild(h('div.cnote', 'Faixa dos dados: ' + fmt(mat.lo * 1000, 4) + '–' + fmt(mat.hi * 1000, 4) + ' nm. Toque no gráfico para escolher o λ.'));
    body.appendChild(refsNodes(d.refs));
    let vals = null;
    const row = (l, v, u) => h('div.crow', h('span.cl', l), h('input.out', { type: 'text', readonly: true, value: v }), h('span.cu', u || ''));
    const run = () => {
      try { localStorage.setItem('leitor-nk-l', String(lam)); } catch (e) {}
      clear(out);
      const { n, k } = mat.at(lam);
      if (n === null && k === null) { out.appendChild(h('p.err', 'Fora da faixa dos dados deste conjunto.')); vals = null; }
      else {
        const kk = k || 0;
        const e1 = n !== null ? n * n - kk * kk : null, e2 = n !== null ? 2 * n * kk : null;
        const alpha = 4 * Math.PI * kk / (lam * 1e-4);   // cm⁻¹
        const R = n !== null ? ((n - 1) ** 2 + kk * kk) / ((n + 1) ** 2 + kk * kk) : null;
        let ng = null;
        const dl = lam * 1e-3, a = mat.at(lam - dl).n, c = mat.at(lam + dl).n;
        if (n !== null && a !== null && c !== null) ng = n - lam * (c - a) / (2 * dl);
        vals = { n, k: kk, e1, e2, alpha, R, ng };
        out.append(...[
          row('n', n !== null ? fmt(n, 6) : '—'),
          row(mat.hasK ? 'k' : 'k (sem dados: 0)', k !== null ? fmt(k, 4) : (mat.hasK ? '—' : '0')),
          n !== null ? row('ε₁ = n² − k²', fmt(e1, 5)) : null,
          n !== null && kk ? row('ε₂ = 2nk', fmt(e2, 4)) : null,
          kk ? row('α = 4πk/λ', fmt(alpha, 4), 'cm⁻¹') : null,
          kk ? row('Penetração 1/α', fmt(1e4 / alpha, 4), 'µm') : null,
          R !== null ? row('Reflexão normal (do ar)', fmt(R * 100, 4), '%') : null,
          ng !== null ? row('Índice de grupo n_g', fmt(ng, 5)) : null,
          n !== null ? row('λ no material', fmt(lam * 1000 / n, 5), 'nm') : null].filter(Boolean));
      }
      clear(plotHost);
      plotHost.appendChild(plot(mat, lam, v => { lam = v; lin.value = fmt(v * 1000, 5); run(); }));
    };
    lin.value = fmt(lam * 1000, 5);
    lin.addEventListener('input', () => { const v = parse(lin.value); if (v > 0) { lam = v / 1000; run(); } });
    run();
    body.appendChild(h('div.nkfoot',
      h('button.sbtn.small', { type: 'button', onclick: () => { if (!vals) return; copyText(`${b.n || b.b} (${p.n}) a ${fmt(lam * 1000, 5)} nm: n = ${fmt(vals.n, 6)}, k = ${fmt(vals.k, 5)} — refractiveindex.info`); toast('Copiado.'); } }, 'Copiar n, k'),
      h('button.sbtn.small', { type: 'button', onclick: () => openExternal(siteUrl(b, p)) }, 'Abrir no refractiveindex.info ↗')));
  };

  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(showList, 220); });
  showList();
  setTimeout(() => q.focus(), 50);
  return host;
}

// janelinha flutuante (como a da Wikipédia); Alt+N abre de qualquer lugar
export async function nkPop(term, box) {
  const { floatCard } = await import('./lookup.js');
  const { card, body } = floatCard('nk', 'Índice de refração · refractiveindex.info', box);
  card.classList.add('nkpop');
  buildNk(body, { query: String(term || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
  return card;
}
