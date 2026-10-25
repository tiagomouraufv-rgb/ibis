// Sincronização pelo Google Drive (sua própria conta). Os dados vão para uma pasta criada pelo app
// no seu Drive ("Leitor de Pesquisa (sincronização)"); o app só enxerga os arquivos que ele mesmo criou.
// Nada passa por servidor nosso: o navegador/app fala direto com o Google.
import * as S from './store.js';
import { db } from './db.js';
import { isAndroidApp } from './platform.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'Leitor de Pesquisa (sincronização)';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class SyncError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---------------- estado ----------------
const status = { state: 'off', msg: '', last: 0, email: '' };   // off | idle | busy | error | login
export function syncStatus() { return status; }
function setStatus(state, msg) { status.state = state; status.msg = msg || ''; S.emit('sync', status); }

async function syncState() { return Object.assign({ folderId: '', md5: {}, hash: {}, last: 0, email: '', enabled: false }, await db.kvGet('sync', {})); }
async function saveSyncState(st) { await db.kvSet('sync', st); }

// ---------------- login (token de acesso) ----------------
let tok = null;   // { token, exp }

async function cachedToken() {
  if (tok && tok.exp > Date.now() + 60000) return tok.token;
  const t = await db.kvGet('syncToken', null);
  if (t && t.exp > Date.now() + 60000) { tok = t; return t.token; }
  return null;
}
async function keepToken(token, seconds) {
  tok = { token, exp: Date.now() + (seconds || 3300) * 1000 };
  await db.kvSet('syncToken', tok);
  return token;
}
export async function forgetToken() { tok = null; await db.kvSet('syncToken', null); }

function loadGis() {
  return new Promise((res, rej) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new SyncError('net', 'Não consegui carregar o login do Google. Verifique a internet.'));
    document.head.appendChild(s);
  });
}

// Web: janela de login do Google (precisa de um toque do usuário). interactive=false só usa o token guardado.
async function webToken(interactive, consent) {
  const st = await S.settings();
  if (!st.syncClientId) throw new SyncError('noclient', 'Falta o "ID do cliente" do Google em Configurações > Sincronização.');
  if (!interactive) throw new SyncError('login', 'Toque em "Sincronizar" para entrar de novo na conta Google.');
  await loadGis();
  const ss = await syncState();
  const r = await new Promise((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: st.syncClientId.trim(), scope: SCOPE, login_hint: ss.email || undefined,
      callback: r => (r && r.access_token) ? res(r) : rej(new SyncError('login', 'Login não concluído: ' + ((r && (r.error_description || r.error)) || 'sem resposta'))),
      error_callback: e => rej(new SyncError('login', (e && e.type === 'popup_closed') ? 'Login cancelado.' : (e && e.type === 'popup_failed_to_open') ? 'O navegador bloqueou a janela de login. Permita pop-ups para este site.' : 'Login não concluído.')),
    });
    tc.requestAccessToken({ prompt: consent ? 'consent' : '' });
  });
  return keepToken(r.access_token, Number(r.expires_in) || 3300);
}

// Android: login nativo do Google (sem janela de navegador). Depois da 1ª vez, renova sozinho.
function androidToken(interactive) {
  return new Promise((res, rej) => {
    const id = 'drv' + Date.now() + Math.random().toString(36).slice(2, 6);
    const prev = window.__nativeCb;
    const cbs = window.__driveCbs || (window.__driveCbs = {});
    cbs[id] = r => r.ok ? res(keepToken(r.msg, 3300)) : rej(new SyncError(r.msg === 'need-consent' ? 'login' : 'auth', r.msg === 'need-consent' ? 'Toque em "Sincronizar" para autorizar o acesso ao Google Drive.' : r.msg));
    if (!window.__driveCbWrapped) {
      window.__driveCbWrapped = true;
      const orig = prev;
      window.__nativeCb = (cid, ok, msg) => {
        const f = (window.__driveCbs || {})[cid];
        if (f) { delete window.__driveCbs[cid]; f({ ok: !!ok, msg: msg || '' }); } else if (orig) orig(cid, ok, msg);
      };
    }
    try { window.AndroidBridge.driveToken(id, !!interactive); }
    catch (e) { delete cbs[id]; rej(new SyncError('auth', 'Este APK é antigo e não tem o login do Google. Gere o APK da versão 0.4.0.')); }
  });
}

