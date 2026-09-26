import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, roll, parseDice, range } from '../js/core/dice.js';
import { newAdventure, createHero, start, choose, choicesFor, applyEffects, check, resolveTest, resolveRoll, eat, buy, back, normalizeAdventure } from '../js/core/rules.js';
import { startCombat, attackRound, useLuck, flee, autoFight, combatExit } from '../js/core/combat.js';
import { validate, renumber, reachable } from '../js/core/validate.js';

function sample() {
  const a = newAdventure('Test');
  a.items = { cle: { name: 'Clé' }, potion: { name: 'Potion', use: [{ op: 'stat', stat: 'endurance', set: 'initial' }] } };
  a.sections = {
    '1': { text: 'Départ', choices: [{ text: 'Porte', to: '2', if: { has: 'cle' } }, { text: 'Couloir', to: '3', effects: [{ op: 'give', item: 'cle' }] }], blocks: [], onEnter: [] },
    '2': { text: 'Victoire', ending: 'victory', choices: [], blocks: [], onEnter: [] },
    '3': { text: 'Gobelin', choices: [], onEnter: [{ op: 'stat', stat: 'endurance', add: -2 }], blocks: [{ type: 'combat', enemies: [{ name: 'Gobelin', skill: 5, health: 5 }], win: '1', flee: '4' }] },
    '4': { text: 'Test', choices: [], onEnter: [], blocks: [{ type: 'test', stat: 'chance', success: '2', failure: '5' }, { type: 'roll', dice: '1d6', table: [{ min: 1, max: 3, to: '2' }, { min: 4, max: 6, to: '5' }] }, { type: 'shop', offers: [{ item: 'potion', price: 2 }] }] },
    '5': { text: 'Mort', ending: 'death', choices: [], blocks: [], onEnter: [] },
  };
  return normalizeAdventure(a);
}

test('dés : formules et bornes', () => {
  assert.deepEqual(parseDice('2d6+3'), { count: 2, sides: 6, mod: 3 });
  assert.deepEqual(parseDice('d20'), { count: 1, sides: 20, mod: 0 });
  assert.deepEqual(range('2d6+12'), { min: 14, max: 24 });
  const rng = makeRng(42);
  for (let i = 0; i < 500; i++) { const r = roll('2d6', rng); assert.ok(r.total >= 2 && r.total <= 12); }
  assert.throws(() => parseDice('abc'));
});

test('dés : même graine, mêmes résultats', () => {
  const a = makeRng(7), b = makeRng(7);
  assert.equal(roll('3d6', a).total, roll('3d6', b).total);
});

test('création du héros dans les bornes des règles', () => {
  const adv = sample();
  const { state } = createHero(adv, { seed: 1 });
  assert.ok(state.stats.habilete.cur >= 7 && state.stats.habilete.cur <= 12);
  assert.ok(state.stats.endurance.cur >= 14 && state.stats.endurance.cur <= 24);
  assert.equal(state.stats.chance.cur, state.stats.chance.init);
});

test('choix conditionnel, effets de choix, effets d’entrée, fin', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 3 });
  ({ state } = start(state, adv));
  let ch = choicesFor(state, adv);
  assert.equal(ch[0].available, false);
  assert.match(ch[0].reason, /Clé/);
  const endBefore = state.stats.endurance.cur;
  ({ state } = choose(state, adv, 1));
  assert.equal(state.section, '3');
  assert.equal(state.inventory.cle, 1);
  assert.equal(state.stats.endurance.cur, endBefore - 2);
  state = back(state);
  assert.equal(state.section, '1');
  assert.equal(state.inventory.cle, undefined);
});

test('les caractéristiques ne dépassent pas leur total initial', () => {
  const adv = sample();
  const { state } = createHero(adv, { seed: 3 });
  const r = applyEffects(state, adv, [{ op: 'stat', stat: 'chance', add: 5 }]);
  assert.equal(r.state.stats.chance.cur, state.stats.chance.init);
  const r2 = applyEffects(state, adv, [{ op: 'stat', stat: 'chance', addInitial: 1 }]);
  assert.equal(r2.state.stats.chance.init, state.stats.chance.init + 1);
});

test('mort quand l’Endurance tombe à zéro', () => {
  const adv = sample();
  const { state } = createHero(adv, { seed: 3 });
  const r = applyEffects(state, adv, [{ op: 'stat', stat: 'endurance', add: -99 }]);
  assert.equal(r.state.ended, 'death');
});

