// Calculadoras de física: óptica/espectroscopia, feixe gaussiano, focalização, pinças ópticas,
// unidades, física médica e constantes. Campos ligados: mudar um recalcula os outros.
import { h, clear, copyText, toast } from './util.js';

// constantes (CODATA 2018; as SI exatas desde 2019)
export const K = {
  h: 6.62607015e-34, c: 299792458, e: 1.602176634e-19, kB: 1.380649e-23, NA: 6.02214076e23,
  me: 9.1093837015e-31, mp: 1.67262192369e-27, u: 1.66053906660e-27, eps0: 8.8541878128e-12, mu0: 1.25663706212e-6,
  sigma: 5.670374419e-8, a0: 5.29177210903e-11, Rinf: 10973731.568160, R: 8.314462618,
};
K.hbar = K.h / (2 * Math.PI);

// número em português: vírgula decimal; muito grande/pequeno em notação científica
export function fmt(v, sig = 6) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  if (v === 0) return '0';
  const a = Math.abs(v);
  let s;
  if (a >= 1e6 || a < 1e-3) { const [m, ex] = v.toExponential(sig - 1).split('e'); s = String(+m).replace('.', ',') + '×10^' + (+ex); }
  else s = String(+v.toPrecision(sig)).replace('.', ',');
  return s;
}
export function parse(s) {
  s = String(s || '').trim().replace(/\s/g, '').replace(/×10\^?|x10\^|·10\^|\*10\^/i, 'e').replace(',', '.');
  if (!s) return NaN;
  return Number(s);
}

// ---------- peças de interface ----------
function inputRow(label, unit, opts = {}) {
  const inp = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': label, readonly: opts.out ? true : undefined });
  if (opts.out) inp.classList.add('out');
  const row = h('label.crow', h('span.cl', label), inp, h('span.cu', unit || ''));
  return { row, inp };
}
// grupo ligado: cada campo converte de/para uma grandeza base
function linked(host, fields, init) {
  const rows = fields.map(f => Object.assign(inputRow(f.label, f.unit), { f }));
  const set = (base, except) => { for (const r of rows) if (r !== except) r.inp.value = isFinite(base) ? fmt(r.f.from(base)) : ''; };
  for (const r of rows) {
    r.inp.addEventListener('input', () => { const v = parse(r.inp.value); if (isFinite(v)) set(r.f.to(v), r); });
    host.appendChild(r.row);
  }
  if (init !== undefined) set(init);
}
// fórmula: entradas → saídas
function formula(host, ins, outs, fn) {
  const I = ins.map(f => Object.assign(inputRow(f.label, f.unit), { f }));
  const O = outs.map(f => Object.assign(inputRow(f.label, f.unit, { out: true }), { f }));
  const run = () => {
    const v = {}; for (const r of I) v[r.f.key] = parse(r.inp.value);
    let res = {}; try { res = fn(v) || {}; } catch (e) { res = {}; }
    for (const r of O) r.inp.value = fmt(res[r.f.key]);
  };
  for (const r of I) { r.inp.value = r.f.v !== undefined ? fmt(r.f.v) : ''; r.inp.addEventListener('input', run); host.appendChild(r.row); }
  if (outs.length) host.appendChild(h('div.csep'));
  for (const r of O) host.appendChild(r.row);
  run();
  return { I, run };
}
const sec = (host, t, note) => { host.appendChild(h('div.csec', t)); if (note) host.appendChild(h('div.cnote', note)); };

// ---------- calculadoras ----------
const CALCS = [
  ['luz', 'Óptica · λ, energia, número de onda'],
  ['nk', 'Índice de refração dos materiais (refractiveindex.info)'],
  ['raman', 'Espectroscopia · Raman e linhas'],
  ['gauss', 'Feixe gaussiano'],
  ['foco', 'Focalização · resolução e intensidade'],
  ['pinca', 'Pinças ópticas'],
  ['med', 'Física médica'],
  ['unid', 'Unidades'],
  ['const', 'Constantes'],
];

