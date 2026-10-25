// Receber do reMarkable pela pasta do Syncthing.
// No reMarkable, o RM2 Notas (0.10+) grava sozinho, para cada documento que saiu deste app pelo
// "Enviar ao reMarkable", um arquivo leitor-<documento>.json com as notas digitadas lá (notas, destaques
// com citação) e os trechos do RM2 Digest. O Syncthing leva o arquivo ao PC e ao tablet; aqui o app lê a
// pasta (escolhida uma vez) e junta tudo ao documento original:
// - nota adesiva -> nota no mesmo ponto; nota com citação -> destaque no trecho (achado pelo texto) com a nota;
// - notas que tinham saído do app e foram editadas lá -> atualizam a original (se ela não mudou aqui;
//   se mudou dos dois lados, os dois textos ficam, um embaixo do outro);
// - nota apagada lá -> some daqui (se não foi mexida aqui); apagada aqui -> não volta;
// - Digest: trechos novos entram, editados lá são atualizados.
// Os códigos das anotações criadas são fixos (derivados do arquivo), então receber de novo, ou receber em
// dois aparelhos sincronizados pelo Drive, não duplica nada.
import * as S from './store.js';
import { db } from './db.js';
import { toast } from './util.js';
import { nativeCall as native } from './platform.js';

const N = window.AndroidBridge || null;
const ANDROID = !!(N && typeof N.syncReadFiles === 'function');
const KV_DIR = 'rmSyncDir', KV_SEEN = 'rmSyncSeen';

// ---------------- pasta ----------------
export function rmSyncSupported() { return ANDROID || typeof window.showDirectoryPicker === 'function'; }

export async function rmSyncFolderName() {
  if (ANDROID) { try { return N.syncFolderName() || ''; } catch (e) { return ''; } }
  const hnd = await db.kvGet(KV_DIR, null);
  return hnd && hnd.name ? hnd.name : '';
}

export async function pickRmSyncFolder() {
  if (ANDROID) {
    const r = await native('syncPickFolder');
    if (!r.ok) { if (r.msg !== 'Cancelado.') toast(r.msg, 5000); return ''; }
    await db.kvSet(KV_SEEN, {});
    S.emit('rmSyncFolder', r.msg);
    return r.msg;
  }
  if (typeof window.showDirectoryPicker !== 'function') { toast('Este navegador não deixa escolher pastas. Use o Chrome ou o Edge.', 6000); return ''; }
  let hnd;
  try { hnd = await window.showDirectoryPicker({ id: 'leitor-rm-sync', mode: 'readwrite' }); }
  catch (e) { return ''; }
  await db.kvSet(KV_DIR, hnd);
  await db.kvSet(KV_SEEN, {});
  S.emit('rmSyncFolder', hnd.name);
  return hnd.name;
}

export async function forgetRmSyncFolder() {
  if (ANDROID) { try { N.syncForget(); } catch (e) { } }
  await db.kvSet(KV_DIR, null);
  await db.kvSet(KV_SEEN, {});
  S.emit('rmSyncFolder', '');
}

// [{name, text}] ou null (sem pasta ou sem permissão). interactive: pode pedir permissão (precisa de um toque)
export async function readRmSyncFiles(interactive) {
  if (ANDROID) {
    if (!N.syncFolderName()) return null;
    const r = await native('syncReadFiles');
    if (!r.ok) throw new Error(r.msg);
    return JSON.parse(r.msg);
  }
  const hnd = await db.kvGet(KV_DIR, null);
  if (!hnd || typeof hnd.queryPermission !== 'function') return null;
  let perm = await hnd.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted' && interactive) { try { perm = await hnd.requestPermission({ mode: 'readwrite' }); } catch (e) { } }
  if (perm !== 'granted') { perm = await hnd.queryPermission({ mode: 'read' }); if (perm !== 'granted' && interactive) perm = await hnd.requestPermission({ mode: 'read' }); }
  if (perm !== 'granted') return null;
  const out = [];
  for await (const [name, ent] of hnd.entries()) {
    if (ent.kind !== 'file' || !/^leitor-.*\.json$/.test(name)) continue;
    const f = await ent.getFile();
    if (f.size > 20 * 1024 * 1024) continue;
    out.push({ name, text: await f.text() });
  }
  return out;
}

// ---------------- junção ----------------
export function hash(s) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; b ^= b >>> 13;
  }
  return a.toString(36) + b.toString(36);
}

export function parseReturn(text) {
  let o; try { o = JSON.parse(text); } catch (e) { return null; }
  if (o && o.app === 'rm2-notas' && o.kind === 'leitor-ink' && o.doc && o.doc.id && o.rmDoc && o.key) return o;
  if (!o || o.app !== 'rm2-notas' || o.kind !== 'leitor-return' || !o.doc || !o.doc.id || !o.rmDoc) return null;
  if (!Array.isArray(o.notes)) o.notes = [];
  if (!Array.isArray(o.digest)) o.digest = [];
  return o;
}

const CONFLICT = '\n\n— editado no reMarkable —\n';
const str = v => (v === undefined || v === null) ? '' : String(v);
const textField = a => a.kind === 'hl' ? 'note' : a.kind === 'note' ? 'text' : null;
const dgSig = it => JSON.stringify([str(it.note), (it.tags || []).slice().sort()]);

