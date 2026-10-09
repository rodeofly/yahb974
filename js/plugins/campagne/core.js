// Greffon « campagne » — moteur pur : le passeport du voyageur, pour qu'un héros passe d'une aventure à la suivante
// (une série de livres, façon Sorcellerie !). Voir docs/plugins/campagne.md.
//
//   Aventure : adv.rules.campaign = { id, title?, book, prefix?, modes?: [ids], fields: { stats?, counters?, items?,
//              flags?, companions?, gold? }, newcomer?: { gold?, items?, flags?, counters? }, cheatFlag? }
//   Triche   : `cheatFlag` nomme un drapeau de `fields.flags` qui transporte le mode triche (greffon inventaire) : une
//              partie en mode triche donne un passeport marqué, et le livre suivant repart en mode triche.
//   Fin      : sections[n].passport === false empêche d'afficher le passeport sur cette victoire.
//   État     : state.campaign = { from: livre d'origine, code } quand la partie a commencé avec un passeport.
//
// Le code transporte des NOMBRES et des CASES COCHÉES, rangés dans l'ordre des listes de `fields`. Ces listes ne
// font que s'allonger d'un livre à l'autre (on ajoute à la fin, on ne retire ni ne réordonne) : le code porte la
// longueur de chaque liste, si bien qu'un passeport du livre 1 se lit encore avec les listes plus longues du livre 3.
import { registerNormalize } from '../../core/plugins.js';

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base 32 de Crockford : pas de I, L, O, U
const FORMAT = 1;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []);

/** Réglages de campagne de l'aventure, ou null. */
export const campaignOf = adv => (isObj(adv?.rules?.campaign) && adv.rules.campaign.id ? adv.rules.campaign : null);

/** Listes transportées par le passeport. */
export function fieldsOf(camp) {
  const f = isObj(camp?.fields) ? camp.fields : {};
  return { stats: arr(f.stats), counters: arr(f.counters), items: arr(f.items), flags: arr(f.flags), companions: arr(f.companions), gold: f.gold !== false };
}

/* ---------- bits ---------- */

function writer() {
  const bits = [];
  return {
    bits,
    put(v, n) { v = Math.max(0, Math.min(2 ** n - 1, Math.floor(Number(v) || 0))); for (let i = n - 1; i >= 0; i--) bits.push(Math.floor(v / 2 ** i) % 2); },
  };
}

function reader(bits) {
  let p = 0;
  return {
    get(n) { if (p + n > bits.length) throw new Error('court'); let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bits[p++]; return v; },
    get pos() { return p; },
  };
}

/** Empreinte sur n bits (FNV-1a 32 bits, repliée). */
function hash(str, n) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return ((h ^ (h >>> n)) >>> 0) % 2 ** n;
}

const HASH_BITS = 8;     // campagne
const CHECK_BITS = 15;   // somme de contrôle

/* ---------- passeport ---------- */

/** Drapeau qui transporte le mode triche d'un livre à l'autre, ou null. */
export const cheatFlagOf = camp => (camp && typeof camp.cheatFlag === 'string' && arr(camp.fields?.flags).includes(camp.cheatFlag) ? camp.cheatFlag : null);
/** Ce passeport vient-il d'une partie en mode triche ? */
export const isCheatPassport = (pass, camp) => { const f = cheatFlagOf(camp); return !!f && (pass?.flags || []).includes(f); };

/** Ce que l'état de la partie transporte vers le livre suivant. */
export function passportOf(state, adv) {
  const camp = campaignOf(adv);
  const f = fieldsOf(camp);
  const cheat = cheatFlagOf(camp);
  const modes = arr(camp?.modes);
  const has = id => (state.inventory?.[id] || 0) > 0;
  return {
    book: Number(camp?.book) || 0,
    mode: state.mode && modes.includes(state.mode) ? state.mode : null,
    stats: Object.fromEntries(f.stats.map(id => [id, state.stats?.[id]?.init ?? 0])),
    gold: f.gold ? Number(state.gold) || 0 : 0,
    counters: Object.fromEntries(f.counters.map(id => [id, Number(state.counters?.[id]) || 0])),
    items: f.items.filter(has),
    flags: f.flags.filter(id => !!state.flags?.[id] || (id === cheat && !!state.cheat)),
    companions: f.companions.filter(id => (state.companions || []).some(c => c.id === id)),
  };
}

