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
// No app Android o arrastar é sempre o do sistema (passa entre janelas do DeX); o arrastar HTML do
// próprio WebView fica desligado, porque ele não leva os dados do app para a outra janela.
export function makeDraggable(el, getPayload) {
  el.classList.add('dragsrc');
  let ready = null, preparing = null;
  const prepare = () => { if (!preparing) preparing = (async () => { ready = await payloadForTransfer(await getPayload()); return ready; })(); return preparing; };
  if (!N) {
    el.setAttribute('draggable', 'true');
    // mouse no navegador: arrastar do próprio navegador (funciona entre janelas)
    el.addEventListener('dragstart', e => {
      if (!ready) { e.preventDefault(); return; }
      e.dataTransfer.setData(MIME, JSON.stringify(ready));
      if (ready.text) e.dataTransfer.setData('text/plain', ready.text);
      e.dataTransfer.effectAllowed = 'copy';
    });
  } else {
    el.setAttribute('draggable', 'false');
    el.addEventListener('dragstart', e => e.preventDefault());
  }
  // mouse (computador, DeX): prepara os dados ao passar por cima, para o arrastar começar na hora
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') prepare(); });
  el.addEventListener('pointerdown', async e => {
    if (e.pointerType === 'mouse' && !N) { prepare(); return; }
    e.preventDefault(); e.stopPropagation();
    if (N && N.startDrag) {
      const t = ready || await prepare();
      const o = Object.assign({}, t); const b64 = o.b64 || ''; delete o.b64;
      let ok = false;
      try { ok = N.startDrag(JSON.stringify(o), b64); } catch (er) { ok = false; }
      if (ok) return;
    }
    customDrag(e, await getPayload());
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
    const editable = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    if (t.includes(MIME) || t.includes('Files') || (t.includes('text/plain') && !editable)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  document.addEventListener('drop', e => {
    const dt = e.dataTransfer; if (!dt) return;
    const raw = dt.getData(MIME);
    if (raw) { e.preventDefault(); window.leitorApp.dropAt(e.clientX, e.clientY, payloadFromTransfer(JSON.parse(raw))); return; }
    const f = [...(dt.files || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); window.leitorApp.dropAt(e.clientX, e.clientY, { kind: 'image', blob: f, title: f.name }); return; }
    // texto comum (de outra janela ou de outro app), fora de um campo de digitação: vira citação
    const t = dt.getData('text/plain');
    const editable = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    if (t && t.trim() && !editable) { e.preventDefault(); window.leitorApp.dropAt(e.clientX, e.clientY, { kind: 'text', text: t.trim() }); }
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
