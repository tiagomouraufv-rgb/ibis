// Importar arquivos Markdown (.md) e de texto (.txt) como "textos" do app.
// Usado para trazer as folhas exportadas pelo MathTi (e qualquer outro .md): títulos, parágrafos, listas,
// tabelas e fórmulas ($...$ e $$...$$) aparecem formatados. Imagens:
// - embutidas no próprio .md (data:image/...;base64,...) entram no app;
// - arquivos de imagem ao lado do .md entram se você os escolher junto com o .md (mesmo nome do link);
// - links da internet (https://...) ficam como estão.
import * as S from './store.js';
import { createTextDoc } from './textdoc.js';

export const MD_RE = /\.(md|markdown|mdown|txt)$/i;
export const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
export const isMdFile = f => MD_RE.test(f.name || '') || /^text\/(markdown|x-markdown|plain)$/.test(f.type || '');
export const isImgFile = f => IMG_RE.test(f.name || '') || /^image\//.test(f.type || '');

const base = p => decodeURIComponent(String(p).split(/[\\/]/).pop() || '').toLowerCase();

function dataUrlToBlob(u) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(u);
  if (!m) return null;
  const bin = m[2] ? atob(m[3].replace(/\s+/g, '')) : decodeURIComponent(m[3]);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: m[1] });
}

// título: o primeiro "# título" do arquivo, ou o nome do arquivo
export function mdTitle(text, fileName) {
  const m = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(text || '');
  if (m) return m[1].replace(/[*_`]/g, '').trim().slice(0, 120);
  return String(fileName || 'Texto').replace(MD_RE, '').trim() || 'Texto';
}

// troca os links de imagem por imagens guardadas no app. store(blob) -> id. Devolve { md, kept, missing }
export async function mdLocalizeImages(text, images, store) {
  const byName = new Map((images || []).map(f => [base(f.name), f]));
  let md = String(text || '').replace(/\r\n?/g, '\n');
  let kept = 0; const missing = [];
  const re = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;
  const jobs = [];
  md.replace(re, (m, alt, src) => { jobs.push({ m, alt, src: src.replace(/^<|>$/g, '') }); return m; });
  for (const j of jobs) {
    let blob = null;
    if (/^data:image\//i.test(j.src)) blob = dataUrlToBlob(j.src);
    else if (/^(https?:|img:|audio:)/i.test(j.src)) { kept++; continue; }
    else { const f = byName.get(base(j.src)); if (f) blob = f; }
    if (!blob) { missing.push(j.src.startsWith('data:') ? '(imagem embutida inválida)' : j.src); continue; }
    try {
      const id = await store(blob);
      md = md.replace(j.m, '![' + j.alt.replace(/\|/g, ' ') + '](img:' + id + ')');
    } catch (e) { missing.push(j.src); }
  }
  // imagens em HTML (<img src="data:...">) embutidas
  const htmlJobs = [];
  md.replace(/<img\b[^>]*\bsrc\s*=\s*"(data:image\/[^"]+)"[^>]*>/gi, (m, src) => { htmlJobs.push({ m, src }); return m; });
  for (const j of htmlJobs) {
    const blob = dataUrlToBlob(j.src);
    if (!blob) continue;
    try { const id = await store(blob); md = md.replace(j.m, '![](img:' + id + ')'); } catch (e) { }
  }
  return { md, kept, missing };
}

// importa os .md/.txt escolhidos (as imagens escolhidas junto servem de figuras). Devolve os documentos criados
export async function importMarkdownFiles(mdFiles, imageFiles) {
  const NB = await import('./notebook.js');
  const out = [];
  for (const f of mdFiles) {
    const text = await f.text();
    const title = mdTitle(text, f.name);
    const r = await mdLocalizeImages(text, imageFiles, async b => (await NB.storeImage(b)).fileId);
    const doc = await createTextDoc(title);
    doc.md = r.md.trim() + '\n';
    doc.fileName = f.name;
    await S.saveDoc(doc, { noUndo: true });
    out.push({ doc, missing: r.missing });
  }
  return out;
}

// texto recebido de outro app parece um documento Markdown inteiro (ex.: folha do MathTi compartilhada como texto)?
export function looksLikeMdDoc(text, subject) {
  const t = String(text || '');
  if (/\.(md|markdown)$/i.test(subject || '')) return true;
  const heads = (t.match(/^#{1,6}\s+\S/mg) || []).length;
  return t.length > 120 && (heads >= 1 && t.split('\n').length >= 4 || /\$\$[\s\S]+\$\$/.test(t) || /^\|.+\|\s*$/m.test(t));
}
