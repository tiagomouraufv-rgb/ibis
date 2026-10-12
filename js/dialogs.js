// Diálogos: exportar, Obsidian, dados do artigo, IA, resumo, projetos, configurações, cópia de segurança.
import * as S from './store.js';
import { db } from './db.js';
import { h, clear, btn, toast, modal, copyText, downloadBlob, shareFile, safeName, CATS, catInfo, confirmBox } from './util.js';
import { exportPdf, annotatedName } from './export.js';
import { vaultZip, sendNoteToObsidian, docMarkdown, noteFileName } from './obsidian.js';
import { openPdf, pageText, pageLabel, outline, resolveDest } from './pdfdoc.js';
import { renderMarkdown } from './md.js';
import * as AI from './ai.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/fflate.js';
import * as SY from './sync.js';
import { isAndroidApp } from './platform.js';

function check(label, on, hint) {
  const i = h('input', { type: 'checkbox' }); i.checked = on;
  return { el: h('label.check', i, h('span', label), hint ? h('span.muted', hint) : null), get: () => i.checked };
}

export async function openExportDialog(doc) {
  if (!doc) return;
  const anns = await S.annots(doc.id);
  const cnt = k => anns.filter(a => a.kind === k).length;
  let mode = 'editable';
  const modes = h('div.modecards');
  const renderModes = () => {
    clear(modes);
    for (const [id, t, d] of [['editable', 'Editável', 'Quem receber pode ver, comentar ou apagar suas marcações. Ao reabrir no app, tudo volta editável.'], ['flat', 'Achatado', 'As marcações viram parte da página. Aparecem iguais em qualquer leitor, até nos mais simples.']]) {
      modes.appendChild(h('button.modecard', { type: 'button', 'aria-pressed': String(mode === id), onclick: () => { mode = id; renderModes(); } }, h('b', t), h('span', d)));
    }
  };
  renderModes();
  const c = {
    hl: check('Destaques, sublinhados e tachados', true, String(cnt('hl'))),
    ink: check('Escrita com a S Pen', true, String(cnt('ink')) + ' traços'),
    notes: check('Notas (como comentários)', true, String(cnt('note'))),
    audio: check('Notas de voz (anexadas ao PDF)', true, String(anns.filter(a => a.audioId).length)),
    links: check('Links (clicáveis no PDF)', true, String(cnt('link'))),
  };
  const nameIn = h('input', { type: 'text', value: annotatedName(doc) });
  const status = h('p.muted');
  const build = async () => {
    status.textContent = 'Gerando o PDF…';
    try {
      const bytes = await exportPdf(doc, { mode, hl: c.hl.get(), ink: c.ink.get(), notes: c.notes.get(), audio: c.audio.get(), links: c.links.get() });
      status.textContent = '';
      let name = nameIn.value.trim() || annotatedName(doc); if (!/\.pdf$/i.test(name)) name += '.pdf';
      return { blob: new Blob([bytes], { type: 'application/pdf' }), name };
    } catch (e) { console.error(e); status.textContent = 'Erro ao gerar: ' + e.message; return null; }
  };
  modal('Exportar PDF anotado', h('div',
    h('div.flabel', 'FORMATO'), modes,
    h('div.flabel', 'INCLUIR'), Object.values(c).map(x => x.el),
    h('label.field', h('span', 'Nome do arquivo'), nameIn),
    h('p.muted', 'O original fica intacto. Para salvar no Google Drive ou no OneDrive, use “Compartilhar” e escolha o app.'),
    h('p.muted', 'Para o reMarkable, use “Enviar ao reMarkable”: as notas e o Digest vão escondidos no PDF e o RM2 Notas os coloca no leitor de lá.'),
    status), [
    { label: 'Enviar ao reMarkable', onclick: async () => (await import('./remarkable.js')).sendToRemarkable(doc) },
    { label: 'Salvar no tablet', onclick: async () => { const r = await build(); if (r) await downloadBlob(r.blob, r.name); } },
    { label: 'Compartilhar (Drive, OneDrive…)', primary: true, onclick: async () => { const r = await build(); if (r) { const ok = await shareFile(r.blob, r.name, 'application/pdf'); if (!ok) { await downloadBlob(r.blob, r.name); } } } },
  ], { wide: true });
}

// Exportar caderno: PDF (salvar/compartilhar) ou pacote para o Obsidian
export async function openNotebookExport(doc) {
  const NB = await import('./notebook.js');
  const status = h('p.muted');
  const pdf = async () => { status.textContent = 'Gerando o PDF (as caixas de texto viram imagem nítida)…'; try { const b = await NB.notebookPdf(doc); status.textContent = ''; return new Blob([b], { type: 'application/pdf' }); } catch (e) { console.error(e); status.textContent = 'Erro: ' + e.message; return null; } };
  const name = safeName(doc.name) + '.pdf';
  modal('Exportar caderno', h('div',
    h('p', 'PDF: páginas com modelo, escrita, imagens e o texto formatado com as equações. As notas de voz vão anexadas ao PDF.'),
    h('p', 'Obsidian: uma nota .md com o texto em Markdown (as equações em LaTeX, com a numeração como \\tag), as imagens e a escrita à mão como imagem. Extraia o .zip dentro do cofre.'),
    status), [
    { label: 'Pacote Obsidian (.zip)', onclick: async () => {
      const { zipSync } = await import('../vendor/fflate.js');
      const st = await S.settings();
      status.textContent = 'Gerando…';
      const files = await NB.notebookObsidianFiles(doc, 'Cadernos');
      status.textContent = '';
      await downloadBlob(new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' }), 'Obsidian-' + safeName(doc.name) + '.zip'); void st;
    } },
    { label: 'Salvar PDF', onclick: async () => { const b = await pdf(); if (b) await downloadBlob(b, name); } },
    { label: 'Compartilhar PDF', primary: true, onclick: async () => { const b = await pdf(); if (b && !(await shareFile(b, name, 'application/pdf'))) await downloadBlob(b, name); } },
  ], { wide: true });
}

export async function openObsidianDialog(doc) {
  const st = await S.settings();
  const preview = h('pre.mdprev');
  if (doc) preview.textContent = (await docMarkdown(doc)).text.slice(0, 3000);
  modal('Enviar ao Obsidian', h('div',
    doc ? h('p', 'Nota: ', h('b', (st.obsidianFolder || 'Leituras') + '/' + noteFileName(doc) + '.md')) : null,
    h('p.muted', '1) “Enviar esta nota” abre o app do Obsidian e cria/atualiza a nota (precisa do nome do cofre em Configurações). 2) “Pacote .zip” baixa todas as notas, o Digest e os áudios: extraia o .zip dentro da pasta do cofre (com o gerenciador de arquivos).'),
    doc ? preview : null), [
    doc ? { label: 'Enviar esta nota', onclick: async cl => { if (!st.obsidianVault) toast('Dica: informe o nome do cofre em Configurações.'); cl(); await sendNoteToObsidian(doc); } } : null,
    { label: 'Baixar pacote .zip', primary: true, onclick: async cl => { cl(); toast('Gerando o pacote…'); const z = await vaultZip(null); downloadBlob(z, 'Obsidian-Leituras-' + new Date().toISOString().slice(0, 10) + '.zip'); } },
  ].filter(Boolean), { wide: true });
}

export async function openMetaDialog(doc) {
  const m = Object.assign({ doi: '', title: '', authors: [], year: '', journal: '', volume: '', issue: '', pages: '' }, doc.meta || {});
  if (!m.doi) {
    try { const hd = await openPdf(doc); let t = ''; for (let n = 1; n <= Math.min(2, hd.pdf.numPages); n++) t += await pageText(hd, n) + '\n'; m.doi = AI.findDoi(t); } catch (e) {}
  }
  const f = {};
  const field = (k, label, ph) => { f[k] = h('input', { type: 'text', placeholder: ph || '' }); f[k].value = m[k] || ''; return h('label.field', h('span', label), f[k]); };
  const auth = h('textarea', { rows: 3, placeholder: 'Um por linha: Sobrenome, Nome' });
  auth.value = (m.authors || []).map(a => a.family + (a.given ? ', ' + a.given : '')).join('\n');
  const status = h('p.muted', m.doi ? 'DOI encontrado no PDF. Toque em “Buscar dados” para preencher.' : 'Não achei o DOI nas primeiras páginas. Cole-o abaixo, se tiver.');
  const read = () => {
    for (const k in f) m[k] = f[k].value.trim();
    m.authors = auth.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [fa, ...g] = l.split(','); return { family: fa.trim(), given: g.join(',').trim() }; });
    return m;
  };
  modal('Dados do artigo', h('div',
    h('div.inrow', field('doi', 'DOI', '10.xxxx/...'), h('button.sbtn', { type: 'button', onclick: async () => {
      read(); if (!m.doi) { status.textContent = 'Informe o DOI.'; return; }
      status.textContent = 'Consultando o Crossref…';
      try { const r = await AI.crossref(m.doi); Object.assign(m, r); for (const k in f) f[k].value = m[k] || ''; auth.value = m.authors.map(a => a.family + (a.given ? ', ' + a.given : '')).join('\n'); status.textContent = 'Dados preenchidos. Confira e salve.'; }
      catch (e) { status.textContent = e.message; }
    } }, 'Buscar dados')),
    status, field('title', 'Título'), h('label.field', h('span', 'Autores'), auth),
    h('div.grid3', field('year', 'Ano'), field('journal', 'Revista'), field('volume', 'Volume')),
    h('div.grid3', field('issue', 'Número'), field('pages', 'Páginas')),
  ), [
    { label: 'Copiar ABNT', onclick: async () => { await copyText(AI.abnt(read())); toast('Referência ABNT copiada.'); } },
    { label: 'Copiar BibTeX', onclick: async () => { await copyText(AI.bibtex(read())); toast('BibTeX copiado.'); } },
    { label: 'Salvar', primary: true, onclick: async c => { doc.meta = read(); await S.saveDoc(doc); c(); toast('Dados salvos.'); } },
  ], { wide: true, focus: false });
}

