// Tests du greffon « carte » (moteur pur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/carte/core.js';
import {
  hotspotsFor, chooseHotspot, placesOf, visitedPlaces, knownPlaces, journey, currentPlace, worldMarkers,
  journeyPoints, rectOf, placePos, midSentence,
} from '../js/plugins/carte/core.js';
import { newAdventure, normalizeAdventure, createHero, start, enter, applyEffects, check, targetsOf, back, describeCondition } from '../js/core/rules.js';
import { validate, renumber, remap, reachable } from '../js/core/validate.js';
import { ext } from '../js/core/plugins.js';
import { makeRng } from '../js/core/dice.js';
import { condText, effectText } from '../js/ui/print.js';

function sample() {
  const a = newAdventure('Carte');
  a.items = { cle: { name: 'Clé de fer' } };
  a.meta.worldMap = { image: 'images/monde.webp', places: { Brumeval: { x: 20, y: 30 }, 'Tour noire': { x: 70, y: 20 }, Marais: { x: 50, y: 80 } }, revealUnvisited: false };
  a.sections = {
    '1': {
      text: 'Le carrefour.', place: 'Brumeval', choices: [], onEnter: [],
      blocks: [{
        type: 'map', image: 'images/carte.webp', alt: 'Une carte', label: 'Où aller ?',
        hotspots: [
          { x: 10, y: 10, w: 20, h: 20, label: 'Le marais', to: '2' },
          { x: 60, y: 10, w: 25, h: 30, label: 'La tour', to: '3', if: { has: 'cle' } },
          { x: 40, y: 60, w: 10, h: 10, label: 'Passage secret', to: '4', if: { flag: 'secret' }, hideIfUnavailable: true },
          { x: 70, y: 70, w: 10, h: 10, label: 'Le bac', to: '2', effects: [{ op: 'gold', add: -1 }] },
        ],
      }],
    },
    '2': { text: 'Le marais.', place: 'Marais', choices: [{ text: 'Revenir', to: '1' }], blocks: [], onEnter: [{ op: 'revealPlace', place: 'Tour noire' }] },
    '3': { text: 'La tour.', place: 'Tour noire', ending: 'victory', choices: [], blocks: [], onEnter: [] },
    '4': { text: 'Un tunnel.', place: '', choices: [{ text: 'Sortir', to: '1', if: { placeVisited: 'Marais' } }], blocks: [], onEnter: [] },
  };
  return normalizeAdventure(a);
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const H = { go: n => `rendez-vous au <b>${n}</b>`, esc, UP: (adv, id) => id.toUpperCase(), plural: (n, one, many) => `${n} ${n > 1 ? many : one}`, condText, effectText };

test('bloc carte : cibles pour le graphe et la vérification', () => {
  const adv = sample();
  const t = targetsOf(adv.sections['1']).filter(x => x.kind === 'map');
  assert.equal(t.length, 4);
  assert.deepEqual(t.map(x => x.to), ['2', '3', '4', '2']);
  assert.equal(t[1].label, 'La tour');
  assert.deepEqual(t[1].ref, ['hotspots', 1]);
  assert.equal(reachable(adv).size, 4);
});

test('bloc carte : renumérotation des destinations, conditions et effets', () => {
  const adv = sample();
  adv.sections['1'].blocks[0].hotspots[1].if = { all: [{ has: 'cle' }, { visited: '2' }] };
  const r = remap(adv, { '2': '20', '3': '30' });
  const hs = r.sections['1'].blocks[0].hotspots;
  assert.deepEqual(hs.map(h => h.to), ['20', '30', '4', '20']);
  assert.equal(hs[1].if.all[1].visited, '20');
  assert.deepEqual(hs[3].effects, [{ op: 'gold', add: -1 }]);
  assert.ok(!('if' in hs[0]), 'pas de condition ajoutée à une zone qui n’en avait pas');
  assert.deepEqual(adv.sections['1'].blocks[0].hotspots[0].to, '2', 'l’original n’est pas modifié');
  const { adventure, mapping } = renumber(adv, makeRng(3));
  const mb = adventure.sections[mapping['1']].blocks[0];
  assert.equal(mb.hotspots[1].to, mapping['3']);
  assert.equal(reachable(adventure).size, reachable(adv).size);
});

test('bloc carte : vérification (destination, image, dimensions, conditions)', () => {
  const adv = sample();
  assert.equal(validate(adv).filter(p => p.level === 'error').length, 0);
  const b = adv.sections['1'].blocks[0];
  b.hotspots.push({ x: 90, y: 90, w: 20, h: 5, label: 'Nulle part', to: '' });
  b.hotspots.push({ x: 0, y: 0, w: 5, h: 5, label: '', to: '2', if: { has: 'inconnu' } });
  delete b.image;
  const probs = validate(adv).filter(p => p.section === '1');
  const msg = level => probs.filter(p => p.level === level).map(p => p.message).join('\n');
  assert.match(msg('error'), /« Nulle part » n'a pas de destination/);
  assert.match(msg('warning'), /pas d'image/);
  assert.match(msg('warning'), /dépasse du bord/);
  assert.match(msg('warning'), /n'a pas d'étiquette/);
  assert.match(msg('warning'), /objet « inconnu »/);
  adv.sections['1'].blocks[0] = { type: 'map', image: 'x.webp', hotspots: [] };
  assert.ok(validate(adv).some(p => p.level === 'error' && /aucune zone/.test(p.message)));
  adv.sections['1'].blocks[0] = { type: 'map', image: 'x.webp', hotspots: [{ x: 0, y: 0, w: 0, h: 10, label: 'Vide', to: '2' }] };
  assert.ok(validate(adv).some(p => p.level === 'error' && /dimensions/.test(p.message)));
  adv.sections['1'].blocks[0].hotspots[0].to = '99';
  assert.ok(validate(adv).some(p => p.level === 'error' && /99/.test(p.message)));
});

test('bloc carte : version imprimable', () => {
  const adv = sample();
  const html = ext.blocks.get('map').print(adv.sections['1'].blocks[0], adv, H);
  assert.match(html, /<b>Où aller \?<\/b>/);
  assert.match(html, /lh-carte-img data-adv="[^"]+" data-path="images\/carte.webp"/);
  assert.match(html, /Pour aller vers le marais, rendez-vous au <b>2<\/b>\./);
  assert.match(html, /<i>Si vous possédez : Clé de fer<\/i> — pour aller vers la tour, rendez-vous au <b>3<\/b>\./);
  assert.match(html, /<i>Si vous avez noté le mot-clé « secret »<\/i> — pour aller vers Passage secret/);
  assert.match(html, /\(Retirez 1 Pièce d’Or de votre bourse\.\)/);
  assert.equal((html.match(/carte-pr-zone/g) || []).length, 4);
  assert.match(html, /left:60%;top:10%;width:25%;height:30%/);
  const noImg = ext.blocks.get('map').print({ type: 'map', hotspots: [{ x: 1, y: 1, w: 1, h: 1, label: '<b>', to: '2' }] }, adv, H);
  assert.doesNotMatch(noImg, /lh-carte-img/);
  assert.match(noImg, /vers &lt;b&gt;, /);
  assert.deepEqual(['Le marais', 'L’île', 'Brumeval', 'Les Landes', 'Lune'].map(midSentence), ['le marais', 'l’île', 'Brumeval', 'les Landes', 'Lune']);
});

test('bloc carte : zones disponibles, verrouillées avec raison, cachées', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 1 });
  ({ state } = start(state, adv));
  let hs = hotspotsFor(state, adv, adv.sections['1'].blocks[0]);
  assert.deepEqual(hs.map(h => h.index), [0, 1, 3], 'le passage secret est caché');
  assert.equal(hs[0].available, true);
  assert.equal(hs[1].available, false);
  assert.equal(hs[1].reason, `Il faut ${describeCondition({ has: 'cle' }, adv)}.`);
  assert.match(hs[1].reason, /Clé de fer/);
  state = { ...state, inventory: { cle: 1 }, flags: { secret: true } };
  hs = hotspotsFor(state, adv, adv.sections['1'].blocks[0]);
  assert.deepEqual(hs.map(h => [h.index, h.available]), [[0, true], [1, true], [2, true], [3, true]]);
  assert.equal(hotspotsFor(state, adv, { hotspots: [{ label: 'x' }] })[0].available, false);
  assert.deepEqual(hotspotsFor(state, adv, {}), []);
});

