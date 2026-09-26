// Tests du greffon « défis » (moteur pur) : node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/core.js';
import * as D from '../js/plugins/defis/core.js';
import { newAdventure, normalizeAdventure, createHero, start, enter, back } from '../js/core/rules.js';
import { validate, renumber, reachable } from '../js/core/validate.js';
import { makeRng } from '../js/core/dice.js';

const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

function adventure() {
  const a = newAdventure('Défis');
  a.id = 'defis-test';
  a.items = { cle: { name: 'Clé' } };
  const blocks = {
    text: { type: 'challenge', kind: 'text', title: 'Capitale', question: 'Capitale de La Réunion ?', answers: ['Saint-Denis', 'St-Denis'], attempts: 3,
      hints: [{ text: 'Un saint.', cost: [{ op: 'stat', stat: 'chance', add: -1 }] }, { text: 'Denis.', cost: [{ op: 'gold', add: -2 }] }],
      success: '2', failure: '9', successEffects: [{ op: 'give', item: 'cle' }], failureEffects: [{ op: 'stat', stat: 'endurance', add: -2 }], explanation: 'Chef-lieu.' },
    number: { type: 'challenge', kind: 'number', question: '7 × 8 ?', answers: { value: 56, tolerance: 0 }, attempts: 2, success: '3', failure: '9' },
    approx: { type: 'challenge', kind: 'number', question: 'π ?', answers: { value: 3.14, tolerance: 0.01 }, unit: 'rad', attempts: 0, success: '3' },
    qcm: { type: 'challenge', kind: 'qcm', question: 'Le plus grand ?', answers: [{ text: '2', correct: false }, { text: '9', correct: true }, { text: '5', correct: false }], attempts: 1, success: '4', failure: '9' },
    multi: { type: 'challenge', kind: 'multi', question: 'Nombres pairs ?', answers: [{ text: '2', correct: true }, { text: '3', correct: false }, { text: '8', correct: true }], attempts: 2, success: '5', failure: '9', allowGiveUp: true },
    order: { type: 'challenge', kind: 'order', question: 'Du plus petit au plus grand', answers: ['1', '2', '3', '4', '5'], attempts: 0, allowGiveUp: true, success: '6', failure: '9' },
  };
  a.sections = {
    '1': { text: 'Texte', blocks: [blocks.text], choices: [] },
    '2': { text: 'Nombre', blocks: [blocks.number, blocks.approx], choices: [] },
    '3': { text: 'QCM', blocks: [blocks.qcm], choices: [] },
    '4': { text: 'Multi', blocks: [blocks.multi], choices: [] },
    '5': { text: 'Ordre', blocks: [blocks.order], choices: [] },
    '6': { text: 'Victoire', ending: 'victory' },
    '9': { text: 'Échec', ending: 'death' },
  };
  return normalizeAdventure(a);
}
const at = (adv, sid, seed = 7) => { const { state } = createHero(adv, { seed }); return start(state, adv, sid).state; };

test('normalisation des réponses écrites', () => {
  assert.equal(D.normalizeText('  SAINT-DÉNIS. '), 'saint-denis');
  assert.equal(D.normalizeText('L’Œuvre   d\'art !!'), "l'oeuvre d'art");
  assert.equal(D.normalizeText('Éléphant…'), 'elephant');
  assert.equal(D.normalizeText('a  b'), 'a b');
  assert.equal(D.normalizeText('2x + 3', { ignoreSpaces: true }), '2x+3');
  assert.equal(D.normalizeText('?!'), '');
});

test('lecture des nombres : virgule, point, espaces, signe', () => {
  assert.equal(D.parseNumber('3,5'), 3.5);
  assert.equal(D.parseNumber('3.5'), 3.5);
  assert.equal(D.parseNumber(' 1 000 '), 1000);
  assert.equal(D.parseNumber('1 000,25'), 1000.25);
  assert.equal(D.parseNumber('−2'), -2);
  assert.equal(D.parseNumber('+4'), 4);
  assert.equal(D.parseNumber(',5'), 0.5);
  assert.ok(Number.isNaN(D.parseNumber('1,2,3')));
  assert.ok(Number.isNaN(D.parseNumber('douze')));
  assert.ok(Number.isNaN(D.parseNumber('')));
  assert.equal(D.canonNumber(D.parseNumber('3,50')), '3.5');
});

