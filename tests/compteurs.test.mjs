import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/compteurs/core.js';
import {
  counterValue, clamp, crossedTriggers, parseAmount, counterProblems, counterUsage, renameCounter, freeId, de,
  describeCounterEffect, printCounterEffect, describeCounterCond, printCounterCond,
} from '../js/plugins/compteurs/core.js';
import { newAdventure, normalizeAdventure, createHero, start, choose, choicesFor, applyEffects, check, back, enter, useItem, describeEffect, describeCondition } from '../js/core/rules.js';
import { validate } from '../js/core/validate.js';

function sample(counters) {
  const a = newAdventure('Compteurs');
  a.rules.counters = counters ?? [
    { id: 'reputation', label: 'Réputation', start: 2, min: 0, max: 10, icon: 'star',
      triggers: [{ when: 'gte', value: 5, action: 'message', message: 'On chante vos exploits.' }, { when: 'gte', value: 10, action: 'victory', message: 'Le roi vous anoblit.' }] },
    { id: 'temps', label: 'Temps', start: '1d6+6', min: 0, icon: 'hourglass',
      triggers: [{ when: 'lte', value: 0, action: 'death', message: 'Le soleil se couche : trop tard.' }] },
    { id: 'suspicion', label: 'Suspicion', start: 0, visible: false, triggers: [] },
  ];
  a.items = { amulette: { name: 'Amulette', use: [{ op: 'counter', counter: 'temps', add: 2 }] } };
  a.sections = {
    '1': { text: 'Départ', choices: [
      { text: 'Aider', to: '2', effects: [{ op: 'counter', counter: 'reputation', add: 3 }] },
      { text: 'Porte du château', to: '3', if: { counter: 'reputation', gte: 5 } },
    ] },
    '2': { text: 'Village', onEnter: [{ op: 'counter', counter: 'temps', add: -1 }], choices: [{ text: 'Retour', to: '1' }] },
    '3': { text: 'Château', ending: 'victory' },
  };
  return normalizeAdventure(a);
}

const hero = (adv, seed = 1) => createHero(adv, { seed }).state;
const fx = (state, adv, e) => applyEffects(state, adv, Array.isArray(e) ? e : [e]);

test('normalisation : une aventure sans compteurs reste jouable', () => {
  const adv = normalizeAdventure(newAdventure('Vide'));
  assert.deepEqual(adv.rules.counters, []);
  const s = hero(adv);
  assert.deepEqual(s.counters, {});
  const r = start(s, adv);
  assert.equal(r.state.section, '1');
});

test('normalisation : valeurs par défaut (visible, déclencheurs, départ)', () => {
  const adv = sample([{ id: 'x', label: 'X' }]);
  assert.deepEqual(adv.rules.counters[0], { id: 'x', label: 'X', start: 0, visible: true, triggers: [] });
  assert.equal(sample([{ id: 'y', label: 'Y', visible: false }]).rules.counters[0].visible, false);
});

test('départ fixe et départ aux dés (graine de la partie)', () => {
  const adv = sample();
  const s = hero(adv, 4);
  assert.equal(s.counters.reputation, 2);
  assert.equal(s.counters.suspicion, 0);
  assert.ok(s.counters.temps >= 7 && s.counters.temps <= 12);
  assert.equal(hero(adv, 4).counters.temps, s.counters.temps, 'même graine, même tirage');
  const seen = new Set(Array.from({ length: 60 }, (_, i) => hero(adv, i + 1).counters.temps));
  assert.ok(seen.size >= 4, 'les dés varient selon la graine');
});

test('départ ramené dans les bornes', () => {
  const adv = sample([{ id: 'a', label: 'A', start: 15, min: 0, max: 10 }, { id: 'b', label: 'B', start: '-3', min: 0 }]);
  const s = hero(adv);
  assert.equal(s.counters.a, 10);
  assert.equal(s.counters.b, 0);
});

test('bornes : ajout, retrait, valeur fixée, sans borne', () => {
  const adv = sample([{ id: 'r', label: 'Réputation', start: 8, min: 0, max: 10 }, { id: 'libre', label: 'Libre', start: 0 }]);
  const s = hero(adv);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'r', add: 5 }).state.counters.r, 10);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'r', add: -20 }).state.counters.r, 0);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'r', set: 42 }).state.counters.r, 10);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'r', set: 3, add: 1 }).state.counters.r, 4);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'libre', add: -7 }).state.counters.libre, -7);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'libre', add: 1000 }).state.counters.libre, 1000);
  assert.equal(clamp({ min: 0, max: '' }, 99), 99, 'un champ vide n’est pas une borne');
  assert.equal(s.counters.r, 8, 'l’état reçu n’est jamais modifié');
});