// trecho -> retângulos na página (texto do pdf.js); procura ignorando espaços; prefere a ocorrência mais
// perto da altura yHint (a altura da nota no reMarkable)
export function quoteRects(items, toView, quote, yHint) {
  const strip = s => s.replace(/[\s­]+/g, '').toLowerCase();
  const q = strip(quote);
  if (q.length < 3) return null;
  let full = ''; const owner = [];
  items.forEach((it, k) => { const t = strip(it.str || ''); for (let i = 0; i < t.length; i++) owner.push(k); full += t; });
  const hits = [];
  let at = full.indexOf(q);
  if (at >= 0) { while (at >= 0) { hits.push([at, at + q.length]); at = full.indexOf(q, at + 1); } }
  else if (q.length > 40) {
    // citação longa que não bate inteira (hifenização, ligaduras): começo e fim
    const hd = q.slice(0, 24), tl = q.slice(-24);
    let s = full.indexOf(hd);
    while (s >= 0) { const e = full.indexOf(tl, s + hd.length); if (e >= 0 && e - s < q.length * 1.5) hits.push([s, e + tl.length]); s = full.indexOf(hd, s + 1); }
  }
  if (!hits.length) return null;
  const geo = k => {
    const it = items[k];
    const [x0, y0] = toView(it.transform[4], it.transform[5]);
    const fs = Math.hypot(it.transform[2], it.transform[3]) || 10;
    return { x: x0, top: y0 - fs * 0.85, h: fs * 1.15, w: it.width || 0, n: strip(it.str || '').length || 1 };
  };
  let best = null, bestD = Infinity;
  for (const [s, e] of hits) {
    const g = geo(owner[s]);
    const d = yHint === undefined ? 0 : Math.abs(g.top + g.h / 2 - yHint);
    if (d < bestD) { bestD = d; best = [s, e]; }
  }
  const [s, e] = best;
  const lines = [];
  for (let k = owner[s]; k <= owner[e - 1]; k++) {
    const g = geo(k);
    let first = 0, last = g.n;
    const startIdx = owner.indexOf(k);
    if (startIdx < 0) continue;
    if (k === owner[s]) first = s - startIdx;
    if (k === owner[e - 1]) last = e - startIdx;
    const x = g.x + g.w * first / g.n, w = g.w * (last - first) / g.n;
    const ln = lines.find(l => Math.abs(l.top - g.top) < g.h * 0.5);
    if (ln) { const r = Math.max(ln.x + ln.w, x + w); ln.x = Math.min(ln.x, x); ln.w = r - ln.x; ln.h = Math.max(ln.h, g.h); }
    else lines.push({ x, top: g.top, w, h: g.h });
  }
  const rects = lines.filter(l => l.w > 0.5).map(l => [+l.x.toFixed(2), +l.top.toFixed(2), +l.w.toFixed(2), +l.h.toFixed(2)]);
  return rects.length ? rects : null;
}

