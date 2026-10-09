// Modo artigo: o texto do PDF refeito em parágrafos, com letra ajustável (ótimo no e-ink e no celular).
// Cabeçalhos e rodapés repetidos e números de página saem; as figuras continuam no PDF (toque em "p. N").
import * as S from './store.js';
import { getPage, pageNum } from './pdfdoc.js';
import { h, btn, toast } from './util.js';
import { isEink, turnScroller, tapZone, swipeDir } from './eink.js';

const cache = new Map();   // docId -> parágrafos

// linhas de uma página: { text, x, y, fs } (y de cima para baixo)
async function pageLines(hd, n) {
  const pg = await getPage(hd, n);
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();
  const lines = [];
  let cur = null;
  for (const it of tc.items) {
    if (it.str === undefined) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const fs = Math.hypot(tr[2], tr[3]) || it.height || 10;
    const x = tr[4], y = vp.height - tr[5];
    if (!cur || Math.abs(y - cur.y) > fs * 0.5 || x < cur.xEnd - fs * 2) {
      if (cur && cur.text.trim()) lines.push(cur);
      cur = { text: '', x, y, fs, xEnd: x };
    }
    if (cur.text && !cur.text.endsWith(' ') && !it.str.startsWith(' ') && x - cur.xEnd > fs * 0.15) cur.text += ' ';
    cur.text += it.str;
    cur.xEnd = x + (it.width || 0);
    cur.fs = Math.max(cur.fs, fs);
    if (it.hasEOL) { if (cur.text.trim()) lines.push(cur); cur = null; }
  }
  if (cur && cur.text.trim()) lines.push(cur);
  return { lines, h: vp.height };
}

const norm = t => t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
const ends = t => /[.!?:;)"”]$/.test(t.trim());

export async function extractArticle(hd, docId) {
  if (cache.has(docId)) return cache.get(docId);
  const n = hd.pdf.numPages;
  const pages = [];
  for (let i = 1; i <= n; i++) { pages.push(await pageLines(hd, i)); if (i % 6 === 0) await new Promise(r => setTimeout(r, 0)); }
  // cabeçalhos/rodapés: linhas curtas no alto ou no pé da página que se repetem (ou são só números)
  const edge = (l, H) => l.y < H * 0.075 || l.y > H * 0.93;
  const count = new Map();
  for (const p of pages) for (const l of p.lines) if (edge(l, p.h)) { const k = norm(l.text); count.set(k, (count.get(k) || 0) + 1); }
  const rep = k => (count.get(k) || 0) >= Math.max(3, Math.ceil(n * 0.3));
  // tamanho de letra do corpo do texto (o mais comum)
  const sizes = new Map();
  for (const p of pages) for (const l of p.lines) { const k = Math.round(l.fs); sizes.set(k, (sizes.get(k) || 0) + l.text.length); }
  const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0];
  const bodyFs = body ? body[0] : 10;

  const out = [];
  let para = null;
  const flush = () => { if (para && para.text.trim()) out.push(para); para = null; };
  pages.forEach((p, pi) => {
    let prev = null;
    for (const l of p.lines) {
      const t = l.text.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (edge(l, p.h) && (rep(norm(t)) || /^[\divxlc\s.\-–—|]+$/i.test(t) || t.length < 4)) continue;
      const heading = l.fs > bodyFs * 1.18 && t.length < 140;
      if (heading) {
        if (para && para.type === 'h' && Math.abs(para.fs - l.fs) < 1 && prev && l.y - prev.y < l.fs * 2) { para.text += ' ' + t; prev = l; continue; }
        flush(); para = { type: 'h', text: t, page: pi + 1, fs: l.fs }; flush(); prev = l; continue;
      }
      let brk = !para || para.type === 'h';
      if (!brk && prev) {
        const gap = l.y - prev.y;
        if (gap > prev.fs * 1.75) brk = true;                                   // linha em branco
        else if (gap < -prev.fs && ends(para.text)) brk = true;                  // nova coluna depois de ponto final
        else if (gap > 0 && l.x > prev.x + l.fs * 0.9 && ends(para.text)) brk = true;   // recuo de parágrafo
      }
      if (!para) brk = true;
      if (brk) { flush(); para = { type: 'p', text: t, page: pi + 1 }; }
      else if (/[A-Za-zÀ-ÿ]-$/.test(para.text) && /^[a-zà-ÿ]/.test(t)) para.text = para.text.slice(0, -1) + t;   // hifenização
      else para.text += ' ' + t;
      prev = l;
    }
  });
  flush();
  cache.set(docId, out);
  return out;
}

