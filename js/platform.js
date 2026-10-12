// Ponte com o app Android (quando o app roda dentro do APK). No navegador, cai nas funções da web.
const N = window.AndroidBridge || null;
export const isAndroidApp = !!N;

let seq = 0;
const cbs = {};
window.__nativeCb = (id, ok, msg) => { const f = cbs[id]; delete cbs[id]; if (f) f({ ok: !!ok, msg: msg || '' }); };

export async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// Chamada a uma função da ponte que responde por window.__nativeCb(id, ok, msg)
export function nativeCall(fn, ...args) {
  const id = String(++seq);
  const p = new Promise(r => { cbs[id] = r; });
  N[fn](id, ...args);
  return p;
}

// Salvar: abre o "Salvar como" do Android (Downloads, Drive, OneDrive…). Resolve {ok, msg}.
export async function nativeSave(blob, name, mime) {
  const id = String(++seq);
  const p = new Promise(r => { cbs[id] = r; });
  N.saveFile(id, await blobToB64(blob), name, mime || blob.type || 'application/octet-stream');
  return p;
}

// Compartilhar arquivo pelo menu do Android
export async function nativeShareFile(blob, name, mime) {
  N.shareFile(await blobToB64(blob), name, mime || blob.type || 'application/octet-stream');
  return true;
}

export function shareText(text) {
  if (N) { N.shareText(text); return true; }
  return false;
}

// Links de sites: no APK abrem no navegador do tablet
export function openExternal(url) {
  if (N) N.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

// Endereços de apps (obsidian://…)
export function openUri(uri) {
  if (N) N.openExternal(uri);
  else window.location.href = uri;
}

export function nativeCopy(text) { if (N) { N.copyText(text); return true; } return false; }

// Voz do Android (o WebView não tem leitura em voz alta própria)
export const nativeTts = N ? {
  speak: (text, lang, rate) => N.speak(text, lang, rate),
  stop: () => N.stopSpeak(),
  pause: () => N.stopSpeak(),
} : null;