test('effet : messages (et silence pour un compteur secret)', () => {
  const adv = sample();
  const s = hero(adv);
  const r = fx(s, adv, { op: 'counter', counter: 'reputation', add: 1 });
  assert.deepEqual(r.messages.map(m => m.kind), ['gain']);
  assert.match(r.messages[0].text, /\+1 Réputation.*3/);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'reputation', add: -1 }).messages[0].kind, 'loss');
  const hidden = fx(s, adv, { op: 'counter', counter: 'suspicion', add: 2 });
  assert.equal(hidden.state.counters.suspicion, 2);
  assert.equal(hidden.messages.length, 0);
  assert.equal(fx(s, adv, { op: 'counter', counter: 'inconnu', add: 2 }).state.counters.inconnu, undefined);
});

test('effet aux dés : ajout et retrait, reproductible, la graine avance', () => {
  const adv = sample([{ id: 't', label: 'Temps', start: 20 }]);
  const s = hero(adv, 9);
  const a = fx(s, adv, { op: 'counter', counter: 't', add: '1d6' });
  const b = fx(s, adv, { op: 'counter', counter: 't', add: '1d6' });
  assert.equal(a.state.counters.t, b.state.counters.t);
  assert.ok(a.state.counters.t >= 21 && a.state.counters.t <= 26);
  assert.notEqual(a.state.rng, s.rng);
  const c = fx(s, adv, { op: 'counter', counter: 't', add: '-2d6' });
  assert.ok(c.state.counters.t >= 8 && c.state.counters.t <= 18);
  assert.deepEqual(parseAmount('-1d6'), { dice: '1d6', sign: -1 });
  assert.deepEqual(parseAmount('+3'), { fixed: 3 });
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
});

test('déclencheur « message » : seulement au franchissement du seuil', () => {
  const adv = sample();
  let s = hero(adv);
  let r = fx(s, adv, { op: 'counter', counter: 'reputation', add: 3 }); // 2 → 5
  assert.ok(r.messages.some(m => m.kind === 'info' && m.text === 'On chante vos exploits.'));
  r = fx(r.state, adv, { op: 'counter', counter: 'reputation', add: 1 }); // 5 → 6 : déjà au-dessus
  assert.ok(!r.messages.some(m => m.kind === 'info'));
  r = fx(r.state, adv, { op: 'counter', counter: 'reputation', add: -3 }); // 6 → 3
  r = fx(r.state, adv, { op: 'counter', counter: 'reputation', add: 2 }); // 3 → 5 : de nouveau franchi
  assert.ok(r.messages.some(m => m.text === 'On chante vos exploits.'));
  assert.equal(r.state.ended, null);
  assert.deepEqual(crossedTriggers({ triggers: [{ when: 'lte', value: 0 }] }, 1, 0).length, 1);
  assert.deepEqual(crossedTriggers({ triggers: [{ when: 'lte', value: 0 }] }, 0, -1).length, 0);
});

test('déclencheur « mort »', () => {
  const adv = sample();
  const s = hero(adv);
  const r = fx(s, adv, { op: 'counter', counter: 'temps', add: -50 });
  assert.equal(r.state.counters.temps, 0);
  assert.equal(r.state.ended, 'death');
  assert.equal(r.state.endReason, 'Le soleil se couche : trop tard.');
});

test('déclencheur « victoire » et message par défaut', () => {
  const adv = sample();
  const r = fx(hero(adv), adv, { op: 'counter', counter: 'reputation', set: 10 });
  assert.equal(r.state.ended, 'victory');
  assert.equal(r.state.endReason, 'Le roi vous anoblit.');
  const adv2 = sample([{ id: 'm', label: 'Malédiction', start: 0, triggers: [{ when: 'gte', value: 3, action: 'death' }] }]);
  const r2 = fx(hero(adv2), adv2, { op: 'counter', counter: 'm', add: 3 });
  assert.equal(r2.state.ended, 'death');
  assert.equal(r2.state.endReason, 'Votre Malédiction a atteint 3.');
});

test('une fin déjà atteinte n’est pas remplacée', () => {
  const adv = sample([{ id: 'a', label: 'A', start: 0, triggers: [{ when: 'gte', value: 1, action: 'death', message: 'mort' }, { when: 'gte', value: 1, action: 'victory', message: 'gagné' }] }]);
  const r = fx(hero(adv), adv, { op: 'counter', counter: 'a', add: 1 });
  assert.equal(r.state.ended, 'death');
  assert.equal(r.state.endReason, 'mort');
});

