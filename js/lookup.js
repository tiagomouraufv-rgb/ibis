// Janelas flutuantes de Tradução e Wikipédia, dentro do app.
import * as S from './store.js';
import * as AI from './ai.js';
import { h, clear, btn, toast, copyText } from './util.js';
import { openExternal } from './platform.js';
import { mdToNodes } from './dialogs.js';

const LANGS = [['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano']];

function guessLang(t) {
  const s = ' ' + String(t).toLowerCase() + ' ';
  const en = (s.match(/ (the|and|of|is|with|that|for|are|this|by|in) /g) || []).length;
  const pt = (s.match(/ (o|a|os|as|de|do|da|que|com|para|uma|não|em|é) /g) || []).length;
  return en >= pt ? 'en' : 'pt';
}

// cartão flutuante, arrastável pelo topo
function floatCard(kind, title, box) {
  document.querySelectorAll('.lookpop.' + kind).forEach(e => e.remove());
  const head = h('div.lookhead', h('b.grow', title));
  const body = h('div.lookbody');
  const foot = h('div.lookfoot');
  const card = h('div.lookpop.' + kind, { role: 'dialog', 'aria-label': title }, head, body, foot);
  head.appendChild(btn('close', '', () => card.remove(), { iconOnly: true, title: 'Fechar' }));
  document.body.appendChild(card);
  const r = card.getBoundingClientRect();
  const b = box || { left: innerWidth / 2, right: innerWidth / 2, top: 120, bottom: 120 };
  const below = b.bottom + 64 + r.height < innerHeight;
  card.style.top = Math.max(60, below ? b.bottom + 64 : b.top - r.height - 70) + 'px';
  card.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, (b.left + b.right) / 2 - r.width / 2)) + 'px';
  let drag = null;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button, select')) return;
    const rr = card.getBoundingClientRect();
    drag = { dx: e.clientX - rr.left, dy: e.clientY - rr.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (!drag) return;
    card.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - drag.dx)) + 'px';
    card.style.top = Math.max(0, Math.min(innerHeight - 60, e.clientY - drag.dy)) + 'px';
  });
  head.addEventListener('pointerup', () => { drag = null; });
  return { card, head, body, foot };
}

// ---------- Tradução ----------
// 1) tradutor do próprio Chrome (no aparelho, sem internet, quando existir)  2) Gemini  3) Google Tradutor (fora do app)
export async function translatePop(text, box, doc) {
  const st = await S.settings();
  let target = st.translateTo || 'pt';
  const src = guessLang(text);
  if (src === target) target = src === 'pt' ? 'en' : 'pt';
  const { card, head, body, foot } = floatCard('tr', 'Tradução', box);
  const sel = h('select.mini', { 'aria-label': 'Traduzir para' }, LANGS.map(([c, n]) => h('option', { value: c }, 'para ' + n)));
  sel.value = target;
  head.insertBefore(sel, head.lastChild);
  let out = '';
  const run = async (prefer) => {
    clear(body); clear(foot);
    body.appendChild(h('p.muted', 'Traduzindo…'));
    target = sel.value;
    let engine = '';
    try {
      if (prefer !== 'gemini') {
        const r = await chromeTranslate(text, src, target);
        if (r) { out = r; engine = 'Tradutor do Chrome (no aparelho)'; }
      }
      if (!out || prefer === 'gemini') {
        if (st.geminiKey) {
          const langName = (LANGS.find(l => l[0] === target) || [0, 'português'])[1].toLowerCase();
          out = (await AI.runAction('translate', text, doc ? S.docTitle(doc) : '', '', undefined, '', langName)).text;
          engine = 'Gemini';
        }
      }
    } catch (e) { clear(body); body.appendChild(h('p.err', e.message)); }
    if (out) { clear(body); body.appendChild(h('div.trtext', mdToNodes(out))); body.appendChild(h('p.muted.small', engine)); }
    else if (!body.querySelector('.err')) {
      clear(body);
      body.appendChild(h('p', 'Não há tradutor disponível dentro do app neste aparelho.'));
      body.appendChild(h('p.muted', 'Para traduzir aqui mesmo, configure a chave do Gemini (Configurações → IA). Ou abra no Google Tradutor.'));
    }
    foot.append(
      out ? h('button.sbtn.small', { type: 'button', onclick: () => { copyText(out); toast('Tradução copiada.'); } }, 'Copiar') : null,
      engine && engine !== 'Gemini' && st.geminiKey ? h('button.sbtn.small', { type: 'button', onclick: () => { out = ''; run('gemini'); } }, 'Traduzir com IA') : null,
      h('button.sbtn.small', { type: 'button', onclick: () => AI.googleTranslate(text) }, 'Google Tradutor ↗'));
  };
  sel.addEventListener('change', () => { out = ''; run(); });
  run();
  return card;
}

