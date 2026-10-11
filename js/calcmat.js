// Calculadoras de materiais: tabela periódica interativa, semicondutores, metais (elétrons livres e Drude),
// oscilador de Lorentz, espalhamento Mie, pinça em regime Rayleigh, Beer–Lambert e raios X.
// Os valores tabelados são típicos de literatura (indicados em cada caso); confira na fonte para trabalhos.
import { h, clear } from './util.js';
import { K, fmt, parse, formula, sec } from './calc.js';
import { ELEMENTS } from './elements.js';

const { h: HP, c: C0, e: QE, kB, NA, me: ME, eps0: EPS0, a0: A0 } = K;
const HBAR = HP / (2 * Math.PI);
const HC_EVNM = 1239.84198;

// ---------- números complexos ----------
const cx = (re, im = 0) => ({ re, im });
const add = (a, b) => cx(a.re + b.re, a.im + b.im);
const sub = (a, b) => cx(a.re - b.re, a.im - b.im);
const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const abs2 = a => a.re * a.re + a.im * a.im;
const conj = a => cx(a.re, -a.im);
const scl = (a, s) => cx(a.re * s, a.im * s);

// ---------- dados de materiais ----------
// valência de elétrons livres (convenção de Ashcroft & Mermin, tab. 1.1)
export const VAL = { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Cu: 1, Ag: 1, Au: 1, Be: 2, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Nb: 1, Fe: 2, Mn: 2, Zn: 2, Cd: 2, Hg: 2, Al: 3, Ga: 3, In: 3, Tl: 3, Sn: 4, Pb: 4, Bi: 5, Sb: 5 };
// função trabalho típica, policristalina (eV) — CRC Handbook; varia com a face cristalina e a limpeza da superfície
export const WORK = { Ag: 4.26, Al: 4.28, Au: 5.1, Ba: 2.7, Be: 4.98, Bi: 4.22, Ca: 2.87, Cd: 4.22, Co: 5.0, Cr: 4.5, Cs: 2.14, Cu: 4.65, Fe: 4.5, Ga: 4.2, Ge: 5.0, Hf: 3.9, Hg: 4.49, In: 4.12, Ir: 5.27, K: 2.3, Li: 2.9, Mg: 3.66, Mn: 4.1, Mo: 4.6, Na: 2.75, Nb: 4.3, Ni: 5.15, Os: 4.83, Pb: 4.25, Pd: 5.12, Pt: 5.65, Rb: 2.16, Re: 4.96, Rh: 4.98, Ru: 4.71, Sb: 4.55, Sc: 3.5, Se: 5.9, Si: 4.85, Sn: 4.42, Sr: 2.59, Ta: 4.25, Te: 4.95, Ti: 4.33, Tl: 3.84, V: 4.3, W: 4.55, Y: 3.1, Zn: 4.33, Zr: 4.05 };
// resistividade elétrica típica a ~293 K (µΩ·cm) — CRC Handbook
export const RES = { Cu: 1.68, Ag: 1.59, Au: 2.21, Al: 2.65, Fe: 9.7, Ni: 6.9, Pt: 10.6, W: 5.3, Zn: 5.9, Mg: 4.4, Na: 4.8, K: 7.2, Li: 9.3, Pb: 20.8, Sn: 11.5, Ti: 42, Cr: 12.5, Mo: 5.3, Pd: 10.5, Co: 6.2, Cd: 7.3, In: 8.4, Ga: 14, Be: 3.6, Ca: 3.4 };
// semicondutores (300 K). Eg: gap fundamental; Egd: menor gap direto (se o fundamental é indireto);
// a, c: rede (Å); eps: constante dielétrica estática; chi: afinidade eletrônica (eV); mun/mup: mobilidades (cm²/V·s);
// Nc/Nv: densidades efetivas de estados (cm⁻³); ni: concentração intrínseca de referência; vs: Varshni [Eg(0), α (eV/K), β (K)].
// Fontes: Sze & Ng, Physics of Semiconductor Devices (2007); ioffe.ru (NSM archive); valores com ≈ variam bastante na literatura.
export const SEMI = [
  { id: 'Si', name: 'Silício (Si)', Eg: 1.12, type: 'indireto', Egd: 3.4, a: 5.431, eps: 11.7, chi: 4.05, mun: 1450, mup: 505, Nc: 2.86e19, Nv: 2.66e19, ni: 9.65e9, vs: [1.17, 4.73e-4, 636], el: 'Si' },
  { id: 'Ge', name: 'Germânio (Ge)', Eg: 0.66, type: 'indireto', Egd: 0.80, a: 5.658, eps: 16.2, chi: 4.0, mun: 3900, mup: 1800, Nc: 1.04e19, Nv: 6.0e18, ni: 2.33e13, vs: [0.7437, 4.774e-4, 235], el: 'Ge' },
  { id: 'GaAs', name: 'Arseneto de gálio (GaAs)', Eg: 1.424, type: 'direto', a: 5.653, eps: 12.9, chi: 4.07, mun: 8000, mup: 400, Nc: 4.7e17, Nv: 9.0e18, ni: 2.25e6, vs: [1.519, 5.405e-4, 204] },
  { id: 'C', name: 'Diamante (C)', Eg: 5.47, type: 'indireto', Egd: 7.3, a: 3.567, eps: 5.7, mun: 2200, mup: 1600, approx: true, el: 'C' },
  { id: 'InP', name: 'Fosfeto de índio (InP)', Eg: 1.344, type: 'direto', a: 5.869, eps: 12.5, chi: 4.38, mun: 5400, mup: 200, Nc: 5.7e17, Nv: 1.1e19 },
  { id: 'GaN', name: 'Nitreto de gálio (GaN, wurtzita)', Eg: 3.4, type: 'direto', a: 3.189, c: 5.185, eps: 8.9, chi: 4.1, mun: 1000, mup: 30, Nc: 2.3e18, Nv: 4.6e19, approx: true },
  { id: 'GaP', name: 'Fosfeto de gálio (GaP)', Eg: 2.26, type: 'indireto', a: 5.451, eps: 11.1, mun: 250, mup: 150 },
  { id: 'InAs', name: 'Arseneto de índio (InAs)', Eg: 0.354, type: 'direto', a: 6.058, eps: 15.15, mun: 40000, mup: 500 },
  { id: 'InSb', name: 'Antimoneto de índio (InSb)', Eg: 0.17, type: 'direto', a: 6.479, eps: 16.8, mun: 77000, mup: 850 },
  { id: 'SiC', name: 'Carbeto de silício (4H-SiC)', Eg: 3.26, type: 'indireto', a: 3.073, c: 10.053, eps: 9.7, mun: 900, mup: 120, approx: true },
  { id: 'ZnO', name: 'Óxido de zinco (ZnO)', Eg: 3.37, type: 'direto', a: 3.25, c: 5.21, eps: 8.5, mun: 200, approx: true },
  { id: 'CdTe', name: 'Telureto de cádmio (CdTe)', Eg: 1.5, type: 'direto', a: 6.48, eps: 10.2, mun: 1100, mup: 100, approx: true },
  { id: 'CdSe', name: 'Seleneto de cádmio (CdSe)', Eg: 1.74, type: 'direto', approx: true },
  { id: 'CdS', name: 'Sulfeto de cádmio (CdS)', Eg: 2.42, type: 'direto', approx: true },
  { id: 'ZnSe', name: 'Seleneto de zinco (ZnSe)', Eg: 2.7, type: 'direto', a: 5.668, approx: true },
  { id: 'TiO2r', name: 'TiO₂ rutilo', Eg: 3.0, type: 'direto (proibido)', approx: true },
  { id: 'TiO2a', name: 'TiO₂ anatásio', Eg: 3.2, type: 'indireto', approx: true },
  { id: 'MAPI', name: 'Perovskita MAPbI₃', Eg: 1.6, type: 'direto', approx: true },
  { id: 'MEHPPV', name: 'MEH-PPV (polímero conjugado)', Eg: 2.1, type: 'gap óptico (HOMO ≈ −5,3 eV, LUMO ≈ −3,0 eV)', approx: true, note: 'Orgânico: valores variam com a amostra, o solvente e o método (absorção ~490–500 nm). Use os seus dados.' },
  { id: 'Te', name: 'Telúrio (Te)', Eg: 0.33, type: 'direto', approx: true, el: 'Te' },
  { id: 'Se', name: 'Selênio trigonal (Se)', Eg: 1.8, type: '—', approx: true, el: 'Se' },
];
const SERIES = { 'Nonmetals': 'Não metal', 'Noble gases': 'Gás nobre', 'Alkali metals': 'Metal alcalino', 'Alkaline earth metals': 'Metal alcalinoterroso', 'Metalloids': 'Semimetal (metaloide)', 'Halogens': 'Halogênio', 'Poor metals': 'Metal pós-transição', 'Transition metals': 'Metal de transição', 'Lanthanides': 'Lantanídeo', 'Actinides': 'Actinídeo' };
const LATT = { DIA: 'diamante', FCC: 'cúbica de faces centradas', BCC: 'cúbica de corpo centrado', HEX: 'hexagonal', CUB: 'cúbica', SC: 'cúbica simples', TET: 'tetragonal', ORC: 'ortorrômbica', RHL: 'romboédrica', MCL: 'monoclínica' };
const SCOLOR = { 'Nonmetals': '#dbeafe', 'Noble gases': '#ede9fe', 'Alkali metals': '#fee2e2', 'Alkaline earth metals': '#ffedd5', 'Metalloids': '#dcfce7', 'Halogens': '#fef9c3', 'Poor metals': '#e0f2fe', 'Transition metals': '#f1f5f9', 'Lanthanides': '#fce7f3', 'Actinides': '#fae8ff' };

