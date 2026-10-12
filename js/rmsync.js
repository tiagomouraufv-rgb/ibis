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
    return r.msg;
  }
  if (typeof window.showDirectoryPicker !== 'function') { toast('Este navegador não deixa escolher pastas. Use o Chrome ou o Edge.', 6000); return ''; }
  let hnd;
  try { hnd = await window.showDirectoryPicker({ id: 'leitor-rm-sync', mode: 'read' }); }
  catch (e) { return ''; }
  await db.kvSet(KV_DIR, hnd);
  await db.kvSet(KV_SEEN, {});
  return hnd.name;
}

export async function forgetRmSyncFolder() {
  if (ANDROID) { try { N.syncForget(); } catch (e) { } }
  await db.kvSet(KV_DIR, null);
  await db.kvSet(KV_SEEN, {});
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
  let perm = await hnd.queryPermission({ mode: 'read' });
  if (perm !== 'granted' && interactive) perm = await hnd.requestPermission({ mode: 'read' });
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
    list = pageList(doc, hd);
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

  for (const n of ret.notes) {
    const text = str(n.text), quote = str(n.quote);
    if (n.ext) {
      // nota que saiu do app
      const a = anns.find(x => x.id === n.ext);
      const fld = a && textField(a);
      if (!fld || n.updated === n.extAt || a.rmIn === n.updated) continue;
      const cur = str(a[fld]);
      const appSame = String(a.updated) === str(n.extUpd) || (a.rmText !== undefined && cur === a.rmText);
      let moved = false;
      if (a.kind === 'note' && appSame && (Math.abs((+a.x || 0) - n.x) > 3 || Math.abs((+a.y || 0) - n.y) > 3)) { a.x = n.x; a.y = n.y; moved = true; }
      if (cur !== text) {
        if (appSame) { a[fld] = text; out.updated++; }
        else { a[fld] = cur + CONFLICT + text; out.conflicts++; }
      } else if (moved) out.updated++;
      a.rmIn = n.updated; a.rmText = a[fld];
      puts.push(a);
      continue;
    }
    if (!text && !quote) continue;
    const id = 'rm' + hash(ret.rmDoc + '/' + n.id);
    seen.add(id); seen.add(id + 'q');
    if (isText) { dgNotes.push({ id: 'Drm' + hash(ret.rmDoc + '/' + n.id), quote, note: text, created: n.created, updated: n.updated }); continue; }
    const p = list[n.page];
    // nota com citação que foi movida, no reMarkable, para dentro da página (fora da margem): o trecho
    // fica destacado e a nota fica onde você a pôs lá, como adesiva
    const placed = !!(p && text && quote && n.x > 40 && n.x < p.w - 40);
    const sticky = (x, y, t) => ({ id, kind: 'note', docId: doc.id, pageKey: p.key, x: Math.max(6, Math.min(p.w - 20, +x || 0)), y: Math.max(6, Math.min(p.h - 20, +y || 0)), text: t, rmDoc: ret.rmDoc, rmIn: n.updated, rmText: t, created: Date.now() });
    const a = anns.find(x => x.id === id);
    if (a) {
      const fld = textField(a);
      // 1.4.0 guardava esta nota no destaque; agora ela vai para o ponto em que está no reMarkable
      if (placed && a.kind === 'hl' && str(a.note) === str(a.rmText)) {
        puts.push(Object.assign({}, a, { id: id + 'q', note: '', rmText: '' }));
        puts.push(sticky(n.x, n.y, text));
        out.updated++;
        continue;
      }
      if (!fld || a.rmIn === n.updated) continue;
      const cur = str(a[fld]);
      if (cur !== text) {
        if (cur === str(a.rmText)) { a[fld] = text; out.updated++; }
        else { a[fld] = cur + CONFLICT + text; out.conflicts++; }
      }
      if (a.kind === 'note') { a.x = n.x; a.y = n.y; }
      a.rmIn = n.updated; a.rmText = a[fld];
      puts.push(a);
      continue;
    }
    if (tombs[id]) continue;   // apagada aqui: não volta
    if (!p) { out.skipped++; continue; }
    let made = null;
    if (quote) {
      const pt = await pageText(p);
      const rects = pt && quoteRects(pt.items, pt.toView, quote, n.y);
      if (rects && placed) {
        if (!tombs[id + 'q']) puts.push({ id: id + 'q', kind: 'hl', docId: doc.id, pageKey: p.key, rects, text: quote, note: '', cat: str(n.cat), style: 'highlight', rmDoc: ret.rmDoc, rmIn: n.updated, rmText: '', created: Date.now() });
        made = sticky(n.x, n.y, text);
      } else if (rects) made = { id, kind: 'hl', docId: doc.id, pageKey: p.key, rects, text: quote, note: text, cat: str(n.cat), style: 'highlight', rmDoc: ret.rmDoc, rmIn: n.updated, rmText: text };
    }
    if (!made) made = sticky(n.x, n.y, quote && text ? '“' + quote + '”\n\n' + text : (text || ('“' + quote + '”')));
    made.created = Date.now();
    puts.push(made); out.added++;
  }
  // apagadas no reMarkable (e não mexidas aqui)
  for (const a of anns) {
    if (a.rmDoc !== ret.rmDoc || seen.has(a.id) || !String(a.id).startsWith('rm')) continue;
    const fld = textField(a);
    if (fld && str(a[fld]) === str(a.rmText)) { dels.push(a); out.removed++; }
  }
  if (puts.length) await S.putAnnotsGroup(puts);
  if (dels.length) await S.delAnnots(dels);

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
      pageKey: keyOf(g.page), pageKeyEnd: g.pageEnd > g.page ? keyOf(g.pageEnd) : '', quote: str(g.quote), note: str(g.note), tags: g.tags || [], area: g.area || [], rmDoc: ret.rmDoc, rmIn: str(g.updated) });
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
  return out;
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
    const tot = { files: 0, docs: [], added: 0, updated: 0, removed: 0, conflicts: 0, digest: 0, missing: 0 };
    for (const f of files) {
      const hsh = hash(f.text);
      if (!opts.force && seenMap[f.name] === hsh) continue;
      const ret = parseReturn(f.text);
      if (!ret) continue;
      tot.files++;
      let r;
      try { r = await applyReturn(ret); }
      catch (e) { console.error(e); continue; }
      if (!r.doc) { tot.missing++; continue; }   // documento ainda não está neste aparelho: tenta de novo depois
      seenMap[f.name] = hsh;
      for (const k of ['added', 'updated', 'removed', 'conflicts', 'digest']) tot[k] += r[k];
      if (r.added + r.updated + r.removed + r.conflicts + r.digest) tot.docs.push(S.docTitle(r.doc));
    }
    await db.kvSet(KV_SEEN, seenMap);
    const parts = [];
    if (tot.added) parts.push(tot.added + ' nota(s) nova(s)');
    if (tot.updated) parts.push(tot.updated + ' atualizada(s)');
    if (tot.removed) parts.push(tot.removed + ' removida(s)');
    if (tot.digest) parts.push(tot.digest + ' trecho(s) do Digest');
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
  const tick = async () => {
    if (document.visibilityState === 'hidden') return;
    try { if (await rmSyncFolderName()) await receiveFromRm({ quiet: true }); } catch (e) { console.warn(e); }
  };
  setTimeout(tick, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tick, 800); });
  setInterval(tick, 60000);
}