export async function getToken(interactive, consent) {
  if (window.__driveTestToken) return window.__driveTestToken;   // usado só nos testes automáticos
  if (!consent) { const t = await cachedToken(); if (t) return t; }
  return isAndroidApp ? androidToken(interactive) : webToken(interactive, consent);
}

// ---------------- chamadas ao Drive ----------------
let interactiveAllowed = false;
async function call(method, url, opts = {}, retry = true) {
  const token = await getToken(interactiveAllowed);
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  let r;
  try { r = await fetch(url, { method, headers, body: opts.body }); }
  catch (e) { throw new SyncError('net', 'Sem conexão com o Google Drive.'); }
  if (r.status === 401 && retry) { await forgetToken(); return call(method, url, opts, false); }
  if (!r.ok && !(opts.ok404 && r.status === 404)) {
    let msg = r.status + '';
    try { const j = await r.json(); msg += ' ' + ((j.error && j.error.message) || ''); } catch (e) {}
    if (r.status === 403 && /not been used|disabled/i.test(msg)) throw new SyncError('api', 'A "Google Drive API" não está ativada no seu projeto do Google Cloud. Veja o Guia.');
    throw new SyncError('http', 'Erro do Google Drive: ' + msg);
  }
  return r;
}
const q = s => encodeURIComponent(s);

async function findFolder() {
  const r = await call('GET', API + '/files?spaces=drive&fields=files(id,name)&q=' + q(`name='${FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`));
  const j = await r.json();
  return (j.files && j.files[0] && j.files[0].id) || '';
}
async function createFolder() {
  const r = await call('POST', API + '/files?fields=id', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME }) });
  return (await r.json()).id;
}
async function listFolder(folderId) {
  const out = [];
  let page = '';
  do {
    const r = await call('GET', API + '/files?spaces=drive&pageSize=1000&fields=' + q('nextPageToken,files(id,name,md5Checksum,size,mimeType)') + '&q=' + q(`'${folderId}' in parents and trashed=false`) + (page ? '&pageToken=' + q(page) : ''));
    const j = await r.json();
    out.push(...(j.files || []));
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
async function download(id) { return (await call('GET', API + '/files/' + id + '?alt=media')).blob(); }
async function removeFile(id) { await call('DELETE', API + '/files/' + id, { ok404: true }); }

async function upload(name, blob, folderId, existingId) {
  const mime = blob.type || 'application/octet-stream';
  const fields = '&fields=' + q('id,name,md5Checksum');
  if (blob.size > 4.5 * 1024 * 1024) {
    // arquivo grande: envio em duas etapas ("resumable")
    const meta = existingId ? {} : { name, parents: [folderId] };
    const r = await call(existingId ? 'PATCH' : 'POST', UP + '/files' + (existingId ? '/' + existingId : '') + '?uploadType=resumable' + fields,
      { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime }, body: JSON.stringify(meta) });
    const loc = r.headers.get('Location');
    if (loc) {
      const r2 = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob });
      if (!r2.ok) throw new SyncError('http', 'Erro ao enviar ' + name + ' (' + r2.status + ').');
      return r2.json();
    }
  }
  if (existingId) {
    const r = await call('PATCH', UP + '/files/' + existingId + '?uploadType=media' + fields, { headers: { 'Content-Type': mime }, body: blob });
    return r.json();
  }
  const b = 'leitor' + Math.random().toString(36).slice(2);
  const body = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify({ name, parents: [folderId], mimeType: mime }),
    '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n', blob, '\r\n--' + b + '--'], { type: 'multipart/related; boundary=' + b });
  const r = await call('POST', UP + '/files?uploadType=multipart' + fields, { headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
  return r.json();
}

async function accountEmail() {
  try { const r = await call('GET', API + '/about?fields=' + q('user(emailAddress)')); return ((await r.json()).user || {}).emailAddress || ''; }
  catch (e) { return ''; }
}

// ---------------- serialização estável ----------------
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function hash(s) { let a = 0x811c9dc5, b = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = (Math.imul(b, 31) + c) | 0; } return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36) + '.' + s.length; }
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const tsOf = v => typeof v === 'number' ? v : (Date.parse(v) || 0);

