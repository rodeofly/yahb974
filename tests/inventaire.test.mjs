// Tests du greffon « inventaire » (sac, indices, feuille tenue par le livre, mode triche), du passeport de triche
// (greffon campagne) et des lieux connus dès le départ (greffon carte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/plugins/compteurs/core.js';
import '../js/plugins/compagnons/core.js';
import * as I from '../js/plugins/inventaire/core.js';
import * as P from '../js/plugins/campagne/core.js';
import * as Ca from '../js/plugins/carte/core.js';
import { newAdventure, normalizeAdventure, createHero, start, applyEffects } from '../js/core/rules.js';

const pieces = ['piece-01', 'piece-02', 'piece-03'];

function sample(extra = {}) {
  const a = newAdventure('Le sac');
  a.items = {
    lanterne: { name: 'Lanterne', icon: '🏮', hint: 'Dans le noir.', hints: { petit: 'Elle éclaire les grottes.' } },
    corde: { name: 'Corde', icon: '🪢' },
    galet: { name: 'Galet', icon: '🪨', category: 'cles' },
    'piece-01': { name: 'Pièce 1', tag: 'L' }, 'piece-02': { name: 'Pièce 2', tag: 'E' }, 'piece-03': { name: 'Pièce 3', tag: 'É' },
  };
  a.rules.inventory = {
    categories: [{ id: 'objets', label: 'Objets', icon: '🎒' }, { id: 'cles', label: 'Clés', icon: '🗝️' }],
    collections: [{ id: 'pieces', label: 'Pièces', icon: '🪙', items: pieces, message: "L'É É" }],
  };
  a.rules.counters = [{ id: 'memoire', label: 'Mémoire', start: 0, min: 0, visible: true, triggers: [] }];
  a.companions = { kaya: { name: 'Kaya', skill: 7, health: 7 } };
  a.rules.campaign = { id: 'serie', book: 2, cheatFlag: 'triche', fields: { stats: ['habilete'], counters: ['memoire'], items: [...pieces, 'galet'], flags: ['ami', 'triche'], companions: ['kaya'] } };
  Object.assign(a.rules, extra);
  return normalizeAdventure(a);
}
const hero = adv => start(createHero(adv, { seed: 2 }).state, adv).state;

test('le sac range les objets par onglet ; une collection montre toutes ses cases et dévoile son message', () => {
  const adv = sample();
  let s = hero(adv);
  s = applyEffects(s, adv, [{ op: 'give', item: 'lanterne' }, { op: 'give', item: 'galet' }, { op: 'give', item: 'piece-02' }, { op: 'give', item: 'corde', qty: 2 }]).state;
  const tabs = I.inventoryView(adv, s);
  assert.deepEqual(tabs.map(t => t.id), ['objets', 'cles', 'pieces']);
  assert.deepEqual(tabs[0].slots.map(x => [x.id, x.qty]), [['lanterne', 1], ['corde', 2]]);
  assert.deepEqual(tabs[1].slots.map(x => x.id), ['galet']);
  const col = tabs[2];
  assert.equal(col.found, 1); assert.equal(col.total, 3);
  assert.deepEqual(col.slots.map(x => x.owned), [false, true, false]);
  // Message « L'É É » : lettres 1 et 3 cachées, la 2e montrée ; l'apostrophe et l'espace restent.
  assert.deepEqual(col.message.map(m => (m.shown ? m.char : '_')).join(''), "_'É _");
  assert.equal(I.messageLetters("L'É É"), 3);
});

test('un objet sans catégorie va dans le premier onglet ; sans réglage, un seul onglet « Objets »', () => {
  const adv = normalizeAdventure({ ...newAdventure('Simple'), items: { a: { name: 'A' } } });
  const s = applyEffects(hero(adv), adv, [{ op: 'give', item: 'a' }]).state;
  const tabs = I.inventoryView(adv, s);
  assert.equal(tabs.length, 1); assert.equal(tabs[0].label, 'Objets');
  assert.deepEqual(tabs[0].slots.map(x => x.id), ['a']);
});

test('indice selon le mode, sinon l\'indice général', () => {
  const adv = sample();
  assert.equal(I.hintFor(adv.items.lanterne, 'petit'), 'Elle éclaire les grottes.');
  assert.equal(I.hintFor(adv.items.lanterne, 'gardien'), 'Dans le noir.');
  assert.equal(I.hintFor(adv.items.corde, 'petit'), '');
});

