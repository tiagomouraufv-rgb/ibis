// Leitura em voz alta com as vozes do próprio Android (funciona sem internet se a voz estiver instalada).
import * as S from './store.js';
import { h, btn, toast } from './util.js';
import { nativeTts } from './platform.js';

window.__ttsDone = () => { if (bar) { bar.remove(); bar = null; } };

let bar = null;

function guessLang(t) {
  const s = ' ' + t.toLowerCase() + ' ';
  const en = (s.match(/ (the|and|of|is|with|that|for|are|this) /g) || []).length;
  const pt = (s.match(/ (o|a|os|as|de|do|da|que|com|para|uma|não) /g) || []).length;
  return en > pt ? 'en-US' : 'pt-BR';
}

function chunks(t) {
  const out = [];
  const parts = t.replace(/\s+/g, ' ').split(/(?<=[.!?;:])\s+/);
  let cur = '';
  for (const p of parts) { if ((cur + ' ' + p).length > 220) { if (cur) out.push(cur); cur = p; } else cur = cur ? cur + ' ' + p : p; }
  if (cur) out.push(cur);
  return out;
}

export async function speak(text) {
  if (nativeTts) {
    text = String(text || '').trim();
    if (!text) { toast('Nada para ler.'); return; }
    stopSpeak();
    const st = await S.settings();
    const lang = guessLang(text);
    bar = h('div.ttsbar', h('span', 'Lendo em voz alta (' + (lang === 'en-US' ? 'inglês' : 'português') + ')'),
      btn('stop', '', () => stopSpeak(), { iconOnly: true, title: 'Parar' }));
    document.body.appendChild(bar);
    nativeTts.speak(text.replace(/\s+/g, ' '), lang, st.ttsRate || 1);
    return;
  }
  if (!('speechSynthesis' in window)) { toast('Este navegador não tem leitura em voz alta.'); return; }
  text = String(text || '').trim();
  if (!text) { toast('Nada para ler.'); return; }
  stopSpeak();
  const st = await S.settings();
  const lang = guessLang(text);
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang === lang) || voices.find(v => v.lang && v.lang.startsWith(lang.slice(0, 2)));
  const list = chunks(text);
  bar = h('div.ttsbar', h('span', 'Lendo em voz alta (' + (lang === 'en-US' ? 'inglês' : 'português') + ')'),
    btn('pause', '', () => { if (speechSynthesis.paused) speechSynthesis.resume(); else speechSynthesis.pause(); }, { iconOnly: true, title: 'Pausar / continuar' }),
    btn('stop', '', () => stopSpeak(), { iconOnly: true, title: 'Parar' }));
  document.body.appendChild(bar);
  list.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    u.lang = lang; if (voice) u.voice = voice; u.rate = st.ttsRate || 1;
    if (i === list.length - 1) u.onend = () => { if (bar) { bar.remove(); bar = null; } };
    speechSynthesis.speak(u);
  });
}

export function stopSpeak() {
  if (nativeTts) nativeTts.stop();
  else try { speechSynthesis.cancel(); } catch (e) {}
  if (bar) { bar.remove(); bar = null; }
}
