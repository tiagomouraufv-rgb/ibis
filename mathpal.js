// Painel de símbolos de matemática (LaTeX), usado no caderno e no documento de texto
import { h, icon, clear, popMenu, promptBox, confirmBox, toast } from './util.js';

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
  const tabs = [['math', 'Matemática (LaTeX)']].concat(opts.onShape ? [['shapes', 'Formas']] : [], [['calc', 'Calculadora física']], opts.ai ? [['ai', 'IA']] : []);
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
    else if (id === 'ai') {
      const docId = opts.ai.doc() && opts.ai.doc().id;
      if (!built.ai || built.aiDoc !== docId || built.aiStamp !== (opts.ai.doc() || {}).md) {
        built.ai = h('div.aiwrap'); built.aiDoc = docId; built.aiStamp = (opts.ai.doc() || {}).md;
        const A = await import('./aipanel.js');
        A.buildAiPanel(built.ai, opts.ai).catch(e => { built.ai.textContent = 'Erro: ' + e.message; });
      }
      body.appendChild(built.ai);
    }
    else if (id === 'calc') { if (!built.calc) { built.calc = h('div.calcwrap'); const C = await import('./calc.js'); C.buildCalculator(built.calc); } body.appendChild(built.calc); }
    else { if (!built.shapes) { built.shapes = h('div.shapewrap'); await buildShapes(built.shapes, opts.onShape, opts.getSelected); } body.appendChild(built.shapes); }
  };
  sel.addEventListener('change', () => pal.setTab(sel.value));
  pal.setTab('math');
  return pal;
}