test('chaque type : bonne et mauvaise réponse', () => {
  const adv = adventure();
  const [text] = adv.sections['1'].blocks, [number, approx] = adv.sections['2'].blocks;
  const [qcm] = adv.sections['3'].blocks, [multi] = adv.sections['4'].blocks, [order] = adv.sections['5'].blocks;
  assert.equal(D.checkAnswer(text, 'saint denis', adv), false);
  assert.equal(D.checkAnswer(text, 'SAINT-DÉNIS !', adv), true);
  assert.equal(D.checkAnswer(text, 'st-denis', adv), true);
  assert.equal(D.checkAnswer(text, '', adv), false);
  assert.equal(D.checkAnswer(number, '56', adv), true);
  assert.equal(D.checkAnswer(number, '56,0', adv), true);
  assert.equal(D.checkAnswer(number, '54', adv), false);
  assert.equal(D.checkAnswer(approx, '3,145', adv), true);
  assert.equal(D.checkAnswer(approx, '3.15', adv), true, 'bord de la tolérance');
  assert.equal(D.checkAnswer(approx, '3,16', adv), false);
  assert.equal(D.checkAnswer(approx, '3,14 rad', adv), true, 'l’unité retapée est ignorée');
  assert.equal(D.checkAnswer(qcm, 1, adv), true);
  assert.equal(D.checkAnswer(qcm, 0, adv), false);
  assert.equal(D.checkAnswer(qcm, null, adv), false);
  assert.equal(D.checkAnswer(multi, [2, 0], adv), true);
  assert.equal(D.checkAnswer(multi, [0], adv), false, 'il en manque une');
  assert.equal(D.checkAnswer(multi, [0, 1, 2], adv), false, 'une de trop');
  assert.equal(D.checkAnswer(order, [0, 1, 2, 3, 4], adv), true);
  assert.equal(D.checkAnswer(order, [1, 0, 2, 3, 4], adv), false);
  assert.equal(D.checkAnswer(order, [0, 1, 2, 3], adv), false);
});

test('soumission : essais comptés, essais épuisés, effets d’échec, état non modifié', () => {
  const adv = adventure();
  const s0 = deepFreeze(at(adv, '1'));
  assert.deepEqual(s0.blocks[0], { tries: 0, hints: [], solved: false, failed: false, order: null, wrong: [], last: null });
  let r = D.submit(s0, adv, 0, 'Paris');
  assert.equal(r.correct, false);
  assert.equal(r.finished, false);
  assert.equal(r.counted, true);
  assert.equal(r.messages[0].text, 'Ce n’est pas ça. Il vous reste 2 essais.');
  assert.equal(r.state.blocks[0].tries, 1);
  // Même réponse fausse : aucun essai consommé.
  const again = D.submit(r.state, adv, 0, ' paris. ');
  assert.equal(again.counted, false);
  assert.equal(again.state, r.state);
  // Réponse vide : aucun essai consommé.
  assert.equal(D.submit(r.state, adv, 0, '   ').counted, false);
  r = D.submit(r.state, adv, 0, 'Lyon');
  assert.equal(r.messages[0].text, 'Ce n’est pas ça. Il vous reste 1 essai.');
  const end = s0.stats.endurance.cur;
  r = D.submit(r.state, adv, 0, 'Marseille');
  assert.equal(r.finished, true);
  assert.equal(r.state.blocks[0].failed, true);
  assert.equal(r.messages[0].text, 'Ce n’est pas ça. Vous n’avez plus d’essai.');
  assert.equal(r.state.stats.endurance.cur, Math.max(0, end - 2), 'effets d’échec');
  assert.equal(D.exitOf(r.state, adv, 0), '9');
  assert.deepEqual(r.state.defis.done['1#0'], { ok: false, tries: 3, hints: 0 });
  // Défi terminé : plus rien ne change.
  assert.equal(D.submit(r.state, adv, 0, 'Saint-Denis').state, r.state);
});

