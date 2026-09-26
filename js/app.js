// Point d'entrée : navigation par l'ancre de l'URL (#/, #/jouer/<id>, #/ecrire/<id>/<paragraphe>).

import { html, render, useState, useEffect } from './lib/preact-htm.js';
import { Toasts, Confirm, applyPrefs, prefs, Icon, Modal } from './ui/common.js';
import './plugins/index.js';
import { Library } from './ui/library.js';
import { ui, sorted } from './ui/registry.js';
import { Play } from './ui/play.js';
import { Editor } from './ui/editor.js';
import { persist } from './store/db.js';
import { Print } from './ui/print.js';
import { speak, ttsAvailable, frenchVoices, stopAmbience, stopSpeaking } from './ui/audio.js';

function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'home', id: parts[1], sub: parts[2], query: Object.fromEntries(new URLSearchParams(query)) };
}

export const navigate = hash => { location.hash = hash; };

function Settings({ onClose }) {
  const [p, setP] = useState(() => ({
    theme: prefs.get('theme', 'system'), size: prefs.get('size', 19), justify: prefs.get('justify', true),
    sfx: prefs.get('sfx', true), music: prefs.get('music', true), tts: prefs.get('ttsAuto', false),
    voice: prefs.get('voice', ''), rate: prefs.get('rate', 1),
  }));
  const [voices, setVoices] = useState(frenchVoices());
  useEffect(() => { if (ttsAvailable()) speechSynthesis.onvoiceschanged = () => setVoices(frenchVoices()); }, []);
  const set = patch => setP(x => ({ ...x, ...patch }));
  useEffect(() => {
    prefs.set('theme', p.theme); prefs.set('size', p.size); prefs.set('justify', p.justify);
    prefs.set('sfx', p.sfx); prefs.set('music', p.music); prefs.set('ttsAuto', p.tts); prefs.set('voice', p.voice); prefs.set('rate', p.rate);
    applyPrefs();
    if (!p.music) stopAmbience();
  }, [p]);
  return html`<${Modal} title="Réglages" onClose=${onClose}>
    <div class="grid2">
      <label class="field">Thème
        <select value=${p.theme} onChange=${e => set({ theme: e.target.value })}>
          <option value="system">Comme l'appareil</option><option value="light">Clair</option><option value="dark">Sombre</option>
        </select></label>
      <label class="field">Taille du texte : ${p.size} px
        <input type="range" min="15" max="28" value=${p.size} onInput=${e => set({ size: +e.target.value })} /></label>
    </div>
    <label class="row"><input type="checkbox" checked=${p.justify} onChange=${e => set({ justify: e.target.checked })} /> Texte justifié (avec césure)</label>
    <h3>Son</h3>
    <label class="row"><input type="checkbox" checked=${p.sfx} onChange=${e => set({ sfx: e.target.checked })} /> Effets sonores (dés, coups, Chance…)</label>
    <label class="row"><input type="checkbox" checked=${p.music} onChange=${e => set({ music: e.target.checked })} /> Ambiances sonores des aventures</label>
    <h3>Lecture à voix haute</h3>
    ${ttsAvailable() ? html`
      <label class="row"><input type="checkbox" checked=${p.tts} onChange=${e => set({ tts: e.target.checked })} /> Lire automatiquement chaque paragraphe</label>
      <div class="grid2">
        <label class="field">Voix
          <select value=${p.voice} onChange=${e => set({ voice: e.target.value })}>
            <option value="">Voix française par défaut</option>
            ${voices.map(v => html`<option value=${v.name}>${v.name}</option>`)}
          </select></label>
        <label class="field">Vitesse : ${p.rate.toFixed(1)}
          <input type="range" min="0.6" max="1.6" step="0.1" value=${p.rate} onInput=${e => set({ rate: +e.target.value })} /></label>
      </div>
      <div><button class="btn small" onClick=${() => speak('Vous vous éveillez à l’aube. Votre aventure commence.')}><${Icon} name="speaker" />Essayer la voix</button></div>
      ${!voices.length && html`<p class="subtle">Aucune voix française n'est installée sur cet appareil : la voix par défaut sera utilisée.</p>`}`
    : html`<p class="subtle">Ce navigateur ne propose pas la synthèse vocale.</p>`}
    ${sorted(ui.settings).map(x => html`<${x.Panel} prefs=${p} set=${set} />`)}
    <p class="subtle">Les aventures, images et parties sont enregistrées dans ce navigateur. Exportez vos aventures (.lhz) pour les sauvegarder ailleurs.</p>
  <//>`;
}

function App() {
  const [route, setRoute] = useState(parseRoute());
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const on = () => { const r = parseRoute(); setRoute(r); window.scrollTo(0, 0); if (r.name !== 'jouer') { stopAmbience(); stopSpeaking(); } };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  let screen;
  if (route.name === 'jouer' && route.id) screen = html`<${Play} key=${route.id + JSON.stringify(route.query)} id=${route.id} query=${route.query} />`;
  else if (route.name === 'imprimer' && route.id) screen = html`<${Print} key=${route.id} id=${route.id} query=${route.query} />`;
  else if (ui.routes.has(route.name)) { const P = ui.routes.get(route.name); screen = html`<${P} key=${location.hash} id=${route.id} sub=${route.sub} query=${route.query} />`; }
  else if (route.name === 'ecrire' && route.id) screen = html`<${Editor} key=${route.id} id=${route.id} sectionId=${route.sub} />`;
  else screen = html`<${Library} />`;
  return html`
    <header class="topbar no-print">
      <a class="brand" href="#/">Livre-Héros</a>
      <span class="spacer"></span>
      <button class="btn ghost small" onClick=${() => setSettings(true)} aria-label="Réglages"><${Icon} name="gear" /></button>
    </header>
    ${screen}
    ${settings && html`<${Settings} onClose=${() => setSettings(false)} />`}
    <${Toasts} /><${Confirm} />`;
}

applyPrefs();
persist();
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* l'application marche aussi sans */ });
}
