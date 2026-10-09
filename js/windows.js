// Várias janelas do app (DeX, Windows): mensagens entre elas para ficarem iguais na hora
// e para um link abrir "na outra janela".
const N = window.AndroidBridge || null;
export const winId = Math.random().toString(36).slice(2, 9);
const peers = new Map();   // id -> última vez que foi usada
const seen = new Set();
let bc = null, handler = null, lastUse = Date.now(), lastPing = 0;

function recv(m) {
  if (!m || m.from === winId || seen.has(m.id)) return;
  seen.add(m.id); if (seen.size > 500) seen.clear();
  if (m.t === 'hello' || m.t === 'here' || m.t === 'use') { peers.set(m.from, m.at || 0); if (m.t === 'hello') post({ t: 'here' }); return; }
  if (m.t === 'bye') { peers.delete(m.from); return; }
  if (m.to && m.to !== winId) return;
  if (handler) handler(m);
}

export function post(m) {
  m.from = winId; m.at = lastUse; m.id = winId + '-' + Math.random().toString(36).slice(2, 9);
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
  post({ t: 'hello' });
}

// a outra janela usada mais recentemente (ou null)
export function otherWindow() {
  let best = null, at = -1;
  for (const [id, t] of peers) if (t > at) { best = id; at = t; }
  return best;
}
export function windowCount() { return peers.size + 1; }

export function openNewWindow(docId) {
  if (N && N.newWindow) { N.newWindow(docId || ''); return true; }
  const u = location.pathname + (docId ? '?doc=' + encodeURIComponent(docId) : '');
  return !!window.open(u, '_blank');
}