test('soumission : bonne réponse, effets de réussite, destination', () => {
  const adv = adventure();
  const s0 = deepFreeze(at(adv, '1'));
  const r = D.submit(s0, adv, 0, 'saint-denis');
  assert.equal(r.correct, true);
  assert.equal(r.finished, true);
  assert.equal(r.messages[0].text, 'Bonne réponse !');
  assert.equal(r.messages[0].verdict, true);
  assert.equal(r.state.inventory.cle, 1);
  assert.ok(r.messages.some(m => /Clé/.test(m.text)));
  assert.equal(D.exitOf(r.state, adv, 0), '2');
  assert.deepEqual(D.summary(r.state, adv), { solved: 1, failed: 0, hints: 0, total: 6 });
  // Nombre : la saisie illisible ne coûte pas d'essai.
  const s2 = at(adv, '2');
  const bad = D.submit(s2, adv, 0, 'cinquante-six');
  assert.equal(bad.counted, false);
  assert.match(bad.feedback, /nombre/);
  assert.equal(D.submit(s2, adv, 0, '56').correct, true);
  // Essais illimités.
  const inf = D.submit(s2, adv, 1, '3');
  assert.equal(inf.messages[0].text, 'Ce n’est pas ça. Essayez encore.');
  assert.equal(inf.finished, false);
});

test('QCM, cases à cocher et abandon', () => {
  const adv = adventure();
  const q = D.submit(at(adv, '3'), adv, 0, 0);
  assert.equal(q.finished, true, 'un seul essai');
  assert.equal(D.exitOf(q.state, adv, 0), '9');
  const m0 = at(adv, '4');
  const m1 = D.submit(m0, adv, 0, [0]);
  assert.equal(m1.correct, false);
  assert.equal(D.submit(m1.state, adv, 0, [0]).counted, false, 'même sélection');
  assert.equal(D.submit(m1.state, adv, 0, [2, 0]).correct, true);
  assert.equal(D.submit(m0, adv, 0, []).counted, false, 'aucune case');
  const g = D.giveUp(deepFreeze(m0), adv, 0);
  assert.equal(g.state.blocks[0].failed, true);
  assert.equal(g.state.blocks[0].gaveUp, true);
  assert.equal(D.exitOf(g.state, adv, 0), '9');
  assert.equal(D.verdict(adv.sections['4'].blocks[0], g.state.blocks[0]).text, 'Vous avez renoncé à ce défi.');
  const noGive = D.giveUp(at(adv, '1'), adv, 0);
  assert.equal(noGive.state.blocks[0].failed, false, 'abandon non autorisé');
});

test('indices : dans l’ordre, avec leur coût, refusés si on ne peut pas payer', () => {
  const adv = adventure();
  const s0 = deepFreeze({ ...at(adv, '1'), gold: 1 });
  const luck = s0.stats.chance.cur;
  assert.equal(D.nextHint(s0, adv, 0).index, 0);
  const h1 = D.useHint(s0, adv, 0);
  assert.equal(h1.hint, 0);
  assert.deepEqual(h1.state.blocks[0].hints, [0]);
  assert.equal(h1.state.stats.chance.cur, luck - 1);
  assert.equal(D.nextHint(h1.state, adv, 0).text, 'Denis.');
  assert.equal(D.cannotAfford(h1.state, adv, D.nextHint(h1.state, adv, 0).cost), 'Il vous faut 2 pièces d’or.');
  const refused = D.useHint(h1.state, adv, 0);
  assert.equal(refused.hint, null);
  assert.equal(refused.state, h1.state);
  const rich = { ...h1.state, gold: 5 };
  const h2 = D.useHint(rich, adv, 0);
  assert.deepEqual(h2.state.blocks[0].hints, [0, 1]);
  assert.equal(h2.state.gold, 3);
  assert.equal(D.nextHint(h2.state, adv, 0), null);
  const ok = D.submit(h2.state, adv, 0, 'Saint-Denis');
  assert.equal(ok.state.defis.done['1#0'].hints, 2);
  assert.equal(D.summary(ok.state, adv).hints, 2);
  // Un indice qui coûterait la vie est signalé.
  const weak = { ...s0, stats: { ...s0.stats, endurance: { cur: 1, init: 20 } } };
  assert.equal(D.isFatal(weak, adv, [{ op: 'stat', stat: 'endurance', add: -2 }]), true);
  assert.equal(D.isFatal(weak, adv, [{ op: 'stat', stat: 'chance', add: -1 }]), false);
});

