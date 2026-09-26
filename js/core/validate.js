// Vérifications d'une aventure pour l'éditeur, et renumérotation façon livre-jeu.

import { targetsOf } from './rules.js';
import { ext, findCondition } from './plugins.js';

const BUILTIN_BLOCKS = new Set(['test', 'roll', 'combat', 'shop', 'spells']);
import { isDice } from './dice.js';

/** Paragraphes atteignables depuis le départ. */
export function reachable(adv) {
  const seen = new Set();
  const stack = [String(adv.start)];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !adv.sections[id]) continue;
    seen.add(id);
    targetsOf(adv.sections[id]).forEach(t => stack.push(t.to));
  }
  return seen;
}

/** Liste de problèmes : { section, level: 'error'|'warning'|'info', message }. */
export function validate(adv) {
  const out = [];
  const ids = Object.keys(adv.sections);
  const push = (section, level, message) => out.push({ section, level, message });
  if (!adv.sections[adv.start]) push(null, 'error', `Le paragraphe de départ « ${adv.start} » n'existe pas.`);
  const reach = reachable(adv);
  const incoming = new Map(ids.map(id => [id, 0]));

  const checkItem = (sid, id, where) => { if (id && !adv.items[id]) push(sid, 'warning', `${where} : l'objet « ${id} » n'est pas dans la liste des objets.`); };
  const walkCond = (sid, c, where) => {
    if (!c) return;
    (c.all || c.any || []).forEach(x => walkCond(sid, x, where));
    if (c.not) walkCond(sid, c.not, where);
    if (c.has) checkItem(sid, c.has, where);
    if (c.visited && !adv.sections[c.visited]) push(sid, 'error', `${where} : la condition cite le paragraphe ${c.visited}, qui n'existe pas.`);
    if (c.stat && !adv.rules.stats.find(s => s.id === c.stat)) push(sid, 'error', `${where} : caractéristique inconnue « ${c.stat} ».`);
    findCondition(c)?.validate?.(c, adv, (level, message) => push(sid, level, message), where);
  };
  const walkEffects = (sid, list, where) => (list || []).forEach(e => {
    if (e.item) checkItem(sid, e.item, where);
    if (e.stat && !adv.rules.stats.find(s => s.id === e.stat)) push(sid, 'error', `${where} : caractéristique inconnue « ${e.stat} ».`);
    walkCond(sid, e.if, where);
    ext.effects.get(e.op)?.validate?.(e, adv, (level, message) => push(sid, level, message), where);
  });

  for (const id of ids) {
    const sec = adv.sections[id];
    const targets = targetsOf(sec);
    targets.forEach(t => {
      if (!adv.sections[t.to]) push(id, 'error', `Renvoi vers le ${t.to}, qui n'existe pas (${t.kind}${t.label ? ` : ${t.label}` : ''}).`);
      else incoming.set(t.to, incoming.get(t.to) + 1);
    });
    if (!targets.length && !sec.ending) push(id, 'warning', 'Aucune sortie : marquez ce paragraphe comme une fin ou ajoutez un choix.');
    if (sec.ending && targets.length) push(id, 'info', 'Paragraphe de fin qui propose pourtant des sorties.');
    if (!sec.text?.trim()) push(id, 'warning', 'Texte vide.');
    (sec.choices || []).forEach((c, i) => {
      if (!c.to) push(id, 'error', `Le choix n°${i + 1} n'a pas de destination.`);
      if (!c.text?.trim()) push(id, 'warning', `Le choix n°${i + 1} n'a pas de texte.`);
      walkCond(id, c.if, `Choix n°${i + 1}`);
      walkEffects(id, c.effects, `Choix n°${i + 1}`);
    });
    walkEffects(id, sec.onEnter, 'Effets d’entrée');
    (sec.blocks || []).forEach((b, i) => {
      const where = `Bloc ${i + 1} (${b.type})`;
      if (b.type === 'test') {
        if (!b.success || !b.failure) push(id, 'error', `${where} : il faut une destination en cas de réussite et d'échec.`);
        if (!adv.rules.stats.find(s => s.id === b.stat)) push(id, 'error', `${where} : caractéristique inconnue.`);
      }
      if (b.type === 'roll') {
        if (!isDice(b.dice || '1d6')) push(id, 'error', `${where} : formule de dés invalide.`);
        if (!(b.table || []).length) push(id, 'error', `${where} : la table est vide.`);
      }
      if (b.type === 'combat') {
        if (!(b.enemies || []).length) push(id, 'error', `${where} : aucun adversaire.`);
        if (!b.win) push(id, 'error', `${where} : pas de destination en cas de victoire.`);
      }
      if (b.type === 'shop') (b.offers || []).forEach(o => checkItem(id, o.item, where));
      if (!BUILTIN_BLOCKS.has(b.type)) {
        const plug = ext.blocks.get(b.type);
        if (!plug) push(id, 'warning', `${where} : type de bloc inconnu (greffon absent ?).`);
        else plug.validate?.(b, adv, (level, message) => push(id, level, message), where);
      }
      if (b.type === 'spells') {
        if (!adv.rules.spells?.enabled) push(id, 'warning', `${where} : le système de formules est désactivé dans les Règles.`);
        if (!(b.options || []).length) push(id, 'error', `${where} : aucune formule proposée.`);
        (b.options || []).forEach(o => {
          if (!o.to) push(id, 'error', `${where} : la formule ${o.code || '?'} n'a pas de destination.`);
          if (o.code && !(adv.rules.spells?.book || []).some(x => x.code.toUpperCase() === String(o.code).toUpperCase())) push(id, 'info', `${where} : ${String(o.code).toUpperCase()} n'est pas dans le livre des formules (fausse formule).`);
        });
      }
    });
    if (!reach.has(id)) push(id, 'warning', 'Inaccessible depuis le départ.');
  }
  for (const [id, n] of incoming) if (!n && id !== String(adv.start)) push(id, 'info', 'Aucun paragraphe ne renvoie ici.');
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (Number(a.section) || 0) - (Number(b.section) || 0));
}

