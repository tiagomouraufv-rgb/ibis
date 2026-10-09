// Armazenamento no próprio aparelho (IndexedDB). Nada sai do tablet por aqui.
const DB_NAME = 'leitor-pesquisa';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts', { keyPath: 'docId' });
      if (!d.objectStoreNames.contains('annots')) {
        const s = d.createObjectStore('annots', { keyPath: 'id' });
        s.createIndex('docId', 'docId');
      }
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('recordings')) {
        const s = d.createObjectStore('recordings', { keyPath: 'id' });
        s.createIndex('docId', 'docId');
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('abortado'));
  });
}

export const db = {
  async get(store, key) { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)); },
  async keys(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAllKeys()); },
  async all(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()); },
  async byIndex(store, index, value) { const d = await open(); return req(d.transaction(store).objectStore(store).index(index).getAll(value)); },
  put(store, value) { return tx(store, 'readwrite', s => { s.put(value); }); },
  putMany(store, values) { return tx(store, 'readwrite', s => { values.forEach(v => s.put(v)); }); },
  del(store, key) { return tx(store, 'readwrite', s => { s.delete(key); }); },
  delMany(store, keys) { return tx(store, 'readwrite', s => { keys.forEach(k => s.delete(k)); }); },
  async kvGet(k, dflt) { const r = await this.get('kv', k); return r ? r.v : dflt; },
  kvSet(k, v) { return this.put('kv', { k, v }); },
};

// pede ao navegador para não apagar os dados quando faltar espaço
export async function persistStorage() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
