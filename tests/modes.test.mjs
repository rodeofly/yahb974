import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/core.js';
import { newAdventure, normalizeAdventure, createHero, start, choose, choicesFor, check, describeCondition, applyEffects, targetsOf } from '../js/core/rules.js';
import { validate, reachable, renumber, renameSection } from '../js/core/validate.js';
import { ext } from '../js/core/plugins.js';
import { makeRng } from '../js/core/dice.js';
import { applyMode, listModes, resolveMode, validateModes, modeSummary, mergeRules, sectionFor, newModeId } from '../js/plugins/modes/core.js';

/** Mission neurones, en miniature : trois modes, une clairière dangereuse, une capture douce ou vraie. */
function mission() {
  const a = newAdventure('Mission neurones');
  a.rules.allowBack = false;
  a.rules.modes = [
    { id: 'petit', label: 'Petit explorateur', ages: '5-7 ans', description: 'Textes courts.', icon: 'pousse', rules: { allowBack: true, combat: { damage: 1 } }, prefs: { ttsAuto: true, size: 22 } },
    { id: 'moyen', label: 'Explorateur', ages: '8-9 ans', description: '' },
    { id: 'grand', label: 'Grand explorateur', ages: '10-11 ans et plus', description: 'Vraies fins.' },
  ];
  a.sections = {
    '1': {
      title: 'Le camp', text: 'Le groupe de marrons se cache dans les hauts de la Rivière des Remparts.',
      variants: { petit: { text: 'Tu es dans la forêt avec tes amis.', title: 'La forêt' } },
      choices: [
        { text: 'Traverser la clairière', to: '2' },
        { text: 'Écouter le vieux sage', to: '3', modes: ['petit'] },
        { text: 'Étudier la carte', to: '4', modes: ['moyen', 'grand'] },
      ],
      blocks: [
        { type: 'test', stat: 'chance', success: '4', failure: '2', modes: ['grand'] },
      ],
      onEnter: [],
    },
    '2': {
      title: 'Repérés', text: 'Les chasseurs vous capturent. Note historique : les marrons capturés étaient durement punis.',
      ending: 'death',
      variants: { petit: { text: 'Le groupe est repéré : il se replie en silence. On réessaie ?', ending: null } },
      choices: [{ text: 'Réessayer', to: '1', modes: ['petit'] }],
      blocks: [], onEnter: [],
    },
    '3': { text: 'Le sage t’explique le cerveau.', choices: [{ text: 'Merci', to: '4' }], blocks: [], onEnter: [] },
    '4': { text: 'Vous atteignez le refuge.', ending: 'victory', choices: [], blocks: [], onEnter: [] },
  };
  return normalizeAdventure(a);
}

const heroIn = (adv, mode, seed = 1) => { const { state } = createHero(adv, { seed }); state.mode = mode; return state; };

test('sans modes : rien ne change (rétrocompatibilité)', () => {
  const a = newAdventure('Classique');
  a.sections['1'].choices = [{ text: 'Suite', to: '2' }];
  a.sections['2'] = { text: 'Fin', ending: 'victory', choices: [], blocks: [], onEnter: [] };
  const adv = normalizeAdventure(a);
  assert.deepEqual(adv.rules.modes, []);
  assert.deepEqual(listModes(adv), []);
  assert.equal(applyMode(adv, 'petit'), adv, 'aventure renvoyée telle quelle');
  const { state } = createHero(adv, { seed: 2 });
  assert.equal(state.mode, null);
  let r = start(state, adv);
  r = choose(r.state, adv, 0);
  assert.equal(r.state.ended, 'victory');
  assert.equal(validate(adv).filter(p => p.level !== 'info').length, 0);
  assert.deepEqual(validateModes(adv), []);
  // Un fichier ancien sans « rules.modes » ni « variants » se normalise sans erreur.
  const old = normalizeAdventure({ meta: { title: 'Ancien' }, start: '1', sections: { '1': { text: 'x', ending: 'victory' } } });
  assert.deepEqual(old.rules.modes, []);
});

test('applyMode : variantes champ par champ, sans toucher à l’original', () => {
  const adv = mission();
  const before = JSON.stringify(adv);
  const petit = applyMode(adv, 'petit');
  const grand = applyMode(adv, 'grand');
  assert.equal(JSON.stringify(adv), before, 'original intact');
  assert.notEqual(petit, adv);
  assert.equal(petit.sections['1'].text, 'Tu es dans la forêt avec tes amis.');
  assert.equal(petit.sections['1'].title, 'La forêt');
  assert.equal(grand.sections['1'].text, adv.sections['1'].text);
  assert.equal(grand.sections['1'].title, 'Le camp');
  assert.equal(petit.sections['2'].ending, null, 'ending: null retire la fin');
  assert.equal(grand.sections['2'].ending, 'death');
  assert.equal(petit.sections['1'].variants, undefined, 'plus de variantes dans l’aventure effective');
  assert.equal(petit.appliedMode, 'petit');
  // Paragraphe sans variante : identique (à part le filtrage).
  assert.equal(petit.sections['4'].text, adv.sections['4'].text);
  // Fonction de base : sectionFor.
  assert.equal(sectionFor(adv.sections['2'], 'moyen').ending, 'death');
});

