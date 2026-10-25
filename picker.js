// Escolher um documento (tela dividida e outros): busca ao digitar, Recentes, Favoritos, Biblioteca e Projetos.
// Biblioteca e Projetos mostram três colunas em ordem alfabética: Textos, Cadernos e PDFs.
import * as S from './store.js';
import { h, clear, icon, modal, fold } from './util.js';

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const kindOf = d => d.kind === 'notebook' ? 'notebook' : d.kind === 'text' ? 'text' : 'pdf';
const kindIcon = d => ({ notebook: 'notebook', text: 'text', pdf: 'doc' })[kindOf(d)];
const kindName = d => ({ notebook: 'Caderno', text: 'Texto', pdf: 'PDF' })[kindOf(d)];

export async function pickDocument(app, opts) {
  const all = (await S.allDocs()).filter(d => d.id !== opts.exclude);
  const recent = (await app.reader.recentDocs()).filter(d => d.id !== opts.exclude);
  const projects = await S.projects();
  let tab = 'recentes', proj = projects[0] ? projects[0].id : '';
  const q = h('input', { type: 'search', placeholder: 'Digite parte do nome…', 'aria-label': 'Buscar documento' });
  const tabs = h('div.tabsrow.inmodal', { role: 'tablist' });
  const body = h('div.pickbody');
  let m;
  const choose = d => { m.close(); opts.onpick(d); };
  const row = d => h('button.pickrow', { type: 'button', onclick: () => choose(d) }, icon(kindIcon(d), 16), h('b.clamp', S.docTitle(d)), h('span.muted', kindName(d)));
  const three = list => {
    const wrap = h('div.pick3');
    for (const [k, l] of [['text', 'Textos'], ['notebook', 'Cadernos'], ['pdf', 'PDFs']]) {
      const items = list.filter(d => kindOf(d) === k).sort((a, b) => collator.compare(S.docTitle(a), S.docTitle(b)));
      wrap.appendChild(h('div.pickcol', h('div.flabel', l + ' (' + items.length + ')'),
        items.length ? items.map(d => h('button.pickname', { type: 'button', title: S.docTitle(d), onclick: () => choose(d) }, S.docTitle(d))) : h('p.muted.small', '—')));
    }
    return wrap;
  };
  const render = () => {
    clear(tabs); clear(body);
    const term = fold(q.value.trim());
    if (term) {
      const words = term.split(/\s+/);
      const hits = all.filter(d => { const t = fold(S.docTitle(d) + ' ' + (d.fileName || '')); return words.every(w => t.includes(w)); })
        .sort((a, b) => collator.compare(S.docTitle(a), S.docTitle(b)));
      body.appendChild(h('div.flabel', hits.length + ' encontrado(s)'));
      if (!hits.length) body.appendChild(h('p.muted.pad', 'Nada com esse nome.'));
      for (const d of hits.slice(0, 60)) body.appendChild(row(d));
      return;
    }
    for (const [id, l] of [['recentes', 'Recentes'], ['favoritos', 'Favoritos'], ['biblioteca', 'Biblioteca'], ['projetos', 'Projetos']]) {
      tabs.appendChild(h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; render(); } }, l));
    }
    if (opts.same && tab === 'recentes') body.appendChild(h('button.pickrow', { type: 'button', onclick: () => { m.close(); opts.same.onpick(); } }, icon('split', 16), h('b', opts.same.label), h('span.muted', opts.same.hint)));
    if (tab === 'recentes') {
      if (!recent.length) body.appendChild(h('p.muted.pad', 'Nenhum documento aberto recentemente.'));
      for (const d of recent.slice(0, 12)) body.appendChild(row(d));
    } else if (tab === 'favoritos') {
      const favs = all.filter(d => d.fav).sort((a, b) => collator.compare(S.docTitle(a), S.docTitle(b)));
      if (!favs.length) body.appendChild(h('p.muted.pad', 'Nenhum favorito. Na Biblioteca, use ⋯ > “Favoritar” (ou ★ no menu ⋯ de um documento aberto).'));
      for (const d of favs) body.appendChild(row(d));
    } else if (tab === 'biblioteca') {
      body.appendChild(three(all));
    } else {
      if (!projects.length) { body.appendChild(h('p.muted.pad', 'Nenhum projeto ainda.')); return; }
      body.appendChild(h('div.chips', projects.map(p => h('button.chip', { type: 'button', 'aria-pressed': String(p.id === proj), onclick: () => { proj = p.id; render(); } }, p.name))));
      body.appendChild(three(all.filter(d => (d.projects || []).includes(proj))));
    }
  };
  q.addEventListener('input', render);
  render();
  m = modal(opts.title || 'Escolher documento', h('div.picker', h('div.searchbox', icon('search', 18), q), tabs, body), [], { wide: true });
  setTimeout(() => q.focus(), 50);
  return m;
}