// Junta um arquivo de volta. Devolve contagens.
export async function applyReturn(ret) {
  const out = { doc: null, added: 0, updated: 0, removed: 0, conflicts: 0, digest: 0, skipped: 0 };
  const doc = await S.getDoc(ret.doc.id);
  if (!doc || doc.kind === 'notebook') return out;
  out.doc = doc;
  const tombs = await S.tombs();
  const now = new Date().toISOString();
  const isText = doc.kind === 'text';

  // ---- notas ----
  let list = [], hd = null;
  if (!isText) {
    const { openPdf, pageList } = await import('./pdfdoc.js');
    hd = await openPdf(doc);
    list = rmPages(doc, pageList(doc, hd));
  }
  const anns = isText ? [] : (await S.annots(doc.id)).slice();
  const puts = [], dels = [], dgNotes = [];
  const seen = new Set();
  const pageCache = new Map();
  const pageText = async p => {
    if (pageCache.has(p.key)) return pageCache.get(p.key);
    let r = null;
    if (p.kind === 'pdf') {
      const { getPage } = await import('./pdfdoc.js');
      const pg = await getPage(hd, p.n);
      const vp = pg.getViewport({ scale: 1 });
      try { const tc = await pg.getTextContent(); r = { items: tc.items, toView: (x, y) => vp.convertToViewportPoint(x, y) }; } catch (e) { r = null; }
    }
    pageCache.set(p.key, r);
    return r;
  };

  // estado de sincronização de cada anotação ligada: a.rs = { doc (documento no reMarkable), id (nota lá),
  // in (versão de lá já vista aqui), base (último texto em que os dois lados concordavam), pos }
  const syncOf = (a, n) => {
    if (a.rs && a.rs.doc === ret.rmDoc) return a.rs;
    if (a.rmDoc === ret.rmDoc && a.rmText !== undefined) return { doc: ret.rmDoc, id: n.id, in: a.rmIn, base: a.rmText };   // 1.4
    if (n.ext && a.rmIn !== undefined && a.rmText !== undefined) return { doc: ret.rmDoc, id: n.id, in: a.rmIn, base: a.rmText };
    return null;
  };
  const near = (p, q) => !!p && !!q && Math.abs(p.x - q.x) <= 3 && Math.abs(p.y - q.y) <= 3;
  // junção de três vias (texto e posição) para uma anotação que já existe aqui
  const merge = (a, n, text) => {
    const fld = textField(a);
    if (!fld) return false;
    const rs = syncOf(a, n);
    if (rs && rs.in === n.updated) return false;          // esta versão de lá já foi vista
    const L = str(a[fld]);
    // sem base guardada: se lá não mexeram desde que chegou, a base é o texto de lá; se aqui não mexeram, o daqui
    const B = rs ? str(rs.base) : (n.ext && str(n.extAt) !== '' && n.updated === n.extAt ? text : (n.ext && String(a.updated) === str(n.extUpd) ? L : undefined));
    const rmSaw = !!n.ext && str(n.extUpd) !== '' && str(n.extUpd) === String(a.updated);   // lá já tinham a versão daqui
    let base = B;
    if (text === L) base = L;
    else if ((B !== undefined && L === B) || rmSaw) { a[fld] = text; base = text; out.updated++; }
    else if (B !== undefined && text === B) { /* só mudou aqui: fica; lá recebem a daqui */ }
    else { a[fld] = L + CONFLICT + text; out.conflicts++; }
    let pos = rs && rs.pos;
    if (a.kind === 'note' && n.x !== undefined) {
      const here = { x: +a.x || 0, y: +a.y || 0 }, there = { x: +n.x, y: +n.y };
      if (near(here, there)) pos = there;
      else if ((pos && near(here, pos)) || rmSaw || !rs) { a.x = there.x; a.y = there.y; pos = there; if (text === L) out.updated++; }
    }
    a.rs = { doc: ret.rmDoc, id: n.id, in: n.updated, base: base === undefined ? '' : base, pos: pos || null };
    delete a.rmIn; delete a.rmText;
    puts.push(a);
    return true;
  };
  // nota à mão: um link na página da nota que leva à página com a escrita (que chega no arquivo da página)
  const handNote = n => {
    const id = 'rm' + hash(ret.rmDoc + '/' + n.id);
    seen.add(id);
    const p = list[n.page];
    if (!p || tombs[id]) return;
    const blank = 'rmh' + hash(ret.rmDoc + '/' + str(n.target));
    const x = Math.max(4, Math.min(p.w - 22, +n.x || 0)), y = Math.max(4, Math.min(p.h - 22, +n.y || 0));
    const label = str(n.text).trim() ? '✍ ' + str(n.text).trim() : '✍ Nota à mão';
    const a = anns.find(q => q.id === id);
    const want = { id, kind: 'link', docId: doc.id, pageKey: p.key, rects: [[x - 9, y - 9, 18, 18]], text: label, target: { type: 'page', docId: doc.id, pageKey: 'b' + blank, y: 0 }, targetLabel: 'Nota à mão (reMarkable)', rmDoc: ret.rmDoc, rmHandLink: true };
    if (a && a.kind === 'link' && JSON.stringify([a.rects, a.text, a.target]) === JSON.stringify([want.rects, want.text, want.target])) return;
    if (a) want.created = a.created; else out.added++;
    puts.push(want);
  };
  // ligações feitas no reMarkable para outros documentos que também estão no app
  const linkNotes = n => {
    if (n.ext) { const src = anns.find(q => q.id === n.ext); if (src && src.kind === 'link') return; }   // a ligação nasceu aqui
    const p = list[n.page];
    if (!p) return;
    (n.links || []).forEach((l, i) => {
      if (!l || !l.app) return;
      const id = 'rl' + hash(ret.rmDoc + '/' + n.id + '/' + l.app);
      seen.add(id);
      if (tombs[id]) return;
      const x = Math.max(4, Math.min(p.w - 22, (+n.x || 0) + 12 + 20 * i)), y = Math.max(4, Math.min(p.h - 22, +n.y || 0));
      const want = { id, kind: 'link', docId: doc.id, pageKey: p.key, rects: [[x - 8, y - 8, 16, 16]], text: '→ ' + str(l.name), target: { type: 'page', docId: l.app, pageKey: 'p1', y: 0 }, targetLabel: str(l.name), rmDoc: ret.rmDoc, rmLink: true };
      const a = anns.find(q => q.id === id);
      if (a && JSON.stringify([a.rects, a.text, a.target]) === JSON.stringify([want.rects, want.text, want.target])) return;
      if (a) want.created = a.created; else out.added++;
      puts.push(want);
    });
  };
  for (const x of (ret.others || [])) { if (x.ext) seen.add(x.ext); if (x.id) { const id0 = 'rm' + hash(ret.rmDoc + '/' + x.id); seen.add(id0); seen.add(id0 + 'q'); } }
  for (const n of ret.notes) {
    const text = str(n.text), quote = str(n.quote);
    if (!isText) linkNotes(n);
    if (n.ext) {
      // nota que saiu do app (ou que voltou dele): a original é esta anotação
      seen.add(n.ext);
      const a = anns.find(x => x.id === n.ext);
      if (a) merge(a, n, text);
      continue;
    }
    if (n.kind === 'hand') { if (!isText) handNote(n); continue; }
    if (!text && !quote) continue;
    const id = 'rm' + hash(ret.rmDoc + '/' + n.id);
    seen.add(id); seen.add(id + 'q');
    if (isText) { dgNotes.push({ id: 'Drm' + hash(ret.rmDoc + '/' + n.id), quote, note: text, created: n.created, updated: n.updated }); continue; }
    const p = list[n.page];
    // nota com citação que foi movida, no reMarkable, para dentro da página (fora da margem): o trecho
    // fica destacado e a nota fica onde você a pôs lá, como adesiva
    const placed = !!(p && text && quote && n.x > 40 && n.x < p.w - 40);
    const rsNew = t => ({ doc: ret.rmDoc, id: n.id, in: n.updated, base: t, pos: { x: +n.x, y: +n.y } });
    const sticky = (x, y, t) => ({ id, kind: 'note', docId: doc.id, pageKey: p.key, x: Math.max(6, Math.min(p.w - 20, +x || 0)), y: Math.max(6, Math.min(p.h - 20, +y || 0)), text: t, rmDoc: ret.rmDoc, rs: rsNew(t), created: Date.now() });
    const a = anns.find(x => x.id === id);
    if (a) {
      // 1.4.0 guardava esta nota no destaque; agora ela vai para o ponto em que está no reMarkable
      const rs = syncOf(a, n);
      if (placed && a.kind === 'hl' && rs && str(a.note) === str(rs.base)) {
        const c = Object.assign({}, a, { id: id + 'q', note: '' }); delete c.rs; delete c.rmIn; c.rmText = '';
        puts.push(c);
        puts.push(sticky(n.x, n.y, text));
        out.updated++;
        continue;
      }
      merge(a, n, text);
      continue;
    }
    if (tombs[id]) continue;   // apagada aqui: não volta (e o reMarkable fica sabendo pelo arquivo do app)
    if (!p) { out.skipped++; continue; }
    let made = null;
    if (quote) {
      const pt = await pageText(p);
      const rects = pt && quoteRects(pt.items, pt.toView, quote, n.y);
      if (rects && placed) {
        if (!tombs[id + 'q']) puts.push({ id: id + 'q', kind: 'hl', docId: doc.id, pageKey: p.key, rects, text: quote, note: '', cat: str(n.cat), style: 'highlight', rmDoc: ret.rmDoc, rmText: '', created: Date.now() });
        made = sticky(n.x, n.y, text);
      } else if (rects) made = { id, kind: 'hl', docId: doc.id, pageKey: p.key, rects, text: quote, note: text, cat: str(n.cat), style: 'highlight', rmDoc: ret.rmDoc, rs: rsNew(text) };
    }
    if (!made) { const t = quote && text ? '“' + quote + '”\n\n' + text : (text || ('“' + quote + '”')); made = sticky(n.x, n.y, t); }
    made.created = Date.now();
    puts.push(made); out.added++;
  }
  // apagadas no reMarkable: somem daqui se não foram mexidas aqui; se foram, ficam (desligadas)
  for (const a of anns) {
    const linked = (a.rs && a.rs.doc === ret.rmDoc) || a.rmDoc === ret.rmDoc;
    if (!linked || seen.has(a.id) || puts.includes(a)) continue;
    if (!a.rs && !String(a.id).startsWith('rm') && !String(a.id).startsWith('rl')) continue;
    if (a.rmHandLink || a.rmLink) { dels.push(a); out.removed++; continue; }
    const fld = textField(a);
    const base = a.rs ? str(a.rs.base) : str(a.rmText);
    if (fld && str(a[fld]) === base) { dels.push(a); out.removed++; }
    else if (a.rs) { delete a.rs; puts.push(a); }
  }
  if (puts.length) await S.putAnnotsGroup(puts);
  if (dels.length) await S.delAnnots(dels);
  await dedupeNative(doc.id);
  await linkDoc(doc.id, ret.rmDoc);

  // ---- Digest ----
  const dgNormItem = window.dgNormItem;
  const dg = await S.digest();
  const items = dg.items.slice();
  let dgChanged = false;
  const keyOf = i => (!isText && list[i]) ? list[i].key : '';
  const pageNo = i => (+i >= 0 ? +i + 1 : 0);
  const dgSeen = new Set();
  const incoming = ret.digest.map(g => ({ g, id: g.ext || ('Drm' + hash(ret.rmDoc + '/' + g.id)) }))
    .concat(dgNotes.map(x => ({ g: { quote: x.quote, note: x.note, tags: [], area: [], created: x.created, updated: x.updated, page: -1 }, id: x.id })));
  for (const { g, id } of incoming) {
    dgSeen.add(id);
    const k = items.findIndex(x => x.id === id);
    if (k >= 0 && !g.ext && g.id && items[k].rmId !== str(g.id)) { items[k] = dgNormItem(Object.assign({}, items[k], { rmId: str(g.id) })); dgChanged = true; }
    if (k >= 0) {
      const it = items[k];
      if (g.ext && g.updated === g.extAt) continue;   // não mexido no reMarkable
      if (it.rmIn === str(g.updated)) continue;
      const appSame = (g.ext && it.updated === g.extUpd) || it.rmSig === dgSig(it);
      const c = Object.assign({}, it);
      if (appSame) { c.note = str(g.note); c.tags = (g.tags || []).map(str); }
      else { if (str(g.note) !== c.note) c.note = c.note + CONFLICT + str(g.note); c.tags = [...new Set([...(c.tags || []), ...(g.tags || []).map(str)])]; out.conflicts++; }
      c.updated = now; c.rmIn = str(g.updated); c.rmSig = dgSig(c); c.rmDoc = c.rmDoc || (g.ext ? '' : ret.rmDoc);
      items[k] = dgNormItem(c); out.digest++; dgChanged = true;
      continue;
    }
    if (g.ext || tombs[id]) continue;   // saiu do app e foi apagado aqui; ou apagado aqui
    const it = dgNormItem({ id, created: str(g.created) || now, updated: now, src: { doc: doc.id, name: doc.name }, page: pageNo(g.page), pageEnd: g.pageEnd > g.page ? pageNo(g.pageEnd) : 0,
      pageKey: keyOf(g.page), pageKeyEnd: g.pageEnd > g.page ? keyOf(g.pageEnd) : '', quote: str(g.quote), note: str(g.note), tags: g.tags || [], area: g.area || [], rmDoc: ret.rmDoc, rmIn: str(g.updated), rmId: str(g.id) });
    if (!it || (!it.quote && !it.note)) continue;
    it.rmSig = dgSig(it);
    items.push(it); out.digest++; dgChanged = true;
  }
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    if (it.rmDoc !== ret.rmDoc || dgSeen.has(it.id) || !it.id.startsWith('Drm')) continue;
    if (it.rmSig === dgSig(it)) { items.splice(k, 1); out.removed++; dgChanged = true; }
  }
  if (dgChanged) await S.saveDigest(Object.assign({}, dg, { items }));
  // página em que você parou no reMarkable: se for mais recente que a daqui, o documento abre nela
  if (ret.cur && !isText && list[ret.cur.page] && !isOpen(doc.id)) {
    const here = (doc.fts && doc.fts.lastKey) || 0;
    if (+ret.cur.at > here && doc.lastKey !== list[ret.cur.page].key) {
      const d2 = await S.getDoc(doc.id);
      d2.lastKey = list[ret.cur.page].key; d2.lastY = 0;
      await S.saveDoc(d2, { noUndo: true });
      out.page = ret.cur.page + 1;
    }
  }
  await stamp(doc.id, 'in');
  return out;
}