// ---------- física ----------
export function freeElectron(rho, M, Z) {   // rho g/cm³, M g/mol
  const n = Z * rho * NA / M * 1e6;   // m⁻³
  const kF = Math.cbrt(3 * Math.PI * Math.PI * n), EF = HBAR * HBAR * kF * kF / (2 * ME);
  const wp = Math.sqrt(n * QE * QE / (EPS0 * ME));
  return { n, kF, EF: EF / QE, TF: EF / kB, vF: HBAR * kF / ME, rs: Math.cbrt(3 / (4 * Math.PI * n)) / A0, wp, Ep: HBAR * wp / QE, lp: 2 * Math.PI * C0 / wp };
}
export const varshni = (s, T) => s.vs ? s.vs[0] - s.vs[1] * T * T / (T + s.vs[2]) : s.Eg;
export function semiState(s, T, Nd, Na) {
  const kT = kB * T / QE;
  const Eg = varshni(s, T);
  const f = Math.pow(T / 300, 1.5);
  const Nc = s.Nc * f, Nv = s.Nv * f;
  const ni = Math.sqrt(Nc * Nv) * Math.exp(-Eg / (2 * kT));
  const N = (Nd || 0) - (Na || 0);
  let n, p;
  if (N >= 0) { n = N / 2 + Math.sqrt(N * N / 4 + ni * ni); p = ni * ni / n; }
  else { p = -N / 2 + Math.sqrt(N * N / 4 + ni * ni); n = ni * ni / p; }
  const sigma = QE * (n * (s.mun || 0) + p * (s.mup || 0));   // S/cm (cm⁻³ × cm²/Vs)
  const EcEF = kT * Math.log(Nc / n), EFEi = kT * Math.log(n / ni);
  const maj = Math.max(n, p) * 1e6;
  const LD = s.eps ? Math.sqrt(s.eps * EPS0 * kB * T / (QE * QE * maj)) : NaN;
  return { Eg, Nc, Nv, ni, n, p, sigma, rho: 1 / sigma, EcEF, EFEi, LD };
}
// Mie (Bohren & Huffman): m relativo (n + ik), x = 2π n_meio a / λ
export function mie(mre, mim, x) {
  const m = cx(mre, mim), y = mul(m, cx(x));
  const nstop = Math.round(x + 4 * Math.cbrt(x) + 2);
  const nmx = Math.round(Math.max(nstop, Math.sqrt(abs2(y)))) + 16;
  const D = new Array(nmx + 1).fill(null).map(() => cx(0));
  for (let n = nmx; n >= 1; n--) { const ny = div(cx(n), y); D[n - 1] = sub(ny, div(cx(1), add(D[n], ny))); }
  let psi0 = Math.cos(x), psi1 = Math.sin(x), chi0 = -Math.sin(x), chi1 = Math.cos(x);
  let xi1 = cx(psi1, -chi1);
  let qsca = 0, qext = 0, gs = 0, back = cx(0), an1 = null, bn1 = null;
  for (let n = 1; n <= nstop; n++) {
    const psi = (2 * n - 1) * psi1 / x - psi0, chi = (2 * n - 1) * chi1 / x - chi0;
    const xi = cx(psi, -chi);
    const ta = add(div(D[n], m), cx(n / x)), tb = add(mul(m, D[n]), cx(n / x));
    const an = div(sub(scl(ta, psi), cx(psi1)), sub(mul(ta, xi), xi1));
    const bn = div(sub(scl(tb, psi), cx(psi1)), sub(mul(tb, xi), xi1));
    qsca += (2 * n + 1) * (abs2(an) + abs2(bn));
    qext += (2 * n + 1) * (an.re + bn.re);
    if (an1) gs += ((n - 1) * (n + 1) / n) * (mul(an1, conj(an)).re + mul(bn1, conj(bn)).re);
    gs += (2 * n + 1) / (n * (n + 1)) * mul(an, conj(bn)).re;
    back = add(back, scl(sub(an, bn), (2 * n + 1) * (n % 2 ? -1 : 1)));
    an1 = an; bn1 = bn;
    psi0 = psi1; psi1 = psi; chi0 = chi1; chi1 = chi; xi1 = cx(psi1, -chi1);
  }
  const Qsca = 2 / (x * x) * qsca, Qext = 2 / (x * x) * qext;
  const g = 4 / (x * x * Qsca) * gs;
  return { Qext, Qsca, Qabs: Qext - Qsca, Qback: abs2(back) / (x * x), g, Qpr: Qext - g * Qsca };
}

