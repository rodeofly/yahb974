import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/core.js';
import { newAdventure, normalizeAdventure, createHero, start, choose, enter } from '../js/core/rules.js';
import { renumber, renameSection } from '../js/core/validate.js';
import { makeRng } from '../js/core/dice.js';
import {
  evaluateAchievements, newlyUnlocked, achievementView, describeAchievement, achievementProblems, normalizeAchievement, uniqueId,
  emptyStats, statsOnStart, statsOnEnd, addVisits, visitDiff, progress, deathRanking, neverVisited, endingsReached, otherDeaths, mostVisited, pct,
} from '../js/plugins/succes/core.js';

function sample(achievements) {
  const a = newAdventure('Succès');
  a.items = { cle: { name: 'Clé' } };
  a.sections = {
    '1': { text: 'Départ', choices: [{ text: 'Porte', to: '2' }, { text: 'Cave', to: '3', effects: [{ op: 'give', item: 'cle' }] }, { text: 'Gouffre', to: '4' }] },
    '2': { text: 'Victoire', ending: 'victory', choices: [] },
    '3': { text: 'Cave secrète', choices: [{ text: 'Remonter', to: '1' }] },
    '4': { text: 'Chute', ending: 'death', choices: [] },
    '5': { text: 'Jamais atteint', choices: [{ text: 'retour', to: '1' }] },
  };
  if (achievements) a.achievements = achievements;
  return normalizeAdventure(a);
}

const ACH = [
  { id: 'gagner', title: 'Vainqueur', when: 'end', ending: 'victory' },
  { id: 'mourir', title: 'Première chute', when: 'end', ending: 'death' },
  { id: 'fin', title: 'Une fin, n’importe laquelle', when: 'end' },
  { id: 'cle-victoire', title: 'Avec la clé', when: 'end', ending: 'victory', cond: { has: 'cle' } },
  { id: 'cave', title: 'Spéléologue', secret: true, when: 'anytime', cond: { visited: '3' } },
];

const hero = (adv, seed = 3) => createHero(adv, { seed }).state;

test('rétrocompatibilité : une aventure sans succès reçoit une liste vide', () => {
  const adv = sample();
  assert.deepEqual(adv.achievements, []);
  const s = start(hero(adv), adv).state;
  assert.deepEqual(evaluateAchievements(adv, s, 'anytime'), []);
  assert.deepEqual(evaluateAchievements(adv, s, 'end'), []);
});

test('normalisation : valeurs par défaut, champs inconnus conservés', () => {
  const adv = sample([{ id: 'x', title: 'X', when: 'jamais', ending: 'bof', icon: 'etoile' }, null, 'n’importe quoi']);
  assert.equal(adv.achievements.length, 1);
  assert.deepEqual(adv.achievements[0], { id: 'x', title: 'X', description: '', secret: false, when: 'end', ending: null, icon: 'etoile' });
  assert.equal(normalizeAchievement({ id: 3, cond: null }).id, '3');
  assert.equal('cond' in normalizeAchievement({ id: 'a', cond: null }), false);
});

test('fin : succès liés à la victoire ou à la mort', () => {
  const adv = sample(ACH);
  let s = start(hero(adv), adv).state;
  assert.deepEqual(evaluateAchievements(adv, s, 'end'), [], 'la partie n’est pas finie');
  const win = choose(s, adv, 0).state;
  assert.equal(win.ended, 'victory');
  assert.deepEqual(evaluateAchievements(adv, win, 'end'), ['gagner', 'fin']);
  const dead = choose(s, adv, 2).state;
  assert.equal(dead.ended, 'death');
  assert.deepEqual(evaluateAchievements(adv, dead, 'end'), ['mourir', 'fin']);
});