test('applyMode : choix et blocs filtrés par modes', () => {
  const adv = mission();
  const t = mode => applyMode(adv, mode).sections['1'].choices.map(c => c.to);
  assert.deepEqual(t('petit'), ['2', '3']);
  assert.deepEqual(t('moyen'), ['2', '4']);
  assert.deepEqual(t('grand'), ['2', '4']);
  assert.equal(applyMode(adv, 'petit').sections['1'].blocks.length, 0);
  assert.equal(applyMode(adv, 'grand').sections['1'].blocks.length, 1);
  // modes: [] = visible dans aucun mode.
  adv.sections['4'].choices = [{ text: 'Jamais', to: '1', modes: [] }];
  assert.equal(applyMode(adv, 'petit').sections['4'].choices.length, 0);
});

test('applyMode : règles du mode fusionnées (objets imbriqués compris)', () => {
  const adv = mission();
  const petit = applyMode(adv, 'petit');
  assert.equal(adv.rules.allowBack, false);
  assert.equal(petit.rules.allowBack, true);
  assert.equal(petit.rules.combat.damage, 1);
  assert.equal(petit.rules.combat.skill, 'habilete', 'le reste des règles de combat est gardé');
  assert.equal(applyMode(adv, 'grand').rules.allowBack, false);
  assert.equal(petit.rules.modes.length, 3, 'la liste des modes reste disponible');
  assert.deepEqual(mergeRules({ a: 1, o: { x: 1, y: 2 }, l: [1, 2] }, { o: { y: 3 }, l: [9], modes: ['x'] }), { a: 1, o: { x: 1, y: 3 }, l: [9] });
  // Règles de départ : le héros créé dans l'aventure effective du mode en profite.
  adv.rules.modes[0].rules.provisions = 5;
  assert.equal(createHero(applyMode(adv, 'petit'), { seed: 1 }).state.provisions, 5);
  assert.equal(createHero(applyMode(adv, 'grand'), { seed: 1 }).state.provisions, adv.rules.provisions);
});

test('mode inconnu ou absent : premier mode de la liste', () => {
  const adv = mission();
  assert.equal(resolveMode(adv, null).id, 'petit');
  assert.equal(resolveMode(adv, 'nimporte').id, 'petit');
  assert.equal(applyMode(adv, null).appliedMode, 'petit');
  assert.equal(newModeId(adv, 'Petit'), 'petit-2');
  assert.equal(newModeId(adv, 'Très Grand !'), 'tres-grand');
});

test('partie complète : fin douce en petit mode, vraie fin en grand mode', () => {
  const adv = mission();
  const petit = applyMode(adv, 'petit');
  let r = start(heroIn(petit, 'petit'), petit);
  assert.equal(choicesFor(r.state, petit).length, 2);
  r = choose(r.state, petit, 0);
  assert.equal(r.state.section, '2');
  assert.equal(r.state.ended, null, 'le groupe se replie : pas de fin');
  assert.deepEqual(choicesFor(r.state, petit).map(c => c.text), ['Réessayer']);
  r = choose(r.state, petit, 0);
  assert.equal(r.state.section, '1');
  r = choose(r.state, petit, 1);
  assert.equal(r.state.section, '3');

  const grand = applyMode(adv, 'grand');
  let g = start(heroIn(grand, 'grand'), grand);
  g = choose(g.state, grand, 0);
  assert.equal(g.state.ended, 'death', 'capture : vraie fin');
  assert.equal(choicesFor(g.state, grand).length, 0);
  // Le choix n°1 du grand mode est « Étudier la carte » (indices propres à l’aventure effective).
  g = choose(start(heroIn(grand, 'grand'), grand).state, grand, 1);
  assert.equal(g.state.ended, 'victory');
});

test('condition { mode }', () => {
  const adv = mission();
  const s = heroIn(adv, 'moyen');
  assert.equal(check({ mode: 'moyen' }, s, adv), true);
  assert.equal(check({ mode: 'petit' }, s, adv), false);
  assert.equal(check({ mode: ['petit', 'moyen'] }, s, adv), true);
  assert.equal(check({ not: { mode: 'grand' } }, s, adv), true);
  assert.equal(check({ mode: 'petit' }, heroIn(adv, null), adv), true, 'sans mode choisi : premier mode');
  assert.equal(describeCondition({ mode: ['petit', 'grand'] }, adv), 'jouer en mode Petit explorateur ou Grand explorateur');
  // Effet réservé à un mode.
  const fx = [{ op: 'gold', add: 3, if: { mode: 'grand' } }];
  assert.equal(applyEffects(heroIn(adv, 'grand'), adv, fx).state.gold, heroIn(adv, 'grand').gold + 3);
  assert.equal(applyEffects(s, adv, fx).state.gold, s.gold);
  // Choix conditionnel : raison lisible.
  adv.sections['3'].choices[0].if = { mode: 'grand' };
  const eff = applyMode(adv, 'petit');
  const r = start(heroIn(eff, 'petit'), eff, '3');
  assert.match(choicesFor(r.state, eff)[0].reason, /Grand explorateur/);
  // Mode inconnu signalé par la vérification.
  adv.sections['3'].choices[0].if = { mode: 'geant' };
  assert.ok(validate(adv).some(p => p.level === 'error' && /geant/.test(p.message)));
});