// ---------- interface ----------
const out = (rows) => h('div.ptcard', rows.filter(Boolean).map(([l, v, u]) => h('div.ptrow', h('span.ptl', l), h('span.ptv', v === null || v === undefined || v === '' ? '—' : String(v)), u ? h('span.ptu', u) : null)));
const f3 = (v, s = 4) => (v === null || v === undefined || !isFinite(v)) ? null : fmt(v, s);
const sel = (opts, value) => { const s = h('select', opts.map(([v, l]) => h('option', { value: v }, l))); if (value !== undefined) s.value = value; return s; };

// tabela periódica
function cellPos(e) {
  if (e.z >= 57 && e.z <= 71) return [e.z - 57 + 3, 9];
  if (e.z >= 89 && e.z <= 103) return [e.z - 89 + 3, 10];
  return [e.g || 3, e.p];
}
function ptGrid(onPick, big, current) {
  const g = h('div.ptgrid' + (big ? '.big' : ''));
  for (const e of ELEMENTS) {
    const [col, row] = cellPos(e);
    const b = h('button.ptel', { type: 'button', title: e.z + ' · ' + e.n, style: `grid-column:${col};grid-row:${row};background:${SCOLOR[e.ser] || '#f1f5f9'}`, onclick: () => onPick(e) }, big ? h('small', String(e.z)) : null, h('b', e.s));
    if (current && current.z === e.z) b.classList.add('on');
    g.appendChild(b);
  }
  g.appendChild(h('div.ptgap', { style: 'grid-column:3;grid-row:6' }, '*'));
  g.appendChild(h('div.ptgap', { style: 'grid-column:3;grid-row:7' }, '**'));
  return g;
}
function elementCard(e, host) {
  clear(host);
  const C = T => T === null || T === undefined ? null : fmt(T, 5) + ' K (' + fmt(T - 273.15, 4) + ' °C)';
  host.appendChild(h('div.pthead', h('div.ptbig', { style: 'background:' + (SCOLOR[e.ser] || '#f1f5f9') }, h('small', String(e.z)), h('b', e.s)), h('div', h('div.pttitle', e.n), h('div.muted', (SERIES[e.ser] || e.ser || '') + ' · grupo ' + (e.g || '—') + ' · período ' + e.p + ' · bloco ' + e.b))));
  host.appendChild(out([
    ['Massa atômica', f3(e.m, 6), 'u'], ['Configuração eletrônica', e.ec], ['Estados de oxidação', e.ox && e.ox.length ? e.ox.map(o => (o > 0 ? '+' : '') + o).join(', ') : null],
    ['Eletronegatividade (Pauling)', f3(e.chi, 3)], ['1ª energia de ionização', f3(e.ie1, 4), 'eV'], ['Afinidade eletrônica', f3(e.ea, 4), 'eV'],
    ['Raio atômico', f3(e.rad, 4), 'pm'], ['Polarizabilidade de dipolo', f3(e.pol, 4), 'u.a.'],
    ['Densidade', f3(e.rho, 5), 'g/cm³'], ['Fusão', C(e.mp)], ['Ebulição', C(e.bp)],
    ['Estrutura cristalina', e.lat ? (LATT[e.lat] || e.lat) : null], ['Constante de rede a', f3(e.a, 4), 'Å'],
    ['Condutividade térmica', f3(e.k, 4), 'W/(m·K)'], ['Calor específico', f3(e.cp, 4), 'J/(g·K)'],
    WORK[e.s] ? ['Função trabalho (típica)', fmt(WORK[e.s], 3), 'eV'] : null,
  ]));
  if (VAL[e.s] && e.rho) {
    const fe = freeElectron(e.rho, e.m, VAL[e.s]);
    host.appendChild(h('div.csec', 'Metal: modelo de elétrons livres (valência ' + VAL[e.s] + ')'));
    const rows = [
      ['Densidade de elétrons n', fmt(fe.n / 1e6, 4), 'cm⁻³'], ['Energia de Fermi E_F', fmt(fe.EF, 4), 'eV'], ['Temperatura de Fermi T_F', fmt(fe.TF, 4), 'K'],
      ['Velocidade de Fermi v_F', fmt(fe.vF, 4), 'm/s'], ['k_F', fmt(fe.kF * 1e-10, 4), 'Å⁻¹'], ['r_s/a₀', fmt(fe.rs, 4)],
      ['Energia de plasma ħω_p', fmt(fe.Ep, 4), 'eV'], ['λ de plasma', fmt(fe.lp * 1e9, 4), 'nm'],
    ];
    if (RES[e.s]) { const tau = ME / (fe.n * QE * QE * RES[e.s] * 1e-8); rows.push(['Resistividade (≈293 K)', fmt(RES[e.s], 3), 'µΩ·cm'], ['Tempo de relaxação τ (Drude)', fmt(tau * 1e15, 4), 'fs'], ['Livre caminho médio v_F·τ', fmt(fe.vF * tau * 1e9, 4), 'nm']); }
    host.appendChild(out(rows));
    host.appendChild(h('div.cnote', 'Modelo de elétrons livres: bom para metais simples (alcalinos, Cu, Ag, Au, Al); para metais de transição é só uma estimativa.'));
  }
  const s = SEMI.find(x => x.el === e.s);
  if (s) semiCard(s, host);
  host.appendChild(h('div.ptbtns',
    h('button.sbtn.small', { type: 'button', onclick: async () => (await import('./nkdb.js')).nkPop(e.en) }, 'Índice de refração n,k ↗')));
}
function semiCard(s, host) {
  host.appendChild(h('div.csec', 'Semicondutor (300 K)' + (s.approx ? ' — valores aproximados' : '')));
  host.appendChild(out([
    ['Gap E_g', fmt(s.Eg, 4), 'eV'], ['Tipo de gap', s.type], s.Egd ? ['Menor gap direto', fmt(s.Egd, 3), 'eV'] : null,
    ['λ de corte (E_g)', fmt(HC_EVNM / s.Eg, 4), 'nm'], s.Egd ? ['λ do gap direto', fmt(HC_EVNM / s.Egd, 4), 'nm'] : null,
    s.a ? ['Rede a' + (s.c ? ' / c' : ''), fmt(s.a, 4) + (s.c ? ' / ' + fmt(s.c, 4) : ''), 'Å'] : null,
    s.eps ? ['Constante dielétrica ε_r', fmt(s.eps, 3)] : null, s.chi ? ['Afinidade eletrônica χ', fmt(s.chi, 3), 'eV'] : null,
    s.mun ? ['Mobilidade elétrons µ_n', fmt(s.mun, 4), 'cm²/(V·s)'] : null, s.mup ? ['Mobilidade lacunas µ_p', fmt(s.mup, 4), 'cm²/(V·s)'] : null,
    s.Nc ? ['N_c / N_v', fmt(s.Nc, 3) + ' / ' + fmt(s.Nv, 3), 'cm⁻³'] : null, s.ni ? ['n_i (referência)', fmt(s.ni, 3), 'cm⁻³'] : null,
  ]));
  if (s.note) host.appendChild(h('div.cnote', s.note));
}
function buildPtab(host) {
  sec(host, 'Tabela periódica', 'Toque num elemento (ou busque pelo nome, símbolo ou número). Dados gerais: pacote mendeleev (IUPAC, CRC, NIST); metais e semicondutores: Ashcroft & Mermin, Sze, CRC.');
  const q = h('input', { type: 'search', placeholder: 'Ex.: Ge, germânio, 32', 'aria-label': 'Buscar elemento' });
  const gridHost = h('div.ptwrap'), card = h('div.ptinfo');
  let cur = ELEMENTS.find(e => e.s === 'Ge');
  const pick = e => { cur = e; clear(gridHost); gridHost.appendChild(ptGrid(pick, false, cur)); elementCard(e, card); };
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!t) return;
    const e = ELEMENTS.find(x => String(x.z) === t || x.s.toLowerCase() === t) || ELEMENTS.find(x => x.n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(t) || x.en.toLowerCase().startsWith(t));
    if (e) pick(e);
  });
  const big = h('button.sbtn.small', { type: 'button', onclick: async () => {
    const { floatCard } = await import('./lookup.js');
    const fc = floatCard('ptab', 'Tabela periódica', null);
    fc.card.classList.add('ptpop');
    const info = h('div.ptinfo');
    const pickBig = e => { pick(e); clear(fc.body); fc.body.append(ptGrid(pickBig, true, e), info); elementCard(e, info); };
    pickBig(cur);
  } }, 'Tabela grande ↗');
  host.append(h('div.ptsearch', q, big), gridHost, card);
  pick(cur);
}