test('condition : il faut la clé ET la victoire', () => {
  const adv = sample(ACH);
  let s = start(hero(adv), adv).state;
  s = choose(s, adv, 1).state; // cave : la clé
  s = choose(s, adv, 0).state; // retour au 1
  const win = choose(s, adv, 0).state;
  assert.ok(evaluateAchievements(adv, win, 'end').includes('cle-victoire'));
  const dead = choose(s, adv, 2).state;
  assert.ok(!evaluateAchievements(adv, dead, 'end').includes('cle-victoire'), 'la clé ne suffit pas sans la victoire');
});

test('à tout moment : débloqué en pleine partie, et aussi examiné à la fin', () => {
  const adv = sample(ACH);
  let s = start(hero(adv), adv).state;
  assert.deepEqual(evaluateAchievements(adv, s, 'anytime'), []);
  s = choose(s, adv, 1).state;
  assert.deepEqual(evaluateAchievements(adv, s, 'anytime'), ['cave'], 'les succès « à la fin » ne sont pas examinés en cours de partie');
  s = choose(choose(s, adv, 0).state, adv, 0).state;
  assert.ok(evaluateAchievements(adv, s, 'end').includes('cave'));
  assert.deepEqual(newlyUnlocked(adv, s, 'end', { cave: '2026-01-01T00:00:00.000Z', fin: 'x' }), ['gagner', 'cle-victoire']);
});

test('à tout moment + fin précise : seulement quand la partie finit ainsi', () => {
  const adv = sample([{ id: 'v', title: 'V', when: 'anytime', ending: 'victory' }]);
  const s = start(hero(adv), adv).state;
  assert.deepEqual(evaluateAchievements(adv, s, 'anytime'), []);
  assert.deepEqual(evaluateAchievements(adv, choose(s, adv, 0).state, 'anytime'), ['v']);
});

test('secret : débloqué comme les autres, mais masqué tant qu’il ne l’est pas', () => {
  const adv = sample(ACH);
  const cave = adv.achievements.find(a => a.id === 'cave');
  const s = choose(start(hero(adv), adv).state, adv, 1).state;
  assert.ok(evaluateAchievements(adv, s, 'anytime').includes('cave'));
  const locked = achievementView(cave, null);
  assert.equal(locked.title, '???');
  assert.equal(locked.hidden, true);
  assert.doesNotMatch(locked.description, /Spéléo/);
  const open = achievementView(cave, '2026-09-26T10:00:00.000Z');
  assert.equal(open.title, 'Spéléologue');
  assert.equal(open.unlocked, true);
  assert.equal(achievementView(adv.achievements[0], null).title, 'Vainqueur', 'un succès non secret reste lisible');
});

test('évaluation robuste : succès sans identifiant ignoré, condition inconnue jamais remplie, pas de mutation', () => {
  const adv = sample([{ id: '', title: 'fantôme' }, { id: 'bizarre', title: 'B', when: 'anytime', cond: { greffonAbsent: 1, stat: 'inconnue', gte: 5 } }]);
  const s = start(hero(adv), adv).state;
  const before = JSON.stringify(s);
  assert.deepEqual(evaluateAchievements(adv, s, 'anytime'), []);
  assert.deepEqual(evaluateAchievements(adv, null, 'end'), []);
  assert.equal(JSON.stringify(s), before);
});

test('textes de l’éditeur et avertissements', () => {
  const adv = sample(ACH);
  assert.match(describeAchievement(adv.achievements[3], adv), /victoire.*Clé/);
  assert.match(describeAchievement({ when: 'anytime' }, adv), /dès le début/);
  assert.match(describeAchievement({ when: 'end', ending: 'death' }, adv), /meurt/);
  const bad = { id: 'gagner', title: '', when: 'anytime', cond: { visited: '99' } };
  const a2 = { ...adv, achievements: [...adv.achievements, bad] };
  const p = achievementProblems(bad, a2);
  assert.ok(p.some(x => /double/.test(x)));
  assert.ok(p.some(x => /titre/.test(x)));
  assert.ok(p.some(x => /99/.test(x)));
  assert.equal(achievementProblems(adv.achievements[0], adv).length, 0);
  assert.equal(uniqueId('Victoire !', ['victoire', 'victoire-2']), 'victoire-3');
  assert.equal(uniqueId('', []), 'succes');
});

