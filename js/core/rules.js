// Moteur de jeu pur : aucun accès au DOM, aucune mutation des objets reçus.
// Chaque fonction prend un état et renvoie un nouvel état (+ des messages à afficher).

import { makeRng, roll } from './dice.js';
import { ext, findCondition } from './plugins.js';

export const FORMAT = 'livre-heros/1';

export const DEFAULT_RULES = {
  stats: [
    { id: 'habilete', label: 'Habileté', roll: '1d6+6' },
    { id: 'endurance', label: 'Endurance', roll: '2d6+12' },
    { id: 'chance', label: 'Chance', roll: '1d6+6' },
  ],
  classes: [
    { id: 'guerrier', label: 'Guerrier', description: 'Combat au corps à corps.', rolls: {}, items: [] },
  ],
  gold: '0',
  provisions: 2,
  meal: { stat: 'endurance', heal: 4 },
  combat: { skill: 'habilete', health: 'endurance', damage: 2, luck: 'chance', fleeDamage: 2 },
  startItems: [],
  allowBack: true,
  // Formules magiques façon Sorcellerie ! : un code de trois lettres, un coût, parfois un objet requis.
  spells: { enabled: false, stat: 'endurance', casters: [], typeCode: false, unknownCost: 0, book: [] },
  // Journées : chaque nuit, le héros doit avoir mangé la veille, sinon il perd des points.
  time: { enabled: false, mealRequired: true, stat: 'endurance', penalty: 3 },
};

export function newAdventure(title = 'Nouvelle aventure') {
  const id = slug(title) + '-' + Math.random().toString(36).slice(2, 6);
  return {
    format: FORMAT, id,
    meta: { title, author: '', description: '', cover: null, version: 1, updated: new Date().toISOString() },
    rules: structuredClone(DEFAULT_RULES),
    items: {},
    start: '1',
    sections: { '1': newSection('Votre aventure commence ici.') },
  };
}

export function newSection(text = '') {
  return { title: '', text, image: null, place: '', onEnter: [], blocks: [], choices: [], ending: null };
}

export function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'aventure';
}

/** Complète une aventure incomplète (fichier écrit à la main, ancienne version). */
export function normalizeAdventure(adv) {
  const a = structuredClone(adv);
  a.format ??= FORMAT;
  a.meta = { title: 'Sans titre', author: '', description: '', cover: null, ...(a.meta || {}) };
  a.rules = { ...structuredClone(DEFAULT_RULES), ...(a.rules || {}) };
  a.rules.combat = { ...DEFAULT_RULES.combat, ...(a.rules.combat || {}) };
  a.rules.meal = { ...DEFAULT_RULES.meal, ...(a.rules.meal || {}) };
  a.rules.spells = { ...DEFAULT_RULES.spells, ...(a.rules.spells || {}) };
  a.rules.time = { ...DEFAULT_RULES.time, ...(a.rules.time || {}) };
  a.meta.sound ??= null;
  a.items ??= {};
  a.sections ??= {};
  for (const id of Object.keys(a.sections)) a.sections[id] = { ...newSection(), ...a.sections[id] };
  a.start ??= Object.keys(a.sections)[0] || '1';
  for (const f of ext.normalize) f(a);
  return a;
}

export const statLabel = (adv, id) => adv.rules.stats.find(s => s.id === id)?.label || id;
export const itemName = (adv, id) => adv.items[id]?.name || id;

/* ------------------------------------------------------------------ */
/* Création du héros                                                    */
/* ------------------------------------------------------------------ */