function isOpen(docId) {
  const A = window.leitorApp;
  if (!A) return false;
  const rs = [].concat(A.readers || [], A.reader ? [A.reader] : []);
  return rs.some(r => r && r.root && r.root.isConnected && r.doc && r.doc.id === docId);
}
// quando cada documento foi recebido / gravado (para o painel de sincronização)
async function stamp(docId, what) {
  const st = Object.assign({}, await db.kvGet('rmStat', {}));
  st[docId] = Object.assign({}, st[docId] || {}, { [what]: Date.now() });
  await db.kvSet('rmStat', st);
}

// ---------------- receber ----------------
let busy = null;
export async function receiveFromRm(opts = {}) {
  if (busy) return busy;
  busy = (async () => {
    let files;
    try { files = await readRmSyncFiles(!!opts.interactive); }
    catch (e) { if (!opts.quiet) toast('Não consegui ler a pasta do reMarkable: ' + e.message, 6000); return null; }
    if (!files) { if (!opts.quiet) toast(await rmSyncFolderName() ? 'O navegador precisa de permissão para ler a pasta: toque em “Receber agora”.' : 'Escolha antes a pasta do reMarkable (Configurações > reMarkable).', 6000); return null; }
    const seenMap = Object.assign({}, await db.kvGet(KV_SEEN, {}));
    const tot = { files: 0, docs: [], added: 0, updated: 0, removed: 0, conflicts: 0, digest: 0, ink: 0, missing: 0 };
    const touched = new Set();
    for (const f of files) {
      const hsh = hash(f.text);
      if (!opts.force && seenMap[f.name] === hsh) continue;
      const ret = parseReturn(f.text);
      if (!ret) continue;
      tot.files++;
      let r;
      try { r = ret.kind === 'leitor-ink' ? await applyInk(ret) : await applyReturn(ret); }
      catch (e) { console.error(e); continue; }
      if (!r.doc) { tot.missing++; continue; }   // documento ainda não está neste aparelho: tenta de novo depois
      seenMap[f.name] = hsh;
      for (const k of ['added', 'updated', 'removed', 'conflicts', 'digest', 'ink']) tot[k] = (tot[k] || 0) + (r[k] || 0);
      if (r.added + r.updated + r.removed + r.conflicts + r.digest + (r.ink || 0) && !tot.docs.includes(S.docTitle(r.doc))) tot.docs.push(S.docTitle(r.doc));
      if (ret.kind !== 'leitor-ink') touched.add(r.doc.id);
    }
    await db.kvSet(KV_SEEN, seenMap);
    // grava o arquivo do app sem segurar o recebimento
    for (const id of touched) writeAppFile(id, { interactive: !!opts.interactive }).catch(e => console.warn(e));
    const parts = [];
    if (tot.added) parts.push(tot.added + ' nota(s) nova(s)');
    if (tot.updated) parts.push(tot.updated + ' atualizada(s)');
    if (tot.removed) parts.push(tot.removed + ' removida(s)');
    if (tot.digest) parts.push(tot.digest + ' trecho(s) do Digest');
    if (tot.ink) parts.push('escrita de ' + tot.ink + ' página(s)');
    if (tot.conflicts) parts.push(tot.conflicts + ' editada(s) dos dois lados (os dois textos ficaram)');
    if (parts.length) toast('Do reMarkable' + (tot.docs.length === 1 ? ' (' + tot.docs[0] + ')' : '') + ': ' + parts.join(', ') + '.', 7000);
    else if (!opts.quiet) toast(tot.missing ? 'Há arquivo(s) de documentos que não estão neste aparelho.' : 'Nada novo do reMarkable.', 4000);
    return tot;
  })();
  try { return await busy; } finally { busy = null; }
}