function buildSemi(host) {
  sec(host, 'Semicondutor: portadores e nível de Fermi', 'nᵢ = √(N_cN_v)·e^(−E_g/2kT), com E_g(T) de Varshni (Si, Ge, GaAs) e N_c, N_v ∝ T^(3/2). Mobilidades fixas (valores de 300 K, sem efeito da dopagem).');
  const withN = SEMI.filter(s => s.Nc);
  const m = sel(withN.map(s => [s.id, s.name]), 'Si');
  const T = h('input', { type: 'text', inputmode: 'decimal', value: '300' }), Nd = h('input', { type: 'text', inputmode: 'decimal', value: '1e16' }), Na = h('input', { type: 'text', inputmode: 'decimal', value: '0' });
  const row = (l, inp, u) => h('label.crow', h('span.cl', l), inp, h('span.cu', u || ''));
  const res = h('div'), info = h('div');
  const run = () => {
    const s = withN.find(x => x.id === m.value);
    const r = semiState(s, parse(T.value), parse(Nd.value) || 0, parse(Na.value) || 0);
    clear(res);
    res.appendChild(out([
      ['E_g(T)', fmt(r.Eg, 4), 'eV'], ['N_c(T)', fmt(r.Nc, 3), 'cm⁻³'], ['N_v(T)', fmt(r.Nv, 3), 'cm⁻³'], ['nᵢ(T) calculado', fmt(r.ni, 3), 'cm⁻³'],
      ['Elétrons n', fmt(r.n, 4), 'cm⁻³'], ['Lacunas p', fmt(r.p, 4), 'cm⁻³'], ['Tipo', r.n > r.p * 1.0001 ? 'n' : r.p > r.n * 1.0001 ? 'p' : 'intrínseco'],
      ['E_c − E_F', fmt(r.EcEF, 4), 'eV'], ['E_F − Eᵢ', fmt(r.EFEi, 4), 'eV'], ['Condutividade σ', fmt(r.sigma, 4), 'S/cm'], ['Resistividade ρ', fmt(r.rho, 4), 'Ω·cm'],
      isFinite(r.LD) ? ['Comprimento de Debye', fmt(r.LD * 1e9, 4), 'nm'] : null,
    ]));
    clear(info); semiCard(s, info);
  };
  [T, Nd, Na].forEach(i => i.addEventListener('input', run)); m.addEventListener('change', run);
  host.append(row('Material', m), row('Temperatura', T, 'K'), row('Doadores N_d', Nd, 'cm⁻³'), row('Aceitadores N_a', Na, 'cm⁻³'), res, info);
  run();
  sec(host, 'Outros semicondutores (300 K)', 'Toque para ver os dados.');
  const other = h('div');
  const list = h('div.ptlist', SEMI.map(s => h('button.chip', { type: 'button', onclick: () => { clear(other); semiCard(s, other); } }, s.id === 'MEHPPV' ? 'MEH-PPV' : s.id.replace('TiO2r', 'TiO₂ rutilo').replace('TiO2a', 'TiO₂ anatásio').replace('MAPI', 'MAPbI₃'))));
  host.append(list, other);
}