// ---------------- pacotes locais ----------------
async function localCommon() {
  const dg = await S.digest();
  return {
    v: 1,
    projects: (await db.all('projects')).sort(byId),
    digest: { seq: dg.seq, items: dg.items.slice().sort(byId), exportedTags: dg.exportedTags || [] },
    tombs: await S.tombs(),
    readLater: (await S.readLater()).slice().sort(byId),
  };
}
async function localDocBundle(doc) {
  return {
    v: 1, doc,
    annots: (await db.byIndex('annots', 'docId', doc.id)).sort(byId),
    recordings: (await db.byIndex('recordings', 'docId', doc.id)).sort(byId),
  };
}
async function neededFiles() {
  const ids = new Set();
  for (const d of await db.all('docs')) { if (d.fileId) ids.add(d.fileId); if (d.md) String(d.md).replace(/\]\((?:img|audio):([\w-]+)\)/g, (m, id) => { ids.add(id); return m; }); }
  for (const a of await db.all('annots')) { if (a.audioId) ids.add(a.audioId); if (a.fileId) ids.add(a.fileId); }
  for (const r of await db.all('recordings')) if (r.fileId) ids.add(r.fileId);
  for (const it of (await S.digest()).items) { if (it.audio) ids.add(it.audio); for (const n of it.images || []) ids.add(String(n).split('.')[0]); }
  return ids;
}

// ---------------- junção (merge) ----------------
// documentos e projetos: cada campo fica com a versão mais recente (fts = horário de cada campo)
export function mergeFields(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const out = Object.assign({}, local);
  const lf = local.fts || {}, rf = remote.fts || {};
  const fts = Object.assign({}, lf);
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(rf)]);
  for (const k of keys) {
    if (k === 'fts' || k === 'updated' || k === 'id') continue;
    if ((rf[k] || 0) > (lf[k] || 0)) {
      if (k in remote) out[k] = remote[k]; else delete out[k];
      fts[k] = rf[k];
    } else if (!(k in local) && (k in remote) && !(lf[k])) out[k] = remote[k];
  }
  out.fts = fts;
  out.updated = Math.max(local.updated || 0, remote.updated || 0);
  return out;
}

const dead = (tombs, id, updated) => tombs[id] !== undefined && tombs[id] >= tsOf(updated);

async function mergeCommon(data, changed) {
  const tombs = await S.tombs();
  let tch = false;
  for (const [id, t] of Object.entries(data.tombs || {})) if (!(tombs[id] >= t)) { tombs[id] = t; tch = true; }
  if (tch) await S.saveTombs();
  // projetos
  for (const p of data.projects || []) {
    if (dead(tombs, p.id, p.updated)) continue;
    const l = await db.get('projects', p.id);
    const m = mergeFields(l, p);
    if (stable(m) !== stable(l)) { await db.put('projects', m); changed.projects = true; }
  }
  // "ler depois": item a item, fica a edição mais recente
  if (Array.isArray(data.readLater)) {
    const ll = (await S.readLater()).slice();
    let rch = false;
    for (const it of data.readLater) {
      if (!it || !it.id || dead(tombs, it.id, it.updated)) continue;
      const k = ll.findIndex(x => x.id === it.id);
      if (k < 0) { ll.push(it); rch = true; } else if ((it.updated || 0) > (ll[k].updated || 0)) { ll[k] = it; rch = true; }
    }
    if (rch) { await S.setReadLaterAll(ll); changed.readLater = true; }
  }
  // Digest: trecho a trecho, fica a edição mais recente
  const rd = data.digest || { items: [] };
  const ld = await S.digest();
  const map = new Map(ld.items.map(i => [i.id, i]));
  let dch = false;
  for (const raw of rd.items || []) {
    const it = dgNormItem(raw);
    if (!it) continue;
    let l = map.get(it.id);
    if (l && l.created !== it.created) {
      // dois aparelhos criaram trechos com o mesmo número antes da 1ª sincronização: o mais novo ganha outro número
      const newer = l.created > it.created ? l : it;
      const nid = newer.id + '-' + hash(newer.created).split('.')[0].slice(0, 4);
      if (newer === l) { map.delete(l.id); l.id = nid; map.set(nid, l); dch = true; }
      else it.id = nid;
      l = map.get(it.id);
    }
    if (dead(tombs, it.id, it.updated)) continue;
    if (!l || tsOf(it.updated) > tsOf(l.updated)) { map.set(it.id, it); dch = true; }
  }
  if (dch) {
    const seq = Math.max(ld.seq || 0, rd.seq || 0);
    const st = { version: 1, seq, items: [...map.values()].sort((a, b) => a.created < b.created ? -1 : 1), exportedTags: [...new Set([...(ld.exportedTags || []), ...(rd.exportedTags || [])])] };
    await S.saveDigest(st, { fromSync: true });
    changed.digest = true;
  }
}

