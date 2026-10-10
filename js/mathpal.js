// Painel de símbolos de matemática (LaTeX), usado no caderno e no documento de texto
import { h, icon, clear } from './util.js';

export function buildMathPal(onInsert, onClose, opts = {}) {
  const G = [
    ['Mais usados', [['∞', '\\infty'], ['∫', '\\int_{@}^{}'], ['∑', '\\sum_{@}^{}'], ['∂', '\\partial'], ['∇', '\\nabla'], ['a/b', '\\frac{@}{}'], ['x²', '^{@}'], ['xₙ', '_{@}'], ['√', '\\sqrt{@}'], ['±', '\\pm'], ['≈', '\\approx'], ['→', '\\to'], ['ℏ', '\\hbar'], ['·', '\\cdot'], ['×', '\\times']]],
    ['Letras gregas', [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\varepsilon'], ['ζ', '\\zeta'], ['η', '\\eta'], ['θ', '\\theta'], ['κ', '\\kappa'], ['λ', '\\lambda'], ['μ', '\\mu'], ['ν', '\\nu'], ['ξ', '\\xi'], ['π', '\\pi'], ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['φ', '\\varphi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'], ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'], ['Ψ', '\\Psi'], ['Ω', '\\Omega']]],
    ['Cálculo', [['∫', '\\int_{@}^{}'], ['∫ab', '\\int_{a}^{b} @ \\, dx'], ['∬', '\\iint'], ['∮', '\\oint'], ['∑', '\\sum_{@}^{}'], ['∏', '\\prod_{@}^{}'], ['lim', '\\lim_{@ \\to }'], ['∂', '\\partial'], ['∇', '\\nabla'], ['∇×', '\\nabla \\times'], ['∇·', '\\nabla \\cdot'], ['∇²', '\\nabla^2'], ['d/dx', '\\frac{d@}{dx}'], ['∂/∂x', '\\frac{\\partial @}{\\partial x}'], ['∞', '\\infty'], ['ẋ', '\\dot{@}']]],
    ['Estrutura', [['a/b', '\\frac{@}{}'], ['x²', '^{@}'], ['xₙ', '_{@}'], ['√', '\\sqrt{@}'], ['ⁿ√', '\\sqrt[n]{@}'], ['( )', '\\left( @ \\right)'], ['[ ]', '\\left[ @ \\right]'], ['| |', '\\left| @ \\right|'], ['⟨ ⟩', '\\langle @ \\rangle'], ['matriz', '\\begin{pmatrix} @ & \\\\  & \\end{pmatrix}'], ['casos', '\\begin{cases} @ & \\\\  & \\end{cases}'], ['texto', '\\text{@}']]],
    ['Vetores', [['v⃗', '\\vec{@}'], ['x̂', '\\hat{@}'], ['𝐯', '\\mathbf{@}'], ['·', '\\cdot'], ['×', '\\times'], ['⊗', '\\otimes'], ['†', '^\\dagger'], ['*', '^*'], ['‖ ‖', '\\| @ \\|'], ['⟨|', '\\langle @ |'], ['|⟩', '| @ \\rangle'], ['ℏ', '\\hbar']]],
    ['Relações', [['≠', '\\neq'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∝', '\\propto'], ['≤', '\\leq'], ['≥', '\\geq'], ['≪', '\\ll'], ['≫', '\\gg'], ['±', '\\pm'], ['∓', '\\mp'], ['→', '\\to'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow'], ['∈', '\\in'], ['⊂', '\\subset'], ['∀', '\\forall'], ['∃', '\\exists'], ['°', '^\\circ']]],
    ['Funções', [['eˣ', 'e^{@}'], ['ln', '\\ln'], ['log', '\\log'], ['exp', '\\exp'], ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan'], ['Re', '\\mathrm{Re}'], ['Im', '\\mathrm{Im}'], ['ε₀', '\\varepsilon_0'], ['μ₀', '\\mu_0'], ['(n)', '\\eqn']]],
  ];
  // painel da direita: Matemática (LaTeX), Formas e Calculadora, escolhidos no seletor do alto
  const tabs = [['math', 'Matemática (LaTeX)']].concat(opts.onShape ? [['shapes', 'Formas']] : [], [['calc', 'Calculadora física']]);
  const sel = h('select.tpsel', { 'aria-label': 'Ferramenta' }, tabs.map(([id, l]) => h('option', { value: id }, l)));
  const body = h('div.tpbody');
  const pal = h('aside.mathpal.toolpanel', { 'aria-label': 'Ferramentas' },
    h('div.mphead', sel, h('button.ibtn.small', { type: 'button', title: 'Esconder', 'aria-label': 'Esconder', onclick: () => onClose() }, icon('close', 16))), body);
  const math = h('div');
  for (const [title, items] of G) {
    math.appendChild(h('div.mpsec', title));
    math.appendChild(h('div.mpgrid', items.map(([l, code]) => h('button.mpbtn', { type: 'button', title: code.replace('@', '…'), onpointerdown: e => e.preventDefault(), onclick: () => onInsert(code) }, l))));
  }
  let built = {};
  pal.setTab = async id => {
    if (!tabs.some(t => t[0] === id)) id = 'math';
    sel.value = id; pal.dataset.tab = id;
    clear(body);
    if (id === 'math') body.appendChild(math);
    else if (id === 'calc') { if (!built.calc) { built.calc = h('div.calcwrap'); const C = await import('./calc.js'); C.buildCalculator(built.calc); } body.appendChild(built.calc); }
    else { if (!built.shapes) { built.shapes = h('div.shapewrap'); await buildShapes(built.shapes, opts.onShape); } body.appendChild(built.shapes); }
  };
  sel.addEventListener('change', () => pal.setTab(sel.value));
  pal.setTab('math');
  return pal;
}

// lista de formas com seletor de tipo no alto
async function buildShapes(host, onShape) {
  const SH = await import('./shapes.js');
  const cat = h('select.tpsel2', { 'aria-label': 'Tipo de forma' }, SH.SHAPE_CATS.map(([id, l]) => h('option', { value: id }, l)));
  const grid = h('div.shgrid');
  const hint = h('div.cnote', 'Toque numa forma e depois arraste na página para desenhá-la no tamanho que quiser (a cor e a espessura são as da caneta).');
  const render = () => {
    clear(grid);
    for (const s of SH.SHAPES.filter(x => x.cat === cat.value)) {
      const b = h('button.shbtn', { type: 'button', title: s.label, onclick: () => { grid.querySelectorAll('.shbtn').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onShape(s, () => b.setAttribute('aria-pressed', 'false')); } }, h('span.shprev'), h('span.shlab', s.label));
      b.querySelector('.shprev').innerHTML = SH.shapePreview(s);
      grid.appendChild(b);
    }
  };
  cat.addEventListener('change', render);
  render();
  host.append(cat, hint, grid);
}
