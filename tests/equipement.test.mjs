import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/core.js';
import { newAdventure, normalizeAdventure, createHero, start, choose, choicesFor, applyEffects, check, useItem, buy, back, describeCondition, describeEffect, enter } from '../js/core/rules.js';
import { startCombat, attackRound, estimateWinRate } from '../js/core/combat.js';
import { validate } from '../js/core/validate.js';
import { equip, unequip, drop, pickUp, equippedOf, bagOf, bonuses, droppedHere, FULL_BAG, defaults } from '../js/plugins/equipement/core.js';

/** Aventure de test : équipement activé, sac de 3 places, –4 sans arme. */
function sample({ enabled = true, capacity = 3, unarmedPenalty = 4 } = {}) {
  const a = newAdventure('Armurerie');
  a.rules.equipment = { enabled, capacity, unarmedPenalty };
  a.rules.startItems = ['dague', 'corde'];
  a.items = {
    dague: { name: 'Dague', slot: 'arme' },
    epee: { name: 'Épée fine', slot: 'arme', attack: 1, damage: 1 },
    cotte: { name: 'Cotte de mailles', slot: 'armure', armor: 1, attack: -1 },
    bouclier: { name: 'Bouclier', slot: 'bouclier', armor: 1 },
    corde: { name: 'Corde' },
    pierre: { name: 'Pierre' },
    anneau: { name: 'Anneau', slot: 'bijou', small: true },
    potion: { name: 'Potion', use: [{ op: 'give', item: 'bouclier' }] },
  };
  a.sections = {
    '1': { text: 'Armurerie', onEnter: [], blocks: [{ type: 'shop', offers: [{ item: 'cotte', price: 1 }, { item: 'pierre', price: 0 }] }],
      choices: [
        { text: 'Prendre l’épée', to: '2', effects: [{ op: 'give', item: 'epee' }] },
        { text: 'Prendre l’armure', to: '2', effects: [{ op: 'give', item: 'cotte' }] },
        { text: 'Ramasser des pierres', to: '2', effects: [{ op: 'give', item: 'pierre', qty: 3 }] },
        { text: 'Porte gardée', to: '4', if: { equipped: 'epee' } },
      ] },
    '2': { text: 'Couloir', onEnter: [], blocks: [], choices: [{ text: 'Suite', to: '3' }, { text: 'Retour', to: '1' }] },
    '3': { text: 'Garde', onEnter: [], blocks: [{ type: 'combat', enemies: [{ name: 'Garde', skill: 8, health: 20 }], win: '4' }], choices: [] },
    '4': { text: 'Fin', ending: 'victory', onEnter: [], blocks: [], choices: [] },
  };
  return normalizeAdventure(a);
}

const hero = (adv, seed = 7) => start(createHero(adv, { seed }).state, adv).state;

test('règles : valeurs par défaut sans écraser l’existant', () => {
  const adv = normalizeAdventure(newAdventure('Vide'));
  assert.deepEqual(adv.rules.equipment, defaults());
  assert.equal(adv.rules.equipment.enabled, false);
  assert.deepEqual(adv.rules.equipment.slots.map(s => s.id), ['arme', 'armure', 'bouclier', 'bijou']);
  const custom = sample({ capacity: 6 });
  assert.equal(custom.rules.equipment.capacity, 6);
  assert.equal(custom.rules.equipment.enabled, true);
  assert.equal(custom.rules.equipment.slots.length, 4, 'emplacements par défaut ajoutés');
  const own = normalizeAdventure({ ...newAdventure('x'), rules: { equipment: { enabled: true, slots: [{ id: 'main', label: 'Main' }] } } });
  assert.deepEqual(own.rules.equipment.slots, [{ id: 'main', label: 'Main' }]);
});

test('désactivé : rien ne change', () => {
  const adv = sample({ enabled: false, capacity: 1 });
  let s = hero(adv);
  assert.equal(s.equipped, undefined);
  assert.equal(s.equipement, undefined);
  assert.deepEqual(equippedOf(s, adv), {});
  assert.deepEqual(bonuses(s, adv), { attack: 0, damage: 0, armor: 0, unarmed: false, lines: [] });
  assert.ok(choicesFor(s, adv).every(c => c.reason !== FULL_BAG), 'pas de garde de capacité');
  assert.equal(equip(s, adv, 'dague').state, s);
  s = choose(s, adv, 0).state;
  assert.equal(s.equipped, undefined);
});