test('conditions : gte, lte, eq, intervalle', () => {
  const adv = sample();
  const s = { ...hero(adv), counters: { reputation: 3, temps: 5, suspicion: 0 } };
  assert.ok(check({ counter: 'reputation', gte: 3 }, s, adv));
  assert.ok(!check({ counter: 'reputation', gte: 4 }, s, adv));
  assert.ok(check({ counter: 'reputation', lte: 3 }, s, adv));
  assert.ok(!check({ counter: 'reputation', lte: 2 }, s, adv));
  assert.ok(check({ counter: 'reputation', eq: 3 }, s, adv));
  assert.ok(!check({ counter: 'reputation', eq: 4 }, s, adv));
  assert.ok(check({ counter: 'reputation', gte: 2, lte: 4 }, s, adv));
  assert.ok(!check({ counter: 'reputation', gte: 4, lte: 6 }, s, adv));
  assert.ok(check({ all: [{ counter: 'temps', gte: 5 }, { not: { counter: 'suspicion', gte: 1 } }] }, s, adv));
});

test('conditions : choix bloqué avec la raison, puis débloqué', () => {
  const adv = sample();
  let { state } = start(hero(adv), adv);
  let ch = choicesFor(state, adv);
  assert.equal(ch[1].available, false);
  assert.equal(ch[1].reason, 'Il faut avoir au moins 5 points de Réputation.');
  ({ state } = choose(state, adv, 0)); // +3 Réputation → 5, message
  assert.equal(state.counters.reputation, 5);
  ({ state } = choose(state, adv, 0)); // retour au 1
  ch = choicesFor(state, adv);
  assert.equal(ch[1].available, true);
  const prev = back(state);
  assert.equal(prev.section, '2');
});

test('effets d’entrée et objets utilisables', () => {
  const adv = sample();
  let { state } = start(hero(adv, 2), adv);
  const t0 = state.counters.temps;
  ({ state } = choose(state, adv, 0));
  assert.equal(state.counters.temps, t0 - 1);
  const u = useItem({ ...state, inventory: { amulette: 1 } }, adv, 'amulette');
  assert.equal(u.state.counters.temps, t0 + 1, 'l’amulette rend 2 points de Temps');
  assert.equal(u.state.inventory.amulette, undefined);
});

test('ancienne sauvegarde sans compteurs : valeur de repli puis création à l’entrée d’un paragraphe', () => {
  const adv = sample();
  const old = hero(adv);
  delete old.counters;
  assert.equal(counterValue(old, adv, 'reputation'), 2);
  assert.equal(counterValue(old, adv, 'temps'), 7, 'minimum de 1d6+6 sans lancer de dé');
  assert.ok(check({ counter: 'reputation', gte: 2 }, old, adv));
  const r = enter({ ...old, section: '1' }, adv, '3');
  assert.equal(typeof r.state.counters.temps, 'number');
  assert.equal(r.state.counters.reputation, 2);
  const e = fx(old, adv, { op: 'counter', counter: 'reputation', add: 1 });
  assert.equal(e.state.counters.reputation, 3);
});

test('textes : éditeur, raison, livre imprimé', () => {
  const adv = sample([...sample().rules.counters, { id: 'honneur', label: 'Honneur', start: 0 }]);
  assert.equal(describeEffect({ op: 'counter', counter: 'reputation', add: 1 }, adv), '+1 Réputation');
  assert.equal(describeCounterEffect({ op: 'counter', counter: 'temps', add: '-1d6' }, adv), '−1d6 Temps');
  assert.equal(describeCounterEffect({ op: 'counter', counter: 'temps', set: 3 }, adv), 'Temps = 3');
  assert.equal(printCounterEffect({ op: 'counter', counter: 'reputation', add: 1 }, adv), 'ajoutez 1 point de Réputation sur votre Feuille d\'Aventure, sans dépasser 10.');
  assert.equal(printCounterEffect({ op: 'counter', counter: 'temps', add: -2 }, adv), 'retirez 2 points de Temps sur votre Feuille d\'Aventure, sans descendre sous 0.');
  assert.equal(printCounterEffect({ op: 'counter', counter: 'honneur', add: 3 }, adv), 'ajoutez 3 points d\'Honneur sur votre Feuille d\'Aventure.');
  assert.match(printCounterEffect({ op: 'counter', counter: 'temps', add: '1d6' }, adv), /^lancez un dé : ajoutez le résultat à votre total de Temps/);
  assert.match(printCounterEffect({ op: 'counter', counter: 'suspicion', add: 1 }, adv), /Autres compteurs/);
  assert.match(printCounterEffect({ op: 'counter', counter: 'temps', set: 12 }, adv), /^votre Temps passe à 12/);
  assert.equal(describeCondition({ counter: 'reputation', gte: 3 }, adv), 'avoir au moins 3 points de Réputation');
  assert.equal(describeCounterCond({ counter: 'temps', lte: 1 }, adv), 'avoir au plus 1 point de Temps');
  assert.equal(describeCounterCond({ counter: 'honneur', eq: 0 }, adv), 'avoir exactement 0 point d\'Honneur');
  assert.equal(printCounterCond({ counter: 'reputation', gte: 3 }, adv), 'votre Réputation est de 3 ou plus');
  assert.equal(printCounterCond({ counter: 'reputation', lte: 3 }, adv), 'votre Réputation est de 3 ou moins');
  assert.equal(printCounterCond({ counter: 'reputation', eq: 3 }, adv), 'votre Réputation est exactement de 3');
  assert.equal(printCounterCond({ counter: 'reputation', gte: 2, lte: 4 }, adv), 'votre Réputation est entre 2 et 4');
  assert.equal(de('Énergie'), 'd\'Énergie');
  assert.equal(de('Honte'), 'de Honte');
});

