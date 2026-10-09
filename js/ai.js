// IA (Gemini, com a sua chave guardada só no aparelho), Google Tradutor, Claude e metadados por DOI.
import { PROMPTS } from './prompts.js';
import * as S from './store.js';
import { copyText, toast } from './util.js';

const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];

function fill(t, vars) { return String(t).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] !== undefined ? vars[k] : ''); }

async function callGemini(system, user, maxTokens = 4096, signal) {
  const st = await S.settings();
  if (!st.geminiKey) throw new Error('Configure a chave do Gemini em Configurações (ela fica guardada só neste aparelho).');
  const models = [st.geminiModel].concat(FALLBACKS.filter(m => m !== st.geminiModel));
  let lastErr = null;
  for (const model of models) {
    let r;
    try {
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': st.geminiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Sem conexão com o Gemini. Verifique a internet.');
    }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 404 || (r.status === 400 && j && j.error && /model/i.test(j.error.message || ''))) { lastErr = new Error('Modelo indisponível: ' + model); continue; }
    if (r.status === 401 || r.status === 403) throw new Error('Chave do Gemini recusada (HTTP ' + r.status + '). Confira a chave em Configurações.');
    if (r.status === 429) throw new Error('Limite de uso do Gemini atingido (HTTP 429). Tente mais tarde.');
    if (!r.ok) throw new Error('Erro do Gemini (HTTP ' + r.status + ')' + (j && j.error ? ': ' + j.error.message : ''));
    const c = (j.candidates || [])[0];
    if (!c) throw new Error('O Gemini não retornou resposta' + (j.promptFeedback && j.promptFeedback.blockReason ? ' (bloqueio: ' + j.promptFeedback.blockReason + ')' : '') + '.');
    const text = ((c.content && c.content.parts) || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('\n').trim();
    if (!text) throw new Error('Resposta vazia do Gemini.');
    if (model !== st.geminiModel) S.setSettings({ geminiModel: model });
    return { text, truncated: c.finishReason === 'MAX_TOKENS', model };
  }
  throw lastErr || new Error('Nenhum modelo do Gemini disponível.');
}

export const AI_ACTIONS = [
  { id: 'explain', label: 'Explicar' },
  { id: 'physics', label: 'Explicação física' },
  { id: 'translate', label: 'Traduzir (IA)' },
  { id: 'summarize', label: 'Resumir' },
  { id: 'equation', label: 'Explicar equação' },
  { id: 'ask', label: 'Perguntar…' },
];

export async function runAction(action, selection, docInfo, question, signal) {
  const st = await S.settings();
  const a = PROMPTS.actions[action];
  const vars = { language: st.language, document_info: docInfo ? 'Documento: ' + docInfo : '', selection: selection.slice(0, 8000), question: question || '' };
  const system = fill(PROMPTS.system_common, vars) + '\n\n' + fill(a.system_extra, vars);
  return callGemini(system, fill(a.user_template, vars), 2500, signal);
}

// Resumo das anotações de um documento ou projeto (não envia o PDF inteiro, só o que você marcou)
export async function briefing(title, material, signal) {
  const st = await S.settings();
  const vars = { language: st.language, research_context: st.researchContext, title, material: material.slice(0, 60000) };
  return callGemini(fill(PROMPTS.briefing.system, vars), fill(PROMPTS.briefing.user_template, vars), 6000, signal);
}

// Google Tradutor no navegador (até ~5000 caracteres)
export async function googleTranslate(text) {
  const st = await S.settings();
  const t = text.slice(0, 4900);
  window.open('https://translate.google.com/?sl=auto&tl=' + encodeURIComponent(st.translateTo || 'pt') + '&text=' + encodeURIComponent(t) + '&op=translate', '_blank', 'noopener');
}

// Levar ao Claude: usa o menu Compartilhar do Android; se não houver, copia e abre o claude.ai
export async function sendToClaude(prompt) {
  try {
    if (navigator.share) { await navigator.share({ text: prompt }); return 'share'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  await copyText(prompt);
  toast('Pergunta copiada. Cole no Claude.');
  window.open('https://claude.ai/new', '_blank', 'noopener');
  return 'copy';
}

// ---------- metadados pelo DOI (Crossref) ----------
export function findDoi(text) {
  const m = String(text || '').match(/\b(10\.\d{4,9}\/[^\s"<>]+)/i);
  if (!m) return '';
  return m[1].replace(/[.,;)\]]+$/, '');
}

export async function crossref(doi) {
  const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi));
  if (!r.ok) throw new Error(r.status === 404 ? 'DOI não encontrado no Crossref.' : 'Erro ao consultar o Crossref (HTTP ' + r.status + ').');
  const m = (await r.json()).message;
  const yr = (m.issued && m.issued['date-parts'] && m.issued['date-parts'][0] && m.issued['date-parts'][0][0]) || '';
  return {
    doi, title: (m.title || [''])[0] || '', journal: (m['container-title'] || [''])[0] || '', year: String(yr),
    volume: m.volume || '', issue: m.issue || '', pages: m.page || m['article-number'] || '',
    authors: (m.author || []).map(a => ({ given: a.given || '', family: a.family || a.name || '' })),
    publisher: m.publisher || '',
  };
}

export function abnt(meta) {
  const au = (meta.authors || []);
  const name = a => (a.family || '').toUpperCase() + (a.given ? ', ' + a.given : '');
  let autores = au.length > 3 ? name(au[0]) + ' et al.' : au.map(name).join('; ');
  const parts = [];
  if (autores) parts.push(autores + '.');
  if (meta.title) parts.push(meta.title + '.');
  let src = meta.journal || '';
  const vol = [meta.volume ? 'v. ' + meta.volume : '', meta.issue ? 'n. ' + meta.issue : '', meta.pages ? 'p. ' + meta.pages : '', meta.year].filter(Boolean).join(', ');
  if (src || vol) parts.push([src, vol].filter(Boolean).join(', ') + '.');
  if (meta.doi) parts.push('DOI: https://doi.org/' + meta.doi + '.');
  return parts.join(' ');
}

export function bibtex(meta) {
  const first = (meta.authors && meta.authors[0] && meta.authors[0].family) || 'autor';
  const key = (first + (meta.year || '')).normalize('NFD').replace(/[^A-Za-z0-9]/g, '');
  const f = (k, v) => v ? `  ${k} = {${v}},\n` : '';
  return `@article{${key},\n` + f('author', (meta.authors || []).map(a => `${a.family}, ${a.given}`).join(' and ')) + f('title', meta.title) + f('journal', meta.journal)
    + f('year', meta.year) + f('volume', meta.volume) + f('number', meta.issue) + f('pages', meta.pages) + f('doi', meta.doi) + '}';
}
