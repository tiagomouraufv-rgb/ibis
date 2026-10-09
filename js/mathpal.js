// Painel de símbolos de matemática (LaTeX), usado no caderno e no documento de texto
import { h, icon } from './util.js';

export function buildMathPal(onInsert, onClose) {
  const G = [
    ['Letras gregas', [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\varepsilon'], ['ζ', '\\zeta'], ['η', '\\eta'], ['θ', '\\theta'], ['κ', '\\kappa'], ['λ', '\\lambda'], ['μ', '\\mu'], ['ν', '\\nu'], ['ξ', '\\xi'], ['π', '\\pi'], ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['φ', '\\varphi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'], ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'], ['Ψ', '\\Psi'], ['Ω', '\\Omega']]],
    ['Cálculo', [['∫', '\\int_{@}^{}'], ['∫ab', '\\int_{a}^{b} @ \\, dx'], ['∬', '\\iint'], ['∮', '\\oint'], ['∑', '\\sum_{@}^{}'], ['∏', '\\prod_{@}^{}'], ['lim', '\\lim_{@ \\to }'], ['∂', '\\partial'], ['∇', '\\nabla'], ['∇×', '\\nabla \\times'], ['∇·', '\\nabla \\cdot'], ['∇²', '\\nabla^2'], ['d/dx', '\\frac{d@}{dx}'], ['∂/∂x', '\\frac{\\partial @}{\\partial x}'], ['∞', '\\infty'], ['ẋ', '\\dot{@}']]],
    ['Estrutura', [['a/b', '\\frac{@}{}'], ['x²', '^{@}'], ['xₙ', '_{@}'], ['√', '\\sqrt{@}'], ['ⁿ√', '\\sqrt[n]{@}'], ['( )', '\\left( @ \\right)'], ['[ ]', '\\left[ @ \\right]'], ['| |', '\\left| @ \\right|'], ['⟨ ⟩', '\\langle @ \\rangle'], ['matriz', '\\begin{pmatrix} @ & \\\\  & \\end{pmatrix}'], ['casos', '\\begin{cases} @ & \\\\  & \\end{cases}'], ['texto', '\\text{@}']]],
    ['Vetores', [['v⃗', '\\vec{@}'], ['x̂', '\\hat{@}'], ['𝐯', '\\mathbf{@}'], ['·', '\\cdot'], ['×', '\\times'], ['⊗', '\\otimes'], ['†', '^\\dagger'], ['*', '^*'], ['‖ ‖', '\\| @ \\|'], ['⟨|', '\\langle @ |'], ['|⟩', '| @ \\rangle'], ['ℏ', '\\hbar']]],
    ['Relações', [['≠', '\\neq'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∝', '\\propto'], ['≤', '\\leq'], ['≥', '\\geq'], ['≪', '\\ll'], ['≫', '\\gg'], ['±', '\\pm'], ['∓', '\\mp'], ['→', '\\to'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow'], ['∈', '\\in'], ['⊂', '\\subset'], ['∀', '\\forall'], ['∃', '\\exists'], ['°', '^\\circ']]],
    ['Funções', [['eˣ', 'e^{@}'], ['ln', '\\ln'], ['log', '\\log'], ['exp', '\\exp'], ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan'], ['Re', '\\mathrm{Re}'], ['Im', '\\mathrm{Im}'], ['ε₀', '\\varepsilon_0'], ['μ₀', '\\mu_0'], ['(n)', '\\eqn']]],
  ];
  const pal = h('aside.mathpal', { 'aria-label': 'Símbolos de matemática' },
  h('div.mphead', h('b', 'Matemática'), h('button.ibtn.small', { type: 'button', title: 'Esconder', 'aria-label': 'Esconder', onclick: () => onClose() }, icon('close', 16))));
  for (const [title, items] of G) {
  pal.appendChild(h('div.mpsec', title));
  pal.appendChild(h('div.mpgrid', items.map(([l, code]) => h('button.mpbtn', { type: 'button', title: code.replace('@', '…'), onpointerdown: e => e.preventDefault(), onclick: () => onInsert(code) }, l))));
  }
  return pal;
}