// lista de formas com seletor de tipo no alto (inclui as categorias criadas por você)
async function buildShapes(host, onShape, getSelected) {
  const SH = await import('./shapes.js');
  const MY = await import('./myshapes.js');
  const cat = h('select.tpsel2', { 'aria-label': 'Tipo de forma' });
  const grid = h('div.shgrid');
  const hint = h('div.cnote');
  let last = 'geo';
  try { last = localStorage.getItem('leitor-shapecat') || 'geo'; } catch (e) {}
  const fillCats = async () => {
    const st = await MY.load();
    clear(cat);
    for (const [id, l] of SH.SHAPE_CATS) cat.appendChild(h('option', { value: id }, l));
    if (st.cats.length) cat.appendChild(h('optgroup', { label: 'Minhas categorias' }, st.cats.map(c => h('option', { value: c.id }, '★ ' + c.name))));
    cat.appendChild(h('option', { value: '__new' }, '＋ Nova categoria…'));
    cat.value = [...cat.options].some(o => o.value === last) ? last : 'geo';
  };
  const pick = (b, s) => { grid.querySelectorAll('.shbtn').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onShape(s, () => b.setAttribute('aria-pressed', 'false')); };
  const addTo = async (catId, e) => {
    const sel = getSelected ? getSelected() : null;
    const ink = sel ? sel.filter(a => a.kind === 'ink') : [];
    const img = sel && sel.length === 1 && sel[0].kind === 'img' ? sel[0] : null;
    const r = e.currentTarget.getBoundingClientRect();
    popMenu(r.left, r.bottom + 4, [
      { icon: 'lasso', label: ink.length || img ? 'Da seleção na página (' + (img ? 'imagem' : ink.length + ' traço(s)') + ')' : 'Da seleção na página (selecione com o Laço primeiro)', onclick: async () => {
        if (!ink.length && !img) { toast('Desenhe a figura, selecione com o Laço e volte aqui.', 3500); return; }
        const label = await promptBox('Nova forma', 'Nome da forma (ex.: Montagem da pinça)', ''); if (label === null) return;
        try {
          if (img) { const S = await import('./store.js'); const b = await S.audioBlob(img.fileId); await MY.addFromImage(catId, label, b); }
          else await MY.addFromStrokes(catId, label, ink);
          toast('Forma salva.', 1500);
        } catch (err) { toast(err.message, 3500); }
      } },
      { icon: 'upload', label: 'Arquivo SVG (vira traço) ou imagem PNG/JPG', onclick: () => MY.pickFile(catId) },
    ]);
  };
  const render = async () => {
    clear(grid);
    const v = cat.value;
    if (v === '__new') {
      const name = await promptBox('Nova categoria de formas', 'Nome (ex.: Montagens do laboratório)', '');
      if (!name) { cat.value = last; return render(); }
      const c = await MY.addCat(name); last = c.id; await fillCats(); return render();
    }
    last = v; try { localStorage.setItem('leitor-shapecat', v); } catch (e) {}
    const st = await MY.load();
    const ucat = st.cats.find(c => c.id === v);
    hint.textContent = ucat ? 'Suas formas. Para criar: desenhe na página, selecione com o Laço e toque em “＋ Adicionar”; ou traga um SVG (melhor: só linhas, uma cor) ou uma imagem PNG. Segure (ou botão direito) numa forma para renomear, mover ou apagar.'
      : 'Toque numa forma e arraste na página para desenhá-la. Depois de solta, ela fica selecionada: arraste, mude o tamanho pelo canto, gire pela bolinha.';
    const list = ucat ? st.items.filter(i => i.cat === v).map(MY.asShape) : SH.SHAPES.filter(x => x.cat === v);
    for (const s of list) {
      const b = h('button.shbtn', { type: 'button', title: s.label, onclick: () => pick(b, s) }, h('span.shprev'), h('span.shlab', s.label));
      if (s.kind === 'uimg') { const NB = await import('./notebook.js'); NB.fileUrl(s.fileId).then(u => { if (u) b.querySelector('.shprev').appendChild(h('img', { src: u, alt: '', style: 'max-width:44px;max-height:44px' })); }); }
      else b.querySelector('.shprev').innerHTML = SH.shapePreview(s);
      if (s.user) {
        const menu = e => { e.preventDefault(); popMenu(e.clientX, e.clientY, [
          { icon: 'text', label: 'Renomear', onclick: async () => { const n = await promptBox('Renomear forma', 'Nome da forma', s.label); if (n) MY.renameItem(s.id, n); } },
          st.cats.length > 1 ? { icon: 'folder', label: 'Mover para…', onclick: () => popMenu(e.clientX, e.clientY, st.cats.filter(c => c.id !== v).map(c => ({ label: c.name, onclick: () => MY.moveItem(s.id, c.id) }))) } : null,
          { icon: 'trash', label: 'Apagar forma', danger: true, onclick: async () => { if (await confirmBox('Apagar forma', 'Apagar “' + s.label + '” da categoria? O que já foi desenhado nas páginas fica.', 'Apagar')) MY.delItem(s.id); } },
        ]); };
        b.addEventListener('contextmenu', menu);
        let t = null; b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') t = setTimeout(() => { t = 'long'; menu(e); }, 600); });
        b.addEventListener('pointerup', () => { if (t && t !== 'long') clearTimeout(t); t = null; });
        b.addEventListener('pointercancel', () => { clearTimeout(t); t = null; });
      }
      grid.appendChild(b);
    }
    if (ucat) {
      grid.appendChild(h('button.shbtn.shadd', { type: 'button', title: 'Adicionar forma', onclick: e => addTo(v, e) }, h('span.shprev', '＋'), h('span.shlab', 'Adicionar')));
      host.querySelector('.ucatbar').replaceChildren(
        h('button.sbtn.small', { type: 'button', onclick: async () => { const n = await promptBox('Renomear categoria', 'Nome da categoria', ucat.name); if (n) MY.renameCat(ucat.id, n); } }, 'Renomear categoria'),
        h('button.sbtn.small', { type: 'button', onclick: async () => { if (await confirmBox('Apagar categoria', 'Apagar “' + ucat.name + '” e as formas dela? O que já foi desenhado nas páginas fica.', 'Apagar')) { await MY.delCat(ucat.id); last = 'geo'; } } }, 'Apagar categoria'));
    } else host.querySelector('.ucatbar').replaceChildren();
  };
  cat.addEventListener('change', render);
  window.addEventListener('myshapes', async () => { await fillCats(); render(); });
  await fillCats();
  host.append(cat, hint, h('div.ucatbar'), grid);
  await render();
}
