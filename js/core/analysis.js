// Analyse de la structure d'une aventure, pour le graphe de l'éditeur :
// fil principal (sans les effets de sorts), profondeur, chemin le plus court vers une victoire,
// passages obligés, journées.

import { targetsOf } from './rules.js';

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

  // Journées : un paragraphe dont les effets d'entrée contiennent « nouveau jour » fait passer au jour suivant.
  const newDay = id => (adv.sections[id].onEnter || []).some(e => e.op === 'newDay');
  const day = new Map([[start, 1]]);
  { const dq = [start];
    while (dq.length) {
      const x = dq.shift();
      for (const t of out.get(x) || []) {
        const d = day.get(x) + (newDay(t.to) ? 1 : 0);
        if (!day.has(t.to) || d < day.get(t.to)) { day.set(t.to, d); newDay(t.to) ? dq.push(t.to) : dq.unshift(t.to); }
      }
    } }

  return { ids, out, main, depth, path, dominators, day, victories };
}

function pathLen(prev, x) { let n = 0; for (; x !== null; x = prev.get(x)) n++; return n; }
