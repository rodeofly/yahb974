// Greffon « minuteur » — moteur pur (aucun DOM, testable dans Node).
// Bloc { type: 'timer', seconds: 5, label?, after? } : un compte à rebours pour celui qui lit (le temps d'attente
// avant de relancer un élève, un sablier de jeu…). Il ne change rien à la partie : ni effet, ni destination.
// Voir docs/plugins/minuteur.md.

import { registerBlock } from '../../core/plugins.js';
import { tutoie } from '../../core/rules.js';

export const TYPE = 'timer';

/** Durée du minuteur, en secondes (5 par défaut, de 1 à 600). */
export const secondsOf = b => Math.max(1, Math.min(600, Math.round(Number(b?.seconds) || 5)));

registerBlock(TYPE, {
  targets: () => [],
  remap: b => b,
  validate(b, adv, report, where) {
    const n = Number(b.seconds);
    if (b.seconds !== undefined && (!Number.isFinite(n) || n < 1 || n > 600)) report('warning', `${where} : durée du minuteur ramenée entre 1 et 600 secondes (${secondsOf(b)} s).`);
  },
  print(b, adv, h) {
    const s = secondsOf(b);
    return `<p class="pr-block"><b>${h.esc(b.label || 'Temps d’attente')}</b> : ${tutoie(adv) ? 'compte' : 'comptez'} ${s} seconde${s > 1 ? 's' : ''} dans ${tutoie(adv) ? 'ta' : 'votre'} tête.</p>`;
  },
});
