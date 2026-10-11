// Painel de IA (barra lateral → painel da direita):
//   • IA interna (Claude ou Gemini, com a sua chave): pergunte sobre o trecho escolhido; a resposta cita as páginas
//     [p. N], que viram links para o lugar do PDF.
//   • Adobe Acrobat (só PDF) e NotebookLM / Gemini: o app monta um arquivo só com o trecho escolhido (PDF inteiro,
//     capítulo, seção ou páginas), com ou sem as suas anotações, e entrega ao app (Android) ou ao site (computador).
//     A resposta volta quando você a compartilha para o Leitor de Pesquisa (vira nota no Digest).
import { h, clear, toast, copyText, downloadBlob, safeName } from './util.js';
import * as S from './store.js';
import { openExternal, isAndroidApp } from './platform.js';

const ADOBE_PKG = 'com.adobe.reader';
const NLM_PKG = 'com.google.android.apps.labs.language.tailwind';
const ADOBE_URL = 'https://www.adobe.com/acrobat/online/ai-chat-pdf.html';
const NLM_URL = 'https://notebooklm.google.com/';
const MAX_CHARS = 140000;   // material enviado à IA interna (≈ 35 mil tokens)

// ---------- estrutura do PDF (capítulos e seções pelo sumário) ----------
export async function pdfTree(hd) {
  const { outline, resolveDest } = await import('./pdfdoc.js');
  const n = hd.pdf.numPages;
  const conv = async (items, depth) => {
    const out = [];
    for (const it of items || []) {
      let page = 0;
      try { const d = await resolveDest(hd, it.dest); page = d && d.n || 0; } catch (e) {}
      const kids = depth < 3 ? await conv(it.items, depth + 1) : [];
      if (!page && kids.length) page = kids[0].page;
      if (page) out.push({ title: (it.title || '').trim() || 'Seção', page, kids });
    }
    return out.sort((a, b) => a.page - b.page);
  };
  let top = await conv(await outline(hd), 1);
  // sumário com um só item no alto (o título do livro): os capítulos são os filhos dele
  while (top.length <= 2 && top.some(t => t.kids.length >= 3)) top = top.flatMap(t => t.kids.length ? t.kids : [t]);
  const ends = (list, last) => list.forEach((s, i) => { s.end = i + 1 < list.length ? Math.max(s.page, list[i + 1].page - 1) : last; ends(s.kids, s.end); });
  ends(top, n);
  let labels = null;
  try { labels = await hd.pdf.getPageLabels(); } catch (e) {}
  return { n, chapters: top, labels: labels && labels.some((l, i) => l !== String(i + 1)) ? labels : null };
}

// "45-78, 90" → páginas físicas (usa a numeração impressa do PDF, se houver)
export function parsePages(str, n, labels) {
  const toIdx = t => {
    t = t.trim().replace(/^p\.?\s*/i, '');
    if (!t) return null;
    if (labels) { const i = labels.findIndex(l => l.toLowerCase() === t.toLowerCase()); if (i >= 0) return i + 1; }
    const v = parseInt(t, 10);
    return v >= 1 && v <= n ? v : null;
  };
  const set = new Set();
  for (const part of String(str || '').split(/[,;]+/)) {
    const m = part.split(/\s*[-–—]\s*|\s+a\s+/i);
    if (m.length === 2) { const a = toIdx(m[0]), b = toIdx(m[1]); if (a && b) for (let p = Math.min(a, b); p <= Math.max(a, b); p++) set.add(p); }
    else { const a = toIdx(m[0]); if (a) set.add(a); }
  }
  return [...set].sort((a, b) => a - b);
}
const rangeText = (pages, labels) => {
  if (!pages.length) return '';
  const lab = p => labels ? labels[p - 1] : String(p);
  const parts = []; let s = pages[0], prev = pages[0];
  for (const p of pages.slice(1).concat([null])) {
    if (p === prev + 1) { prev = p; continue; }
    parts.push(s === prev ? lab(s) : lab(s) + '–' + lab(prev));
    s = prev = p;
  }
  return parts.join(', ');
};