/**
 * Renumérote les paragraphes de 1 à N dans un ordre aléatoire (le départ reste le 1),
 * comme dans un livre imprimé. Met à jour tous les renvois. Renvoie { adventure, mapping }.
 */
/** Remplace les numéros de paragraphes selon `mapping` ({ ancien: nouveau }) dans toute l'aventure. */
export function remap(adv, mapping) {
  const m = id => (id == null || id === '' ? id : mapping[String(id)] ?? id);
  const remapCond = c => {
    if (!c) return c;
    const r = { ...c };
    if (r.all) r.all = r.all.map(remapCond);
    if (r.any) r.any = r.any.map(remapCond);
    if (r.not) r.not = remapCond(r.not);
    if (r.visited) r.visited = m(r.visited);
    return r;
  };
  const remapEffects = list => (list || []).map(e => (e.if ? { ...e, if: remapCond(e.if) } : e));
  const sections = {};
  for (const [id, sec] of Object.entries(adv.sections)) {
    const s = structuredClone(sec);
    s.choices = (s.choices || []).map(c => ({ ...c, to: m(c.to), if: remapCond(c.if), effects: remapEffects(c.effects) }));
    s.onEnter = remapEffects(s.onEnter);
    s.blocks = (s.blocks || []).map(b => {
      const x = { ...b };
      ['success', 'failure', 'win', 'flee', 'lose'].forEach(k => { if (x[k]) x[k] = m(x[k]); });
      if (x.table) x.table = x.table.map(t => ({ ...t, to: m(t.to) }));
      if (x.options) x.options = x.options.map(o => ({ ...o, to: m(o.to) }));
      const plug = ext.blocks.get(x.type);
      return plug?.remap ? plug.remap(x, m, remapCond) : x;
    });
    sections[m(id)] = s;
  }
  const sorted = Object.fromEntries(Object.entries(sections).sort((a, b) => (Number(a[0]) || 0) - (Number(b[0]) || 0) || a[0].localeCompare(b[0])));
  return { ...structuredClone(adv), sections: sorted, start: m(adv.start) };
}

/** Renomme un paragraphe et met à jour tous les renvois. */
export function renameSection(adv, from, to) {
  to = String(to).trim();
  if (!to || adv.sections[to]) throw new Error(`Le paragraphe ${to} existe déjà.`);
  return remap(adv, { [from]: to });
}

/**
 * Renumérote les paragraphes de 1 à N dans un ordre aléatoire (le départ reste le 1),
 * comme dans un livre imprimé. Met à jour tous les renvois. Renvoie { adventure, mapping }.
 */
export function renumber(adv, rng = Math.random) {
  const ids = Object.keys(adv.sections).filter(id => id !== String(adv.start));
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const mapping = { [adv.start]: '1' };
  ids.forEach((id, i) => { mapping[id] = String(i + 2); });
  // Passage par des noms temporaires pour éviter les collisions (le 3 devient 5 pendant que le 5 devient 3).
  const tmp = Object.fromEntries(Object.keys(mapping).map(k => [k, '~' + mapping[k]]));
  const back = Object.fromEntries(Object.values(tmp).map(v => [v, v.slice(1)]));
  return { adventure: remap(remap(adv, tmp), back), mapping };
}