test('bloc carte : emprunter une zone (effets, refus si fermée)', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 1 });
  ({ state } = start(state, adv));
  const before = structuredClone(state);
  assert.throws(() => chooseHotspot(state, adv, 0, 1), /pas disponible/);
  assert.throws(() => chooseHotspot(state, adv, 0, 9), /inconnue/);
  state = { ...state, gold: 3 };
  const r = chooseHotspot(state, adv, 0, 3);
  assert.equal(r.state.section, '2');
  assert.equal(r.state.gold, 2);
  assert.deepEqual(before.inventory, state.inventory, 'état d’origine intact');
  assert.equal(chooseHotspot(state, adv, 0, 0).state.section, '2');
});

test('lieux : liste des lieux, lieux visités depuis state.visited, chemin, lieu actuel', () => {
  const adv = sample();
  assert.deepEqual(placesOf(adv), [{ name: 'Brumeval', sections: ['1'] }, { name: 'Marais', sections: ['2'] }, { name: 'Tour noire', sections: ['3'] }]);
  let { state } = createHero(adv, { seed: 1 });
  assert.deepEqual(visitedPlaces(state, adv), []);
  assert.equal(currentPlace(state, adv), null);
  ({ state } = start(state, adv));
  assert.deepEqual(visitedPlaces(state, adv), ['Brumeval']);
  ({ state } = enter(state, adv, '2'));
  ({ state } = enter(state, adv, '1'));
  ({ state } = enter(state, adv, '4'));
  assert.deepEqual(visitedPlaces(state, adv), ['Brumeval', 'Marais']);
  assert.deepEqual(visitedPlaces({ visited: { '3': 1, '99': 1 } }, adv), ['Tour noire'], 'calculé uniquement depuis state.visited');
  assert.deepEqual(journey(state, adv), ['Brumeval', 'Marais', 'Brumeval']);
  assert.deepEqual(currentPlace(state, adv), { name: 'Brumeval', exact: false }, 'paragraphe sans lieu : dernier lieu traversé');
  assert.deepEqual(journeyPoints(state, adv).map(p => p.name), ['Brumeval', 'Marais', 'Brumeval']);
  const undone = back(state); // retour au 1 : le 4 est annulé
  assert.deepEqual(currentPlace(undone, adv), { name: 'Brumeval', exact: true });
});