test('vérification : compteur inconnu, effet vide, formule invalide', () => {
  const adv = sample();
  assert.equal(validate(adv).filter(p => p.level === 'error').length, 0);
  adv.sections['2'].onEnter.push({ op: 'counter', counter: 'fantome', add: 1 }, { op: 'counter', counter: 'temps', add: 'deux' }, { op: 'counter', counter: 'temps' });
  adv.sections['1'].choices.push({ text: 'x', to: '3', if: { counter: 'ghost', gte: 1 } });
  const p = validate(adv);
  assert.ok(p.some(x => x.level === 'error' && /fantome/.test(x.message)));
  assert.ok(p.some(x => x.level === 'error' && /ghost/.test(x.message)));
  assert.ok(p.some(x => x.level === 'error' && /deux/.test(x.message)));
  assert.ok(p.some(x => x.level === 'warning' && /ne change rien/.test(x.message)));
});

test('problèmes de définition des compteurs', () => {
  const adv = sample([
    { id: 'a', label: 'A', start: 0, min: 5, max: 2 },
    { id: 'a', label: 'Doublon', start: 0 },
    { id: 'b', label: 'B', start: 'xyz' },
    { id: 'c', label: 'C', start: 3, min: 0, max: 5, triggers: [{ when: 'gte', value: 9, action: 'victory' }, { when: 'lte', value: 3, action: 'death' }, { when: 'gte', value: 4, action: 'message', message: '' }] },
  ]);
  const p = counterProblems(adv);
  assert.ok(p.some(x => x.level === 'error' && /minimum/.test(x.message)));
  assert.ok(p.some(x => x.level === 'error' && /plusieurs/.test(x.message)));
  assert.ok(p.some(x => x.level === 'error' && /xyz/.test(x.message)));
  assert.ok(p.some(x => x.id === 'c' && /jamais/.test(x.message)));
  assert.ok(p.some(x => x.id === 'c' && /déjà vraie/.test(x.message)));
  assert.ok(p.some(x => x.id === 'c' && /message vide/.test(x.message)));
  assert.deepEqual(counterProblems(sample()).filter(x => x.level !== 'info'), []);
});

test('usages, renommage et identifiant libre', () => {
  const adv = sample();
  assert.deepEqual(counterUsage(adv, 'reputation').map(u => u.label), ['paragraphe 1']);
  assert.deepEqual(counterUsage(adv, 'temps').map(u => u.label), ['paragraphe 2', 'objet Amulette']);
  const b = renameCounter(adv, 'reputation', 'renommee');
  assert.equal(b.rules.counters[0].id, 'renommee');
  assert.equal(b.sections['1'].choices[0].effects[0].counter, 'renommee');
  assert.equal(b.sections['1'].choices[1].if.counter, 'renommee');
  assert.equal(adv.sections['1'].choices[0].effects[0].counter, 'reputation', 'l’original reste intact');
  assert.throws(() => renameCounter(adv, 'reputation', 'temps'));
  assert.equal(validate(b).filter(p => p.level === 'error').length, 0);
  assert.equal(freeId(adv, 'Réputation'), 'reputation-2');
  assert.equal(freeId(adv, 'Savoir'), 'savoir');
});
