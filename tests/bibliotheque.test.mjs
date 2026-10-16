// Bibliothèque rangée par rayons (séries) : ordre des rayons, des tomes, et rayon des aventures sans série.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelvesOf } from '../js/store/library.js';

test('rayons : ordre d’apparition, tomes par numéro, aventures sans série à la fin', () => {
  const items = [
    { id: 'b2', title: 'B 2', series: 'Série B', seriesOrder: 2, source: 'bundled' },
    { id: 'x', title: 'X', source: 'local' },
    { id: 'a1', title: 'A 1', series: 'Série A', seriesNote: 'Présentation A', source: 'bundled' },
    { id: 'b1', title: 'B 1', series: 'Série B', seriesOrder: 1, source: 'bundled' },
  ];
  const s = shelvesOf(items);
  assert.deepEqual(s.map(x => x.title), ['Série B', 'Série A', 'Sur cet appareil']);
  assert.deepEqual(s[0].items.map(e => e.id), ['b1', 'b2']);
  assert.equal(s[1].note, 'Présentation A');
});

test('rayons : sans aucune série, un seul groupe sans titre (affichage d’avant)', () => {
  const s = shelvesOf([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  assert.equal(s.length, 1);
  assert.equal(s[0].title, '');
  assert.deepEqual(s[0].items.map(e => e.id), ['a', 'b']);
});
