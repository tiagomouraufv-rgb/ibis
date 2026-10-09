// Dados do app: documentos, anotações, Digest, projetos, gravações, configurações.
import { db } from './db.js';
import { uid } from './util.js';

const listeners = new Map();
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); }
export function emit(ev, data) { (listeners.get(ev) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

// ---------- documentos ----------
export async function allDocs() { return (await db.all('docs')).sort((a, b) => (b.opened || b.added) - (a.opened || a.added)); }
export function getDoc(id) { return db.get('docs', id); }
export async function saveDoc(doc) { await stampFields('docs', doc); await db.put('docs', doc); emit('docs', doc); dirty(); return doc; }

// ---------- sincronização: carimbo de tempo por campo e lápides (itens apagados) ----------
let quiet = 0;   // >0 enquanto a sincronização aplica dados vindos da nuvem
export function quietly(on) { quiet += on ? 1 : -1; }
export function dirty() { if (!quiet) emit('dirty'); }
async function stampFields(store, rec) {
  const old = await db.get(store, rec.id);
  const now = Date.now();
  const fts = Object.assign({}, (old && old.fts) || rec.fts || {});
  let changed = !old;
  for (const k of Object.keys(rec)) {
    if (k === 'fts' || k === 'updated') continue;
    if (!old || JSON.stringify(old[k]) !== JSON.stringify(rec[k])) { fts[k] = now; changed = true; }
  }
  if (old) for (const k of Object.keys(old)) if (!(k in rec) && k !== 'fts' && k !== 'updated') { fts[k] = now; changed = true; }
  rec.fts = fts;
  if (changed || !rec.updated) rec.updated = now;
}
let tombCache = null;
export async function tombs() { if (!tombCache) tombCache = await db.kvGet('tombs', {}); return tombCache; }
export async function saveTombs() { await db.kvSet('tombs', await tombs()); }
async function tomb(ids) {
  const t = await tombs(); const now = Date.now(); let n = 0;
  for (const i of ids) if (i) { t[i] = now; n++; }
  if (n) { await db.kvSet('tombs', t); dirty(); }
}
async function untomb(id) { const t = await tombs(); if (t[id]) { delete t[id]; await db.kvSet('tombs', t); } }
export function resetAnnCache(docId) { if (docId) annCache.delete(docId); else annCache.clear(); }
export function resetCaches() { annCache.clear(); digestCache = null; settingsCache = null; tombCache = null; }
// identificador curto deste aparelho (evita que dois aparelhos criem trechos do Digest com o mesmo número)
export async function deviceId() {
  let d = await db.kvGet('deviceId', '');
  if (!d) { d = Math.random().toString(36).slice(2, 6); await db.kvSet('deviceId', d); }
  window.DG_DEV = '-' + d;
  return d;
}

export async function addDocFromBytes(name, bytes, extra = {}) {
  const fileId = uid('f');
  const id = uid('d');
  await db.put('files', { id: fileId, blob: new Blob([bytes], { type: 'application/pdf' }) });
  const doc = Object.assign({
    id, name: name.replace(/\.pdf$/i, ''), fileName: name, fileId, size: bytes.length, added: Date.now(), opened: 0,
    lastKey: 'p1', lastY: 0, meta: {}, projects: [], bookmarks: [], blanks: [], margins: {}, briefing: '',
  }, extra);
  await saveDoc(doc);
  return doc;
}

export async function deleteDoc(id) {
  const doc = await getDoc(id);
  if (!doc) return;
  const anns = await db.byIndex('annots', 'docId', id);
  const recs = await db.byIndex('recordings', 'docId', id);
  const audio = anns.filter(a => a.audioId).map(a => a.audioId).concat(anns.filter(a => a.fileId).map(a => a.fileId)).concat(recs.map(r => r.fileId));
  if (doc.md) String(doc.md).replace(/\]\((?:img|audio):([\w-]+)\)/g, (m, fid) => { audio.push(fid); return m; });
  await db.delMany('annots', anns.map(a => a.id));
  await db.delMany('recordings', recs.map(r => r.id));
  await db.delMany('files', [doc.fileId].concat(audio).filter(Boolean));
  await db.del('texts', id);
  await db.del('docs', id);
  annCache.delete(id);
  await tomb([id, doc.fileId].concat(anns.map(a => a.id), recs.map(r => r.id), audio));
  emit('docs', null);
}

export function docTitle(doc) { return (doc && ((doc.meta && doc.meta.title) || doc.name)) || 'Documento'; }

// ---------- anotações ----------
// kinds: hl (destaque/sublinhado/tachado), ink (traço), note (nota digitada e/ou de voz), link
const annCache = new Map();
export async function annots(docId) {
  if (!annCache.has(docId)) annCache.set(docId, await db.byIndex('annots', 'docId', docId));
  return annCache.get(docId);
}
export async function allAnnots() { return db.all('annots'); }

const undoStack = [];
const redoStack = [];

async function rawPut(a) {
  const list = await annots(a.docId);
  const i = list.findIndex(x => x.id === a.id);
  if (i >= 0) list[i] = a; else list.push(a);
  await db.put('annots', a);
  await untomb(a.id);
  dirty();
}
async function rawDel(a) {
  const list = await annots(a.docId);
  const i = list.findIndex(x => x.id === a.id);
  if (i >= 0) list.splice(i, 1);
  await db.del('annots', a.id);
  await tomb([a.id]);
}

export async function putAnnot(a, opts = {}) {
  const list = await annots(a.docId);
  const before = list.find(x => x.id === a.id) || null;
  if (!a.id) a.id = uid('a');
  if (!a.created) a.created = Date.now();
  a.updated = Date.now();
  await rawPut(a);
  if (!opts.noUndo) { undoStack.push({ docId: a.docId, before: before && JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(a)) }); redoStack.length = 0; }
  emit('annots', { docId: a.docId, pageKey: a.pageKey, id: a.id });
  return a;
}