// automático: ao abrir o app, ao voltar para ele e a cada minuto (só se a pasta já foi escolhida e,
// no navegador, a permissão já está dada)
let started = false;
export function startRmAutoReceive() {
  if (started || !rmSyncSupported()) return;
  started = true;
  startRmAutoWrite();
  const tick = async () => {
    if (document.visibilityState === 'hidden') return;
    try { if (await rmSyncFolderName()) await receiveFromRm({ quiet: true }); } catch (e) { console.warn(e); }
  };
  setTimeout(tick, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tick, 800); });
  setInterval(tick, 60000);
}

// ---------------- destaques do marca-texto do reMarkable x destaques do mod ----------------
const normT = t => str(t).replace(/[\s­]+/g, '').toLowerCase();
function overlap(a, b) {
  for (const r of a.rects || []) for (const q of b.rects || []) {
    const w = Math.min(r[0] + r[2], q[0] + q[2]) - Math.max(r[0], q[0]);
    const h = Math.min(r[1] + r[3], q[1] + q[3]) - Math.max(r[1], q[1]);
    if (w > 0 && h > 0 && w * h > 0.4 * Math.min(r[2] * r[3], q[2] * q[3])) return true;
  }
  const x = normT(a.text), y = normT(b.text);
  return x.length > 8 && y.length > 8 && (x.includes(y) || y.includes(x));
}
const isModHl = a => a.kind === 'hl' && !a.rmNative && (a.rmDoc || a.rs);
// fica só o destaque do mod (com categoria e nota) quando os dois marcam o mesmo trecho
async function dedupeNative(docId) {
  const anns = await S.annots(docId);
  const mods = anns.filter(isModHl);
  const drop = anns.filter(a => a.rmNative && mods.some(m => m.pageKey === a.pageKey && overlap(m, a)));
  if (drop.length) await S.delAnnots(drop, { noUndo: true });
  return drop.length;
}

// documentos ligados a um documento do reMarkable (para saber para quais gravar o arquivo do app)
async function linkDoc(docId, rmDoc) {
  const links = Object.assign({}, await db.kvGet('rmLinks', {}));
  const l = links[docId] || [];
  if (!l.includes(rmDoc)) { links[docId] = l.concat([rmDoc]); await db.kvSet('rmLinks', links); }
}

