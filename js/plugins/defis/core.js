// Greffon « défis » — moteur pur (aucun accès au DOM, testable dans Node).
// Énigmes et exercices intégrés au livre : réponse écrite, nombre, QCM, cases à cocher, remise en ordre.
// Une bonne réponse mène au paragraphe de réussite, des essais épuisés (ou un abandon) à celui d'échec.
//
// Bloc « challenge » :
//   { type: 'challenge', kind: 'text'|'number'|'qcm'|'multi'|'order', title, question (Markdown), image?,
//     answers, attempts (0 = illimité), hints: [{ text, cost: [effets] }], success, failure, allowGiveUp,
//     successEffects: [], failureEffects: [], explanation (Markdown), hashed, salt?, ignoreSpaces?, unit?, revealAnswer? }
//   answers — text : ['réponse', …] ; number : { value, tolerance } ; qcm / multi : [{ text, correct }] ;
//             order : ['premier', 'deuxième', …] (dans le bon ordre) ; chiffré (text / number) : ['<sha256 hex>', …]
//
// État pendant la visite du paragraphe : state.blocks[index] = { tries, hints: [], solved, failed, order, wrong, last, gaveUp }.
// Bilan de la partie : state.defis.done['<paragraphe>#<index>'] = { ok, tries, hints }.
// Voir docs/plugins/defis.md.

import { registerBlock, registerEnterHook, registerHeroInit } from '../../core/plugins.js';
import { applyEffects, check, itemName, statLabel, de } from '../../core/rules.js';
import { makeRng } from '../../core/dice.js';
import { checkEffects } from '../../core/validate.js';

export const TYPE = 'challenge';
export const KINDS = ['text', 'number', 'qcm', 'multi', 'order'];
/** Types dont les réponses peuvent être chiffrées (un QCM se devinerait en essayant chaque option). */
export const HASHABLE = new Set(['text', 'number']);

export const kindOf = b => (KINDS.includes(b?.kind) ? b.kind : 'text');
export const isHashed = b => !!b?.hashed && HASHABLE.has(kindOf(b));
export const maxAttempts = b => Math.max(0, Math.floor(Number(b?.attempts) || 0));
/** Tutoiement des messages du joueur (règle `rules.defis.tu`) : say(adv, 'Essayez encore.', 'Essaie encore.'). */
export const tutoie = adv => !!adv?.rules?.defis?.tu;
export const say = (adv, vous, tu) => (tutoie(adv) ? tu : vous);
/** Libellé du bouton d'abandon (règle `rules.defis.giveUpLabel`), par défaut « Renoncer à ce défi ». */
export const giveUpLabel = adv => String(adv?.rules?.defis?.giveUpLabel || '').trim() || 'Renoncer à ce défi';

export const letter = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');

/* ------------------------------------------------------------------ */
/* Normalisation des réponses                                          */
/* ------------------------------------------------------------------ */

/**
 * Texte comparable : sans casse ni accents, apostrophes et tirets typographiques unifiés,
 * espaces multiples réduites, ponctuation finale retirée. `ignoreSpaces` retire toutes les espaces (« 2x + 3 » = « 2x+3 »).
 */
export function normalizeText(s, { ignoreSpaces = false } = {}) {
  let t = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ').trim()
    .replace(/[\s.!?…;:,]+$/u, '').trim();
  if (ignoreSpaces) t = t.replace(/ /g, '');
  return t;
}

