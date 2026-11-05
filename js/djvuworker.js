// Worker do DjVu: decodifica as páginas fora da tela principal (a leitura não trava enquanto a página é desenhada).
// Usa o djvu-rs (WebAssembly, licença MIT). Mensagens:
//   {op:'open', id, bytes}                      -> {pages:[{w, h, dpi}], meta}   (w, h em pixels na resolução do arquivo;
//                                                  meta: sumário e links, do djvumeta.js)
//   {op:'render', id, job, n, dpi, region}      -> {w, h, px}               (px: RGBA; region = [x, y, w, h] em pixels nesse dpi)
//   {op:'text', id, n}                          -> {zones}                  (zonas em pixels a 288 dpi, ou null sem camada de texto)
//   {op:'cancel', job} · {op:'close', id}
import init, { WasmDocument, WasmRenderRequest, WasmPixmap } from '../vendor/djvu-rs/djvu_rs.js';
import { djvuMeta } from './djvumeta.js';

const ready = init();
const docs = new Map();      // id -> WasmDocument
const queue = [];            // trabalhos esperando (renderização é um de cada vez)
const cancelled = new Set();
let running = false;

const reply = (msg, transfer) => self.postMessage(msg, transfer || []);

self.onmessage = e => {
  const m = e.data;
  if (m.op === 'cancel') { cancelled.add(m.job); return; }
  queue.push(m);
  pump();
};

async function pump() {
  if (running) return;
  running = true;
  try {
    await ready;
    while (queue.length) {
      // abrir e fechar passam na frente: o resto é desenho e texto
      let i = queue.findIndex(q => q.op === 'open' || q.op === 'close');
      if (i < 0) i = 0;
      const m = queue.splice(i, 1)[0];
      if (m.job && cancelled.has(m.job)) { cancelled.delete(m.job); reply({ ok: false, job: m.job, cancelled: true }); continue; }
      try { run(m); } catch (err) { reply({ ok: false, job: m.job, error: String(err && err.message || err) }); }
      await new Promise(r => setTimeout(r, 0));   // deixa chegar um "cancelar"
    }
  } catch (err) {
    for (const m of queue.splice(0)) reply({ ok: false, job: m.job, error: 'DjVu: ' + String(err && err.message || err) });
  } finally { running = false; }
}

function run(m) {
  if (m.op === 'open') {
    const u8 = new Uint8Array(m.bytes);
    let meta = null;
    try { meta = djvuMeta(u8); } catch (e) { meta = null; }   // sumário e links (sem eles o livro abre do mesmo jeito)
    const d = WasmDocument.from_bytes(u8);
    docs.set(m.id, d);
    const pages = [];
    for (let i = 0; i < d.page_count(); i++) {
      const p = d.page(i), dpi = p.dpi() || 300;
      pages.push({ w: p.width_at(dpi), h: p.height_at(dpi), dpi });
      p.free();
    }
    reply({ ok: true, job: m.job, pages, meta });
  } else if (m.op === 'close') {
    const d = docs.get(m.id);
    if (d) { try { d.free(); } catch (e) {} docs.delete(m.id); }
    reply({ ok: true, job: m.job });
  } else if (m.op === 'render') {
    const d = docs.get(m.id);
    if (!d) throw new Error('documento DjVu fechado');
    const p = d.page(m.n - 1);
    const req = new WasmRenderRequest(m.dpi);
    if (m.region) req.set_region(m.region[0], m.region[1], m.region[2], m.region[3]);
    const pm = new WasmPixmap();
    p.render_request(req, pm);
    const px = pm.to_bytes();
    const w = pm.width(), h = pm.height();
    pm.free(); req.free(); p.free();
    reply({ ok: true, job: m.job, w, h, px }, [px.buffer]);
  } else if (m.op === 'text') {
    const d = docs.get(m.id);
    if (!d) throw new Error('documento DjVu fechado');
    const p = d.page(m.n - 1);
    let zones = null;
    try { const j = p.text_zones_json(288); if (j) zones = JSON.parse(j); } catch (e) { zones = null; }
    p.free();
    reply({ ok: true, job: m.job, zones });
  }
}