// ---------------- escrita e marca-texto do reMarkable ----------------
export async function applyInk(o) {
  const out = { doc: null, ink: 0 };
  const doc = await S.getDoc(o.doc.id);
  if (!doc || doc.kind === 'notebook' || doc.kind === 'text') { out.doc = doc && doc.kind !== 'notebook' ? doc : null; return out; }
  out.doc = doc;
  const V = await import('./rmv6.js');
  const { openPdf, pageList } = await import('./pdfdoc.js');
  const hd = await openPdf(doc);
  let p;
  if (o.hand) p = await handPage(doc, hd, pageList, o);
  else p = rmPages(doc, pageList(doc, hd))[o.page];
  if (!p) return out;
  const tag = o.rmDoc + '/' + o.key;
  const parsed = o.rm ? V.parseRmV6(V.b64ToU8(o.rm)) : { lines: [], glyphs: [] };
  const w = +o.pw || p.w;
  const r2 = v => Math.round(v * 100) / 100;
  const anns = await S.annots(doc.id);
  const mods = anns.filter(a => isModHl(a) && a.pageKey === p.key);
  const fresh = [];
  for (const l of parsed.lines) {
    const hl = V.isHighlighterTool(l.tool);
    const pts = l.pts.map(q => { const [x, y] = V.toPdf(q[0], q[1], w); return [r2(x), r2(y)]; });
    const wd = l.pts.reduce((s0, q) => s0 + (q[2] || 0), 0) / l.pts.length * V.RM_K;
    fresh.push({ id: 'ri' + hash(tag + '/' + l.id), kind: 'ink', tool: hl ? 'marker' : 'pen', docId: doc.id, pageKey: p.key, color: V.rmColor(l.color, l.argb, hl), width: r2(Math.max(hl ? 6 : 0.4, wd || (hl ? 12 : 1.5))), pts, rmInk: tag });
  }
  for (const g of parsed.glyphs) {
    const rects = g.rects.map(rc => { const [x, y] = V.toPdf(rc[0], rc[1], w); return [r2(x), r2(y), r2(rc[2] * V.RM_K), r2(rc[3] * V.RM_K)]; });
    const a = { id: 'ri' + hash(tag + '/' + g.id), kind: 'hl', docId: doc.id, pageKey: p.key, rects, text: g.text, color: V.rmColor(g.color, g.argb, true), cat: '', style: 'highlight', rmInk: tag, rmNative: true };
    if (mods.some(m => overlap(m, a))) continue;   // o mod já marcou este trecho
    fresh.push(a);
  }
  const old = anns.filter(a => a.rmInk === tag || (a.rm && a.pageKey === p.key));
  const sig = a => JSON.stringify([a.kind, a.color, a.width, a.pts, a.rects, a.text]);
  const oldBy = new Map(old.map(a => [a.id, a]));
  const keep = new Set(fresh.map(a => a.id));
  const dels = old.filter(a => !keep.has(a.id));
  const puts = fresh.filter(a => !oldBy.has(a.id) || sig(oldBy.get(a.id)) !== sig(a));
  if (dels.length) await S.delAnnots(dels, { noUndo: true });
  if (puts.length) await S.putAnnotsGroup(puts, { noUndo: true });
  out.ink = (dels.length || puts.length) ? 1 : 0;
  return out;
}

// ---------------- do app para o reMarkable: app-<documento>.json ----------------
async function dirHandleFor(write, interactive) {
  const hnd = await db.kvGet(KV_DIR, null);
  if (!hnd || typeof hnd.queryPermission !== 'function') return null;
  let perm = await hnd.queryPermission({ mode: write ? 'readwrite' : 'read' });
  if (perm !== 'granted' && interactive) { try { perm = await hnd.requestPermission({ mode: write ? 'readwrite' : 'read' }); } catch (e) { } }
  return perm === 'granted' ? hnd : null;
}

// conteúdo do arquivo do app para um documento (puro: testável)
export function appNotesFor(doc, list, anns, prevSent, gonePrev, nowMs, docNames) {
  const idx = new Map(list.map((p, i) => [p.key, i]));
  const notes = [], ink = [];
  let label = '';
  const sent = {};
  for (const a of anns) {
    if (a.rmNative || a.rmInk) continue;
    let kind, x, y, text, quote = '';
    if (a.kind === 'note') { if (!str(a.text).trim() && !a.rs) continue; kind = 'sticky'; x = +a.x || 0; y = +a.y || 0; text = str(a.text); }
    else if (a.kind === 'hl') { if (!str(a.note).trim() && !a.rs) continue; kind = 'hl'; x = a.rects[0][0]; y = a.rects[0][1] + a.rects[0][3] / 2; text = str(a.note); quote = str(a.text); }
    else if (a.kind === 'link' && !a.rmHandLink && !a.rmLink && a.target && a.target.type === 'page' && a.target.docId && a.target.docId !== doc.id && a.rects && a.rects.length) {
      kind = 'link'; x = a.rects[0][0]; y = a.rects[0][1] + a.rects[0][3] / 2; quote = str(a.text);
      label = str(a.targetLabel) || (docNames && docNames[a.target.docId]) || 'outro documento';
      text = 'Ligação: ' + label;
    }
    else if (a.kind === 'ink' && !a.rm && !a.fill && Array.isArray(a.pts) && a.pts.length > 1) {
      const pg = idx.has(a.pageKey) ? idx.get(a.pageKey) : -1;
      if (pg >= 0) ink.push({ page: pg, color: str(a.color) || '#16191D', width: +a.width || 1.5, marker: a.tool === 'marker', pts: a.pts.flatMap(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) });
      continue;
    }
    else continue;
    const page = idx.has(a.pageKey) ? idx.get(a.pageKey) : -1;
    if (page < 0) continue;
    const n = { ext: a.id, kind, page, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, text, quote, cat: str(a.cat), updated: String(a.updated || a.created || '') };
    if (kind === 'link') { n.label = label; n.target = { app: a.target.docId }; }
    if (a.rs) { n.rm = { doc: a.rs.doc, id: a.rs.id }; n.rmIn = str(a.rs.in); }
    notes.push(n);
    sent[a.id] = { base: a.rs ? str(a.rs.base) : text, rm: n.rm || null };
  }
  const gone = (gonePrev || []).filter(g => nowMs - (g.at || 0) < 60 * 86400000 && !sent[g.ext]);
  for (const id of Object.keys(prevSent || {})) {
    if (sent[id] || gone.some(g => g.ext === id)) continue;
    const g = { ext: id, base: prevSent[id].base, at: nowMs };
    if (prevSent[id].rm) g.rm = prevSent[id].rm;
    gone.push(g);
  }
  return { obj: { app: 'leitor-pesquisa', kind: 'app-notes', v: 1, doc: { id: doc.id, name: doc.name }, notes, ink, gone: gone.map(g => { const c = Object.assign({}, g); delete c.at; return c; }) }, sent, gone };
}

