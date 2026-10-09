// Forma do app conforme o aparelho: celular, tablet, desktop (Windows, DeX) e e-ink (Boox).
// Decide pela tela e pelo jeito de usar (dedo, caneta, mouse), não pelo nome do aparelho.
import * as S from './store.js';

let devCache = null;
// o Android avisa quando a configuração muda (DeX ligado, Fold aberto)
window.__devChanged = () => { devCache = null; applyForm(); };
export function deviceInfo() {
  if (devCache) return devCache;
  try { devCache = JSON.parse(window.AndroidBridge.deviceInfo()); } catch (e) { devCache = {}; }
  if (window.__fakeDevice) devCache = window.__fakeDevice;   // usado só nos testes
  return devCache;
}
export function isBoox() { const d = deviceInfo(); return /onyx|boox/i.test([d.manufacturer, d.brand, d.model].join(' ')); }

export const form = { form: 'tablet', eink: '', fine: false };

export function detect(st) {
  const w = innerWidth;
  const fine = matchMedia('(pointer: fine)').matches;
  const d = deviceInfo();
  const einkOn = st.einkMode === 'on' || (st.einkMode !== 'off' && isBoox());
  let profile = '';
  if (einkOn) profile = st.einkProfile === 'bw' || st.einkProfile === 'color' ? st.einkProfile : (/colou?r|c\b|kaleido/i.test(String(d.model || '')) ? 'color' : 'bw');
  // DeX (Samsung) conta como computador mesmo com janela menor
  const f = w < 600 ? 'phone' : ((fine || d.dex) && w >= (d.dex ? 800 : 1000) && !einkOn ? 'desktop' : 'tablet');
  return { form: f, eink: profile, fine };
}

export async function applyForm() {
  const st = await S.settings();
  const r = detect(st);
  const changed = r.form !== form.form || r.eink !== form.eink;
  Object.assign(form, r);
  const de = document.documentElement;
  de.dataset.form = r.form;
  if (r.eink) de.dataset.eink = r.eink; else delete de.dataset.eink;
  if (changed) S.emit('form', form);
  return form;
}

export function watchForm() {
  let t = null;
  const go = () => { clearTimeout(t); t = setTimeout(applyForm, 120); };
  addEventListener('resize', go);
  try { matchMedia('(pointer: fine)').addEventListener('change', go); } catch (e) {}
  S.on('settings', go);
  return applyForm();
}