function buildMetal(host) {
  sec(host, 'Metal: elétrons livres e Drude', 'Escolha um metal (densidade e valência de Ashcroft & Mermin) ou digite os seus valores.');
  const metals = ELEMENTS.filter(e => VAL[e.s] && e.rho);
  const m = sel([['', 'Outro (digitar)']].concat(metals.map(e => [e.s, e.n + ' (' + e.s + ')'])), 'Cu');
  const rho = h('input', { type: 'text', inputmode: 'decimal' }), M = h('input', { type: 'text', inputmode: 'decimal' }), Z = h('input', { type: 'text', inputmode: 'decimal' }), R = h('input', { type: 'text', inputmode: 'decimal' });
  const row = (l, inp, u) => h('label.crow', h('span.cl', l), inp, h('span.cu', u || ''));
  const res = h('div');
  const fill = () => { const e = ELEMENTS.find(x => x.s === m.value); if (!e) return; rho.value = fmt(e.rho, 5); M.value = fmt(e.m, 6); Z.value = String(VAL[e.s]); R.value = RES[e.s] ? fmt(RES[e.s], 3) : ''; };
  const run = () => {
    const fe = freeElectron(parse(rho.value), parse(M.value), parse(Z.value));
    const rr = parse(R.value);
    const rows = [['Densidade de elétrons n', fmt(fe.n / 1e6, 4), 'cm⁻³'], ['E_F', fmt(fe.EF, 4), 'eV'], ['T_F', fmt(fe.TF, 4), 'K'], ['v_F', fmt(fe.vF, 4), 'm/s'], ['k_F', fmt(fe.kF * 1e-10, 4), 'Å⁻¹'], ['r_s/a₀', fmt(fe.rs, 4)], ['ħω_p', fmt(fe.Ep, 4), 'eV'], ['λ_p', fmt(fe.lp * 1e9, 4), 'nm']];
    if (rr > 0) { const tau = ME / (fe.n * QE * QE * rr * 1e-8); rows.push(['τ (Drude)', fmt(tau * 1e15, 4), 'fs'], ['ħ/τ', fmt(HBAR / tau / QE * 1e3, 4), 'meV'], ['Livre caminho médio', fmt(fe.vF * tau * 1e9, 4), 'nm']); }
    clear(res); res.appendChild(out(rows));
  };
  m.addEventListener('change', () => { fill(); run(); });
  [rho, M, Z, R].forEach(i => i.addEventListener('input', () => { m.value = ''; run(); }));
  host.append(row('Metal', m), row('Densidade', rho, 'g/cm³'), row('Massa molar', M, 'g/mol'), row('Elétrons por átomo', Z), row('Resistividade (opcional)', R, 'µΩ·cm'), res);
  fill(); run();
}

