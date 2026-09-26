// Greffon « compteurs » — moteur pur (aucun DOM, testable dans Node).
// Compteurs libres définis par l'auteur : Réputation, Temps, Malédiction, Savoir…
//   Règles : adv.rules.counters = [{ id, label, start, min?, max?, visible, icon?, triggers: [{ when, value, action, message }] }]
//   État   : state.counters = { id: valeur }
//   Effet  : { op: 'counter', counter: id, add?: n | 'formule de dés', set?: n }
//   Condition : { counter: id, gte?, lte?, eq? }
// Voir docs/plugins/compteurs.md.

import { registerEffect, registerCondition, registerHeroInit, registerNormalize, registerEnterHook } from '../../core/plugins.js';
import { makeRng, roll, isDice, range, parseDice } from '../../core/dice.js';

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const has = v => v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v));
const num = v => (has(v) ? Number(v) : null);
const isInt = v => typeof v === 'number' ? Number.isFinite(v) : /^\s*[+-]?\d+\s*$/.test(String(v ?? ''));
const plural = (n, one, many) => `${n} ${Math.abs(n) > 1 ? many : one}`;

/** Liste des compteurs d'une aventure (jamais undefined). */
export const countersOf = adv => (Array.isArray(adv?.rules?.counters) ? adv.rules.counters : []);
export const counterDef = (adv, id) => countersOf(adv).find(c => c.id === id) || null;
export const counterLabel = (adv, id) => counterDef(adv, id)?.label || id;
export const isVisible = c => c?.visible !== false;

/** « de Réputation », « d'Honneur » : élision devant une voyelle ou un h muet courant. */
export function de(label) {
  const l = String(label || '');
  return /^([aeiouàâäéèêëîïôöùûü]|h(onneur|éro(?!s)|umani|abilet|armoni|istoir|ospital|umilit|orreur|ygi|abitu|erb))/iu.test(l) ? `d'${l}` : `de ${l}`;
}

/** Ramène une valeur entre les bornes du compteur (bornes absentes = pas de limite). */
export function clamp(c, v) {
  let x = Number(v) || 0;
  const min = num(c?.min), max = num(c?.max);
  if (max !== null && x > max) x = max;
  if (min !== null && x < min) x = min;
  return x;
}

/** Valeur de départ lisible : nombre fixe, ou formule de dés valide. */
export const startIsFixed = c => isInt(c?.start ?? 0);
export const startIsValid = c => startIsFixed(c) || isDice(String(c.start));

/** Tire la valeur de départ d'un compteur (dés via le générateur de la partie). */
export function rollStart(c, rng) {
  const s = c?.start ?? 0;
  if (startIsFixed(c)) return clamp(c, Number(s));
  if (isDice(String(s))) return clamp(c, roll(String(s), rng).total);
  return clamp(c, 0);
}

/** Valeur de repli sans dés (ancienne sauvegarde lue par une condition) : départ fixe, sinon minimum de la formule. */
function fallback(c) {
  if (startIsFixed(c)) return clamp(c, Number(c.start ?? 0));
  try { return clamp(c, range(String(c.start)).min); } catch { return clamp(c, 0); }
}

/** Valeur actuelle d'un compteur dans un état (sans le modifier). */
export function counterValue(state, adv, id) {
  const v = state?.counters?.[id];
  if (typeof v === 'number') return v;
  const c = counterDef(adv, id);
  return c ? fallback(c) : 0;
}

/**
 * Crée les compteurs manquants dans `s` (état déjà cloné) : nouvelle partie,
 * ancienne sauvegarde, ou compteur ajouté par l'auteur après le début de la partie.
 */
export function ensureCounters(s, adv) {
  const list = countersOf(adv);
  if (!s.counters || typeof s.counters !== 'object') s.counters = {};
  const missing = list.filter(c => c.id && typeof s.counters[c.id] !== 'number');
  if (!missing.length) return s;
  const rng = makeRng(s.rng);
  for (const c of missing) s.counters[c.id] = rollStart(c, rng);
  s.rng = rng.state();
  return s;
}

/* ------------------------------------------------------------------ */
/* Déclencheurs                                                        */
/* ------------------------------------------------------------------ */

const holds = (t, v) => (t.when === 'lte' ? v <= Number(t.value) : v >= Number(t.value));

/** Déclencheurs franchis en passant de `before` à `after` (condition fausse avant, vraie après). */
export function crossedTriggers(c, before, after) {
  return (c?.triggers || []).filter(t => has(t.value) && !holds(t, before) && holds(t, after));
}

