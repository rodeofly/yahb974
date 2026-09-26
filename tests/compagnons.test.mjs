// Tests du greffon « compagnons » : arrivée/départ, soins/blessures, conditions, combat à graine fixe,
// mort d'un compagnon, victoire obtenue grâce à lui, validation et textes imprimés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/compagnons/core.js';
import { companionsOf, companionUsages, freeCompanionId, printCompanionEffect, printCompanionCond, de } from '../js/plugins/compagnons/core.js';
import { makeRng, roll } from '../js/core/dice.js';
import { newAdventure, normalizeAdventure, createHero, start, choose, choicesFor, applyEffects, check, describeCondition, describeEffect, enter, back } from '../js/core/rules.js';
import { startCombat, attackRound, autoFight, combatExit, useLuck, estimateWinRate } from '../js/core/combat.js';
import { validate, renumber } from '../js/core/validate.js';

/** Aventure de test : Kaya (forte), Brak (fragile), un combat paramétrable au 3. */
function sample({ foe = { name: 'Gobelin', skill: 6, health: 6 }, kaya = {}, brak = {}, hero = {} } = {}) {
  const a = newAdventure('Compagnons');
  a.companions = {
    kaya: { name: 'Kaya', skill: 9, health: 8, damage: 2, image: null, description: 'Archère de la forêt.', ...kaya },
    brak: { name: 'Brak', skill: 7, health: 3, ...brak },
  };
  a.sections = {
    '1': { text: 'Départ', onEnter: [{ op: 'companion', companion: 'kaya', action: 'join' }], blocks: [],
      choices: [{ text: 'Avec Kaya', to: '3', if: { companion: 'kaya' } }, { text: 'Seul', to: '2', if: { not: { companion: 'kaya' } } }] },
    '2': { text: 'Victoire', ending: 'victory', choices: [], blocks: [], onEnter: [] },
    '3': { text: 'Combat', onEnter: [], choices: [], blocks: [{ type: 'combat', enemies: [foe], win: '2', lose: '4' }] },
    '4': { text: 'Défaite', ending: 'death', choices: [], blocks: [], onEnter: [] },
  };
  const adv = normalizeAdventure(a);
  let { state } = createHero(adv, { seed: 7 });
  state.stats.habilete = { cur: hero.skill ?? 9, init: hero.skill ?? 9 };
  state.stats.endurance = { cur: hero.health ?? 30, init: hero.health ?? 30 };
  return { adv, state };
}
const fx = (state, adv, ...effects) => applyEffects(state, adv, effects);
const join = id => ({ op: 'companion', companion: id, action: 'join' });

test('une aventure sans compagnons se charge et se joue comme avant', () => {
  const a = newAdventure('Vide');
  delete a.companions;
  const adv = normalizeAdventure(a);
  assert.deepEqual(adv.companions, {});
  const { state } = createHero(adv, { seed: 1 });
  assert.deepEqual(state.companions, []);
  const r = start(state, adv);
  assert.equal(r.state.section, '1');
  assert.equal(validate(adv).filter(p => p.level === 'error').length, 0);
  // Ancienne sauvegarde sans le champ : les conditions et effets ne plantent pas.
  const old = { ...state }; delete old.companions;
  assert.equal(check({ companion: 'x' }, old, adv), false);
  assert.equal(check({ companions: true, gte: 1 }, old, adv), false);
});

test('arrivée, message, pas de doublon, départ', () => {
  const { adv, state } = sample();
  let r = fx(state, adv, join('kaya'));
  assert.deepEqual(r.state.companions, [{ id: 'kaya', health: 8, max: 8 }]);
  assert.deepEqual(r.messages, [{ kind: 'gain', text: 'Kaya se joint à vous.' }]);
  assert.deepEqual(state.companions, [], 'l’état reçu n’est pas modifié');
  r = fx(r.state, adv, join('kaya'));
  assert.equal(r.state.companions.length, 1);
  assert.match(r.messages[0].text, /déjà/);
  r = fx(r.state, adv, join('brak'), { op: 'companion', companion: 'kaya', action: 'leave' });
  assert.deepEqual(r.state.companions.map(m => m.id), ['brak']);
  assert.equal(r.messages.at(-1).text, 'Kaya vous quitte.');
  assert.equal(r.messages.at(-1).kind, 'loss');
  // Départ d'un absent, compagnon inconnu : rien ne se passe.
  const r2 = fx(r.state, adv, { op: 'companion', companion: 'kaya', action: 'leave' }, join('fantome'));
  assert.deepEqual(r2.state.companions, r.state.companions);
  assert.equal(r2.messages.length, 0);
  // Arrivée blessée.
  const r3 = fx(state, adv, { op: 'companion', companion: 'kaya', action: 'join', amount: 5 });
  assert.deepEqual(r3.state.companions[0], { id: 'kaya', health: 5, max: 8 });
});

