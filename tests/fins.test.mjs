import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAdventure, createHero, start } from '../js/core/rules.js';
import '../js/plugins/core.js';
import { applyMode } from '../js/plugins/modes/core.js';

test('une fin peut avoir un titre et une icône propres, remplacés par la variante d’un mode', () => {
  const adv = normalizeAdventure({
    id: 'fins', rules: { modes: [{ id: 'petit', label: 'Petit' }, { id: 'grand', label: 'Grand' }] },
    start: '1',
    sections: {
      '1': { text: 'Repéré par les chasseurs.', ending: 'death', endingTitle: 'Repris', endingIcon: 'skull',
        variants: { petit: { text: 'Le groupe se replie vers la cascade.', ending: 'death', endingTitle: 'Repli vers la cascade', endingIcon: 'moon' } } },
    },
  });
  const petit = applyMode(adv, 'petit'), grand = applyMode(adv, 'grand');
  assert.equal(petit.sections['1'].endingTitle, 'Repli vers la cascade');
  assert.equal(petit.sections['1'].endingIcon, 'moon');
  assert.equal(grand.sections['1'].endingTitle, 'Repris');
  const { state } = createHero(petit, { seed: 1 });
  assert.equal(start(state, petit).state.ended, 'death');
});
