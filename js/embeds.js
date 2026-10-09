// Dá vida ao HTML do Markdown: vídeo do YouTube, imagens e áudios guardados no app,
// links internos (#título, outros documentos, Digest), caixas de destaque (> [!nota]) e sumário.
import { h, icon } from './util.js';
import { fileUrl } from './notebook.js';
import { slugify } from './md.js';

const CALLOUTS = { note: 'Nota', nota: 'Nota', info: 'Info', tip: 'Dica', dica: 'Dica', warning: 'Atenção', atencao: 'Atenção', atenção: 'Atenção', question: 'Pergunta', pergunta: 'Pergunta', important: 'Importante', importante: 'Importante', quote: 'Citação', example: 'Exemplo', exemplo: 'Exemplo', todo: 'A fazer' };

export function ytPlayer(id, t) {
  const box = h('div.ytbox');
  const thumb = h('button.ytthumb', { type: 'button', 'aria-label': 'Assistir ao vídeo aqui' },
    h('img', { src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', alt: '', loading: 'lazy' }), h('span.ytplay', '▶'));
  thumb.addEventListener('click', ev => {
    ev.preventDefault(); ev.stopPropagation();
    const f = h('iframe', {
      src: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1' + (t ? '&start=' + t : ''),
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
      allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', title: 'Vídeo do YouTube', frameborder: '0',
    });
    thumb.replaceWith(f);
  });
  box.append(thumb, h('a.ytlink', { href: 'https://youtu.be/' + id + (t ? '?t=' + t : '') }, 'Abrir no YouTube ↗'));
  return box;
}

export function hydrate(el, ctx = {}) {
  // títulos com identificador (para links internos e sumário)
  el.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(hd => {
    let id = ctx.headingId ? ctx.headingId(hd) : null;
    if (!id) { const used = ctx.used || (ctx.used = {}); id = slugify(hd.textContent); if (used[id]) id += '-' + (++used[id]); else used[id] = 1; }
    hd.id = id;
  });
  // imagens guardadas no app (img:ID)
  el.querySelectorAll('img[src^="#img-"]').forEach(img => {
    const id = img.getAttribute('src').slice(5);
    img.removeAttribute('src'); img.classList.add('mdimg'); img.draggable = false;
    fileUrl(id).then(u => { if (u) img.src = u; else img.alt = '(imagem não encontrada)'; });
  });
  // vídeo do YouTube: miniatura; toque para assistir aqui mesmo
  el.querySelectorAll('div.yt[data-yt]').forEach(d => {
    const id = d.dataset.yt; const t = +d.dataset.t || 0;
    d.replaceWith(ytPlayer(id, t));
  });
  // áudio (nota de voz)
  el.querySelectorAll('div.aud[data-audio]').forEach(d => {
    const a = h('audio', { controls: true, preload: 'metadata' });
    fileUrl(d.dataset.audio).then(u => { if (u) a.src = u; });
    d.replaceWith(h('div.audbox', h('span.audtitle', icon('mic', 16), d.dataset.title || 'Áudio'), a));
  });
  // > [!nota] Título  →  caixa de destaque
  el.querySelectorAll('blockquote').forEach(bq => {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') return;
    const m = p.innerHTML.match(/^\s*\[!([\wçã]+)\]([+-]?)\s*([^<\n]*)(<br>)?/i);
    if (!m) return;
    const type = m[1].toLowerCase();
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.textContent.trim() && !p.querySelector('img, .katex')) p.remove();
    bq.classList.add('callout', 'co-' + type.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    bq.prepend(h('div.cotitle', m[3].trim() || CALLOUTS[type] || type));
  });
  // sumário ([[sumario]])
  el.querySelectorAll('div.toc-ph').forEach(d => { const t = ctx.toc && ctx.toc(); if (t) d.replaceWith(t); else d.remove(); });
  // links
  el.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (/^#go=/.test(href)) a.classList.add('golink');
    else if (/^#dg=/.test(href)) a.classList.add('dglink');
    else if (/^#h-/.test(href)) a.classList.add('inlink');
    else if (/^https?:/i.test(href)) a.classList.add('extlink');
    a.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); if (ctx.onLink) ctx.onLink(href, ev); });
  });
  // caixas de tarefa
  if (ctx.onTask) el.querySelectorAll('input[type=checkbox]').forEach((cb, i) => {
    cb.disabled = false;
    cb.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); ctx.onTask(i); });
  });
  return el;
}

// '#go=doc~chave~y' -> { docId, key, y }
export function parseGo(href) {
  const m = /^#go=([\w-]+)~([\w-]*)~(\d+)/.exec(href || '');
  return m ? { docId: m[1], key: m[2], y: +m[3] } : null;
}