test('ordre mélangé déterministe avec la graine de la partie', () => {
  const adv = adventure();
  const a = at(adv, '5', 42), b = at(adv, '5', 42), c = at(adv, '5', 43);
  const o = a.blocks[0].order;
  assert.deepEqual(o, b.blocks[0].order, 'même graine, même ordre');
  assert.deepEqual([...o].sort(), [0, 1, 2, 3, 4], 'permutation');
  assert.notDeepEqual(o, [0, 1, 2, 3, 4], 'jamais déjà rangé');
  assert.ok([...Array(20)].some((_, i) => JSON.stringify(at(adv, '5', 100 + i).blocks[0].order) !== JSON.stringify(o)), 'la graine change l’ordre');
  assert.equal(typeof c.blocks[0].order.length, 'number');
  for (let seed = 0; seed < 200; seed++) assert.notDeepEqual(D.shuffledOrder(2, makeRng(seed)), [0, 1]);
  // Le mélange fait avancer la graine (un paragraphe sans défi à ordonner ne la touche pas).
  const { state } = createHero(adv, { seed: 42 });
  assert.notEqual(start(state, adv, '5').state.rng, start(state, adv, '6').state.rng);
  // Réponse juste en suivant l'ordre d'origine ; retour en arrière : même ordre.
  const sorted = [...o].sort((x, y) => x - y);
  assert.equal(D.submit(a, adv, 0, sorted).correct, true);
  assert.equal(D.submit(a, adv, 0, o).correct, false);
  const next = enter(a, adv, '6').state;
  assert.deepEqual(back(next).blocks[0].order, o);
  // Partie sans état de bloc (ancienne sauvegarde) : ordre déduit sans toucher à la graine, stable.
  const old = { ...a, blocks: {} };
  assert.deepEqual(D.blockState(old, adv, 0).order, D.blockState(old, adv, 0).order);
  assert.equal(D.blockState(old, adv, 0).order.length, 5);
});