test('validateModes : chaque mode vérifié, problèmes préfixés par le mode', () => {
  const adv = mission();
  assert.equal(validateModes(adv).filter(p => p.level === 'error').length, 0);
  // Lien cassé seulement dans la variante du grand mode.
  adv.sections['4'].variants = { grand: { choices: [{ text: 'Plus loin', to: '99' }], ending: null } };
  const pb = validateModes(adv);
  const errs = pb.filter(p => p.level === 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].mode, 'grand');
  assert.equal(errs[0].section, '4');
  assert.match(errs[0].message, /^\[Grand explorateur\] .*99/);
  // Paragraphes inutiles dans un mode : résumés en une ligne, sans avertissement par paragraphe.
  assert.ok(pb.some(p => p.mode === 'grand' && p.level === 'info' && p.message === '[Grand explorateur] 1 paragraphe jamais atteint dans ce mode : 3.'));
  assert.ok(!pb.some(p => p.mode === 'grand' && p.section === '3'), 'pas de problème par paragraphe hors du mode');
  // Références à des modes inconnus, choix visible nulle part.
  adv.sections['3'].variants = { geant: { text: 'x' } };
  adv.sections['3'].choices[0].modes = ['geant'];
  const pb2 = validateModes(adv);
  assert.ok(pb2.some(p => /mode inconnu « geant »/.test(p.message) && p.section === '3'));
  assert.ok(pb2.some(p => /visible dans aucun mode/.test(p.message)));
  // Identifiants en double.
  adv.rules.modes.push({ id: 'petit', label: 'Doublon' });
  assert.ok(validateModes(adv).some(p => p.level === 'error' && /même identifiant/.test(p.message)));
});

test('modeSummary : paragraphes atteignables par mode', () => {
  const adv = mission();
  const p = modeSummary(adv, 'petit'), g = modeSummary(adv, 'grand');
  assert.deepEqual(p.reachable, ['1', '2', '3', '4']);
  assert.deepEqual(g.reachable, ['1', '2', '4']);
  assert.deepEqual(g.unused, ['3']);
  assert.deepEqual(g.deaths, ['2']);
  assert.deepEqual(p.deaths, []);
  assert.deepEqual(p.victories, ['4']);
});

test('vérification générale : les paragraphes propres à un mode ne sont pas « inaccessibles »', () => {
  const adv = mission();
  adv.sections['5'] = { text: 'Le sage (version petits)', choices: [{ text: 'Suite', to: '4' }], blocks: [], onEnter: [] };
  adv.sections['3'].variants = { petit: { choices: [{ text: 'Écouter encore', to: '5' }] } };
  assert.ok(reachable(adv).has('5'));
  assert.ok(!validate(adv).some(p => p.section === '5' && /Inaccessible/.test(p.message)));
  const t = targetsOf(adv.sections['3']).find(x => x.to === '5');
  assert.deepEqual(t.ref, ['variants', 'petit', 'choices', 0]);
  assert.equal(t.mode, 'petit');
  // Pas de doublon quand la variante garde la même destination que l'original.
  adv.sections['3'].variants.petit.choices.push({ text: 'Merci', to: '4' });
  assert.equal(targetsOf(adv.sections['3']).filter(x => x.to === '4').length, 1);
});

test('renumérotation et renommage : les renvois des variantes suivent', () => {
  const adv = mission();
  adv.sections['3'].variants = { petit: { choices: [{ text: 'Vers la fin', to: '4', if: { visited: '2' } }], blocks: [{ type: 'test', stat: 'chance', success: '4', failure: '2' }] } };
  const renamed = renameSection(adv, '4', '40');
  const v = renamed.sections['3'].variants.petit;
  assert.equal(v.choices[0].to, '40');
  assert.equal(v.blocks[0].success, '40');
  const { adventure, mapping } = renumber(adv, makeRng(3));
  const w = adventure.sections[mapping['3']].variants.petit;
  assert.equal(w.choices[0].to, mapping['4']);
  assert.equal(w.choices[0].if.visited, mapping['2']);
  assert.equal(w.blocks[0].failure, mapping['2']);
  assert.equal(adv.sections['3'].variants.petit.choices[0].to, '4', 'original intact');
});

test('export : images et sons des variantes inclus', () => {
  const adv = mission();
  adv.sections['2'].variants.petit.image = 'images/repli.webp';
  adv.sections['2'].variants.petit.sound = 'sons/foret.mp3';
  const paths = ext.assets.flatMap(f => f(adv));
  assert.ok(paths.includes('images/repli.webp'));
  assert.ok(paths.includes('sons/foret.mp3'));
});