function buildCalc(id, host) {
  clear(host);
  if (id === 'nk') { import('./nkdb.js').then(m => m.buildNk(host)); return; }
  const { h: hp, c, e, kB, NA } = K;
  if (id === 'luz') {
    sec(host, 'Fóton', 'Digite em qualquer campo; os outros mudam juntos.');
    linked(host, [
      { label: 'λ (vácuo)', unit: 'nm', to: v => c / (v * 1e-9), from: b => c / b * 1e9 },
      { label: 'λ (vácuo)', unit: 'µm', to: v => c / (v * 1e-6), from: b => c / b * 1e6 },
      { label: 'Frequência ν', unit: 'THz', to: v => v * 1e12, from: b => b / 1e12 },
      { label: 'Número de onda', unit: 'cm⁻¹', to: v => v * 100 * c, from: b => b / c / 100 },
      { label: 'Energia', unit: 'eV', to: v => v * e / hp, from: b => b * hp / e },
      { label: 'Energia', unit: 'J', to: v => v / hp, from: b => b * hp },
      { label: 'Energia por mol', unit: 'kJ/mol', to: v => v * 1e3 / NA / hp, from: b => b * hp * NA / 1e3 },
      { label: 'Temperatura (E = k_BT)', unit: 'K', to: v => v * kB / hp, from: b => b * hp / kB },
    ], c / 1064e-9);
    sec(host, 'No meio');
    formula(host, [{ key: 'l', label: 'λ (vácuo)', unit: 'nm', v: 1064 }, { key: 'n', label: 'Índice n', unit: '', v: 1.33 }],
      [{ key: 'lm', label: 'λ no meio', unit: 'nm' }, { key: 'k', label: 'k = 2πn/λ', unit: 'µm⁻¹' }, { key: 'v', label: 'Velocidade c/n', unit: 'm/s' }],
      v => ({ lm: v.l / v.n, k: 2 * Math.PI * v.n / (v.l / 1000), v: c / v.n }));
    sec(host, 'Fótons por segundo');
    formula(host, [{ key: 'P', label: 'Potência', unit: 'mW', v: 100 }, { key: 'l', label: 'λ', unit: 'nm', v: 1064 }],
      [{ key: 'N', label: 'Fótons por segundo', unit: '1/s' }], v => ({ N: v.P * 1e-3 * v.l * 1e-9 / (hp * c) }));
    return;
  }
  if (id === 'raman') {
    sec(host, 'Deslocamento Raman', 'Δν̃ = 1/λ_laser − 1/λ_espalhado (positivo = Stokes).');
    formula(host, [{ key: 'l0', label: 'λ do laser', unit: 'nm', v: 785 }, { key: 'd', label: 'Deslocamento', unit: 'cm⁻¹', v: 1000 }],
      [{ key: 'ls', label: 'λ Stokes', unit: 'nm' }, { key: 'la', label: 'λ anti-Stokes', unit: 'nm' }],
      v => ({ ls: 1e7 / (1e7 / v.l0 - v.d), la: 1e7 / (1e7 / v.l0 + v.d) }));
    sec(host, 'De λ medido para deslocamento');
    formula(host, [{ key: 'l0', label: 'λ do laser', unit: 'nm', v: 785 }, { key: 'ls', label: 'λ medido', unit: 'nm', v: 850 }],
      [{ key: 'd', label: 'Deslocamento', unit: 'cm⁻¹' }, { key: 'eV', label: 'Energia', unit: 'meV' }],
      v => { const d = 1e7 / v.l0 - 1e7 / v.ls; return { d, eV: d * 100 * c * hp / e * 1000 }; });
    sec(host, 'Largura de linha', 'Δλ (nm) em torno de λ → Δν̃ e Δν.');
    formula(host, [{ key: 'l', label: 'λ central', unit: 'nm', v: 1064 }, { key: 'dl', label: 'Δλ', unit: 'nm', v: 0.1 }],
      [{ key: 'dk', label: 'Δν̃', unit: 'cm⁻¹' }, { key: 'df', label: 'Δν', unit: 'GHz' }],
      v => ({ dk: 1e7 * v.dl / (v.l * v.l), df: c * v.dl * 1e-9 / sq(v.l * 1e-9) / 1e9 }));
    return;
  }
  if (id === 'gauss') {
    sec(host, 'Feixe gaussiano (TEM₀₀)', 'Cintura w₀ = raio em 1/e² da intensidade.');
    formula(host, [{ key: 'l', label: 'λ (vácuo)', unit: 'nm', v: 1064 }, { key: 'w0', label: 'Cintura w₀', unit: 'µm', v: 1 }, { key: 'n', label: 'Índice do meio', unit: '', v: 1 }, { key: 'z', label: 'Distância z', unit: 'µm', v: 2 }, { key: 'M2', label: 'M²', unit: '', v: 1 }],
      [{ key: 'zR', label: 'Comprimento de Rayleigh z_R', unit: 'µm' }, { key: 'b', label: 'Parâmetro confocal 2z_R', unit: 'µm' }, { key: 'th', label: 'Divergência θ (meio ângulo)', unit: 'mrad' }, { key: 'NA', label: 'NA equivalente', unit: '' }, { key: 'wz', label: 'w(z)', unit: 'µm' }, { key: 'Rz', label: 'Raio de curvatura R(z)', unit: 'µm' }, { key: 'gouy', label: 'Fase de Gouy', unit: 'rad' }],
      v => { const lm = v.l * 1e-3 / v.n * (v.M2 || 1); const zR = Math.PI * v.w0 * v.w0 / lm; const th = lm / (Math.PI * v.w0); const q = v.z / zR;
        return { zR, b: 2 * zR, th: th * 1e3, NA: v.n * Math.sin(Math.atan(th)), wz: v.w0 * Math.sqrt(1 + q * q), Rz: v.z ? v.z * (1 + 1 / (q * q)) : Infinity, gouy: Math.atan(q) }; });
    sec(host, 'Feixe expandido por telescópio');
    formula(host, [{ key: 'w', label: 'Raio do feixe na entrada', unit: 'mm', v: 1 }, { key: 'f1', label: 'f₁', unit: 'mm', v: 50 }, { key: 'f2', label: 'f₂', unit: 'mm', v: 200 }],
      [{ key: 'M', label: 'Aumento f₂/f₁', unit: '×' }, { key: 'w2', label: 'Raio na saída', unit: 'mm' }, { key: 'L', label: 'Distância entre lentes', unit: 'mm' }],
      v => ({ M: v.f2 / v.f1, w2: v.w * v.f2 / v.f1, L: v.f1 + v.f2 }));
    sec(host, 'Foco de uma lente');
    formula(host, [{ key: 'l', label: 'λ', unit: 'nm', v: 1064 }, { key: 'D', label: 'Diâmetro do feixe (1/e²)', unit: 'mm', v: 6 }, { key: 'f', label: 'Focal f', unit: 'mm', v: 100 }],
      [{ key: 'w0', label: 'Cintura no foco w₀ ≈ 2λf/(πD)', unit: 'µm' }],
      v => ({ w0: 2 * v.l * 1e-6 * v.f / (Math.PI * v.D) * 1e3 }));
    return;
  }
  if (id === 'foco') {
    sec(host, 'Resolução', 'Limites clássicos para o microscópio.');
    formula(host, [{ key: 'l', label: 'λ', unit: 'nm', v: 532 }, { key: 'NA', label: 'NA da objetiva', unit: '', v: 1.3 }, { key: 'n', label: 'Índice (imersão)', unit: '', v: 1.518 }],
      [{ key: 'abbe', label: 'Abbe λ/(2NA)', unit: 'nm' }, { key: 'ray', label: 'Rayleigh 0,61λ/NA', unit: 'nm' }, { key: 'ax', label: 'Axial ≈ 2nλ/NA²', unit: 'nm' }, { key: 'ang', label: 'Meio ângulo do cone', unit: 'graus' }],
      v => ({ abbe: v.l / (2 * v.NA), ray: 0.61 * v.l / v.NA, ax: 2 * v.n * v.l / (v.NA * v.NA), ang: Math.asin(Math.min(1, v.NA / v.n)) * 180 / Math.PI }));
    sec(host, 'Intensidade no foco');
    formula(host, [{ key: 'P', label: 'Potência', unit: 'mW', v: 100 }, { key: 'w0', label: 'Raio w₀ (1/e²)', unit: 'µm', v: 0.5 }, { key: 'T', label: 'Transmissão até a amostra', unit: '%', v: 60 }],
      [{ key: 'I0', label: 'Intensidade de pico 2P/(πw₀²)', unit: 'MW/cm²' }, { key: 'Im', label: 'Intensidade média P/(πw₀²)', unit: 'MW/cm²' }],
      v => { const P = v.P * 1e-3 * v.T / 100, A = Math.PI * sq(v.w0 * 1e-4); return { I0: 2 * P / A / 1e6, Im: P / A / 1e6 }; });
    sec(host, 'Laser pulsado');
    formula(host, [{ key: 'P', label: 'Potência média', unit: 'mW', v: 100 }, { key: 'f', label: 'Taxa de repetição', unit: 'MHz', v: 80 }, { key: 't', label: 'Duração do pulso', unit: 'fs', v: 100 }],
      [{ key: 'E', label: 'Energia por pulso', unit: 'nJ' }, { key: 'Pp', label: 'Potência de pico', unit: 'kW' }],
      v => { const E = v.P * 1e-3 / (v.f * 1e6); return { E: E * 1e9, Pp: E / (v.t * 1e-15) * 0.94 / 1e3 }; });
    return;
  }
  if (id === 'pinca') {
    sec(host, 'Arrasto de Stokes', 'γ = 6πηr. Viscosidade da água calculada pela temperatura (deixe em branco para usar a da água).');
    const st = formula(host, [{ key: 'r', label: 'Raio da partícula', unit: 'µm', v: 0.5 }, { key: 'T', label: 'Temperatura', unit: '°C', v: 25 }, { key: 'eta', label: 'Viscosidade (opcional)', unit: 'mPa·s' }],
      [{ key: 'etaw', label: 'Viscosidade usada', unit: 'mPa·s' }, { key: 'g', label: 'γ = 6πηr', unit: 'pN·s/µm' }, { key: 'D', label: 'Difusão D = k_BT/γ', unit: 'µm²/s' }],
      v => { const eta = isFinite(v.eta) ? v.eta * 1e-3 : waterEta(v.T); const g = 6 * Math.PI * eta * v.r * 1e-6; return { etaw: eta * 1e3, g: g * 1e6, D: kB * (v.T + 273.15) / g * 1e12 }; });
    void st;
    sec(host, 'Rigidez pela frequência de corte', 'κ = 2πγf_c (espectro de potência lorentziano).');
    formula(host, [{ key: 'r', label: 'Raio', unit: 'µm', v: 0.5 }, { key: 'T', label: 'Temperatura', unit: '°C', v: 25 }, { key: 'fc', label: 'Frequência de corte f_c', unit: 'Hz', v: 500 }],
      [{ key: 'k', label: 'Rigidez κ', unit: 'pN/µm' }, { key: 'tau', label: 'Tempo de relaxação γ/κ', unit: 'ms' }],
      v => { const g = 6 * Math.PI * waterEta(v.T) * v.r * 1e-6; const k = 2 * Math.PI * g * v.fc; return { k: k * 1e6, tau: g / k * 1e3 }; });
    sec(host, 'Rigidez pela equipartição', 'κ = k_BT/⟨x²⟩.');
    formula(host, [{ key: 'T', label: 'Temperatura', unit: '°C', v: 25 }, { key: 'x2', label: 'Variância ⟨x²⟩', unit: 'nm²', v: 400 }],
      [{ key: 'k', label: 'Rigidez κ', unit: 'pN/µm' }, { key: 'sd', label: 'Desvio padrão', unit: 'nm' }],
      v => ({ k: kB * (v.T + 273.15) / (v.x2 * 1e-18) * 1e6, sd: Math.sqrt(v.x2) }));
    sec(host, 'Força óptica', 'F = Q·n·P/c (Q = eficiência adimensional).');
    formula(host, [{ key: 'P', label: 'Potência na amostra', unit: 'mW', v: 50 }, { key: 'n', label: 'Índice do meio', unit: '', v: 1.33 }, { key: 'Q', label: 'Eficiência Q', unit: '', v: 0.1 }, { key: 'v', label: 'Velocidade de arrasto', unit: 'µm/s', v: 100 }, { key: 'r', label: 'Raio', unit: 'µm', v: 0.5 }],
      [{ key: 'F', label: 'Força máxima', unit: 'pN' }, { key: 'Fd', label: 'Força de arrasto γv (25 °C)', unit: 'pN' }],
      v => ({ F: v.Q * v.n * v.P * 1e-3 / c * 1e12, Fd: 6 * Math.PI * waterEta(25) * v.r * 1e-6 * v.v * 1e-6 * 1e12 }));
    return;
  }
  if (id === 'med') { buildMed(host); return; }
  if (id === 'unid') { buildUnits(host); return; }
  if (id === 'const') {
    const rows = [['Planck h', K.h, 'J·s'], ['ħ = h/2π', K.hbar, 'J·s'], ['Velocidade da luz c', K.c, 'm/s'], ['Carga elementar e', K.e, 'C'], ['Boltzmann k_B', K.kB, 'J/K'], ['Avogadro N_A', K.NA, '1/mol'], ['Massa do elétron', K.me, 'kg'], ['Massa do próton', K.mp, 'kg'], ['Unidade de massa atômica', K.u, 'kg'], ['ε₀', K.eps0, 'F/m'], ['μ₀', K.mu0, 'N/A²'], ['Stefan–Boltzmann σ', K.sigma, 'W/(m²K⁴)'], ['Raio de Bohr a₀', K.a0, 'm'], ['Rydberg R∞', K.Rinf, '1/m'], ['Gases R', K.R, 'J/(mol·K)'], ['hc', K.h * K.c / K.e * 1e9, 'eV·nm'], ['k_B (em eV)', K.kB / K.e, 'eV/K'], ['m_e c²', K.me * K.c * K.c / K.e / 1e6, 'MeV']];
    for (const [l, v, u] of rows) host.appendChild(h('div.crow.const', h('span.cl', l), h('button.cval', { type: 'button', title: 'Copiar', onclick: () => { copyText(String(v)); toast('Copiado: ' + v); } }, fmt(v, 10)), h('span.cu', u)));
    host.appendChild(h('div.cnote', 'Valores do CODATA 2018 (h, c, e, k_B e N_A são exatos no SI).'));
  }
}
const sq = v => v * v;
// viscosidade da água (Pa·s): η = A·10^(B/(T−C)), T em K
function waterEta(Tc) { const T = (isFinite(Tc) ? Tc : 25) + 273.15; return 2.414e-5 * Math.pow(10, 247.8 / (T - 140)); }

