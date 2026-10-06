import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/objets/core.js';
import { actionsOf, doAction } from '../js/plugins/objets/core.js';
import { newAdventure, normalizeAdventure, createHero, start, applyEffects, check } from '../js/core/rules.js';
import { validate } from '../js/core/validate.js';

function sample() {
  const a = newAdventure('Objets');
  a.items = { cle: { name: 'Clé', icon: '🗝️' } };
  a.sections['1'].blocks = [{ type: 'actions', label: 'Sur la table', actions: [
    { label: 'Prendre la clé', icon: '🗝️', effects: [{ op: 'give', item: 'cle' }] },
    { label: 'Payer 3 pièces', icon: '💰', effects: [{ op: 'gold', add: -3 }], if: { gold: 3, gte: 3 } },
    { label: 'Boire', effects: [{ op: 'stat', stat: 'endurance', add: 2 }], once: false },
  ] }];
  return normalizeAdventure(a);
}

test('les actions s’appliquent une fois, sauf once:false', () => {
  const adv = sample();
  let s = start(createHero(adv, { seed: 1 }).state, adv).state;
  let r = doAction(s, adv, 0, 0, applyEffects);
  assert.equal(r.state.inventory.cle, 1);
  assert.equal(actionsOf(adv.sections['1'].blocks[0], r.state, adv, 0, check)[0].done, true);
  const again = doAction(r.state, adv, 0, 0, applyEffects);
  assert.equal(again.state.inventory.cle, 1);
  const hp = r.state.stats.endurance.cur;
  r = doAction({ ...r.state, stats: { ...r.state.stats, endurance: { cur: hp - 4, init: hp } } }, adv, 0, 2, applyEffects);
  r = doAction(r.state, adv, 0, 2, applyEffects);
  assert.equal(r.state.stats.endurance.cur, hp);
});

test('la vérification signale une action sans effet et un bloc valide ne donne pas d’erreur', () => {
  const adv = sample();
  const errors = validate(adv).filter(m => m.level === 'error');
  assert.equal(errors.length, 0);
  adv.sections['1'].blocks[0].actions.push({ label: 'Rien', effects: [] });
  assert.ok(validate(adv).some(m => m.level === 'warning' && /aucun effet/.test(m.message)));
});