/** Code lisible : « LB2-7KQ2-H9TF-… ». */
export function encodePassport(camp, pass) {
  const f = fieldsOf(camp);
  const modes = arr(camp.modes);
  const w = writer();
  w.put(FORMAT, 3);
  w.put(pass.book, 5);
  const mi = pass.mode ? modes.indexOf(pass.mode) : -1;
  w.put(mi < 0 ? 15 : mi, 4);
  w.put(f.stats.length, 4); w.put(f.counters.length, 4); w.put(f.items.length, 8); w.put(f.flags.length, 8); w.put(f.companions.length, 6);
  w.put(f.gold ? 1 : 0, 1);
  for (const id of f.stats) w.put(pass.stats?.[id], 7);
  if (f.gold) w.put(pass.gold, 10);
  for (const id of f.counters) w.put(pass.counters?.[id], 8);
  const set = list => new Set(list || []);
  const items = set(pass.items), flags = set(pass.flags), comps = set(pass.companions);
  for (const id of f.items) w.put(items.has(id) ? 1 : 0, 1);
  for (const id of f.flags) w.put(flags.has(id) ? 1 : 0, 1);
  for (const id of f.companions) w.put(comps.has(id) ? 1 : 0, 1);
  w.put(hash(camp.id, HASH_BITS), HASH_BITS);
  w.put(hash(w.bits.join(''), CHECK_BITS), CHECK_BITS);
  while (w.bits.length % 5) w.bits.push(0);
  let body = '';
  for (let i = 0; i < w.bits.length; i += 5) body += ALPHABET[parseInt(w.bits.slice(i, i + 5).join(''), 2)];
  const groups = body.match(/.{1,4}/g).join('-');
  const prefix = String(camp.prefix || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  return `${prefix}${pass.book}-${groups}`;
}

const tidy = s => s.replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');

/**
 * Lectures possibles d'une saisie (majuscules, sans espaces ni tirets, O→0, I et L→1, U→V), sans le préfixe « LB2 » :
 * séparé du reste (« LB2-… », « LB2 … ») ou collé (« LB27KQ2… » : livre sur un ou deux chiffres, on essaie les deux).
 */
export function cleanCodes(code, camp) {
  const s = String(code || '').toUpperCase().trim();
  const prefix = String(camp?.prefix || '').toUpperCase().replace(/[^A-Z]/g, '');
  const m = s.match(/^([A-Z]{0,4})(\d{1,2})[\s-]+/);
  if (m && (!prefix || m[1] === prefix || m[1] === '')) return [tidy(s.slice(m[0].length))];
  const flat = s.replace(/[\s-]/g, '');
  if (prefix && flat.startsWith(prefix)) {
    const rest = flat.slice(prefix.length);
    return [tidy(rest.slice(1)), tidy(rest.slice(2))];
  }
  return [tidy(flat)];
}

/** Première lecture (compatibilité). */
export const cleanCode = (code, camp) => cleanCodes(code, camp)[0];

/**
 * Lit un code avec les listes de CETTE aventure. Renvoie { ok: true, pass } ou { ok: false, error } (message pour le joueur).
 * Les listes du code peuvent être plus courtes que celles de l'aventure (passeport d'un livre plus ancien) : les cases
 * manquantes valent « non ». Plus longues : refusé (passeport d'un livre plus récent que cette version).
 */
export function decodePassport(camp, code) {
  const tries = cleanCodes(code, camp).map(s => decodeBody(camp, s));
  return tries.find(t => t.ok) || tries[0];
}

function decodeBody(camp, s) {
  if (!s) return { ok: false, error: 'Le code est vide.' };
  if ([...s].some(ch => !ALPHABET.includes(ch))) return { ok: false, error: 'Ce code contient un caractère inconnu.' };
  const bits = [];
  for (const ch of s) { const v = ALPHABET.indexOf(ch); for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1); }
  const f = fieldsOf(camp);
  const modes = arr(camp.modes);
  try {
    const r = reader(bits);
    if (r.get(3) !== FORMAT) return { ok: false, error: 'Ce passeport vient d’une autre version du jeu.' };
    const book = r.get(5);
    const mi = r.get(4);
    const n = { stats: r.get(4), counters: r.get(4), items: r.get(8), flags: r.get(8), companions: r.get(6) };
    const hasGold = r.get(1) === 1;
    for (const k of Object.keys(n)) if (n[k] > f[k].length) return { ok: false, error: 'Ce passeport vient d’un livre plus récent : mets l’application à jour.' };
    const stats = {}; for (const id of f.stats.slice(0, n.stats)) stats[id] = r.get(7);
    const gold = hasGold ? r.get(10) : 0;
    const counters = {}; for (const id of f.counters.slice(0, n.counters)) counters[id] = r.get(8);
    const pick = (list, k) => list.slice(0, n[k]).filter(() => r.get(1) === 1);
    const items = pick(f.items, 'items'), flags = pick(f.flags, 'flags'), companions = pick(f.companions, 'companions');
    const campHash = r.get(HASH_BITS);
    const payload = bits.slice(0, r.pos).join('');
    const check = r.get(CHECK_BITS);
    if (bits.slice(r.pos).some(b => b)) return { ok: false, error: 'Ce code est trop long : vérifie-le.' };
    if (check !== hash(payload, CHECK_BITS)) return { ok: false, error: 'Ce code ne marche pas : vérifie chaque caractère.' };
    if (campHash !== hash(camp.id, HASH_BITS)) return { ok: false, error: 'Ce passeport vient d’une autre série d’aventures.' };
    return { ok: true, pass: { book, mode: mi < modes.length ? modes[mi] : null, stats, gold, counters, items, flags, companions } };
  } catch {
    return { ok: false, error: 'Ce code est incomplet : il manque des caractères.' };
  }
}