// ---------- seções de um texto (pelos títulos) ----------
export function textSections(md) {
  const lines = String(md || '').split('\n');
  const secs = [];
  let inCode = false;
  lines.forEach((l, i) => {
    if (/^```/.test(l)) inCode = !inCode;
    const m = !inCode && /^(#{1,6})\s+(.+)$/.exec(l);
    if (m) secs.push({ level: m[1].length, title: m[2].replace(/[*_`=$]/g, '').trim(), start: i });
  });
  secs.forEach((s, k) => { let e = lines.length; for (let j = k + 1; j < secs.length; j++) if (secs[j].level <= s.level) { e = secs[j].start; break; } s.end = e; });
  return { lines, secs };
}
const ytLinks = text => {
  const out = new Map();
  String(text || '').replace(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s)\]]*v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})[^\s)\]]*/g, (m, id) => { if (!out.has(id)) out.set(id, 'https://youtu.be/' + id); return m; });
  return [...out.values()];
};
// texto para enviar: tira imagens e áudios (só links internos do app)
const mdForExport = md => String(md || '').replace(/!\[[^\]]*\]\((?:img|audio):[\w-]+\)/g, '').replace(/\n{3,}/g, '\n\n');

// ---------- material do PDF ----------
async function pdfPagesText(hd, pages) {
  const { pageText } = await import('./pdfdoc.js');
  const out = [];
  for (const p of pages) out.push({ p, text: await pageText(hd, p) });
  return out;
}
// muitas páginas: escolhe as mais ligadas à pergunta (até o limite), na ordem do documento
function pickRelevant(chunks, question, max) {
  const total = chunks.reduce((t, c) => t + c.text.length, 0);
  if (total <= max) return { chunks, cut: false };
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const terms = [...new Set(norm(question).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3))];
  const scored = chunks.map((c, i) => { const t = norm(c.text); let s = 0; for (const w of terms) { const m = t.split(w).length - 1; s += m ? 1 + Math.log(m) : 0; } return { i, s }; });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = new Set(); let used = 0;
  // sempre a primeira página (título, resumo, introdução do capítulo)
  for (const x of [{ i: 0 }].concat(scored)) { if (keep.has(x.i)) continue; const len = chunks[x.i].text.length; if (used + len > max) continue; keep.add(x.i); used += len; }
  return { chunks: chunks.filter((c, i) => keep.has(i)), cut: true };
}
async function notesText(doc, pages, kind) {
  const anns = await S.annots(doc.id);
  const pset = new Set(pages.map(p => 'p' + p));
  const byPage = new Map();
  const blankAfter = new Map((doc.blanks || []).map(b => ['b' + b.id, 'p' + b.after]));
  for (const a of anns) {
    const key = pset.has(a.pageKey) ? a.pageKey : blankAfter.has(a.pageKey) && pset.has(blankAfter.get(a.pageKey)) ? blankAfter.get(a.pageKey) : null;
    if (!key && kind !== 'all') continue;
    const k = key || a.pageKey;
    if (!byPage.has(k)) byPage.set(k, []);
    const L = byPage.get(k);
    if (a.kind === 'hl') L.push('- ' + (a.style === 'underline' ? 'Sublinhado' : a.style === 'strike' ? 'Tachado' : 'Destaque') + (a.cat ? ' [' + a.cat + ']' : '') + ': “' + String(a.text || '').trim() + '”' + (a.note ? '\n  Nota: ' + a.note.trim().replace(/\n/g, '\n  ') : ''));
    else if (a.kind === 'note' && (a.text || '').trim()) L.push('- Nota: ' + a.text.trim().replace(/\n/g, '\n  '));
    else if (a.kind === 'tbox' && (a.md || '').trim()) L.push('- Caixa de texto: ' + a.md.trim().replace(/\n/g, '\n  '));
    else if (a.kind === 'link' && a.targetLabel) L.push('- Link para: ' + a.targetLabel);
  }
  const dg = (await S.digest()).items.filter(it => it.src && it.src.doc === doc.id && (!pages.length || pages.includes(it.page)));
  const keys = [...byPage.keys()].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  let out = '';
  for (const k of keys) { const L = byPage.get(k).filter(Boolean); if (L.length) out += '\n## ' + (k[0] === 'p' ? 'p. ' + k.slice(1) : k) + '\n' + L.join('\n') + '\n'; }
  if (dg.length) out += '\n## Digest\n' + dg.map(it => '- “' + it.quote + '” (p. ' + it.page + ')' + (it.note ? ' — ' + it.note : '') + (it.tags && it.tags.length ? ' #' + it.tags.join(' #') : '')).join('\n') + '\n';
  return out.trim();
}