test('équipement automatique des objets de départ', () => {
  const adv = sample();
  const s = createHero(adv, { seed: 3 }).state;
  assert.deepEqual(s.equipped, { arme: 'dague' });
  assert.deepEqual(s.equipement.seen, { dague: 1, corde: 1 });
});

test('équiper, remplacer, ranger ; fonctions pures', () => {
  const adv = sample();
  let s = hero(adv);
  s = applyEffects(s, adv, [{ op: 'give', item: 'epee' }]).state;
  // L'arme est occupée par la dague : l'épée reste dans le sac.
  assert.equal(equippedOf(s, adv).arme, 'dague');
  const frozen = structuredClone(s);
  let r = equip(s, adv, 'epee');
  assert.deepEqual(s, frozen, 'l’état reçu n’est pas modifié');
  assert.equal(r.state.equipped.arme, 'epee');
  assert.match(r.messages[0].text, /Épée fine.*Dague retourne dans votre sac/);
  r = unequip(r.state, adv, 'arme');
  assert.equal(r.state.equipped.arme, undefined);
  assert.match(r.messages[0].text, /rangez Épée fine/);
  // Ranger n'est pas annulé par la synchronisation suivante (entrée dans un paragraphe).
  const next = enter(r.state, adv, '2').state;
  assert.equal(next.equipped.arme, undefined);
  // Un objet sans emplacement ne s'équipe pas.
  assert.equal(equip(next, adv, 'corde').state.equipped.arme, undefined);
});

test('objet reçu : équipé automatiquement si l’emplacement est libre', () => {
  const adv = sample();
  let s = hero(adv);
  const r = choose(s, adv, 1); // cotte de mailles : armure libre
  assert.equal(r.state.equipped.armure, 'cotte');
  assert.ok(r.messages.some(m => /Vous vous équipez : Cotte de mailles \(Armure\)/.test(m.text)));
  // Boutique puis utilisation d'un objet : la vue est juste tout de suite, l'état est matérialisé ensuite sans message en double.
  s = hero(adv); s.gold = 5;
  s = buy(s, adv, 0, 0).state;
  assert.equal(equippedOf(s, adv).armure, 'cotte', 'vu comme porté juste après l’achat');
  assert.equal(s.equipped.armure, undefined, 'pas encore écrit dans l’état');
  const e = choose(s, adv, 2);
  assert.equal(e.state.equipped.armure, 'cotte');
  assert.ok(!e.messages.some(m => /Vous vous équipez/.test(m.text)), 'pas d’annonce tardive');
  s = applyEffects(hero(adv), adv, [{ op: 'give', item: 'potion' }]).state;
  s = useItem(s, adv, 'potion').state;
  assert.equal(equippedOf(s, adv).bouclier, 'bouclier');
});

test('objet équipé perdu : l’emplacement se libère', () => {
  const adv = sample();
  let s = hero(adv);
  s = applyEffects(s, adv, [{ op: 'take', item: 'dague' }]).state;
  assert.equal(equippedOf(s, adv).arme, undefined);
  s = enter(s, adv, '2').state;
  assert.deepEqual(s.equipped, {});
  // Si on le retrouve plus tard, il revient dans son emplacement.
  s = applyEffects(s, adv, [{ op: 'give', item: 'dague' }]).state;
  assert.equal(equippedOf(s, adv).arme, 'dague');
  // Retour en arrière : l'équipement suit la page.
  s = choose(hero(adv), adv, 0).state;
  s = equip(s, adv, 'epee').state;
  assert.equal(back(s).equipped.arme, 'dague');
});

