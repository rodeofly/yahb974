// Analyse de la structure (graphe de l'éditeur) : journées et lieux hérités.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, dayCounter, inheritedPlaces } from '../js/core/analysis.js';

const book = (sections, counters = []) => ({ start: '1', rules: { counters }, sections });

test('journées : l’effet « nouveau jour » fait passer au jour suivant', () => {
  const A = analyze(book({
    '1': { choices: [{ text: 'a', to: '2' }] },
    '2': { onEnter: [{ op: 'newDay' }], choices: [{ text: 'b', to: '3' }] },
    '3': {},
  }));
  assert.deepEqual([A.day.get('1'), A.day.get('2'), A.day.get('3')], [1, 2, 2]);
  assert.equal(A.dayCounter, null);
});

test('journées : le compteur des jours (entrée d’un paragraphe ou choix emprunté)', () => {
  const jours = { id: 'jours', label: 'Jours de voyage', start: 1 };
  const A = analyze(book({
    '1': { choices: [{ text: 'Dormir', to: '2', effects: [{ op: 'counter', counter: 'jours', add: 1 }] }, { text: 'Marcher', to: '3' }] },
    '2': { choices: [{ text: 'c', to: '4' }] },
    '3': { onEnter: [{ op: 'counter', counter: 'jours', add: 1 }, { op: 'counter', counter: 'memoire', add: 1 }], choices: [{ text: 'd', to: '4' }] },
    '4': { onEnter: [{ op: 'counter', counter: 'jours', add: 1 }] },
  }, [{ id: 'memoire', label: 'Mémoire' }, jours]));
  assert.equal(A.dayCounter.id, 'jours');
  assert.deepEqual(['1', '2', '3', '4'].map(id => A.day.get(id)), [1, 2, 2, 3], 'le jour le plus tôt possible');
  assert.equal(dayCounter({ rules: { counters: [{ id: 'etapes', label: 'Étapes', days: true }] } }).id, 'etapes', 'marquage explicite');
  assert.equal(dayCounter({ rules: { counters: [{ id: 'memoire', label: 'Mémoire' }] } }), null);
});

test('lieux : un paragraphe sans lieu prend celui du paragraphe situé le plus proche qui y mène', () => {
  const adv = book({
    '1': { place: 'Puits ', choices: [{ text: 'a', to: '63' }, { text: 'b', to: '2' }] },
    '2': { place: 'Forêt', choices: [{ text: 'c', to: '64' }] },
    '63': { choices: [{ text: 'd', to: '64' }] },
    '64': {}, '99': {},
  });
  const p = inheritedPlaces(adv);
  assert.deepEqual(p.get('1'), { name: 'Puits', inherited: false });
  assert.deepEqual(p.get('63'), { name: 'Puits', inherited: true });
  assert.equal(p.get('64').name, 'Forêt');
  assert.equal(p.has('99'), false);
  assert.deepEqual([...analyze(adv).place.keys()].sort(), ['1', '2', '63', '64']);
});
