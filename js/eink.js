// E-ink (Boox Go 7 P&B e Color): virar a página em vez de rolar, atualizar a tela de tempos em tempos,
// zonas de toque e a caneta rápida da Onyx (experimental, só no app Android numa Boox).
import * as S from './store.js';
import { h, toast } from './util.js';

const N = window.AndroidBridge || null;
export const isEink = () => !!document.documentElement.dataset.eink;

// ---------- atualização completa da tela (tira os "fantasmas" do e-ink) ----------
let turns = 0;
export async function afterTurn() {
  if (!isEink()) return;
  const n = +((await S.settings()).einkRefresh || 0);
  if (!n) return;
  if (++turns >= n) { turns = 0; flash(); }
}
export function flash() {
  const f = h('div.einkflash');
  document.body.appendChild(f);
  setTimeout(() => { f.classList.add('w'); setTimeout(() => f.remove(), 110); }, 110);
}

// ---------- virar a "página da tela" ----------
// rolável comum (texto, modo artigo): avança uma tela, repetindo uma linha
export function turnScroller(el, dir, overlap = 40) {
  const before = el.scrollTop;
  el.scrollTop = before + dir * Math.max(80, el.clientHeight - overlap);
  const moved = Math.abs(el.scrollTop - before) > 1;
  if (moved) afterTurn();
  return moved;
}

// leitor de PDF/caderno: desce a página atual em telas; no fim dela vai para o topo da próxima.
// Com zoom maior que a tela (modo colunas), percorre faixa por faixa: coluna da esquerda, depois a da direita.
export function turnViewer(v, dir) {
  const sc = v.scroller, H = sc.clientHeight, W = sc.clientWidth, ov = 28;
  const slots = [...v.slots.values()];
  if (!slots.length) return false;
  const top = sc.scrollTop;
  let i = slots.findIndex(s => s.wrap.offsetTop + s.wrap.offsetHeight > top + 2);
  if (i < 0) i = slots.length - 1;
  const s = slots[i];
  const sTop = s.wrap.offsetTop, sBot = sTop + s.wrap.offsetHeight;
  const left0 = s.wrap.offsetLeft, wide = s.wrap.offsetWidth > W + 4;
  const colR = left0 + s.wrap.offsetWidth - W;
  const step = v.columns ? colR - left0 : W - ov;
  const L = sc.scrollLeft;
  if (dir > 0) {
    // o que falta da página é só uma faixa pequena (margem): vai direto para a próxima
    if (sBot - (top + H) > Math.max(4, H * 0.12)) sc.scrollTop = Math.min(top + H - ov, sBot - H);
    else if (wide && L < colR - 4) { sc.scrollLeft = Math.min(L + step, colR); sc.scrollTop = sTop; }
    else if (i + 1 < slots.length) { const n = slots[i + 1]; sc.scrollTop = n.wrap.offsetTop; sc.scrollLeft = n.wrap.offsetWidth > W + 4 ? n.wrap.offsetLeft : 0; }
    else return false;
  } else {
    if (top - sTop > Math.max(4, H * 0.12)) sc.scrollTop = Math.max(top - H + ov, sTop);
    else if (wide && L > left0 + 4) { sc.scrollLeft = Math.max(L - step, left0); sc.scrollTop = Math.max(sTop, sBot - H); }
    else if (i > 0) {
      const p = slots[i - 1];
      sc.scrollTop = Math.max(p.wrap.offsetTop, p.wrap.offsetTop + p.wrap.offsetHeight - H);
      sc.scrollLeft = p.wrap.offsetWidth > W + 4 ? p.wrap.offsetLeft + p.wrap.offsetWidth - W : 0;
    } else return false;
  }
  afterTurn();
  return true;
}

// zonas de toque: terço esquerdo volta, terço direito avança, o meio não faz nada
export function tapZone(el, x) {
  const r = el.getBoundingClientRect();
  const f = (x - r.left) / Math.max(1, r.width);
  return f < 0.3 ? -1 : f > 0.7 ? 1 : 0;
}
// deslizar o dedo: para a esquerda ou para cima avança
export function swipeDir(dx, dy) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return 0;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : -1) : (dy < 0 ? 1 : -1);
}