test('effets equip / unequip (avec perte de l’objet)', () => {
  const adv = sample();
  let s = hero(adv);
  let r = applyEffects(s, adv, [{ op: 'give', item: 'epee' }, { op: 'equip', item: 'epee' }]);
  assert.equal(r.state.equipped.arme, 'epee');
  assert.equal(r.state.inventory.dague, 1);
  assert.ok(r.messages.some(m => /Vous vous équipez : Épée fine/.test(m.text)));
  r = applyEffects(r.state, adv, [{ op: 'unequip', slot: 'arme', take: true }]);
  assert.equal(r.state.inventory.epee, undefined);
  assert.equal(r.state.equipped.arme, undefined);
  assert.ok(r.messages.some(m => m.kind === 'loss' && /Épée fine/.test(m.text)));
  r = applyEffects(r.state, adv, [{ op: 'equip', item: 'dague' }, { op: 'unequip', slot: 'arme' }]);
  assert.equal(r.state.inventory.dague, 1);
  assert.equal(r.state.equipped.arme, undefined);
  assert.equal(describeEffect({ op: 'equip', item: 'epee' }, adv), 'équipe Épée fine');
  assert.match(describeEffect({ op: 'unequip', slot: 'arme', take: true }, adv), /perd l'objet porté \(Arme\)/);
});

test('conditions equipped / equippedSlot', () => {
  const adv = sample();
  let s = hero(adv);
  assert.ok(check({ equipped: 'dague' }, s, adv));
  assert.ok(!check({ equipped: 'epee' }, s, adv));
  assert.ok(check({ equipped: 'epee', negate: true }, s, adv));
  assert.ok(check({ equippedSlot: 'arme' }, s, adv));
  assert.ok(check({ equippedSlot: 'armure', negate: true }, s, adv));
  assert.ok(check({ not: { equippedSlot: 'bouclier' } }, s, adv));
  assert.equal(choicesFor(s, adv)[3].available, false);
  assert.match(choicesFor(s, adv)[3].reason, /porter : Épée fine/);
  assert.equal(describeCondition({ equippedSlot: 'arme', negate: true }, adv), 'n\'avoir rien à l\'emplacement « Arme »');
  s = equip(applyEffects(s, adv, [{ op: 'give', item: 'epee' }]).state, adv, 'epee').state;
  assert.equal(choicesFor(s, adv)[3].available, true);
});

test('capacité : sac trop plein, objets portés et petits objets exclus', () => {
  const adv = sample({ capacity: 3 });
  let s = hero(adv); // dague portée + corde : 1 place
  assert.deepEqual(bagOf(s, adv), { load: 1, capacity: 3, over: 0 });
  s = applyEffects(s, adv, [{ op: 'give', item: 'anneau' }, { op: 'give', item: 'epee' }]).state;
  assert.equal(bagOf(s, adv).load, 2, 'l’anneau est petit, l’épée va dans le sac (arme occupée)');
  s = choose(s, adv, 2).state; // trois pierres
  assert.deepEqual(bagOf(s, adv), { load: 5, capacity: 3, over: 2 });
  const ch = choicesFor(s, adv);
  assert.ok(ch.every(c => !c.available && c.reason === FULL_BAG));
  assert.throws(() => choose(s, adv, 0));
  // Abandonner deux pierres débloque les choix ; on peut en reprendre une tant qu'on reste ici.
  s = drop(s, adv, 'pierre').state;
  const r = drop(s, adv, 'pierre');
  s = r.state;
  assert.match(r.messages[0].text, /Vous abandonnez : Pierre/);
  assert.equal(bagOf(s, adv).over, 0);
  assert.deepEqual(droppedHere(s), [['pierre', 2]]);
  assert.ok(choicesFor(s, adv).every(c => c.available));
  const picked = pickUp(s, adv, 'pierre').state;
  assert.equal(picked.inventory.pierre, 2);
  assert.equal(bagOf(picked, adv).over, 1);
  s = choose(s, adv, 0).state;
  assert.deepEqual(droppedHere(s), [], 'les objets abandonnés restent dans le paragraphe quitté');
  // Abandonner l'objet porté libère son emplacement.
  s = drop(s, adv, 'dague').state;
  assert.equal(s.equipped.arme, undefined);
  assert.equal(s.inventory.dague, undefined);
});

test('combat : bonus appliqués (même graine), armure, pénalité sans arme', () => {
  const adv = sample();
  const base = start(createHero(adv, { seed: 11 }).state, adv, '3').state;
  const plain = attackRound(startCombat(base, adv, 0), adv);
  // Dague (aucun bonus) : pas de modificateur.
  assert.deepEqual(plain.combat.last.mods, { attack: 0, damage: 0, armor: 0 });

  let armed = applyEffects(base, adv, [{ op: 'give', item: 'epee' }, { op: 'equip', item: 'epee' }, { op: 'give', item: 'bouclier' }]).state;
  const fight = attackRound(startCombat(armed, adv, 0), adv);
  assert.deepEqual(fight.combat.last.mods, { attack: 1, damage: 1, armor: 1 });
  const a = plain.combat.last.exchanges[0], b = fight.combat.last.exchanges[0];
  assert.deepEqual(a.player.dice, b.player.dice, 'mêmes dés');
  assert.equal(b.player.total, a.player.total + 1, '+1 Force d’Attaque');
  // Sur plusieurs assauts : l'épée inflige 3 au lieu de 2, le bouclier réduit à 1 les coups reçus.
  const seen = { hit: 0, wounded: 0 };
  let f = startCombat(armed, adv, 0);
  f.stats.endurance = { cur: 99, init: 99 };
  Object.assign(f.combat.enemies[0], { skill: 12, health: 99, max: 99 });
  for (let i = 0; i < 30 && !f.combat.over; i++) {
    f = attackRound(f, adv);
    for (const x of f.combat.last.exchanges) {
      if (x.outcome === 'hit') { seen.hit++; assert.equal(x.damage, 3, 'épée : +1 dégât'); }
      if (x.outcome === 'wounded') { seen.wounded++; assert.equal(x.damage, 1, 'bouclier : −1 dégât subi'); }
    }
  }
  assert.ok(seen.hit > 0 && seen.wounded > 0, JSON.stringify(seen));

  // Sans arme : −4.
  const bare = applyEffects(base, adv, [{ op: 'take', item: 'dague' }]).state;
  const naked = attackRound(startCombat(bare, adv, 0), adv);
  assert.equal(naked.combat.last.mods.attack, -4);
  assert.equal(naked.combat.last.exchanges[0].player.total, a.player.total - 4);
  const lines = bonuses(armed, adv).lines;
  assert.deepEqual(lines.map(l => `${l.label} : ${l.text}`), ['Épée fine : +1 Force d\'Attaque, +1 dégât infligé', 'Bouclier : −1 dégât subi']);
  assert.equal(bonuses(bare, adv).lines[0].text, '−4 Force d\'Attaque');
  // Estimation de difficulté de l'éditeur (héros sans inventaire) : aucune erreur, aucun bonus.
  const rate = estimateWinRate(adv, adv.sections['3'].blocks[0], { skill: 9, health: 20 }, 50);
  assert.ok(rate >= 0 && rate <= 1);
});

test('vérification de l’aventure', () => {
  const adv = sample();
  adv.sections['2'].onEnter = [{ op: 'equip', item: 'corde' }, { op: 'unequip', slot: 'ceinture' }];
  adv.sections['2'].choices[0].if = { equippedSlot: 'ceinture' };
  const msgs = validate(adv).map(p => p.message).join('\n');
  assert.match(msgs, /Corde.*n'a pas d'emplacement/);
  assert.match(msgs, /emplacement inconnu « ceinture »/);
  const off = sample({ enabled: false });
  off.sections['2'].onEnter = [{ op: 'equip', item: 'epee' }];
  assert.match(validate(off).map(p => p.message).join('\n'), /équipement est désactivé/);
});

test('exemple de la documentation : échanger la dague contre l’épée', () => {
  const adv = sample();
  const s = hero(adv);
  const r = applyEffects(s, adv, [{ op: 'give', item: 'epee' }, { op: 'equip', item: 'epee' }, { op: 'take', item: 'dague' }]);
  assert.equal(r.state.equipped.arme, 'epee');
  assert.equal(r.state.inventory.dague, undefined);
  assert.equal(bonuses(r.state, adv).unarmed, false);
  assert.ok(check({ equippedSlot: 'arme' }, r.state, adv));
});
