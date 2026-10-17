// Analyse de la structure d'une aventure, pour le graphe de l'éditeur :
// fil principal (sans les effets de sorts), profondeur, chemin le plus court vers une victoire,
// passages obligés, journées, lieux.

import { targetsOf } from './rules.js';

const byNum = (a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b), 'fr');
const placeName = p => String(p ?? '').replace(/\s+/g, ' ').trim();

/**
 * Le compteur qui compte les journées (« Jours de voyage ») : celui marqué `days: true`, sinon un compteur dont
 * l'identifiant est « jour(s) » ou dont le nom commence par « Jour ». null s'il n'y en a pas.
 */
export function dayCounter(adv) {
  const list = Array.isArray(adv?.rules?.counters) ? adv.rules.counters : [];
  return list.find(c => c?.days === true)
    || list.find(c => /^jours?$/i.test(String(c?.id || '')) || /^jours?\b/i.test(String(c?.label || ''))) || null;
}

/** Jours qui passent avec ces effets : « nouveau jour », ou le compteur des journées qui augmente. */
function dayStep(effects, counterId) {
  let n = 0;
  for (const e of effects || []) {
    if (e?.op === 'newDay') n += 1;
    else if (counterId && e?.op === 'counter' && e.counter === counterId && Number(e.add) > 0) n += Number(e.add);
  }
  return n;
}

/**
 * Lieu de chaque paragraphe : le sien, sinon celui du paragraphe le plus proche qui y mène (paragraphes ajoutés sans
 * lieu, comme ceux d'une campagne). Map id → { name, inherited }. Les paragraphes qu'aucun paragraphe situé n'atteint
 * restent absents.
 */
export function inheritedPlaces(adv, out = null) {
  const links = out || new Map(Object.keys(adv?.sections || {}).map(id => [id, targetsOf(adv.sections[id]).filter(t => adv.sections[t.to])]));
  const place = new Map();
  const queue = [];
  for (const id of Object.keys(adv?.sections || {}).sort(byNum)) {
    const p = placeName(adv.sections[id]?.place);
    if (p) { place.set(id, { name: p, inherited: false }); queue.push(id); }
  }
  // Parcours en largeur depuis tous les paragraphes situés à la fois : chacun hérite du lieu le plus proche.
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const t of links.get(from) || []) {
      if (place.has(t.to) || !adv.sections[t.to]) continue;
      place.set(t.to, { name: place.get(from).name, inherited: true });
      queue.push(t.to);
    }
  }
  return place;
}

export function analyze(adv) {
  const ids = Object.keys(adv.sections);
  const out = new Map(ids.map(id => [id, targetsOf(adv.sections[id]).filter(t => adv.sections[t.to])]));
  const start = String(adv.start);
  const victories = ids.filter(id => adv.sections[id].ending === 'victory');

  const bfs = (from, allow, block) => {
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const x = q.shift();
      for (const t of out.get(x) || []) {
        if (!allow(t) || t.to === block || prev.has(t.to)) continue;
        prev.set(t.to, x); q.push(t.to);
      }
    }
    return prev;
  };
  const noSpell = t => t.kind !== 'spell';

  // Fil principal : ce qu'on atteint sans passer par une formule.
  const main = new Set(bfs(start, noSpell).keys());
  // Profondeur (distance au départ) : sert à étaler le graphe de gauche à droite.
  const depth = new Map();
  { const q = [start]; depth.set(start, 0);
    while (q.length) { const x = q.shift(); for (const t of out.get(x) || []) if (!depth.has(t.to)) { depth.set(t.to, depth.get(x) + (t.kind === 'spell' ? 0.5 : 1)); q.push(t.to); } } }

  // Chemin le plus court vers une victoire (sans magie si possible).
  let path = [];
  for (const allow of [noSpell, () => true]) {
    const prev = bfs(start, allow);
    const goal = victories.filter(v => prev.has(v)).sort((a, b) => pathLen(prev, a) - pathLen(prev, b))[0];
    if (goal) { for (let x = goal; x !== null; x = prev.get(x)) path.unshift(x); break; }
  }

  // Passages obligés : sans eux, aucune victoire n'est atteignable (sans magie).
  const dominators = new Set();
  const reachV = prev => victories.some(v => prev.has(v));
  if (victories.length && reachV(bfs(start, noSpell))) {
    for (const id of main) {
      if (id === start || victories.includes(id)) continue;
      if (!reachV(bfs(start, noSpell, id))) dominators.add(id);
    }
  }

  // Journées : le jour passe avec l'effet « nouveau jour », ou quand le compteur des journées augmente (effets
  // d'entrée du paragraphe, ou effets du choix emprunté). Chaque paragraphe reçoit le jour le plus tôt possible.
  const dc = dayCounter(adv);
  const cid = dc?.id || null;
  const day = new Map([[start, Number.isFinite(Number(dc?.start)) && dc ? Number(dc.start) : 1]]);
  { const todo = [start];
    while (todo.length) {
      let k = 0;
      for (let i = 1; i < todo.length; i++) if (day.get(todo[i]) < day.get(todo[k])) k = i;
      const x = todo.splice(k, 1)[0];
      for (const t of out.get(x) || []) {
        const via = t.ref?.[0] === 'choices' ? adv.sections[x].choices?.[t.ref[1]]?.effects : null;
        const d = day.get(x) + dayStep(via, cid) + dayStep(adv.sections[t.to].onEnter, cid);
        if (!day.has(t.to) || d < day.get(t.to)) { day.set(t.to, d); todo.push(t.to); }
      }
    } }

  const place = inheritedPlaces(adv, out);

  return { ids, out, main, depth, path, dominators, day, victories, place, dayCounter: dc };
}

function pathLen(prev, x) { let n = 0; for (; x !== null; x = prev.get(x)) n++; return n; }