/** Applique un passeport au héros qui commence (modifie `state`). */
export function applyPassport(state, adv, pass, code = '') {
  for (const [id, v] of Object.entries(pass.stats || {})) {
    if (state.stats?.[id] && v > 0) state.stats[id] = { cur: v, init: v };
  }
  if (fieldsOf(campaignOf(adv)).gold) state.gold = Number(pass.gold) || 0;
  if (Object.keys(pass.counters || {}).length) {
    state.counters = { ...(state.counters || {}) };
    for (const [id, v] of Object.entries(pass.counters)) if (id in state.counters) state.counters[id] = v;
  }
  state.inventory = { ...(state.inventory || {}) };
  for (const id of pass.items || []) state.inventory[id] = Math.max(1, state.inventory[id] || 0);
  state.flags = { ...(state.flags || {}) };
  for (const id of pass.flags || []) state.flags[id] = true;
  const defs = isObj(adv.companions) ? adv.companions : {};
  const present = new Set((state.companions || []).map(c => c.id));
  for (const id of pass.companions || []) {
    if (!defs[id] || present.has(id)) continue;
    const hp = Number(defs[id].health) || 1;
    state.companions = [...(state.companions || []), { id, health: hp, max: hp }];
  }
  state.campaign = { from: pass.book, code };
  // Un passeport de triche fait repartir la partie en mode triche : on ne blanchit pas une partie trichée.
  if (isCheatPassport(pass, campaignOf(adv))) state.cheat = { turn: 0, unlocked: false, passport: true };
  return state;
}

/** Équipement du « nouveau voyageur » (partie commencée sans passeport). */
export function applyNewcomer(state, adv) {
  const nc = campaignOf(adv)?.newcomer;
  if (!isObj(nc)) return state;
  if (nc.gold != null) state.gold = Number(nc.gold) || 0;
  state.inventory = { ...(state.inventory || {}) };
  for (const id of arr(nc.items)) state.inventory[id] = Math.max(1, state.inventory[id] || 0);
  state.flags = { ...(state.flags || {}) };
  for (const id of arr(nc.flags)) state.flags[id] = true;
  if (isObj(nc.counters) && state.counters) for (const [id, v] of Object.entries(nc.counters)) if (id in state.counters) state.counters[id] = Number(v) || 0;
  return state;
}

/** Le passeport s'affiche-t-il à cette fin ? */
export const showsPassport = (state, adv) =>
  !!campaignOf(adv) && state.ended === 'victory' && adv.sections?.[state.section]?.passport !== false;

/** Résumé lisible d'un passeport (bibliothèque, création du héros). */
export function describe(pass, adv) {
  const parts = [`livre ${pass.book}`];
  if (pass.gold) parts.push(`${pass.gold} pièce${pass.gold > 1 ? 's' : ''} d’or`);
  const items = (pass.items || []).length;
  if (items) parts.push(`${items} objet${items > 1 ? 's' : ''}`);
  const comps = (pass.companions || []).map(id => adv?.companions?.[id]?.name || id);
  if (comps.length) parts.push(`avec ${comps.join(', ')}`);
  if (isCheatPassport(pass, campaignOf(adv))) parts.push('🃏 mode triche');
  return parts.join(' · ');
}

registerNormalize(a => {
  const c = a.rules?.campaign;
  if (c !== undefined && !isObj(c)) delete a.rules.campaign;
});