// mostra resultado da IA com cancelar / copiar / salvar como nota
export function showAiResult(title, run, opts = {}) {
  const ctrl = new AbortController();
  const out = h('div.aiout', h('p.muted', 'Consultando a IA…'));
  AI.aiName().then(n => { if (!text && out.firstChild && out.firstChild.classList && out.firstChild.classList.contains('muted')) out.firstChild.textContent = 'Consultando o ' + n + '…'; });
  let text = '';
  const m = modal(title, out, [
    { label: 'Copiar', onclick: async () => { if (text) { await copyText(text); toast('Copiado.'); } } },
    opts.onSaveNote ? { label: 'Salvar como nota', primary: true, onclick: async c => { if (!text) return; c(); await opts.onSaveNote(text); } } : null,
  ].filter(Boolean), { wide: true, focus: false, onclose: () => ctrl.abort() });
  run(ctrl.signal).then(r => {
    text = r.text; clear(out); out.appendChild(mdToNodes(r.text));
    if (r.truncated) out.appendChild(h('p.muted', '(resposta cortada pelo limite de tamanho)'));
    if (r.model) out.appendChild(h('p.aicost', r.provider + ' · ' + r.model + (r.tin ? ' · ' + (r.tin + r.tout).toLocaleString('pt-BR') + ' tokens' : '') + (r.cost != null ? ' · custo aprox. ' + AI.fmtUsd(r.cost) : '')));
  })
    .catch(e => { if (e.name === 'AbortError') return; clear(out); out.appendChild(h('p.err', e.message)); });
  return m;
}