test('soins plafonnés, blessures, mort hors combat', () => {
  const { adv, state } = sample();
  let s = fx(state, adv, join('kaya')).state;
  let r = fx(s, adv, { op: 'companion', companion: 'kaya', action: 'hurt', amount: 5 });
  assert.equal(r.state.companions[0].health, 3);
  assert.match(r.messages[0].text, /^Kaya perd 5 points d’Endurance/);
  r = fx(r.state, adv, { op: 'companion', companion: 'kaya', action: 'heal', amount: 10 });
  assert.equal(r.state.companions[0].health, 8, 'jamais au-delà du total de départ');
  r = fx(r.state, adv, { op: 'companion', companion: 'kaya', action: 'hurt', amount: 3 }, { op: 'companion', companion: 'kaya', action: 'heal' });
  assert.equal(r.state.companions[0].health, 8, 'soin sans nombre = total de départ');
  r = fx(r.state, adv, { op: 'companion', companion: 'kaya', action: 'hurt', amount: 20 });
  assert.deepEqual(r.state.companions, []);
  assert.ok(r.messages.some(m => m.text === 'Kaya succombe à ses blessures.'));
  assert.equal(r.state.ended, null, 'la mort d’un compagnon n’est pas celle du héros');
});

test('conditions : présence, absence, nombre ; choix grisés avec la raison', () => {
  const { adv, state } = sample();
  let s = start(state, adv).state;
  assert.equal(check({ companion: 'kaya' }, s, adv), true);
  assert.equal(check({ not: { companion: 'kaya' } }, s, adv), false);
  assert.equal(check({ companions: true, gte: 1 }, s, adv), true);
  assert.equal(check({ companions: true, gte: 2 }, s, adv), false);
  assert.equal(check({ companions: 2 }, s, adv), false, '{ companions: 2 } = au moins 2');
  assert.equal(check({ companions: true, lte: 0 }, s, adv), false);
  s = fx(s, adv, join('brak')).state;
  assert.equal(check({ companions: 2 }, s, adv), true);
  assert.equal(check({ companions: true, eq: 2 }, s, adv), true);
  const ch = choicesFor(start(state, adv).state, adv);
  assert.equal(ch[0].available, true);
  assert.equal(ch[1].available, false);
  assert.equal(ch[1].reason, 'Il faut ne pas être accompagné de Kaya.');
  assert.equal(describeCondition({ companion: 'kaya' }, adv), 'être accompagné de Kaya');
  assert.equal(describeCondition({ companions: true, gte: 2 }, adv), 'avoir au moins 2 compagnons');
  assert.equal(describeEffect(join('kaya'), adv), 'Kaya se joint au héros');
  assert.equal(choose(start(state, adv).state, adv, 0).state.section, '3');
});

test('combat à graine fixe : le compagnon frappe avec les dés de la partie', () => {
  // Le héros ne peut pas toucher (HABILETÉ 0 contre 20), Kaya ne peut pas rater (40) : issue certaine, dés vérifiés.
  const { adv, state } = sample({ foe: { name: 'Gobelin', skill: 20, health: 10, damage: 2 }, kaya: { skill: 40, damage: 3 }, hero: { skill: 0 } });
  let s = start(state, adv, '1').state;
  s = enter(s, adv, '3').state;
  s = startCombat(s, adv, 0);
  const seed = s.rng;
  const after = attackRound(s, adv);
  // Même graine, mêmes dés : héros (2d6), Gobelin (2d6), puis Kaya (2d6) et le Gobelin (2d6).
  const rng = makeRng(seed);
  roll('2d6', rng); roll('2d6', rng);
  const kr = roll('2d6', rng), gr = roll('2d6', rng);
  assert.equal(after.rng, rng.state(), 'la graine avance des dés du compagnon');
  const ex = after.combat.last.allies[0];
  assert.deepEqual(ex.ally.dice, kr.dice);
  assert.equal(ex.ally.total, kr.total + 40);
  assert.equal(ex.foe.total, gr.total + 20);
  assert.equal(ex.outcome, 'hit');
  assert.equal(after.combat.enemies[0].health, 7, 'Kaya inflige ses 3 points');
  assert.equal(after.stats.endurance.cur, 28, 'le héros, lui, a été blessé');
  assert.ok(after.combat.last.extra.some(t => t.startsWith('Kaya frappe Gobelin : −3')));
  assert.ok(after.combat.log.some(l => /Kaya \d+ contre Gobelin \d+ : Kaya blesse Gobelin \(−3\)/.test(l)));
  assert.deepEqual(attackRound(s, adv), after, 'rejouer la même graine donne le même assaut');
  assert.equal(s.combat.enemies[0].health, 10, 'l’état reçu n’est pas modifié');
});

