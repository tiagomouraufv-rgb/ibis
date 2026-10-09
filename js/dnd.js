// Arrastar e soltar: figura recortada ou texto selecionado -> caderno ou texto.
// Dentro da janela (e na tela dividida) o app cuida do arrastar; no app Android o arrastar
// passa pelo sistema, e por isso funciona também entre janelas do DeX (e para outros apps).
import { h, toast } from './util.js';
import { blobToB64, b64ToBytes } from './platform.js';

const N = window.AndroidBridge || null;
const MIME = 'application/x-leitor';

// payload: { kind: 'image'|'text', text, blob?, docId, pageKey, y, title, label }
export async function payloadForTransfer(p) {
  const o = Object.assign({}, p);
  delete o.blob;
  if (p.blob) { o.b64 = await blobToB64(p.blob); o.mime = p.blob.type || 'image/png'; }
  return o;
}
export function payloadFromTransfer(o) {
  if (o && o.b64 && !o.blob) o.blob = new Blob([b64ToBytes(o.b64)], { type: o.mime || 'image/png' });
  return o;
}

// começa a arrastar a partir de um toque/caneta/mouse em "el"
export function makeDraggable(el, getPayload) {
  el.classList.add('dragsrc');
  el.setAttribute('draggable', 'true');
  let ready = null;
  // mouse no navegador: arrastar do próprio navegador (funciona entre janelas)
  el.addEventListener('dragstart', e => {
    if (!ready) { e.preventDefault(); return; }
    e.dataTransfer.setData(MIME, JSON.stringify(ready));
    if (ready.text) e.dataTransfer.setData('text/plain', ready.text);
    e.dataTransfer.effectAllowed = 'copy';
  });
  el.addEventListener('pointerenter', async () => { if (!ready) ready = await payloadForTransfer(await getPayload()); });
  el.addEventListener('pointerdown', async e => {
    if (e.pointerType === 'mouse' && !N) { if (!ready) ready = await payloadForTransfer(await getPayload()); return; }
    e.preventDefault(); e.stopPropagation();
    const p = await getPayload();
    if (N && N.startDrag) {
      const t = await payloadForTransfer(p);
      const b64 = t.b64 || ''; delete t.b64;
      let ok = false;
      try { ok = N.startDrag(JSON.stringify(t), b64); } catch (er) { ok = false; }
      if (ok) return;
    }
    customDrag(e, p);
  });
}

// arrastar feito pelo app (dedo/caneta), dentro da janela
function customDrag(e0, p) {
  const ghost = p.kind === 'image' && p.blob ? h('img.dragghost', { src: URL.createObjectURL(p.blob), alt: '' }) : h('div.dragghost.txt', (p.text || '').slice(0, 90) + ((p.text || '').length > 90 ? '…' : ''));
  document.body.appendChild(ghost);
  document.body.classList.add('dragging');
  const move = (x, y) => { ghost.style.left = (x + 12) + 'px'; ghost.style.top = (y + 12) + 'px'; };
  move(e0.clientX, e0.clientY);
  const mv = e => { e.preventDefault(); move(e.clientX, e.clientY); };
  const end = e => {
    document.removeEventListener('pointermove', mv, true);
    document.removeEventListener('pointerup', end, true);
    document.removeEventListener('pointercancel', cancel, true);
    ghost.remove(); document.body.classList.remove('dragging');
    window.leitorApp.dropAt(e.clientX, e.clientY, p);
  };
  const cancel = () => { document.removeEventListener('pointermove', mv, true); document.removeEventListener('pointerup', end, true); ghost.remove(); document.body.classList.remove('dragging'); };
  document.addEventListener('pointermove', mv, true);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', cancel, true);
}

// soltar vindo do navegador (outra janela) ou de arquivos de imagem
export function bindDrop() {
  document.addEventListener('dragover', e => {
    const t = [...(e.dataTransfer ? e.dataTransfer.types : [])];
    if (t.includes(MIME) || t.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  document.addEventListener('drop', e => {
    const dt = e.dataTransfer; if (!dt) return;
    const raw = dt.getData(MIME);
    if (raw) { e.preventDefault(); window.leitorApp.dropAt(e.clientX, e.clientY, payloadFromTransfer(JSON.parse(raw))); return; }
    const f = [...(dt.files || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); window.leitorApp.dropAt(e.clientX, e.clientY, { kind: 'image', blob: f, title: f.name }); }
  });
  // soltar vindo do sistema Android (outra janela do DeX ou outro app)
  window.__nativeDrop = (x, y, json, b64, mime) => {
    let p = {};
    try { p = json ? JSON.parse(json) : {}; } catch (e) { p = { kind: 'text', text: String(json || '') }; }
    if (b64) { p.kind = 'image'; p.b64 = b64; p.mime = mime || p.mime || 'image/png'; }
    if (!p.kind) p.kind = 'text';
    window.leitorApp.dropAt(x, y, payloadFromTransfer(p));
  };
}

// texto com a fonte (link de volta)
export function sourceLink(p) {
  if (!p.docId) return '';
  return '[' + (p.title || 'fonte') + (p.label ? ', ' + p.label : '') + '](leitor://' + p.docId + '/' + (p.pageKey || '') + (p.y ? '?y=' + Math.round(p.y) : '') + ')';
}
export function quoteMd(p) {
  const q = String(p.text || '').trim().split(/\n+/).map(l => '> ' + l).join('\n');
  const s = sourceLink(p);
  return q + (s ? '\n>\n> — ' + s : '');
}
export function noDrop() { toast('Solte sobre a página de um caderno ou sobre um texto.'); }