export async function delAnnot(a, opts = {}) {
  await rawDel(a);
  if (!opts.noUndo) { undoStack.push({ docId: a.docId, before: JSON.parse(JSON.stringify(a)), after: null }); redoStack.length = 0; }
  emit('annots', { docId: a.docId, pageKey: a.pageKey, id: a.id });
}

// apaga vários traços como uma só ação de desfazer
export async function delAnnots(arr) {
  if (!arr.length) return;
  for (const a of arr) await rawDel(a);
  undoStack.push({ docId: arr[0].docId, group: arr.map(a => ({ before: JSON.parse(JSON.stringify(a)), after: null })) });
  redoStack.length = 0;
  emit('annots', { docId: arr[0].docId });
}

async function applyStep(step, dir) {
  const items = step.group || [step];
  for (const s of items) {
    const target = dir === 'undo' ? s.before : s.after;
    const other = dir === 'undo' ? s.after : s.before;
    if (target) { const t = JSON.parse(JSON.stringify(target)); t.updated = Date.now(); await rawPut(t); }
    else if (other) await rawDel(other);
  }
  emit('annots', { docId: step.docId });
}
export async function undo() { const s = undoStack.pop(); if (!s) return false; await applyStep(s, 'undo'); redoStack.push(s); return true; }
export async function redo() { const s = redoStack.pop(); if (!s) return false; await applyStep(s, 'redo'); undoStack.push(s); return true; }

// ---------- arquivos de áudio ----------
export async function saveAudio(blob) {
  const id = uid('au');
  await db.put('files', { id, blob });
  return id;
}
export async function audioBlob(id) { const f = await db.get('files', id); return f ? f.blob : null; }

// ---------- gravações sincronizadas ----------
export async function recordings(docId) { return (await db.byIndex('recordings', 'docId', docId)).sort((a, b) => a.started - b.started); }
export async function allRecordings() { return db.all('recordings'); }
export function saveRecording(r) { r.updated = Date.now(); return db.put('recordings', r).then(() => { emit('recordings', r); dirty(); }); }
export async function deleteRecording(r) { await db.del('recordings', r.id); await db.del('files', r.fileId); await tomb([r.id, r.fileId]); emit('recordings', r); }

// ---------- Digest ----------
let digestCache = null;
export async function digest() {
  if (!digestCache) {
    const raw = await db.kvGet('digest', null);
    digestCache = raw ? dgParse(JSON.stringify(raw)).store : dgEmpty();
  }
  return digestCache;
}
export async function saveDigest(st, opts = {}) {
  const old = digestCache || await digest();
  const keep = new Set(st.items.map(i => i.id));
  const gone = old.items.filter(i => !keep.has(i.id)).map(i => i.id);
  if (gone.length && !opts.fromSync) await tomb(gone);
  digestCache = st;
  dirty();
  await db.kvSet('digest', JSON.parse(dgSerialize(st)));
  emit('digest', st);
}

// ---------- projetos ----------
export async function projects() { return (await db.all('projects')).sort((a, b) => a.name.localeCompare(b.name, 'pt')); }
export async function saveProject(p) { if (!p.id) p.id = uid('pr'); if (!p.created) p.created = Date.now(); await stampFields('projects', p); await db.put('projects', p); emit('projects', p); dirty(); return p; }
export async function deleteProject(id) {
  await db.del('projects', id);
  await tomb([id]);
  for (const d of await allDocs()) if ((d.projects || []).includes(id)) { d.projects = d.projects.filter(x => x !== id); await saveDoc(d); }
  emit('projects', null); emit('docs', null);
}

// ---------- configurações ----------
const DEFAULTS = {
  geminiKey: '', geminiModel: 'gemini-3.8-flash', language: 'português do Brasil',
  researchContext: 'Pesquisador em fotônica e pinças ópticas (UFV): aprisionamento óptico de nanopartículas de semicondutores orgânicos (MEH-PPV/Pdots) e de micropartículas semicondutoras (Ge, Si); modelagem teórica com osciladores de Lorentz no Mathcad Prime; orienta alunos de graduação.',
  translateTo: 'pt', obsidianVault: '', obsidianFolder: 'Leituras', theme: 'auto', pdfMode: 'normal',
  penOnly: true, penButtonErase: true, syncClientId: '', penWidth: 2, penColor: '#16191D', markerColor: '#FFE36E', ttsRate: 1,
};
let settingsCache = null;
export async function settings() {
  if (!settingsCache) settingsCache = Object.assign({}, DEFAULTS, await db.kvGet('settings', {}));
  return settingsCache;
}
export async function setSettings(patch) {
  const s = await settings();
  Object.assign(s, patch);
  await db.kvSet('settings', s);
  emit('settings', s);
  return s;
}

// ---------- texto indexado para a busca geral ----------
export function saveTexts(docId, pages) { return db.put('texts', { docId, pages }); }
export function getTexts(docId) { return db.get('texts', docId); }
export function allTexts() { return db.all('texts'); }

// grava várias anotações como uma só ação de desfazer (mover/redimensionar/duplicar)
export async function putAnnotsGroup(arr) {
  if (!arr.length) return;
  const list = await annots(arr[0].docId);
  const group = [];
  for (const a of arr) {
    if (!a.id) a.id = uid('a');
    if (!a.created) a.created = Date.now();
    a.updated = Date.now();
    const before = list.find(x => x.id === a.id) || null;
    group.push({ before: before && JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(a)) });
    await rawPut(a);
  }
  undoStack.push({ docId: arr[0].docId, group });
  redoStack.length = 0;
  emit('annots', { docId: arr[0].docId });
}