async function mergeDocBundle(data, changed) {
  const tombs = await S.tombs();
  const d = data.doc;
  if (!d || !d.id) return;
  if (dead(tombs, d.id, d.updated)) return;
  const l = await db.get('docs', d.id);
  const m = mergeFields(l, d);
  if (stable(m) !== stable(l)) { await db.put('docs', m); changed.docs = true; S.emit('docRemote', m); }
  let ach = false;
  for (const a of data.annots || []) {
    if (dead(tombs, a.id, a.updated)) continue;
    const la = await db.get('annots', a.id);
    if (!la || (a.updated || 0) > (la.updated || 0)) { await db.put('annots', a); ach = true; }
  }
  for (const r of data.recordings || []) {
    if (dead(tombs, r.id, r.updated)) continue;
    const lr = await db.get('recordings', r.id);
    if (!lr || (r.updated || 0) > (lr.updated || 0)) { await db.put('recordings', r); changed.recordings = true; }
  }
  if (ach) { S.resetAnnCache(d.id); (changed.annots = changed.annots || new Set()).add(d.id); }
}

// apaga aqui o que foi apagado no outro aparelho
async function applyTombs(changed) {
  const tombs = await S.tombs();
  for (const [id, t] of Object.entries(tombs)) {
    const d = await db.get('docs', id);
    if (d && (d.updated || 0) <= t) {
      const anns = await db.byIndex('annots', 'docId', id);
      const recs = await db.byIndex('recordings', 'docId', id);
      await db.delMany('annots', anns.map(a => a.id));
      await db.delMany('recordings', recs.map(r => r.id));
      await db.del('texts', id);
      await db.del('docs', id);
      S.resetAnnCache(id); changed.docs = true;
      continue;
    }
    const a = await db.get('annots', id);
    if (a && (a.updated || 0) <= t) { await db.del('annots', id); S.resetAnnCache(a.docId); (changed.annots = changed.annots || new Set()).add(a.docId); continue; }
    const p = await db.get('projects', id);
    if (p && (p.updated || 0) <= t) { await db.del('projects', id); changed.projects = true; continue; }
    const r = await db.get('recordings', id);
    if (r && (r.updated || 0) <= t) { await db.del('recordings', id); changed.recordings = true; }
  }
  const rl = await S.readLater();
  const rlKeep = rl.filter(it => !dead(tombs, it.id, it.updated));
  if (rlKeep.length !== rl.length) await S.setReadLaterAll(rlKeep);
  const dg = await S.digest();
  const keep = dg.items.filter(it => !dead(tombs, it.id, it.updated));
  if (keep.length !== dg.items.length) { await S.saveDigest(Object.assign({}, dg, { items: keep }), { fromSync: true }); changed.digest = true; }
  // arquivos (PDF, áudio, imagens) de itens apagados
  const fileKeys = new Set(await db.keys('files'));
  const del = Object.keys(tombs).filter(id => fileKeys.has(id));
  if (del.length) await db.delMany('files', del);
}