// PDF só com as páginas escolhidas; withAnn: com as anotações do app (como anotações de PDF); notesPages: texto
// das anotações em páginas no fim (para o Acrobat, que só recebe um PDF)
async function buildPdf(doc, pages, withAnn, notesMd) {
  const { PDFDocument, StandardFonts, rgb } = await import('../vendor/pdf-lib.esm.min.js');
  const { openPdf, pageList } = await import('./pdfdoc.js');
  const hd = await openPdf(doc);
  let bytes, idx;
  if (withAnn) {
    const { exportPdf } = await import('./export.js');
    bytes = await exportPdf(doc, { mode: 'editable', hl: true, ink: true, notes: true, audio: false, links: true });
    const list = pageList(doc, hd);
    const set = new Set(pages);
    const blankAfter = new Map((doc.blanks || []).map(b => [b.id, b.after]));
    idx = list.map((p, i) => (p.kind === 'pdf' ? set.has(p.n) : set.has(blankAfter.get(p.id))) ? i : -1).filter(i => i >= 0);
  } else {
    const blob = await S.audioBlob(doc.fileId);
    bytes = new Uint8Array(await blob.arrayBuffer());
    idx = pages.map(p => p - 1);
  }
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, idx);
  copied.forEach(p => out.addPage(p));
  out.setTitle(S.docTitle(doc));
  if (notesMd) {
    // anotações em texto, em páginas A4 no fim
    const font = await out.embedFont(StandardFonts.Helvetica);
    const W = 595, H = 842, M = 50, size = 10, lh = 14;
    const clean = s => s.replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, '?');
    const lines = [];
    for (const raw of clean('Minhas anotações (Leitor de Pesquisa)\n\n' + notesMd).split('\n')) {
      let cur = '';
      for (const w of raw.split(' ')) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > W - 2 * M) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
    }
    let pg = null, y = 0;
    for (const l of lines) {
      if (!pg || y < M) { pg = out.addPage([W, H]); y = H - M; }
      pg.drawText(l, { x: M, y, size: /^#/.test(l) ? 11 : size, font, color: rgb(0.1, 0.1, 0.12) });
      y -= lh;
    }
  }
  return await out.save();
}

// ---------- envio ----------
async function sendFiles(files, dest) {
  // files: [{ blob, name, mime }]
  const pkg = dest === 'adobe' ? ADOBE_PKG : NLM_PKG;
  const N = window.AndroidBridge;
  if (isAndroidApp && N && N.shareFiles) {
    const { blobToB64 } = await import('./platform.js');
    const arr = [];
    for (const f of files) arr.push({ name: f.name, mime: f.mime, b64: await blobToB64(f.blob) });
    N.shareFiles(JSON.stringify(arr), pkg);
    return 'android';
  }
  // computador: baixa os arquivos e abre o site
  for (const f of files) downloadBlob(f.blob, f.name);
  setTimeout(() => openExternal(dest === 'adobe' ? ADOBE_URL : NLM_URL), 600);
  return 'web';
}
function remember(info) { try { localStorage.setItem('leitor-ai-last', JSON.stringify(Object.assign({ at: Date.now() }, info))); } catch (e) {} }
export function lastSent() { try { const o = JSON.parse(localStorage.getItem('leitor-ai-last') || 'null'); return o && Date.now() - o.at < 24 * 3600e3 ? o : null; } catch (e) { return null; } }

// resposta (de fora ou da IA interna) → nota no Digest
export async function saveAnswer(docId, text, info = {}) {
  const doc = await S.getDoc(docId);
  if (!doc) throw new Error('Documento não encontrado.');
  const st = await S.digest();
  const page = info.page || 1;
  const quote = info.quote || ((info.source || 'Resposta da IA') + (info.scope ? ' — ' + info.scope : ''));
  // eslint-disable-next-line no-undef
  const r = dgAdd(st, { doc: doc.id, name: S.docTitle(doc), page, pageKey: doc.kind === 'text' ? (info.pageKey || 'top') : 'p' + page, quote, note: text, tags: ['ia'].concat(info.tag ? [info.tag] : []) }, Date.now());
  await S.saveDigest(r.store);
  return r.item;
}

