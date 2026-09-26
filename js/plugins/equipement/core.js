// Greffon « equipement » — moteur pur (aucun DOM, testable dans Node).
// Objets portés dans des emplacements (arme, armure, bouclier, bijou…), bonus de combat et capacité du sac.
//
// État : state.equipped = { idEmplacement: idObjet }  (les objets portés restent dans state.inventory)
//        state.equipement = { seen: { idObjet: quantité }, dropped: { idObjet: quantité } }
//   - seen    : inventaire lors de la dernière synchronisation ; ce qui dépasse est « nouvellement reçu ».
//   - dropped : objets abandonnés dans le paragraphe en cours (on peut les reprendre avant de le quitter).
//
// Équipement automatique : l'effet « give » du moteur n'est pas modifié. On calcule une VUE de l'équipement
// (equippedOf) : les emplacements enregistrés dont l'objet est toujours dans le sac, plus les objets reçus
// depuis la dernière synchronisation si leur emplacement est libre. Combat, conditions, capacité et interface
// lisent cette vue ; elle est donc juste même juste après un achat en boutique ou un objet utilisé.
// L'état est ensuite « matérialisé » (sync) à chaque entrée de paragraphe (registerEnterHook), dans les effets
// equip / unequip et dans les actions du joueur (equip, unequip, drop, pickUp).

import { registerNormalize, registerHeroInit, registerEffect, registerCondition, registerCombatHook,
  registerChoiceGuard, registerEnterHook } from '../../core/plugins.js';
import { itemName } from '../../core/rules.js';

export const DEFAULT_SLOTS = [
  { id: 'arme', label: 'Arme' },
  { id: 'armure', label: 'Armure' },
  { id: 'bouclier', label: 'Bouclier' },
  { id: 'bijou', label: 'Bijou' },
];
export const defaults = () => ({ enabled: false, slots: structuredClone(DEFAULT_SLOTS), capacity: 0, unarmedPenalty: 0, weaponSlot: 'arme' });

export const FULL_BAG = 'Votre sac est trop plein : abandonnez un objet depuis votre Feuille d\'Aventure.';

/* ------------------------------------------------------------------ */
/* Lecture des règles                                                  */
/* ------------------------------------------------------------------ */

export const rulesOf = adv => adv?.rules?.equipment || defaults();
export const isOn = adv => !!adv?.rules?.equipment?.enabled;
export const slotsOf = adv => (rulesOf(adv).slots || []).filter(s => s && s.id);
export const slotLabel = (adv, id) => slotsOf(adv).find(s => s.id === id)?.label || id;
export const capacityOf = adv => Math.max(0, Number(rulesOf(adv).capacity) || 0);
export const penaltyOf = adv => Math.abs(Number(rulesOf(adv).unarmedPenalty) || 0);
/** Emplacement de l'arme (pour la pénalité sans arme), s'il existe dans la liste. */
export const weaponSlotOf = adv => { const id = rulesOf(adv).weaponSlot ?? 'arme'; return slotsOf(adv).some(s => s.id === id) ? id : null; };
/** Emplacement d'un objet, seulement s'il existe dans les règles. */
export const itemSlot = (adv, itemId) => { const sl = adv?.items?.[itemId]?.slot; return sl && slotsOf(adv).some(s => s.id === sl) ? sl : null; };
const num = v => Number(v) || 0;
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const positive = inv => Object.fromEntries(Object.entries(inv || {}).filter(([, q]) => q > 0));

/* ------------------------------------------------------------------ */
/* Vue de l'équipement                                                 */
/* ------------------------------------------------------------------ */

/**
 * Calcule l'équipement réellement porté, sans rien modifier.
 * Renvoie { equipped: { slot: item }, auto: [{ slot, item }], freed: [{ slot, item }] }.
 */
export function resolve(state, adv) {
  const inv = state?.inventory || {};
  const ids = new Set(slotsOf(adv).map(s => s.id));
  const equipped = {}, auto = [], freed = [];
  for (const [slot, item] of Object.entries(state?.equipped || {})) {
    if (!ids.has(slot) || !item) continue;
    if ((inv[item] || 0) > 0 && itemSlot(adv, item) === slot) equipped[slot] = item;
    else freed.push({ slot, item });
  }
  const seen = state?.equipement?.seen;
  const worn = new Set(Object.values(equipped));
  for (const [item, q] of Object.entries(inv)) {
    if (!(q > 0) || worn.has(item)) continue;
    const slot = itemSlot(adv, item);
    if (!slot || equipped[slot]) continue;
    if (q > (seen ? seen[item] || 0 : 0)) { equipped[slot] = item; worn.add(item); auto.push({ slot, item }); }
  }
  return { equipped, auto, freed };
}