test('renumérotation et renommage : les conditions « est passé par » suivent', () => {
  const adv = sample(ACH);
  const { adventure, mapping } = renumber(adv, makeRng(4));
  assert.equal(adventure.achievements.find(a => a.id === 'cave').cond.visited, mapping['3']);
  const renamed = renameSection(adv, '3', '300');
  assert.equal(renamed.achievements.find(a => a.id === 'cave').cond.visited, '300');
  assert.equal(adv.achievements.find(a => a.id === 'cave').cond.visited, '3', 'l’original est intact');
  assert.equal(renumber(sample(), makeRng(1)).adventure.achievements.length, 0);
});

test('statistiques : parties, visites, fins, morts', () => {
  const adv = sample(ACH);
  let s = start(hero(adv), adv).state;
  let st = statsOnStart(emptyStats(), s, 'T1');
  assert.equal(st.runs, 1);
  assert.deepEqual(st.visited, { 1: 1 });
  const next = choose(s, adv, 1).state;
  st = addVisits(st, visitDiff(s.visited, next.visited), 'T2');
  assert.deepEqual(st.visited, { 1: 1, 3: 1 });
  assert.deepEqual(visitDiff(next.visited, s.visited), {}, 'un retour en arrière ne retire rien');
  const back1 = choose(next, adv, 0).state;
  st = addVisits(st, visitDiff(next.visited, back1.visited), 'T3');
  assert.equal(st.visited['1'], 2);
  const dead = choose(back1, adv, 2).state;
  st = addVisits(st, visitDiff(back1.visited, dead.visited));
  st = statsOnEnd(st, dead, 'T4');
  assert.equal(st.deaths, 1);
  assert.deepEqual(st.deathsAt, { 4: 1 });
  assert.deepEqual(st.endings, { 4: 1 });
  assert.equal(st.lastPlayed, 'T4');
  // deuxième partie : victoire
  let s2 = start(hero(adv, 9), adv).state;
  st = statsOnStart(st, s2, 'T5');
  s2 = choose(s2, adv, 0).state;
  st = statsOnEnd(addVisits(st, visitDiff({ 1: 1 }, s2.visited)), s2, 'T6');
  assert.equal(st.runs, 2);
  assert.equal(st.victories, 1);
  assert.equal(statsOnEnd(st, s, 'T7').runs, 2, 'une partie en cours ne compte pas comme une fin');
  // mort en combat hors paragraphe de fin
  const inCave = { ...enter(s, adv, '3').state, ended: 'death' };
  st = statsOnEnd(st, inCave);
  assert.deepEqual(otherDeaths(adv, st), [{ sid: '3', n: 1 }]);

  const p = progress(adv, st, { gagner: 'x', cave: 'y', inconnu: 'z' });
  assert.deepEqual(p.explored, { n: 4, total: 5, pct: 80 });
  assert.deepEqual(p.endings, { n: 2, total: 2 });
  assert.deepEqual(p.achievements, { n: 2, total: 5 });
  assert.deepEqual(neverVisited(adv, st), ['5']);
  assert.deepEqual(endingsReached(adv, st), [{ sid: '2', kind: 'victory', n: 1 }, { sid: '4', kind: 'death', n: 1 }]);
  const rank = deathRanking(st);
  assert.equal(rank.length, 2);
  assert.equal(rank[0].share, 0.5);
  assert.equal(mostVisited(st, 1)[0].sid, '1');
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(1, 0), 0);
});

test('statistiques abîmées ou absentes : valeurs sûres', () => {
  const adv = sample();
  assert.deepEqual(progress(adv, undefined), { runs: 0, explored: { n: 0, total: 5, pct: 0 }, endings: { n: 0, total: 2 }, achievements: { n: 0, total: 0 } });
  assert.equal(statsOnStart({ runs: 'x', visited: null }, { visited: { 1: 1 } }).runs, 1);
  assert.deepEqual(deathRanking(null), []);
});