test('carte du monde : repères visités, lieu actuel, lieux révélés, « ? »', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 1 });
  assert.deepEqual(state.carte, { revealed: [] });
  ({ state } = start(state, adv));
  assert.deepEqual(worldMarkers(state, adv), [{ name: 'Brumeval', x: 20, y: 30, status: 'here' }]);
  const r = enter(state, adv, '2');
  state = r.state;
  assert.ok(r.messages.some(m => /Nouveau lieu sur votre carte du monde : Tour noire/.test(m.text)));
  assert.deepEqual(knownPlaces(state), ['Tour noire']);
  const byName = m => Object.fromEntries(m.map(x => [x.name, x.status]));
  assert.deepEqual(byName(worldMarkers(state, adv)), { Brumeval: 'visited', Marais: 'here', 'Tour noire': 'known' });
  const hidden = normalizeAdventure({ ...adv, meta: { ...adv.meta, worldMap: { ...adv.meta.worldMap, revealUnvisited: true } } });
  const { state: fresh } = start(createHero(hidden, { seed: 2 }).state, hidden);
  assert.deepEqual(byName(worldMarkers(fresh, hidden)), { Brumeval: 'here', Marais: 'unknown', 'Tour noire': 'unknown' });
  const { state: fresh2 } = start(createHero(adv, { seed: 2 }).state, adv);
  assert.deepEqual(byName(worldMarkers(fresh2, adv)), { Brumeval: 'here' }, 'lieux non visités masqués');
  ({ state } = enter(state, adv, '1'));
  ({ state } = enter(state, adv, '4'));
  const here = worldMarkers(state, adv).find(m => m.status === 'here');
  assert.deepEqual(here, { name: 'Brumeval', x: 20, y: 30, status: 'here', approx: true });
  assert.deepEqual(placePos(adv, '  Tour   noire '), { x: 70, y: 20 });
  assert.equal(placePos(adv, 'Nulle part'), null);
  const noMap = sample(); delete noMap.meta.worldMap;
  assert.deepEqual(worldMarkers(state, noMap), [], 'aventure sans carte du monde');
});

