// Son et voix, sans fichier ni serveur :
// - effets sonores synthétisés (Web Audio) : dés, coups, Chance, page, victoire, mort ;
// - ambiance : un fichier audio par paragraphe ou pour toute l'aventure, en fondu ;
// - lecture à voix haute (synthèse vocale du système, fonctionne hors ligne avec les voix installées).

import { prefs } from './common.js';

let ctx = null;
const ac = () => {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};
const vol = () => (prefs.get('sfx', true) ? prefs.get('sfxVolume', 0.6) : 0);

function tone({ f = 440, f2, t = 0.15, type = 'sine', g = 0.3, delay = 0 }) {
  const a = ac(); if (!a || !vol()) return;
  const o = a.createOscillator(), gain = a.createGain(), t0 = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + t);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(g * vol(), t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  o.connect(gain).connect(a.destination); o.start(t0); o.stop(t0 + t + 0.02);
}
function noise({ t = 0.05, g = 0.3, delay = 0, hp = 1500 }) {
  const a = ac(); if (!a || !vol()) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * t), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), gain = a.createGain();
  f.type = 'highpass'; f.frequency.value = hp; gain.gain.value = g * vol();
  src.buffer = buf; src.connect(f).connect(gain).connect(a.destination); src.start(a.currentTime + delay);
}

let lastDice = 0;
export const sfx = {
  dice: () => { const n = performance.now(); if (n - lastDice < 300) return; lastDice = n; for (let i = 0; i < 6; i++) noise({ t: 0.04, g: 0.35, delay: i * 0.07 + Math.random() * 0.03, hp: 2500 }); },
  hit: () => { noise({ t: 0.12, g: 0.5, hp: 600 }); tone({ f: 220, f2: 90, t: 0.18, type: 'triangle', g: 0.35 }); },
  wound: () => { tone({ f: 160, f2: 60, t: 0.3, type: 'sawtooth', g: 0.18 }); noise({ t: 0.15, g: 0.3, hp: 300 }); },
  luck: ok => ok ? [523, 659, 784].forEach((f, i) => tone({ f, t: 0.18, g: 0.2, delay: i * 0.08 })) : [392, 311].forEach((f, i) => tone({ f, t: 0.25, g: 0.2, type: 'triangle', delay: i * 0.12 })),
  page: () => noise({ t: 0.22, g: 0.12, hp: 3500 }),
  coin: () => { tone({ f: 1318, t: 0.08, g: 0.15 }); tone({ f: 1760, t: 0.2, g: 0.15, delay: 0.07 }); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone({ f, t: 0.35, g: 0.22, type: 'triangle', delay: i * 0.14 })),
  death: () => [330, 294, 262, 196].forEach((f, i) => tone({ f, t: 0.5, g: 0.2, type: 'sine', delay: i * 0.3 })),
  magic: () => { for (let i = 0; i < 8; i++) tone({ f: 600 + i * 140, t: 0.12, g: 0.1, delay: i * 0.04 }); },
};

/* ---------- ambiance ---------- */
let music = null, musicSrc = null;
export function ambience(url, loop = true) {
  const on = prefs.get('music', true);
  if (!on || !url) { fadeOut(); return; }
  if (url === musicSrc) return;
  fadeOut();
  const a = new Audio(url);
  a.loop = loop; a.volume = 0;
  musicSrc = url; music = a;
  a.play().then(() => fade(a, prefs.get('musicVolume', 0.4))).catch(() => { /* lecture refusée avant une interaction */ });
}
function fade(a, target, ms = 1200) {
  const start = a.volume, t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / ms); a.volume = start + (target - start) * k; if (k < 1) requestAnimationFrame(step); else if (!target) a.pause(); };
  requestAnimationFrame(step);
}
function fadeOut() { if (music) fade(music, 0); music = null; musicSrc = null; }
export const stopAmbience = fadeOut;

/* ---------- lecture à voix haute ---------- */
export const ttsAvailable = () => 'speechSynthesis' in window;
export function frenchVoices() {
  if (!ttsAvailable()) return [];
  return speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith('fr'));
}
export function speak(text, { onEnd } = {}) {
  if (!ttsAvailable()) return;
  speechSynthesis.cancel();
  const clean = text.replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim();
  // Découpage en phrases : certaines voix s'arrêtent sur les textes longs.
  const parts = clean.match(/[^.!?…]+[.!?…»]*\s*/g) || [clean];
  const name = prefs.get('voice', '');
  const voice = speechSynthesis.getVoices().find(v => v.name === name) || frenchVoices()[0] || null;
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = 'fr-FR'; if (voice) u.voice = voice;
    u.rate = prefs.get('rate', 1);
    if (i === parts.length - 1 && onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
  });
}
export const stopSpeaking = () => ttsAvailable() && speechSynthesis.cancel();
export const speaking = () => ttsAvailable() && speechSynthesis.speaking;