/** { slot: item } : ce que porte le héros (vide si le greffon est désactivé). */
export const equippedOf = (state, adv) => (isOn(adv) ? resolve(state, adv).equipped : {});
export const isEquipped = (state, adv, itemId) => Object.values(equippedOf(state, adv)).includes(itemId);

/** Nombre d'objets qui occupent le sac : quantités, hors objets portés et petits objets. */
export function bagLoad(state, adv) {
  const worn = new Set(Object.values(equippedOf(state, adv)));
  let n = 0;
  for (const [id, q] of Object.entries(state?.inventory || {})) {
    if (!(q > 0) || adv.items?.[id]?.small) continue;
    n += q - (worn.has(id) ? 1 : 0);
  }
  return n;
}

/** { load, capacity, over } — capacity 0 = illimitée. */
export function bagOf(state, adv) {
  const capacity = capacityOf(adv), load = bagLoad(state, adv);
  return { load, capacity, over: capacity > 0 && load > capacity ? load - capacity : 0 };
}

/** Bonus d'un objet en texte : « +1 Force d'Attaque, +1 dégât infligé, armure 1 ». */
export function bonusText(it) {
  if (!it) return '';
  const out = [];
  if (num(it.attack)) out.push(`${signed(num(it.attack))} Force d'Attaque`);
  if (num(it.damage)) out.push(`${signed(num(it.damage))} dégât${Math.abs(num(it.damage)) > 1 ? 's' : ''} infligé${Math.abs(num(it.damage)) > 1 ? 's' : ''}`);
  if (num(it.armor)) out.push(`${signed(-num(it.armor))} dégât${Math.abs(num(it.armor)) > 1 ? 's' : ''} subi${Math.abs(num(it.armor)) > 1 ? 's' : ''}`);
  return out.join(', ');
}

/**
 * Bonus de combat de l'équipement porté.
 * Renvoie { attack, damage, armor, unarmed, lines: [{ label, text, kind }] }.
 */