test('combat : le compagnon subit les dégâts de l’adversaire', () => {
  const { adv, state } = sample({ foe: { name: 'Ogre', skill: 20, health: 30, damage: 3 }, kaya: { skill: 0 }, hero: { skill: 0 } });
  let s = fx(state, adv, join('kaya')).state;
  s = enter(s, adv, '3').state;
  s = attackRound(startCombat(s, adv, 0), adv);
  assert.equal(s.companions[0].health, 5);
  assert.equal(s.combat.last.allies[0].outcome, 'wounded');
  assert.ok(s.combat.last.extra.some(t => t.startsWith('Ogre blesse Kaya : −3 Endurance, reste 5 / 8')));
  assert.equal(s.combat.enemies[0].health, 30);
});

test('mort d’un compagnon au combat : message, retiré du groupe, le combat continue', () => {
  const { adv, state } = sample({ foe: { name: 'Troll', skill: 20, health: 30, damage: 2 }, brak: { skill: 0 }, hero: { skill: 0, health: 40 } });
  let s = fx(state, adv, join('brak'), join('kaya')).state;
  s = enter(s, adv, '3').state;
  s = attackRound(startCombat(s, adv, 0), adv);
  assert.equal(s.companions.find(m => m.id === 'brak').health, 1);
  s = attackRound(s, adv);
  assert.equal(s.companions.find(m => m.id === 'brak'), undefined, 'Brak est retiré du groupe');
  assert.deepEqual(s.combat.fallen.map(f => f.id), ['brak']);
  assert.ok(s.combat.last.extra.includes('Brak tombe au combat.'));
  assert.ok(s.combat.log.includes('Brak tombe au combat.'));
  assert.equal(check({ companion: 'brak' }, s, adv), false);
  assert.equal(s.combat.over, null);
  const next = attackRound(s, adv);
  assert.ok(next.combat.last.allies.every(a => a.id !== 'brak'), 'un compagnon tombé ne frappe plus');
});

test('victoire obtenue grâce au compagnon (le règlement de fin passe après lui)', () => {
  const { adv, state } = sample({ foe: { name: 'Gobelin', skill: 20, health: 2, damage: 1 }, kaya: { skill: 40, damage: 2 }, hero: { skill: 0 } });
  let s = fx(state, adv, join('kaya')).state;
  s = enter(s, adv, '3').state;
  s = attackRound(startCombat(s, adv, 0), adv);
  assert.equal(s.combat.enemies[0].health, 0);
  assert.equal(s.combat.enemies[0].down, true);
  assert.equal(s.combat.over, 'win');
  assert.equal(s.combat.canLuck, false);
  assert.equal(combatExit(s, adv), '2');
  assert.ok(s.combat.log.includes('Gobelin est vaincu.'));
});

test('combat : cible du héros, puis adversaire suivant ; aucun coup si le héros est tombé', () => {
  const { adv, state } = sample({ kaya: { skill: 40, damage: 1 }, hero: { skill: 0 } });
  adv.sections['3'].blocks[0] = { type: 'combat', mode: 'together', win: '2', enemies: [{ name: 'A', skill: 20, health: 9 }, { name: 'B', skill: 20, health: 9 }] };
  let s = fx(state, adv, join('kaya')).state;
  s = enter(s, adv, '3').state;
  s = startCombat(s, adv, 0);
  s.combat.target = 1;
  s = attackRound(s, adv);
  assert.equal(s.combat.enemies[1].health, 8, 'Kaya frappe la cible choisie par le héros');
  assert.equal(s.combat.enemies[0].health, 9);
  // Cible déjà vaincue : Kaya frappe le premier adversaire encore debout.
  s.combat.enemies[1].health = 0; s.combat.enemies[1].down = true;
  s = attackRound(s, adv);
  assert.equal(s.combat.last.allies[0].enemy, 0);
  // Héros à 1 point contre deux adversaires imbattables : il tombe, Kaya ne frappe plus.
  s.stats.endurance.cur = 1;
  s = attackRound(s, adv);
  assert.equal(s.combat.over, 'lose');
  assert.equal(s.combat.last.allies, undefined);
});