let writeWarned = false;
export async function writeAppFile(docId, opts = {}) {
  const links = await db.kvGet('rmLinks', {});
  if (!links[docId]) return false;
  const doc = await S.getDoc(docId);
  if (!doc || doc.kind === 'notebook' || doc.kind === 'text') return false;
  const { openPdf, pageList } = await import('./pdfdoc.js');
  const list = rmPages(doc, pageList(doc, await openPdf(doc)));
  const st = Object.assign({ sent: {}, gone: [], last: '' }, await db.kvGet('rmOut:' + docId, {}));
  const names = {}; for (const d of await S.allDocs()) names[d.id] = S.docTitle(d);
  const r = appNotesFor(doc, list, await S.annots(docId), st.sent, st.gone, Date.now(), names);
  const dgr = appDigestFor(doc, list, (await S.digest()).items, st.sentDg || {}, st.goneDg || [], Date.now());
  r.obj.digest = dgr.items; r.obj.dgGone = dgr.gone.map(g => { const c = Object.assign({}, g); delete c.at; return c; });
  const ci = list.findIndex(p => p.key === doc.lastKey);
  if (ci >= 0) r.obj.cur = { page: ci, at: (doc.fts && doc.fts.lastKey) || 0 };
  const text = JSON.stringify(r.obj);
  if (text === st.last && !opts.force) return true;
  const name = 'app-' + String(docId).replace(/[^A-Za-z0-9_-]/g, '') + '.json';
  try {
    if (ANDROID) {
      if (typeof N.syncWriteFile !== 'function') throw new Error('atualize o app Android (1.5)');
      const w = await Promise.race([native('syncWriteFile', name, text), new Promise(res => setTimeout(() => res({ ok: false, msg: 'a pasta não respondeu' }), 20000))]);
      if (!w.ok) throw new Error(w.msg);
    } else {
      const hnd = await dirHandleFor(true, !!opts.interactive);
      if (!hnd) { if (!writeWarned && !opts.quiet) { writeWarned = true; toast('Para as notas irem ao reMarkable, o app precisa poder gravar na pasta: Configurações ▸ reMarkable ▸ Receber agora.', 7000); } return false; }
      const fh = await hnd.getFileHandle(name, { create: true });
      const ws = await fh.createWritable();
      await ws.write(text); await ws.close();
    }
  } catch (e) {
    if (!writeWarned) { writeWarned = true; toast('Não consegui gravar as notas na pasta do reMarkable: ' + e.message, 7000); }
    return false;
  }
  await db.kvSet('rmOut:' + docId, { sent: r.sent, gone: r.gone, sentDg: dgr.sent, goneDg: dgr.gone, last: text });
  await stamp(docId, 'out');
  return true;
}

// depois de cada mudança nas anotações de um documento ligado, grava o arquivo (alguns segundos depois)
const pendingWrite = new Map();
export function startRmAutoWrite() {
  const later = id => {
    if (!id) return;
    clearTimeout(pendingWrite.get(id));
    pendingWrite.set(id, setTimeout(async () => {
      pendingWrite.delete(id);
      try { await writeAppFile(id, { quiet: true }); } catch (e) { console.warn(e); }
    }, 2500));
  };
  S.on('annots', ev => later(ev && ev.docId));
  // página em que você está (o arquivo só muda quando muda a página) e Digest
  S.on('docs', d => { if (d && d.id) db.kvGet('rmLinks', {}).then(l => { if (l[d.id]) later(d.id); }); });
  S.on('digest', () => db.kvGet('rmLinks', {}).then(l => Object.keys(l).forEach(later)));
}

// páginas como o reMarkable as conhece: sem as páginas de nota à mão que vieram de lá (elas ficam
// no fim da lista do reMarkable, não no meio)
export function rmPages(doc, list) {
  const hand = new Set((doc.blanks || []).filter(b => b.rmHand).map(b => 'b' + b.id));
  return list.filter(p => !hand.has(p.key));
}
// página de nota à mão: uma página em branco deste documento, logo depois da página da nota
async function handPage(doc, hd, pageList, o) {
  const id = 'rmh' + hash(o.rmDoc + '/' + o.key);
  doc.blanks = doc.blanks || [];
  if (!doc.blanks.some(b => b.id === id)) {
    const base = rmPages(doc, pageList(doc, hd))[o.hand.after];
    const after = base && base.kind === 'pdf' ? base.n : hd.pdf.numPages;
    doc.blanks.push({ id, after, w: +(o.pw || 447.26).toFixed(2), h: +(o.ph || 596.34).toFixed(2), created: Date.now(), rmHand: true, rmDoc: o.rmDoc, rmKey: o.key });
    await S.saveDoc(doc);
    S.emit('docRemote', doc);
  }
  return pageList(doc, hd).find(p => p.key === 'b' + id);
}

// botão / atalho "Sincronizar com o reMarkable": recebe tudo e grava o arquivo de cada documento ligado
export async function syncRmNow() {
  if (!rmSyncSupported() || !(await rmSyncFolderName())) { toast('Escolha antes a pasta do reMarkable (Configurações ▸ reMarkable).', 5000); return null; }
  toast('Sincronizando com o reMarkable…', 15000);
  const r = await receiveFromRm({ interactive: true });
  const links = await db.kvGet('rmLinks', {});
  let ok = true;
  for (const id of Object.keys(links)) { try { await writeAppFile(id, { interactive: true, force: true }); } catch (e) { ok = false; } }
  if (r && !(r.added + r.updated + r.removed + r.conflicts + r.digest + (r.ink || 0))) toast(ok ? 'Sincronizado: nada novo do reMarkable; o que mudou aqui já está na pasta.' : 'Recebido; não consegui gravar na pasta.', 4500);
  return r;
}

