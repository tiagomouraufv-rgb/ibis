// Caixas de nota no estilo do Obsidian ("callouts"): > [!tipo] Título
// Os nomes dos tipos são os do Obsidian (em inglês), para o texto abrir igual lá; os apelidos em português também valem.
import { h, popMenu } from './util.js';

export const CALLOUT_TYPES = [
  { id: 'note', label: 'Nota', color: '#086DDD', icon: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>', alias: ['nota'] },
  { id: 'abstract', label: 'Resumo', color: '#00A7A4', icon: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 11h6M9 15h4"/>', alias: ['summary', 'tldr', 'resumo'] },
  { id: 'info', label: 'Info', color: '#086DDD', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', alias: [] },
  { id: 'todo', label: 'A fazer', color: '#086DDD', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>', alias: ['afazer', 'tarefa'] },
  { id: 'tip', label: 'Dica', color: '#00A7A4', icon: '<path d="M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-2 1-4 3-5 0 2 1 3 2 3 0-3 0-5 1-8z"/>', alias: ['hint', 'important', 'dica', 'importante'] },
  { id: 'success', label: 'Sucesso', color: '#08A045', icon: '<path d="M5 12l5 5 9-10"/>', alias: ['check', 'done', 'sucesso', 'feito'] },
  { id: 'question', label: 'Pergunta', color: '#D46A00', icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17v.5"/>', alias: ['help', 'faq', 'pergunta', 'duvida', 'dúvida'] },
  { id: 'warning', label: 'Atenção', color: '#D46A00', icon: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>', alias: ['caution', 'attention', 'atencao', 'atenção', 'cuidado'] },
  { id: 'failure', label: 'Falha', color: '#D42E43', icon: '<path d="M6 6l12 12M18 6L6 18"/>', alias: ['fail', 'missing', 'falha'] },
  { id: 'danger', label: 'Perigo', color: '#D42E43', icon: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>', alias: ['error', 'perigo', 'erro'] },
  { id: 'bug', label: 'Bug', color: '#D42E43', icon: '<rect x="8" y="7" width="8" height="12" rx="4"/><path d="M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 18l3-2M19 18l-3-2M12 7V5"/>', alias: [] },
  { id: 'example', label: 'Exemplo', color: '#7852EE', icon: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', alias: ['exemplo'] },
  { id: 'quote', label: 'Citação', color: '#6E7781', icon: '<path d="M6 17c-1-4 0-8 4-10M14 17c-1-4 0-8 4-10"/>', alias: ['cite', 'citacao', 'citação'] },
];
const BY = new Map();
for (const t of CALLOUT_TYPES) { BY.set(t.id, t); for (const a of t.alias) BY.set(a, t); }
export function calloutType(name) {
  const k = String(name || '').toLowerCase();
  return BY.get(k) || BY.get(k.normalize('NFD').replace(/[̀-ͯ]/g, '')) || null;
}

export function calloutIcon(t, size = 16) {
  const span = h('span.coicon', { 'aria-hidden': 'true' });
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>`;
  return span;
}

// transforma um <blockquote> que começa com [!tipo] numa caixa colorida (com recolher, se tiver + ou -)
export function decorateCallout(bq, rawType, fold, title) {
  const t = calloutType(rawType) || { id: rawType.toLowerCase(), label: rawType, color: '#086DDD', icon: CALLOUT_TYPES[0].icon };
  bq.classList.add('callout');
  bq.dataset.co = t.id;
  bq.style.setProperty('--co', t.color);
  const head = h('div.cotitle', calloutIcon(t), h('span', title || t.label));
  if (fold) {
    bq.classList.add('cofold');
    if (fold === '-') bq.classList.add('cofolded');
    head.appendChild(h('span.cochev', { 'aria-hidden': 'true' }, '▾'));
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); bq.classList.toggle('cofolded'); });
  }
  bq.prepend(head);
  return t;
}

// menu para escolher o tipo
export function calloutMenu(x, y, onPick) {
  const m = popMenu(x, y, CALLOUT_TYPES.map(t => ({ label: t.label, onclick: () => onPick(t) })));
  [...m.querySelectorAll('button')].forEach((b, i) => { const t = CALLOUT_TYPES[i]; const ic = calloutIcon(t, 18); ic.style.color = t.color; b.prepend(ic); });
  return m;
}

// texto Markdown de uma caixa: primeira linha com o tipo, as demais com "> "
export function calloutMd(t, body, title) {
  const lines = String(body || '').replace(/\s+$/, '').split('\n');
  return '> [!' + t.id + '] ' + (title || t.label) + '\n' + lines.map(l => '> ' + l).join('\n');
}

// lista as caixas de um Markdown (para o sumário): { type, title, text, index do bloco }
export function listCallouts(blocks) {
  const out = [];
  blocks.forEach((md, i) => {
    const re = /^>\s*\[!([^\]\s]+)\]([+-]?)\s*(.*)$/gm;
    let m;
    while ((m = re.exec(md))) {
      const t = calloutType(m[1]) || { id: m[1], label: m[1], color: '#086DDD', icon: CALLOUT_TYPES[0].icon };
      const rest = md.slice(m.index + m[0].length).split('\n').filter(l => /^>/.test(l)).map(l => l.replace(/^>\s?/, '')).join(' ').trim();
      out.push({ t, title: m[3].trim() || t.label, text: rest, i });
    }
  });
  return out;
}
