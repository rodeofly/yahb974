// Greffon « inventaire » — moteur pur (aucun DOM, testable dans Node).
//
// 1. Le sac, à la manière des jeux d'aventure : des onglets (catégories d'objets, collections, onglets des greffons),
//    une grille de cases, et pour chaque objet sa fiche (description, indice selon le mode de jeu).
//      adv.rules.inventory = {
//        categories:  [{ id, label, icon? }]           ordre des onglets ; la première reçoit les objets sans catégorie
//        collections: [{ id, label, icon?, items: [ids], message? }]
//                     toutes les cases sont montrées, trouvées ou non ; `message` : phrase dont chaque lettre se dévoile
//                     quand l'objet de même rang est trouvé (« UN SECRET BIEN GARDÉ », les espaces et la ponctuation restent)
//      }
//      adv.items[id] : category?, tag? (texte très court affiché sur la case), hint? (indice), hints? ({ [mode]: indice })
// 2. La feuille tenue par le livre, et le mode triche :
//      adv.rules.sheet = { locked: bool, cheat: bool, unlock?: { gold?, counters?: { [id]: n } } }
//      locked : le joueur n'ajoute ni ne retire d'objet lui-même (c'est l'aventure qui donne et qui prend) ;
//      cheat  : il peut passer la partie en mode triche ; tout se débloque, la partie est marquée et ne compte pas.
//      État : state.cheat = null | { turn, unlocked }, state.seenItems = { [id]: true } (cases « Nouveau »).
// Voir docs/plugins/inventaire.md.

import { registerNormalize, registerHeroInit } from '../../core/plugins.js';
import { applyEffects } from '../../core/rules.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v : []);
const DEFAULT_CATEGORY = { id: 'objets', label: 'Objets', icon: '🎒' };

/* ------------------------------------------------------------------ */
/* Règles                                                              */
/* ------------------------------------------------------------------ */

/** Règles de la feuille, toujours complètes. */
export function sheetRules(adv) {
  const s = isObj(adv?.rules?.sheet) ? adv.rules.sheet : {};
  const u = isObj(s.unlock) ? s.unlock : {};
  return { locked: !!s.locked, cheat: !!s.cheat, unlock: { gold: Number(u.gold) || 0, counters: isObj(u.counters) ? u.counters : {} } };
}

/** Le joueur peut-il ajouter ou retirer lui-même des objets ? (feuille libre, ou partie en mode triche) */
export const canEditItems = (adv, state) => !sheetRules(adv).locked || !!state?.cheat;
export const cheatAllowed = adv => sheetRules(adv).cheat;
export const isCheating = state => !!state?.cheat;

/** Catégories (onglets), toujours au moins une. */
export function categoriesOf(adv) {
  const list = arr(adv?.rules?.inventory?.categories).filter(c => isObj(c) && c.id);
  return list.length ? list.map(c => ({ icon: '', ...c, label: c.label || c.id })) : [DEFAULT_CATEGORY];
}

/** Collections, avec leurs objets connus de l'aventure. */
export function collectionsOf(adv) {
  return arr(adv?.rules?.inventory?.collections).filter(c => isObj(c) && c.id && arr(c.items).length)
    .map(c => ({ icon: '', ...c, label: c.label || c.id, items: arr(c.items).filter(id => typeof id === 'string') }));
}

/** Catégorie d'un objet : la sienne si elle existe, sinon la première. */
export function categoryOf(adv, id) {
  const cats = categoriesOf(adv);
  const want = adv?.items?.[id]?.category;
  return (cats.find(c => c.id === want) || cats[0]).id;
}

/** Indice d'un objet pour un mode : celui du mode, sinon l'indice général, sinon ''. */
export function hintFor(item, modeId) {
  if (!isObj(item)) return '';
  if (isObj(item.hints) && modeId && typeof item.hints[modeId] === 'string' && item.hints[modeId].trim()) return item.hints[modeId].trim();
  return typeof item.hint === 'string' ? item.hint.trim() : '';
}

/* ------------------------------------------------------------------ */
/* Le sac                                                              */
/* ------------------------------------------------------------------ */

const owned = (state, id) => (Number(state?.inventory?.[id]) || 0) > 0;

/**
 * Contenu du sac, onglet par onglet :
 * [{ id, kind: 'category' | 'collection', label, icon, slots: [{ id, qty, owned, index }], found, total, message? }]
 * Un objet qui appartient à une collection n'apparaît que dans sa collection.
 */
export function inventoryView(adv, state) {
  const cols = collectionsOf(adv);
  const inCollection = new Set(cols.flatMap(c => c.items));
  const inv = Object.entries(state?.inventory || {}).filter(([id, q]) => q > 0 && !inCollection.has(id));
  const tabs = categoriesOf(adv).map(c => {
    const slots = inv.filter(([id]) => categoryOf(adv, id) === c.id).map(([id, qty], index) => ({ id, qty, owned: true, index }));
    return { id: c.id, kind: 'category', label: c.label, icon: c.icon, slots, found: slots.length, total: null };
  });
  for (const c of cols) {
    const slots = c.items.map((id, index) => ({ id, qty: Number(state?.inventory?.[id]) || 0, owned: owned(state, id), index }));
    tabs.push({ id: c.id, kind: 'collection', label: c.label, icon: c.icon, slots, found: slots.filter(s => s.owned).length, total: slots.length,
      message: typeof c.message === 'string' && c.message ? messageOf(c.message, slots) : null });
  }
  return tabs;
}