// Digest deste documento para o reMarkable: só o texto (figuras e áudio ficam aqui)
export function appDigestFor(doc, list, allItems, prevSent, gonePrev, nowMs) {
  const idx = new Map(list.map((p, i) => [p.key, i]));
  const pageOf = (key, n) => idx.has(key) ? idx.get(key) : (n > 0 ? n - 1 : -1);
  const items = [], sent = {};
  for (const it of allItems || []) {
    if (!it.src || it.src.doc !== doc.id) continue;
    if (!str(it.quote).trim() && !str(it.note).trim()) continue;   // só figura/áudio: não vai
    const g = { ext: it.id, pdfPage: pageOf(it.pageKey, it.page), pdfPageEnd: it.pageEnd ? pageOf(it.pageKeyEnd, it.pageEnd) : -1, quote: str(it.quote), note: str(it.note),
      tags: it.tags || [], area: it.area || [], created: str(it.created), updated: str(it.updated), rmIn: str(it.rmIn) };
    if (it.rmDoc && it.rmId) g.rm = { doc: it.rmDoc, id: it.rmId };
    items.push(g);
    sent[it.id] = { rm: g.rm || null, rmIn: g.rmIn };
  }
  const gone = (gonePrev || []).filter(x => nowMs - (x.at || 0) < 60 * 86400000 && !sent[x.ext]);
  for (const id of Object.keys(prevSent || {})) {
    if (sent[id] || gone.some(x => x.ext === id)) continue;
    const x = { ext: id, rmIn: str(prevSent[id].rmIn), at: nowMs };
    if (prevSent[id].rm) x.rm = prevSent[id].rm;
    gone.push(x);
  }
  return { items, gone, sent };
}

// ---------------- painel de sincronização ----------------
export const CONFLICT_MARK = CONFLICT.trim().split('\n')[0];
export async function syncOverview() {
  const links = await db.kvGet('rmLinks', {});
  const stat = await db.kvGet('rmStat', {});
  const docs = new Map((await S.allDocs()).map(d => [d.id, d]));
  const linked = Object.keys(links).filter(id => docs.has(id)).map(id => ({ docId: id, title: S.docTitle(docs.get(id)), rmDocs: links[id].length, in: (stat[id] || {}).in || 0, out: (stat[id] || {}).out || 0 }))
    .sort((a, b) => Math.max(b.in, b.out) - Math.max(a.in, a.out));
  const conflicts = [];
  for (const l of linked) for (const a of await S.annots(l.docId)) {
    const t = a.kind === 'hl' ? a.note : a.kind === 'note' ? a.text : '';
    if (t && t.includes(CONFLICT_MARK)) conflicts.push({ docId: l.docId, title: l.title, id: a.id, pageKey: a.pageKey, y: a.kind === 'note' ? a.y : (a.rects ? a.rects[0][1] : 0), text: t });
  }
  const dgConflicts = (await S.digest()).items.filter(it => str(it.note).includes(CONFLICT_MARK)).map(it => ({ id: it.id, title: it.src.name, text: it.note, quote: it.quote }));
  return { linked, conflicts, dgConflicts };
}

export async function listSyncFiles() {
  if (ANDROID) {
    if (typeof N.syncListNames !== 'function') throw new Error('atualize o app Android (1.7)');
    const r = await native('syncListNames');
    if (!r.ok) throw new Error(r.msg);
    return JSON.parse(r.msg);
  }
  const hnd = await dirHandleFor(false, true);
  if (!hnd) return null;
  const out = [];
  for await (const [name, ent] of hnd.entries()) if (ent.kind === 'file') { const f = await ent.getFile(); out.push({ name, size: f.size, mtime: f.lastModified }); }
  return out;
}

// arquivos que podem sair da pasta sem perder nada: cópias de conflito do Syncthing e arquivos de
// documentos que não existem mais neste app (o reMarkable regrava os dele quando você abre o documento)
export async function cleanupCandidates(files) {
  const docs = new Set((await S.allDocs()).map(d => d.id));
  const links = await db.kvGet('rmLinks', {});
  const rmToApp = {};
  for (const [app, rms] of Object.entries(links)) for (const rm of rms) rmToApp[rm] = app;
  const out = [];
  for (const f of files) {
    const n = f.name;
    if (/\.sync-conflict-/i.test(n)) { out.push({ name: n, why: 'cópia de conflito do Syncthing' }); continue; }
    let m = /^app-([A-Za-z0-9_-]+)\.json$/.exec(n);
    if (m) { if (!docs.has(m[1])) out.push({ name: n, why: 'documento apagado do app' }); continue; }
    m = /^leitor-([A-Za-z0-9_-]+?)(--[A-Za-z0-9_-]+)?\.json$/.exec(n);
    if (m && rmToApp[m[1]] && !docs.has(rmToApp[m[1]])) out.push({ name: n, why: 'documento apagado do app' });
  }
  return out;
}

export async function deleteSyncFiles(names) {
  let n = 0;
  if (ANDROID) {
    for (const name of names) { const r = await native('syncDeleteFile', name); if (r.ok) n++; }
  } else {
    const hnd = await dirHandleFor(true, true);
    if (!hnd) throw new Error('o navegador não deu permissão para mexer na pasta');
    for (const name of names) { try { await hnd.removeEntry(name); n++; } catch (e) { console.warn(e); } }
  }
  const seen = Object.assign({}, await db.kvGet(KV_SEEN, {}));
  for (const name of names) delete seen[name];
  await db.kvSet(KV_SEEN, seen);
  return n;
}