test('objets nouveaux : marqués jusqu\'à ce qu\'on ouvre le sac', () => {
  const adv = sample();
  let s = applyEffects(hero(adv), adv, [{ op: 'give', item: 'lanterne' }]).state;
  assert.deepEqual(I.newItems(s), ['lanterne']);
  s = I.markSeen(s);
  assert.deepEqual(I.newItems(s), []);
  s = applyEffects(s, adv, [{ op: 'give', item: 'corde' }]).state;
  assert.deepEqual(I.newItems(s), ['corde']);
});

test('feuille tenue par le livre : pas d\'ajout ni de retrait, sauf en mode triche', () => {
  const libre = sample();
  assert.equal(I.canEditItems(libre, hero(libre)), true);
  const adv = sample({ sheet: { locked: true, cheat: true, unlock: { gold: 50, counters: { memoire: 40 } } } });
  let s = hero(adv);
  assert.equal(I.canEditItems(adv, s), false);
  assert.equal(I.unlockAll(s, adv).state, s, 'sans triche, rien ne se débloque');
  s = I.startCheat(s).state;
  assert.ok(s.cheat); assert.equal(I.canEditItems(adv, s), true);
});

test('tout débloquer : objets, drapeaux et compagnons de la campagne, or et compteurs prévus', () => {
  const adv = sample({ sheet: { locked: true, cheat: true, unlock: { gold: 50, counters: { memoire: 40 } } } });
  let s = I.startCheat(hero(adv)).state;
  const gold = s.gold;
  const r = I.unlockAll(s, adv);
  s = r.state;
  for (const id of Object.keys(adv.items)) assert.equal(s.inventory[id], 1, id);
  assert.equal(s.flags.ami, true);
  assert.ok(s.companions.some(c => c.id === 'kaya'));
  assert.equal(s.gold, gold + 50);
  assert.equal(s.counters.memoire, 40);
  assert.equal(s.cheat.unlocked, true);
  assert.match(r.messages[0].text, /tout est débloqué/);
});

test('passeport de triche : marqué au départ, et le livre suivant repart en mode triche', () => {
  const adv = sample({ sheet: { locked: true, cheat: true } });
  const camp = P.campaignOf(adv);
  assert.equal(P.cheatFlagOf(camp), 'triche');
  let s = hero(adv);
  assert.equal(P.passportOf(s, adv).flags.includes('triche'), false);
  s = I.startCheat(s).state;
  const pass = P.passportOf(s, adv);
  assert.ok(pass.flags.includes('triche'));
  const code = P.encodePassport(camp, pass);
  const lu = P.decodePassport({ ...camp, book: 3 }, code);
  assert.ok(lu.ok);
  assert.ok(P.isCheatPassport(lu.pass, camp));
  assert.match(P.describe(lu.pass, adv), /mode triche/);
  const suivant = createHero(adv, { seed: 5 }).state;
  P.applyPassport(suivant, adv, lu.pass, code);
  assert.ok(suivant.cheat, 'la triche suit le passeport');
  // Sans drapeau de triche déclaré, rien ne change.
  const sans = { ...camp, cheatFlag: undefined };
  assert.equal(P.cheatFlagOf(sans), null);
});

test('vérification du sac : message de la bonne longueur, catégories connues', () => {
  const adv = sample();
  assert.deepEqual(I.inventoryProblems(adv), []);
  adv.rules.inventory.collections[0].message = 'TROP LONG';
  adv.items.corde.category = 'inconnue';
  const p = I.inventoryProblems(adv);
  assert.ok(p.some(x => x.level === 'error' && /lettres/.test(x.message)));
  assert.ok(p.some(x => x.level === 'warning' && /inconnue/.test(x.message)));
});

test('carte du monde : des lieux connus dès le départ', () => {
  const a = newAdventure('Carte');
  a.meta.worldMap = { image: 'images/carte.webp', places: { Brumeval: { x: 40, y: 40 }, Marais: { x: 60, y: 30 } }, known: ['Brumeval'] };
  a.sections['1'].place = 'Marais';
  const adv = normalizeAdventure(a);
  const s = hero(adv);
  assert.deepEqual(Ca.knownAtStart(adv), ['Brumeval']);
  const m = Object.fromEntries(Ca.worldMarkers(s, adv).map(x => [x.name, x.status]));
  assert.equal(m.Brumeval, 'known');
  assert.equal(m.Marais, 'here');
});
