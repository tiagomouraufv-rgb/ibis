// Base dos editores de Markdown (caixa de texto do caderno e documento de texto):
// formatação, equações, numeração, referências, tabelas e símbolos de matemática.
import { h, toast, popMenu } from './util.js';
import { listEquations } from './md.js';

// o cursor está dentro de uma equação ($…$ ou $$…$$)?
export function inMathAt(text, pos) {
  const before = text.slice(0, pos).replace(/\\\$/g, '');
  const dd = (before.match(/\$\$/g) || []).length;
  if (dd % 2 === 1) return true;
  const last = before.lastIndexOf('$$');
  const rest = (last >= 0 ? before.slice(last + 2) : before);
  const para = rest.split(/\n\s*\n/).pop();
  return ((para.match(/\$/g) || []).length % 2) === 1;
}

// equação destacada ($$…$$) em volta do cursor: { start, end (posição do $$ final), tex } ou null
export function displayAt(text, pos) {
  const re = /\$\$([\s\S]*?)\$\$/g;
  let m;
  while ((m = re.exec(text))) {
    if (pos > m.index && pos < m.index + m[0].length) return { start: m.index, end: m.index + m[0].length - 2, tex: m[1] };
    if (m.index > pos) break;
  }
  if (inMathAt(text, pos) && (text.slice(0, pos).match(/\$\$/g) || []).length % 2 === 1) {
    const s0 = text.lastIndexOf('$$', pos - 1);
    return { start: s0, end: text.length, tex: text.slice(s0 + 2), open: true };
  }
  return null;
}

export class MdEditBase {
  // subclasses: this.cur = { ta, … } enquanto edita; sources() -> [{id, md}]; setSource(id, md)
  get ta() { return this.cur && this.cur.ta; }
  need() { if (this.cur) return true; toast(this.idleHint || 'Toque no texto para editar.'); return false; }

  btn(label, title, fn, cls = '') {
    return h('button.fmt' + cls, { type: 'button', title, 'aria-label': title, onpointerdown: e => e.preventDefault(), onclick: e => {
      if (!/toggle|free/.test(cls) && !this.need()) return;
      fn(e);
    } }, label);
  }

  commonButtons() {
    const b = (...a) => this.btn(...a);
    return [
      b('H1', 'Título 1', () => this.linePrefix('# ')),
      b('H2', 'Título 2', () => this.linePrefix('## ')),
      b('H3', 'Título 3', () => this.linePrefix('### ')),
      h('span.fsep'),
      b('B', 'Negrito (Ctrl+B)', () => this.wrapSel('**', '**'), '.bold'),
      b('I', 'Itálico (Ctrl+I)', () => this.wrapSel('*', '*'), '.ital'),
      b('Realce', 'Realce ==texto==', () => this.wrapSel('==', '==')),
      h('span.fsep'),
      b('• Lista', 'Lista', () => this.linePrefix('- ')),
      b('☐ Tarefa', 'Lista de tarefas', () => this.linePrefix('- [ ] ')),
      b('❝', 'Citação', () => this.linePrefix('> ')),
      b('</>', 'Código', () => this.wrapSel('`', '`')),
      b('▦', 'Tabela: escolha linhas e colunas', e => this.tableMenu(e)),
      h('span.fsep'),
      b('$x$', 'Equação no texto', () => this.wrapSel('$', '$')),
      b('$$', 'Equação destacada', () => this.block('$$\n', '\n$$')),
      b('(n)', 'Numerar equação (\\eqn): numera a equação onde está o cursor, ou cria uma nova numerada', () => this.numberEq()),
      b('ref', 'Citar equação numerada (\\eqref): escolha a equação; o nome é criado sozinho', e => this.refMenu(e)),
    ];
  }

