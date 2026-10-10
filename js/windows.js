// Várias janelas do app (DeX, Windows): mensagens entre elas para ficarem iguais na hora
// e para um link abrir "na outra janela".
const N = window.AndroidBridge || null;
export const winId = Math.random().toString(36).slice(2, 9);
// id -> { at: última vez que foi usada, seen: última vez que deu sinal de vida, vis: está na tela }
// (uma janela fechada à força, minimizada ou esquecida em segundo plano não conta: o link abre aqui)
const peers = new Map();
const seen = new Set();
const waiting = new Map();   // pedidos aguardando resposta (ack)
let bc = null, handler = null, lastUse = Date.now(), lastPing = 0;
const ALIVE_MS = 16000;
const visible = () => document.visibilityState !== 'hidden';

function recv(m) {
  if (!m || m.from === winId || seen.has(m.id)) return;
  seen.add(m.id); if (seen.size > 500) seen.clear();
  const prev = peers.get(m.from) || { at: 0, seen: 0, vis: true };
  if (m.t !== 'bye') peers.set(m.from, { at: Math.max(prev.at, m.at || 0), seen: Date.now(), vis: m.vis !== undefined ? m.vis : prev.vis });
  if (m.t === 'hello' || m.t === 'here' || m.t === 'use') { if (m.t === 'hello') post({ t: 'here' }); return; }
  if (m.t === 'bye') { peers.delete(m.from); return; }
  if (m.to && m.to !== winId) return;
  if (m.t === 'ack') { const w = waiting.get(m.re); if (w) { waiting.delete(m.re); w(true); } return; }
  if (m.needAck) { if (!visible()) return; post({ t: 'ack', to: m.from, re: m.id }); }
  if (handler) handler(m);
}

// manda e espera a outra janela confirmar (se não confirmar, quem chamou faz aqui mesmo)
export function request(m, ms = 1500) {
  m.needAck = true;
  return new Promise(res => {
    post(m);
    waiting.set(m.id, res);
    setTimeout(() => { if (waiting.has(m.id)) { waiting.delete(m.id); res(false); } }, ms);
  });
}

export function post(m) {
  m.from = winId; m.at = lastUse; m.vis = visible(); m.id = winId + '-' + Math.random().toString(36).slice(2, 9);
  if (bc) { try { bc.postMessage(m); } catch (e) {} }
  if (N && N.broadcast) { try { N.broadcast(JSON.stringify(m)); } catch (e) {} }
}

export function initWindows(onMsg) {
  handler = onMsg;
  if ('BroadcastChannel' in window) { bc = new BroadcastChannel('leitor-janelas'); bc.onmessage = e => recv(e.data); }
  window.__winMsg = s => { try { recv(typeof s === 'string' ? JSON.parse(s) : s); } catch (e) {} };
  const used = () => { lastUse = Date.now(); if (lastUse - lastPing > 1500) { lastPing = lastUse; post({ t: 'use' }); } };
  document.addEventListener('pointerdown', used, true);
  addEventListener('focus', used);
  addEventListener('pagehide', () => post({ t: 'bye' }));
  document.addEventListener('visibilitychange', () => post({ t: 'here' }));
  setInterval(() => post({ t: 'here' }), 5000);   // sinal de vida
  post({ t: 'hello' });
}

// a outra janela usada mais recentemente (ou null)
export function otherWindow() {
  let best = null, at = -1;
  const now = Date.now();
  for (const [id, p] of peers) {
    if (now - p.seen > ALIVE_MS) { peers.delete(id); continue; }
    if (p.vis && p.at > at) { best = id; at = p.at; }
  }
  return best;
}
// todas as outras janelas vivas e na tela, da usada mais recentemente para a mais antiga
export function otherWindows() {
  otherWindow();
  return [...peers.entries()].filter(([, p]) => p.vis).sort((a, b) => b[1].at - a[1].at).map(([id]) => id);
}
export function forget(id) { peers.delete(id); }
export function windowCount() { otherWindow(); return peers.size + 1; }

export function openNewWindow(docId) {
  if (N && N.newWindow) { N.newWindow(docId || ''); return true; }
  const u = location.pathname + (docId ? '?doc=' + encodeURIComponent(docId) : '');
  return !!window.open(u, '_blank');
}
