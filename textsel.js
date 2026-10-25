// Seleção de texto estável (adaptado do visualizador oficial do pdf.js).
// Sem isto, ao arrastar por um espaço entre palavras a seleção "pula" até o fim da página.
const layers = new Map();   // div.textLayer -> div.endOfContent
let bound = false;

function reset(end, layer) {
  layer.append(end);
  end.style.width = '';
  end.style.height = '';
  layer.classList.remove('selecting');
}

export function registerTextLayer(layer, end) {
  layers.set(layer, end);
  layer.addEventListener('pointerdown', () => layer.classList.add('selecting'));
  layer.addEventListener('mousedown', () => layer.classList.add('selecting'));
  bind();
}

export function unregisterTextLayer(layer) { layers.delete(layer); }

function bind() {
  if (bound) return;
  bound = true;
  let down = false;
  document.addEventListener('pointerdown', () => { down = true; });
  document.addEventListener('pointerup', () => { down = false; layers.forEach(reset); });
  window.addEventListener('blur', () => { down = false; layers.forEach(reset); });
  document.addEventListener('keyup', () => { if (!down) layers.forEach(reset); });
  let prevRange = null;
  document.addEventListener('selectionchange', () => {
    for (const l of [...layers.keys()]) if (!l.isConnected) layers.delete(l);
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) { layers.forEach(reset); return; }
    const active = new Set();
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      for (const l of layers.keys()) if (!active.has(l) && r.intersectsNode(l)) active.add(l);
    }
    for (const [l, end] of layers) { if (active.has(l)) l.classList.add('selecting'); else reset(end, l); }
    const range = sel.getRangeAt(0);
    const modifyStart = prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    const layer = anchor.parentElement && anchor.parentElement.closest('.textLayer');
    const end = layers.get(layer);
    if (end && anchor.parentElement) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    }
    prevRange = range.cloneRange();
  });
}
