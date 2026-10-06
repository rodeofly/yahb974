// Tests du greffon « campagne » (passeport du voyageur) et du vocabulaire du combat par mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/compteurs/core.js';
import '../js/plugins/compagnons/core.js';
import * as P from '../js/plugins/campagne/core.js';
import { newAdventure, normalizeAdventure, createHero } from '../js/core/rules.js';
import { startCombat, attackRound, autoFight, combatWords, COMBAT_WORDS } from '../js/core/combat.js';

const pieces = Array.from({ length: 33 }, (_, i) => 'piece-' + String(i + 1).padStart(2, '0'));

function book(n, extra = {}) {
  const a = newAdventure('Livre ' + n);
  a.rules.counters = [{ id: 'memoire', label: 'Mémoire', start: 0, min: 0, visible: true, triggers: [] }];
  a.companions = { anchaing: { name: 'Anchaing', skill: 8, health: 8 } };
  a.rules.campaign = {
    id: 'tresor-labuse', title: 'Le Trésor de La Buse', book: n, prefix: 'LB', modes: ['petit', 'pisteur', 'gardien'],
    fields: { stats: ['habilete', 'endurance', 'chance'], counters: ['memoire'], items: [...pieces, 'piece-trouee'], flags: ['papangue-ami'], companions: ['anchaing'], ...extra },
    newcomer: { gold: 5, items: ['piece-trouee'], flags: [] },
  };
  a.sections = { '1': { text: 'Fin', ending: 'victory', choices: [], blocks: [], onEnter: [] } };
  return normalizeAdventure(a);
}

function hero(adv) {
  const { state } = createHero(adv, { seed: 3 });
  state.mode = 'gardien';
  state.stats.habilete = { cur: 6, init: 11 };
  state.stats.endurance = { cur: 2, init: 21 };
  state.stats.chance = { cur: 4, init: 9 };
  state.gold = 17;
  state.counters.memoire = 9;
  state.inventory = { 'piece-01': 1, 'piece-33': 1, 'piece-trouee': 1, 'mangue': 2 };
  state.flags = { 'papangue-ami': true, 'autre': true };
  state.companions = [{ id: 'anchaing', health: 2, max: 8 }];
  return state;
}

test('aller-retour : le passeport du livre 1 redonne le même héros au livre 2', () => {
  const b1 = book(1), b2 = book(2);
  const code = P.encodePassport(P.campaignOf(b1), P.passportOf(hero(b1), b1));
  assert.match(code, /^LB1-[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
  const r = P.decodePassport(P.campaignOf(b2), code);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pass, {
    book: 1, mode: 'gardien', stats: { habilete: 11, endurance: 21, chance: 9 }, gold: 17, counters: { memoire: 9 },
    items: ['piece-01', 'piece-33', 'piece-trouee'], flags: ['papangue-ami'], companions: ['anchaing'],
  });
});

test('appliqué au départ : valeurs de départ pleines, objets, marques, compagnon soigné ; rien d\'autre', () => {
  const b1 = book(1), b2 = book(2);
  const r = P.decodePassport(P.campaignOf(b2), P.encodePassport(P.campaignOf(b1), P.passportOf(hero(b1), b1)));
  const { state } = createHero(b2, { seed: 9 });
  P.applyPassport(state, b2, r.pass, 'LB1-…');
  assert.deepEqual(state.stats.endurance, { cur: 21, init: 21 });
  assert.equal(state.gold, 17);
  assert.equal(state.counters.memoire, 9);
  assert.equal(state.inventory['piece-trouee'], 1);
  assert.equal(state.inventory.mangue, undefined, 'les objets non déclarés ne voyagent pas');
  assert.equal(state.flags['papangue-ami'], true);
  assert.equal(state.flags.autre, undefined);
  assert.deepEqual(state.companions, [{ id: 'anchaing', health: 8, max: 8 }]);
  assert.deepEqual(state.campaign, { from: 1, code: 'LB1-…' });
});

test('saisie tolérante : minuscules, espaces, préfixe collé, O pour 0', () => {
  const b1 = book(1);
  const camp = P.campaignOf(b1);
  const code = P.encodePassport(camp, P.passportOf(hero(b1), b1));
  for (const typed of [code.toLowerCase(), code.replace(/-/g, ' '), code.replace(/-/g, ''), code.replace(/0/g, 'O')]) {
    assert.equal(P.decodePassport(camp, typed).ok, true, typed);
  }
});

test('codes refusés avec un message clair', () => {
  const b1 = book(1);
  const camp = P.campaignOf(b1);
  const code = P.encodePassport(camp, P.passportOf(hero(b1), b1));
  const i = code.length - 6;
  const typo = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
  assert.match(P.decodePassport(camp, typo).error, /vérifie/);
  assert.match(P.decodePassport({ ...camp, id: 'autre-serie' }, code).error, /autre série/);
  assert.match(P.decodePassport(camp, code.slice(0, 12)).error, /incomplet|vérifie/);
  assert.match(P.decodePassport(camp, '').error, /vide/);
});

test('les listes s\'allongent : un vieux passeport se lit encore ; un passeport plus récent est refusé', () => {
  const b1 = book(1);
  const b3 = book(3, { items: [...pieces, 'piece-trouee', 'grille-labuse'], flags: ['papangue-ami', 'perroquet-epargne'] });
  const old = P.encodePassport(P.campaignOf(b1), P.passportOf(hero(b1), b1));
  const r = P.decodePassport(P.campaignOf(b3), old);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pass.flags, ['papangue-ami']);
  const s3 = hero(b3); s3.inventory['grille-labuse'] = 1;
  const recent = P.encodePassport(P.campaignOf(b3), P.passportOf(s3, b3));
  assert.match(P.decodePassport(P.campaignOf(b1), recent).error, /plus récent/);
});

