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
    { label: 'Salvar no tablet', onclick: async () => { const r = await build(); if (r) await downloadBlob(r.blob, r.name); } },
    { label: 'Compartilhar (Drive, OneDrive…)', primary: true, onclick: async () => { const r = await build(); if (r) { const ok = await shareFile(r.blob, r.name, 'application/pdf'); if (!ok) { await downloadBlob(r.blob, r.name); } } } },
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
export async function openBriefing(docs, title, opts) {
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
  const ctx = docs.length === 1 ? await AI.contextFor(docs[0]) : (opts && opts.ctx) || await AI.contextFor({ projects: [...new Set(docs.flatMap(d => d.projects || []))] });
  showAiResult('Resumo das anotações', signal => AI.briefing(title, material, signal, ctx), {
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

export async function openSettings(tab) {
  const st = await S.settings();
  const f = {};
  const inp = (k, label, type = 'text', ph = '') => { f[k] = h('input', { type, placeholder: ph }); f[k].value = st[k] || ''; return h('label.field', h('span', label), f[k]); };
  const ctx = h('textarea', { rows: 4 }); ctx.value = st.researchContext;
  const pen = h('input', { type: 'checkbox' }); pen.checked = st.penOnly;
  const theme = h('select', ['auto', 'claro', 'escuro'].map(t => h('option', { value: t }, { auto: 'Automático (igual ao sistema)', claro: 'Claro', escuro: 'Escuro' }[t]))); theme.value = st.theme;
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1 }); rate.value = st.ttsRate || 1;
  const testOut = h('span.muted');
  const panes = {
    geral: h('div',
      h('h3', 'Caneta'),
      h('label.check', pen, h('span', 'Só a S Pen escreve (o dedo arrasta e dá zoom)')),
      h('h3', 'Aparência'),
      h('label.field', h('span', 'Tema do app'), theme),
      h('label.field', h('span', 'Velocidade da leitura em voz alta'), rate),
      h('h3', 'Tradução'),
      inp('translateTo', 'Idioma de destino (código: pt, en, es, fr, de, it)')),
    ia: h('div',
      h('p.muted', 'Como conseguir a chave: veja a aba Guia.'),
      inp('geminiKey', 'Chave da API do Gemini (fica guardada só neste aparelho)', 'password', 'AIza…'),
      h('div.inrow', inp('geminiModel', 'Modelo'), h('button.sbtn', { type: 'button', onclick: async () => {
        await S.setSettings({ geminiKey: f.geminiKey.value.trim(), geminiModel: f.geminiModel.value.trim() });
        testOut.textContent = 'Testando…';
        try { const r = await AI.runAction('translate', 'Optical tweezers.', '', ''); testOut.textContent = 'Funcionou (' + r.model + '): ' + r.text.slice(0, 60); } catch (e) { testOut.textContent = e.message; }
      } }, 'Testar')), testOut,
      inp('language', 'Idioma das respostas'),
      h('label.field', h('span', 'Contexto geral da sua pesquisa (usado quando o PDF não está num projeto com contexto próprio)'), ctx)),
    obsidian: h('div',
      inp('obsidianVault', 'Nome do cofre (exatamente como aparece no Obsidian)'),
      inp('obsidianFolder', 'Pasta das notas de leitura')),
    backup: h('div',
      h('p.muted', 'Seus PDFs, anotações, áudios e o Digest ficam guardados neste aparelho. Faça cópias de segurança de vez em quando: se os dados do navegador/app forem apagados, eles se perdem.'),
      h('div.btnrow', h('button.sbtn', { type: 'button', onclick: () => backup() }, 'Fazer cópia de segurança (.zip)'), h('button.sbtn', { type: 'button', onclick: () => restore() }, 'Restaurar cópia…'))),
    guia: guideNodes(),
  };
  const tabs = [['geral', 'Geral'], ['ia', 'IA'], ['obsidian', 'Obsidian'], ['backup', 'Cópia'], ['guia', 'Guia']];
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
      const p = { researchContext: ctx.value, penOnly: pen.checked, theme: theme.value, ttsRate: +rate.value };
      for (const k in f) p[k] = f[k].value.trim();
      await S.setSettings(p); c(); toast('Configurações salvas.');
    } },
  ], { wide: true, focus: false });
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
    sec('Caneta (S Pen) e dedo',
      ul('Com Caneta, Marca-texto ou Borracha, só a S Pen escreve. O dedo arrasta e dois dedos dão zoom.',
        'Se quiser escrever com o dedo, desligue “Só a S Pen escreve” na aba Geral.',
        'Desfazer e refazer ficam na barra da esquerda.',
        'Margem expandida (ícone de página com margem) abre espaço ao lado da página para escrever.')),
    sec('Selecionar texto',
      ul('Na ferramenta Ler, arraste sobre o texto (no tablet: toque e segure, depois ajuste as alças).',
        'Ao soltar, aparece o menu: cores de destaque, sublinhar, tachar, Digest, Nota, Voz, Link, Copiar, Ouvir, Traduzir, Wikipédia e IA.',
        'Selecionando de novo um trecho que já tem algo, o menu mostra a opção de desfazer: a cor marcada com ✕, “Tirar nota”, “Tirar link”, “Tirar do Digest” etc.',
        'Escolher outra cor num trecho já destacado só troca o tipo do destaque.')),
    sec('Digest',
      ul('Selecione o trecho e toque em Digest. Escolha a área (Física › Óptica…), tags e escreva a nota.',
        'Se o trecho continua em outra página ou coluna, toque em “Continuação”, selecione o resto e toque em “Continuar”.',
        'Na tela do Digest há as abas Recentes, Fontes, Áreas, Tags e Revisar.')),
    sec('Links entre PDFs',
      ul('Selecione um trecho e toque em Link (ou use a ferramenta Link e desenhe um retângulo).',
        'Escolha o destino: página deste PDF, outro PDF, Digest, nota do Obsidian ou site. “Escolher o destino tocando na página” marca o ponto exato.',
        'Na página de destino aparece um ← que mostra de onde vêm os links.')),
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
      ul('Traduzir abre uma janela aqui mesmo. No Chrome do computador usa o tradutor do próprio Chrome (sem internet); se não houver, usa o Gemini (com a chave configurada). O botão “Google Tradutor ↗” abre o site.',
        'Wikipédia mostra o resumo do termo selecionado, em português ou inglês, com outros resultados e o link para o artigo completo.',
        'As duas janelas podem ser arrastadas pelo topo.')),
    sec('Exportar e Obsidian',
      ul('Exportar gera o PDF com as marcações: “Editável” (outras pessoas podem ver e mexer; ao reabrir no app, tudo volta editável) ou “Achatado” (aparece igual em qualquer leitor).',
        'Enviar ao Obsidian: “Enviar esta nota” abre o app do Obsidian (informe o nome do cofre na aba Obsidian); “Pacote .zip” traz todas as notas, o Digest e os áudios para extrair no cofre.')),
    sec('Cópia de segurança',
      ul('Tudo fica guardado neste aparelho. Use a aba Cópia de vez em quando para gerar um .zip e guarde-o no Drive.',
        'Para passar seus dados para outro aparelho (ou do navegador para o app Android), faça a cópia num e restaure no outro.')));
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
