// Referências citadas no PDF: ao tocar numa citação, mostra título, autores, resumo e número de citações
// do artigo citado (Crossref + OpenAlex, serviços abertos), com "Ler depois".
import * as S from './store.js';
import { h, clear, toast, copyText } from './util.js';
import { getPage } from './pdfdoc.js';
import { openExternal } from './platform.js';
import { floatCard } from './lookup.js';

// texto da referência a partir do destino do link (página, posição)
export async function referenceText(hd, d) {
  const pg = await getPage(hd, d.n);
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  let items = tc.items.filter(it => it.str && it.str.trim()).map(it => {
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    return { x, y, s: it.str, hh: it.height || 9, w: it.width || 0 };
  });
  const W = vp.width;
  const twoCol = items.filter(i => i.x > W * 0.52).length > items.length * 0.25 && items.filter(i => i.x < W * 0.45).length > items.length * 0.25;
  if (twoCol) {
    const left = d.x != null ? d.x < W * 0.5 : true;
    items = items.filter(i => left ? i.x < W * 0.5 : i.x >= W * 0.47);
  }
  items.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const lines = [];
  for (const it of items) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.y - it.y) < Math.max(2.5, it.hh * 0.35)) { L.s += (L.endX && it.x - L.endX > 1 ? ' ' : '') + it.s; L.endX = it.x + it.w; L.x = Math.min(L.x, it.x); }
    else lines.push({ y: it.y, x: it.x, s: it.s, endX: it.x + it.w, hh: it.hh });
  }
  const top = (d.y || 0) - 2;
  let k = lines.findIndex(L => L.y >= top + (lines[0] ? lines[0].hh * 0.6 : 6));
  if (k < 0) k = 0;
  const out = [lines[k]];
  const isStart = s => /^\s*(\[\d+\]|\d{1,3}\.\s|\d{1,3}\s+[A-ZÀ-Ý]|\(\d+\))/.test(s);
  for (let i = k + 1; i < lines.length; i++) {
    const L = lines[i], P = lines[i - 1];
    if (isStart(L.s) || L.y - P.y > Math.max(P.hh, 8) * 2.2) break;
    out.push(L);
    if (out.map(o => o.s).join(' ').length > 700) break;
  }
  return out.filter(Boolean).map(o => o.s).join(' ').replace(/(\w)-\s+(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();
}

export function looksLikeReference(t) {
  return t.length > 25 && /\b(1[89]\d\d|20\d\d)\b/.test(t) && /[,.]/.test(t) && !/^(fig|figure|figura|table|tabela|eq|section|seção)/i.test(t);
}

const words = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || [];

function absFromIndex(inv) {
  if (!inv) return '';
  const pos = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) pos[p] = w;
  return pos.filter(Boolean).join(' ');
}
function stripJats(s) { return String(s || '').replace(/<jats:title>[^<]*<\/jats:title>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

const cache = new Map();
// procura o artigo: DOI no texto ou busca bibliográfica no Crossref; resumo e citações pelo OpenAlex
export async function lookupReference(text) {
  if (cache.has(text)) return cache.get(text);
  const clean = text.replace(/^\s*(\[\d+\]|\(\d+\)|\d{1,3}\.)\s*/, '');
  let doi = ((clean.match(/10\.\d{4,9}\/[^\s,;]+/) || [])[0] || '').replace(/[.)\]]+$/, '');
  let cr = null;
  try {
    if (doi) {
      const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi));
      if (r.ok) cr = (await r.json()).message;
    }
    if (!cr) {
      const r = await fetch('https://api.crossref.org/works?rows=4&select=DOI,title,author,issued,container-title,is-referenced-by-count,abstract,score,URL&query.bibliographic=' + encodeURIComponent(clean.slice(0, 400)));
      if (r.ok) {
        const its = ((await r.json()).message || {}).items || [];
        const tw = new Set(words(clean));
        const yr = (clean.match(/\b(1[89]\d\d|20\d\d)\b/g) || []);
        for (const it of its) {
          const title = (it.title || [''])[0] || '';
          const tws = words(title);
          const overlap = tws.length ? tws.filter(w => tw.has(w)).length / tws.length : 0;
          const fam = ((it.author || [])[0] || {}).family || '';
          const y = String((((it.issued || {})['date-parts'] || [[]])[0] || [])[0] || '');
          const okAuthor = fam && words(fam).some(w => tw.has(w));
          if (overlap >= 0.6 || (okAuthor && yr.includes(y))) { cr = it; break; }
        }
      }
    }
  } catch (e) { /* sem internet */ }
  if (!cr) { cache.set(text, null); return null; }
  doi = cr.DOI || doi;
  const res = {
    title: stripJats((cr.title || [''])[0]),
    authors: (cr.author || []).map(a => [a.given, a.family || a.name].filter(Boolean).join(' ')),
    year: String((((cr.issued || {})['date-parts'] || [[]])[0] || [])[0] || ''),
    venue: (cr['container-title'] || [''])[0] || '',
    doi, url: doi ? 'https://doi.org/' + doi : (cr.URL || ''),
    abstract: stripJats(cr.abstract || ''),
    cites: cr['is-referenced-by-count'],
    source: 'Crossref',
  };
  try {
    if (doi) {
      const r = await fetch('https://api.openalex.org/works/https://doi.org/' + encodeURIComponent(doi));
      if (r.ok) {
        const o = await r.json();
        if (!res.abstract) res.abstract = absFromIndex(o.abstract_inverted_index);
        if (typeof o.cited_by_count === 'number') res.cites = o.cited_by_count;
        if (!res.title && o.title) res.title = o.title;
        res.source = 'Crossref e OpenAlex';
      }
    }
  } catch (e) {}
  cache.set(text, res);
  return res;
}

