// Diálogos: exportar, Obsidian, dados do artigo, IA, resumo, projetos, configurações, cópia de segurança.
import * as S from './store.js';
import { db } from './db.js';
import { h, clear, btn, toast, modal, copyText, downloadBlob, shareFile, safeName, CATS, catInfo, confirmBox } from './util.js';
import { exportPdf, annotatedName } from './export.js';
import { vaultZip, sendNoteToObsidian, docMarkdown, noteFileName } from './obsidian.js';
import { openPdf, pageText, pageLabel } from './pdfdoc.js';
import * as AI from './ai.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/fflate.js';

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
    status), [
    { label: 'Baixar no tablet', onclick: async () => { const r = await build(); if (r) { downloadBlob(r.blob, r.name); toast('PDF salvo em Downloads.'); } } },
    { label: 'Compartilhar (Drive, OneDrive…)', primary: true, onclick: async () => { const r = await build(); if (r) { const ok = await shareFile(r.blob, r.name, 'application/pdf'); if (!ok) { downloadBlob(r.blob, r.name); toast('Compartilhar não está disponível aqui; o PDF foi baixado.'); } } } },
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
  const out = h('div.aiout', h('p.muted', 'Consultando o Gemini…'));
  let text = '';
  const m = modal(title, out, [
    { label: 'Copiar', onclick: async () => { if (text) { await copyText(text); toast('Copiado.'); } } },
    opts.onSaveNote ? { label: 'Salvar como nota', primary: true, onclick: async c => { if (!text) return; c(); await opts.onSaveNote(text); } } : null,
  ].filter(Boolean), { wide: true, focus: false, onclose: () => ctrl.abort() });
  run(ctrl.signal).then(r => { text = r.text; clear(out); out.appendChild(mdToNodes(r.text)); if (r.truncated) out.appendChild(h('p.muted', '(resposta cortada pelo limite de tamanho)')); })
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
export async function openBriefing(docs, title) {
  const dg = await S.digest();
  let material = '';
  for (const d of docs) {
    const anns = (await S.annots(d.id)).filter(a => a.kind === 'hl' || a.kind === 'note');
    if (docs.length > 1) material += '\n## ' + S.docTitle(d) + '\n';
    for (const a of anns) {
      const lab = pageLabel(a.pageKey);
      if (a.kind === 'hl') material += `- [${catInfo(a.cat).label}] (${lab}) "${a.text || ''}"` + (a.note ? `\n  Nota: ${a.note}` : '') + '\n';
      else if (a.text) material += `- Nota (${lab}): ${a.text}\n`;
    }
    for (const it of dgFilter(dg, { source: d.id }, 'pagina')) material += `- Digest (${dgPages(it)}): "${it.quote}"` + (it.note ? `\n  Nota: ${it.note}` : '') + '\n';
  }
  if (!material.trim()) { toast('Não há destaques ou notas para resumir ainda.'); return; }
  showAiResult('Resumo das anotações', signal => AI.briefing(title, material, signal), {
    onSaveNote: docs.length === 1 ? async text => { docs[0].briefing = text; await S.saveDoc(docs[0]); toast('Resumo salvo: vai junto na nota do Obsidian.'); } : async text => { await copyText(text); toast('Resumo copiado.'); },
  });
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

export async function openSettings() {
  const st = await S.settings();
  const f = {};
  const inp = (k, label, type = 'text', ph = '') => { f[k] = h('input', { type, placeholder: ph }); f[k].value = st[k] || ''; return h('label.field', h('span', label), f[k]); };
  const ctx = h('textarea', { rows: 3 }); ctx.value = st.researchContext;
  const pen = h('input', { type: 'checkbox' }); pen.checked = st.penOnly;
  const theme = h('select', ['auto', 'claro', 'escuro'].map(t => h('option', { value: t }, { auto: 'Automático (igual ao Android)', claro: 'Claro', escuro: 'Escuro' }[t]))); theme.value = st.theme;
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1 }); rate.value = st.ttsRate || 1;
  const testOut = h('span.muted');
  modal('Configurações', h('div.settings',
    h('h3', 'Caneta'),
    h('label.check', pen, h('span', 'Só a S Pen escreve (o dedo arrasta e dá zoom)')),
    h('h3', 'Aparência'),
    h('label.field', h('span', 'Tema do app'), theme),
    h('label.field', h('span', 'Velocidade da leitura em voz alta'), rate),
    h('h3', 'IA (Gemini)'),
    inp('geminiKey', 'Chave da API do Gemini (fica guardada só neste tablet)', 'password', 'AIza…'),
    h('div.inrow', inp('geminiModel', 'Modelo'), h('button.sbtn', { type: 'button', onclick: async () => {
      await S.setSettings({ geminiKey: f.geminiKey.value.trim(), geminiModel: f.geminiModel.value.trim() });
      testOut.textContent = 'Testando…';
      try { const r = await AI.runAction('translate', 'Optical tweezers.', '', ''); testOut.textContent = 'OK (' + r.model + '): ' + r.text.slice(0, 60); } catch (e) { testOut.textContent = e.message; }
    } }, 'Testar')), testOut,
    inp('language', 'Idioma das respostas'),
    h('label.field', h('span', 'Contexto da sua pesquisa (usado no resumo)'), ctx),
    h('h3', 'Tradução'),
    inp('translateTo', 'Idioma de destino no Google Tradutor (código: pt, en, es…)'),
    h('h3', 'Obsidian'),
    inp('obsidianVault', 'Nome do cofre (exatamente como aparece no Obsidian)'),
    inp('obsidianFolder', 'Pasta das notas de leitura'),
    h('h3', 'Cópia de segurança'),
    h('p.muted', 'Seus PDFs, anotações, áudios e o Digest ficam guardados no navegador deste tablet. Faça cópias de segurança de vez em quando: se os dados do Chrome forem apagados, eles se perdem.'),
    h('div.btnrow', h('button.sbtn', { type: 'button', onclick: () => backup() }, 'Fazer cópia de segurança (.zip)'), h('button.sbtn', { type: 'button', onclick: () => restore() }, 'Restaurar cópia…')),
  ), [
    { label: 'Cancelar' },
    { label: 'Salvar', primary: true, onclick: async c => {
      const p = { researchContext: ctx.value, penOnly: pen.checked, theme: theme.value, ttsRate: +rate.value };
      for (const k in f) p[k] = f[k].value.trim();
      await S.setSettings(p); c(); toast('Configurações salvas.');
    } },
  ], { wide: true, focus: false });
}

async function backup() {
  toast('Gerando a cópia de segurança…');
  const files = {};
  for (const store of ['docs', 'annots', 'projects', 'recordings', 'kv']) files[store + '.json'] = strToU8(JSON.stringify(await db.all(store)));
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