test('conditions combinées', () => {
  const adv = sample();
  const { state } = createHero(adv, { seed: 3 });
  const s = { ...state, gold: 5, inventory: { cle: 1 } };
  assert.ok(check({ all: [{ has: 'cle' }, { gold: true, gte: 5 }] }, s, adv));
  assert.ok(!check({ not: { has: 'cle' } }, s, adv));
  assert.ok(check({ any: [{ has: 'x' }, { stat: 'habilete', gte: 1 }] }, s, adv));
});

test('combat : se termine, la Chance se consomme, la sortie est la bonne', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 11 });
  ({ state } = start(state, adv, '3'));
  state = startCombat(state, adv, 0);
  state = attackRound(state, adv);
  const luck = state.stats.chance.cur;
  if (state.combat.canLuck) { state = useLuck(state, adv); assert.equal(state.stats.chance.cur, luck - 1); }
  state = autoFight(state, adv);
  assert.ok(['win', 'lose'].includes(state.combat.over));
  if (state.combat.over === 'win') assert.equal(combatExit(state, adv), '1');
});

test('combat : fuite avec dégâts', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 11 });
  ({ state } = start(state, adv, '3'));
  state = startCombat(state, adv, 0);
  const hp = state.stats.endurance.cur;
  state = flee(state, adv);
  assert.equal(state.combat.over, 'flee');
  assert.equal(state.stats.endurance.cur, hp - 2);
  assert.equal(combatExit(state, adv), '4');
});

test('test de Chance, table de dés et boutique', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 5 });
  state.gold = 3;
  ({ state } = start(state, adv, '4'));
  const luck = state.stats.chance.cur;
  const t = resolveTest(state, adv, 0);
  assert.equal(t.state.stats.chance.cur, luck - 1);
  assert.equal(t.result.success, t.result.roll.total <= luck);
  const r = resolveRoll(state, adv, 1);
  assert.ok(['2', '5'].includes(r.result.row.to));
  const b = buy(state, adv, 2, 0);
  assert.equal(b.state.gold, 1);
  assert.equal(b.state.inventory.potion, 1);
  assert.equal(buy(b.state, adv, 2, 0).state.gold, 1, 'pas assez d’or');
});

test('repas', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 5 });
  state.stats.endurance.cur -= 6;
  const r = eat(state, adv);
  assert.equal(r.state.provisions, state.provisions - 1);
  assert.equal(r.state.stats.endurance.cur, state.stats.endurance.cur + 4);
});

test('validation et renumérotation', () => {
  const adv = sample();
  assert.equal(validate(adv).filter(p => p.level === 'error').length, 0);
  adv.sections['1'].choices.push({ text: 'Nulle part', to: '99' });
  assert.ok(validate(adv).some(p => p.level === 'error' && /99/.test(p.message)));
  adv.sections['1'].choices.pop();
  const { adventure, mapping } = renumber(adv, makeRng(1));
  assert.equal(adventure.start, '1');
  assert.equal(Object.keys(adventure.sections).length, 5);
  assert.equal(reachable(adventure).size, reachable(adv).size);
  assert.equal(adventure.sections[mapping['3']].blocks[0].flee, mapping['4']);
});

import { castSpell, canCast } from '../js/core/rules.js';

function magic() {
  const a = sample();
  a.rules.classes = [{ id: 'guerrier', label: 'Guerrier', rolls: {} }, { id: 'sorcier', label: 'Sorcier', rolls: {} }];
  a.rules.spells = { enabled: true, stat: 'endurance', casters: ['sorcier'], typeCode: false, unknownCost: 1, book: [{ code: 'ZAP', name: 'Éclair', cost: 4 }] };
  a.rules.time = { enabled: true, mealRequired: true, stat: 'endurance', penalty: 3 };
  a.sections['6'] = { text: 'Un troll', choices: [], onEnter: [], blocks: [{ type: 'spells', options: [{ code: 'ZAP', to: '2' }, { code: 'BOF', to: '5', cost: 5 }] }] };
  a.sections['7'] = { text: 'Le lendemain', choices: [{ text: 'suite', to: '1' }], onEnter: [{ op: 'newDay' }], blocks: [] };
  return normalizeAdventure(a);
}