/** Tire les caractéristiques. Renvoie { rolls: {stat: résultat de dés}, state }. */
export function createHero(adv, { name = 'Héros', classId, seed } = {}) {
  const rng = makeRng(seed);
  const cls = adv.rules.classes?.find(c => c.id === classId) || adv.rules.classes?.[0] || null;
  const rolls = {};
  const stats = {};
  for (const s of adv.rules.stats) {
    const expr = cls?.rolls?.[s.id] || s.roll;
    const r = roll(expr, rng);
    rolls[s.id] = r;
    stats[s.id] = { cur: r.total, init: r.total };
  }
  const gold = roll(cls?.gold || adv.rules.gold || '0', rng);
  const inventory = {};
  for (const it of [...(adv.rules.startItems || []), ...(cls?.items || [])]) inventory[it] = (inventory[it] || 0) + 1;
  const state = {
    v: 1,
    adventureId: adv.id,
    hero: { name, classId: cls?.id || null },
    stats,
    gold: gold.total,
    provisions: cls?.provisions ?? adv.rules.provisions ?? 0,
    inventory,
    flags: {},
    notes: '',
    section: null,
    visited: {},
    blocks: {},
    combat: null,
    history: [],
    log: [],
    ended: null,
    rng: rng.state(),
    turn: 0,
    day: 1,
    ate: false,
    started: new Date().toISOString(),
  };
  for (const f of ext.heroInit) f(state, adv, cls, rng);
  state.rng = rng.state();
  return { rolls: { ...rolls, gold }, state };
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

export function check(cond, state, adv) {
  if (!cond) return true;
  if (cond.all) return cond.all.every(c => check(c, state, adv));
  if (cond.any) return cond.any.some(c => check(c, state, adv));
  if (cond.not) return !check(cond.not, state, adv);
  const plug = findCondition(cond);
  if (plug) return plug.check(cond, state, adv);
  if (cond.has) return (state.inventory[cond.has] || 0) >= (cond.qty || 1);
  if (cond.flag) return cond.value === undefined ? !!state.flags[cond.flag] : state.flags[cond.flag] === cond.value;
  if (cond.visited) return !!state.visited[cond.visited];
  if (cond.class) return state.hero.classId === cond.class;
  if (cond.caster) return canCast(state, adv) === cond.caster;
  if (cond.ate !== undefined) return !!state.ate === !!cond.ate;
  if (cond.day !== undefined && cond.gte === undefined && cond.lte === undefined) return (state.day || 1) === Number(cond.day);
  const value = cond.stat ? state.stats[cond.stat]?.cur ?? 0 : cond.gold !== undefined ? state.gold : cond.provisions !== undefined ? state.provisions : cond.day !== undefined ? state.day || 1 : null;
  if (value !== null) {
    if (cond.gte !== undefined && !(value >= cond.gte)) return false;
    if (cond.lte !== undefined && !(value <= cond.lte)) return false;
    if (cond.eq !== undefined && !(value === cond.eq)) return false;
    return true;
  }
  return true;
}

/** Phrase lisible pour une condition (« il faut la Clé d'argent »). */
export function describeCondition(cond, adv) {
  if (!cond) return '';
  if (cond.all) return cond.all.map(c => describeCondition(c, adv)).join(' et ');
  if (cond.any) return cond.any.map(c => describeCondition(c, adv)).join(' ou ');
  if (cond.not) {
    const c = cond.not;
    if (c.has) return `ne pas avoir : ${itemName(adv, c.has)}`;
    if (c.flag) return `ne pas être « ${c.flag} »`;
    if (c.visited) return `ne pas être passé par le ${c.visited}`;
    const plugNot = findCondition(cond); if (plugNot) return plugNot.describe(cond, adv); // greffon qui sait dire sa négation
    return `pas : ${describeCondition(c, adv)}`;
  }
  const plug = findCondition(cond);
  if (plug) return plug.describe(cond, adv);
  if (cond.has) return `avoir : ${itemName(adv, cond.has)}${cond.qty > 1 ? ` ×${cond.qty}` : ''}`;
  if (cond.flag) return `être « ${cond.flag} »`;
  if (cond.visited) return `être passé par le ${cond.visited}`;
  if (cond.class) return `être ${adv.rules.classes?.find(c => c.id === cond.class)?.label || cond.class}`;
  if (cond.caster) return 'savoir lancer des formules';
  if (cond.ate !== undefined) return cond.ate ? 'avoir mangé aujourd’hui' : 'ne pas avoir mangé aujourd’hui';
  if (cond.day !== undefined && cond.gte === undefined && cond.lte === undefined) return `être au jour ${cond.day}`;
  const what = cond.stat ? statLabel(adv, cond.stat) : cond.gold !== undefined ? 'pièces d’or' : cond.day !== undefined ? 'jour' : 'repas';
  if (cond.gte !== undefined) return `${what} ≥ ${cond.gte}`;
  if (cond.lte !== undefined) return `${what} ≤ ${cond.lte}`;
  if (cond.eq !== undefined) return `${what} = ${cond.eq}`;
  return '';
}

/* ------------------------------------------------------------------ */
/* Effets                                                              */
/* ------------------------------------------------------------------ */

/** Applique une liste d'effets. Renvoie { state, messages }. */
export function applyEffects(state, adv, effects = []) {
  let s = structuredClone(state);
  const messages = [];
  for (const e of effects || []) {
    if (e.if && !check(e.if, s, adv)) continue;
    switch (e.op) {
      case 'stat': {
        const st = s.stats[e.stat];
        if (!st) break;
        const before = st.cur;
        if (e.set === 'initial') st.cur = st.init;
        else if (e.set !== undefined) st.cur = Number(e.set);
        if (e.addInitial) { st.init += Number(e.addInitial); if (Number(e.addInitial) > 0) st.cur += Number(e.addInitial); }
        if (e.add !== undefined) st.cur += Number(e.add);
        if (!e.overInitial && st.cur > st.init) st.cur = st.init;
        if (st.cur < 0) st.cur = 0;
        const d = st.cur - before;
        if (d || e.addInitial) messages.push({ kind: d < 0 ? 'loss' : 'gain', text: `${d > 0 ? '+' : ''}${d} ${statLabel(adv, e.stat)}${e.addInitial ? ` (total initial ${e.addInitial > 0 ? '+' : ''}${e.addInitial})` : ''}` });
        break;
      }
      case 'gold': {
        const before = s.gold;
        s.gold = Math.max(0, s.gold + Number(e.add || 0));
        if (e.set !== undefined) s.gold = Number(e.set);
        const d = s.gold - before;
        if (d) messages.push({ kind: d < 0 ? 'loss' : 'gain', text: `${d > 0 ? '+' : ''}${d} pièce${Math.abs(d) > 1 ? 's' : ''} d’or` });
        break;
      }
      case 'provisions': {
        const before = s.provisions;
        s.provisions = Math.max(0, s.provisions + Number(e.add || 0));
        const d = s.provisions - before;
        if (d) messages.push({ kind: d < 0 ? 'loss' : 'gain', text: `${d > 0 ? '+' : ''}${d} repas` });
        break;
      }
      case 'give': {
        const q = Number(e.qty || 1);
        s.inventory[e.item] = (s.inventory[e.item] || 0) + q;
        messages.push({ kind: 'gain', text: `Objet obtenu : ${itemName(adv, e.item)}${q > 1 ? ` ×${q}` : ''}` });
        break;
      }
      case 'take': {
        const had = s.inventory[e.item] || 0;
        if (!had) break;
        const q = e.all ? had : Math.min(had, Number(e.qty || 1));
        s.inventory[e.item] = had - q;
        if (!s.inventory[e.item]) delete s.inventory[e.item];
        messages.push({ kind: 'loss', text: `Objet perdu : ${itemName(adv, e.item)}${q > 1 ? ` ×${q}` : ''}` });
        break;
      }
      case 'flag':
        s.flags[e.flag] = e.value === undefined ? true : e.value;
        break;
      case 'newDay': {
        const t = adv.rules.time || {};
        if (t.enabled !== false && t.mealRequired !== false && !s.ate) {
          const st = s.stats[t.stat || 'endurance'];
          if (st) {
            const before = st.cur;
            st.cur = Math.max(0, st.cur - Number(t.penalty ?? 3));
            messages.push({ kind: 'loss', text: `Vous n'avez rien mangé hier : ${st.cur - before} ${statLabel(adv, t.stat || 'endurance')}` });
          }
        }
        s.day = (s.day || 1) + 1;
        s.ate = false;
        messages.push({ kind: 'info', text: `Jour ${s.day} : un nouveau jour se lève.` });
        break;
      }
      case 'meal': {
        const m = adv.rules.meal || {};
        const st = s.stats[m.stat];
        s.ate = true;
        if (st) {
          const before = st.cur;
          st.cur = Math.min(st.init, st.cur + Number(e.heal ?? m.heal ?? 4));
          messages.push({ kind: 'gain', text: `Vous prenez un repas${st.cur > before ? ` : +${st.cur - before} ${statLabel(adv, m.stat)}` : '.'}` });
        } else messages.push({ kind: 'info', text: 'Vous prenez un repas.' });
        break;
      }
      case 'note':
        s.notes = (s.notes ? s.notes + '\n' : '') + e.text;
        messages.push({ kind: 'info', text: `Noté sur votre feuille : ${e.text}` });
        break;
      default: {
        const plug = ext.effects.get(e.op);
        if (plug) plug.apply(s, e, adv, messages);
        break;
      }
    }
  }
  s = checkDeath(s, adv);
  return { state: s, messages };
}

export function checkDeath(state, adv) {
  const hp = adv.rules.combat?.health;
  if (hp && state.stats[hp] && state.stats[hp].cur <= 0 && !state.ended) {
    return { ...state, ended: 'death', endReason: `Votre ${statLabel(adv, hp)} est tombée à zéro.` };
  }
  return state;
}

/** Texte court d'un effet, pour l'éditeur et les infobulles. */
export function describeEffect(e, adv) {
  switch (e.op) {
    case 'stat':
      if (e.set === 'initial') return `${statLabel(adv, e.stat)} revient à son total initial`;
      if (e.set !== undefined) return `${statLabel(adv, e.stat)} = ${e.set}`;
      if (e.addInitial) return `total initial de ${statLabel(adv, e.stat)} ${e.addInitial > 0 ? '+' : ''}${e.addInitial}`;
      return `${e.add > 0 ? '+' : ''}${e.add} ${statLabel(adv, e.stat)}`;
    case 'gold': return `${e.add > 0 ? '+' : ''}${e.add} pièces d’or`;
    case 'provisions': return `${e.add > 0 ? '+' : ''}${e.add} repas`;
    case 'give': return `reçoit ${itemName(adv, e.item)}${e.qty > 1 ? ` ×${e.qty}` : ''}`;
    case 'take': return `perd ${itemName(adv, e.item)}`;
    case 'flag': return `marque « ${e.flag} »${e.value === false ? ' = non' : ''}`;
    case 'note': return `note : ${e.text}`;
    case 'newDay': return 'un nouveau jour commence (repas obligatoire la veille)';
    case 'meal': return `repas offert${e.heal ? ` (+${e.heal})` : ''}`;
    default: return ext.effects.get(e.op)?.describe(e, adv) ?? e.op;
  }
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const snapshot = s => { const { history, log, ...rest } = s; return structuredClone(rest); };

/** Entre dans un paragraphe : historique, effets d'entrée, fin éventuelle. */
export function enter(state, adv, sectionId, { viaEffects = [] } = {}) {
  const sec = adv.sections[sectionId];
  if (!sec) throw new Error(`Le paragraphe ${sectionId} n'existe pas.`);
  let s = structuredClone(state);
  if (s.section) {
    s.history = [...s.history, snapshot(state)].slice(-40);
  }
  let messages = [];
  if (viaEffects.length) {
    const r = applyEffects(s, adv, viaEffects);
    s = r.state; messages = messages.concat(r.messages);
  }
  s.section = String(sectionId);
  s.visited = { ...s.visited, [sectionId]: (s.visited[sectionId] || 0) + 1 };
  s.blocks = {};
  s.combat = null;
  s.turn += 1;
  if (!s.ended) {
    const r = applyEffects(s, adv, sec.onEnter);
    s = r.state; messages = messages.concat(r.messages);
    for (const f of ext.onEnter) f(s, adv, s.section, messages);
    s = checkDeath(s, adv);
  }
  if (sec.ending && !s.ended) {
    s.ended = sec.ending;
    s.endReason = sec.ending === 'victory' ? 'Vous avez réussi votre quête.' : 'Votre aventure s’achève ici.';
  }
  s.log = [...s.log, { turn: s.turn, section: s.section, messages: messages.map(m => m.text) }].slice(-200);
  return { state: s, messages };
}

export function start(state, adv, from = adv.start) {
  return enter({ ...state, section: null }, adv, from);
}

/** Choix du paragraphe courant avec leur disponibilité. */
export function choicesFor(state, adv) {
  const sec = adv.sections[state.section];
  if (!sec) return [];
  const guard = choiceGuard(state, adv);
  return (sec.choices || []).map((c, i) => {
    const ok = check(c.if, state, adv);
    const hidden = !ok && !!c.hideIfUnavailable;
    if (guard) return { ...c, index: i, available: false, hidden, reason: guard };
    return { ...c, index: i, available: ok, hidden, reason: ok ? '' : `Il faut ${describeCondition(c.if, adv)}.` };
  }).filter(c => !c.hidden);
}

/** Raison qui bloque tous les choix (fournie par un greffon), ou null. */
export function choiceGuard(state, adv) {
  for (const g of ext.choiceGuards) { const r = g(state, adv); if (r) return r; }
  return null;
}

export function choose(state, adv, index) {
  const c = adv.sections[state.section]?.choices?.[index];
  if (!c) throw new Error('Choix inconnu');
  if (!check(c.if, state, adv) || choiceGuard(state, adv)) throw new Error('Ce choix n’est pas disponible.');
  return enter(state, adv, c.to, { viaEffects: c.effects || [] });
}

export function back(state) {
  if (!state.history.length) return state;
  const prev = state.history[state.history.length - 1];
  return { ...structuredClone(prev), history: state.history.slice(0, -1), log: state.log, rng: state.rng };
}

/* ------------------------------------------------------------------ */
/* Blocs interactifs : tests et tables de dés                          */
/* ------------------------------------------------------------------ */

function withRng(state, fn) {
  const rng = makeRng(state.rng);
  const out = fn(rng);
  return { ...out, state: { ...out.state, rng: rng.state() } };
}

/** Tester sa Chance / son Habileté : 2d6 ≤ caractéristique. */
export function resolveTest(state, adv, blockIndex) {
  const block = adv.sections[state.section].blocks[blockIndex];
  return withRng(state, rng => {
    const s = structuredClone(state);
    const st = s.stats[block.stat];
    const r = roll(block.dice || '2d6', rng);
    const target = st.cur + Number(block.mod || 0);
    const success = r.total <= target;
    const cost = block.cost ?? (block.stat === adv.rules.combat.luck ? 1 : 0);
    if (cost) st.cur = Math.max(0, st.cur - cost);
    const result = { roll: r, target, success, cost };
    s.blocks[blockIndex] = result;
    return { state: s, result };
  });
}

/** Table de dés : « 1-2 → 245 ». */
export function resolveRoll(state, adv, blockIndex) {
  const block = adv.sections[state.section].blocks[blockIndex];
  return withRng(state, rng => {
    const s = structuredClone(state);
    const r = roll(block.dice || '1d6', rng);
    const total = r.total + (block.addStat ? s.stats[block.addStat]?.cur || 0 : 0);
    const row = (block.table || []).find(t => total >= Number(t.min) && total <= Number(t.max)) || null;
    const result = { roll: r, total, row };
    s.blocks[blockIndex] = result;
    return { state: s, result };
  });
}

/** Test de Chance libre (bouton de la feuille d'aventure ou combat). */
export function testLuck(state, adv) {
  return withRng(state, rng => {
    const s = structuredClone(state);
    const luck = s.stats[adv.rules.combat.luck];
    const r = roll('2d6', rng);
    const success = r.total <= luck.cur;
    luck.cur = Math.max(0, luck.cur - 1);
    return { state: s, result: { roll: r, target: luck.cur + 1, success } };
  });
}

/** Lancer libre, sans effet sur l'état sauf la graine. */
export function freeRoll(state, expr) {
  return withRng(state, rng => ({ state: structuredClone(state), result: roll(expr, rng) }));
}

/* ------------------------------------------------------------------ */
/* Feuille d'aventure : repas, objets, boutique                        */
/* ------------------------------------------------------------------ */

export function eat(state, adv) {
  if (state.provisions <= 0) return { state, messages: [{ kind: 'info', text: 'Vous n’avez plus de repas.' }] };
  const r = applyEffects({ ...state, provisions: state.provisions - 1 }, adv, [{ op: 'meal' }]);
  return { state: r.state, messages: r.messages };
}

/* ------------------------------------------------------------------ */
/* Formules magiques                                                   */
/* ------------------------------------------------------------------ */

export const spellOf = (adv, code) => (adv.rules.spells?.book || []).find(x => x.code.toUpperCase() === String(code).toUpperCase()) || null;

/** Le héros peut-il lancer des formules ? (classe autorisée, et système activé) */
export function canCast(state, adv) {
  const sp = adv.rules.spells;
  if (!sp?.enabled) return false;
  return !sp.casters?.length || sp.casters.includes(state.hero.classId);
}

/**
 * Lance une formule depuis un bloc « formules » du paragraphe courant.
 * Si le code fait partie des choix du bloc : coût payé puis passage au paragraphe prévu.
 * Sinon (code tapé au clavier et absent) : rien ne se passe, mais le coût « inconnu » est payé.
 */
export function castSpell(state, adv, blockIndex, rawCode) {
  const block = adv.sections[state.section].blocks[blockIndex];
  const code = String(rawCode).trim().toUpperCase();
  if (!canCast(state, adv)) return { state, messages: [{ kind: 'info', text: 'Vous ne connaissez pas la magie.' }] };
  const opt = (block.options || []).find(o => String(o.code).toUpperCase() === code);
  const spell = spellOf(adv, code);
  const stat = adv.rules.spells.stat || 'endurance';
  const cost = opt?.cost ?? (block.costInText ? 0 : spell ? Number(spell.cost || 0) : Number(adv.rules.spells.unknownCost || 0));
  const costEffect = cost ? [{ op: 'stat', stat, add: -cost }] : [];
  if (!opt) {
    const r = applyEffects(state, adv, costEffect);
    const tried = [...((state.blocks[blockIndex] || {}).tried || []), code];
    return { state: { ...r.state, blocks: { ...r.state.blocks, [blockIndex]: { tried } } }, messages: [{ kind: 'info', text: `Vous prononcez « ${code} »… rien ne se passe.` }, ...r.messages] };
  }
  const r = enter(state, adv, opt.to, { viaEffects: costEffect });
  return { state: r.state, messages: [{ kind: 'info', text: `Vous lancez la formule ${code}${spell ? ` (${spell.name})` : ''}.` }, ...r.messages] };
}

export function useItem(state, adv, itemId) {
  const it = adv.items[itemId];
  if (!it?.use?.length || !state.inventory[itemId]) return { state, messages: [] };
  let r = applyEffects(state, adv, it.use);
  if (it.consumable !== false) r = { ...r, state: applyEffects(r.state, adv, [{ op: 'take', item: itemId }]).state };
  return { state: r.state, messages: [{ kind: 'info', text: `Vous utilisez : ${it.name}.` }, ...r.messages] };
}

export function buy(state, adv, blockIndex, offerIndex) {
  const offer = adv.sections[state.section].blocks[blockIndex].offers[offerIndex];
  if (state.gold < offer.price) return { state, messages: [{ kind: 'info', text: 'Vous n’avez pas assez d’or.' }] };
  const bought = { ...(state.blocks[blockIndex] || {}), [offerIndex]: ((state.blocks[blockIndex] || {})[offerIndex] || 0) + 1 };
  if (offer.stock && bought[offerIndex] > offer.stock) return { state, messages: [{ kind: 'info', text: 'Il n’y en a plus.' }] };
  const r = applyEffects(state, adv, [{ op: 'gold', add: -offer.price }, { op: 'give', item: offer.item }, ...(offer.effects || [])]);
  r.state.blocks = { ...r.state.blocks, [blockIndex]: bought };
  return r;
}

/* ------------------------------------------------------------------ */
/* Cibles d'un paragraphe (pour le graphe et la validation)            */
/* ------------------------------------------------------------------ */

export function targetsOf(sec) {
  const out = [];
  (sec.choices || []).forEach((c, i) => c.to && out.push({ to: String(c.to), kind: 'choice', label: c.text, ref: ['choices', i] }));
  (sec.blocks || []).forEach((b, i) => {
    if (b.type === 'test') {
      b.success && out.push({ to: String(b.success), kind: 'test', label: 'réussite', ref: ['blocks', i, 'success'] });
      b.failure && out.push({ to: String(b.failure), kind: 'test', label: 'échec', ref: ['blocks', i, 'failure'] });
    }
    if (b.type === 'roll') (b.table || []).forEach((t, j) => t.to && out.push({ to: String(t.to), kind: 'roll', label: `${t.min}-${t.max}`, ref: ['blocks', i, 'table', j] }));
    if (b.type === 'spells') (b.options || []).forEach((o, j) => o.to && out.push({ to: String(o.to), kind: 'spell', label: String(o.code || '').toUpperCase(), ref: ['blocks', i, 'options', j] }));
    if (b.type === 'combat') {
      b.win && out.push({ to: String(b.win), kind: 'combat', label: 'victoire', ref: ['blocks', i, 'win'] });
      b.flee && out.push({ to: String(b.flee), kind: 'combat', label: 'fuite', ref: ['blocks', i, 'flee'] });
      b.lose && out.push({ to: String(b.lose), kind: 'combat', label: 'défaite', ref: ['blocks', i, 'lose'] });
    }
    const plug = ext.blocks.get(b.type);
    if (plug?.targets) plug.targets(b, i).forEach(t => t?.to && out.push({ ...t, to: String(t.to) }));
  });
  return out;
}