// gráfico simples de duas curvas (n e k) em função de λ
function plot2(xs, ys1, ys2, mark, labels) {
  const W = 300, H = 120, P = { l: 30, r: 30, t: 8, b: 18 };
  const ns = 'http://www.w3.org/2000/svg';
  const el = (n, at) => { const e = document.createElementNS(ns, n); for (const k in at) e.setAttribute(k, at[k]); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'nkplot' });
  const x0 = xs[0], x1 = xs[xs.length - 1], X = x => P.l + (W - P.l - P.r) * (x - x0) / (x1 - x0);
  const draw = (ys, cls, side) => {
    const ok = ys.filter(isFinite); if (!ok.length) return;
    let a = Math.min(...ok), b = Math.max(...ok); if (b - a < 1e-9) { a -= 0.5; b += 0.5; }
    const Y = v => P.t + (H - P.t - P.b) * (1 - (v - a) / (b - a));
    svg.appendChild(el('path', { d: 'M' + xs.map((x, i) => X(x).toFixed(1) + ' ' + Y(ys[i]).toFixed(1)).join('L'), class: cls, fill: 'none' }));
    const t = el('text', { x: side === 'l' ? 1 : W - P.r + 2, y: P.t + 8, class: cls + 't' }); t.textContent = labels[side === 'l' ? 0 : 1] + ' ' + fmt(b, 3); svg.appendChild(t);
    const t2 = el('text', { x: side === 'l' ? 1 : W - P.r + 2, y: H - P.b, class: cls + 't' }); t2.textContent = fmt(a, 3); svg.appendChild(t2);
  };
  draw(ys1, 'nkn', 'l'); draw(ys2, 'nkk', 'r');
  svg.appendChild(el('line', { x1: P.l, x2: W - P.r, y1: H - P.b, y2: H - P.b, class: 'nkax' }));
  const ta = el('text', { x: P.l, y: H - 3, class: 'nkaxt' }); ta.textContent = fmt(x0, 4) + ' nm'; svg.appendChild(ta);
  const tb = el('text', { x: W - P.r, y: H - 3, class: 'nkaxt', 'text-anchor': 'end' }); tb.textContent = fmt(x1, 4) + ' nm'; svg.appendChild(tb);
  if (mark >= x0 && mark <= x1) svg.appendChild(el('line', { x1: X(mark), x2: X(mark), y1: P.t, y2: H - P.b, class: 'nkmark' }));
  return svg;
}
export function lorentzEps(E, p) {
  let eps = cx(p.einf, 0);
  for (const o of p.osc) if (o.S && o.E0) eps = add(eps, div(cx(o.S), cx(o.E0 * o.E0 - E * E, -o.G * E)));
  return eps;
}
export function nkFromEps(eps) {
  const m = Math.sqrt(eps.re * eps.re + eps.im * eps.im);
  return { n: Math.sqrt(Math.max(0, (m + eps.re) / 2)), k: Math.sqrt(Math.max(0, (m - eps.re) / 2)) };
}
function buildLorentz(host) {
  sec(host, 'Oscilador de Lorentz', 'ε(E) = ε∞ + Σ S/(E₀² − E² − iΓE), com E = hc/λ (em eV). Força do oscilador S = f·(ħω_p)² em eV². Até 2 osciladores (deixe S em branco para não usar o 2º).');
  const v = {};
  const fld = (key, label, unit, val) => { const i = h('input', { type: 'text', inputmode: 'decimal', value: val }); v[key] = i; return h('label.crow', h('span.cl', label), i, h('span.cu', unit || '')); };
  const res = h('div'), plotHost = h('div.nkplotwrap');
  host.append(fld('einf', 'ε∞', '', '2,5'), fld('E1', 'E₀ (oscilador 1)', 'eV', '2,4'), fld('G1', 'Γ (1)', 'eV', '0,35'), fld('S1', 'S (1)', 'eV²', '3'),
    fld('E2', 'E₀ (oscilador 2)', 'eV', ''), fld('G2', 'Γ (2)', 'eV', ''), fld('S2', 'S (2)', 'eV²', ''),
    fld('l', 'λ', 'nm', '532'), fld('la', 'Gráfico: de', 'nm', '350'), fld('lb', 'até', 'nm', '900'), res, plotHost);
  const run = () => {
    const p = { einf: parse(v.einf.value), osc: [{ E0: parse(v.E1.value), G: parse(v.G1.value) || 0, S: parse(v.S1.value) }, { E0: parse(v.E2.value), G: parse(v.G2.value) || 0, S: parse(v.S2.value) }].filter(o => isFinite(o.S) && isFinite(o.E0)) };
    const l = parse(v.l.value), E = HC_EVNM / l;
    const eps = lorentzEps(E, p), { n, k } = nkFromEps(eps);
    const R = ((n - 1) ** 2 + k * k) / ((n + 1) ** 2 + k * k);
    clear(res);
    res.appendChild(out([['E do fóton', fmt(E, 4), 'eV'], ['ε₁', fmt(eps.re, 5)], ['ε₂', fmt(eps.im, 5)], ['n', fmt(n, 5)], ['k', fmt(k, 5)], ['α = 4πk/λ', fmt(4 * Math.PI * k / (l * 1e-7), 4), 'cm⁻¹'], ['Reflexão normal (do ar)', fmt(R * 100, 4), '%']]));
    const a = parse(v.la.value), b = parse(v.lb.value);
    if (a > 0 && b > a) {
      const xs = [], ns = [], ks = [];
      for (let i = 0; i <= 200; i++) { const L = a + (b - a) * i / 200; const r = nkFromEps(lorentzEps(HC_EVNM / L, p)); xs.push(L); ns.push(r.n); ks.push(r.k); }
      clear(plotHost); plotHost.appendChild(plot2(xs, ns, ks, l, ['n', 'k']));
    }
  };
  Object.values(v).forEach(i => i.addEventListener('input', run));
  run();
}

