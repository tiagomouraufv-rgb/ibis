// Gravações do Chrome/Android (WebM) saem sem a duração no arquivo: o player mostra um tempo errado
// e não deixa pular para um ponto. Aqui a duração real é medida e escrita no cabeçalho do arquivo.

function readVint(b, p, isId) {
  const first = b[p];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let v = isId ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  return { v, len, unknown: !isId && allOnes };
}
function vint8(n) {   // tamanho escrito sempre com 8 bytes
  const out = new Uint8Array(8); out[0] = 0x01;
  for (let i = 7; i >= 1; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
  return out;
}
function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// devolve os bytes com a duração (em segundos) escrita, ou null se não precisar/conseguir
export function patchWebmDuration(bytes, seconds) {
  const b = bytes;
  let p = 0;
  const ebml = readVint(b, p, true); if (!ebml || ebml.v !== 0x1A45DFA3) return null;
  const es = readVint(b, p + ebml.len); p += ebml.len + es.len + es.v;
  const seg = readVint(b, p, true); if (!seg || seg.v !== 0x18538067) return null;
  const segSizePos = p + seg.len;
  const ss = readVint(b, segSizePos);
  let q = segSizePos + ss.len;
  const segEnd = ss.unknown ? b.length : q + ss.v;
  while (q < segEnd) {
    const id = readVint(b, q, true); if (!id) return null;
    const sz = readVint(b, q + id.len); if (!sz) return null;
    const dataStart = q + id.len + sz.len;
    if (id.v === 0x1549A966) {   // Info
      const dataEnd = dataStart + sz.v;
      let r = dataStart, scale = 1e6, hasDur = false;
      while (r < dataEnd) {
        const cid = readVint(b, r, true), cs = readVint(b, r + cid.len);
        const cd = r + cid.len + cs.len;
        if (cid.v === 0x2AD7B1) { let v = 0; for (let i = 0; i < cs.v; i++) v = v * 256 + b[cd + i]; scale = v || 1e6; }
        if (cid.v === 0x4489) hasDur = true;
        r = cd + cs.v;
      }
      if (hasDur) return null;
      const dur = new Uint8Array(11); dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
      new DataView(dur.buffer).setFloat64(3, seconds * 1e9 / scale);
      const infoData = concat([b.subarray(dataStart, dataEnd), dur]);
      const newInfo = concat([b.subarray(q, q + id.len), vint8(infoData.length), infoData]);
      const delta = newInfo.length - (dataEnd - q);
      const segSize = ss.unknown ? b.subarray(segSizePos, segSizePos + ss.len) : vint8(ss.v + delta + (8 - ss.len));
      return concat([b.subarray(0, segSizePos), segSize, b.subarray(segSizePos + ss.len, q), newInfo, b.subarray(dataEnd)]);
    }
    if (id.v === 0x1F43B675) break;   // chegou nos clusters sem achar o Info
    q = dataStart + sz.v;
  }
  return null;
}

// mede a duração decodificando o áudio
async function measure(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return 0;
  const ctx = new AC();
  try { const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); return buf.duration; }
  catch (e) { return 0; }
  finally { try { ctx.close(); } catch (e) {} }
}

// devolve o blob com a duração certa (WebM); outros formatos voltam como estão
export async function withDuration(blob, knownSec) {
  if (!blob || !/webm/i.test(blob.type || '')) return blob;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sec = (await measure(blob)) || knownSec || 0;
    if (!(sec > 0)) return blob;
    const out = patchWebmDuration(bytes, sec);
    return out ? new Blob([out], { type: blob.type }) : blob;
  } catch (e) { return blob; }
}