// ---------------- sincronizar ----------------
let running = null;
export function syncNow(opts = {}) {
  if (running) return running;
  const go = () => doSync(opts);
  // várias janelas do app: só uma sincroniza por vez
  const locked = navigator.locks && navigator.locks.request ? () => navigator.locks.request('leitor-sync', go) : go;
  running = locked().finally(() => { running = null; interactiveAllowed = false; });
  return running;
}

async function doSync({ interactive = false, progress } = {}) {
  const ss = await syncState();
  if (!ss.enabled && !interactive) return { skipped: true };
  interactiveAllowed = interactive;
  setStatus('busy', 'Sincronizando…');
  const say = m => { setStatus('busy', m); if (progress) progress(m); };
  const changed = {};
  const stats = { up: 0, down: 0, files: 0 };
  try {
    await getToken(interactive);
    if (!ss.email) ss.email = await accountEmail();
    if (!ss.folderId) ss.folderId = (await findFolder()) || await createFolder();
    let files;
    try { files = await listFolder(ss.folderId); }
    catch (e) { ss.folderId = (await findFolder()) || await createFolder(); ss.md5 = {}; ss.hash = {}; files = await listFolder(ss.folderId); }
    const remote = new Map(files.map(f => [f.name, f]));

    // 1. baixar o que mudou na nuvem e juntar com o que está aqui
    S.quietly(true);
    try {
      const rc = remote.get('common.json');
      if (rc && rc.md5Checksum !== ss.md5['common.json']) {
        say('Baixando Digest e projetos…');
        const text = await (await download(rc.id)).text();
        await mergeCommon(JSON.parse(text), changed);
        ss.md5['common.json'] = rc.md5Checksum; ss.hash['common.json'] = hash(stable(JSON.parse(text)));
        stats.down++;
      }
      for (const f of files) {
        if (!/^doc-.*\.json$/.test(f.name) || f.md5Checksum === ss.md5[f.name]) continue;
        say('Baixando anotações…');
        const text = await (await download(f.id)).text();
        const data = JSON.parse(text);
        await mergeDocBundle(data, changed);
        ss.md5[f.name] = f.md5Checksum; ss.hash[f.name] = hash(stable(data));
        stats.down++;
      }
      await applyTombs(changed);
    } finally { S.quietly(false); }
    await saveSyncState(ss);

    // 2. arquivos (PDFs, áudios, imagens): baixa os que faltam aqui, envia os que faltam lá
    const need = await neededFiles();
    const lazy = !!(await S.settings()).syncLazyPdf;
    const pdfIds = new Set((await db.all('docs')).map(d => d.fileId).filter(Boolean));
    const tombs = await S.tombs();
    const have = new Set(await db.keys('files'));
    for (const id of need) {
      const rf = remote.get('file-' + id);
      if (!have.has(id) && rf && lazy && pdfIds.has(id)) continue;   // PDF: baixa só quando abrir
      if (!have.has(id) && rf) {
        say('Baixando arquivos… (' + (++stats.files) + ')');
        const blob = await download(rf.id);
        await db.put('files', { id, blob: rf.mimeType && blob.type !== rf.mimeType ? new Blob([blob], { type: rf.mimeType }) : blob });
      } else if (have.has(id) && !rf && !tombs[id]) {
        say('Enviando arquivos… (' + (++stats.files) + ')');
        const f = await db.get('files', id);
        if (f && f.blob) { const r = await upload('file-' + id, f.blob, ss.folderId, null); remote.set(r.name || 'file-' + id, r); }
      }
    }

    // 3. enviar o que mudou aqui
    const bundles = [['common.json', await localCommon()]];
    for (const d of await db.all('docs')) bundles.push(['doc-' + d.id + '.json', await localDocBundle(d)]);
    for (const [name, data] of bundles) {
      const text = stable(data);
      const hh = hash(text);
      const rf = remote.get(name);
      if (rf && hh === ss.hash[name] && rf.md5Checksum === ss.md5[name]) continue;
      say('Enviando ' + (name === 'common.json' ? 'Digest e projetos' : 'anotações') + '…');
      const r = await upload(name, new Blob([text], { type: 'application/json' }), ss.folderId, rf && rf.id);
      ss.md5[name] = r.md5Checksum; ss.hash[name] = hh;
      stats.up++;
      await saveSyncState(ss);
    }

    // 4. limpar na nuvem o que foi apagado
    for (const [name, f] of remote) {
      const m = /^doc-(.*)\.json$/.exec(name) || /^file-(.*)$/.exec(name);
      if (m && tombs[m[1]] && !(await db.get('docs', m[1])) && !have.has(m[1])) { await removeFile(f.id); delete ss.md5[name]; delete ss.hash[name]; }
    }

    ss.last = Date.now(); ss.enabled = true;
    await saveSyncState(ss);
    status.last = ss.last; status.email = ss.email;
    setStatus('idle', 'Sincronizado');
  } catch (e) {
    console.warn('sync', e);
    setStatus(e.code === 'login' || e.code === 'noclient' ? 'login' : 'error', e.message);
    throw e;
  } finally {
    // avisa as telas abertas
    if (changed.docs) S.emit('docs', null);
    if (changed.projects) S.emit('projects', null);
    if (changed.digest) S.emit('digest', await S.digest());
    if (changed.recordings) S.emit('recordings', null);
    if (changed.annots) for (const id of changed.annots) S.emit('annots', { docId: id, remote: true });
  }
  return Object.assign({ changed }, stats);
}