test('effet revealPlace et conditions de lieu', () => {
  const adv = sample();
  let { state } = createHero(adv, { seed: 1 });
  ({ state } = start(state, adv));
  assert.ok(!check({ placeKnown: 'Tour noire' }, state, adv));
  assert.ok(check({ placeKnown: 'Brumeval' }, state, adv), 'un lieu visité est connu');
  assert.ok(check({ placeVisited: 'Brumeval' }, state, adv));
  assert.ok(check({ placeNotVisited: 'Marais' }, state, adv));
  const r = applyEffects(state, adv, [{ op: 'revealPlace', place: ' Tour  noire ' }]);
  assert.ok(check({ placeKnown: 'Tour noire' }, r.state, adv));
  assert.ok(!check({ placeVisited: 'Tour noire' }, r.state, adv));
  assert.equal(applyEffects(r.state, adv, [{ op: 'revealPlace', place: 'Tour noire' }]).messages.length, 0, 'déjà connu : pas de message');
  assert.equal(state.carte.revealed.length, 0, 'état d’origine intact');
  const old = { ...state }; delete old.carte; // ancienne sauvegarde sans le champ du greffon
  assert.deepEqual(knownPlaces(applyEffects(old, adv, [{ op: 'revealPlace', place: 'Marais' }]).state), ['Marais']);
  assert.equal(describeCondition({ placeVisited: 'Marais' }, adv), 'être déjà allé à « Marais »');
  assert.equal(condText({ placeNotVisited: 'Marais' }, adv), 'vous n\'êtes jamais allé à « Marais »');
  assert.match(effectText({ op: 'revealPlace', place: 'Marais' }, adv), /^Notez sur votre Feuille d'Aventure le lieu « Marais »/);
  adv.sections['2'].onEnter.push({ op: 'revealPlace', place: '' }, { op: 'revealPlace', place: 'Atlantide' });
  adv.sections['4'].choices[0].if = { placeKnown: 'Eldorado' };
  const probs = validate(adv).map(p => p.message).join('\n');
  assert.match(probs, /lieu à révéler n'est pas précisé/);
  assert.match(probs, /aucun paragraphe n'a pour lieu « Atlantide »/);
  assert.match(probs, /aucun paragraphe n'a pour lieu « Eldorado »/);
});

test('rétrocompatibilité : aventure sans carte, normalisation, fichiers exportés', () => {
  const a = newAdventure('Sans carte');
  const adv = normalizeAdventure(a);
  assert.equal(adv.meta.worldMap, undefined);
  assert.deepEqual(placesOf(adv), []);
  const n = normalizeAdventure({ ...a, meta: { ...a.meta, worldMap: { image: 'm.webp' } } });
  assert.deepEqual(n.meta.worldMap, { image: 'm.webp', revealUnvisited: false, places: {} });
  const files = ext.assets.flatMap(f => f(sample()));
  assert.ok(files.includes('images/monde.webp'));
  assert.ok(files.includes('images/carte.webp'));
  assert.deepEqual(rectOf({ x: 90, y: -5, w: 30, h: 'x' }), { x: 90, y: 0, w: 10, h: 0 });
});