  wrapSel(a, z) {
    const ta = this.ta; const s = ta.selectionStart, e = ta.selectionEnd;
    const t = ta.value.slice(s, e) || '';
    ta.setRangeText(a + t + z, s, e, 'end');
    if (!t) ta.setSelectionRange(s + a.length, s + a.length);
    ta.dispatchEvent(new Event('input')); ta.focus();
  }
  insert(t) { const ta = this.ta; ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); ta.focus(); }
  // texto com '@' marcando onde o cursor fica
  insertAt(t) {
    const ta = this.ta; const s = ta.selectionStart;
    const caret = t.indexOf('@');
    t = t.replace('@', '');
    ta.setRangeText(t, s, ta.selectionEnd, 'end');
    if (caret >= 0) ta.setSelectionRange(s + caret, s + caret);
    ta.dispatchEvent(new Event('input')); ta.focus();
  }
  block(a, z) {
    const ta = this.ta; const s = ta.selectionStart, e = ta.selectionEnd;
    const before = ta.value.slice(0, s);
    const pre = before && !before.endsWith('\n') ? '\n' : '';
    const t = ta.value.slice(s, e);
    ta.setRangeText(pre + a + t + z + '\n', s, e, 'end');
    const pos = s + pre.length + a.length + t.length;
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input')); ta.focus();
  }
  // bloco em linhas próprias, com o cursor em '@'
  blockAt(t) {
    const ta = this.ta; const s = ta.selectionStart;
    const before = ta.value.slice(0, s), after = ta.value.slice(ta.selectionEnd);
    const pre = before && !before.endsWith('\n') ? '\n' : '';
    const post = after && !after.startsWith('\n') ? '\n' : '';
    this.insertAt(pre + t + post);
  }
  linePrefix(p) {
    const ta = this.ta; const s = ta.selectionStart;
    const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
    const line = ta.value.slice(ls).split('\n')[0];
    if (line.startsWith(p)) ta.setRangeText('', ls, ls + p.length, 'end');
    else ta.setRangeText(p, ls, ls, 'end');
    ta.dispatchEvent(new Event('input')); ta.focus();
  }

  // símbolo do painel de matemática: '@' marca onde fica o cursor; fora de uma equação, entra entre $…$
  insertMath(code) {
    if (!this.need()) return;
    const ta = this.ta; const s = ta.selectionStart, e = ta.selectionEnd;
    let t = code;
    const sel = ta.value.slice(s, e);
    if (sel && t.includes('@')) t = t.replace('@', sel + '@');
    if (!t.includes('@') && /\\[A-Za-z]+$/.test(t)) t += ' ';
    if (!inMathAt(ta.value, s)) t = t.includes('@') ? '$' + t + '$' : '$' + t.trimEnd() + '$@';
    const caret = t.indexOf('@');
    t = t.replace('@', '');
    ta.setRangeText(t, s, e, 'end');
    if (caret >= 0) ta.setSelectionRange(s + caret, s + caret);
    ta.dispatchEvent(new Event('input')); ta.focus();
  }

  // (n): dentro de uma equação destacada, numera ela; fora, cria uma equação numerada nova
  numberEq() {
    const ta = this.ta;
    const d = displayAt(ta.value, ta.selectionStart);
    if (d && !d.open) {
      if (/\\eqn\b|\\label\{/.test(d.tex)) { toast('Esta equação já é numerada.'); return; }
      const keep = ta.selectionStart;
      const pre = ta.value[d.end - 1] === '\n' ? '' : '\n';
      ta.setRangeText(pre + '\\eqn\n', d.end, d.end, 'preserve');
      ta.setSelectionRange(keep, keep);
      ta.dispatchEvent(new Event('input')); ta.focus();
      return;
    }
    this.blockAt('$$\n@\n\\eqn\n$$');
  }

  // equações numeradas do documento inteiro (com o texto que está sendo editado agora)
  async equations() { return listEquations(await this.sources()); }

  async refMenu(e) {
    const ta = this.ta;
    const r = e.currentTarget.getBoundingClientRect();
    const eqs = await this.equations();
    const here = displayAt(ta.value, ta.selectionStart);
    const items = [];
    if (here && !here.open) {
      const lab = here.tex.match(/\\label\{([^}]*)\}/);
      if (!lab) items.push({ icon: 'plus', label: 'Numerar e dar nome a esta equação', onclick: () => {
        const name = this.freeLabel(eqs);
        const ins = (/\\eqn\b/.test(here.tex) ? '' : '\\eqn') + '\\label{' + name + '}';
        const pre = ta.value[here.end - 1] === '\n' ? '' : '\n';
        const pos = here.end + pre.length + ins.length - 1;
        ta.setRangeText(pre + ins + '\n', here.end, here.end, 'preserve');
        ta.setSelectionRange(pos - name.length, pos);
        ta.dispatchEvent(new Event('input')); ta.focus();
        toast('Nome “' + name + '” criado. Pode trocar por outro (está selecionado).', 3500);
      } });
    }
    for (const q of eqs) {
      items.push({ label: '(' + q.n + ')  ' + (q.tex.replace(/\s+/g, ' ').slice(0, 46) || '…') + (q.label ? '   · ' + q.label : ''), onclick: async () => {
        let name = q.label;
        if (!name) { name = this.freeLabel(eqs, q.n); await this.addLabel(q, name); }
        this.insert('\\eqref{' + name + '}');
      } });
    }
    items.push('-', { icon: 'plus', label: 'Nova equação numerada', onclick: () => this.blockAt('$$\n@\n\\eqn\n$$') });
    if (!eqs.length) items.unshift({ label: 'Nenhuma equação numerada ainda', onclick: () => {} });
    const m = popMenu(r.left, r.bottom + 4, items);
    m.classList.add('eqmenu');
  }
  freeLabel(eqs, n) {
    const used = new Set(eqs.map(q => q.label).filter(Boolean));
    let k = n || eqs.length + 1; let name = 'eq' + k;
    while (used.has(name)) name = 'eq' + (++k);
    return name;
  }
  // grava \label{name} na equação q (pode estar em outra caixa/bloco)
  async addLabel(q, name) {
    const ins = '\\label{' + name + '}';
    if (this.isCurrent(q.id)) {
      const ta = this.ta; const keep = ta.selectionStart;
      ta.setRangeText(ins, q.at, q.at, 'preserve');
      const k = keep >= q.at ? keep + ins.length : keep;
      ta.setSelectionRange(k, k);
      ta.dispatchEvent(new Event('input'));
      return;
    }
    const src = (await this.sources()).find(s => s.id === q.id);
    if (src) await this.setSource(q.id, src.md.slice(0, q.at) + ins + src.md.slice(q.at));
  }

  // tabela: grade para escolher linhas x colunas
  tableMenu(e) {
    document.querySelectorAll('.tablepick').forEach(x => x.remove());
    const r = e.currentTarget.getBoundingClientRect();
    const R = 8, C = 8;
    const info = h('div.tpinfo', 'Escolha o tamanho');
    const grid = h('div.tpgrid');
    const cells = [];
    const paint = (rr, cc) => { cells.forEach(x => x.el.classList.toggle('on', x.r <= rr && x.c <= cc)); info.textContent = rr + ' × ' + cc + ' (linhas × colunas)'; };
    for (let i = 1; i <= R; i++) for (let j = 1; j <= C; j++) {
      const el = h('button.tpcell', { type: 'button', 'aria-label': i + ' linhas, ' + j + ' colunas', onpointerdown: ev => ev.preventDefault(), onpointerenter: () => paint(i, j), onclick: () => { box.remove(); this.insertTable(i, j); } });
      cells.push({ el, r: i, c: j });
      grid.appendChild(el);
    }
    const ri = h('input', { type: 'number', min: 1, max: 60, value: 3, 'aria-label': 'Linhas' });
    const ci = h('input', { type: 'number', min: 1, max: 20, value: 3, 'aria-label': 'Colunas' });
    const typed = h('div.tptyped', h('label', 'Linhas ', ri), h('label', 'Colunas ', ci),
      h('button.pbtn.small', { type: 'button', onpointerdown: ev => ev.preventDefault(), onclick: () => { const rr = Math.max(1, Math.min(60, +ri.value || 1)), cc = Math.max(1, Math.min(20, +ci.value || 1)); box.remove(); this.insertTable(rr, cc); } }, 'Inserir'));
    const box = h('div.tablepick.popmenu', info, grid, typed);
    document.body.appendChild(box);
    const bh = box.getBoundingClientRect().height, bw = box.getBoundingClientRect().width;
    const side = r.left < 90;   // botão da barra lateral: abre ao lado
    box.style.left = Math.max(8, Math.min(innerWidth - bw - 8, side ? r.right + 6 : r.left)) + 'px';
    box.style.top = Math.max(8, Math.min(innerHeight - bh - 8, side ? r.top : r.bottom + 4)) + 'px';
    setTimeout(() => {
      const off = ev => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    }, 0);
  }
  insertTable(rows, cols) { this.blockAt(this.tableText(rows, cols) + '@'); }
  tableText(rows, cols) {
    const head = '| ' + Array.from({ length: cols }, (_, j) => 'Coluna ' + (j + 1)).join(' | ') + ' |';
    const sep = '|' + Array.from({ length: cols }, () => ' --- ').join('|') + '|';
    const body = Array.from({ length: Math.max(1, rows - 1) }, () => '|' + Array.from({ length: cols }, () => '   ').join('|') + '|');
    return [head, sep].concat(body).join('\n');
  }
}