// baixa um arquivo só quando for preciso (modo "baixar só quando abrir")
export async function fetchFile(id) {
  const ss = await syncState();
  if (!ss.enabled || !ss.folderId) return false;
  const r = await call('GET', API + '/files?spaces=drive&fields=' + q('files(id,mimeType)') + '&q=' + q(`name='file-${id}' and '${ss.folderId}' in parents and trashed=false`));
  const f = ((await r.json()).files || [])[0];
  if (!f) return false;
  const blob = await download(f.id);
  await db.put('files', { id, blob: f.mimeType && blob.type !== f.mimeType ? new Blob([blob], { type: f.mimeType }) : blob });
  return true;
}

// ---------------- ligar/desligar ----------------
export async function enableSync() {
  const r = await syncNow({ interactive: true });
  await startAutoSync();
  return r;
}
export async function disableSync() {
  const ss = await syncState();
  const t = tok && tok.token;
  ss.enabled = false; ss.folderId = ''; ss.md5 = {}; ss.hash = {}; ss.email = '';
  await saveSyncState(ss);
  await forgetToken();
  if (t && !isAndroidApp) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch (e) {} }
  setStatus('off', '');
}
export async function syncInfo() { return syncState(); }

// sincroniza sozinho: ao abrir, ao voltar para o app, ao sair e alguns segundos depois de cada mudança
// carrega antes o script de login do Google (na web), para a janela abrir logo no toque
export async function preloadLogin() {
  if (isAndroidApp || window.__driveTestToken) return;
  const st = await S.settings();
  if (st.syncClientId) loadGis().catch(() => {});
}
let autoOn = false;
export async function startAutoSync() {
  const ss = await syncState();
  if (ss.enabled) preloadLogin();
  status.last = ss.last; status.email = ss.email;
  if (!ss.enabled) { setStatus('off', ''); return; }
  if (status.state === 'off') setStatus('idle', '');
  if (autoOn) return;
  autoOn = true;
  const run = async () => { if ((await syncState()).enabled) syncNow().catch(() => {}); };
  let t = null;
  // no e-ink (bateria e tela lenta) sincroniza com menos frequência
  const eink = () => !!document.documentElement.dataset.eink;
  S.on('dirty', () => { clearTimeout(t); t = setTimeout(run, eink() ? 60000 : 15000); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); else { clearTimeout(t); run(); } });
  let tick = 0;
  setInterval(() => { tick++; if (document.visibilityState === 'visible' && (!eink() || tick % 3 === 0)) run(); }, 5 * 60000);
  setTimeout(run, 1500);
}