test('réponses chiffrées (SHA-256, asynchrone)', async () => {
  const adv = adventure();
  const hs = await D.hashAnswers(adv.sections['1'].blocks[0], adv);
  assert.equal(hs.length, 2);
  assert.ok(hs.every(h => /^[0-9a-f]{64}$/.test(h)));
  assert.equal(hs[0], D.sha256Sync('defis-test:saint-denis'), 'empreinte de « id:réponse normalisée »');
  assert.equal(await D.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const s of ['', 'a'.repeat(55), 'a'.repeat(64), 'é'.repeat(100)]) assert.equal(D.sha256Sync(s), await D.sha256Hex(s), 'le calcul de secours concorde');
  const text = { ...adv.sections['1'].blocks[0], hashed: true, salt: adv.id, answers: hs };
  adv.sections['1'].blocks[0] = text;
  const p = D.checkAnswer(text, 'Saint Denis', adv);
  assert.equal(typeof p.then, 'function', 'checkAnswer renvoie une promesse pour un défi chiffré');
  assert.equal(await p, false);
  assert.equal(await D.checkAnswerAsync(text, ' SAINT-DÉNIS. ', adv), true);
  assert.equal(await D.checkAnswerAsync(text, 'st-denis', adv), true);
  assert.equal(await D.checkAnswerAsync(adv.sections['3'].blocks[0], 1, adv), true, 'asynchrone aussi pour les réponses en clair');
  // submit ne peut pas vérifier seul une réponse chiffrée ; submitAsync le fait.
  const s0 = at(adv, '1');
  assert.throws(() => D.submit(s0, adv, 0, 'Paris'), /submitAsync/);
  const bad = await D.submitAsync(s0, adv, 0, 'Paris');
  assert.equal(bad.correct, false);
  assert.equal(bad.state.blocks[0].tries, 1);
  const good = await D.submitAsync(bad.state, adv, 0, 'saint-denis');
  assert.equal(good.correct, true);
  assert.equal(D.exitOf(good.state, adv, 0), '2');
  // Le sel reste celui du chiffrement si l'aventure est copiée (nouvel identifiant).
  const copy = { ...adv, id: 'copie-1234' };
  assert.equal(await D.checkAnswerAsync(text, 'Saint-Denis', copy), true);
  // Nombres exacts uniquement.
  const num = adv.sections['2'].blocks[0];
  const nh = await D.hashAnswers(num, adv);
  const hashedNum = { ...num, hashed: true, salt: adv.id, answers: nh };
  assert.equal(await D.checkAnswerAsync(hashedNum, '56,0', adv), true);
  assert.equal(await D.checkAnswerAsync(hashedNum, '55', adv), false);
  await assert.rejects(D.hashAnswers(adv.sections['2'].blocks[1], adv), /tolérance/);
  await assert.rejects(D.hashAnswers(adv.sections['3'].blocks[0], adv), /écrites ou numériques/);
  // Ajout d'une réponse chiffrée à la saisie.
  const extra = await D.hashOne(text, adv, 'Saint-Denis de La Réunion');
  assert.equal(await D.checkAnswerAsync({ ...text, answers: [...hs, extra] }, 'saint-denis de la reunion', adv), true);
  assert.equal(await D.hashOne(text, adv, '   '), null);
});