// ---------- tabelas em Markdown (ler e escrever) ----------
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = []; let cur = ''; let math = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (c === '$') math = !math;
    if (c === '|' && !math) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
export function parseTable(src) {
  const lines = String(src).split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2 || !/^\s*\|?\s*:?-{2,}/.test(lines[1])) return null;
  const head = splitRow(lines[0]);
  const align = splitRow(lines[1]).map(x => x.startsWith(':') && x.endsWith(':') ? 'c' : x.endsWith(':') ? 'r' : 'l');
  const rows = lines.slice(2).map(splitRow);
  const n = Math.max(head.length, ...rows.map(r => r.length));
  const fix = r => Array.from({ length: n }, (_, i) => r[i] || '');
  return { head: fix(head), align: fix(align).map(a => a || 'l'), rows: rows.map(fix) };
}
export function tableMarkdown(t) {
  const esc = c => String(c || '').replace(/\n/g, ' ');
  const w = t.head.map((x, i) => Math.max(3, esc(x).length, ...t.rows.map(r => esc(r[i]).length)));
  const row = r => '| ' + r.map((c, i) => esc(c).padEnd(w[i])).join(' | ') + ' |';
  const sep = '| ' + t.align.map((a, i) => a === 'c' ? ':' + '-'.repeat(Math.max(1, w[i] - 2)) + ':' : a === 'r' ? '-'.repeat(w[i] - 1) + ':' : '-'.repeat(w[i])).join(' | ') + ' |';
  return [row(t.head), sep].concat(t.rows.map(row)).join('\n');
}