/** « 3,5 », « 3.5 », « 1 000 », « −2 », « +4 » → nombre ; tout le reste → NaN. */
export function parseNumber(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : NaN;
  let t = String(s ?? '').replace(/\s+/g, '').replace(/[−‒–]/g, '-').replace(/^\+/, '');
  if (/^-?\d*,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

/** Écriture canonique d'un nombre (celle qui est chiffrée) : 3,50 → « 3.5 ». */
export const canonNumber = n => (Object.is(n, -0) ? '0' : String(n));
/** Écriture française d'un nombre : 3.5 → « 3,5 ». */
export const frNumber = n => canonNumber(n).replace('.', ',');

const textOpts = b => ({ ignoreSpaces: !!b?.ignoreSpaces });

/** Nombre saisi par le joueur (l'unité du défi, s'il la retape, est ignorée). */
export function numberInput(b, input) {
  let t = String(input ?? '').trim();
  const u = String(b?.unit || '').trim();
  if (u && t.toLowerCase().endsWith(u.toLowerCase())) t = t.slice(0, -u.length);
  return parseNumber(t);
}

/* ---------- lecture tolérante des réponses (fichiers écrits à la main) ---------- */
export const textAnswers = b => (Array.isArray(b?.answers) ? b.answers : typeof b?.answers === 'string' ? [b.answers] : []).map(x => String(x ?? ''));
export function numberAnswers(b) {
  const a = b?.answers;
  const list = Array.isArray(a) ? a : a && typeof a === 'object' ? [a] : [];
  return list.filter(x => x && typeof x === 'object')
    .map(x => ({ value: parseNumber(x.value), tolerance: Math.abs(parseNumber(x.tolerance ?? 0)) || 0 }))
    .filter(x => Number.isFinite(x.value));
}
export const options = b => (Array.isArray(b?.answers) ? b.answers : []).map(o => (typeof o === 'string' ? { text: o, correct: false } : { text: String(o?.text ?? ''), correct: !!o?.correct }));
export const orderItems = b => (Array.isArray(b?.answers) ? b.answers : []).map(x => (typeof x === 'string' ? x : String(x?.text ?? '')));
export const hashList = b => (Array.isArray(b?.answers) ? b.answers : typeof b?.answers === 'string' ? [b.answers] : []).filter(x => typeof x === 'string').map(x => x.trim().toLowerCase());

/* ------------------------------------------------------------------ */
/* Empreintes SHA-256                                                   */
/* ------------------------------------------------------------------ */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const ror = (x, n) => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 en JavaScript pur : secours quand crypto.subtle est absent
 * (page servie en http:// sur le réseau local, fichier ouvert directement…).
 */
export function sha256Sync(str) {
  const bytes = new TextEncoder().encode(String(str));
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000));
  dv.setUint32(total - 4, (len << 3) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (W[i - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + W[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
}

/** SHA-256 (hexadécimal) avec crypto.subtle (navigateur, Node 24), ou le calcul en JavaScript pur à défaut. */
export async function sha256Hex(str) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Sync(str);
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Sel du chiffrement : l'identifiant de l'aventure au moment du chiffrement (conservé si l'aventure est copiée). */
export const saltOf = (b, adv) => String(b?.salt || adv?.id || '');
/** Empreinte d'une réponse déjà normalisée : SHA-256 de « identifiant + ':' + réponse ». */
export const hashAnswer = (salt, normalized) => sha256Hex(`${salt}:${normalized}`);

/** Réponse normalisée telle qu'elle est chiffrée (ou null si elle est vide / illisible). */
export function normalizedFor(b, input) {
  if (kindOf(b) === 'number') { const n = numberInput(b, input); return Number.isFinite(n) ? canonNumber(n) : null; }
  return normalizeText(input, textOpts(b)) || null;
}

/** Empreinte d'une nouvelle réponse saisie par l'auteur (null si vide ou illisible). */
export async function hashOne(b, adv, raw) {
  const n = normalizedFor(b, raw);
  return n === null ? null : hashAnswer(saltOf(b, adv), n);
}

/** Empreintes de toutes les réponses en clair d'un défi (pour la case « Chiffrer les réponses »). */
export async function hashAnswers(b, adv) {
  const kind = kindOf(b);
  if (!HASHABLE.has(kind)) throw new Error('Seules les réponses écrites ou numériques peuvent être chiffrées.');
  let norms;
  if (kind === 'number') {
    const list = numberAnswers(b);
    if (list.some(x => x.tolerance)) throw new Error('Une réponse avec tolérance ne peut pas être chiffrée : seule une valeur exacte peut l’être.');
    norms = list.map(x => canonNumber(x.value));
  } else norms = textAnswers(b).map(a => normalizeText(a, textOpts(b))).filter(Boolean);
  const salt = saltOf({}, adv);
  return [...new Set(await Promise.all([...new Set(norms)].map(n => hashAnswer(salt, n))))];
}

/* ------------------------------------------------------------------ */
/* Vérification d'une réponse                                          */
/* ------------------------------------------------------------------ */

/**
 * Vrai si `input` est une bonne réponse. Réponses en clair : résultat immédiat (booléen).
 * Réponses chiffrées : renvoie une promesse (utilisez checkAnswerAsync pour ne pas avoir à distinguer).
 * input — text / number : la saisie ; qcm : l'indice choisi ; multi : les indices cochés ; order : les indices d'origine dans l'ordre proposé.
 */
export function checkAnswer(b, input, adv) {
  if (isHashed(b)) return checkAnswerAsync(b, input, adv);
  switch (kindOf(b)) {
    case 'text': {
      const n = normalizeText(input, textOpts(b));
      return !!n && textAnswers(b).some(a => normalizeText(a, textOpts(b)) === n);
    }
    case 'number': {
      const x = numberInput(b, input);
      return Number.isFinite(x) && numberAnswers(b).some(({ value, tolerance }) => Math.abs(x - value) <= tolerance + 1e-9 * Math.max(1, Math.abs(value)));
    }
    case 'qcm': {
      const i = Number(input);
      return input !== null && input !== '' && Number.isInteger(i) && !!options(b)[i]?.correct;
    }
    case 'multi': {
      const opts = options(b);
      const sel = new Set((Array.isArray(input) ? input : []).map(Number));
      return sel.size > 0 && [...sel].every(i => Number.isInteger(i) && i >= 0 && i < opts.length) && opts.every((o, i) => sel.has(i) === o.correct);
    }
    case 'order': {
      const items = orderItems(b);
      const arr = Array.isArray(input) ? input.map(Number) : [];
      if (arr.length !== items.length || new Set(arr).size !== arr.length || arr.some(k => !(k >= 0 && k < items.length))) return false;
      return arr.every((k, pos) => normalizeText(items[k]) === normalizeText(items[pos]));
    }
  }
  return false;
}

/** Version toujours asynchrone de checkAnswer (réponses chiffrées ou non). */
export async function checkAnswerAsync(b, input, adv) {
  if (!isHashed(b)) return checkAnswer(b, input, adv);
  const n = normalizedFor(b, input);
  if (n === null) return false;
  return hashList(b).includes(await hashAnswer(saltOf(b, adv), n));
}

/** Raison pour laquelle une saisie n'est pas recevable (aucun essai n'est alors consommé), ou null. */
export function inputProblem(b, input, adv) {
  const kind = kindOf(b);
  if (kind === 'text') return normalizeText(input, textOpts(b)) ? null : say(adv, 'Écrivez d’abord votre réponse.', 'Écris d’abord ta réponse.');
  if (kind === 'number') {
    if (!String(input ?? '').trim()) return say(adv, 'Écrivez d’abord un nombre.', 'Écris d’abord un nombre.');
    return Number.isFinite(numberInput(b, input)) ? null : say(adv, 'Écrivez seulement un nombre (par exemple 3,5 ou −2).', 'Écris seulement un nombre (par exemple 3,5 ou −2).');
  }
  if (kind === 'qcm') return input !== null && input !== undefined && input !== '' && Number.isInteger(Number(input)) && Number(input) >= 0 && Number(input) < options(b).length ? null : say(adv, 'Choisissez d’abord une réponse.', 'Choisis d’abord une réponse.');
  if (kind === 'multi') return Array.isArray(input) && input.length ? null : say(adv, 'Cochez d’abord au moins une case.', 'Coche d’abord au moins une case.');
  const n = orderItems(b).length;
  const arr = Array.isArray(input) ? input.map(Number) : [];
  return arr.length === n && new Set(arr).size === n ? null : 'L’ordre proposé est incomplet.';
}

/** Clé d'une réponse, pour repérer une réponse fausse déjà proposée. */
export function answerKey(b, input) {
  const kind = kindOf(b);
  if (kind === 'text') return normalizeText(input, textOpts(b));
  if (kind === 'number') return canonNumber(numberInput(b, input));
  if (kind === 'multi') return [...new Set((input || []).map(Number))].sort((x, y) => x - y).join(',');
  if (kind === 'order') return (input || []).map(Number).join(',');
  return String(Number(input));
}

/* ------------------------------------------------------------------ */
/* État d'un défi pendant la visite du paragraphe                      */
/* ------------------------------------------------------------------ */

/** Permutation mélangée de 0…n-1 (jamais déjà dans le bon ordre s'il y a au moins deux éléments différents). */
export function shuffledOrder(n, rng, items) {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const same = items ? p.every((k, pos) => normalizeText(items[k]) === normalizeText(items[pos])) : p.every((k, pos) => k === pos);
  if (n > 1 && same) p.push(p.shift());
  return p;
}

function freshState(b, rng) {
  const items = orderItems(b);
  return { tries: 0, hints: [], solved: false, failed: false, order: kindOf(b) === 'order' ? shuffledOrder(items.length, rng, items) : null, wrong: [], last: null };
}

const mix = (seed, i) => (Math.imul((Number(seed) >>> 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(i + 1, 0xc2b2ae35)) >>> 0;

export const blockAt = (state, adv, index) => {
  const b = adv?.sections?.[state?.section]?.blocks?.[index];
  return b?.type === TYPE ? b : null;
};

/**
 * État du défi n° `index` du paragraphe courant. Normalement créé à l'entrée du paragraphe (ordre mélangé avec la graine
 * de la partie) ; pour une partie plus ancienne, un état neuf est déduit de la graine sans la faire avancer.
 */
export function blockState(state, adv, index) {
  const cur = state?.blocks?.[index];
  if (cur && typeof cur === 'object' && 'tries' in cur) return { wrong: [], hints: [], last: null, ...cur };
  return freshState(blockAt(state, adv, index), makeRng(mix(state?.rng, index)));
}

export const isFinished = bs => !!(bs?.solved || bs?.failed);

/** Paragraphe où mène le défi une fois terminé (réussite / échec), ou null. */
export function exitOf(state, adv, index) {
  const b = blockAt(state, adv, index);
  const bs = blockState(state, adv, index);
  if (!b || !isFinished(bs)) return null;
  return (bs.solved ? b.success : b.failure) || null;
}

/** Retour à afficher d'après l'état : { tone: 'ok'|'ko'|'info', text } ou null. */
export function verdict(b, bs, adv) {
  if (!bs) return null;
  if (bs.solved) return { tone: 'ok', text: 'Bonne réponse !' };
  if (bs.gaveUp) return { tone: 'info', text: say(adv, 'Vous avez renoncé à ce défi.', 'Tu as passé ce défi.') };
  if (!bs.last) return null;
  const max = maxAttempts(b);
  if (bs.failed) return { tone: 'ko', text: say(adv, 'Ce n’est pas ça. Vous n’avez plus d’essai.', 'Ce n’est pas ça. Tu n’as plus d’essai.') };
  if (!max) return { tone: 'ko', text: say(adv, 'Ce n’est pas ça. Essayez encore.', 'Ce n’est pas ça. Essaie encore !') };
  const left = max - bs.tries;
  return { tone: 'ko', text: `Ce n’est pas ça. ${say(adv, 'Il vous reste', 'Il te reste')} ${left} essai${left > 1 ? 's' : ''}.` };
}

function record(s, index, nb) {
  const done = { ...(s.defis?.done || {}), [`${s.section}#${index}`]: { ok: !!nb.solved, tries: nb.tries, hints: nb.hints.length } };
  s.defis = { ...(s.defis || {}), done };
}

const noop = (state, text) => ({ state, messages: text ? [{ kind: 'info', text, verdict: true }] : [], correct: false, finished: false, counted: false, feedback: text || '' });

/**
 * Propose une réponse. Renvoie { state, messages, correct, finished, counted, feedback } :
 * - counted : un essai a été consommé (faux si la saisie est vide, illisible ou déjà proposée) ;
 * - messages : le verdict (marqué `verdict: true`) puis les effets de réussite ou d'échec.
 * `verdictOverride` (booléen) sert à submitAsync, qui vérifie d'abord une réponse chiffrée.
 */
export function submit(state, adv, index, input, verdictOverride) {
  const b = blockAt(state, adv, index);
  if (!b) return noop(state, '');
  const bs = blockState(state, adv, index);
  if (isFinished(bs)) return { ...noop(state, ''), correct: bs.solved, finished: true };
  const problem = inputProblem(b, input, adv);
  if (problem) return noop(state, problem);
  const key = answerKey(b, input);
  if (bs.wrong.includes(key)) return noop(state, say(adv, 'Vous avez déjà proposé cette réponse : essayez autre chose.', 'Tu as déjà proposé cette réponse : essaie autre chose.'));
  let correct = verdictOverride;
  if (typeof correct !== 'boolean') {
    const r = checkAnswer(b, input, adv);
    if (typeof r?.then === 'function') throw new Error('Réponses chiffrées : utilisez submitAsync().');
    correct = r;
  }
  let s = structuredClone(state);
  const nb = { ...structuredClone(bs), tries: bs.tries + 1, last: { correct, input: structuredClone(input) } };
  let fx = [];
  if (correct) { nb.solved = true; fx = b.successEffects || []; }
  else {
    nb.wrong = [...nb.wrong, key];
    const max = maxAttempts(b);
    if (max && nb.tries >= max) { nb.failed = true; fx = b.failureEffects || []; }
  }
  const r = applyEffects(s, adv, fx);
  s = r.state;
  s.blocks = { ...s.blocks, [index]: nb };
  const finished = isFinished(nb);
  if (finished) record(s, index, nb);
  const v = verdict(b, nb, adv);
  return { state: s, messages: [{ kind: correct ? 'gain' : 'loss', text: v.text, verdict: true }, ...r.messages], correct, finished, counted: true, feedback: v.text };
}

/** Comme submit, mais vérifie aussi les réponses chiffrées (asynchrone). */
export async function submitAsync(state, adv, index, input) {
  const b = blockAt(state, adv, index);
  if (!b || !isHashed(b)) return submit(state, adv, index, input);
  const bs = blockState(state, adv, index);
  if (isFinished(bs) || inputProblem(b, input, adv) || bs.wrong.includes(answerKey(b, input))) return submit(state, adv, index, input, false);
  return submit(state, adv, index, input, await checkAnswerAsync(b, input, adv));
}

/**
 * Raison pour laquelle le héros ne peut pas payer ces effets (or, repas, objet, points d'une caractéristique), ou null.
 * Une caractéristique ne peut pas payer plus qu'elle n'a (Chance à 0 : l'indice est refusé), sauf celle de la santé
 * du combat, dont la perte peut tuer : isFatal demande alors confirmation.
 */
export function cannotAfford(state, adv, effects = []) {
  const il = say(adv, 'Il vous faut', 'Il te faut');
  for (const e of effects || []) {
    if (e.if && !check(e.if, state, adv)) continue;
    const n = -Number(e.add || 0);
    if (e.op === 'gold' && n > 0 && (state.gold || 0) < n) return `${il} ${n} pièce${n > 1 ? 's' : ''} d’or.`;
    if (e.op === 'provisions' && n > 0 && (state.provisions || 0) < n) return `${il} ${n} repas.`;
    if (e.op === 'take' && !state.inventory?.[e.item]) return `${il} : ${itemName(adv, e.item)}.`;
    if (e.op === 'stat' && e.set === undefined && !e.addInitial && n > 0 && e.stat !== adv?.rules?.combat?.health) {
      const cur = state.stats?.[e.stat]?.cur;
      if (cur !== undefined && cur < n) return `${il} ${n} point${n > 1 ? 's' : ''} ${de(statLabel(adv, e.stat), '’')}.`;
    }
  }
  return null;
}

/** Vrai si payer ces effets tuerait le héros (pour demander confirmation). */
export const isFatal = (state, adv, effects = []) => !state.ended && applyEffects(state, adv, effects).state.ended === 'death';

/** Indice suivant du défi, ou null. */
export function nextHint(state, adv, index) {
  const b = blockAt(state, adv, index);
  const bs = blockState(state, adv, index);
  const k = bs.hints.length;
  return b && !isFinished(bs) && k < (b.hints || []).length ? { index: k, ...b.hints[k] } : null;
}

/** Révèle l'indice suivant et en fait payer le coût. Renvoie { state, messages, hint }. */
export function useHint(state, adv, index) {
  const h = nextHint(state, adv, index);
  if (!h) return { state, messages: [], hint: null };
  const why = cannotAfford(state, adv, h.cost || []);
  if (why) return { state, messages: [{ kind: 'info', text: why, verdict: true }], hint: null };
  const bs = blockState(state, adv, index);
  const r = applyEffects(state, adv, h.cost || []);
  const s = r.state;
  s.blocks = { ...s.blocks, [index]: { ...structuredClone(bs), hints: [...bs.hints, h.index] } };
  return { state: s, messages: [{ kind: 'info', text: `Indice ${h.index + 1} : ${h.text}`, verdict: true }, ...r.messages], hint: h.index };
}

/** Le joueur renonce (si l'auteur l'autorise) : effets d'échec, puis paragraphe d'échec. */
export function giveUp(state, adv, index) {
  const b = blockAt(state, adv, index);
  const bs = blockState(state, adv, index);
  if (!b?.allowGiveUp || isFinished(bs)) return { state, messages: [] };
  const r = applyEffects(state, adv, b.failureEffects || []);
  const s = r.state;
  const nb = { ...structuredClone(bs), failed: true, gaveUp: true };
  s.blocks = { ...s.blocks, [index]: nb };
  record(s, index, nb);
  return { state: s, messages: [{ kind: 'info', text: say(adv, 'Vous renoncez à ce défi.', 'Tu passes ce défi.'), verdict: true }, ...r.messages] };
}

/** Bilan de la partie : { solved, failed, hints, total } (total = défis présents dans l'aventure). */
export function summary(state, adv) {
  const done = Object.values(state?.defis?.done || {});
  const total = Object.values(adv?.sections || {}).reduce((n, s) => n + (s.blocks || []).filter(b => b?.type === TYPE).length, 0);
  return { solved: done.filter(d => d.ok).length, failed: done.filter(d => !d.ok).length, hints: done.reduce((n, d) => n + (d.hints || 0), 0), total };
}

/* ------------------------------------------------------------------ */
/* Aide à l'éditeur                                                    */
/* ------------------------------------------------------------------ */

export function defaultAnswers(kind) {
  return {
    text: [''],
    number: { value: 0, tolerance: 0 },
    qcm: [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }],
    multi: [{ text: '', correct: true }, { text: '', correct: true }, { text: '', correct: false }],
    order: ['', '', ''],
  }[kind] ?? [''];
}

/** Convertit les réponses d'un défi vers un autre type, en gardant ce qui peut l'être. */
export function convertAnswers(b, kind) {
  const from = kindOf(b);
  if (isHashed(b) || from === kind) return isHashed(b) ? defaultAnswers(kind) : structuredClone(b.answers ?? defaultAnswers(kind));
  let texts = [];
  if (from === 'text' || from === 'order') texts = (from === 'text' ? textAnswers(b) : orderItems(b)).filter(t => t.trim());
  if (from === 'qcm' || from === 'multi') texts = options(b).filter(o => o.text.trim()).map(o => o.text);
  if (from === 'number') texts = numberAnswers(b).map(x => frNumber(x.value));
  if (kind === 'text') {
    const good = from === 'qcm' || from === 'multi' ? options(b).filter(o => o.correct && o.text.trim()).map(o => o.text) : texts;
    return good.length ? good : defaultAnswers(kind);
  }
  if (kind === 'number') {
    const n = texts.map(parseNumber).find(Number.isFinite);
    return { value: n ?? 0, tolerance: 0 };
  }
  if (kind === 'order') return texts.length >= 2 ? texts : [...texts, ...defaultAnswers('order')].slice(0, Math.max(3, texts.length));
  // qcm / multi
  if (from === 'qcm' || from === 'multi') {
    const opts = options(b);
    if (kind === 'qcm') { let seen = false; return opts.map(o => { const c = o.correct && !seen; if (c) seen = true; return { ...o, correct: c }; }); }
    return opts;
  }
  const opts = texts.map((t, i) => ({ text: t, correct: from === 'text' || i === 0 }));
  if (kind === 'qcm') opts.forEach((o, i) => { o.correct = i === 0; });
  while (opts.length < 2) opts.push({ text: '', correct: !opts.length });
  return opts;
}

/* ------------------------------------------------------------------ */
/* Vérification de l'aventure                                           */
/* ------------------------------------------------------------------ */

/** Paragraphe contenant ce bloc (même objet) : { sid, sec, index, pos, count }. */
export function locate(adv, b) {
  for (const [sid, sec] of Object.entries(adv?.sections || {})) {
    const index = (sec.blocks || []).indexOf(b);
    if (index >= 0) { const ch = sec.blocks.filter(x => x?.type === TYPE); return { sid, sec, index, pos: ch.indexOf(b), count: ch.length }; }
  }
  return null;
}

export function validateChallenge(b, adv, report, where) {
  const kind = b.kind ?? 'text';
  if (!KINDS.includes(kind)) { report('error', `${where} : type de défi inconnu « ${kind} ».`); return; }
  if (!String(b.question || '').trim()) report('warning', `${where} : la question est vide.`);
  if (b.hashed && !HASHABLE.has(kind)) report('warning', `${where} : le chiffrement ne concerne que les réponses écrites ou numériques ; il est ignoré ici.`);
  if (isHashed(b)) {
    const hs = hashList(b);
    if (!hs.length) report('error', `${where} : aucune réponse chiffrée n'est acceptée.`);
    if (hs.some(h => !/^[0-9a-f]{64}$/.test(h))) report('error', `${where} : empreinte de réponse invalide (64 caractères hexadécimaux attendus).`);
    if (b.revealAnswer) report('info', `${where} : une réponse chiffrée ne peut pas être montrée au joueur.`);
  } else if (kind === 'text') {
    if (!textAnswers(b).some(a => normalizeText(a, textOpts(b)))) report('error', `${where} : aucune réponse acceptée.`);
  } else if (kind === 'number') {
    if (!numberAnswers(b).length) report('error', `${where} : la valeur attendue n'est pas un nombre.`);
  } else if (kind === 'qcm' || kind === 'multi') {
    const o = options(b);
    const good = o.filter(x => x.correct).length;
    if (o.length < 2) report('error', `${where} : il faut au moins deux propositions.`);
    if (o.some(x => !x.text.trim())) report('warning', `${where} : une proposition est vide.`);
    if (!good) report('error', `${where} : aucune proposition n'est marquée comme bonne réponse.`);
    if (kind === 'qcm' && good > 1) report('warning', `${where} : plusieurs bonnes réponses dans un QCM à réponse unique ; choisissez plutôt « Cases à cocher ».`);
  } else if (kind === 'order') {
    const it = orderItems(b);
    if (it.length < 2) report('error', `${where} : il faut au moins deux éléments à remettre dans l'ordre.`);
    if (it.some(x => !x.trim())) report('warning', `${where} : un élément à ordonner est vide.`);
  }
  const loc = locate(adv, b);
  const hasChoices = !!loc?.sec?.choices?.length;
  const canFail = maxAttempts(b) > 0 || !!b.allowGiveUp;
  if (!b.success && !hasChoices) report('error', `${where} : pas de destination en cas de bonne réponse, et le paragraphe n'a aucun choix : le joueur serait bloqué.`);
  if (canFail && !b.failure && !hasChoices) report('error', `${where} : pas de destination en cas d'échec, et le paragraphe n'a aucun choix : le joueur serait bloqué.`);
  if (!canFail && b.failure) report('info', `${where} : essais illimités et abandon impossible : le paragraphe d'échec ${b.failure} ne sera jamais atteint par ce défi.`);
  // Effets complets : objets, caractéristiques, effets des greffons (compteurs, compagnons…) et conditions « if ».
  checkEffects(b.successEffects, adv, report, where);
  checkEffects(b.failureEffects, adv, report, where);
  (b.hints || []).forEach(h => checkEffects(h?.cost, adv, report, where));
  (b.hints || []).forEach((h, j) => { if (!String(h?.text || '').trim()) report('warning', `${where} : l'indice ${j + 1} est vide.`); });
}

/* ------------------------------------------------------------------ */
/* Version imprimable                                                   */
/* ------------------------------------------------------------------ */

const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Rendu minimal du Markdown (remplacé dans l'application par markdown() de common.js, qui gère aussi les formules). */
export const plainMarkdown = src => String(src ?? '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
const inlineOf = (md, s) => md(s).replace(/^<p>([\s\S]*)<\/p>$/, '$1');

/** Graine stable tirée d'un texte (FNV-1a), pour un mélange identique dans le paragraphe et dans les solutions. */
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** Ordre mélangé des éléments sur papier (le même à chaque impression de ce défi). */
export const printOrder = b => { const it = orderItems(b); return shuffledOrder(it.length, makeRng(seedOf(it.join('␟'))), it); };

/** Repère d'un défi dans le livre : « 12 », ou « 12 a » s'il y en a plusieurs dans le paragraphe. */
export const labelOf = loc => (loc ? (loc.count > 1 ? `${loc.sid} ${String.fromCharCode(97 + loc.pos)}` : loc.sid) : '?');

const lcFirst = t => t.charAt(0).toLowerCase() + t.slice(1);

/** HTML d'un défi dans la version imprimable. `h` = { go, esc, UP, plural, condText, effectText }. */
export function printChallenge(b, adv, h, md = plainMarkdown) {
  const kind = kindOf(b);
  const loc = locate(adv, b);
  const esc = h?.esc || escHtml;
  const go = h?.go || (n => `rendez-vous au <b>${esc(n)}</b>`);
  const fx = list => (list || []).map(e => h?.effectText?.(e, adv) || '').filter(Boolean).map(t => lcFirst(t.replace(/\.\s*$/, ''))).join(' ; ');
  const parts = [`<p class="pr-defi-title"><b>Défi${b.title ? ` : ${esc(b.title)}` : ''}</b></p>`];
  if (b.image) parts.push(`<div class="pr-defi-img"><img data-defi-src="${esc(b.image)}" alt=""></div>`);
  parts.push(md(b.question || ''));
  if (kind === 'qcm' || kind === 'multi') {
    parts.push(`<ol class="pr-defi-opts" type="A">${options(b).map(o => `<li>${inlineOf(md, o.text)}</li>`).join('')}</ol>`);
    parts.push(`<p class="pr-small">${kind === 'qcm' ? 'Une seule réponse est juste : notez sa lettre.' : 'Plusieurs réponses peuvent être justes : notez toutes les bonnes lettres.'}</p>`);
  }
  if (kind === 'order') {
    const it = orderItems(b);
    parts.push(`<p class="pr-small">Remettez ces éléments dans le bon ordre et notez leurs lettres :</p><ol class="pr-defi-opts" type="A">${printOrder(b).map(k => `<li>${inlineOf(md, it[k])}</li>`).join('')}</ol>`);
  }
  parts.push(`<p class="pr-defi-line">Votre réponse${kind === 'number' && b.unit ? ` (en ${esc(b.unit)})` : ''} : <span class="pr-defi-blank"></span></p>`);
  (b.hints || []).forEach((hint, j) => {
    const cost = fx(hint.cost);
    // Un indice peut contenir plusieurs paragraphes, une liste ou une formule centrée : tout le
    // Markdown va dans un <div> retourné, jamais dans un <p>/<span> que le parseur refermerait.
    parts.push(`<div class="pr-defi-hint"><p><i>Indice ${j + 1}, imprimé à l'envers${cost ? ` ; si vous le lisez, ${esc(cost)}` : ''} :</i></p><div class="pr-flip">${md(hint.text || '')}</div></div>`);
  });
  const okFx = fx(b.successEffects), koFx = fx(b.failureEffects);
  const ok = b.success ? `${okFx ? `${esc(okFx)}, puis ` : ''}${go(b.success)}` : okFx ? `${esc(okFx)}, puis poursuivez votre lecture` : 'poursuivez votre lecture';
  const ko = b.failure ? (koFx ? `, ${esc(koFx)}, puis ${go(b.failure)}` : ` ${go(b.failure).replace(/^rendez-vous au/, 'au')}`)
    : koFx ? `, ${esc(koFx)}, puis poursuivez votre lecture` : ', poursuivez votre lecture';
  parts.push(`<p>Notez votre réponse puis consultez les Solutions des défis en fin de livre (défi du <b>${esc(labelOf(loc))}</b>) : si elle est juste, ${ok} ; sinon${ko}.</p>`);
  return `<div class="pr-block pr-defi">${parts.join('')}</div>`;
}

/** Solution lisible d'un défi (texte brut) pour l'annexe « Solutions des défis ». */
export function solutionText(b) {
  const kind = kindOf(b);
  if (isHashed(b)) return 'réponse chiffrée : à vérifier dans l’application';
  if (kind === 'text') {
    const [first, ...rest] = textAnswers(b).filter(a => a.trim());
    if (!first) return '(aucune réponse définie)';
    return `« ${first} »${rest.length ? ` (acceptées aussi : ${rest.map(a => `« ${a} »`).join(', ')})` : ''}`;
  }
  if (kind === 'number') {
    return numberAnswers(b).map(x => `${frNumber(x.value)}${b.unit ? ` ${b.unit}` : ''}${x.tolerance ? ` (à ${frNumber(x.tolerance)} près)` : ''}`).join(' ou ') || '(aucune valeur définie)';
  }
  if (kind === 'qcm' || kind === 'multi') {
    const good = options(b).map((o, i) => ({ ...o, i })).filter(o => o.correct);
    return good.map(o => `${letter(o.i)} (${o.text})`).join(kind === 'multi' ? ' et ' : ' ou ') || '(aucune bonne réponse définie)';
  }
  const it = orderItems(b);
  const shown = printOrder(b);
  return `${it.map((_, pos) => letter(shown.indexOf(pos))).join(', ')} (${it.join(', ')})`;
}

/** Tous les défis de l'aventure, dans l'ordre des paragraphes : [{ sid, label, title, kind, solution, hashed, explanation }]. */
export function solutionsOf(adv) {
  const ids = Object.keys(adv?.sections || {}).sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b));
  const out = [];
  for (const sid of ids) {
    const sec = adv.sections[sid];
    const ch = (sec.blocks || []).filter(b => b?.type === TYPE);
    ch.forEach((b, pos) => out.push({ sid, label: labelOf({ sid, pos, count: ch.length }), title: b.title || '', kind: kindOf(b), solution: solutionText(b), hashed: isHashed(b), explanation: b.explanation || '' }));
  }
  return out;
}

export const hasChallenges = adv => Object.values(adv?.sections || {}).some(s => (s.blocks || []).some(b => b?.type === TYPE));

/* ------------------------------------------------------------------ */
/* Enregistrement dans le moteur                                        */
/* ------------------------------------------------------------------ */

const remapFx = (list, remapCond) => (Array.isArray(list) ? list.map(e => (e?.if ? { ...e, if: remapCond(e.if) } : e)) : list);

registerBlock(TYPE, {
  targets: (b, i) => [
    b.success && { to: b.success, kind: 'challenge', label: 'bonne réponse', ref: ['blocks', i, 'success'] },
    b.failure && { to: b.failure, kind: 'challenge', label: 'échec', ref: ['blocks', i, 'failure'] },
  ].filter(Boolean),
  // success / failure sont déjà renumérotés par validate.js (champs communs à tous les blocs) :
  // il ne reste que les conditions des effets.
  remap: (b, m, remapCond) => {
    const x = { ...b };
    if (x.successEffects) x.successEffects = remapFx(x.successEffects, remapCond);
    if (x.failureEffects) x.failureEffects = remapFx(x.failureEffects, remapCond);
    if (Array.isArray(x.hints)) x.hints = x.hints.map(h => (h?.cost ? { ...h, cost: remapFx(h.cost, remapCond) } : h));
    return x;
  },
  validate: validateChallenge,
  print: (b, adv, h) => printChallenge(b, adv, h),
});

registerHeroInit(state => { state.defis = { done: {} }; });

// À l'entrée d'un paragraphe : état neuf de chaque défi, éléments à ordonner mélangés avec la graine de la partie.
registerEnterHook((s, adv, sectionId) => {
  const blocks = adv.sections[sectionId]?.blocks || [];
  if (!blocks.some(b => b?.type === TYPE)) return;
  const rng = makeRng(s.rng);
  blocks.forEach((b, i) => { if (b?.type === TYPE) s.blocks[i] = freshState(b, rng); });
  s.rng = rng.state();
});
