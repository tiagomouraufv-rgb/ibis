// Guarda os arquivos do app para funcionar sem internet. Seus dados ficam no IndexedDB, não aqui.
const CACHE = 'leitor-v0.6.0';
const FILES = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/store.js', 'js/pdfdoc.js', 'js/viewer.js', 'js/reader.js', 'js/library.js',
  'js/digestui.js', 'js/dialogs.js', 'js/export.js', 'js/obsidian.js', 'js/ai.js', 'js/prompts.js', 'js/audio.js', 'js/tts.js', 'js/digest-core.js', 'js/platform.js', 'js/textsel.js', 'js/lookup.js', 'js/md.js', 'js/notebook.js', 'js/sync.js', 'js/textdoc.js', 'js/mdedit.js', 'js/embeds.js', 'js/mathpal.js', 'js/refs.js',
  'vendor/pdf.min.mjs', 'vendor/marked.esm.js', 'vendor/purify.es.mjs', 'vendor/katex/katex.mjs', 'vendor/katex/katex.min.css', 'vendor/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js', 'vendor/fflate.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // IA, Crossref, fontes: direto pela rede
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return resp;
  })));
});
