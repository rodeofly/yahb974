// Greffons ensemble : vérifie qu'ils cohabitent dans un même combat, une même renumérotation, une même vérification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../js/plugins/core.js';
import { newAdventure, normalizeAdventure, createHero, start, choose, applyEffects, check } from '../js/core/rules.js';
import { startCombat, attackRound } from '../js/core/combat.js';
import { validate, renumber } from '../js/core/validate.js';
import { makeRng } from '../js/core/dice.js';
import { evaluateAchievements } from '../js/plugins/succes/core.js';

function sample() {
  const a = newAdventure('Tous les greffons');
  a.rules.equipment = { enabled: true, capacity: 0, unarmedPenalty: 4 };
  a.rules.counters = [{ id: 'reputation', label: 'Réputation', start: 0, min: 0, max: 10, visible: true, triggers: [] }];
  a.items = { epee: { name: 'Épée fine', slot: 'arme', attack: 1, damage: 1 }, rame: { name: 'Rame' } };
  a.companions = { kaya: { name: 'Kaya', skill: 9, health: 8 } };
  a.meta.worldMap = { image: 'images/monde.webp', places: { Marais: { x: 10, y: 10 } } };
  a.achievements = [
    { id: 'marais', title: 'Pieds mouillés', description: '', secret: false, when: 'anytime', ending: null, cond: { placeVisited: 'Marais' } },
    { id: 'passe', title: 'Passeur', description: '', secret: false, when: 'anytime', ending: null, cond: { visited: '5' } },
  ];
  a.sections = {
    '1': { text: 'Départ', onEnter: [{ op: 'give', item: 'epee' }, { op: 'companion', companion: 'kaya', action: 'join' }, { op: 'counter', counter: 'reputation', add: 2 }],
      blocks: [{ type: 'map', image: 'images/vallee.webp', alt: 'Vallée', hotspots: [{ x: 5, y: 5, w: 20, h: 20, label: 'Le marais', to: '2' }] }], choices: [] },
    '2': { text: 'Marais', place: 'Marais', onEnter: [], choices: [{ text: 'Vers le passeur', to: '3', if: { all: [{ companion: 'kaya' }, { counter: 'reputation', gte: 2 }, { equipped: 'epee' }] } }], blocks: [] },
    '3': { text: 'Passeur : combien vaut $\\frac{1}{2}+\\frac{1}{4}$ ?', onEnter: [], choices: [], blocks: [
      { type: 'challenge', kind: 'number', question: '$\\frac{1}{2}+\\frac{1}{4}$ ?', answers: { value: 0.75, tolerance: 0 }, attempts: 3, hints: [], success: '4', failure: '6' },
    ] },
    '4': { text: 'Barque', onEnter: [], choices: [], blocks: [
      { type: 'zefor', title: 'Parcours', url: 'https://zefor.example/#p', mode: 'code', codeHashes: ['0'.repeat(64)], codeSalt: 'x', success: '5', failure: '6' },
    ] },
    '5': { text: 'Troll', onEnter: [], choices: [], blocks: [{ type: 'combat', enemies: [{ name: 'Troll', skill: 8, health: 12 }], win: '7', lose: '6' }] },
    '6': { text: 'Perdu', ending: 'death', onEnter: [], choices: [], blocks: [] },
    '7': { text: 'Gagné', ending: 'victory', onEnter: [], choices: [], blocks: [] },
  };
  return normalizeAdventure(a);
}

test('La Tour de Brume se vérifie sans erreur avec tous les greffons chargés', () => {
  const adv = normalizeAdventure(JSON.parse(readFileSync(new URL('../adventures/la-tour-de-brume/adventure.json', import.meta.url))));
  assert.deepEqual(validate(adv).filter(p => p.level === 'error'), []);
  const { state } = createHero(adv, { seed: 3 });
  assert.equal(start(state, adv).state.section, adv.start);
});

test('effets et conditions de plusieurs greffons dans un même choix', () => {
  const adv = sample();
  assert.deepEqual(validate(adv).filter(p => p.level === 'error'), []);
  let s = start(createHero(adv, { seed: 5 }).state, adv).state;
  assert.equal(s.counters.reputation, 2);
  assert.deepEqual(s.companions.map(c => c.id), ['kaya']);
  s = start(s, adv, '2').state;
  assert.equal(check(adv.sections['2'].choices[0].if, s, adv), true, 'compagnon + compteur + équipement');
  assert.deepEqual(evaluateAchievements(adv, s, 'anytime'), ['marais'], 'succès « lieu visité » (carte + succès)');
});

test('combat : équipement et compagnon dans le même assaut', () => {
  const adv = sample();
  let s = start(createHero(adv, { seed: 9 }).state, adv).state;
  s = start(s, adv, '5').state;
  s.stats.endurance = { cur: 40, init: 40 };
  let f = startCombat(s, adv, 0);
  f = attackRound(f, adv);
  assert.deepEqual(f.combat.last.mods, { attack: 1, damage: 1, armor: 0 }, 'bonus de l’épée');
  assert.ok((f.combat.last.extra || []).some(t => /Kaya/.test(t)), 'Kaya frappe aussi : ' + JSON.stringify(f.combat.last.extra));
  for (let i = 0; i < 40 && !f.combat.over; i++) f = attackRound(f, adv);
  assert.ok(f.combat.over, 'le combat se termine');
});

test('renumérotation : cartes, défis, Zefor et succès suivent les nouveaux numéros', () => {
  const adv = sample();
  const rng = makeRng(4);
  const { adventure: out, mapping } = renumber(adv, () => rng());
  const m = id => mapping[id];
  assert.notDeepEqual(Object.entries(mapping).filter(([k, v]) => k !== v), [], 'les numéros ont changé');
  const sec = id => out.sections[m(id)];
  assert.equal(sec('1').blocks[0].hotspots[0].to, m('2'));
  assert.equal(sec('3').blocks[0].success, m('4'));
  assert.equal(sec('3').blocks[0].failure, m('6'));
  assert.equal(sec('4').blocks[0].success, m('5'));
  assert.equal(out.achievements[1].cond.visited, m('5'));
  assert.deepEqual(validate(out).filter(p => p.level === 'error'), []);
});