/**
 * Message d'une collection : chaque lettre du modèle se dévoile quand l'objet de même rang est trouvé.
 * Renvoie [{ char, shown, letter: bool }] ; les espaces et la ponctuation sont toujours montrés.
 */
export function messageOf(template, slots) {
  let k = 0;
  return [...String(template)].map(ch => {
    if (!/\p{L}/u.test(ch)) return { char: ch, shown: true, letter: false };
    const s = slots[k++];
    return { char: ch, shown: !!s?.owned, letter: true };
  });
}

/** Nombre de lettres d'un modèle de message (doit égaler le nombre d'objets de la collection). */
export const messageLetters = template => [...String(template || '')].filter(ch => /\p{L}/u.test(ch)).length;

/** Objets du sac jamais regardés depuis qu'on les a (cases « Nouveau »). */
export const newItems = state => Object.entries(state?.inventory || {}).filter(([id, q]) => q > 0 && !state?.seenItems?.[id]).map(([id]) => id);

/** Le joueur a ouvert son sac : tout ce qu'il contient a été vu. Renvoie un nouvel état. */
export function markSeen(state) {
  const seen = { ...(state?.seenItems || {}) };
  for (const id of newItems(state)) seen[id] = true;
  return { ...state, seenItems: seen };
}

/* ------------------------------------------------------------------ */
/* Mode triche                                                         */
/* ------------------------------------------------------------------ */

/** Passe la partie en mode triche (définitif pour cette partie). Renvoie { state, messages }. */
export function startCheat(state) {
  if (state?.cheat) return { state, messages: [] };
  return { state: { ...state, cheat: { turn: Number(state?.turn) || 0, unlocked: false } }, messages: [{ kind: 'info', text: 'Mode triche activé : cette partie ne compte plus pour les succès.' }] };
}

/**
 * Mode triche : tout débloquer. Tous les objets de l'aventure (un exemplaire), les drapeaux et les compagnons de la
 * campagne (adv.rules.campaign.fields), plus l'or et les compteurs prévus par rules.sheet.unlock.
 * Sans mode triche, ne fait rien. Renvoie { state, messages }.
 */
export function unlockAll(state, adv) {
  if (!state?.cheat) return { state, messages: [] };
  const s = structuredClone(state);
  s.inventory = { ...(s.inventory || {}) };
  let items = 0;
  for (const id of Object.keys(adv?.items || {})) if (!owned(s, id)) { s.inventory[id] = 1; items++; }
  const fields = isObj(adv?.rules?.campaign?.fields) ? adv.rules.campaign.fields : {};
  s.flags = { ...(s.flags || {}) };
  let flags = 0;
  for (const f of arr(fields.flags)) if (!s.flags[f]) { s.flags[f] = true; flags++; }
  const u = sheetRules(adv).unlock;
  const effects = [];
  const present = new Set(arr(s.companions).map(c => c?.id));
  for (const c of arr(fields.companions)) if (adv?.companions?.[c] && !present.has(c)) effects.push({ op: 'companion', companion: c, action: 'join' });
  if (u.gold) effects.push({ op: 'gold', add: u.gold });
  for (const [counter, n] of Object.entries(u.counters)) if (Number(n)) effects.push({ op: 'counter', counter, add: Number(n) });
  s.cheat = { ...s.cheat, unlocked: true };
  const r = effects.length ? applyEffects(s, adv, effects) : { state: s, messages: [] };
  const parts = [`${items} objet${items > 1 ? 's' : ''}`, flags && `${flags} acte${flags > 1 ? 's' : ''} de campagne`].filter(Boolean);
  return { state: r.state, messages: [{ kind: 'gain', text: `Mode triche : tout est débloqué (${parts.join(', ')}).` }, ...r.messages] };
}

/* ------------------------------------------------------------------ */
/* Vérification (éditeur, outils de fabrication)                       */
/* ------------------------------------------------------------------ */

/** Problèmes de réglage du sac : [{ level: 'error' | 'warning', message }]. */
export function inventoryProblems(adv) {
  const out = [];
  const cats = new Set(arr(adv?.rules?.inventory?.categories).map(c => c?.id));
  for (const c of collectionsOf(adv)) {
    const missing = c.items.filter(id => !adv?.items?.[id]);
    if (missing.length) out.push({ level: 'warning', message: `Collection « ${c.label} » : objets absents de la liste des objets (${missing.join(', ')}).` });
    if (typeof c.message === 'string' && c.message && messageLetters(c.message) !== c.items.length) out.push({ level: 'error', message: `Collection « ${c.label} » : le message a ${messageLetters(c.message)} lettres pour ${c.items.length} objets.` });
  }
  for (const [id, it] of Object.entries(adv?.items || {})) {
    if (it?.category && cats.size && !cats.has(it.category)) out.push({ level: 'warning', message: `Objet « ${it.name || id} » : catégorie inconnue « ${it.category} ».` });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

registerNormalize(adv => {
  adv.rules.sheet = { locked: false, cheat: false, ...(isObj(adv.rules.sheet) ? adv.rules.sheet : {}) };
  const inv = isObj(adv.rules.inventory) ? adv.rules.inventory : {};
  adv.rules.inventory = { ...inv, categories: arr(inv.categories), collections: arr(inv.collections) };
});

registerHeroInit(state => { state.cheat = null; state.seenItems = {}; });