// botões de página do aparelho (e os de volume, se ligado) — o Android avisa o app
export async function syncPageKeys() {
  if (!N || !N.setPageKeys) return;
  const st = await S.settings();
  try { N.setPageKeys(true, isEink() && st.einkVolumeKeys !== false); } catch (e) {}
}

// ---------- caneta rápida da Onyx ----------
// Enquanto a caneta, o marca-texto ou a borracha estão escolhidos, a área das páginas é entregue à Boox,
// que desenha o traço na hora. No fim de cada traço os pontos chegam em window.__fastInk.
const BLOCKERS = '.modal-back, .popmenu, .article-view, .recentbar, .lookpop, .refpop, .tablepick';
const FLOATERS = '.selmenu, .pill, .fmtbar, .floatplayer, .ttsbar, .rtop';
export const fastPen = {
  on: false, failed: false, reader: null,
  supported() {
    if (this.failed || !N || !N.penSupported) return false;
    try { return !!N.penSupported(); } catch (e) { return false; }
  },
  async update(reader) {
    if (reader) this.reader = reader;
    const r = this.reader;
    const st = await S.settings();
    const want = !!(r && isEink() && st.fastPen !== false && this.supported() && r.root.isConnected && r.active && r.doc &&
      ['pen', 'marker', 'eraser'].includes(r.tool) && !document.querySelector(BLOCKERS) && document.visibilityState === 'visible');
    if (!want) { if (this.on) { try { N.penStop(); } catch (e) {} this.on = false; this.last = ''; } return; }
    const v = r.active, rc = v.scroller.getBoundingClientRect();
    const ex = [...document.querySelectorAll(FLOATERS)].filter(e => e.offsetParent || getComputedStyle(e).position === 'fixed')
      .map(e => e.getBoundingClientRect()).filter(b => b.width && b.height && b.bottom > rc.top && b.top < rc.bottom && b.right > rc.left && b.left < rc.right)
      .map(b => [b.left, b.top, b.right, b.bottom]);
    const w = (r.tool === 'marker' ? 11 : (st.penWidth || 2)) * v.scale;
    const json = JSON.stringify({ l: Math.round(rc.left), t: Math.round(rc.top), r: Math.round(rc.right), b: Math.round(rc.bottom), ex: ex.map(q => q.map(Math.round)), w: +w.toFixed(1) });
    if (this.on && json === this.last) return;   // nada mudou: não reinicia a caneta (deixava a Boox lenta)
    try { N.penStart(json); this.on = true; this.last = json; } catch (e) { this.fail(String(e)); }
  },
  fail(msg) {
    this.failed = true; this.on = false;
    console.warn('caneta rápida', msg);
    toast('A caneta rápida da Boox não funcionou neste aparelho; usando a caneta comum.', 5000);
  },
};

let mo = null, upT = null;
export function initFastPen(app) {
  if (!N || !N.penSupported) return;
  const schedule = () => { clearTimeout(upT); upT = setTimeout(() => fastPen.update(), 60); };
  window.__fastInk = json => {
    let o; try { o = JSON.parse(json); } catch (e) { return; }
    const r = fastPen.reader;
    if (r && r.active && r.active.fastStroke) r.active.fastStroke(o);
  };
  window.__fastPenFailed = msg => fastPen.fail(msg);
  window.__fastPenResume = schedule;
  mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true });
  S.on('settings', schedule);
  S.on('form', schedule);
  addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  fastPen.reader = app.readers[0];
}

// ---------- GIF parado no e-ink (animação no e-ink só borra a tela) ----------
const stills = new Map();   // url do arquivo -> Promise<url da imagem parada | null>
export function freezeIfGif(img) {
  if (!isEink()) return;
  const src = img.getAttribute('src') || '';
  if (!src.startsWith('blob:')) return;
  if (!stills.has(src)) {
    stills.set(src, (async () => {
      try {
        const b = await (await fetch(src)).blob();
        if (b.type !== 'image/gif') return null;
        const bmp = await createImageBitmap(b);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        return c.toDataURL('image/png');
      } catch (e) { return null; }
    })());
  }
  stills.get(src).then(u => { if (u && img.getAttribute('src') === src) { img.src = u; img.title = 'GIF parado (modo e-ink)'; } });
}