test('graphe, vérification et renumérotation', () => {
  const adv = adventure();
  const errs = validate(adv).filter(p => p.level === 'error');
  assert.deepEqual(errs, []);
  assert.equal(reachable(adv).size, 7);
  const broken = structuredClone(adv);
  broken.sections['3'].blocks[0].answers.forEach(o => { o.correct = false; });
  broken.sections['4'].blocks[0].answers = [{ text: 'seul', correct: true }];
  broken.sections['1'].blocks[0].success = '';
  broken.sections['1'].blocks[0].hints[0].cost = [{ op: 'stat', stat: 'magie', add: -1 }];
  const msgs = validate(broken).map(p => `${p.level} ${p.message}`);
  assert.ok(msgs.some(m => /error .*aucune proposition n'est marquée/.test(m)));
  assert.ok(msgs.some(m => /error .*au moins deux propositions/.test(m)));
  assert.ok(msgs.some(m => /error .*bonne réponse.*bloqué/.test(m)));
  assert.ok(msgs.some(m => /error .*caractéristique inconnue « magie »/.test(m)));
  // Renumérotation : destinations et conditions des effets suivent.
  const withCond = structuredClone(adv);
  withCond.sections['1'].blocks[0].successEffects = [{ op: 'gold', add: 1, if: { visited: '3' } }];
  withCond.sections['1'].blocks[0].hints[0].cost = [{ op: 'stat', stat: 'chance', add: -1, if: { not: { visited: '4' } } }];
  const { adventure: r, mapping } = renumber(withCond, makeRng(3));
  const b = r.sections[mapping['1']].blocks[0];
  assert.equal(b.success, mapping['2']);
  assert.equal(b.failure, mapping['9']);
  assert.equal(b.successEffects[0].if.visited, mapping['3']);
  assert.equal(b.hints[0].cost[0].if.not.visited, mapping['4']);
  assert.equal(validate(r).filter(p => p.level === 'error').length, 0);
});

test('une aventure sans défi fonctionne comme avant', () => {
  const a = normalizeAdventure({ ...newAdventure('Sans défi'), sections: { '1': { text: 'Début', choices: [{ text: 'Suite', to: '2' }] }, '2': { text: 'Fin', ending: 'victory' } } });
  const { state } = createHero(a, { seed: 1 });
  const s = start(state, a, '1').state;
  assert.deepEqual(s.blocks, {});
  assert.equal(s.rng, start(state, a, '1').state.rng);
  assert.deepEqual(D.summary(s, a), { solved: 0, failed: 0, hints: 0, total: 0 });
  assert.equal(D.hasChallenges(a), false);
  assert.deepEqual(D.solutionsOf(a), []);
});

test('impression : énoncé, instruction et solutions', () => {
  const adv = adventure();
  const h = { go: n => `rendez-vous au <b>${n}</b>`, esc: s => String(s), effectText: e => (e.op === 'give' ? 'Inscrivez sur votre Feuille d’Aventure : Clé.' : 'Vous perdez 2 points d’ENDURANCE.') };
  const t = D.printChallenge(adv.sections['1'].blocks[0], adv, h);
  assert.match(t, /Notez votre réponse puis consultez les Solutions des défis en fin de livre \(défi du <b>1<\/b>\) : si elle est juste, inscrivez .* puis rendez-vous au <b>2<\/b> ; sinon, vous perdez .* puis rendez-vous au <b>9<\/b>\./);
  assert.match(t, /class="pr-flip"/);
  const q = D.printChallenge(adv.sections['3'].blocks[0], adv, h);
  assert.match(q, /<ol class="pr-defi-opts" type="A"><li>2<\/li><li>9<\/li><li>5<\/li><\/ol>/);
  assert.match(q, /sinon au <b>9<\/b>/);
  const sol = D.solutionsOf(adv);
  assert.deepEqual(sol.map(s => s.label), ['1', '2 a', '2 b', '3', '4', '5']);
  assert.equal(sol[0].solution, '« Saint-Denis » (acceptées aussi : « St-Denis »)');
  assert.equal(sol[1].solution, '56');
  assert.equal(sol[2].solution, '3,14 rad (à 0,01 près)');
  assert.equal(sol[3].solution, 'B (9)');
  assert.equal(sol[4].solution, 'A (2) et C (8)');
  // Ordre : les lettres de la solution correspondent au mélange imprimé.
  const items = D.orderItems(adv.sections['5'].blocks[0]);
  const shown = D.printOrder(adv.sections['5'].blocks[0]);
  const letters = sol[5].solution.split(' (')[0].split(', ');
  assert.deepEqual(letters.map(l => items[shown[l.charCodeAt(0) - 65]]), items);
  const hashed = { ...adv.sections['1'].blocks[0], hashed: true, answers: ['0'.repeat(64)] };
  assert.equal(D.solutionText(hashed), 'réponse chiffrée : à vérifier dans l’application');
});

test('éditeur : conversion des réponses d’un type à l’autre', () => {
  const adv = adventure();
  const text = adv.sections['1'].blocks[0];
  assert.deepEqual(D.convertAnswers(text, 'qcm').map(o => o.correct), [true, false]);
  assert.deepEqual(D.convertAnswers(text, 'order'), ['Saint-Denis', 'St-Denis']);
  assert.deepEqual(D.convertAnswers(adv.sections['4'].blocks[0], 'qcm').map(o => o.correct), [true, false, false]);
  assert.deepEqual(D.convertAnswers(adv.sections['4'].blocks[0], 'text'), ['2', '8']);
  assert.deepEqual(D.convertAnswers(adv.sections['2'].blocks[1], 'text'), ['3,14']);
  assert.deepEqual(D.convertAnswers({ kind: 'text', answers: ['douze', '12'] }, 'number'), { value: 12, tolerance: 0 });
  assert.deepEqual(D.convertAnswers({ kind: 'text', hashed: true, answers: ['ab'] }, 'number'), D.defaultAnswers('number'));
});