function withTimeout(p, ms) { return Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]); }

// Tradutor embutido do Chrome (computador). Só usa se o idioma já estiver baixado, para não travar.
async function chromeTranslate(text, src, target) {
  try {
    if (!('Translator' in self)) return null;
    let source = src;
    if ('LanguageDetector' in self) {
      const det = await withTimeout(self.LanguageDetector.create().catch(() => null), 1200);
      if (det) {
        const r = await withTimeout(det.detect(text).catch(() => null), 1200);
        if (r && r[0] && r[0].confidence > 0.5) source = r[0].detectedLanguage.split('-')[0];
      }
    }
    if (source === target) return text;
    const av = await withTimeout(self.Translator.availability({ sourceLanguage: source, targetLanguage: target }).catch(() => "unavailable"), 1500);
    if (av !== 'available') return null;
    const tr = await withTimeout(self.Translator.create({ sourceLanguage: source, targetLanguage: target }).catch(() => null), 5000);
    if (!tr) return null;
    return await withTimeout(tr.translate(text).catch(() => null), 15000);
  } catch (e) { return null; }
}

// ---------- Wikipédia ----------
export async function wikiPop(term, box) {
  term = String(term || '').replace(/\s+/g, ' ').trim();
  if (term.length > 120) term = term.slice(0, 120);
  let lang = guessLang(term) === 'en' && /^[\x00-\x7F]+$/.test(term) ? 'en' : 'pt';
  const { card, head, body, foot } = floatCard('wk', 'Wikipédia', box);
  const langBtns = h('div.segbtns');
  head.insertBefore(langBtns, head.lastChild);
  let current = null;
  const renderLang = () => {
    clear(langBtns);
    for (const [c, n] of [['pt', 'PT'], ['en', 'EN']]) langBtns.appendChild(h('button', { type: 'button', 'aria-pressed': String(lang === c), onclick: () => { lang = c; renderLang(); search(); } }, n));
  };
  const showSummary = async (title, others) => {
    clear(body); clear(foot);
    body.appendChild(h('p.muted', 'Carregando…'));
    try {
      const r = await fetch('https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')));
      if (!r.ok) throw new Error('Página não encontrada.');
      const j = await r.json();
      current = j;
      clear(body);
      body.appendChild(h('div.wkhead', j.thumbnail ? h('img', { src: j.thumbnail.source, alt: '' }) : null, h('div', h('h3.wktitle', j.title), j.description ? h('div.muted', j.description) : null)));
      body.appendChild(h('p.wkext', j.extract || '(sem resumo)'));
      if (others && others.length > 1) {
        body.appendChild(h('div.flabel', 'OUTROS RESULTADOS'));
        for (const o of others.filter(o => o.title !== title).slice(0, 5)) body.appendChild(h('button.srow', { type: 'button', onclick: () => showSummary(o.title, others) }, h('div.grow', h('div', o.title), h('div.muted.clamp', o.snippet))));
      }
      const url = j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page;
      foot.append(
        h('button.sbtn.small', { type: 'button', onclick: () => { copyText(j.title + ': ' + (j.extract || '') + (url ? '\n' + url : '')); toast('Resumo copiado.'); } }, 'Copiar'),
        url ? h('button.sbtn.small', { type: 'button', onclick: () => openExternal(url) }, 'Abrir artigo completo ↗') : null);
    } catch (e) { clear(body); body.appendChild(h('p.err', e.message.includes('fetch') ? 'Sem conexão com a Wikipédia.' : e.message)); }
  };
  const search = async () => {
    clear(body); clear(foot);
    body.appendChild(h('p.muted', 'Buscando “' + term + '”…'));
    try {
      const r = await fetch('https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&srlimit=6&format=json&origin=*&srsearch=' + encodeURIComponent(term));
      const j = await r.json();
      const res = ((j.query && j.query.search) || []).map(x => ({ title: x.title, snippet: String(x.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') }));
      if (!res.length) {
        clear(body);
        body.appendChild(h('p', 'Nada encontrado na Wikipédia em ' + (lang === 'pt' ? 'português' : 'inglês') + '.'));
        foot.append(h('button.sbtn.small', { type: 'button', onclick: () => { lang = lang === 'pt' ? 'en' : 'pt'; renderLang(); search(); } }, 'Tentar em ' + (lang === 'pt' ? 'inglês' : 'português')));
        return;
      }
      await showSummary(res[0].title, res);
    } catch (e) { clear(body); body.appendChild(h('p.err', 'Sem conexão com a Wikipédia.')); }
  };
  renderLang();
  search();
  return card;
}
