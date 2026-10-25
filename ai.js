// IA (Gemini ou Claude, com a sua chave guardada só no aparelho), Google Tradutor e metadados por DOI.
import { PROMPTS } from './prompts.js';
import * as S from './store.js';
import { copyText, toast } from './util.js';
import { openExternal, shareText, isAndroidApp } from './platform.js';

const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];

// Modelos do Claude (API da Anthropic) e preços de referência em US$ por milhão de tokens [entrada, saída].
// Valores conferidos em outubro de 2026; confira na página de preços de cada empresa.
export const CLAUDE_MODELS = [
  ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5 — rápido e mais barato'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — equilibrado (recomendado)'],
  ['claude-opus-5-5', 'Claude Opus 5.5 — o mais forte, mais caro'],
];
export function priceOf(model) {
  const m = String(model || '');
  if (/haiku-4-5/.test(m)) return [1, 5];
  if (/sonnet-5-5/.test(m)) return [2, 10];
  if (/opus-5-5/.test(m)) return [4, 20];
  if (/flash-lite/.test(m)) return [0.3, 2.5];
  if (/flash/.test(m)) return [0.75, 3.75];
  if (/gemini.*pro/.test(m)) return [2, 12];
  return null;
}
export function costOf(model, tin, tout) { const p = priceOf(model); return p ? (tin * p[0] + tout * p[1]) / 1e6 : null; }
export function fmtUsd(v) { return v == null ? '' : v < 0.01 ? 'menos de US$ 0,01' : 'US$ ' + v.toFixed(v < 0.1 ? 3 : 2).replace('.', ','); }

async function callClaude(system, user, maxTokens = 4096, signal) {
  const st = await S.settings();
  if (!st.claudeKey) throw new Error('Configure a chave da API do Claude em Configurações → IA (ela fica guardada só neste aparelho).');
  const model = st.claudeModel || 'claude-sonnet-5-5';
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': st.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Sem conexão com o Claude. Verifique a internet.');
  }
  let j = null; try { j = await r.json(); } catch (e) {}
  const msg = j && j.error && j.error.message ? j.error.message : '';
  if (r.status === 401) throw new Error('Chave do Claude recusada. Confira a chave em Configurações → IA.');
  if (r.status === 404) throw new Error('Modelo do Claude indisponível (' + model + '). Escolha outro em Configurações → IA.');
  if (r.status === 429) throw new Error('Limite de uso do Claude atingido. Tente daqui a pouco.');
  if (r.status === 529 || r.status === 503) throw new Error('O Claude está sobrecarregado agora. Tente de novo em instantes.');
  if (r.status === 400 && /credit|balance|billing/i.test(msg)) throw new Error('Sem crédito na conta da API do Claude. Adicione crédito em console.anthropic.com (Billing).');
  if (!r.ok) throw new Error('Erro do Claude (HTTP ' + r.status + ')' + (msg ? ': ' + msg : ''));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  if (!text) throw new Error('Resposta vazia do Claude.');
  const tin = (j.usage && j.usage.input_tokens) || 0, tout = (j.usage && j.usage.output_tokens) || 0;
  return { text, truncated: j.stop_reason === 'max_tokens', model, provider: 'Claude', tin, tout, cost: costOf(model, tin, tout) };
}

// chama a IA escolhida em Configurações
export async function callAI(system, user, maxTokens, signal) {
  const st = await S.settings();
  return st.aiProvider === 'claude' ? callClaude(system, user, maxTokens, signal) : callGemini(system, user, maxTokens, signal);
}
export async function aiName() { const st = await S.settings(); return st.aiProvider === 'claude' ? 'Claude' : 'Gemini'; }

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
    const um = j.usageMetadata || {};
    const tin = um.promptTokenCount || 0, tout = (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
    return { text, truncated: c.finishReason === 'MAX_TOKENS', model, provider: 'Gemini', tin, tout, cost: costOf(model, tin, tout) };
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

// Contexto usado pela IA: o do projeto do documento (se houver) ou o geral das Configurações
export async function contextFor(doc) {
  const st = await S.settings();
  if (doc && doc.projects && doc.projects.length) {
    const projs = await S.projects();
    const ctx = doc.projects.map(id => projs.find(p => p.id === id)).filter(p => p && p.aiContext && p.aiContext.trim()).map(p => p.aiContext.trim());
    if (ctx.length) return ctx.join('\n');
  }
  return st.researchContext || '';
}

export async function runAction(action, selection, docInfo, question, signal, ctx, language) {
  const st = await S.settings();
  const a = PROMPTS.actions[action];
  const vars = { language: language || st.language, document_info: docInfo ? 'Documento: ' + docInfo : '', selection: selection.slice(0, 8000), question: question || '' };
  let system = fill(PROMPTS.system_common, vars) + '\n\n' + fill(a.system_extra, vars);
  if (ctx && action !== 'translate') system += '\n\nContexto do leitor (use para escolher exemplos e o que destacar, sem inventar nada): ' + ctx;
  return callAI(system, fill(a.user_template, vars), 2500, signal);
}

// Resumo das anotações de um documento ou projeto (não envia o PDF inteiro, só o que você marcou)
export async function briefing(title, material, signal, ctx) {
  const st = await S.settings();
  const vars = { language: st.language, research_context: ctx || st.researchContext, title, material: material.slice(0, 60000) };
  return callAI(fill(PROMPTS.briefing.system, vars), fill(PROMPTS.briefing.user_template, vars), 6000, signal);
}

// Resumo de uma seção/capítulo a partir do texto do PDF (para livros e artigos longos)
export async function sectionSummary(docTitle, section, text, signal, ctx) {
  const st = await S.settings();
  const system = 'Você prepara resumos de leitura científica para um pesquisador de Física. Responda em ' + st.language + '.\n' +
    'Você recebe o texto extraído do PDF (pode ter hifenização quebrada e símbolos corrompidos; reconstrua com cuidado e diga quando supôs algo) de UMA seção ou capítulo.\n' +
    'Regras: afirme só o que está no texto; não invente valores, referências nem resultados. Use Markdown leve (### títulos, listas com -, **negrito**) e equações em LaTeX ($...$ ou $$...$$). Seja denso (no máximo ~350 palavras).\n' +
    'Estrutura: ### Ideia central (1–2 frases)\n### Pontos principais (lista)\n### Equações e grandezas importantes (se houver)\n### Para lembrar (1–3 itens)' +
    (ctx ? '\nContexto do leitor (use para destacar o que interessa, sem inventar): ' + ctx : '');
  const user = 'Documento: ' + docTitle + '\nSeção: ' + section + '\n\nTexto da seção:\n<<<\n' + text.slice(0, 90000) + '\n>>>';
  return callAI(system, user, 1800, signal);
}

// Google Tradutor no navegador (até ~5000 caracteres)
export async function googleTranslate(text) {
  const st = await S.settings();
  const t = text.slice(0, 4900);
  openExternal('https://translate.google.com/?sl=auto&tl=' + encodeURIComponent(st.translateTo || 'pt') + '&text=' + encodeURIComponent(t) + '&op=translate');
}

// Levar ao Claude: usa o menu Compartilhar do Android; se não houver, copia e abre o claude.ai
export async function sendToClaude(prompt) {
  if (isAndroidApp) { shareText(prompt); return 'share'; }
  try {
    if (navigator.share) { await navigator.share({ text: prompt }); return 'share'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  await copyText(prompt);
  toast('Pergunta copiada. Cole no Claude.');
  openExternal('https://claude.ai/new');
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
