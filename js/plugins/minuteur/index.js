// Greffon « minuteur » — interface : le bouton qui lance le compte à rebours, l'anneau qui se vide, la fin annoncée
// (petit son, vibration sur tablette, phrase « à toi »). L'éditeur règle la durée et les deux phrases.
// Le moteur (durée, vérification, impression) est dans ./core.js. Voir docs/plugins/minuteur.md.

import { html, useState, useEffect } from '../../lib/preact-htm.js';
import { Icon, loadCSS } from '../../ui/common.js';
import { sfx } from '../../ui/audio.js';
import { registerBlockUI } from '../../ui/registry.js';
import { Text, Num } from '../../ui/editor.js';
import { TYPE, secondsOf } from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

function TimerPlayer({ block }) {
  const total = secondsOf(block);
  const [left, setLeft] = useState(null); // null : pas lancé ; puis total → 0
  useEffect(() => {
    if (left === null || left <= 0) return undefined;
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  useEffect(() => { if (left === 0) { sfx.arrive?.(); try { navigator.vibrate?.(90); } catch { /* sans vibreur */ } } }, [left]);
  const label = block.label || `Attendre ${total} s`;
  const text = left === null ? label : left > 0 ? 'J’attends…' : (block.after || 'C’est le moment : relance si besoin.');
  return html`<div class=${'timer-block' + (left === 0 ? ' done' : left ? ' running' : '')}>
    <button type="button" class="timer-go" onClick=${() => setLeft(total)} aria-label=${left ? `${label} : en cours` : `${label} : lancer`}>
      <span class="timer-ring" style=${`--p:${left === null ? 1 : left / total}`} aria-hidden="true"><b>${left === null ? total : left}</b></span>
      <span class="timer-text" aria-live="polite">${text}</span>
      ${left === 0 && html`<span class="timer-again" aria-hidden="true"><${Icon} name="play" /></span>`}
    </button>
  </div>`;
}

function TimerEditor({ block: b, set }) {
  return html`<div class="grid2">
    <${Num} label="Durée (secondes)" value=${b.seconds ?? 5} onChange=${v => set({ seconds: v })} />
    <${Text} label="Sur le bouton" value=${b.label} onChange=${v => set({ label: v || undefined })} placeholder="Les 5 secondes" />
    <${Text} label="À la fin" value=${b.after} onChange=${v => set({ after: v || undefined })} placeholder="C’est le moment : relance si besoin." />
  </div>`;
}

registerBlockUI(TYPE, {
  label: 'Minuteur',
  icon: 'timer',
  keepInFocus: true, // reste visible en mode saisie (le temps d'attente sert pendant la saisie)
  order: 60,
  create: () => ({ seconds: 5, label: '', after: '' }),
  Player: TimerPlayer,
  speech: b => `${b.label || 'Minuteur'} : ${secondsOf(b)} secondes.`,
  Editor: TimerEditor,
});