// ---------- painel ----------
const DESTS = [['int', 'IA interna (sua chave)'], ['adobe', 'Adobe Acrobat (IA do Acrobat)'], ['nlm', 'NotebookLM / Gemini']];
const QUICK = [
  'Qual é o objetivo e a principal conclusão?',
  'Quais são o método e os parâmetros experimentais (λ, potência, NA, amostras)?',
  'Resuma em tópicos, com as equações principais.',
  'Quais são as limitações e o que fica em aberto?',
  'Explique os conceitos-chave para quem está começando.',
];

/**
 * ctx: { kind: 'pdf'|'text', doc(), viewer() (pdf), selection() → texto selecionado ou '', goTo(pageNum) }
 */
export async function buildAiPanel(host, ctx) {
  clear(host);
  const doc = ctx.doc();
  if (!doc) { host.appendChild(h('p.muted', 'Abra um PDF ou um texto.')); return; }
  const isPdf = ctx.kind === 'pdf';
  const key = 'leitor-ai-' + doc.id;
  let st = { dest: 'int', scope: 'chap', chap: -1, sec: -1, pages: '', annIn: false, annFile: true, yt: {} };
  try { Object.assign(st, JSON.parse(localStorage.getItem(key) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} };
  if (!isPdf && st.dest === 'adobe') st.dest = 'nlm';

  // estrutura
  let tree = null, hd = null, tsec = null;
  if (isPdf) {
    const { openPdf } = await import('./pdfdoc.js');
    hd = await openPdf(doc);
    tree = await pdfTree(hd);
  } else tsec = textSections(doc.md);
  const curPage = () => { const v = ctx.viewer && ctx.viewer(); const k = v && v.currentKey ? v.currentKey() : 'p1'; return k && k[0] === 'p' ? parseInt(k.slice(1)) || 1 : 1; };
  if (isPdf && st.chap < 0 && tree.chapters.length) { const p = curPage(); st.chap = Math.max(0, tree.chapters.findIndex(c => p >= c.page && p <= c.end)); }

  const destSel = h('select.tpsel2', { 'aria-label': 'Para onde' }, DESTS.filter(d => isPdf || d[0] !== 'adobe').map(([v, l]) => h('option', { value: v }, l)));
  destSel.value = st.dest;
  const scopeBox = h('div.aiscope'), annBox = h('div.aiann'), ytBox = h('div.aiyt'), info = h('div.cnote'), actBox = h('div.aiact');
  host.append(destSel, h('div.csec', 'O que mandar'), scopeBox, annBox, ytBox, info, actBox);

  // ---- escopo ----
  const radio = (val, label, extra) => {
    const r = h('input', { type: 'radio', name: 'aiscope-' + doc.id, value: val });
    r.checked = st.scope === val;
    r.addEventListener('change', () => { st.scope = val; save(); refresh(); });
    return h('label.check.aiopt', r, h('span', label), extra || null);
  };
  const scope = () => {
    // retorna { pages, desc } (PDF) ou { md, desc } (texto)
    if (isPdf) {
      const n = tree.n, ch = tree.chapters;
      if (st.scope === 'all') return { pages: [...Array(n)].map((_, i) => i + 1), desc: 'PDF inteiro' };
      if (st.scope === 'chap' && ch[st.chap]) { const c = ch[st.chap]; return { pages: range(c.page, c.end), desc: c.title }; }
      if (st.scope === 'sec') { const c = ch[st.chap]; const s = c && c.kids[st.sec]; if (s) return { pages: range(s.page, s.end), desc: s.title }; }
      if (st.scope === 'pages') { const p = parsePages(st.pages, n, tree.labels); return { pages: p, desc: 'p. ' + rangeText(p, tree.labels) }; }
      if (st.scope === 'sel') { const t = ctx.selection(); const p = curPage(); return { pages: [p], sel: t, desc: 'trecho selecionado' }; }
      return { pages: [], desc: '' };
    }
    const { lines, secs } = tsec;
    if (st.scope === 'sec' && secs[st.sec]) { const s = secs[st.sec]; return { md: lines.slice(s.start, s.end).join('\n'), desc: '§ ' + s.title }; }
    if (st.scope === 'sel') return { md: ctx.selection(), desc: 'trecho selecionado' };
    return { md: doc.md || '', desc: 'texto inteiro' };
  };
  const range = (a, b) => [...Array(Math.max(0, b - a + 1))].map((_, i) => a + i);

  const refresh = () => {
    clear(scopeBox); clear(annBox); clear(ytBox); clear(actBox);
    const dest = st.dest;
    if (isPdf) {
      const ch = tree.chapters;
      const chapSel = h('select', { 'aria-label': 'Capítulo' }, ch.map((c, i) => h('option', { value: i }, c.title + ' (p. ' + (tree.labels ? tree.labels[c.page - 1] : c.page) + ')')));
      chapSel.value = String(Math.max(0, st.chap));
      chapSel.addEventListener('change', () => { st.chap = +chapSel.value; st.sec = 0; save(); refresh(); });
      const c = ch[st.chap];
      const secSel = c && c.kids.length ? h('select', { 'aria-label': 'Seção' }, c.kids.map((s, i) => h('option', { value: i }, s.title))) : null;
      if (secSel) { secSel.value = String(Math.max(0, st.sec)); secSel.addEventListener('change', () => { st.sec = +secSel.value; save(); refresh(); }); }
      const pin = h('input', { type: 'text', placeholder: tree.labels ? 'ex.: 45-78 (numeração do livro)' : 'ex.: 12-20, 25', value: st.pages });
      pin.addEventListener('input', () => { st.pages = pin.value; save(); updInfo(); });
      pin.addEventListener('focus', () => { if (st.scope !== 'pages') { st.scope = 'pages'; save(); refresh(); setTimeout(() => { const i = scopeBox.querySelector('input[type=text]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); } });
      scopeBox.append(...[
        radio('all', 'PDF inteiro (' + tree.n + ' p.)'),
        ch.length ? radio('chap', 'Capítulo', chapSel) : null,
        ch.length && (c && c.kids.length) ? radio('sec', 'Seção do capítulo', secSel) : null,
        radio('pages', 'Páginas', pin),
        dest === 'int' ? radio('sel', 'Só o trecho selecionado') : null,
        !ch.length ? h('div.cnote', 'Este PDF não tem sumário: use “Páginas”.') : null].filter(Boolean));
      // anotações
      const chk = (k, label) => { const c2 = h('input', { type: 'checkbox' }); c2.checked = !!st[k]; c2.addEventListener('change', () => { st[k] = c2.checked; save(); updInfo(); }); return h('label.check.aiopt', c2, h('span', label)); };
      annBox.append(h('div.csec', 'Minhas anotações'),
        dest === 'int' ? chk('annFile', 'Incluir os meus destaques, notas e Digest do trecho na pergunta')
          : h('div', chk('annIn', 'Dentro do PDF (destaques, notas e desenhos, como o Acrobat mostra)'),
            chk('annFile', dest === 'adobe' ? 'Em texto, em páginas no fim do PDF (o Acrobat recebe um arquivo só)' : 'Em arquivo de texto à parte (o que a IA lê melhor)')));
    } else {
      const { secs } = tsec;
      const secSel = secs.length ? h('select', { 'aria-label': 'Seção' }, secs.map((s, i) => h('option', { value: i }, '  '.repeat(s.level - 1) + s.title))) : null;
      if (secSel) { secSel.value = String(Math.max(0, st.sec)); secSel.addEventListener('change', () => { st.sec = +secSel.value; save(); refresh(); }); }
      if (st.scope === 'chap' || st.scope === 'pages') st.scope = 'all';
      scopeBox.append(...[radio('all', 'Texto inteiro'), secs.length ? radio('sec', 'Seção', secSel) : null, dest === 'int' ? radio('sel', 'Só o trecho selecionado') : null].filter(Boolean));
    }
    // vídeos do YouTube (NotebookLM)
    if (dest === 'nlm') {
      const sc = scope();
      (async () => {
        let txt = isPdf ? '' : (sc.md || '');
        if (isPdf) {
          const anns = await S.annots(doc.id);
          txt = anns.map(a => [a.note, a.text, a.md, a.target && a.target.url].filter(Boolean).join(' ')).join('\n');
          try { const { pageLinks } = await import('./pdfdoc.js'); for (const p of sc.pages.slice(0, 400)) { const ls = await pageLinks(hd, p); txt += '\n' + (ls || []).map(l => l.url || '').join('\n'); } } catch (e) {}
        }
        const links = ytLinks(txt);
        if (!links.length) return;
        ytBox.append(h('div.csec', 'Vídeos do YouTube (fontes extras)'), h('div.cnote', 'Só vídeos públicos entram no NotebookLM (ele usa a transcrição). Os marcados ficam copiados para colar em “Site / YouTube”.'));
        for (const u of links) {
          const c2 = h('input', { type: 'checkbox' }); c2.checked = st.yt[u] !== false;
          c2.addEventListener('change', () => { st.yt[u] = c2.checked; save(); });
          ytBox.appendChild(h('label.check.aiopt', c2, h('span.clamp', u)));
        }
      })();
    }
    updInfo();
    buildActions();
  };

  const updInfo = () => {
    const sc = scope();
    if (isPdf) {
      const np = sc.pages.length;
      info.textContent = np ? (sc.desc + ' · ' + np + ' página(s)' + (tree.labels && np && st.scope !== 'all' ? ' (no arquivo: ' + rangeText(sc.pages, null) + ')' : '')) : 'Escolha as páginas.';
    } else info.textContent = sc.desc + ' · ' + (sc.md || '').length + ' caracteres';
  };

  // ---- ações ----
  const buildActions = () => {
    clear(actBox);
    if (st.dest === 'int') return buildInternal();
    const label = st.dest === 'adobe' ? 'Enviar ao Acrobat' : 'Enviar ao NotebookLM / Gemini';
    const go = h('button.pbtn', { type: 'button', onclick: async () => {
      const sc = scope();
      go.disabled = true; go.textContent = 'Preparando…';
      try {
        const files = [];
        const base = safeName(S.docTitle(doc)).slice(0, 60) + (st.scope === 'all' ? '' : ' – ' + safeName(sc.desc).slice(0, 50));
        if (isPdf) {
          if (!sc.pages.length) throw new Error('Escolha as páginas.');
          const notes = st.annFile ? await notesText(doc, sc.pages) : '';
          const bytes = await buildPdf(doc, sc.pages, st.annIn, st.dest === 'adobe' && notes ? notes : '');
          files.push({ blob: new Blob([bytes], { type: 'application/pdf' }), name: base + '.pdf', mime: 'application/pdf' });
          if (st.dest === 'nlm' && notes) files.push({ blob: new Blob(['# Minhas anotações — ' + S.docTitle(doc) + ' (' + sc.desc + ')\n\n' + notes], { type: 'text/plain' }), name: base + ' – anotações.txt', mime: 'text/plain' });
          const txt = (await pdfPagesText(hd, sc.pages.slice(0, 3))).map(c => c.text).join(' ');
          if (txt.replace(/\s/g, '').length < 40 * Math.min(3, sc.pages.length)) toast('Atenção: estas páginas parecem não ter texto (PDF escaneado). A IA pode não conseguir ler; no Acrobat, use antes o reconhecimento de texto (OCR).', 6000);
        } else {
          files.push({ blob: new Blob([mdForExport(sc.md)], { type: 'text/plain' }), name: base + '.txt', mime: 'text/plain' });
        }
        const yts = st.dest === 'nlm' ? [...ytBox.querySelectorAll('input[type=checkbox]')].map((c2, i) => c2.checked ? ytBox.querySelectorAll('.aiopt span')[i].textContent : null).filter(Boolean) : [];
        if (yts.length) await copyText(yts.join('\n'));
        const how = await sendFiles(files, st.dest);
        remember({ docId: doc.id, dest: st.dest, page: isPdf ? sc.pages[0] : 0, scope: sc.desc });
        toast(how === 'android'
          ? (st.dest === 'adobe' ? 'Enviado ao Acrobat. Lá, toque no AI Assistant.' : 'Escolha o notebook no NotebookLM.') + (yts.length ? ' Links do YouTube copiados.' : '') + ' Para guardar a resposta: Compartilhar → Leitor de Pesquisa.'
          : 'Arquivo(s) baixado(s); o site abriu no navegador. Arraste o arquivo para lá.' + (yts.length ? ' Links do YouTube copiados.' : ''), 7000);
      } catch (e) { console.error(e); toast('Não consegui preparar o envio: ' + e.message, 5000); }
      go.disabled = false; go.textContent = label;
    } }, label);
    actBox.append(go,
      h('div.cnote', st.dest === 'adobe'
        ? 'Android: o PDF vai direto para o app do Acrobat (se estiver instalado; senão abre o menu Compartilhar). Computador: o arquivo é baixado e a página “Chat with your PDF” da Adobe abre.'
        : 'Android: o(s) arquivo(s) vão para o app do NotebookLM (se estiver instalado; senão abre o menu Compartilhar). Computador: os arquivos são baixados e o NotebookLM abre no navegador. Os notebooks do NotebookLM aparecem também no app Gemini.'),
      pasteBox());
  };
  const pasteBox = () => {
    const ta = h('textarea', { rows: 3, placeholder: 'Cole aqui a resposta da IA para guardar no Digest (no Android, dá também para usar Compartilhar → Leitor de Pesquisa).' });
    return h('details.aipaste', h('summary', 'Guardar uma resposta'), ta, h('button.sbtn.small', { type: 'button', onclick: async () => {
      if (!ta.value.trim()) return;
      const sc = scope();
      await saveAnswer(doc.id, ta.value.trim(), { page: isPdf ? (sc.pages[0] || 1) : 0, scope: sc.desc, source: st.dest === 'adobe' ? 'Resposta do Acrobat' : 'Resposta do NotebookLM', tag: st.dest === 'adobe' ? 'acrobat' : 'notebooklm' });
      ta.value = ''; toast('Guardado no Digest.');
    } }, 'Guardar no Digest'));
  };

  // ---- IA interna ----
  const history = [];
  const buildInternal = async () => {
    const AI = await import('./ai.js');
    const q = h('textarea.aiq', { rows: 3, placeholder: 'Pergunte sobre o trecho escolhido…' });
    const chips = h('div.aichips', QUICK.map(t => h('button.chip', { type: 'button', onclick: () => { q.value = t; ask(); } }, t)));
    const out = h('div.aiout');
    const btn = h('button.pbtn', { type: 'button', onclick: () => ask() }, 'Perguntar');
    q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(); } });
    actBox.append(h('div.csec', 'Pergunta (' + await AI.aiName() + ')'), q, h('div.btnrow', btn), chips, out);
    let ctrl = null;
    const ask = async () => {
      const question = q.value.trim(); if (!question) return;
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      const sc = scope();
      const card = h('div.aicard', h('div.aiqtext', question), h('p.muted', 'Lendo o trecho…'));
      out.prepend(card);
      btn.disabled = true;
      try {
        let material = '', note = '';
        if (isPdf) {
          if (st.scope === 'sel') {
            if (!sc.sel) throw new Error('Selecione um trecho no PDF primeiro.');
            material = '[p. ' + sc.pages[0] + ']\n' + sc.sel;
          } else {
            if (!sc.pages.length) throw new Error('Escolha as páginas.');
            const chunks = await pdfPagesText(hd, sc.pages);
            const pk = pickRelevant(chunks, question + ' ' + history.map(x => x.q).join(' '), MAX_CHARS);
            if (pk.cut) note = 'Trecho grande: usei as ' + pk.chunks.length + ' páginas mais ligadas à pergunta (de ' + chunks.length + ').';
            material = pk.chunks.map(c => '[p. ' + c.p + ']\n' + c.text).join('\n\n');
          }
          if (st.annFile && st.scope !== 'sel') { const nt = await notesText(doc, sc.pages); if (nt) material += '\n\n<minhas_anotacoes>\n' + nt + '\n</minhas_anotacoes>'; }
        } else {
          material = mdForExport(sc.md || '');
          if (!material.trim()) throw new Error(st.scope === 'sel' ? 'Selecione um trecho do texto primeiro.' : 'O texto está vazio.');
          if (material.length > MAX_CHARS) { material = material.slice(0, MAX_CHARS); note = 'Texto grande: enviei o começo (' + Math.round(MAX_CHARS / 1000) + ' mil caracteres).'; }
        }
        card.lastChild.textContent = 'Perguntando…' + (note ? ' ' + note : '');
        const s2 = await S.settings();
        const ctxText = await AI.contextFor(doc);
        const system = 'Você é um assistente de leitura científica para um pesquisador de Física. Responda em ' + (s2.language || 'português do Brasil') + '.\n' +
          'Use SOMENTE o material fornecido (e as anotações do leitor, se houver). Se a resposta não estiver no material, diga isso claramente em vez de inventar.\n' +
          (isPdf ? 'Depois de cada afirmação, cite a página no formato [p. N], usando os números dos marcadores [p. N] do material.\n' : 'Quando útil, cite a seção entre colchetes, por exemplo [§ Título].\n') +
          'Seja direto e preciso. Use Markdown; equações em LaTeX entre $…$.' + (ctxText ? '\n\nContexto do leitor (para escolher exemplos e ênfases, sem inventar nada): ' + ctxText : '');
        const prev = history.slice(-3).map(x => 'Pergunta anterior: ' + x.q + '\nResposta anterior: ' + x.a.slice(0, 1500)).join('\n\n');
        const user = 'Documento: ' + S.docTitle(doc) + '\nTrecho: ' + sc.desc + '\n\n<material>\n' + material + '\n</material>\n\n' + (prev ? prev + '\n\n' : '') + 'Pergunta: ' + question;
        const r = await AI.callAI(system, user, 3000, ctrl.signal);
        history.push({ q: question, a: r.text });
        const { renderMarkdown } = await import('./md.js');
        const body = h('div.md.aians');
        body.innerHTML = renderMarkdown(r.text);
        if (isPdf) linkCitations(body, n => ctx.goTo(n));
        clear(card);
        const firstPage = (/\[p\.\s*(\d+)/.exec(r.text) || [])[1];
        card.append(h('div.aiqtext', question), body,
          h('div.aicost', r.provider + ' · ' + r.model + (r.cost != null ? ' · ' + AI.fmtUsd(r.cost) : '') + (note ? ' · ' + note : '') + (r.truncated ? ' · resposta cortada (limite de tamanho)' : '')),
          h('div.btnrow',
            h('button.sbtn.small', { type: 'button', onclick: async () => { await saveAnswer(doc.id, r.text, { page: +firstPage || (isPdf ? sc.pages[0] : 0), quote: 'Pergunta: ' + question, scope: sc.desc, tag: 'interna' }); toast('Guardado no Digest.'); } }, 'Guardar no Digest'),
            h('button.sbtn.small', { type: 'button', onclick: async () => { await copyText(r.text); toast('Copiado.'); } }, 'Copiar'),
            h('button.sbtn.small', { type: 'button', onclick: async () => { const TX = await import('./textdoc.js'); const d = await TX.createTextDoc('IA — ' + question.slice(0, 50)); d.md = '> **Pergunta** (' + S.docTitle(doc) + ', ' + sc.desc + '): ' + question + '\n\n' + r.text; d.projects = doc.projects || []; await S.saveDoc(d); toast('Texto criado na biblioteca.'); } }, 'Virar texto')));
        q.value = '';
      } catch (e) {
        if (e.name === 'AbortError') { card.remove(); return; }
        clear(card); card.append(h('div.aiqtext', question), h('p.err', e.message));
      } finally { btn.disabled = false; }
    };
  };

  destSel.addEventListener('change', () => { st.dest = destSel.value; if (st.dest !== 'int' && st.scope === 'sel') st.scope = isPdf ? 'chap' : 'all'; save(); refresh(); });
  refresh();
}

// [p. 12], [p. 12, 14], [pp. 12–14] → botões que levam à página
export function linkCitations(root, go) {
  const walk = node => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 3) {
        const t = c.nodeValue; const re = /\[pp?\.\s*([\d\s,–-]+)\]/g;
        if (!re.test(t)) continue;
        re.lastIndex = 0;
        const frag = document.createDocumentFragment(); let last = 0, m;
        while ((m = re.exec(t))) {
          frag.appendChild(document.createTextNode(t.slice(last, m.index)));
          const first = parseInt(m[1], 10);
          const b = document.createElement('button'); b.type = 'button'; b.className = 'cite'; b.textContent = m[0]; b.title = 'Ir para a p. ' + first;
          b.addEventListener('click', () => go(first));
          frag.appendChild(b); last = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(t.slice(last)));
        c.replaceWith(frag);
      } else if (c.nodeType === 1 && !/^(BUTTON|CODE|PRE|A)$/.test(c.tagName) && !c.classList.contains('katex')) walk(c);
    }
  };
  walk(root);
}