// cartão flutuante com o artigo citado
export async function refPopup(opts) {
  const { text, box, fromDoc, fromPage, onShowPdf } = opts;
  const { body, foot } = floatCard('ref', 'Artigo citado', box);
  body.append(h('p.muted.small', text), h('p.muted', 'Procurando o artigo…'));
  const scholar = q => openExternal('https://scholar.google.com/scholar?q=' + encodeURIComponent(q));
  const r = await lookupReference(text);
  clear(body); clear(foot);
  if (!r) {
    body.append(h('p', 'Não encontrei este artigo nas bases abertas (Crossref/OpenAlex), ou não há internet agora.'), h('p.muted.small', text));
    foot.append(h('button.sbtn.small', { type: 'button', onclick: () => scholar(text.slice(0, 200)) }, 'Google Acadêmico ↗'), onShowPdf ? h('button.sbtn.small', { type: 'button', onclick: onShowPdf }, 'Ver no PDF') : null);
    return;
  }
  const au = r.authors.length > 6 ? r.authors.slice(0, 6).join(', ') + ' et al.' : r.authors.join(', ');
  const abs = h('div.refabs', r.abstract || 'Resumo não disponível nas bases abertas.');
  body.append(
    h('div.reftitle', r.title || '(sem título)'),
    au ? h('div.refauth', au) : null,
    h('div.refmeta', [r.venue, r.year].filter(Boolean).join(' · '), typeof r.cites === 'number' ? h('span.refcites', ' · citado ' + r.cites.toLocaleString('pt-BR') + ' vez' + (r.cites === 1 ? '' : 'es')) : null),
    abs,
    h('p.muted.small', 'Fonte: ' + r.source + '. Confira no artigo original.'));
  const list = await S.readLater();
  const already = list.find(x => (r.doi && x.doi === r.doi) || x.title === r.title);
  const rl = h('button.pbtn.small', { type: 'button', onclick: async () => {
    if (rl.disabled) return;
    await S.saveReadLaterItem({ title: r.title, authors: r.authors, year: r.year, venue: r.venue, doi: r.doi, url: r.url, abstract: r.abstract, cites: r.cites, ref: text,
      fromDocId: fromDoc ? fromDoc.id : '', fromTitle: fromDoc ? S.docTitle(fromDoc) : '', fromPage: fromPage || 0, projects: (fromDoc && fromDoc.projects) || [], done: false });
    rl.textContent = '✓ Na lista “Ler depois”'; rl.disabled = true;
    toast((fromDoc && (fromDoc.projects || []).length) ? 'Adicionado ao “Ler depois” do projeto.' : 'Adicionado ao “Ler depois” (Biblioteca).');
  } }, already ? '✓ Na lista “Ler depois”' : 'Ler depois');
  if (already) rl.disabled = true;
  foot.append(rl,
    r.url ? h('button.sbtn.small', { type: 'button', onclick: () => openExternal(r.url) }, 'Abrir artigo ↗') : null,
    h('button.sbtn.small', { type: 'button', onclick: () => scholar(r.title || text) }, 'Google Acadêmico ↗'),
    h('button.sbtn.small', { type: 'button', onclick: () => { copyText(au + '. ' + r.title + '. ' + r.venue + ', ' + r.year + (r.doi ? '. DOI: ' + r.doi : '')); toast('Referência copiada.'); } }, 'Copiar'),
    onShowPdf ? h('button.sbtn.small', { type: 'button', onclick: onShowPdf }, 'Ver no PDF') : null);
}
