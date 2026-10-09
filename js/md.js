// Markdown no estilo do Obsidian, com equações LaTeX (KaTeX):
//   $...$ dentro do texto, $$...$$ destacada, \begin{equation}...\end{equation} numerada.
//   \eqn dentro de $$...$$ numera a equação; \label{nome} dá um nome; \eqref{nome} cita "(n)".
import { marked } from '../vendor/marked.esm.js';
import katex from '../vendor/katex/katex.mjs';
import DOMPurify from '../vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: true });

const DISPLAY_RE = /\$\$([\s\S]+?)\$\$|\\begin\{(equation\*?)\}([\s\S]+?)\\end\{equation\*?\}|\\\[([\s\S]+?)\\\]/g;
const INLINE_RE = /(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)|\\\(([\s\S]+?)\\\)/g;

// separa trechos de código (não mexer neles)
function protectCode(src, store) {
  src = src.replace(/```[\s\S]*?```/g, m => { store.push({ raw: m }); return '\u0000C' + (store.length - 1) + '\u0000'; });
  src = src.replace(/`[^`\n]+`/g, m => { store.push({ raw: m }); return '\u0000C' + (store.length - 1) + '\u0000'; });
  return src;
}
function restoreCode(src, store) { return src.replace(/\u0000C(\d+)\u0000/g, (_, i) => store[+i].raw); }

// percorre as equações destacadas e decide quais são numeradas
function displayBlocks(src) {
  const out = [];
  src.replace(DISPLAY_RE, (m, a, env, b, c, off) => {
    let tex = a !== undefined ? a : (b !== undefined ? b : c);
    let numbered = /\\eqn\b/.test(tex) || env === 'equation';
    const lab = tex.match(/\\label\{([^}]+)\}/);
    if (lab) numbered = numbered || env !== 'equation*';
    out.push({ m, tex, numbered, label: lab ? lab[1] : null, off });
    return m;
  });
  return out;
}

// Numeração de todas as caixas de texto de um caderno, em ordem de leitura.
// sources: [{ id, md }] já ordenados. Retorna { starts: {id: n0}, labels: {nome: n} }
export function numberAll(sources) {
  const starts = {}, labels = {};
  let n = 0;
  for (const s of sources) {
    starts[s.id] = n;
    const store = [];
    for (const d of displayBlocks(protectCode(s.md || '', store))) if (d.numbered) { n++; if (d.label && !(d.label in labels)) labels[d.label] = n; }
  }
  return { starts, labels, total: n };
}

function refsInText(s, labels) {
  return s.replace(/\\eqref\{([^}]+)\}/g, (_, k) => labels[k] ? '(' + labels[k] + ')' : '(?)')
    .replace(/\\ref\{([^}]+)\}/g, (_, k) => labels[k] ? String(labels[k]) : '?');
}

function cleanTex(tex) {
  return tex.replace(/\\eqn\b/g, '').replace(/\\label\{[^}]+\}/g, '').trim();
}

function renderTex(tex, display) {
  try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html', trust: false }); }
  catch (e) { return '<code class="matherr">' + escapeHtml(tex) + '</code>'; }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Markdown -> HTML seguro. start: número da última equação antes desta caixa.
export function renderMarkdown(src, start = 0, labels = {}) {
  const code = [];
  let s = protectCode(String(src || ''), code);
  const math = [];
  let n = start;
  s = s.replace(DISPLAY_RE, (m, a, env, b, c) => {
    let tex = a !== undefined ? a : (b !== undefined ? b : c);
    const lab = tex.match(/\\label\{([^}]+)\}/);
    const numbered = /\\eqn\b/.test(tex) || env === 'equation' || (lab && env !== 'equation*');
    tex = refsInText(cleanTex(tex), labels);
    if (numbered) { n++; tex += ' \\tag{' + n + '}'; }
    math.push(renderTex(tex, true));
    return '\n\nKATEXPHD' + (math.length - 1) + 'X\n\n';
  });
  s = s.replace(INLINE_RE, (m, pre, a, b) => {
    const tex = refsInText(a !== undefined ? a : b, labels);
    math.push(renderTex(tex, false));
    return (pre || '') + 'KATEXPHI' + (math.length - 1) + 'X';
  });
  s = refsInText(s, labels);
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  s = restoreCode(s, code);
  let html = marked.parse(s);
  html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['checked', 'disabled', 'type'] });
  html = html.replace(/<p>KATEXPHD(\d+)X<\/p>/g, (_, i) => math[+i]).replace(/KATEXPH[DI](\d+)X/g, (_, i) => math[+i]);
  return html;
}

// Versão para o Obsidian: numeração explícita com \tag{n}, referências resolvidas
export function markdownForObsidian(src, start = 0, labels = {}) {
  const code = [];
  let s = protectCode(String(src || ''), code);
  let n = start;
  s = s.replace(DISPLAY_RE, (m, a, env, b, c) => {
    let tex = a !== undefined ? a : (b !== undefined ? b : c);
    const lab = tex.match(/\\label\{([^}]+)\}/);
    const numbered = /\\eqn\b/.test(tex) || env === 'equation' || (lab && env !== 'equation*');
    tex = refsInText(cleanTex(tex), labels);
    if (numbered) { n++; tex += ' \\tag{' + n + '}'; }
    return '$$\n' + tex + '\n$$';
  });
  s = refsInText(s, labels);
  return restoreCode(s, code);
}

// alterna a n-ésima caixa de seleção "- [ ]" do texto
export function toggleTask(src, idx) {
  let i = -1;
  return String(src).replace(/^(\s*[-*+]\s+\[)( |x|X)(\])/gm, (m, a, b, c) => { i++; return i === idx ? a + (b === ' ' ? 'x' : ' ') + c : m; });
}

export function headings(src) {
  const out = [];
  String(src || '').replace(/^(#{1,4})\s+(.+)$/gm, (m, h, t) => { out.push({ level: h.length, text: t.replace(/[*_`=$]/g, '') }); return m; });
  return out;
}

export function plainText(src) {
  return String(src || '').replace(/\$\$[\s\S]*?\$\$/g, ' [equação] ').replace(/[#*_>`=]/g, '').replace(/\s+/g, ' ').trim();
}
