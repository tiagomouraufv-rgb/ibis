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
// mesmo texto, com o código trocado por espaços (para achar posições no original)
function blankCode(src) {
  return src.replace(/```[\s\S]*?```/g, m => ' '.repeat(m.length)).replace(/`[^`\n]+`/g, m => ' '.repeat(m.length));
}

// título -> identificador (para links internos [[#Título]])
export function slugify(t) {
  return 'h-' + String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// YouTube: id e tempo inicial a partir do endereço
export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})/);
  if (!m) return null;
  const t = String(url).match(/[?&#](?:t|start)=(\d+h)?(\d+m)?(\d+)s?/);
  let sec = 0;
  if (t) sec = (parseInt(t[1] || '0', 10) * 3600) + (parseInt(t[2] || '0', 10) * 60) + parseInt(t[3] || '0', 10);
  return { id: m[1], t: sec };
}

// trechos especiais do app (fora do código): vídeo, imagem, áudio, links internos, sumário
function embedsIn(s) {
  // linha só com o endereço do YouTube (ou ![…](endereço)): vira player
  s = s.replace(/^[ \t]*(?:!\[[^\]\n]*\]\()?<?(https?:\/\/[^\s)>]+)>?\)?[ \t]*$/gm, (m, url) => {
    const y = youtubeId(url);
    return y ? '\n<div class="yt" data-yt="' + y.id + '" data-t="' + y.t + '"></div>\n' : m;
  });
  s = s.replace(/^[ \t]*!\[([^\]\n]*)\]\(audio:([\w-]+)\)[ \t]*$/gm, (m, alt, id) => '\n<div class="aud" data-audio="' + id + '" data-title="' + escapeHtml(alt || 'Áudio') + '"></div>\n');
  s = s.replace(/\]\(img:([\w-]+)\)/g, '](#img-$1)');
  s = s.replace(/\]\(leitor:\/\/([\w-]+)\/([\w-]*)(?:\?y=(\d+))?\)/g, (m, d, k, y) => '](#go=' + d + '~' + (k || '') + '~' + (y || 0) + ')');
  s = s.replace(/\]\(digest:([\w-]+)\)/g, '](#dg=$1)');
  s = s.replace(/\]\(obsidian:\/\/([^)\s]+)\)/g, (x, r) => '](#ob=' + encodeURIComponent(r) + ')');
  s = s.replace(/\[\[#([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, t, label) => '[' + (label || t) + '](#' + slugify(t) + ')');
  s = s.replace(/^[ \t]*\[\[(?:sumario|sumário|toc)\]\][ \t]*$/gim, '\n<div class="toc-ph"></div>\n');
  return s;
}

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
  s = embedsIn(s);
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
  html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['checked', 'disabled', 'type', 'data-yt', 'data-t', 'data-audio', 'data-title'] });
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

// todas as equações numeradas, na ordem, com a posição onde cabe um \label{} (antes do fechamento)
// sources: [{ id, md }]. Retorna [{ id, n, label, tex, at }]
export function listEquations(sources) {
  const out = [];
  let n = 0;
  for (const s of sources) {
    const blank = blankCode(String(s.md || ''));
    const re = new RegExp(DISPLAY_RE.source, 'g');
    let m;
    while ((m = re.exec(blank))) {
      const [all, a, env, b, c] = m;
      const tex = a !== undefined ? a : (b !== undefined ? b : c);
      const lab = tex.match(/\\label\{([^}]+)\}/);
      const numbered = /\\eqn\b/.test(tex) || env === 'equation' || (lab && env !== 'equation*');
      if (!numbered) continue;
      n++;
      const close = b !== undefined ? all.lastIndexOf('\\end') : all.length - 2;
      out.push({ id: s.id, n, label: lab ? lab[1] : null, tex: cleanTex(String(s.md).slice(m.index, m.index + all.length).replace(/^\$\$|\$\$$|^\\\[|\\\]$/g, '').replace(/\\(begin|end)\{equation\*?\}/g, '')), at: m.index + close });
    }
  }
  return out;
}

// alterna a n-ésima caixa de seleção "- [ ]" do texto
export function toggleTask(src, idx) {
  let i = -1;
  return String(src).replace(/^(\s*[-*+]\s+\[)( |x|X)(\])/gm, (m, a, b, c) => { i++; return i === idx ? a + (b === ' ' ? 'x' : ' ') + c : m; });
}

export function headings(src) {
  const out = [];
  const used = {};
  blankCode(String(src || '')).replace(/^(#{1,6})\s+(.+)$/gm, (m, h, t) => {
    const text = t.replace(/[*_`=$]/g, '').trim();
    let id = slugify(text);
    if (used[id]) id += '-' + (++used[id]); else used[id] = 1;
    out.push({ level: h.length, text, id });
    return m;
  });
  return out;
}

export function plainText(src) {
  return String(src || '').replace(/\[!\w+\]/g, '').replace(/!\[[^\]]*\]\((?:img|audio):[\w-]+\)/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' [equação] ').replace(/[#*_>`=]/g, '').replace(/\s+/g, ' ').trim();
}