export function bonuses(state, adv) {
  const zero = { attack: 0, damage: 0, armor: 0, unarmed: false, lines: [] };
  // Héros fictif de l'estimation de difficulté (éditeur) : pas d'inventaire, pas d'équipement.
  if (!isOn(adv) || !state?.inventory) return zero;
  const eq = equippedOf(state, adv);
  const out = { ...zero, lines: [] };
  for (const s of slotsOf(adv)) {
    const id = eq[s.id];
    if (!id) continue;
    const it = adv.items[id] || {};
    out.attack += num(it.attack); out.damage += num(it.damage); out.armor += num(it.armor);
    const t = bonusText(it);
    if (t) out.lines.push({ label: itemName(adv, id), text: t, kind: 'item' });
  }
  const w = weaponSlotOf(adv), pen = penaltyOf(adv);
  if (w && pen && !eq[w]) {
    out.attack -= pen; out.unarmed = true;
    out.lines.push({ label: `Sans ${slotLabel(adv, w).toLowerCase()}`, text: `−${pen} Force d'Attaque`, kind: 'unarmed' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Modifications (sur un état déjà cloné)                              */
/* ------------------------------------------------------------------ */

const bookkeeping = s => { s.equipement = { seen: {}, dropped: {}, ...(s.equipement || {}) }; s.equipement.dropped ||= {}; return s.equipement; };

/** Matérialise la vue dans l'état : emplacements libérés, objets reçus équipés, inventaire mémorisé. */
function sync(s, adv, messages) {
  const r = resolve(s, adv);
  s.equipped = r.equipped;
  bookkeeping(s).seen = positive(s.inventory);
  if (messages) for (const a of r.auto) messages.push({ kind: 'info', text: `Vous vous équipez : ${itemName(adv, a.item)} (${slotLabel(adv, a.slot)}).` });
  return r;
}

function doEquip(s, adv, itemId, messages) {
  const slot = itemSlot(adv, itemId);
  if (!slot) { messages.push({ kind: 'info', text: `${itemName(adv, itemId)} ne se porte pas.` }); return false; }
  if (!(s.inventory?.[itemId] > 0)) { messages.push({ kind: 'info', text: `Vous n'avez pas : ${itemName(adv, itemId)}.` }); return false; }
  const stored = s.equipped?.[slot];
  sync(s, adv, null);
  const prev = s.equipped[slot];
  if (prev === itemId && stored === itemId) return false; // déjà porté
  s.equipped = { ...s.equipped, [slot]: itemId };
  const replaced = prev && prev !== itemId ? prev : null;
  messages.push({ kind: 'info', text: `Vous vous équipez : ${itemName(adv, itemId)} (${slotLabel(adv, slot)}).${replaced ? ` ${itemName(adv, replaced)} retourne dans votre sac.` : ''}` });
  return true;
}

function doUnequip(s, adv, slotId, messages, { take = false } = {}) {
  sync(s, adv, null);
  const item = s.equipped[slotId];
  if (!item) return false;
  const eq = { ...s.equipped }; delete eq[slotId]; s.equipped = eq;
  if (take) {
    const q = (s.inventory[item] || 0) - 1;
    if (q > 0) s.inventory[item] = q; else delete s.inventory[item];
    bookkeeping(s).seen = positive(s.inventory);
    messages.push({ kind: 'loss', text: `Objet perdu : ${itemName(adv, item)} (${slotLabel(adv, slotId)}).` });
  } else messages.push({ kind: 'info', text: `Vous rangez ${itemName(adv, item)} dans votre sac.` });
  return true;
}

/* ------------------------------------------------------------------ */
/* Actions du joueur : { state, messages }, état neuf                  */
/* ------------------------------------------------------------------ */

const off = state => ({ state, messages: [] });

/** Porte un objet du sac ; l'objet qui occupait l'emplacement retourne dans le sac. */
export function equip(state, adv, itemId) {
  if (!isOn(adv)) return off(state);
  const s = structuredClone(state), messages = [];
  doEquip(s, adv, itemId, messages);
  return { state: s, messages };
}

/** Range dans le sac l'objet porté à cet emplacement. */
export function unequip(state, adv, slotId) {
  if (!isOn(adv)) return off(state);
  const s = structuredClone(state), messages = [];
  doUnequip(s, adv, slotId, messages);
  return { state: s, messages };
}

/** Abandonne un exemplaire de l'objet (d'abord celui du sac, sinon celui qui est porté). */
export function drop(state, adv, itemId) {
  if (!isOn(adv) || !(state.inventory?.[itemId] > 0)) return off(state);
  const s = structuredClone(state);
  sync(s, adv, null);
  const q = s.inventory[itemId] - 1;
  if (q > 0) s.inventory[itemId] = q; else delete s.inventory[itemId];
  const bk = bookkeeping(s);
  bk.dropped = { ...bk.dropped, [itemId]: (bk.dropped[itemId] || 0) + 1 };
  sync(s, adv, null);
  return { state: s, messages: [{ kind: 'loss', text: `Vous abandonnez : ${itemName(adv, itemId)}. Vous pouvez reprendre cet objet tant que vous restez dans ce paragraphe.` }] };
}

/** Reprend un objet abandonné dans le paragraphe en cours. */
export function pickUp(state, adv, itemId) {
  const left = state.equipement?.dropped?.[itemId] || 0;
  if (!isOn(adv) || !left) return off(state);
  const s = structuredClone(state), messages = [];
  sync(s, adv, null);
  const bk = bookkeeping(s);
  const dropped = { ...bk.dropped };
  if (left > 1) dropped[itemId] = left - 1; else delete dropped[itemId];
  bk.dropped = dropped;
  s.inventory[itemId] = (s.inventory[itemId] || 0) + 1;
  messages.push({ kind: 'gain', text: `Vous reprenez : ${itemName(adv, itemId)}.` });
  sync(s, adv, messages);
  return { state: s, messages };
}

/** Objets abandonnés ici : [[idObjet, quantité]]. */
export const droppedHere = state => Object.entries(state?.equipement?.dropped || {}).filter(([, q]) => q > 0);

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

/** { equipped: idObjet } ou { equippedSlot: idEmplacement }, avec negate: true pour l'inverse. */
export function checkEquipped(c, state, adv) {
  const eq = equippedOf(state, adv);
  const yes = 'equippedSlot' in c ? !!eq[c.equippedSlot] : Object.values(eq).includes(c.equipped);
  return c.negate ? !yes : yes;
}

/* ------------------------------------------------------------------ */
/* Enregistrement dans le moteur                                       */
/* ------------------------------------------------------------------ */

registerNormalize(adv => {
  const cur = adv.rules.equipment;
  const e = { ...defaults(), ...(cur && typeof cur === 'object' ? cur : {}) };
  if (!Array.isArray(e.slots)) e.slots = structuredClone(DEFAULT_SLOTS);
  adv.rules.equipment = e;
});

registerHeroInit((state, adv) => {
  if (!isOn(adv)) return;
  state.equipped = {};
  state.equipement = { seen: {}, dropped: {} };
  sync(state, adv, null); // les objets de départ vont dans leur emplacement s'il est libre
});

registerEnterHook((s, adv, sectionId, messages) => {
  if (!isOn(adv)) return;
  // Pour n'annoncer que ce qui vient d'être équipé : ce que la vue montrait déjà avant ce paragraphe ne l'est pas.
  const before = s.history?.length ? resolve(s.history[s.history.length - 1], adv).equipped : {};
  const r = sync(s, adv, null);
  for (const a of r.auto) if (before[a.slot] !== a.item) messages.push({ kind: 'info', text: `Vous vous équipez : ${itemName(adv, a.item)} (${slotLabel(adv, a.slot)}).` });
  bookkeeping(s).dropped = {}; // on quitte l'endroit : les objets abandonnés y restent
});

registerEffect('equip', {
  apply(s, e, adv, messages) { if (isOn(adv) && e.item) doEquip(s, adv, e.item, messages); },
  describe: (e, adv) => `équipe ${e.item ? itemName(adv, e.item) : '(objet ?)'}`,
  print: (e, adv) => `si vous possédez : ${itemName(adv, e.item)}, portez cet objet : inscrivez-le dans la case « ${slotLabel(adv, adv.items[e.item]?.slot || '?')} » de votre Feuille d'Aventure (l'objet qui s'y trouvait retourne dans votre sac).`,
  validate(e, adv, report, where) {
    if (!isOn(adv)) report('warning', `${where} : l'équipement est désactivé dans les Règles, l'effet « équiper » ne fera rien.`);
    if (!e.item) report('error', `${where} : aucun objet à équiper.`);
    else if (adv.items[e.item] && !itemSlot(adv, e.item)) report('warning', `${where} : l'objet « ${itemName(adv, e.item)} » n'a pas d'emplacement (onglet Objets).`);
  },
});

registerEffect('unequip', {
  apply(s, e, adv, messages) { if (isOn(adv) && e.slot) doUnequip(s, adv, e.slot, messages, { take: !!e.take }); },
  describe: (e, adv) => `${e.take ? 'perd' : 'range dans le sac'} l'objet porté (${slotLabel(adv, e.slot)})`,
  print: (e, adv) => (e.take
    ? `rayez l'objet inscrit dans la case « ${slotLabel(adv, e.slot)} » de votre Feuille d'Aventure : vous le perdez.`
    : `rangez dans votre sac l'objet de la case « ${slotLabel(adv, e.slot)} » : effacez-le de cette case et inscrivez-le parmi vos objets.`),
  validate(e, adv, report, where) {
    if (!isOn(adv)) report('warning', `${where} : l'équipement est désactivé dans les Règles, l'effet « ranger » ne fera rien.`);
    if (!slotsOf(adv).some(s => s.id === e.slot)) report('error', `${where} : emplacement inconnu « ${e.slot || ''} ».`);
  },
});

registerCondition({
  id: 'equipement',
  match: c => 'equipped' in c || 'equippedSlot' in c,
  check: checkEquipped,
  describe(c, adv) {
    if ('equippedSlot' in c) return c.negate ? `n'avoir rien à l'emplacement « ${slotLabel(adv, c.equippedSlot)} »` : `porter un objet à l'emplacement « ${slotLabel(adv, c.equippedSlot)} »`;
    return `${c.negate ? 'ne pas porter' : 'porter'} : ${itemName(adv, c.equipped)}`;
  },
  print(c, adv) {
    if ('equippedSlot' in c) return c.negate ? `la case « ${slotLabel(adv, c.equippedSlot)} » de votre Feuille d'Aventure est vide` : `vous portez un objet dans la case « ${slotLabel(adv, c.equippedSlot)} »`;
    return `${c.negate ? 'vous ne portez pas' : 'vous portez'} : ${itemName(adv, c.equipped)}`;
  },
  validate(c, adv, report, where) {
    if (!isOn(adv)) report('warning', `${where} : l'équipement est désactivé dans les Règles.`);
    if ('equippedSlot' in c) { if (!slotsOf(adv).some(s => s.id === c.equippedSlot)) report('error', `${where} : emplacement inconnu « ${c.equippedSlot} ».`); }
    else if (!adv.items[c.equipped]) report('warning', `${where} : l'objet « ${c.equipped} » n'est pas dans la liste des objets.`);
    else if (!itemSlot(adv, c.equipped)) report('warning', `${where} : l'objet « ${itemName(adv, c.equipped)} » n'a pas d'emplacement, il ne peut pas être porté.`);
  },
});

registerCombatHook({
  attackMod: (state, adv) => bonuses(state, adv).attack,
  damageMod: (state, adv) => bonuses(state, adv).damage,
  armor: (state, adv) => bonuses(state, adv).armor,
});

registerChoiceGuard((state, adv) => (isOn(adv) && bagOf(state, adv).over ? FULL_BAG : null));
