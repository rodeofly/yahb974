// Greffon « minuteur » : durée bornée, vérification, impression ; le bloc ne change rien à la partie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secondsOf } from '../js/plugins/minuteur/core.js';
import { newAdventure, normalizeAdventure } from '../js/core/rules.js';
import { validate } from '../js/core/validate.js';
import { sectionHtml } from '../js/ui/print.js';

test('minuteur : durée par défaut et bornes', () => {
  assert.equal(secondsOf({}), 5);
  assert.equal(secondsOf({ seconds: 12 }), 12);
  assert.equal(secondsOf({ seconds: 0 }), 5);
  assert.equal(secondsOf({ seconds: 9999 }), 600);
});

test('minuteur : vérifié sans erreur, imprimé en consigne, tutoiement', () => {
  const a = newAdventure('Minuteur');
  a.rules.tu = true;
  a.sections = { '1': { text: 'Zone', blocks: [{ type: 'timer', seconds: 5, label: 'Les 5 secondes' }], choices: [{ text: 'Fin', to: '2' }] },
    '2': { text: 'Fin', ending: 'victory' } };
  const adv = normalizeAdventure(a);
  assert.ok(!validate(adv).some(r => r.level === 'error' && /minuteur|timer/i.test(r.message)), JSON.stringify(validate(adv)));
  assert.match(sectionHtml(adv.sections['1'], adv), /Les 5 secondes<\/b>[\s\u00a0\u202f]:[\s\u00a0]compte 5 secondes dans ta tête/);
});