function buildMie(host) {
  sec(host, 'Esfera: espalhamento Mie', 'Teoria de Mie exata (algoritmo de Bohren & Huffman). Índice da partícula n + ik (k > 0 absorve); x = 2πn_meio·a/λ. Para pegar n e k de um material, use a calculadora de índice de refração.');
  formula(host, [{ key: 'np', label: 'n da partícula', unit: '', v: 4.0 }, { key: 'kp', label: 'k da partícula', unit: '', v: 0.0 }, { key: 'nm', label: 'n do meio', unit: '', v: 1.33 }, { key: 'd', label: 'Diâmetro', unit: 'µm', v: 1 }, { key: 'l', label: 'λ (vácuo)', unit: 'nm', v: 1064 }, { key: 'P', label: 'Potência no foco', unit: 'mW', v: 50 }, { key: 'w', label: 'Raio do feixe w₀', unit: 'µm', v: 0.6 }, { key: 'kt', label: 'Condutividade térmica do meio', unit: 'W/(m·K)', v: 0.6 }],
    [{ key: 'x', label: 'Parâmetro de tamanho x', unit: '' }, { key: 'Qext', label: 'Q_ext', unit: '' }, { key: 'Qsca', label: 'Q_sca', unit: '' }, { key: 'Qabs', label: 'Q_abs', unit: '' }, { key: 'Qback', label: 'Q_back', unit: '' }, { key: 'g', label: 'Assimetria g = ⟨cos θ⟩', unit: '' }, { key: 'Qpr', label: 'Q_pr = Q_ext − g·Q_sca', unit: '' },
      { key: 'Cext', label: 'Seção de choque de extinção', unit: 'µm²' }, { key: 'Cabs', label: 'Seção de choque de absorção', unit: 'µm²' }, { key: 'F', label: 'Força de radiação (no centro do feixe)', unit: 'pN' }, { key: 'Pabs', label: 'Potência absorvida', unit: 'µW' }, { key: 'dT', label: 'Aquecimento ΔT ≈ P_abs/(4πκa)', unit: 'K' }],
    v => {
      const a = v.d * 1e-6 / 2, x = 2 * Math.PI * v.nm * a / (v.l * 1e-9);
      const r = mie(v.np / v.nm, v.kp / v.nm, x);
      const G = Math.PI * a * a, I = 2 * v.P * 1e-3 / (Math.PI * (v.w * 1e-6) ** 2);
      const Pabs = r.Qabs * G * I;
      return { x, Qext: r.Qext, Qsca: r.Qsca, Qabs: r.Qabs, Qback: r.Qback, g: r.g, Qpr: r.Qpr, Cext: r.Qext * G * 1e12, Cabs: r.Qabs * G * 1e12, F: v.nm * r.Qpr * G * I / C0 * 1e12, Pabs: Pabs * 1e6, dT: Pabs / (4 * Math.PI * v.kt * a) };
    });
  host.appendChild(h('div.cnote', 'A força de radiação usa a intensidade de pico I₀ = 2P/(πw₀²) sobre a seção de choque de pressão (vale bem quando a partícula é menor que o feixe). O aquecimento é o estado estacionário de uma esfera num meio infinito.'));
}

function buildRayleigh(host) {
  sec(host, 'Pinça óptica em regime Rayleigh (a ≪ λ)', 'Clausius–Mossotti: K = (m²−1)/(m²+2), m = (n+ik)/n_meio. Forças de gradiente e de espalhamento num feixe gaussiano (Harada & Asakura, 1996). Bom para nanopartículas (Pdots, ouro, etc.).');
  formula(host, [{ key: 'd', label: 'Diâmetro', unit: 'nm', v: 50 }, { key: 'np', label: 'n da partícula', unit: '', v: 1.9 }, { key: 'kp', label: 'k da partícula', unit: '', v: 0.0 }, { key: 'nm', label: 'n do meio', unit: '', v: 1.33 }, { key: 'l', label: 'λ (vácuo)', unit: 'nm', v: 1064 }, { key: 'P', label: 'Potência no foco', unit: 'mW', v: 50 }, { key: 'w', label: 'Raio do feixe w₀', unit: 'µm', v: 0.5 }, { key: 'T', label: 'Temperatura', unit: '°C', v: 25 }, { key: 'kt', label: 'Condutividade térmica do meio', unit: 'W/(m·K)', v: 0.6 }],
    [{ key: 'x', label: 'Parâmetro de tamanho x = ka', unit: '' }, { key: 'ReK', label: 'Re K', unit: '' }, { key: 'ImK', label: 'Im K', unit: '' }, { key: 'alpha', label: 'Polarizabilidade α/(4πε₀)', unit: 'nm³' },
      { key: 'Cs', label: 'σ_espalhamento', unit: 'nm²' }, { key: 'Ca', label: 'σ_absorção', unit: 'nm²' }, { key: 'Fg', label: 'Força de gradiente máxima (radial)', unit: 'pN' }, { key: 'Fs', label: 'Força de espalhamento + absorção (no centro)', unit: 'pN' },
      { key: 'kr', label: 'Rigidez radial κ_r', unit: 'pN/µm' }, { key: 'U', label: 'Profundidade do poço U₀', unit: 'k_BT' }, { key: 'R', label: 'Razão F_grad/F_esp', unit: '' }, { key: 'dT', label: 'Aquecimento ΔT', unit: 'K' }],
    v => {
      const a = v.d * 1e-9 / 2, k = 2 * Math.PI * v.nm / (v.l * 1e-9);
      const m = cx(v.np / v.nm, v.kp / v.nm), m2 = mul(m, m);
      const Kc = div(sub(m2, cx(1)), add(m2, cx(2)));
      const I0 = 2 * v.P * 1e-3 / (Math.PI * (v.w * 1e-6) ** 2), w = v.w * 1e-6;
      const pre = 2 * Math.PI * v.nm * a ** 3 / C0;
      const Cs = 8 * Math.PI / 3 * k ** 4 * a ** 6 * abs2(Kc), Ca = 4 * Math.PI * k * a ** 3 * Kc.im;
      const Fg = pre * Kc.re * I0 * (2 / w) * Math.exp(-0.5);
      const Fs = v.nm * (Cs + Ca) * I0 / C0;
      const kr = pre * Kc.re * 4 * I0 / (w * w);
      const U = pre * Kc.re * I0 / (kB * (v.T + 273.15));
      return { x: k * a, ReK: Kc.re, ImK: Kc.im, alpha: v.nm * v.nm * a ** 3 * Kc.re * 1e27, Cs: Cs * 1e18, Ca: Ca * 1e18, Fg: Fg * 1e12, Fs: Fs * 1e12, kr: kr * 1e6, U, R: Fg / Fs, dT: Ca * I0 / (4 * Math.PI * v.kt * a) };
    });
  host.appendChild(h('div.cnote', 'Aproximação válida para x ≲ 0,3. Acima disso use a aba Mie. U₀ ≳ 10 k_BT costuma ser o critério de aprisionamento estável. Partícula absorvente: o aquecimento pode dominar.'));
}