// Markdown leve -> elementos (sem HTML vindo da IA)
export function mdToNodes(md) {
  const box = h('div.md');
  let list = null;
  const inline = s => {
    const span = h('span');
    const parts = String(s).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const p of parts) {
      if (/^\*\*[^*]+\*\*$/.test(p)) span.appendChild(h('b', p.slice(2, -2)));
      else if (/^`[^`]+`$/.test(p)) span.appendChild(h('code', p.slice(1, -1)));
      else if (p) span.appendChild(document.createTextNode(p));
    }
    return span;
  };
  for (const raw of String(md).split('\n')) {
    const l = raw.trimEnd();
    const hm = l.match(/^(#{1,4})\s+(.*)/);
    if (hm) { list = null; box.appendChild(h('h' + Math.min(4, hm[1].length + 1), inline(hm[2]))); continue; }
    const li = l.match(/^\s*[-*]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) { if (!list) { list = h('ul'); box.appendChild(list); } list.appendChild(h('li', inline(li[1]))); continue; }
    list = null;
    if (l.trim()) box.appendChild(h('p', inline(l)));
  }
  return box;
}

// Resumo (IA) a partir das anotações de um ou mais documentos
export async function openBriefing(docs, title, opts) {
  const dg = await S.digest();
  let material = '';
  for (const d of docs) {
    const anns = (await S.annots(d.id)).filter(a => a.kind === 'hl' || a.kind === 'note' || a.kind === 'tbox');
    if (docs.length > 1) material += '\n## ' + S.docTitle(d) + '\n';
    for (const a of anns) {
      const lab = pageLabel(a.pageKey);
      if (a.kind === 'hl') material += `- [${catInfo(a.cat).label}] (${lab}) "${a.text || ''}"` + (a.note ? `\n  Nota: ${a.note}` : '') + '\n';
      else if (a.kind === 'tbox') material += `- Texto do caderno: ${(a.md || '').slice(0, 3000)}\n`;
      else if (a.text) material += `- Nota (${lab}): ${a.text}\n`;
    }
    for (const it of dgFilter(dg, { source: d.id }, 'pagina')) material += `- Digest (${dgPages(it)}): "${it.quote}"` + (it.note ? `\n  Nota: ${it.note}` : '') + '\n';
  }
  if (!material.trim()) { toast('Não há destaques ou notas para resumir ainda.'); return; }
  const ctx = docs.length === 1 ? await AI.contextFor(docs[0]) : (opts && opts.ctx) || await AI.contextFor({ projects: [...new Set(docs.flatMap(d => d.projects || []))] });
  showAiResult('Resumo das anotações', signal => AI.briefing(title, material, signal, ctx), {
    onSaveNote: docs.length === 1 ? async text => { docs[0].briefing = text; await S.saveDoc(docs[0]); toast('Resumo salvo: vai junto na nota do Obsidian.'); } : async text => { await copyText(text); toast('Resumo copiado.'); },
  });
}

// Livro ou artigo longo: resumo seção por seção (capítulos do sumário do PDF, ou blocos de páginas)
export async function pdfSections(doc) {
  const hd = await openPdf(doc);
  const n = hd.pdf.numPages;
  let secs = [];
  const add = async (items, level) => { for (const it of items) { try { const d = await resolveDest(hd, it.dest); if (d && d.n) secs.push({ title: (it.title || '').trim() || 'Seção', page: d.n, level }); } catch (e) {} } };
  const out = await outline(hd);
  await add(out, 1);
  if (secs.length < 3) { const kids = out.flatMap(o => o.items || []); if (kids.length >= 3) { secs = []; await add(kids, 2); } }
  secs.sort((a, b) => a.page - b.page);
  secs = secs.filter((s, i) => i === 0 || s.page !== secs[i - 1].page);
  if (secs.length < 2) { secs = []; for (let p = 1; p <= n; p += 20) secs.push({ title: 'Páginas ' + p + '–' + Math.min(n, p + 19), page: p, level: 1 }); }
  if (secs[0].page > 1) secs.unshift({ title: 'Início', page: 1, level: 1 });
  secs.forEach((s, i) => { s.end = i + 1 < secs.length ? Math.max(s.page, secs[i + 1].page - 1) : n; });
  // muitas seções curtas: junta as vizinhas (no máximo ~40)
  while (secs.length > 40) {
    let k = 0, best = 1e9;
    for (let i = 0; i < secs.length - 1; i++) { const len = secs[i + 1].end - secs[i].page; if (len < best) { best = len; k = i; } }
    secs[k] = { title: secs[k].title + ' + ' + secs[k + 1].title, page: secs[k].page, end: secs[k + 1].end, level: secs[k].level };
    secs.splice(k + 1, 1);
  }
  return { hd, n, secs };
}

export async function openSectionBriefing(doc) {
  toast('Lendo o sumário do PDF…');
  let info;
  try { info = await pdfSections(doc); } catch (e) { toast('Não consegui abrir o PDF: ' + e.message); return; }
  const { hd, n, secs } = info;
  const st = await S.settings();
  const model = st.aiProvider === 'claude' ? st.claudeModel : st.geminiModel;
  const sel = secs.map(() => true);
  const list = h('div.seclist');
  const est = h('p.muted');
  const recalc = () => {
    const pages = secs.reduce((t, s, i) => t + (sel[i] ? s.end - s.page + 1 : 0), 0);
    const tin = pages * 650 + sel.filter(Boolean).length * 400, tout = sel.filter(Boolean).length * 700;
    const c = AI.costOf(model, tin, tout);
    est.textContent = sel.filter(Boolean).length + ' seção(ões), ' + pages + ' páginas · cerca de ' + Math.round((tin + tout) / 1000) + ' mil tokens' + (c != null ? ' · custo aprox. ' + AI.fmtUsd(c) : '') + ' (' + (st.aiProvider === 'claude' ? 'Claude' : 'Gemini') + ')';
  };
  secs.forEach((s, i) => {
    const cb = h('input', { type: 'checkbox' }); cb.checked = true;
    cb.addEventListener('change', () => { sel[i] = cb.checked; recalc(); });
    list.appendChild(h('label.check.secrow' + (s.level > 1 ? '.lv2' : ''), cb, h('span.grow', s.title), h('span.muted', 'p. ' + s.page + (s.end > s.page ? '–' + s.end : ''))));
  });
  recalc();
  const ctrl = new AbortController();
  const body = h('div', h('p.muted', n + ' páginas. As seções vêm do sumário do PDF (ou, se ele não tiver, de blocos de 20 páginas). O texto de cada seção vai para a IA; o resultado sai em Markdown, pronto para virar um texto do app ou ir ao Obsidian.'), est, list);
  let result = '', running = false;
  const m = modal('Resumo por seção (IA) — ' + S.docTitle(doc), body, [
    { label: 'Cancelar', onclick: c => { ctrl.abort(); c(); } },
    { label: 'Gerar', primary: true, onclick: async () => {
      if (running) return; running = true;
      const foot = m.box.querySelector('.modal-foot'); if (foot) foot.style.display = 'none';
      clear(body);
      const prog = h('div.secprog'); const prev = h('div.tdoc.md.secout');
      const ctx = await AI.contextFor(doc);
      let total = 0;
      body.append(prog, prev);
      result = '# Resumo por seção — ' + S.docTitle(doc) + '\n\n';
      for (let i = 0; i < secs.length; i++) {
        if (!sel[i]) continue;
        const s = secs[i];
        const row = h('div.secstat', h('span.grow', s.title), h('span.muted', 'lendo…'));
        prog.appendChild(row);
        try {
          let text = '';
          for (let p = s.page; p <= s.end; p++) text += '\n[p. ' + p + ']\n' + await pageText(hd, p);
          row.lastChild.textContent = 'resumindo…';
          const r = await AI.sectionSummary(S.docTitle(doc), s.title + ' (p. ' + s.page + '–' + s.end + ')', text, ctrl.signal, ctx);
          total += r.cost || 0;
          result += '## ' + s.title + ' (p. ' + s.page + (s.end > s.page ? '–' + s.end : '') + ')\n\n' + r.text.trim() + '\n\n';
          row.lastChild.textContent = '✓';
          prev.innerHTML = renderMarkdown(result);
        } catch (e) {
          if (e.name === 'AbortError') return;
          row.lastChild.textContent = 'erro: ' + e.message;
          if (/chave|crédito|Configure/i.test(e.message)) break;
        }
      }
      body.appendChild(h('p.aicost', 'Custo aproximado total: ' + AI.fmtUsd(total)));
      body.appendChild(h('div.btnrow',
        h('button.pbtn', { type: 'button', onclick: async () => { const TX = await import('./textdoc.js'); const d = await TX.createTextDoc('Resumo — ' + S.docTitle(doc)); d.md = result; d.projects = doc.projects || []; await S.saveDoc(d); m.close(); window.leitorApp.openDoc(d.id); } }, 'Salvar como texto (novo documento)'),
        h('button.sbtn', { type: 'button', onclick: async () => { doc.briefing = result; await S.saveDoc(doc); toast('Guardado no documento (vai junto na nota do Obsidian).'); } }, 'Guardar no PDF'),
        h('button.sbtn', { type: 'button', onclick: async () => { await copyText(result); toast('Copiado.'); } }, 'Copiar')));
    } },
  ], { wide: true, focus: false, onclose: () => ctrl.abort() });
}

export async function openProjectsDialog(doc) {
  const projs = await S.projects();
  const set = new Set(doc.projects || []);
  const list = h('div');
  const render = () => {
    clear(list);
    if (!projs.length) list.appendChild(h('p.muted', 'Nenhum projeto ainda. Crie um abaixo.'));
    for (const p of projs) {
      const i = h('input', { type: 'checkbox' }); i.checked = set.has(p.id);
      i.addEventListener('change', () => { if (i.checked) set.add(p.id); else set.delete(p.id); });
      list.appendChild(h('label.check', i, h('span', p.name)));
    }
  };
  render();
  const nn = h('input', { type: 'text', placeholder: 'Novo projeto (ex.: Artigo 2)' });
  modal('Projetos de “' + S.docTitle(doc) + '”', h('div', list, h('div.inrow', nn, h('button.sbtn', { type: 'button', onclick: async () => {
    const n = nn.value.trim(); if (!n) return;
    const p = await S.saveProject({ name: n }); projs.push(p); set.add(p.id); nn.value = ''; render();
  } }, '+ Criar'))), [
    { label: 'Salvar', primary: true, onclick: async c => { doc.projects = [...set]; await S.saveDoc(doc); c(); } },
  ]);
}

export async function openSettings(tab) {
  const st = await S.settings();
  const f = {};
  const inp = (k, label, type = 'text', ph = '') => { f[k] = h('input', { type, placeholder: ph }); f[k].value = st[k] || ''; return h('label.field', h('span', label), f[k]); };
  const ctx = h('textarea', { rows: 4 }); ctx.value = st.researchContext;
  const pen = h('input', { type: 'checkbox' }); pen.checked = st.penOnly;
  const penEr = h('input', { type: 'checkbox' }); penEr.checked = st.penButtonErase !== false;
  const theme = h('select', ['auto', 'claro', 'escuro'].map(t => h('option', { value: t }, { auto: 'Automático (igual ao sistema)', claro: 'Claro', escuro: 'Escuro' }[t]))); theme.value = st.theme;
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1 }); rate.value = st.ttsRate || 1;
  const testOut = h('span.muted');
  const prov = h('select', [['gemini', 'Gemini (Google)'], ['claude', 'Claude (Anthropic)']].map(([v, l]) => h('option', { value: v }, l))); prov.value = st.aiProvider || 'gemini';
  const cmodel = h('select', AI.CLAUDE_MODELS.map(([v, l]) => h('option', { value: v }, l))); cmodel.value = st.claudeModel || 'claude-sonnet-5-5';
  const refp = h('input', { type: 'checkbox' }); refp.checked = st.refPopup !== false;
  const cropS = h('input', { type: 'checkbox' }); cropS.checked = st.cropInSplit !== false;
  const sel = (opts, v) => { const x = h('select', opts.map(([k, l]) => h('option', { value: k }, l))); x.value = v; return x; };
  const chk = v => { const x = h('input', { type: 'checkbox' }); x.checked = !!v; return x; };
  const eMode = sel([['auto', 'Automático (liga no Boox)'], ['on', 'Ligado'], ['off', 'Desligado']], st.einkMode || 'auto');
  const eProf = sel([['auto', 'Automático'], ['bw', 'Preto e branco (Go 7)'], ['color', 'Cores (Go Color 7)']], st.einkProfile || 'auto');
  const fPen = chk(st.fastPen !== false), vKeys = chk(st.einkVolumeKeys !== false), lazy = chk(st.syncLazyPdf), otherW = chk(st.linksOtherWindow !== false);
  const linkOpen = h('select', [['same', 'Abre aqui mesmo (com “voltar”)'], ['split', 'Abre lado a lado (divide a tela)']].map(([v, l]) => h('option', { value: v, selected: (st.linkOpen || 'same') === v ? true : undefined }, l)));
  const eRef = h('input', { type: 'number', min: 0, max: 50 }); eRef.value = st.einkRefresh == null ? 6 : st.einkRefresh;
  const panes = {
    geral: h('div',
      h('h3', 'Caneta'),
      h('label.check', pen, h('span', 'Só a S Pen escreve (o dedo arrasta e dá zoom)')),
      h('label.check', penEr, h('span', 'Botão da S Pen e ponta-borracha da caneta (ex.: reMarkable 2) apagam')),
      h('h3', 'Aparelho e tela'),
      h('label.field', h('span', 'Modo e-ink (tinta eletrônica)'), eMode),
      h('label.field', h('span', 'Perfil do e-ink'), eProf),
      h('label.check', fPen, h('span', 'Caneta rápida no Boox (experimental: usa o kit da Onyx; desligue se der problema)')),
      h('label.field', h('span', 'E-ink: atualizar a tela inteira a cada quantas páginas (0 = nunca)'), eRef),
      h('label.check', vKeys, h('span', 'E-ink: botões de volume também viram a página')),
      h('label.check', lazy, h('span', 'Baixar os PDFs da sincronização só quando abrir (bom para o celular)')),
      h('label.field', h('span', 'Link para outro documento (com uma janela só)'), linkOpen),
      h('label.check', otherW, h('span', 'Com outra janela do app aberta na tela, os links abrem nela')),
      h('h3', 'Tela dividida'),
      h('label.check', cropS, h('span', 'Nos PDFs, cortar as bordas brancas para o texto ocupar a largura do painel (como na Boox)')),
      h('h3', 'Referências'),
      h('label.check', refp, h('span', 'Ao tocar numa citação do PDF, mostrar título, autores, resumo e citações do artigo citado (busca na internet)')),
      h('h3', 'Aparência'),
      h('label.field', h('span', 'Tema do app'), theme),
      h('label.field', h('span', 'Velocidade da leitura em voz alta'), rate),
      h('h3', 'Tradução'),
      inp('translateTo', 'Idioma de destino (código: pt, en, es, fr, de, it)')),
    ia: h('div',
      h('label.field', h('span', 'IA usada pelo app'), prov),
      h('p.muted', 'Como conseguir as chaves: veja a aba Guia. As chaves ficam guardadas só neste aparelho (não vão para a sincronização).'),
      h('h3', 'Claude (Anthropic)'),
      inp('claudeKey', 'Chave da API do Claude', 'password', 'sk-ant-…'),
      h('label.field', h('span', 'Modelo do Claude'), cmodel),
      h('h3', 'Gemini (Google)'),
      inp('geminiKey', 'Chave da API do Gemini', 'password', 'AIza…'),
      h('div.inrow', inp('geminiModel', 'Modelo'), h('button.sbtn', { type: 'button', onclick: async () => {
        await S.setSettings({ geminiKey: f.geminiKey.value.trim(), geminiModel: f.geminiModel.value.trim(), claudeKey: f.claudeKey.value.trim(), claudeModel: cmodel.value, aiProvider: prov.value });
        testOut.textContent = 'Testando…';
        try { const r = await AI.runAction('translate', 'Optical tweezers.', '', ''); testOut.textContent = 'Funcionou (' + r.provider + ', ' + r.model + '): ' + r.text.slice(0, 60) + (r.cost != null ? ' · custo do teste: ' + AI.fmtUsd(r.cost) : ''); } catch (e) { testOut.textContent = e.message; }
      } }, 'Testar')), testOut,
      inp('language', 'Idioma das respostas'),
      priceTable(),
      h('label.field', h('span', 'Contexto geral da sua pesquisa (usado quando o PDF não está num projeto com contexto próprio)'), ctx)),
    obsidian: h('div',
      inp('obsidianVault', 'Nome do cofre (exatamente como aparece no Obsidian)'),
      inp('obsidianFolder', 'Pasta das notas de leitura')),
    backup: h('div',
      h('p.muted', 'Seus PDFs, anotações, áudios e o Digest ficam guardados neste aparelho. Faça cópias de segurança de vez em quando: se os dados do navegador/app forem apagados, eles se perdem.'),
      h('div.btnrow', h('button.sbtn', { type: 'button', onclick: () => backup() }, 'Fazer cópia de segurança (.zip)'), h('button.sbtn', { type: 'button', onclick: () => restore() }, 'Restaurar cópia…'))),
    sync: syncPane(inp, f),
    rm: rmPane(),
    guia: guideNodes(),
  };
  const tabs = [['geral', 'Geral'], ['sync', 'Sincronização'], ['rm', 'reMarkable'], ['ia', 'IA'], ['obsidian', 'Obsidian'], ['backup', 'Cópia'], ['guia', 'Guia']];
  const tabRow = h('div.tabsrow.inmodal', { role: 'tablist' });
  const holder = h('div.setpane');
  const show = id => {
    clear(tabRow);
    for (const [k, l] of tabs) tabRow.appendChild(h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(k === id), onclick: () => show(k) }, l));
    clear(holder); holder.appendChild(panes[id]);
  };
  show(tab || 'geral');
  modal('Configurações', h('div.settings', tabRow, holder), [
    { label: 'Cancelar' },
    { label: 'Salvar', primary: true, onclick: async c => {
      const p = { researchContext: ctx.value, penOnly: pen.checked, penButtonErase: penEr.checked, aiProvider: prov.value, claudeModel: cmodel.value, refPopup: refp.checked, cropInSplit: cropS.checked, einkMode: eMode.value, einkProfile: eProf.value, fastPen: fPen.checked, einkVolumeKeys: vKeys.checked, syncLazyPdf: lazy.checked, linksOtherWindow: otherW.checked, linkOpen: linkOpen.value, einkRefresh: Math.max(0, Math.min(50, +eRef.value || 0)), theme: theme.value, ttsRate: +rate.value };
      for (const k in f) p[k] = f[k].value.trim();
      await S.setSettings(p); c(); toast('Configurações salvas.');
    } },
  ], { wide: true, focus: false });
}

// custo aproximado das consultas mais comuns
function priceTable() {
  const rows = [['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5'], ['claude-opus-5-5', 'Claude Opus 5.5'], ['gemini-flash', 'Gemini Flash (pago)']];
  const est = (m, tin, tout) => AI.fmtUsd(AI.costOf(m, tin, tout));
  return h('div.pricebox',
    h('h3', 'Quanto custa uma consulta (aproximado)'),
    h('table.pricetab', h('tr', h('th', 'Modelo'), h('th', 'Explicar um trecho'), h('th', 'Resumo das anotações'), h('th', 'Livro de 300 p. por capítulo')),
      rows.map(([m, l]) => h('tr', h('td', l), h('td', est(m, 2000, 600)), h('td', est(m, 10000, 1500)), h('td', est(m, 150000, 16000))))),
    h('p.muted', 'Estimativas com preços de referência de outubro de 2026 (US$ por milhão de tokens: Haiku 4.5 1/5, Sonnet 5.5 2/10, Opus 5.5 4/20; Gemini Flash ~0,75/3,75). Explicar ≈ 2 mil tokens de entrada e 600 de saída; resumo ≈ 10 mil e 1,5 mil. O Gemini tem também um plano gratuito com limites. Confira os preços atuais nos sites da Anthropic e do Google. Depois de cada resposta, o app mostra o custo aproximado daquela consulta.'));
}

// Aba reMarkable: pasta do Syncthing onde o RM2 Notas grava as notas e o Digest feitos lá
function rmPane() {
  const info = h('p');
  const out = h('p.muted');
  const btns = h('div.btnrow');
  const render = async () => {
    const RS = await import('./rmsync.js');
    clear(btns);
    if (!RS.rmSyncSupported()) { info.textContent = 'Este navegador não deixa ler pastas. Use o app Android, ou o Chrome/Edge no computador.'; return; }
    const name = await RS.rmSyncFolderName();
    info.textContent = '';
    info.append(h('b', 'Pasta: '), name || 'nenhuma escolhida');
    const pick = async () => { const n = await RS.pickRmSyncFolder(); if (n) { out.textContent = 'Pasta escolhida: ' + n + '. Recebendo…'; const r = await RS.receiveFromRm({ interactive: true, force: true }); out.textContent = r ? 'Pronto. ' + r.files + ' arquivo(s) lido(s).' : ''; } render(); };
    btns.append(h('button.' + (name ? 'sbtn' : 'pbtn'), { type: 'button', onclick: pick }, name ? 'Trocar a pasta…' : 'Escolher a pasta…'));
    if (name) btns.append(
      h('button.pbtn', { type: 'button', onclick: async () => { out.textContent = 'Lendo a pasta…'; const r = await RS.receiveFromRm({ interactive: true }); out.textContent = r ? r.files + ' arquivo(s) com novidade.' : ''; } }, 'Receber agora'),
      h('button.sbtn', { type: 'button', onclick: async () => { out.textContent = 'Lendo tudo de novo…'; const r = await RS.receiveFromRm({ interactive: true, force: true }); out.textContent = r ? r.files + ' arquivo(s) lido(s).' : ''; } }, 'Ler tudo de novo'),
      h('button.dbtn', { type: 'button', onclick: async () => { await RS.forgetRmSyncFolder(); out.textContent = 'O app não lê mais essa pasta.'; render(); } }, 'Esquecer a pasta'));
  };
  render();
  return h('div',
    h('p.muted', 'Notas digitadas, destaques com nota e trechos do Digest feitos no reMarkable (RM2 Notas 0.10 e RM2 Digest) voltam para cá sozinhos, pela pasta que o Syncthing sincroniza com o reMarkable (no reMarkable: /home/root/leitor-sync). Só valem documentos que saíram daqui por “Enviar ao reMarkable”.'),
    info, btns, out,
    h('p.muted', 'Escolha aqui a pasta onde o Syncthing deste aparelho guarda esses arquivos (ex.: no Windows, Documentos\\leitor_remarkable_sync). Depois disso o app lê a pasta ao abrir, ao voltar para ele e a cada minuto. No navegador do computador, se ele pedir de novo a permissão, toque em “Receber agora”.'),
    h('p.muted', 'Nota adesiva vira nota no mesmo ponto; nota com citação vira destaque no trecho (se o texto for achado na página) com a nota; nota que saiu daqui e foi editada lá atualiza a original. Se a mesma nota foi editada aqui e lá, os dois textos ficam. Apagada lá some daqui (se você não mexeu nela aqui); apagada aqui não volta.'));
}

// Aba Sincronização (Google Drive)
function syncPane(inp, f) {
  const info = h('div.syncinfo');
  const out = h('p.muted');
  const btns = h('div.btnrow');
  const fmt = t => t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
  const render = async () => {
    const ss = await SY.syncInfo();
    const stt = SY.syncStatus();
    clear(info); clear(btns);
    info.append(
      h('p', h('b', ss.enabled ? 'Ligada' : 'Desligada'), ss.email ? ' · conta ' + ss.email : '', ' · última sincronização: ' + fmt(ss.last)),
      stt.msg && stt.state !== 'idle' ? h('p.muted', stt.msg) : '');
    const go = async () => {
      if (f.syncClientId) await S.setSettings({ syncClientId: f.syncClientId.value.trim() });
      out.textContent = 'Conectando…';
      try { const r = await SY.enableSync(); out.textContent = 'Pronto: ' + r.up + ' envio(s), ' + r.down + ' recebimento(s), ' + r.files + ' arquivo(s).'; }
      catch (e) { out.textContent = e.message; }
      render();
    };
    if (!ss.enabled) btns.append(h('button.pbtn', { type: 'button', onclick: go }, 'Entrar com a conta Google e ligar'));
    else btns.append(h('button.pbtn', { type: 'button', onclick: go }, 'Sincronizar agora'),
      h('button.dbtn', { type: 'button', onclick: async () => { if (await confirmBox('Desligar a sincronização', 'Os dados continuam neste aparelho e no seu Google Drive. Este aparelho só para de enviar e receber.', 'Desligar', true)) { await SY.disableSync(); out.textContent = 'Desligada.'; render(); } } }, 'Desligar'));
  };
  render();
  SY.preloadLogin();
  return h('div',
    h('p.muted', 'Mantém PDFs, cadernos, anotações, áudios, imagens, Digest e projetos iguais em todos os aparelhos onde você entrar com a mesma conta Google. Os dados ficam numa pasta “Leitor de Pesquisa (sincronização)” no seu Google Drive. As configurações e a chave do Gemini não são sincronizadas.'),
    info, btns, out,
    isAndroidApp ? h('p.muted', 'No app Android o login usa a conta Google do tablet. O ID do cliente abaixo é usado só na versão web.') : null,
    inp('syncClientId', 'ID do cliente OAuth do Google (versão web) — veja o Guia, “Sincronização”', 'text', '1234…apps.googleusercontent.com'),
    h('p.muted', 'A sincronização é automática: ao abrir o app, ao voltar para ele, ao sair e alguns segundos depois de cada mudança. Na versão web, o Google pede um toque em “Sincronizar” a cada hora, mais ou menos (o login expira).'));
}

// Manual curto do app
function guideNodes() {
  const sec = (title, ...items) => h('details.guide', h('summary', title), h('div.gbody', items));
  const ol = (...li) => h('ol', li.map(x => h('li', x)));
  const ul = (...li) => h('ul', li.map(x => h('li', x)));
  return h('div.guidewrap',
    h('p.muted', 'Toque num tópico para abrir.'),
    sec('Primeiros passos',
      ol('Na Biblioteca, toque em “Abrir PDF”. O seletor mostra o aparelho, o Google Drive e o OneDrive.',
        'O PDF abre no leitor. Ele lembra onde você parou.',
        'Use a barra da esquerda para escolher a ferramenta: Ler/selecionar, Caneta, Marca-texto, Borracha, Link e Nota.',
        'O botão ☰ no topo abre o painel lateral: Sumário, Páginas, Anotações, Busca e Ligações.')),
    sec('Celular, Fold, tablet, DeX e computador',
      ul('O app se ajusta sozinho à tela. Celular (e o Fold fechado): biblioteca no menu ☰, ferramentas numa barra embaixo, e o que não cabe no topo vai para o menu ⋯.',
        'Fold aberto e tablet: o app completo, com tela dividida.',
        'DeX e computador (mouse): o app completo, com menus pelo botão direito do mouse nos cartões da biblioteca.',
        'Na tela estreita do celular a tela dividida fica desligada; abra o Fold ou use o DeX.')),
    sec('Várias janelas (DeX, computador)',
      ol('No documento, toque em ⋯ > “Abrir em nova janela”. No DeX com monitor, a janela nova abre no monitor (se o sistema deixar); no computador, abre numa nova aba/janela do navegador.',
        'As janelas ficam iguais na hora: o que você escreve ou destaca numa aparece na outra.',
        'Com duas janelas abertas na tela, um link abre na outra janela (a usada por último). Se a outra janela estiver fechada ou minimizada, o link abre aqui mesmo. Para desligar: Configurações > Geral.',
        'Com uma janela só, você escolhe em Configurações > Geral > “Link para outro documento”: abrir aqui mesmo (com “voltar”) ou abrir lado a lado (divide a tela).',
        'Cada janela fecha sozinha com o “voltar” quando não há nada aberto nela.')),
    sec('Arrastar figura ou texto para o caderno ou o texto',
      ul('Recorte uma figura (ferramenta Recortar): na janela que aparece, segure a figura e arraste até a página de um caderno ou até um texto.',
        'Texto selecionado: no menu da seleção, toque em “Arrastar” e arraste até o caderno ou o texto. Entra como citação, com o link de volta à página de origem.',
        'Funciona na tela dividida e, no app Android, entre janelas do DeX. No computador, arraste com o mouse entre as janelas.')),
    sec('Boox (e-ink): Go 7 e Go Color 7',
      ul('O modo e-ink liga sozinho numa Boox (ou em Configurações > Geral > Aparelho e tela). O perfil P&B ou colorido também é automático e pode ser escolhido ali.',
        'No e-ink a página vira em vez de rolar: toque na direita (avança) ou na esquerda (volta), deslize o dedo, use os botões ‹ › do topo, as teclas de página ou os botões de volume (dá para desligar).',
        'A cada algumas viradas a tela pisca para limpar os “fantasmas” (o número fica em Configurações). Para limpar na hora: ⋯ > “Limpar a tela agora”.',
        '⋯ > “Modo artigo”: para artigos em duas colunas, uma coluna por vez (com a página virando).',
        '⋯ > “Página inteira na tela”: cada página cabe inteira, sem rolar dentro dela.',
        'No e-ink ficam desligados: tela dividida, novas janelas, animação de GIF (a imagem fica parada) e vídeo (fica só o link).',
        'Caneta rápida (experimental): no app Android, com Caneta, Marca-texto ou Borracha, o traço aparece na hora pelo sistema da Boox. Se não funcionar, o app avisa e volta para a caneta comum; dá para desligar em Configurações.')),
    sec('Modo artigo (uma coluna por vez)',
      ul('No PDF, toque no ícone de colunas no topo (ou ⋯ > “Modo artigo”). Como no NeoReader da Boox: as bordas brancas saem e cada página é dividida em colunas iguais; cada coluna aparece sozinha, na largura da tela (esquerda, direita, próxima página).',
        'O título e o resumo que ocupam a largura toda da 1ª página aparecem antes das colunas, numa faixa própria.',
        '⋯ > “Ajustar colunas do modo artigo…”: escolha 1, 2 ou 3 colunas, arraste as bordas do corte e a linha da divisão sobre a página e toque em Aplicar. “Automático” volta para a detecção do app. Fica guardado em cada documento.',
        'É o próprio PDF recortado (não é refeito): destaques, escrita, notas, links e seleção de texto funcionam normalmente.',
        'Margem para escrever (como na página inteira): toque no botão de margem da barra (ou ⋯ da página > “Abrir margem expandida”). Cada coluna ganha uma faixa pautada ao lado. O que você escreve ali fica na margem da página: aparece também quando você sai do modo artigo.',
        'Na tela dividida continua valendo o corte das bordas brancas.')),
    sec('IA: perguntar ao documento, Acrobat e NotebookLM',
      ul('Na barra da esquerda, o botão IA (✦) abre o painel da direita. No alto, escolha: IA interna (Claude ou Gemini, com a sua chave), Adobe Acrobat (só PDF) ou NotebookLM / Gemini.',
        'O que mandar: PDF inteiro, capítulo ou seção (pelo sumário do PDF; já vem marcado o capítulo onde você está) ou páginas (ex.: 45-78, na numeração impressa do livro). No texto: inteiro ou uma seção (pelos títulos).',
        'Minhas anotações: dentro do PDF (destaques, notas e desenhos) e/ou em texto à parte (o que a IA lê melhor). No Acrobat, o texto das anotações vai em páginas no fim do PDF.',
        'IA interna: escreva a pergunta (ou toque numa sugerida). A resposta cita as páginas [p. N]; toque nelas para ir ao lugar. “Guardar no Digest”, “Copiar” ou “Virar texto”. Trechos muito grandes: o app manda as páginas mais ligadas à pergunta.',
        'Acrobat e NotebookLM: no Android, o arquivo vai direto para o app (se estiver instalado; senão abre o Compartilhar). No computador, o arquivo é baixado e o site abre; arraste o arquivo para lá. Os vídeos do YouTube do texto (ou das notas do PDF) podem ir como fontes extras do NotebookLM: os links ficam copiados para colar em “Site / YouTube”.',
        'Para guardar a resposta de lá: selecione o texto e use Compartilhar → Leitor de Pesquisa (Android) ou cole em “Guardar uma resposta” no painel. Vira nota no Digest, ligada ao trecho enviado.',
        'Livro escaneado (sem texto): o app avisa; a IA de fora pode não conseguir ler sem OCR.')),
    sec('Calculadora de materiais e tabela periódica',
      ul('Na Calculadora, escolha “Tabela periódica”: toque num elemento (ou busque) para ver massa, configuração, eletronegatividade, ionização, densidade, fusão/ebulição, estrutura e rede, condutividade térmica; nos metais, elétrons livres (n, E_F, T_F, v_F, ω_p) e Drude; nos semicondutores, gap (direto/indireto), mobilidades, n_i, ε. “Tabela grande” abre em janela.',
        'Também na Calculadora: Semicondutores (n_i(T), dopagem, nível de Fermi, σ, Debye) com Si, Ge, GaAs, GaN, InP e outros; Metais (elétrons livres e Drude); Oscilador de Lorentz (ε, n, k e gráfico); Esfera (Mie exato: Q_ext, Q_sca, Q_abs, g, força de radiação e aquecimento); Pinça em regime Rayleigh (forças, rigidez, profundidade do poço, aquecimento); Beer–Lambert; Raios X (Bragg e Scherrer).',
        'Fontes: dados gerais dos elementos do pacote mendeleev (IUPAC, CRC, NIST); metais e semicondutores de Ashcroft & Mermin, Sze & Ng e CRC. Os valores com ≈ variam na literatura: confira na fonte para trabalhos.')),
    sec('Caderno: páginas novas',
      ul('No fim do caderno há o botão “Nova página”.',
        'Escreveu perto do fim da última página? A próxima página aparece sozinha embaixo.')),
    sec('Minhas formas (categorias suas)',
      ul('No painel de Formas, no seletor do alto, escolha “＋ Nova categoria…” e dê um nome.',
        'Jeito mais fácil de criar uma forma: desenhe na página com a caneta, selecione com o Laço e toque em “Salvar como forma…” no menu da seleção (ou em “＋ Adicionar” na categoria).',
        'Também dá para trazer um arquivo: SVG (ideal: só linhas, sem preenchimento, uma cor, com viewBox; vira traço editável) ou imagem PNG/JPG (ideal: PNG com fundo transparente, 400 px ou mais).',
        'Segure (ou botão direito) numa forma sua para renomear, mover de categoria ou apagar. Suas formas ficam no aparelho e vão junto na cópia de segurança.')),
    sec('Melhor ajuste da tela',
      ul('O botão de melhor ajuste (no topo e na barra da esquerda) corta as bordas brancas do PDF e põe o texto na largura da tela (no modo artigo, a coluna). No caderno, corta pelas laterais da área já escrita; no texto, usa a largura toda (e fica lembrado). Na tela dividida, ajusta os dois lados.',
        'Toque de novo para voltar à página inteira.')),
    sec('Índice de refração (refractiveindex.info)',
      ul('Três jeitos de abrir: selecione o nome do material no texto e toque em “Índice n,k”; aperte Alt+N no teclado (DeX, computador); ou escolha “Índice de refração dos materiais” na Calculadora física.',
        'Busque pelo nome em português ou inglês, ou pela fórmula (Si, Ge, SiO2, água, ouro, MEH-PPV…). Escolha o material e o conjunto de dados (artigo e faixa de λ).',
        'Digite o λ (ou toque num laser: 405, 532, 633, 785, 1064…, ou no gráfico) e veja n, k, ε₁, ε₂, absorção α, profundidade de penetração, reflexão normal, índice de grupo e λ no material.',
        'Os dados vêm do banco público do refractiveindex.info (no GitHub) e ficam guardados no aparelho. Uma vez por semana (com internet) o app confere a fonte e atualiza o catálogo e os materiais que você já usou; há também “Atualizar agora”. “Abrir no refractiveindex.info” abre a página completa do site no navegador.')),
    sec('Desfazer e refazer',
      ul('Os botões ↶ ↷ (e Ctrl+Z, Ctrl+Shift+Z ou Ctrl+Y no teclado) desfazem passo a passo tudo o que você mudou no documento: traços, destaques, notas, caixas de texto, imagens, formas, páginas inseridas ou apagadas, margens, marcadores e o texto.',
        'Cada documento tem a sua própria lista (desfazer num não mexe no outro). A lista vale enquanto o app está aberto.')),
    sec('Borracha por traço ou por área',
      ul('Com a Borracha escolhida, a barra de cores mostra “Traço” (apaga o traço inteiro) e “Área” (apaga só o pedaço debaixo do círculo).',
        'No modo Área, escolha o tamanho do círculo (P, M, G, GG). Funciona no PDF, no caderno e na folha de escrita dos textos.')),
    sec('Formas e calculadora física (painel da direita)',
      ul('Na barra da esquerda, “Formas” abre o painel da direita. No alto, escolha o tipo: geométricas, perfis de feixe (1D), campos de feixe (2D), componentes ópticos, mecânica quântica, eletromagnetismo e física médica.',
        'Toque numa forma e arraste um retângulo na página. Formas de traço (círculo, esfera, perfil gaussiano, LG, Bessel…) viram traços que você pode apagar e recolorir; campos 2D (gaussiano, LG, HG, Bessel, Airy, vórtice…) entram como imagem.',
        'Depois de solta, a ferramenta volta para Selecionar (outro toque não cria outra forma) e a forma fica selecionada; a tecla Delete apaga. Com ela selecionada: arraste por dentro para mover, o quadradinho do canto muda o tamanho (proporcional) e a bolinha em cima gira (encaixa em 0°, 45°, 90°…). Para mexer depois: ferramenta Laço, toque num traço da forma (pega a forma inteira) ou contorne. No menu da seleção: Girar 90°, Espelhar, Duplicar, cor, Apagar.',
        '“Calculadora” abre o mesmo painel com a calculadora física. No alto, escolha: luz e espectro (nm, cm⁻¹, eV, THz…), Raman, feixe gaussiano, foco, pinças ópticas, física médica (dose, dose equivalente, atividade, decaimento, atenuação, inverso do quadrado, raios X), unidades e constantes. Digite em qualquer campo que os outros acompanham.',
        'Constantes: CODATA 2018. Física médica: fatores de peso da radiação da ICRP 103 e meias-vidas tabeladas. Confira valores críticos numa fonte oficial antes de usar em prova ou trabalho.')),
    sec('Compartilhar e favoritos',
      ul('⋯ > “Compartilhar… (menu do Android)” manda o PDF (com as suas anotações), o caderno (em PDF) ou o texto (em Markdown ou PDF) para qualquer app: e-mail, WhatsApp, Drive, Claude…',
        'No computador, se o navegador não tiver o menu de compartilhar, o arquivo é baixado.',
        '⋯ > “Favoritar ★” põe o documento na aba Favoritos da tela dividida.')),
    sec('Tela dividida: escolher o outro lado',
      ul('Ao dividir a tela aparece a escolha com Recentes, Favoritos, Biblioteca e Projetos, e uma busca: vá digitando que a lista se ajusta.',
        'Biblioteca e Projetos mostram três colunas (Textos, Cadernos, PDFs) em ordem alfabética.',
        'Atalho: toque no botão de recentes (⇆) no topo, segure um arquivo e arraste para a direita da tela: ele abre lado a lado.')),
    sec('Notas do Adobe Acrobat',
      ul('Ao abrir um PDF que tem comentários do Acrobat (ou do Foxit, Edge, Xodo…), o app converte: destaque, sublinhado e tachado (com o comentário e as respostas) viram destaques do app; notas adesivas viram notas; desenhos à mão viram traços. Depois disso tudo é editável aqui.',
        'O nome de quem escreveu aparece no começo da nota (ex.: “Maria: …”). Caixas de texto, carimbos, formas e anexos continuam como estão, desenhados na página.',
        'Para um PDF que já estava na biblioteca: ⋯ > “Trazer as notas do Adobe deste PDF”.',
        'Ao exportar no modo editável, as notas de voz vão como anotação de som (ícone de alto-falante): no Acrobat para computador, dois cliques tocam o áudio. O áudio original também vai como anexo, para o app recuperar tudo ao reabrir.')),
    sec('Biblioteca e projetos',
      ul('A Biblioteca mostra três colunas em ordem alfabética: PDFs, Cadernos e Textos. No alto, “Continuar” traz os últimos documentos abertos.',
        'Num projeto, escolha a ordem: A–Z, Última edição ou Tipo (Textos, Cadernos, PDFs).',
        'Pastas e subpastas: “Nova pasta” no projeto (dentro de uma pasta, cria uma subpasta). Para mover um documento: ⋯ > “Mover para pasta…” (ou arraste com o mouse até a pasta). O caminho no alto (Projeto › Pasta) volta para cima.',
        'Apagar uma pasta não apaga documentos: o que estava nela sobe um nível. Documento novo criado dentro de uma pasta já nasce nela.')),
    sec('Links de volta',
      ul('Todo link entre documentos aparece nos dois: no destino surge uma etiqueta azul “← origem” na borda da página (toque para voltar).',
        'Valem os links feitos com a ferramenta de link, os escritos nos textos e os que estão dentro das caixas de texto dos cadernos.',
        'No painel lateral: “Ligações” mostra os que saem e os que chegam; “Anotações” também lista os que chegam.',
        'Nos textos, uma faixa no topo mostra quem aponta para eles, e os títulos de destino ganham uma marca “← n”.',
        'Atalho: ⋯ de uma página > “Copiar link desta página”, e cole num texto ou numa caixa de caderno.')),
    sec('Ir para uma página',
      ul('Toque no número da página (no canto de baixo, ou no “p. 3 de 45” do topo), digite a página e toque em Ir (ou Enter). Também dá para arrastar a barra.',
        'No computador: Ctrl+G.')),
    sec('Caixas de nota (como no Obsidian)',
      ul('No texto: botão ▣ da barra lateral escolhe o tipo (Nota, Resumo, Info, A fazer, Dica, Sucesso, Pergunta, Atenção, Falha, Perigo, Bug, Exemplo, Citação).',
        'Ao selecionar um trecho, “Caixa” coloca esse trecho numa caixa. Editando um bloco, “▣ Caixa” transforma as linhas em caixa (ou troca o tipo).',
        'Formato do Obsidian: > [!tip] Título. Com [!tip]- a caixa começa fechada (toque no título para abrir).',
        'As caixas aparecem no Sumário do painel lateral, junto com os títulos; o filtro “Caixas de nota” mostra só elas.')),
    sec('Folha de escrita ao lado do texto',
      ul('No texto, o lápis da barra lateral abre uma folha pautada ao lado. Escreva com a S Pen: cada traço fica preso ao parágrafo ao lado e acompanha o texto se ele crescer.',
        'Caneta, marca-texto, borracha, cores e desfazer ficam no alto da folha. O botão da S Pen também apaga.',
        'A folha fica só no app (não vai para o Obsidian) e sincroniza com os outros aparelhos.')),
    sec('Caneta (S Pen) e dedo',
      ul('Com Caneta, Marca-texto ou Borracha, só a S Pen escreve. O dedo arrasta e dois dedos dão zoom.',
        'Apagar sem trocar de ferramenta: use a ponta-borracha de canetas que têm uma (como a do reMarkable 2), ou, no app Android, segure o botão lateral da S Pen enquanto passa a ponta no traço. Funciona em qualquer ferramenta. Dá para desligar na aba Geral.',
        'Se quiser escrever com o dedo, desligue “Só a S Pen escreve” na aba Geral.',
        'Desfazer e refazer ficam na barra da esquerda.',
        'Margem expandida (ícone de página com margem) abre espaço ao lado da página para escrever.')),
    sec('Selecionar texto',
      ul('Na ferramenta Ler, arraste sobre o texto (no tablet: toque e segure, depois ajuste as alças).',
        'Ao soltar, aparece o menu: cores de destaque, sublinhar, tachar, Digest, Nota, Voz, Link, Copiar, Ouvir, Traduzir, Wikipédia e IA.',
        'Selecionando de novo um trecho que já tem algo, o menu mostra a opção de desfazer: a cor marcada com ✕, “Tirar nota”, “Tirar link”, “Tirar do Digest” etc.',
        'Escolher outra cor num trecho já destacado só troca o tipo do destaque.')),
    sec('Cadernos (escrita, texto e equações)',
      ol('Na Biblioteca, toque em “Novo caderno”, dê um nome, escolha o modelo (em branco, pautado, quadriculado, pontilhado ou Cornell) e a cor da capa (ou “Sem capa”).',
        'A capa é a primeira página, com o nome do caderno. Para mudar a cor depois: menu ⋯ da capa, menu ⋯ do topo (“Capa do caderno…”) ou o menu do caderno na Biblioteca.',
        'Caneta, marca-texto e borracha funcionam como no PDF (só a S Pen escreve).',
        'Ferramenta Texto (T): a barra de formatação aparece no topo, ao lado do título, e o painel de Matemática à direita. Toque na página para abrir uma caixa e digitar. Ao terminar, toque em “Concluir” (ou fora da caixa).',
        'Largura da caixa: “↔” ocupa a largura toda da página, “½” a metade; ou arraste as alças azuis nas bordas da caixa.',
        'Painel de Matemática: toque no símbolo e o código LaTeX entra onde está o cursor (fora de uma equação, já entra entre $ $). Em ∫, ∑, a/b e parecidos, o cursor fica no primeiro espaço a preencher. “Σ” na barra mostra/esconde o painel.',
        'Para editar de novo, toque na caixa (na ferramenta Ler ou Texto).',
        'Vídeo do YouTube numa caixa: escreva o endereço do vídeo sozinho numa linha. [[sumario]] numa caixa mostra o sumário do caderno.',
        'Imagem (ícone de foto): escolha um arquivo/foto ou cole. No PC, Ctrl+V cola direto na página.',
        'Laço: desenhe à mão livre em volta do que quer pegar. Tudo o que tiver uma parte dentro da forma entra (traços, imagens, caixas de texto, notas, links), e a seleção fica com a forma que você desenhou. Arraste por dentro para mover; o menu tem duplicar, mudar a cor, criar link e apagar.',
        'Imagens e GIFs: o GIF continua animado na página.',
        'Nota (balão): toque no lugar para uma nota escrita ou de voz. O botão ● grava a aula enquanto você escreve.',
        'Menu ⋯ de cada página: nova página, duplicar, mudar o modelo, mover, marcar e apagar.')),
    sec('Markdown e equações (como no Obsidian)',
      ul('# Título, ## Subtítulo, **negrito**, *itálico*, ==realce==, - lista, - [ ] tarefa (toque para marcar), > citação, `código`.',
        'Equação no texto: $F = -\\kappa x$. Equação destacada: $$ ... $$ (em linhas próprias).',
        'Numerar: com o cursor dentro de uma equação destacada, toque em “(n)” (ele acrescenta \\eqn). Fora de uma equação, “(n)” cria uma equação numerada nova. A numeração segue a ordem do caderno ou do texto.',
        'Citar: toque em “ref” e escolha a equação na lista, (1), (2)… O app cria o nome (\\label{eq1}) na equação, se ela ainda não tiver, e escreve \\eqref{eq1}, que aparece como “(1)”. Com o cursor dentro de uma equação, “ref” oferece “Numerar e dar nome a esta equação”.',
        'Tabela: botão ▦ e escolha linhas × colunas na grade, ou digite o número de linhas e colunas e toque em Inserir. No documento de texto, toque na tabela pronta para editar as células numa janela.',
        'Imagens no texto: ao inserir ou colar, aparece o ajuste de tamanho (25%, 50%, 75%, 100% ou arraste a alça azul). Toque na imagem para ajustar de novo.',
        'Também vale \\begin{equation} ... \\end{equation} (numerada).',
        '“Prévia” mostra o resultado enquanto você digita. No Obsidian, a numeração vai como \\tag{n}.')),
    sec('Documento de texto (Novo texto)',
      ol('Na Biblioteca, toque em “Novo texto”. É um documento corrido, todo em Markdown, como no Obsidian.',
        'Toque num parágrafo para editá-lo: ele vira texto com os símbolos (#, **, $…$). Toque fora (ou Esc) e ele volta formatado.',
        'Enter duas vezes começa um parágrafo novo. Listas continuam sozinhas ao dar Enter. ↑ no começo e ↓ no fim passam para o bloco anterior/seguinte. Toque no fim da página para continuar escrevendo.',
        'A barra do topo formata; a barra da esquerda insere: imagem ou GIF, vídeo do YouTube, nota de voz, caixa de nota, tabela, link e sumário. À direita, o painel de Matemática.',
        'Vídeo: cole o endereço do YouTube; aparece a miniatura e o vídeo toca aqui mesmo (com “Abrir no YouTube” ao lado).',
        'Links: para uma seção deste texto ([[#Título]]), outro PDF, caderno ou texto (até a página ou seção), um trecho do Digest, uma nota do Obsidian ou um site. Dos PDFs e cadernos também dá para fazer link para uma seção de um texto.',
        'Selecione um trecho com o dedo ou o mouse (sem editar): aparecem Digest, Realçar, Link, Nota, Copiar, Traduzir e Wikipédia.',
        'Sumário: o painel ☰ mostra os títulos em hierarquia (#, ##, ###); o botão Sumário da barra da esquerda põe um sumário dentro do texto.',
        'Desfazer e refazer ficam no topo da barra da esquerda. “⋯ → Editar tudo como Markdown” abre o texto inteiro numa caixa só.',
        'Exportar: pacote do Obsidian (.md com imagens, áudios e equações numeradas), só o .md, ou PDF.')),
    sec('Imagens no Digest e recorte de equações',
      ul('No painel do Digest há “Colar imagem” e “Escolher arquivo” (no PC, Ctrl+V também cola).',
        'Ferramenta Recorte (no PDF): desenhe um retângulo em volta da equação ou figura. Depois escolha: enviar ao Digest, inserir num caderno (com a fonte como legenda), copiar ou salvar a imagem.',
        'Um trecho do Digest pode ter só imagem e nota, sem texto.')),
    sec('Digest',
      ul('Selecione o trecho e toque em Digest. Escolha a área (Física › Óptica…), tags e escreva a nota.',
        'Na tela do Digest, o seletor de projeto (ícone de pasta, no topo) mostra só os trechos de PDFs daquele projeto.',
        'Se o trecho continua em outra página ou coluna, toque em “Continuação”, selecione o resto e toque em “Continuar”.',
        'Na tela do Digest há as abas Recentes, Fontes, Áreas, Tags e Revisar.')),
    sec('Links entre PDFs e cadernos',
      ul('Selecione um trecho e toque em Link, ou use a ferramenta Link e desenhe um retângulo (no caderno, por cima do texto, da escrita ou da imagem). No caderno, o Laço também tem “Criar link a partir da seleção”.',
        'Escolha o destino: neste documento, outro PDF ou caderno, Digest, nota do Obsidian ou site. “Escolher o destino tocando na página” marca o ponto exato.',
        'Para seguir o link, toque nele com a ferramenta Ler.',
        'Na página de destino aparece um ← que mostra de onde vêm os links.')),
    sec('Tela dividida',
      ul('Botão ◫ no topo (ou ⋯ → Dividir a tela): escolha o que abrir do outro lado — PDF, caderno ou texto (ou o mesmo PDF, para ver duas partes).',
        'Nos PDFs, as bordas brancas são cortadas para o texto ocupar a largura do painel (como na Boox). Dá para ligar/desligar em ⋯ → Cortar as bordas, e mudar o padrão em Configurações → Geral.',
        'Links tocados de um lado abrem do outro lado.',
        'Cada lado tem a sua troca rápida: o botão ⇆ e o deslize de dois dedos valem só para aquele lado. O lado ativo fica com uma linha azul embaixo do topo.',
        'Para voltar a uma tela só, toque em ◫ no lado que quer manter.')),
    sec('Referências dos artigos e “Ler depois”',
      ul('Num PDF, toque numa citação (o número da referência, quando o PDF tem esse link): aparece um cartão com título, autores, revista, ano, número de citações e o resumo do artigo citado.',
        'Os dados vêm de bases abertas (Crossref e OpenAlex). O Google Acadêmico não tem acesso aberto para apps; o botão “Google Acadêmico ↗” abre a busca lá.',
        '“Ler depois” guarda o artigo. Se o PDF está num projeto, ele aparece na aba “Para ler” do projeto, numa tabela em ordem, com o resumo e de qual artigo veio. Todos ficam também em Biblioteca → Ler depois.',
        'Para desligar o cartão e voltar à prévia da página: Configurações → Geral → Referências.')),
    sec('Troca rápida entre arquivos',
      ul('Deslize dois dedos para a esquerda sobre a página: volta ao arquivo aberto antes (PDF ou caderno). Repita para alternar entre os dois.',
        'Deslize dois dedos para a direita, ou toque no botão ⇆ do topo: aparece a lista dos arquivos recentes.',
        'Cada arquivo reabre no ponto onde você estava.')),
    sec('Sincronização (Google Drive): preparar uma vez',
      h('p.muted', 'O Google exige que o app seja registrado na sua conta. É de graça e feito uma vez só (uns 15 minutos), no computador.'),
      ol('Entre em console.cloud.google.com com a sua conta Google. No topo, clique no seletor de projetos → “Novo projeto” → nome “Leitor de Pesquisa” → Criar. Confira que ele ficou selecionado no topo.',
        'Menu ☰ → “APIs e serviços” → “Biblioteca”. Busque “Google Drive API”, abra e clique em “Ativar”.',
        'Menu ☰ → “Google Auth Platform” (ou “APIs e serviços” → “Tela de permissão OAuth”). Clique em “Começar”: nome do app “Leitor de Pesquisa”, seu e-mail de suporte, público “Externo”, seu e-mail de contato, aceite e “Criar”.',
        'Em “Público-alvo” (Audience), em “Usuários de teste”, clique em “Adicionar usuários” e coloque o seu Gmail. Salve.',
        'Em “Acesso a dados” (Data Access), clique em “Adicionar ou remover escopos”, marque “…/auth/drive.file” (ou cole https://www.googleapis.com/auth/drive.file em “Adicionar escopos manualmente”), “Atualizar” e “Salvar”.',
        'Versão web: em “Clientes” → “Criar cliente” → tipo “Aplicativo da Web”. Em “Origens JavaScript autorizadas”, adicione o endereço do seu GitHub Pages só com o domínio, por exemplo https://seunome.github.io (sem a parte /leitor/). Criar. Copie o “ID do cliente” (termina em .apps.googleusercontent.com).',
        'Aqui no app (web): Configurações → Sincronização → cole o ID do cliente → “Entrar com a conta Google e ligar”. Na janela do Google, escolha a conta; como o app está em teste, pode aparecer o aviso “O Google não verificou este app”: toque em “Continuar”.',
        'App Android: em “Clientes” → “Criar cliente” → tipo “Android”. Nome do pacote: com.tiago.leitorpesquisa. “Impressão digital do certificado SHA-1”: veja no LEIA-ME do projeto Android como obter (um comando no PC). Criar. No app Android não é preciso colar nada: Configurações → Sincronização → “Entrar com a conta Google e ligar”.'),
      h('p.muted', 'Depois disso a sincronização é automática. Se um mesmo item for editado nos dois aparelhos antes de sincronizar, fica a edição mais recente (campos diferentes de um mesmo documento se juntam). Apagar num aparelho apaga nos outros.')),
    sec('Claude (IA): chave e custo',
      ol('Entre em console.anthropic.com e crie uma conta (pode ser com o Google).',
        'Em Billing, adicione crédito (pré-pago; por exemplo US$ 5).',
        'Em API Keys, toque em “Create Key”, dê um nome (ex.: Leitor) e copie a chave (começa com “sk-ant-”).',
        'Aqui no app: Configurações → IA → “IA usada pelo app: Claude” → cole a chave → escolha o modelo → Testar → Salvar.'),
      h('p.muted', 'A tabela em Configurações → IA mostra o custo aproximado de cada tipo de consulta. Depois de cada resposta, o app mostra o custo daquela consulta. A chave fica só neste aparelho.')),
    sec('Resumo por capítulo (livros e artigos longos)',
      ul('No PDF: ⋯ → “Resumo por capítulo/seção (IA)”. As seções vêm do sumário do PDF; sem sumário, o app divide em blocos de 20 páginas.',
        'Antes de gerar, o app mostra quantas páginas e o custo aproximado. Desmarque as seções que não quer.',
        'O resultado pode virar um documento de texto do app, ir junto com o PDF para o Obsidian ou ser copiado.')),
    sec('Chave do Gemini (IA)',
      ol('No computador ou no tablet, entre em aistudio.google.com com sua conta Google.',
        'Na primeira vez, aceite os termos e toque em Continue.',
        'Clique em “Get API key” (menu da esquerda) e depois em “Create API key”. Dê um nome (ex.: Leitor) e confirme.',
        'Copie a chave (começa com “AIza”).',
        'Aqui no app: Configurações → aba IA → cole no campo da chave → Testar → Salvar.'),
      h('p.muted', 'A chave fica guardada só neste aparelho; não a compartilhe. O Google AI Studio tem um plano gratuito com limites de uso; confira os limites atuais na página de preços do Google.')),
    sec('Contexto da IA por projeto',
      ol('Na Biblioteca, abra um projeto (lista PROJETOS à esquerda).',
        'Toque em “Contexto da IA” e descreva o projeto (tema, materiais, o que importa para você).',
        'As respostas da IA (explicar, perguntar, resumo) para PDFs desse projeto passam a usar esse contexto.',
        'PDFs fora de projetos usam o “Contexto geral” da aba IA.')),
    sec('Tradução e Wikipédia',
      ul('Traduzir abre uma janela aqui mesmo, com o Google Tradutor (gratuito, sem chave). Se ele falhar, o app tenta o MyMemory e o tradutor do próprio Chrome. “Traduzir com IA” usa o Claude ou o Gemini; “Google Tradutor ↗” abre o site.',
        'Wikipédia mostra o resumo do termo selecionado, em português ou inglês, com outros resultados e o link para o artigo completo.',
        'As duas janelas podem ser arrastadas pelo topo.')),
    sec('Exportar e Obsidian',
      ul('Exportar gera o PDF com as marcações: “Editável” (outras pessoas podem ver e mexer; ao reabrir no app, tudo volta editável) ou “Achatado” (aparece igual em qualquer leitor).',
        'Enviar ao Obsidian: “Enviar esta nota” abre o app do Obsidian (informe o nome do cofre na aba Obsidian); “Pacote .zip” traz todas as notas, o Digest e os áudios para extrair no cofre.',
        'Enviar ao reMarkable (menu ⋯ do documento na biblioteca, ou Exportar): gera um PDF para o leitor nativo do reMarkable. Destaques, escrita e figuras vão desenhados; destaque com nota sai destacado e sublinhado; links para páginas do mesmo PDF continuam funcionando. As notas digitadas e os trechos do Digest vão escondidos no PDF: com o RM2 Notas 0.9 no reMarkable, ao abrir o documento lá elas aparecem sozinhas (nota de destaque na margem, nota adesiva no mesmo ponto) e os trechos vão para o RM2 Digest 0.3. Textos viram PDF (dá para selecionar e destacar o texto no reMarkable). Escolha o app do reMarkable no menu de compartilhar ou use “Salvar o PDF”.',
        'Notas feitas no reMarkable (RM2 Notas 0.10): voltam sozinhas pela pasta do Syncthing. Escolha a pasta em Configurações > reMarkable (uma vez em cada aparelho).',
        'Trazer do reMarkable: exporte do reMarkable o PDF de um documento que você mandou por “Enviar ao reMarkable” (e-mail ou app do computador) e abra-o aqui (Abrir PDF, ou Abrir com… no Android). O app pergunta se quer trazer a escrita e os destaques feitos lá para o documento original. Páginas inseridas no reMarkable impedem isso (aí importe como documento novo).')),
    sec('Cópia de segurança',
      ul('Tudo fica guardado neste aparelho (e no seu Google Drive, se a sincronização estiver ligada). Use a aba Cópia de vez em quando para gerar um .zip extra.',
        'Para passar seus dados para outro aparelho (ou do navegador para o app Android), faça a cópia num e restaure no outro.')));
}

async function backup() {
  toast('Gerando a cópia de segurança…');
  const files = {};
  for (const store of ['docs', 'annots', 'projects', 'recordings', 'kv']) files[store + '.json'] = strToU8(JSON.stringify((await db.all(store)).filter(r => store !== 'kv' || !String(r.k).startsWith('nk:'))));   // sem o cache do refractiveindex
  for (const f of await db.all('files')) files['files/' + f.id] = new Uint8Array(await f.blob.arrayBuffer());
  const types = {}; for (const f of await db.all('files')) types[f.id] = f.blob.type;
  files['types.json'] = strToU8(JSON.stringify(types));
  downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), 'leitor-backup-' + new Date().toISOString().slice(0, 10) + '.zip');
}

async function restore() {
  const input = h('input', { type: 'file', accept: '.zip,application/zip' });
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    if (!(await confirmBox('Restaurar cópia', 'Os itens da cópia serão acrescentados (os que já existem com o mesmo identificador serão substituídos). Continuar?', 'Restaurar'))) return;
    try {
      const z = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const types = JSON.parse(strFromU8(z['types.json'] || strToU8('{}')));
      for (const k in z) if (k.startsWith('files/')) { const id = k.slice(6); await db.put('files', { id, blob: new Blob([z[k]], { type: types[id] || '' }) }); }
      for (const store of ['docs', 'annots', 'projects', 'recordings', 'kv']) if (z[store + '.json']) await db.putMany(store, JSON.parse(strFromU8(z[store + '.json'])));
      toast('Cópia restaurada. Recarregando…'); setTimeout(() => location.reload(), 1200);
    } catch (e) { toast('Não foi possível restaurar: ' + e.message, 5000); }
  };
  input.click();
}

export { safeName, CATS };