test('formules : seuls les lanceurs de sorts, coût payé, bonne destination', () => {
  const adv = magic();
  let { state } = createHero(adv, { seed: 2, classId: 'guerrier' });
  ({ state } = start(state, adv, '6'));
  assert.equal(canCast(state, adv), false);
  assert.equal(castSpell(state, adv, 0, 'ZAP').state.section, '6');
  ({ state } = createHero(adv, { seed: 2, classId: 'sorcier' }));
  ({ state } = start(state, adv, '6'));
  const end = state.stats.endurance.cur;
  const r = castSpell(state, adv, 0, 'zap');
  assert.equal(r.state.section, '2');
  assert.equal(r.state.stats.endurance.cur, end - 4);
  const bad = castSpell(state, adv, 0, 'XYZ');
  assert.equal(bad.state.section, '6');
  assert.equal(bad.state.stats.endurance.cur, end - 1);
  assert.deepEqual(bad.state.blocks[0].tried, ['XYZ']);
  assert.equal(castSpell(state, adv, 0, 'BOF').state.stats.endurance.cur, end - 5);
});

test('journées : pénalité si on n’a pas mangé, pas si on a mangé', () => {
  const adv = magic();
  let { state } = createHero(adv, { seed: 2 });
  state.stats.endurance.cur -= 5;
  const hungry = R_enter(state, adv, '7');
  assert.equal(hungry.state.day, 2);
  assert.equal(hungry.state.stats.endurance.cur, state.stats.endurance.cur - 3);
  const fed = eat(state, adv).state;
  assert.equal(fed.ate, true);
  const ok = R_enter(fed, adv, '7');
  assert.equal(ok.state.stats.endurance.cur, fed.stats.endurance.cur);
  assert.equal(ok.state.ate, false);
});
import { enter as R_enter } from '../js/core/rules.js';

/* ---------- corrections : Chance après une mise à terre, dégâts nuls, objet requis ---------- */
function twoFoes(enemies) {
  const a = sample();
  a.sections['8'] = { text: 'Deux loups', choices: [], onEnter: [], blocks: [{ type: 'combat', mode: 'together', enemies, win: '2' }] };
  return normalizeAdventure(a);
}

test('combat à plusieurs : tenter sa Chance ne ranime jamais un adversaire abattu', () => {
  const adv = twoFoes([{ name: 'Premier loup', skill: 0, health: 1 }, { name: 'Second loup', skill: 0, health: 30 }]);
  let { state } = createHero(adv, { seed: 13 });
  ({ state } = start(state, adv, '8'));
  state.stats[adv.rules.combat.skill].cur = 40; // le héros gagne tous les échanges
  state = startCombat(state, adv, 0);
  state = attackRound(state, adv);
  const first = state.combat.enemies[0];
  assert.equal(first.down, true);
  assert.equal(first.health, 0);
  assert.equal(state.combat.canLuck, false, 'aucune Chance proposée : le seul effet serait de ranimer le loup');
  // Même si la Chance était proposée (ancienne sauvegarde), le loup abattu reste à terre.
  for (let seed = 1; seed < 40; seed++) {
    const forced = { ...state, rng: seed, combat: { ...state.combat, canLuck: true } };
    const after = useLuck(forced, adv);
    assert.equal(after.combat.enemies[0].health, 0);
    assert.equal(after.combat.enemies[0].down, true);
  }
});

test('combat : un adversaire à 0 dégât ne blesse pas le héros', () => {
  const adv = twoFoes([{ name: 'Mouton', skill: 40, health: 50, damage: 0 }]);
  let { state } = createHero(adv, { seed: 3 });
  ({ state } = start(state, adv, '8'));
  const hp = state.stats[adv.rules.combat.health].cur;
  state = startCombat(state, adv, 0);
  assert.equal(state.combat.enemies[0].damage, 0);
  state = attackRound(state, adv);
  assert.equal(state.stats[adv.rules.combat.health].cur, hp);
  const dflt = startCombat(state, twoFoes([{ name: 'Loup', skill: 1, health: 3 }]), 0);
  assert.equal(dflt.combat.enemies[0].damage, 2, 'sans valeur : dégâts de la règle');
});

test('formules : l’objet requis est exigé', () => {
  const adv = magic();
  adv.items.baguette = { name: 'Baguette' };
  adv.rules.spells.book[0].requires = 'baguette';
  let { state } = createHero(adv, { seed: 2, classId: 'sorcier' });
  ({ state } = start(state, adv, '6'));
  const end = state.stats.endurance.cur;
  const r = castSpell(state, adv, 0, 'ZAP');
  assert.equal(r.state.section, '6', 'sans la baguette, la formule échoue');
  assert.equal(r.state.stats.endurance.cur, end - 4, 'le coût est payé');
  assert.match(r.messages[0].text, /il vous faut : Baguette/);
  state = { ...state, inventory: { ...state.inventory, baguette: 1 } };
  assert.equal(castSpell(state, adv, 0, 'ZAP').state.section, '2');
});