// ---------- física médica ----------
const ISOTOPES = [['Tc-99m', 6.0067, 'h'], ['F-18', 109.77, 'min'], ['Ga-68', 67.71, 'min'], ['I-131', 8.0252, 'd'], ['I-125', 59.39, 'd'], ['Lu-177', 6.647, 'd'], ['Ir-192', 73.83, 'd'], ['Co-60', 5.2713, 'a'], ['Cs-137', 30.08, 'a'], ['Ra-226', 1600, 'a']];
const TUNIT = { s: 1, min: 60, h: 3600, d: 86400, a: 365.25 * 86400 };
function wNeutron(E) {   // fator de ponderação de nêutrons (ICRP 103), E em MeV
  if (E < 1) return 2.5 + 18.2 * Math.exp(-sq(Math.log(E)) / 6);
  if (E <= 50) return 5.0 + 17.0 * Math.exp(-sq(Math.log(2 * E)) / 6);
  return 2.5 + 3.25 * Math.exp(-sq(Math.log(0.04 * E)) / 6);
}
function buildMed(host) {
  sec(host, 'Dose absorvida e equivalente');
  linked(host, [
    { label: 'Dose', unit: 'Gy', to: v => v, from: b => b }, { label: 'Dose', unit: 'cGy', to: v => v / 100, from: b => b * 100 },
    { label: 'Dose', unit: 'mGy', to: v => v / 1000, from: b => b * 1000 }, { label: 'Dose', unit: 'rad', to: v => v / 100, from: b => b * 100 },
  ], 2);
  sec(host, 'Dose equivalente H = w_R·D', 'w_R (ICRP 103): fótons e elétrons 1; prótons 2; alfa e íons pesados 20; nêutrons: função da energia.');
  const sel = h('select', { 'aria-label': 'Tipo de radiação' }, [['1', 'Fótons (raios X, gama)'], ['1e', 'Elétrons, múons'], ['2', 'Prótons'], ['20', 'Alfa, íons pesados'], ['n', 'Nêutrons (informe a energia)']].map(([v, l]) => h('option', { value: v }, l)));
  host.appendChild(h('label.crow', h('span.cl', 'Radiação'), sel, h('span.cu', '')));
  const f = formula(host, [{ key: 'D', label: 'Dose absorvida', unit: 'Gy', v: 0.01 }, { key: 'En', label: 'Energia dos nêutrons', unit: 'MeV', v: 1 }],
    [{ key: 'wR', label: 'w_R', unit: '' }, { key: 'H', label: 'Dose equivalente', unit: 'Sv' }, { key: 'mSv', label: 'Dose equivalente', unit: 'mSv' }, { key: 'rem', label: 'Dose equivalente', unit: 'rem' }],
    v => { const w = sel.value === 'n' ? wNeutron(v.En) : parseFloat(sel.value); const H = w * v.D; return { wR: w, H, mSv: H * 1e3, rem: H * 100 }; });
  sel.addEventListener('change', f.run);
  sec(host, 'Atividade');
  linked(host, [
    { label: 'Atividade', unit: 'Bq', to: v => v, from: b => b }, { label: 'Atividade', unit: 'MBq', to: v => v * 1e6, from: b => b / 1e6 },
    { label: 'Atividade', unit: 'GBq', to: v => v * 1e9, from: b => b / 1e9 }, { label: 'Atividade', unit: 'mCi', to: v => v * 3.7e7, from: b => b / 3.7e7 },
    { label: 'Atividade', unit: 'Ci', to: v => v * 3.7e10, from: b => b / 3.7e10 },
  ], 3.7e8);
  sec(host, 'Decaimento radioativo', 'A(t) = A₀·(1/2)^(t/T½). Escolha um radionuclídeo ou digite a meia-vida.');
  const iso = h('select', { 'aria-label': 'Radionuclídeo' }, [h('option', { value: '' }, '— outro —'), ...ISOTOPES.map(([n, t, u]) => h('option', { value: n }, n + ' (T½ = ' + String(t).replace('.', ',') + ' ' + u + ')'))]);
  const tu = h('select', { 'aria-label': 'Unidade de tempo' }, Object.keys(TUNIT).map(u => h('option', { value: u }, u === 'a' ? 'anos' : u)));
  tu.value = 'h';
  host.appendChild(h('label.crow', h('span.cl', 'Radionuclídeo'), iso, h('span.cu', '')));
  host.appendChild(h('label.crow', h('span.cl', 'Unidade de tempo'), tu, h('span.cu', '')));
  const dec = formula(host, [{ key: 'A0', label: 'Atividade inicial A₀', unit: 'MBq', v: 740 }, { key: 'T', label: 'Meia-vida T½', unit: '(unid.)', v: 6.0067 }, { key: 't', label: 'Tempo decorrido t', unit: '(unid.)', v: 24 }],
    [{ key: 'A', label: 'Atividade A(t)', unit: 'MBq' }, { key: 'fr', label: 'Fração restante', unit: '%' }, { key: 'lam', label: 'Constante λ = ln2/T½', unit: '1/(unid.)' }, { key: 'tau', label: 'Vida média τ', unit: '(unid.)' }],
    v => { const lam = Math.LN2 / v.T; const fr = Math.exp(-lam * v.t); return { A: v.A0 * fr, fr: fr * 100, lam, tau: 1 / lam }; });
  iso.addEventListener('change', () => { const it = ISOTOPES.find(x => x[0] === iso.value); if (!it) return; tu.value = it[2]; dec.I[1].inp.value = fmt(it[1]); dec.run(); });
  sec(host, 'Atenuação I = I₀·e^(−μx)');
  formula(host, [{ key: 'mr', label: 'Coef. mássico μ/ρ', unit: 'cm²/g', v: 0.0707 }, { key: 'rho', label: 'Densidade ρ', unit: 'g/cm³', v: 11.35 }, { key: 'x', label: 'Espessura x', unit: 'cm', v: 1 }],
    [{ key: 'mu', label: 'μ linear', unit: 'cm⁻¹' }, { key: 'T', label: 'Transmissão I/I₀', unit: '%' }, { key: 'hvl', label: 'Camada semirredutora (HVL)', unit: 'cm' }, { key: 'tvl', label: 'Camada decirredutora (TVL)', unit: 'cm' }],
    v => { const mu = v.mr * v.rho; return { mu, T: Math.exp(-mu * v.x) * 100, hvl: Math.LN2 / mu, tvl: Math.LN10 / mu }; });
  sec(host, 'Inverso do quadrado da distância');
  formula(host, [{ key: 'D1', label: 'Taxa de dose a r₁', unit: '(unid.)', v: 10 }, { key: 'r1', label: 'r₁', unit: 'm', v: 1 }, { key: 'r2', label: 'r₂', unit: 'm', v: 2 }],
    [{ key: 'D2', label: 'Taxa de dose a r₂', unit: '(unid.)' }], v => ({ D2: v.D1 * sq(v.r1 / v.r2) }));
  sec(host, 'Raios X');
  linked(host, [
    { label: 'Energia do fóton', unit: 'keV', to: v => v * 1e3 * K.e / K.h, from: b => b * K.h / K.e / 1e3 },
    { label: 'Comprimento de onda', unit: 'pm', to: v => K.c / (v * 1e-12), from: b => K.c / b * 1e12 },
    { label: 'Comprimento de onda', unit: 'Å', to: v => K.c / (v * 1e-10), from: b => K.c / b * 1e10 },
  ], 60e3 * K.e / K.h);
  host.appendChild(h('div.cnote', 'Duane–Hunt: λ_mín (pm) = 1239,84 / kVp (kV) — o fóton de maior energia tem E = e·kVp.'));
  host.appendChild(h('div.cnote', 'μ/ρ do exemplo (chumbo, ~1 MeV) é ilustrativo: use os valores de tabela (NIST XCOM) para cada material e energia.'));
}