test('combat sans compagnon : rien ne change ; combat automatique et Chance compatibles', () => {
  const { adv, state } = sample();
  let s = enter(state, adv, '3').state;
  s = attackRound(startCombat(s, adv, 0), adv);
  assert.deepEqual(s.combat.last.extra, []);
  assert.equal(s.combat.last.allies, undefined);
  let t = fx(state, adv, join('kaya'), join('brak')).state;
  t = enter(t, adv, '3').state;
  t = attackRound(startCombat(t, adv, 0), adv);
  if (t.combat.canLuck) t = useLuck(t, adv);
  t = autoFight(t, adv);
  assert.ok(['win', 'lose'].includes(t.combat.over));
  assert.ok(t.companions.every(m => m.health > 0 && m.health <= m.max));
  // L'estimation de difficulté de l'éditeur (sans compagnons) marche toujours.
  const rate = estimateWinRate(adv, adv.sections['3'].blocks[0], { skill: 9, health: 20 }, 50);
  assert.ok(rate >= 0 && rate <= 1);
});

test('retour en arrière : le groupe revient tel qu’il était', () => {
  const { adv, state } = sample();
  let s = start(state, adv).state;
  s = choose(s, adv, 0).state;
  s = fx(s, adv, { op: 'companion', companion: 'kaya', action: 'leave' }).state;
  assert.equal(s.companions.length, 0);
  s = back(s);
  assert.equal(s.section, '1');
  assert.deepEqual(s.companions, [{ id: 'kaya', health: 8, max: 8 }]);
});

test('validation, usages, identifiants et renumérotation', () => {
  const { adv } = sample();
  assert.equal(validate(adv).filter(p => p.level === 'error').length, 0);
  adv.sections['2'].onEnter = [{ op: 'companion', companion: 'zed', action: 'join' }, { op: 'companion', companion: 'kaya', action: 'fly' }];
  adv.sections['4'].choices = [{ text: 'x', to: '1', if: { not: { companion: 'nobody' } } }];
  const errs = validate(adv).filter(p => p.level === 'error').map(p => p.message);
  assert.ok(errs.some(m => /compagnon inconnu « zed »/.test(m)));
  assert.ok(errs.some(m => /action de compagnon inconnue « fly »/.test(m)));
  assert.ok(errs.some(m => /compagnon inconnu « nobody »/.test(m)));
  const uses = companionUsages(adv, 'kaya');
  assert.deepEqual(uses.map(u => [u.section, u.kind]), [['1', 'join'], ['1', 'condition'], ['1', 'condition'], ['2', 'fly']]);
  assert.equal(freeCompanionId(adv, 'kaya'), 'kaya-2');
  assert.equal(freeCompanionId(adv, 'lune'), 'lune');
  const { adventure } = renumber(adv, makeRng(3));
  assert.deepEqual(adventure.companions, adv.companions);
});

test('textes imprimés et liste des compagnons', () => {
  const { adv, state } = sample();
  assert.equal(printCompanionEffect(join('kaya'), adv), 'Kaya se joint à vous : notez ce compagnon dans la case Compagnons de votre Feuille d\'Aventure (HABILETÉ 9, ENDURANCE 8, dégâts 2).');
  assert.equal(printCompanionEffect({ op: 'companion', companion: 'brak', action: 'hurt', amount: 1 }, adv), 'si Brak vous accompagne, retirez-lui 1 point d’ENDURANCE ; à zéro, ce compagnon meurt : rayez son nom.');
  assert.equal(printCompanionCond({ not: { companion: 'kaya' } }, adv), 'Kaya ne vous accompagne pas');
  assert.equal(printCompanionCond({ companions: true, gte: 1 }, adv), 'au moins un compagnon vous accompagne');
  assert.equal(de('Endurance'), 'd’Endurance');
  assert.equal(de('Points de vie'), 'de Points de vie');
  const list = companionsOf(fx(state, adv, join('brak')).state, adv);
  assert.deepEqual(list.map(c => [c.name, c.skill, c.health, c.max, c.damage]), [['Brak', 7, 3, 3, 2]]);
});