/** Applique les déclencheurs franchis : message, mort ou victoire. Modifie `s` (déjà cloné). */
function fire(s, c, before, after, messages) {
  for (const t of crossedTriggers(c, before, after)) {
    const text = String(t.message || '').trim();
    if (t.action === 'death' || t.action === 'victory') {
      if (s.ended) continue;
      s.ended = t.action;
      s.endReason = text || `Votre ${c.label || c.id} a atteint ${after}.`;
    } else {
      messages.push({ kind: 'info', text: text || `Votre ${c.label || c.id} atteint ${after}.` });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Effet { op: 'counter' }                                             */
/* ------------------------------------------------------------------ */

/** Quantité d'un effet : nombre, ou formule de dés (« 1d6 », « -1d6 »). Renvoie null si invalide. */
export function parseAmount(add) {
  if (!has(add) && typeof add !== 'string') return null;
  if (typeof add === 'number') return Number.isFinite(add) ? { fixed: add } : null;
  const s = String(add).replace(/\s+/g, '');
  if (!s) return null;
  if (/^[+-]?\d+$/.test(s)) return { fixed: Number(s) };
  const neg = s.startsWith('-');
  const expr = s.replace(/^[+-]/, '');
  return isDice(expr) ? { dice: expr, sign: neg ? -1 : 1 } : null;
}

function applyCounter(s, e, adv, messages) {
  const c = counterDef(adv, e.counter);
  if (!c) return;
  ensureCounters(s, adv);
  const before = s.counters[c.id];
  let v = before;
  if (has(e.set)) v = Number(e.set);
  const amt = parseAmount(e.add);
  let rolled = null;
  if (amt?.dice) {
    const rng = makeRng(s.rng);
    rolled = roll(amt.dice, rng);
    s.rng = rng.state();
    v += amt.sign * rolled.total;
  } else if (amt) v += amt.fixed;
  v = clamp(c, v);
  s.counters[c.id] = v;
  const d = v - before;
  if (d && isVisible(c)) {
    const dice = rolled ? `${amt.dice} = ${rolled.total}, ` : '';
    messages.push({ kind: d < 0 ? 'loss' : 'gain', text: `${d > 0 ? '+' : ''}${d} ${c.label || c.id} (${dice}total : ${v})` });
  }
  if (d) fire(s, c, before, v, messages);
}

/** Texte court (éditeur, infobulles). */
export function describeCounterEffect(e, adv) {
  const label = counterLabel(adv, e.counter);
  const parts = [];
  if (has(e.set)) parts.push(`${label} = ${e.set}`);
  const amt = parseAmount(e.add);
  if (amt?.dice) parts.push(`${amt.sign < 0 ? '−' : '+'}${amt.dice} ${label}`);
  else if (amt && amt.fixed) parts.push(`${amt.fixed > 0 ? '+' : ''}${amt.fixed} ${label}`);
  return parts.join(', puis ') || `${label} inchangé`;
}

/** « un dé », « deux dés et ajoutez 3 »… */
export function diceWords(expr) {
  const { count, sides, mod } = parseDice(expr);
  const n = count === 1 ? 'un dé' : count === 2 ? 'deux dés' : `${count} dés`;
  const faces = sides !== 6 ? ` à ${sides} faces` : '';
  const m = mod ? ` et ${mod > 0 ? 'ajoutez' : 'retirez'} ${Math.abs(mod)}` : '';
  return n + faces + m;
}

/** Phrase de livre imprimé (« ajoutez 1 point de Réputation sur votre Feuille d'Aventure. »). */
export function printCounterEffect(e, adv) {
  const c = counterDef(adv, e.counter);
  const label = c?.label || e.counter;
  const where = c && !isVisible(c) ? ' dans la case Autres compteurs de votre Feuille d\'Aventure' : ' sur votre Feuille d\'Aventure';
  const min = num(c?.min), max = num(c?.max);
  const parts = [];
  if (has(e.set)) parts.push(`votre ${label} passe à ${e.set} (notez-le${where})`);
  const amt = parseAmount(e.add);
  if (amt?.dice) {
    const up = amt.sign > 0;
    const total = /et (ajoutez|retirez)/.test(diceWords(amt.dice)) ? 'ce total' : 'le résultat';
    parts.push(`lancez ${diceWords(amt.dice)} : ${up ? 'ajoutez' : 'retirez'} ${total} ${up ? 'à' : 'de'} votre total ${de(label)}${where}${up && max !== null ? `, sans dépasser ${max}` : !up && min !== null ? `, sans descendre sous ${min}` : ''}`);
  } else if (amt && amt.fixed) {
    const up = amt.fixed > 0;
    parts.push(`${up ? 'ajoutez' : 'retirez'} ${plural(Math.abs(amt.fixed), 'point', 'points')} ${de(label)}${where}${up && max !== null ? `, sans dépasser ${max}` : !up && min !== null ? `, sans descendre sous ${min}` : ''}`);
  }
  return parts.length ? parts.join(', puis ') + '.' : '';
}

/* ------------------------------------------------------------------ */
/* Condition { counter, gte|lte|eq }                                   */
/* ------------------------------------------------------------------ */

export const isCounterCond = c => !!c && typeof c === 'object' && 'counter' in c && !('op' in c);

export function checkCounter(c, state, adv) {
  const v = counterValue(state, adv, c.counter);
  if (has(c.gte) && !(v >= Number(c.gte))) return false;
  if (has(c.lte) && !(v <= Number(c.lte))) return false;
  if (has(c.eq) && !(v === Number(c.eq))) return false;
  return true;
}

/** « avoir au moins 3 points de Réputation » (après « Il faut »). */
export function describeCounterCond(c, adv) {
  const lab = de(counterLabel(adv, c.counter));
  const pts = n => plural(Number(n), 'point', 'points');
  if (has(c.eq)) return `avoir exactement ${pts(c.eq)} ${lab}`;
  if (has(c.gte) && has(c.lte)) return `avoir entre ${c.gte} et ${pts(c.lte)} ${lab}`;
  if (has(c.gte)) return `avoir au moins ${pts(c.gte)} ${lab}`;
  if (has(c.lte)) return `avoir au plus ${pts(c.lte)} ${lab}`;
  return `avoir un compteur ${lab}`;
}

/** « votre Réputation est de 3 ou plus » (après « Si »). */
export function printCounterCond(c, adv) {
  const what = `votre ${counterLabel(adv, c.counter)}`;
  if (has(c.eq)) return `${what} est exactement de ${c.eq}`;
  if (has(c.gte) && has(c.lte)) return `${what} est entre ${c.gte} et ${c.lte}`;
  if (has(c.gte)) return `${what} est de ${c.gte} ou plus`;
  if (has(c.lte)) return `${what} est de ${c.lte} ou moins`;
  return what;
}

/* ------------------------------------------------------------------ */
/* Aide à l'auteur : problèmes, usages, renommage                      */
/* ------------------------------------------------------------------ */

/** Problèmes de définition des compteurs : [{ id, level: 'error'|'warning'|'info', message }]. */
export function counterProblems(adv) {
  const out = [];
  const list = countersOf(adv);
  const seen = new Map();
  list.forEach(c => seen.set(c.id, (seen.get(c.id) || 0) + 1));
  for (const c of list) {
    const name = c.label || c.id || 'sans nom';
    const push = (level, message) => out.push({ id: c.id, level, message });
    if (!c.id) push('error', `Le compteur « ${name} » n'a pas d'identifiant.`);
    else if (seen.get(c.id) > 1) push('error', `L'identifiant « ${c.id} » est utilisé par plusieurs compteurs.`);
    if (!String(c.label || '').trim()) push('warning', `Le compteur « ${c.id} » n'a pas de nom.`);
    const min = num(c.min), max = num(c.max);
    if (min !== null && max !== null && min > max) push('error', `${name} : le minimum (${min}) est plus grand que le maximum (${max}).`);
    let lo = null, hi = null;
    if (!startIsValid(c)) push('error', `${name} : départ invalide « ${c.start} » (un nombre ou une formule comme 2d6+3).`);
    else if (startIsFixed(c)) { lo = hi = Number(c.start ?? 0); }
    else { const r = range(String(c.start)); lo = r.min; hi = r.max; }
    if (lo !== null && ((min !== null && lo < min) || (max !== null && hi > max))) push('info', `${name} : la valeur de départ sera ramenée entre les bornes.`);
    if (lo !== null) { lo = clamp(c, lo); hi = clamp(c, hi); }
    (c.triggers || []).forEach((t, i) => {
      const where = `${name}, déclencheur ${i + 1}`;
      if (!has(t.value)) { push('error', `${where} : valeur manquante.`); return; }
      const v = Number(t.value);
      if (t.when === 'lte' && min !== null && v < min) push('warning', `${where} : ≤ ${v} n'arrivera jamais (minimum ${min}).`);
      if (t.when !== 'lte' && max !== null && v > max) push('warning', `${where} : ≥ ${v} n'arrivera jamais (maximum ${max}).`);
      if (lo !== null) {
        const always = holds(t, lo) && holds(t, hi);
        const maybe = holds(t, lo) || holds(t, hi);
        if (always) push('warning', `${where} : la condition est déjà vraie au départ ; il ne se déclenchera qu'après être repassé de l'autre côté.`);
        else if (maybe) push('info', `${where} : selon les dés, la condition peut être vraie dès le départ.`);
      }
      if ((t.action || 'message') === 'message' && !String(t.message || '').trim()) push('warning', `${where} : message vide (un texte par défaut sera affiché).`);
    });
  }
  return out;
}

/** Parcourt un objet et appelle `fn(o)` sur chaque objet imbriqué. */
function walk(o, fn) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(x => walk(x, fn)); return; }
  fn(o);
  for (const k of Object.keys(o)) walk(o[k], fn);
}
const refersTo = (o, id) => o.counter === id && (o.op === 'counter' || !('op' in o));

/** Où un compteur est utilisé : [{ kind: 'section'|'item', id, label }]. */
export function counterUsage(adv, id) {
  const out = [];
  for (const [sid, sec] of Object.entries(adv.sections || {})) {
    let found = false;
    walk(sec, o => { if (refersTo(o, id)) found = true; });
    if (found) out.push({ kind: 'section', id: sid, label: `paragraphe ${sid}` });
  }
  for (const [iid, it] of Object.entries(adv.items || {})) {
    let found = false;
    walk(it, o => { if (refersTo(o, id)) found = true; });
    if (found) out.push({ kind: 'item', id: iid, label: `objet ${it.name || iid}` });
  }
  return out;
}

/** Renomme l'identifiant d'un compteur et met à jour tous les effets et conditions. Renvoie une nouvelle aventure. */
export function renameCounter(adv, from, to) {
  to = String(to || '').trim();
  if (!to) throw new Error('Identifiant vide.');
  if (from === to) return structuredClone(adv);
  if (countersOf(adv).some(c => c.id === to)) throw new Error(`Le compteur « ${to} » existe déjà.`);
  const a = structuredClone(adv);
  a.rules.counters = countersOf(a).map(c => (c.id === from ? { ...c, id: to } : c));
  const fix = o => { if (refersTo(o, from)) o.counter = to; };
  walk(a.sections, fix);
  walk(a.items, fix);
  return a;
}

/** Identifiant libre dérivé d'un nom (« Réputation » → « reputation », puis « reputation-2 »…). */
export function freeId(adv, label = 'compteur') {
  const base = String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'compteur';
  const ids = new Set(countersOf(adv).map(c => c.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/* ------------------------------------------------------------------ */
/* Enregistrement dans le moteur                                       */
/* ------------------------------------------------------------------ */

registerNormalize(adv => {
  const list = Array.isArray(adv.rules.counters) ? adv.rules.counters : [];
  adv.rules.counters = list.filter(c => c && typeof c === 'object').map(c => ({
    ...c,
    start: c.start ?? 0,
    visible: c.visible !== false,
    triggers: Array.isArray(c.triggers) ? c.triggers : [],
  }));
});

registerHeroInit((state, adv, cls, rng) => {
  state.counters = {};
  for (const c of countersOf(adv)) if (c.id) state.counters[c.id] = rollStart(c, rng);
});

// Ancienne sauvegarde ou compteur ajouté en cours de partie : on le crée en entrant dans un paragraphe.
registerEnterHook((s, adv) => { ensureCounters(s, adv); });

registerEffect('counter', {
  apply: applyCounter,
  describe: describeCounterEffect,
  print: printCounterEffect,
  validate(e, adv, report, where) {
    if (!e.counter) { report('error', `${where} : aucun compteur choisi.`); return; }
    const c = counterDef(adv, e.counter);
    if (!c) report('error', `${where} : compteur inconnu « ${e.counter} ».`);
    if (!has(e.set) && (e.add === undefined || e.add === null || e.add === '')) report('warning', `${where} : l'effet sur le compteur ne change rien.`);
    if (e.add !== undefined && e.add !== null && e.add !== '' && !parseAmount(e.add)) report('error', `${where} : quantité invalide « ${e.add} » (un nombre ou une formule comme 1d6).`);
  },
});

registerCondition({
  id: 'counter',
  match: isCounterCond,
  check: checkCounter,
  describe: describeCounterCond,
  print: printCounterCond,
  validate(c, adv, report, where) {
    if (!counterDef(adv, c.counter)) report('error', `${where} : compteur inconnu « ${c.counter} ».`);
    if (!has(c.gte) && !has(c.lte) && !has(c.eq)) report('warning', `${where} : la condition sur ${counterLabel(adv, c.counter)} n'a pas de valeur.`);
  },
});