// ---------- unidades ----------
const UNITS = {
  'Comprimento': [['m', 1], ['cm', 1e-2], ['mm', 1e-3], ['µm', 1e-6], ['nm', 1e-9], ['pm', 1e-12], ['Å', 1e-10], ['km', 1e3], ['pol (in)', 0.0254]],
  'Energia': [['J', 1], ['eV', K.e], ['keV', K.e * 1e3], ['MeV', K.e * 1e6], ['erg', 1e-7], ['cal', 4.184], ['kcal/mol', 4184 / K.NA], ['kWh', 3.6e6], ['hartree', 4.3597447222071e-18]],
  'Potência': [['W', 1], ['mW', 1e-3], ['µW', 1e-6], ['kW', 1e3], ['dBm', 'dbm']],
  'Pressão': [['Pa', 1], ['kPa', 1e3], ['bar', 1e5], ['mbar', 100], ['atm', 101325], ['mmHg (Torr)', 133.322368], ['psi', 6894.757]],
  'Temperatura': [['°C', 'C'], ['K', 'K'], ['°F', 'F']],
  'Ângulo': [['rad', 1], ['mrad', 1e-3], ['grau', Math.PI / 180], ['minuto de arco', Math.PI / 10800], ['segundo de arco', Math.PI / 648000]],
  'Dose equivalente': [['Sv', 1], ['mSv', 1e-3], ['µSv', 1e-6], ['rem', 1e-2], ['mrem', 1e-5]],
  'Massa': [['kg', 1], ['g', 1e-3], ['mg', 1e-6], ['µg', 1e-9], ['u (Da)', K.u], ['lb', 0.45359237]],
  'Tempo': [['s', 1], ['ms', 1e-3], ['µs', 1e-6], ['ns', 1e-9], ['ps', 1e-12], ['fs', 1e-15], ['min', 60], ['h', 3600], ['dia', 86400], ['ano', 365.25 * 86400]],
};
function buildUnits(host) {
  const sel = h('select', { 'aria-label': 'Grandeza' }, Object.keys(UNITS).map(k => h('option', { value: k }, k)));
  host.appendChild(h('label.crow', h('span.cl', 'Grandeza'), sel, h('span.cu', '')));
  const box = h('div');
  host.appendChild(box);
  const render = () => {
    clear(box);
    const list = UNITS[sel.value];
    const f = list.map(([u, k]) => {
      if (k === 'dbm') return { label: '', unit: u, to: v => 1e-3 * Math.pow(10, v / 10), from: b => 10 * Math.log10(b / 1e-3) };
      if (k === 'C') return { label: '', unit: u, to: v => v + 273.15, from: b => b - 273.15 };
      if (k === 'K') return { label: '', unit: u, to: v => v, from: b => b };
      if (k === 'F') return { label: '', unit: u, to: v => (v - 32) * 5 / 9 + 273.15, from: b => (b - 273.15) * 9 / 5 + 32 };
      return { label: '', unit: u, to: v => v * k, from: b => b / k };
    });
    linked(box, f, sel.value === 'Temperatura' ? 298.15 : f[0].to(1));
  };
  sel.addEventListener('change', render);
  render();
}

// painel com o seletor no alto
export function buildCalculator(host, start) {
  const sel = h('select.calcsel', { 'aria-label': 'Tipo de calculadora' }, CALCS.map(([id, l]) => h('option', { value: id }, l)));
  sel.value = start || 'luz';
  const body = h('div.cbody');
  sel.addEventListener('change', () => { buildCalc(sel.value, body); try { localStorage.setItem('leitor-calc', sel.value); } catch (e) {} });
  try { const last = localStorage.getItem('leitor-calc'); if (last && CALCS.some(c => c[0] === last) && !start) sel.value = last; } catch (e) {}
  buildCalc(sel.value, body);
  host.append(sel, body);
}