function buildBeer(host) {
  sec(host, 'Beer–Lambert: absorbância → concentração', 'A = ε·c·ℓ;  T = 10^(−A);  α = ln(10)·A/ℓ;  σ = ln(10)·1000·ε/N_A.');
  formula(host, [{ key: 'A', label: 'Absorbância A', unit: '', v: 0.5 }, { key: 'eps', label: 'Absortividade molar ε', unit: 'L/(mol·cm)', v: 30000 }, { key: 'l', label: 'Caminho óptico ℓ', unit: 'cm', v: 1 }],
    [{ key: 'c', label: 'Concentração c', unit: 'mol/L' }, { key: 'cu', label: 'Concentração c', unit: 'µmol/L' }, { key: 'T', label: 'Transmitância', unit: '%' }, { key: 'a', label: 'Coeficiente de absorção α', unit: 'cm⁻¹' }, { key: 's', label: 'Seção de choque σ', unit: 'cm²' }],
    v => ({ c: v.A / (v.eps * v.l), cu: v.A / (v.eps * v.l) * 1e6, T: Math.pow(10, -v.A) * 100, a: Math.LN10 * v.A / v.l, s: Math.LN10 * 1000 * v.eps / NA }));
  sec(host, 'Concentração → absorbância');
  formula(host, [{ key: 'c', label: 'Concentração', unit: 'µmol/L', v: 10 }, { key: 'eps', label: 'ε', unit: 'L/(mol·cm)', v: 30000 }, { key: 'l', label: 'ℓ', unit: 'cm', v: 1 }],
    [{ key: 'A', label: 'Absorbância A', unit: '' }, { key: 'T', label: 'Transmitância', unit: '%' }],
    v => { const A = v.eps * v.c * 1e-6 * v.l; return { A, T: Math.pow(10, -A) * 100 }; });
}

function buildXrd(host) {
  sec(host, 'Lei de Bragg (rede cúbica)', 'd = a/√(h²+k²+l²);  λ = 2d·sen θ. Cu Kα₁ = 1,5406 Å.');
  formula(host, [{ key: 'lam', label: 'λ dos raios X', unit: 'Å', v: 1.5406 }, { key: 'a', label: 'Constante de rede a', unit: 'Å', v: 5.431 }, { key: 'h', label: 'h', unit: '', v: 1 }, { key: 'k', label: 'k', unit: '', v: 1 }, { key: 'l', label: 'l', unit: '', v: 1 }],
    [{ key: 'd', label: 'Distância interplanar d', unit: 'Å' }, { key: 'tt', label: 'Ângulo 2θ', unit: 'graus' }],
    v => { const d = v.a / Math.sqrt(v.h * v.h + v.k * v.k + v.l * v.l); const s = v.lam / (2 * d); return { d, tt: s <= 1 ? 2 * Math.asin(s) * 180 / Math.PI : NaN }; });
  sec(host, 'Scherrer: tamanho de cristalito', 'D = Kλ/(β cos θ), β = largura a meia altura (radianos, já descontado o alargamento do instrumento).');
  formula(host, [{ key: 'lam', label: 'λ', unit: 'Å', v: 1.5406 }, { key: 'tt', label: '2θ do pico', unit: 'graus', v: 28.44 }, { key: 'b', label: 'Largura β (FWHM)', unit: 'graus', v: 0.3 }, { key: 'K', label: 'Fator de forma K', unit: '', v: 0.9 }],
    [{ key: 'D', label: 'Tamanho do cristalito D', unit: 'nm' }],
    v => ({ D: v.K * v.lam * 0.1 / ((v.b * Math.PI / 180) * Math.cos(v.tt / 2 * Math.PI / 180)) }));
}

export function buildMat(id, host) {
  clear(host);
  if (id === 'ptab') return buildPtab(host);
  if (id === 'semi') return buildSemi(host);
  if (id === 'metal') return buildMetal(host);
  if (id === 'lorentz') return buildLorentz(host);
  if (id === 'mie') return buildMie(host);
  if (id === 'rayleigh') return buildRayleigh(host);
  if (id === 'beer') return buildBeer(host);
  if (id === 'xrd') return buildXrd(host);
}
export const MAT_CALCS = [
  ['ptab', 'Tabela periódica (materiais)'], ['semi', 'Semicondutores: nᵢ, dopagem, nível de Fermi'], ['metal', 'Metais: elétrons livres e Drude'],
  ['lorentz', 'Oscilador de Lorentz (ε, n, k)'], ['mie', 'Esfera: espalhamento Mie e força óptica'], ['rayleigh', 'Pinça em regime Rayleigh (forças, aquecimento)'],
  ['beer', 'Absorção: Beer–Lambert'], ['xrd', 'Raios X: Bragg e Scherrer'],
];