test('nouveau voyageur et affichage du passeport', () => {
  const b2 = book(2);
  const { state } = createHero(b2, { seed: 1 });
  P.applyNewcomer(state, b2);
  assert.equal(state.gold, 5);
  assert.equal(state.inventory['piece-trouee'], 1);
  state.section = '1'; state.ended = 'victory';
  assert.equal(P.showsPassport(state, b2), true);
  const noPass = structuredClone(b2); noPass.sections['1'].passport = false;
  assert.equal(P.showsPassport(state, noPass), false);
  const plain = book(2); delete plain.rules.campaign;
  assert.equal(P.showsPassport(state, plain), false);
});

/* ---------- vocabulaire du combat ---------- */

function duel(words) {
  const a = newAdventure('Duel');
  if (words) a.rules.combat.words = words;
  a.sections = {
    '1': { text: 'Duel', onEnter: [], choices: [], blocks: [{ type: 'combat', enemies: [{ name: 'la scolopendre', skill: 1, health: 3 }], win: '2' }] },
    '2': { text: 'Fin', ending: 'victory', choices: [], blocks: [], onEnter: [] },
  };
  const adv = normalizeAdventure(a);
  let { state } = createHero(adv, { seed: 5 });
  state.stats.habilete = { cur: 12, init: 12 };
  state.section = '1';
  return { adv, state };
}

test('vocabulaire par défaut : les libellés historiques ne changent pas', () => {
  const { adv, state } = duel();
  assert.equal(combatWords(adv).title, 'Combat');
  const s = autoFight(startCombat(state, adv, 0), adv);
  assert.ok(s.combat.log.some(l => /^Assaut 1 — vous \d+ contre la scolopendre \d+ : vous blessez la scolopendre \(−2\)\.$/.test(l)));
  assert.ok(s.combat.log.includes('la scolopendre est vaincu.'));
});

test('vocabulaire du duel de courage : ni blessure ni « vaincu » dans le journal', () => {
  const { adv, state } = duel({
    title: 'Duel de courage', round: 'manche {round}', logRound: 'Manche {round} : {txt}.', logHit: '{name} recule d’un pas',
    down: '{name} s’enfuit dans la forêt.', hit: '{name} recule ! −{n} de Peur', foeHealth: 'Peur',
  });
  const W = combatWords(adv);
  assert.equal(W.foeHealth, 'Peur');
  assert.equal(W.attack, COMBAT_WORDS.attack, 'les libellés non remplacés gardent leur valeur');
  const s = attackRound(startCombat(state, adv, 0), adv);
  assert.equal(s.combat.log[0], 'Manche 1 : la scolopendre recule d’un pas.');
  const end = autoFight(s, adv);
  assert.ok(end.combat.log.includes('la scolopendre s’enfuit dans la forêt.'));
  assert.ok(!end.combat.log.some(l => /bless|vaincu/i.test(l)));
});
