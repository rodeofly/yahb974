// Version imprimable : tout ce qui vient de l'aventure est échappé (aucune balise active), élision correcte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAdventure, normalizeAdventure } from '../js/core/rules.js';
import { sectionHtml, effectText } from '../js/ui/print.js';

const EVIL = '<img src=x onerror=alert(1)>';

test('impression : aucune balise venue de l’aventure n’est interprétée', () => {
  const a = newAdventure('Piège');
  a.rules.stats = a.rules.stats.map(s => (s.id === 'habilete' ? { ...s, label: EVIL } : s));
  a.rules.classes = [{ id: 'mage', label: EVIL, rolls: {} }, { id: 'x', label: 'X', rolls: {} }];
  a.rules.spells = { enabled: true, stat: 'endurance', casters: ['mage'], book: [{ code: 'ZAP', name: 'Zap', cost: 1 }] };
  a.sections = {
    '1': { text: 'Départ', choices: [{ text: 'Aller', to: EVIL }], blocks: [
      { type: 'test', stat: 'habilete', dice: EVIL, success: EVIL, failure: '2' },
      { type: 'combat', enemies: [{ name: EVIL, skill: EVIL, health: EVIL }], win: EVIL, flee: '2', fleeAfter: EVIL, stopAt: EVIL },
      { type: 'roll', dice: EVIL, table: [{ min: EVIL, max: 3, to: EVIL, text: EVIL }] },
      { type: 'spells', options: [{ code: EVIL, to: EVIL }] },
      { type: 'shop', offers: [{ item: EVIL, price: 1, stock: EVIL }] },
    ], onEnter: [] },
    '2': { text: 'Fin', ending: 'victory', choices: [], blocks: [], onEnter: [] },
  };
  const adv = normalizeAdventure(a);
  const h = sectionHtml(adv.sections['1'], adv);
  assert.ok(!/<img/i.test(h), h);
  assert.ok(!/onerror=[^&]/.test(h.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')));
});

test('impression : « 1 point de CHANCE », « 2 points d’ENDURANCE »', () => {
  const adv = normalizeAdventure(newAdventure('Élision'));
  assert.match(effectText({ op: 'stat', stat: 'chance', add: -1 }, adv), /1 point de CHANCE/);
  assert.match(effectText({ op: 'stat', stat: 'endurance', add: -2 }, adv), /2 points d'ENDURANCE/);
  assert.match(effectText({ op: 'stat', stat: 'habilete', add: 1 }, adv), /1 point d'HABILETÉ/);
});
