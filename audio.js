// Gravação de áudio: notas de voz e gravação de sessão sincronizada com a escrita.
import * as S from './store.js';
import { h, btn, modal, toast, fmtTime, uid } from './util.js';

function pickMime() {
  const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const m of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
export function audioExt(type) { return /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm'; }

async function startRec() {
  if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Este navegador não permite gravar áudio aqui.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.start(1000);
  return {
    mr, started: Date.now(),
    stop: () => new Promise(res => {
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })); };
      mr.stop();
    }),
  };
}

// Diálogo de nota de voz. Resolve com {audioId, duration} ou null.
export function recordVoiceNote(title = 'Nota de voz') {
  return new Promise(resolve => {
    let rec = null, timer = null, blob = null, dur = 0, done = false;
    const time = h('div.rec-time', '0:00');
    const status = h('div.muted', 'Toque em Gravar e fale. Toque em Parar quando terminar.');
    const player = h('audio', { controls: true, style: { width: '100%', display: 'none' } });
    const recBtn = btn('rec', 'Gravar', async () => {
      try {
        if (!rec) {
          rec = await startRec();
          recBtn.classList.add('recording'); recBtn.querySelector('span').textContent = 'Parar';
          status.textContent = 'Gravando…';
          timer = setInterval(() => { dur = (Date.now() - rec.started) / 1000; time.textContent = fmtTime(dur); }, 250);
        } else {
          clearInterval(timer);
          blob = await rec.stop(); rec = null;
          dur = Math.max(dur, 0.5);
          recBtn.classList.remove('recording'); recBtn.querySelector('span').textContent = 'Gravar de novo';
          status.textContent = 'Ouça e salve, ou grave de novo.';
          player.src = URL.createObjectURL(blob); player.style.display = 'block';
        }
      } catch (e) { status.textContent = 'Não foi possível usar o microfone: ' + (e.message || e.name) + '. Confira a permissão do microfone no Chrome.'; }
    }, { cls: 'pbtn big' });
    const m = modal(title, h('div.recbox', time, recBtn, status, player), [
      { label: 'Cancelar', onclick: c => { done = true; if (rec) rec.stop(); c(); resolve(null); } },
      { label: 'Salvar', primary: true, onclick: async c => {
        if (rec) { clearInterval(timer); blob = await rec.stop(); rec = null; }
        if (!blob) { toast('Grave alguma coisa antes de salvar.'); return; }
        done = true; c();
        const audioId = await S.saveAudio(blob);
        resolve({ audioId, duration: dur });
      } },
    ], { sticky: true, focus: false, onclose: () => { if (!done) { if (rec) rec.stop(); resolve(null); } } });
    void m;
  });
}

// Gravação de sessão: grava enquanto você escreve; cada traço guarda o instante.
export class SessionRecorder {
  constructor(onchange) { this.onchange = onchange; this.cur = null; }
  get active() { return !!this.cur; }
  async start(docId) {
    const rec = await startRec();
    this.cur = { rec, docId, id: uid('r'), started: rec.started };
    this.timer = setInterval(() => this.onchange && this.onchange(this), 1000);
    this.onchange && this.onchange(this);
  }
  elapsed() { return this.cur ? (Date.now() - this.cur.started) / 1000 : 0; }
  stamp(docId) { return this.cur && this.cur.docId === docId ? { id: this.cur.id, t: Date.now() - this.cur.started } : null; }
  async stop(title) {
    if (!this.cur) return null;
    clearInterval(this.timer);
    const c = this.cur; this.cur = null;
    const blob = await c.rec.stop();
    const fileId = await S.saveAudio(blob);
    const r = { id: c.id, docId: c.docId, fileId, started: c.started, duration: (Date.now() - c.started) / 1000, title: title || ('Gravação ' + new Date(c.started).toLocaleString('pt-BR')) };
    await S.saveRecording(r);
    this.onchange && this.onchange(this);
    return r;
  }
}

// Player flutuante simples
let floating = null;
export async function playAudio(fileId, fromSec = 0, label = '') {
  const blob = await S.audioBlob(fileId);
  if (!blob) { toast('Áudio não encontrado.'); return; }
  if (floating) floating.remove();
  const a = h('audio', { controls: true, autoplay: true, src: URL.createObjectURL(blob) });
  a.addEventListener('loadedmetadata', () => { if (fromSec > 0) { try { a.currentTime = Math.max(0, fromSec); } catch (e) {} } });
  floating = h('div.floatplayer', h('div.fp-label', label || 'Áudio'), a, btn('close', '', () => { a.pause(); floating.remove(); floating = null; }, { iconOnly: true, title: 'Fechar' }));
  document.body.appendChild(floating);
}