export async function openArticle(reader) {
  const v = reader.active;
  const doc = v.doc;
  document.querySelectorAll('.article-view').forEach(e => e.remove());
  const st = await S.settings();
  let fs = +st.articleFont || 18;
  const body = h('article.artbody', h('p.muted', 'Preparando o texto…'));
  const scroll = h('div.artscroll', body);
  const info = h('span.artinfo.muted');
  const setFs = d => { fs = Math.max(13, Math.min(34, fs + d)); body.style.fontSize = fs + 'px'; S.setSettings({ articleFont: fs }); };
  const close = () => { view.remove(); document.removeEventListener('keydown', onKey, true); reader.app.article = null; };
  const goPdf = page => { close(); v.goTo('p' + page, 0, { exact: true }); reader.onNav(v); };
  const view = h('div.article-view', { role: 'dialog', 'aria-label': 'Modo artigo' },
    h('header.arthead',
      btn('close', '', close, { title: 'Voltar ao PDF', iconOnly: true }),
      h('b.clamp', S.docTitle(doc)),
      h('div.grow'), info,
      btn('back', '', () => turn(-1), { title: 'Tela anterior', iconOnly: true, cls: 'ibtn eink-only' }),
      btn('fwd', '', () => turn(1), { title: 'Próxima tela', iconOnly: true, cls: 'ibtn eink-only' }),
      h('button.sbtn', { type: 'button', title: 'Letra menor', onclick: () => setFs(-1) }, 'A−'),
      h('button.sbtn', { type: 'button', title: 'Letra maior', onclick: () => setFs(1) }, 'A+')),
    scroll);
  body.style.fontSize = fs + 'px';
  document.body.appendChild(view);
  const paged = isEink();
  scroll.classList.toggle('paged', paged);
  const turn = dir => { if (!turnScroller(scroll, dir, fs * 1.7)) toast(dir > 0 ? 'Fim do texto.' : 'Início do texto.', 1200); };
  const onKey = e => {
    if (['PageDown', 'ArrowRight', ' '].includes(e.key) || (paged && e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); turn(1); }
    else if (['PageUp', 'ArrowLeft'].includes(e.key) || (paged && e.key === 'ArrowUp')) { e.preventDefault(); e.stopPropagation(); turn(-1); }
    else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey, true);
  reader.app.article = { turn, close };
  // toques e deslizes (e-ink): esquerda/direita, como nos livros
  let p0 = null;
  scroll.addEventListener('pointerdown', e => { p0 = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  scroll.addEventListener('pointerup', e => {
    if (!paged || !p0 || e.target.closest('button, a')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
    const d = Math.hypot(dx, dy) < 10 && Date.now() - p0.t < 450 ? tapZone(scroll, e.clientX) : swipeDir(dx, dy);
    if (d) turn(d);
  });

  let paras;
  try { paras = await extractArticle(v.hd, doc.id); }
  catch (e) { body.replaceChildren(h('p', 'Não foi possível montar o texto: ' + e.message)); return; }
  if (!paras.length) { body.replaceChildren(h('p', 'Este PDF não tem texto selecionável (é uma imagem escaneada). O modo artigo precisa de texto.')); return; }
  body.replaceChildren();
  let lastPage = 0, startEl = null;
  const curPage = (() => { const k = v.currentKey(); return k && k[0] === 'p' ? pageNum(k) : 1; })();
  for (const p of paras) {
    if (p.page !== lastPage) {
      const mk = h('button.artpage', { type: 'button', title: 'Abrir esta página no PDF (figuras, tabelas)', onclick: () => goPdf(p.page) }, 'p. ' + p.page);
      body.appendChild(mk);
      if (!startEl && p.page >= curPage) startEl = mk;
      lastPage = p.page;
    }
    body.appendChild(p.type === 'h' ? h('h3', p.text) : h('p', p.text));
  }
  info.textContent = paras.length + ' parágrafos';
  if (startEl && curPage > 1) scroll.scrollTop = startEl.offsetTop - 8;
}
