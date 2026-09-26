// Greffon « zefor » — moteur pur (aucun accès au DOM, testable dans Node).
// Relie l'aventure à zefor974 (« Maths974 — entraîne-toi » : exercices, Blokaly, Pezali, Aljeb…) :
// un parcours réussi sur zefor débloque la suite du livre. Aucun serveur côté Livre-Héros.
//
// Quatre façons de recevoir le résultat :
//   code    : zefor affiche un code de réussite, le joueur le tape (empreinte SHA-256 comparée, ou code personnel HMAC) ;
//   message : zefor, ouvert en fenêtre (ou dans un cadre), envoie un message au livre (postMessage) ;
//   retour  : zefor redirige vers <application>#/zefor-retour/<aventure>?nonce=…&success=1&score=…&sig=…
//   integre : l'activité zefor (labyrinthe, brume, balance) est jouée DANS la page, à partir du paquet
//             vendor/zefor/ (construit hors du dépôt, voir docs/plugins/zefor.md § Mode intégré).
//
// Bloc « zefor » :
//   { type: 'zefor', title, description (Markdown), url, exercise?, mode: 'code'|'message'|'retour', display?: 'fenetre'|'cadre',
//     codeHashes: ['<sha256 hex de « sel:CODE »>'], codeSalt?, minScore?, success, failure?,
//     allowSkip?, skipLabel?, skipTo?, skipEffects?: [], successEffects?: [], failureEffects?: [] }
// Bloc « zefor » en mode intégré :
//   { type: 'zefor', mode: 'integre', title, description, activity: { kind: 'maze'|'brume'|'pezali', level: {…} },
//     pass?: { minScore?: 0…1, minStars?: 1…4 }, fallback?: { mode: 'code'|'message'|'retour', url, exercise?, codeHashes, codeSalt?, display? },
//     success, failure?, allowSkip?, skipLabel?, skipTo?, skipEffects?, successEffects?, failureEffects? }
// Règles : adv.rules.zefor = { origin?: 'https://…' (une ou plusieurs origines), publicKeyJwk?: clé ECDSA P-256, codeKey?: clé HMAC }
// État pendant la visite du paragraphe : state.blocks[index] = { nonce, status: 'pending'|'success'|'failure', opened, tries, wrong, result }
// Bilan de la partie : state.zefor.done['<paragraphe>#<index>'] = { ok, via, score, title, section }
// Voir docs/plugins/zefor.md (auteurs) et docs/ZEFOR.md (développeur de zefor974).

import { registerBlock, registerNormalize, registerHeroInit } from '../../core/plugins.js';
import { enter } from '../../core/rules.js';
import { checkEffects } from '../../core/validate.js';

export const TYPE = 'zefor';
export const MODES = ['code', 'message', 'retour', 'integre'];
/** Modes où le parcours se joue sur zefor974 (hors du livre) : ceux que peut prendre un repli. */
export const REMOTE_MODES = ['code', 'message', 'retour'];
export const CHANNEL = 'livre-heros-zefor';
export const KV = 'zefor|';
export const RESULT_TYPE = 'zefor:result';
export const ROUTE = 'zefor-retour';
export const DEFAULT_RULES = { origin: '', publicKeyJwk: null, codeKey: '' };

/** Raisons d'un refus, en français, pour l'interface. */
export const REASONS = {
  format: 'message illisible',
  nonce: 'ce résultat concerne une autre partie ou un autre défi',
  origin: 'message venu d’un site non autorisé',
  exercise: 'ce résultat concerne un autre exercice',
  unsigned: 'le résultat n’est pas signé alors que l’aventure exige une signature',
  signature: 'signature invalide',
  mode: 'ce défi n’accepte pas les résultats arrivés par ce moyen',
};

/* ------------------------------------------------------------------ */
/* Lecture tolérante d'un bloc et des règles                           */
/* ------------------------------------------------------------------ */

export const modeOf = b => (MODES.includes(b?.mode) ? b.mode : 'code');
export const displayOf = b => (modeOf(b) === 'message' && b?.display === 'cadre' ? 'cadre' : 'fenetre');
export const rulesOf = adv => ({ ...DEFAULT_RULES, ...(adv?.rules?.zefor || {}) });
export const hashesOf = b => (Array.isArray(b?.codeHashes) ? b.codeHashes : [])
  .map(h => String(h ?? '').trim().toLowerCase()).filter(h => /^[0-9a-f]{64}$/.test(h));
export const hasCodes = (adv, b) => hashesOf(b).length > 0 || !!rulesOf(adv).codeKey;
/** Sel des empreintes : fixé par l'éditeur à l'ajout du premier code, pour survivre à une copie de l'aventure. */
export const saltOf = (adv, b) => String(b?.codeSalt || adv?.id || '');
export function minScoreOf(b) {
  const v = b?.minScore;
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export const blockAt = (adv, state, index) => adv.sections[state.section]?.blocks?.[index] || null;
export const doneKey = (section, index) => `${section}#${index}`;

/** Origine(s) acceptée(s) pour les messages : règles de l'aventure, sinon l'origine de l'adresse du parcours. */
export function allowedOrigins(adv, block) {
  const list = String(rulesOf(adv).origin || '').split(/[\s,;]+/).map(normOrigin).filter(Boolean);
  if (list.length) return list;
  const own = urlOrigin(block?.url);
  return own ? [own] : [];
}
function normOrigin(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  try { const u = new URL(t); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}
export function urlOrigin(url) {
  try { const u = new URL(String(url || '').trim()); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}

/* ------------------------------------------------------------------ */
/* Octets, base64url, empreintes                                       */
/* ------------------------------------------------------------------ */

function subtle() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Vérification impossible : ce navigateur n’autorise le chiffrement que sur une adresse https (ou localhost).');
  return s;
}
const utf8 = s => new TextEncoder().encode(String(s));
export const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export function bytesToB64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** base64url ou base64 classique (un « + » devenu espace dans une adresse est réparé). Renvoie null si illisible. */
export function b64urlToBytes(str) {
  let s = String(str ?? '').trim().replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!s || /[^A-Za-z0-9+/]/.test(s) || s.length % 4 === 1) return null;
  while (s.length % 4) s += '=';
  try { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); } catch { return null; }
}

export async function sha256Hex(text) { return toHex(await subtle().digest('SHA-256', utf8(text))); }

/** Code comparable : sans accents, en majuscules, sans espaces ni tirets (« brume-4821 » = « BRUME4821 »). */
export const normalizeCode = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Empreinte d'un code de réussite : SHA-256 hexadécimal de « sel:CODE ». */
export const codeHash = (salt, code) => sha256Hex(`${salt}:${normalizeCode(code)}`);

/** Nonce aléatoire (128 bits, base64url) : il lie un résultat à UNE ouverture du parcours. */
export function newNonce(bytes = 16) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return bytesToB64url(a);
}
/** Clé secrète des codes personnels (256 bits, base64url). */
export const newCodeKey = () => newNonce(32);

/* ------------------------------------------------------------------ */
/* Codes personnels : différents pour chaque partie (HMAC du nonce)    */
/* ------------------------------------------------------------------ */

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PERSONAL_LENGTH = 6;
/** Comme normalizeCode, avec les confusions courantes corrigées : O → 0, I et L → 1. */
export const normalizePersonal = s => normalizeCode(s).replace(/O/g, '0').replace(/[IL]/g, '1');
/** « 7KQM2P » → « 7KQ-M2P » (affichage). */
export const formatPersonal = c => (c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c);

/** Code personnel = 30 premiers bits de HMAC-SHA256(clé, nonce), en base32 de Crockford (6 caractères). */
export async function personalCode(codeKey, nonce) {
  const raw = b64urlToBytes(codeKey);
  if (!raw || raw.length < 16) throw new Error('Clé des codes personnels illisible.');
  const key = await subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await subtle().sign('HMAC', key, utf8(nonce)));
  const bits = [...mac.slice(0, 4)].map(b => b.toString(2).padStart(8, '0')).join('');
  return Array.from({ length: PERSONAL_LENGTH }, (_, i) => CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join('');
}

/**
 * Le code tapé est-il bon ? Renvoie 'personal' (code personnel lié au nonce), 'static' (un des codes de l'auteur) ou null.
 */
export async function checkCode(adv, block, input, nonce) {
  if (!normalizeCode(input)) return null;
  const { codeKey } = rulesOf(adv);
  if (codeKey && nonce) {
    try { if (normalizePersonal(input) === await personalCode(codeKey, nonce)) return 'personal'; } catch { /* clé illisible : on essaie les codes fixes */ }
  }
  const hashes = hashesOf(block);
  if (hashes.length && hashes.includes(await codeHash(saltOf(adv, block), input))) return 'static';
  return null;
}

/* ------------------------------------------------------------------ */
/* Adresse du parcours                                                 */
/* ------------------------------------------------------------------ */

/**
 * Adresse ouverte pour le joueur : celle du bloc + lh_nonce, lh_mode, lh_return, lh_origin, lh_exercise
 * (+ m974=1&session=<nonce> en mode cadre, pour le protocole m974 de Maths974). null si l'adresse est invalide.
 */
export function buildUrl(block, { nonce, returnUrl, origin } = {}) {
  let u;
  try { u = new URL(String(block?.url || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const p = u.searchParams;
  if (nonce) p.set('lh_nonce', nonce);
  p.set('lh_mode', modeOf(block));
  if (returnUrl) p.set('lh_return', returnUrl);
  if (origin) p.set('lh_origin', origin);
  const ex = String(block?.exercise || '').trim();
  if (ex) p.set('lh_exercise', ex);
  if (displayOf(block) === 'cadre') {
    p.set('lh_display', 'cadre');
    p.set('m974', '1');
    if (nonce) p.set('session', nonce);
    if (ex && !p.has('activity')) p.set('activity', ex);
  }
  return u.toString();
}

/* ------------------------------------------------------------------ */
/* Résultats reçus : lecture, signature, vérification                  */
/* ------------------------------------------------------------------ */

const truthy = v => v === true || v === 1 || /^(1|true|oui|yes|ok|vrai)$/i.test(String(v ?? '').trim());
const scoreTextOf = v => (v == null || v === '' ? '' : String(v).trim());
function scoreNum(t) {
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function makeResult(x) {
  if (typeof x.nonce !== 'string' || !x.nonce.trim()) return null;
  const t = scoreTextOf(x.score);
  const r = {
    exercise: String(x.exercise ?? ''), success: truthy(x.success), score: scoreNum(t), scoreText: t,
    nonce: x.nonce.trim(), signature: x.signature ? String(x.signature).trim() : '', format: x.format,
  };
  if (x.stars != null) r.stars = Number(x.stars);
  if (x.maxStars != null) r.maxStars = Number(x.maxStars);
  return r;
}

/**
 * Lit un message reçu (postMessage ou BroadcastChannel). Deux formats :
 *   { type: 'zefor:result', exercise, success, score, nonce, signature? }
 *   { type: 'm974:attempt', session: <nonce>, payload: { activityId, outcome: { passed, score, stars?, maxStars? }, signature? } }
 * Renvoie un résultat normalisé { exercise, success, score, scoreText, nonce, signature, format } ou null.
 */
export function parseMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type === RESULT_TYPE) {
    return makeResult({ exercise: data.exercise, success: data.success, score: data.score, nonce: data.nonce, signature: data.signature, format: 'zefor' });
  }
  if (data.type === 'm974:attempt' && data.payload && typeof data.payload === 'object') {
    const a = data.payload, o = a.outcome && typeof a.outcome === 'object' ? a.outcome : {};
    return makeResult({ exercise: a.activityId, success: o.passed ?? a.passed, score: o.score, nonce: data.session ?? a.nonce, signature: a.signature ?? data.signature, format: 'm974', stars: o.stars, maxStars: o.maxStars });
  }
  return null;
}

/** Lit les paramètres de l'adresse de retour ({ nonce, exercise, success, score, sig } ou URLSearchParams). */
export function parseReturn(query) {
  const get = k => (query instanceof URLSearchParams ? query.get(k) : query?.[k]) ?? undefined;
  return makeResult({ exercise: get('exercise'), success: get('success'), score: get('score'), nonce: get('nonce') ?? get('lh_nonce'), signature: get('sig') ?? get('signature'), format: 'retour' });
}

/** Message à diffuser (BroadcastChannel) pour un résultat normalisé. */
export const toMessage = r => ({ type: RESULT_TYPE, exercise: r.exercise, success: !!r.success, score: r.scoreText ?? scoreTextOf(r.score), nonce: r.nonce, signature: r.signature || undefined });

/** Chaîne signée par zefor : « exercise|success|score|nonce » avec success = 1 ou 0 et score tel qu'écrit (vide si absent). */
export const signedData = r => [r.exercise ?? '', truthy(r.success) ? '1' : '0', r.scoreText ?? scoreTextOf(r.score), r.nonce ?? ''].join('|');

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

/**
 * Lit une clé JWK collée par l'auteur (texte JSON ou objet). Renvoie { jwk (partie publique seule), private: bool } ou { error }.
 */
export function parseJwk(input) {
  let j = input;
  if (typeof j === 'string') {
    if (!j.trim()) return { error: 'vide' };
    try { j = JSON.parse(j); } catch { return { error: 'Ce texte n’est pas du JSON.' }; }
  }
  if (!j || typeof j !== 'object') return { error: 'Clé illisible.' };
  if (j.kty !== 'EC' || j.crv !== 'P-256') return { error: 'Il faut une clé ECDSA sur la courbe P-256 (« kty »: "EC", « crv »: "P-256").' };
  const ok = s => typeof s === 'string' && b64urlToBytes(s)?.length === 32;
  if (!ok(j.x) || !ok(j.y)) return { error: 'Les coordonnées « x » et « y » de la clé sont illisibles.' };
  return { jwk: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }, private: typeof j.d === 'string' };
}

export async function importPublicKey(jwk) {
  const { kty, crv, x, y } = jwk;
  return subtle().importKey('jwk', { kty, crv, x, y, ext: true }, ECDSA, false, ['verify']);
}

/** Signature DER (ASN.1, format par défaut d'OpenSSL et de node:crypto) → format brut r‖s de WebCrypto. */
export function derToRaw(der) {
  if (!der || der[0] !== 0x30) return null;
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const out = new Uint8Array(64);
  for (let k = 0; k < 2; k++) {
    if (der[i] !== 0x02) return null;
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32 || !v.length) return null;
    out.set(v, k * 32 + (32 - v.length));
  }
  return out;
}

/** Vérifie la signature ECDSA P-256 / SHA-256 d'un résultat (base64url, brute 64 octets ou DER). */
export async function verifySignature(jwk, result) {
  try {
    let sig = b64urlToBytes(result?.signature);
    if (!sig) return false;
    if (sig.length !== 64) sig = derToRaw(sig);
    if (!sig) return false;
    const key = await importPublicKey(jwk);
    return await subtle().verify(SIGN, key, sig, utf8(signedData(result)));
  } catch { return false; }
}

/** Paire de clés de test : la publique va dans les règles de l'aventure, la privée chez zefor. */
export async function generateKeyPair() {
  const k = await subtle().generateKey(ECDSA, true, ['sign', 'verify']);
  const [pub, priv] = await Promise.all([subtle().exportKey('jwk', k.publicKey), subtle().exportKey('jwk', k.privateKey)]);
  return { publicJwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, privateJwk: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d } };
}

/** Signe un résultat comme le ferait zefor (tests, simulation, exemple de la documentation). */
export async function signResult(privateJwk, result) {
  const { kty, crv, x, y, d } = privateJwk;
  const key = await subtle().importKey('jwk', { kty, crv, x, y, d, ext: true }, ECDSA, false, ['sign']);
  return bytesToB64url(await subtle().sign(SIGN, key, utf8(signedData(result))));
}

/**
 * Vérifie un résultat pour un bloc.
 * Renvoie { ok: false, reason } si le résultat doit être ignoré (autre partie, site non autorisé, signature…),
 * sinon { ok: true, success, scoreOk, verified } — success : parcours réussi ET score suffisant.
 * `origin` : event.origin d'un postMessage (omis pour BroadcastChannel et l'adresse de retour, qui sont locaux).
 * `channel` : moyen par lequel le résultat est arrivé ('message' ou 'retour') ; il doit correspondre au mode du bloc
 * (un bloc en mode « code » n'accepte que des codes : une adresse de retour tapée à la main ne le débloque pas).
 */
export async function checkResult(result, { adv, block, nonce, origin, channel } = {}) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'format' };
  if (channel !== undefined && channel !== modeOf(block)) return { ok: false, reason: 'mode' };
  if (!nonce || result.nonce !== nonce) return { ok: false, reason: 'nonce' };
  if (origin !== undefined && !allowedOrigins(adv, block).includes(origin)) return { ok: false, reason: 'origin' };
  const want = String(block?.exercise || '').trim();
  if (want && String(result.exercise ?? '') !== want) return { ok: false, reason: 'exercise' };
  const { publicKeyJwk } = rulesOf(adv);
  const key = publicKeyJwk ? parseJwk(publicKeyJwk).jwk : null;
  if (publicKeyJwk) {
    if (!result.signature) return { ok: false, reason: 'unsigned' };
    if (!key || !(await verifySignature(key, result))) return { ok: false, reason: 'signature' };
  }
  const min = minScoreOf(block);
  const scoreOk = min == null || (result.score != null && result.score >= min);
  return { ok: true, success: !!result.success && scoreOk, scoreOk, verified: !!key };
}

/* ------------------------------------------------------------------ */
/* Adresse de retour et code de transfert                              */
/* ------------------------------------------------------------------ */

/** Référence d'un bloc dans l'adresse de retour : « <paragraphe>.<index> ». */
export const blockRef = (section, index) => `${section}.${index}`;
export function parseBlockRef(ref) {
  const s = String(ref ?? '');
  const i = s.lastIndexOf('.');
  if (i <= 0) return null;
  const index = Number(s.slice(i + 1));
  return Number.isInteger(index) && index >= 0 ? { section: s.slice(0, i), index } : null;
}

/**
 * Code de transfert : quand la page de retour s'ouvre dans un navigateur où aucune partie n'attend ce résultat
 * (application installée sur iPhone ou iPad, autre navigateur…), elle affiche le code personnel du nonce,
 * que l'élève tape dans sa partie. Seulement pour un bloc en mode « retour », si l'aventure a une clé de codes
 * personnels ET une clé publique de signature, et que le résultat est signé, authentique et suffisant (exercice,
 * score minimum). Sans signature, n'importe qui pourrait taper l'adresse et obtenir le code : null.
 */
export async function transferCode(adv, ref, result) {
  const { codeKey, publicKeyJwk } = rulesOf(adv);
  const r = parseBlockRef(ref);
  const raw = r && adv?.sections?.[r.section]?.blocks?.[r.index];
  const block = raw && isIntegre(raw) ? fallbackBlock(raw) : raw;
  if (!codeKey || !publicKeyJwk || !block || raw.type !== TYPE || modeOf(block) !== 'retour' || !result?.nonce) return null;
  const chk = await checkResult(result, { adv, block, nonce: result.nonce, channel: 'retour' });
  if (!chk.ok || !chk.success || !chk.verified) return null;
  try { return await personalCode(codeKey, result.nonce); } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* État de la partie (fonctions pures : état cloné)                    */
/* ------------------------------------------------------------------ */

/**
 * Le joueur ouvre le parcours : le nonce est mémorisé dans state.blocks[index].
 * Tant qu'un résultat est attendu, le même nonce est gardé (rouvrir l'onglet ne change rien) ;
 * après un échec, le nonce fourni (neuf) le remplace : l'ancien résultat ne peut pas resservir.
 */
export function openChallenge(state, adv, index, nonce) {
  const s = structuredClone(state);
  const prev = s.blocks[index] || {};
  const keep = prev.status === 'pending' && prev.nonce;
  s.blocks[index] = { tries: 0, ...prev, nonce: keep ? prev.nonce : nonce, status: 'pending', opened: (prev.opened || 0) + 1, wrong: false, result: null };
  return { state: s, nonce: s.blocks[index].nonce };
}

const VIA = { code: 'code de réussite', personal: 'code personnel', message: 'message de Zefor', retour: 'retour de Zefor', simulation: 'simulation (mode test)', integre: 'l’activité jouée dans le livre' };
export const viaLabel = v => VIA[v] || v || '';

/** Enregistre un résultat (déjà vérifié) pour le bloc. */
export function recordResult(state, adv, index, { success, score = null, via = 'code', exercise = '', scoreOk = true, stars = null, maxStars = null } = {}) {
  const s = structuredClone(state);
  const prev = s.blocks[index] || {};
  const result = { success: !!success, score, via, exercise, scoreOk };
  if (stars != null) Object.assign(result, { stars, maxStars });
  s.blocks[index] = { tries: 0, ...prev, status: success ? 'success' : 'failure', wrong: false, result };
  const sc = stars != null ? ` (${starsText(stars, maxStars)})` : score != null ? ` (score : ${String(score).replace('.', ',')})` : '';
  const messages = [success
    ? { kind: 'gain', text: `Défi Zefor réussi${sc}.` }
    : { kind: 'loss', text: `Défi Zefor non réussi${sc}${scoreOk ? '' : ' : score insuffisant'}.` }];
  return { state: s, messages };
}

/** Code refusé : un essai de plus. */
export function wrongCode(state, index) {
  const s = structuredClone(state);
  const prev = s.blocks[index] || {};
  s.blocks[index] = { ...prev, tries: (prev.tries || 0) + 1, wrong: true };
  return { state: s, messages: [] };
}

function markDone(s, adv, index, ok, via) {
  const b = blockAt(adv, s, index) || {};
  s.zefor = { done: {}, ...(s.zefor || {}) };
  s.zefor.done = { ...(s.zefor.done || {}), [doneKey(s.section, index)]: { ok, via, score: s.blocks[index]?.result?.score ?? null, title: b.title || '', section: s.section } };
}

/** Défi réussi : effets de réussite puis paragraphe de réussite. */
export function continueChallenge(state, adv, index) {
  const b = blockAt(adv, state, index);
  const st = state.blocks[index];
  if (!b || st?.status !== 'success') throw new Error('Le défi n’est pas encore réussi.');
  const s = structuredClone(state);
  markDone(s, adv, index, true, st.result?.via || 'code');
  return enter(s, adv, b.success, { viaEffects: b.successEffects || [] });
}

/** Défi raté ou abandonné : effets d'échec puis paragraphe d'échec (s'il existe). */
export function failChallenge(state, adv, index) {
  const b = blockAt(adv, state, index);
  if (!b?.failure) throw new Error('Ce défi n’a pas de paragraphe d’échec.');
  const s = structuredClone(state);
  markDone(s, adv, index, false, s.blocks[index]?.status === 'failure' ? 'échec' : 'abandon');
  return enter(s, adv, b.failure, { viaEffects: b.failureEffects || [] });
}

/** Continuer sans le défi (hors ligne, par exemple) : on paie le prix prévu par l'auteur. */
export function skipChallenge(state, adv, index) {
  const b = blockAt(adv, state, index);
  if (!b?.allowSkip) throw new Error('Ce défi ne peut pas être passé.');
  const s = structuredClone(state);
  markDone(s, adv, index, false, 'sans le défi');
  const r = enter(s, adv, b.skipTo || b.success, { viaEffects: b.skipEffects || [] });
  return { state: r.state, messages: [{ kind: 'info', text: 'Vous continuez sans relever le défi.' }, ...r.messages] };
}

/** Bilan de la partie (écran de fin). */
export function summary(state) {
  const list = Object.values(state?.zefor?.done || {});
  return { list, ok: list.filter(d => d.ok).length, total: list.length };
}

/* ------------------------------------------------------------------ */
/* Mode « integre » : l'activité zefor jouée dans la page              */
/* ------------------------------------------------------------------ */

/** Activités du paquet vendor/zefor/ : module, feuille de style, nom de l'export (construits par zefor-paquet/construire.mjs). */
export const KINDS = {
  maze: { label: 'Labyrinthe Blokaly', short: 'labyrinthe', module: 'maze.js', css: 'maze.css', export: 'LABYRINTHE', stars: true },
  brume: { label: 'Brume : combien sous la brume ?', short: 'brume', module: 'brume.js', css: null, export: 'BRUME', stars: true },
  pezali: { label: 'Balance Pezali', short: 'balance', module: 'pezali.js', css: 'pezali.css', export: 'PEZALI', stars: false },
};
/** Dossier du paquet, relatif à la racine du site. */
export const VENDOR_DIR = 'vendor/zefor/';
export const MAX_STARS = 4;

export const isIntegre = b => b?.mode === 'integre';
export const kindOf = b => (KINDS[b?.activity?.kind] ? b.activity.kind : null);
export const levelOf = b => (b?.activity?.level && typeof b.activity.level === 'object' && !Array.isArray(b.activity.level) ? b.activity.level : null);
export const kindLabel = k => KINDS[k]?.label || String(k || '');

/** Bloc de repli (modes code, message ou retour) d'un bloc intégré : ses champs + ceux du repli. null s'il n'y en a pas. */
export function fallbackBlock(b) {
  const f = b?.fallback;
  if (!f || typeof f !== 'object' || !REMOTE_MODES.includes(f.mode || 'code')) return null;
  const { activity, pass, fallback, ...rest } = b;
  return { ...rest, ...f, mode: f.mode || 'code', minScore: f.minScore };
}

const clamp01 = n => Math.min(1, Math.max(0, n));
const round2 = n => Math.round(n * 100) / 100;

/**
 * Score normalisé (0 à 1) d'un résultat d'activité (argument de onPass).
 *   maze, brume : étoiles / étoiles maximum (4 au plus ; une victoire vaut toujours au moins 1 étoile) ;
 *   pezali : 1 (Pezali ne signale que les réussites) ;
 *   résultat absent ou raté : 0.
 */
export function scoreIntegre(kind, r) {
  if (!r || typeof r !== 'object' || r.passed === false) return 0;
  if (kind === 'pezali') return 1;
  const s = starsOf(r);
  return round2(clamp01(s.stars / s.maxStars));
}
/** Étoiles d'un résultat : { stars, maxStars } (maxEtoiles absent ou invalide → 4 ; au moins 1 étoile pour une victoire). */
export function starsOf(r) {
  const m = Number(r?.maxEtoiles ?? r?.maxStars);
  const maxStars = Number.isFinite(m) && m >= 1 ? Math.round(m) : MAX_STARS;
  const n = Number(r?.etoiles ?? r?.stars);
  const stars = Math.min(maxStars, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1));
  return { stars, maxStars };
}
export const starsText = (n, max = MAX_STARS) => `${n} étoile${n > 1 ? 's' : ''} sur ${max}`;

/** Exigences de réussite : { minScore: 0…1 | null, minStars: entier | null }. */
export function passOf(b) {
  const p = b?.pass && typeof b.pass === 'object' ? b.pass : {};
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return { minScore: num(p.minScore), minStars: num(p.minStars) };
}

/**
 * Verdict d'un bloc intégré pour un résultat d'activité (onPass) :
 * { success, score, stars?, maxStars?, scoreOk } — success : activité réussie ET exigences atteintes.
 */
export function judgeIntegre(b, r) {
  const kind = kindOf(b);
  const passed = !!r && typeof r === 'object' && r.passed !== false;
  const score = passed ? scoreIntegre(kind, r) : 0;
  const out = { success: false, score, scoreOk: true };
  if (passed && KINDS[kind]?.stars) Object.assign(out, starsOf(r));
  const { minScore, minStars } = passOf(b);
  if (minScore != null && score < minScore - 1e-9) out.scoreOk = false;
  if (minStars != null && out.stars != null && out.stars < minStars) out.scoreOk = false;
  out.success = passed && out.scoreOk;
  return out;
}

/** Une nouvelle partie de l'activité commence (premier montage ou « Réessayer ») : l'ancien résultat est effacé. */
export function startIntegre(state, index) {
  const s = structuredClone(state);
  const prev = s.blocks[index] || {};
  s.blocks[index] = { tries: 0, ...prev, status: 'pending', opened: (prev.opened || 0) + 1, wrong: false, result: null };
  return { state: s, messages: [] };
}
/** Un essai raté dans l'activité (programme qui n'arrive pas, mauvaise réponse) : on compte, sans conclure. */
export function missIntegre(state, index) {
  const s = structuredClone(state);
  const prev = s.blocks[index] || {};
  s.blocks[index] = { ...prev, tries: (prev.tries || 0) + 1 };
  return { state: s, messages: [] };
}

/* ---------- vérification d'un niveau (éditeur et onglet Vérifier) ---------- */

const isInt = v => Number.isInteger(v);
const textOf = v => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(v.fr ?? Object.values(v)[0] ?? '') : '');
export const levelText = level => textOf(level?.instruction) || textOf(level?.consigne) || '';

/** Noms de décor connus du labyrinthe (voir zefor-paquet/construire.mjs) : sinon un pictogramme court. */
export const MAZE_DECOR = {
  danger: ['yeux', 'buisson', 'rocher', 'ronces', 'eau', 'chien', 'chasseur', 'lanterne', 'stop'],
  but: ['drapeau', 'cascade', 'maison', 'grotte', 'etoile', 'tresor', 'feu', 'arbre', 'campement'],
};
/** Codes des cases du labyrinthe. */
export const CELL = { CHEMIN: 1, DEPART: 2, ARRIVEE: 3, MUR: 4, DANGER: 5 };
export const MAZE_BLOCKS = ['maze_move_forward', 'maze_turn', 'maze_forever', 'maze_if', 'maze_if_else'];

/** Plus court chemin du départ à une arrivée, sans mur ni danger (nombre de cases), ou null. */
export function mazePath(level) {
  const g = level?.grid, p = level?.startPos;
  if (!Array.isArray(g) || !p) return null;
  const free = (x, y) => Array.isArray(g[y]) && isInt(g[y][x]) && ![0, CELL.MUR, CELL.DANGER].includes(g[y][x]);
  const seen = new Set([`${p.x},${p.y}`]);
  let front = [[p.x, p.y]], d = 0;
  while (front.length) {
    const next = [];
    for (const [x, y] of front) {
      if (g[y]?.[x] === CELL.ARRIVEE) return d;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && free(x + dx, y + dy)) { seen.add(k); next.push([x + dx, y + dy]); }
      }
    }
    front = next; d++;
  }
  return null;
}

function checkMaze(level, add) {
  const g = level.grid;
  if (!Array.isArray(g) || !g.length || !g.every(r => Array.isArray(r) && r.length)) { add('error', 'il faut une grille « grid » : un tableau de lignes de nombres (1 chemin, 2 départ, 3 arrivée, 4 mur, 5 danger).'); return; }
  const w = g[0].length;
  if (!g.every(r => r.length === w)) add('error', 'toutes les lignes de la grille doivent avoir la même longueur.');
  if (!g.flat().every(c => isInt(c) && c >= 0 && c <= 5)) add('error', 'la grille ne doit contenir que les nombres 0 à 5.');
  if (!g.flat().includes(CELL.ARRIVEE)) add('error', 'la grille n’a pas d’arrivée (case 3).');
  const p = level.startPos;
  if (!p || !isInt(p.x) || !isInt(p.y)) add('error', 'il faut une position de départ « startPos » : { "x": colonne, "y": ligne, "dir": 0 } (comptées depuis 0).');
  else if (!Array.isArray(g[p.y]) || g[p.y][p.x] == null) add('error', `le départ (${p.x}, ${p.y}) est hors de la grille.`);
  else if ([0, CELL.MUR, CELL.DANGER].includes(g[p.y][p.x])) add('error', 'le départ est sur un mur ou une case danger.');
  else if (g.flat().includes(CELL.ARRIVEE) && mazePath(level) == null) add('error', 'aucun chemin ne mène du départ à l’arrivée sans passer par un mur ou une case danger.');
  if (p && p.dir != null && ![0, 1, 2, 3].includes(p.dir)) add('error', 'la direction de départ « dir » vaut 0 (est), 1 (sud), 2 (ouest) ou 3 (nord).');
  if (level.allowedBlocks != null) {
    if (!Array.isArray(level.allowedBlocks) || !level.allowedBlocks.length) add('error', '« allowedBlocks » doit être une liste de blocs non vide.');
    else {
      const bad = level.allowedBlocks.filter(x => !MAZE_BLOCKS.includes(x));
      if (bad.length) add('warning', `blocs inconnus : ${bad.join(', ')} (connus : ${MAZE_BLOCKS.join(', ')}).`);
      if (!level.allowedBlocks.includes('maze_move_forward')) add('error', 'sans le bloc « maze_move_forward », le robot ne peut pas avancer.');
    }
  }
  if (level.maxBlocks != null && !(isInt(level.maxBlocks) && level.maxBlocks > 0)) add('error', '« maxBlocks » doit être un nombre entier positif.');
  const d = level.decor;
  if (d != null) {
    if (typeof d !== 'object' || Array.isArray(d)) add('error', '« decor » doit être un objet { "danger": …, "but": … }.');
    else for (const k of ['danger', 'but']) {
      const v = d[k];
      if (v == null) continue;
      if (typeof v !== 'string' || !v.trim()) add('warning', `décor « ${k} » vide.`);
      else if (!MAZE_DECOR[k].includes(v.trim().toLowerCase()) && [...v.trim()].length > 4) add('warning', `décor « ${k} » : « ${v} » n’est pas un nom connu (${MAZE_DECOR[k].join(', ')}) ni un pictogramme court ; le décor par défaut sera utilisé.`);
    }
  }
  if (g.flat().includes(CELL.DANGER) && !(d && d.danger)) add('info', 'les cases danger montreront le décor par défaut (des yeux) : précisez « decor.danger » si vous voulez autre chose.');
}

export const BRUME_TEINTES = ['A', 'B', 'C'];
function checkBrume(level, add) {
  if (!(isInt(level.total) && level.total >= 1)) add('error', 'il faut un « total » entier (le nombre d’objets en tout).');
  const pts = level.points, brumes = level.brumes;
  if (!Array.isArray(pts) || !pts.length) add('error', 'il faut une liste « points » : [{ "x": 0 à 100, "y": 0 à 70, "sous": numéro de la brume (facultatif) }].');
  else if (!pts.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) add('error', 'chaque point doit avoir des coordonnées « x » et « y ».');
  else if (pts.some(p => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 70)) add('warning', 'des points sortent du dessin (x de 0 à 100, y de 0 à 70).');
  if (!Array.isArray(brumes) || !brumes.length) { add('error', 'il faut au moins une brume : « brumes » : [{ "teinte": "A", "x": …, "y": …, "r": … }].'); return; }
  if (!brumes.every(b => b && BRUME_TEINTES.includes(b.teinte))) add('error', 'la teinte d’une brume vaut « A », « B » ou « C ».');
  if (!brumes.every(b => b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.r) && b.r > 0)) add('error', 'chaque brume a un centre « x », « y » et un rayon « r » positif.');
  const teintes = [...new Set(brumes.map(b => b?.teinte))];
  const caches = level.caches && typeof level.caches === 'object' ? level.caches : null;
  if (!caches) { add('error', 'il faut « caches » : combien d’objets sous chaque teinte, par ex. { "A": 8 }.'); return; }
  for (const t of teintes) if (!(isInt(caches[t]) && caches[t] >= 1)) add('error', `« caches.${t} » doit être un entier au moins égal à 1.`);
  const vals = teintes.map(t => caches[t]);
  if (new Set(vals).size !== vals.length) add('error', 'deux teintes différentes doivent cacher des nombres différents.');
  if (!Array.isArray(pts)) return;
  const visibles = pts.filter(p => p?.sous == null).length;
  const nb = t => brumes.filter(b => b?.teinte === t).length;
  const somme = visibles + teintes.reduce((s, t) => s + nb(t) * (Number(caches[t]) || 0), 0);
  if (isInt(level.total) && somme !== level.total) add('error', `les comptes ne tombent pas juste : ${visibles} visibles + cachés = ${somme}, pas ${level.total}.`);
  if (pts.some(p => p?.sous != null && !(isInt(p.sous) && p.sous >= 0 && p.sous < brumes.length))) add('error', '« sous » doit être le numéro d’une brume (0 pour la première).');
  brumes.forEach((b, i) => {
    const n = pts.filter(p => p?.sous === i).length;
    if (b && n && n !== Number(caches[b.teinte])) add('warning', `la brume n° ${i} recouvre ${n} points dessinés mais en cache ${caches[b.teinte]} : quand elle se lève, l’enfant ne comptera pas le bon nombre.`);
  });
}

/** Côté d'une équation « 3x + 2 » → { a, b } (coefficients entiers) ou null. */
export function parseLinear(str) {
  const s = String(str ?? '').replace(/\s+/g, '').replace(/−/g, '-').toLowerCase();
  if (!s || !/^[-+]?[0-9x+\-*]+$/.test(s)) return null;
  const terms = s.match(/[+-]?[^+-]+/g) || [];
  let a = 0, b = 0;
  for (const t of terms) {
    const m = t.match(/^([+-]?)(\d*)\*?(x?)$/);
    if (!m || (!m[2] && !m[3])) return null;
    const n = (m[1] === '-' ? -1 : 1) * (m[2] ? Number(m[2]) : 1);
    if (m[3]) a += n; else b += n;
  }
  return { a, b };
}
export const PEZALI_OPS = ['add', 'sub', 'mul', 'div'];
function checkPezali(level, add) {
  if (level.equationMode != null && !['fixe', 'tirage'].includes(level.equationMode)) add('error', '« equationMode » vaut « fixe » (équation imposée) ou « tirage ».');
  if (level.equationMode !== 'tirage') {
    const L = parseLinear(level.gauche), R = parseLinear(level.droite);
    if (!L || !R) add('error', 'il faut une équation : « gauche » et « droite », par ex. "3x + 2" et "11" (nombres entiers et x).');
    else if (L.a === R.a) add('error', 'l’inconnue x doit rester d’un seul côté après simplification (coefficients de x différents).');
    else {
      const x = (R.b - L.b) / (L.a - R.a);
      if (!Number.isInteger(x)) add('error', `la solution n’est pas un nombre entier (x = ${String(Math.round(x * 1000) / 1000).replace('.', ',')}) : Pezali ne pèse que des entiers.`);
      else if (L.a < 0 || R.a < 0 || L.b < 0 || R.b < 0) add('info', 'l’équation contient des nombres négatifs : réservez-la aux plus grands.');
    }
  }
  if (level.operations != null) {
    if (!Array.isArray(level.operations) || !level.operations.length) add('error', '« operations » doit être une liste non vide parmi add, sub, mul, div.');
    else if (level.operations.some(o => !PEZALI_OPS.includes(o))) add('error', `opérations inconnues : ${level.operations.filter(o => !PEZALI_OPS.includes(o)).join(', ')} (connues : ${PEZALI_OPS.join(', ')}).`);
  }
}

/** Vérifie un niveau : liste de { level: 'error'|'warning'|'info', text }. Vide = rien à signaler. */
export function checkLevel(kind, level) {
  const out = [];
  const add = (lv, text) => out.push({ level: lv, text });
  if (!KINDS[kind]) { add('error', `type d’activité inconnu « ${kind ?? ''} » (maze, brume ou pezali).`); return out; }
  if (!level || typeof level !== 'object' || Array.isArray(level)) { add('error', 'le niveau doit être un objet JSON { … }.'); return out; }
  if (kind === 'maze') checkMaze(level, add);
  else if (kind === 'brume') checkBrume(level, add);
  else checkPezali(level, add);
  if (!levelText(level)) add('warning', `pas de consigne (« ${kind === 'pezali' ? 'consigne' : 'instruction'} » : { "fr": "…" }).`);
  return out;
}

/** Niveau de départ proposé par l'éditeur pour chaque activité (exemples du livre). */
export function sampleLevel(kind) {
  if (kind === 'maze') return {
    instruction: { fr: 'Guide le groupe jusqu’à la cascade sans passer devant le chasseur.' },
    grid: [[4, 4, 4, 4, 4, 4, 4], [4, 2, 1, 1, 5, 4, 4], [4, 4, 4, 1, 4, 4, 4], [4, 4, 4, 1, 1, 3, 4], [4, 4, 4, 4, 4, 4, 4]],
    startPos: { x: 1, y: 1, dir: 0 }, allowedBlocks: ['maze_move_forward', 'maze_turn'], maxBlocks: 8,
    decor: { danger: 'yeux', but: 'cascade' },
  };
  if (kind === 'brume') {
    const points = [];
    for (let i = 0; i < 8; i++) points.push({ x: 18 + (i % 4) * 7, y: 22 + Math.floor(i / 4) * 9, sous: 0 });
    for (let i = 0; i < 7; i++) points.push({ x: 60 + (i % 4) * 8, y: 20 + Math.floor(i / 4) * 12 });
    return { instruction: { fr: 'Il y a 15 mangues. Combien sont cachées sous la brume ?' }, total: 15, unique: true, points, brumes: [{ teinte: 'A', x: 28, y: 27, r: 16 }], caches: { A: 8 } };
  }
  if (kind === 'pezali') return { equationMode: 'fixe', gauche: '3x + 2', droite: '11', operations: ['sub', 'div'], consigne: { fr: 'Trois sacs de provisions et 2 kg de riz pèsent autant que 11 kg. Combien pèse un sac ?' } };
  return {};
}

/** Niveau passé à l'activité : champs attendus par zefor ajoutés (type du labyrinthe). */
/**
 * JSON d'un niveau, lisible dans l'éditeur : indenté, mais chaque tableau de nombres (une ligne de la grille)
 * et chaque petit objet sans imbrication (un point, une brume, startPos) tient sur une ligne.
 */
export function prettyLevel(level) {
  const leaf = x => x === null || typeof x !== 'object';
  const fmt = (v, pad) => {
    if (leaf(v)) return JSON.stringify(v) ?? 'null';
    const arr = Array.isArray(v);
    const entries = arr ? null : Object.entries(v).filter(([, x]) => x !== undefined);
    if (arr ? !v.length : !entries.length) return arr ? '[]' : '{}';
    const inner = pad + '  ';
    if (arr ? v.every(leaf) : entries.every(([, x]) => leaf(x))) {
      const one = arr ? `[${v.map(x => JSON.stringify(x) ?? 'null').join(', ')}]` : `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(', ')} }`;
      if (inner.length + one.length <= 78) return one;
    }
    return arr
      ? `[\n${v.map(x => inner + fmt(x, inner)).join(',\n')}\n${pad}]`
      : `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${fmt(x, inner)}`).join(',\n')}\n${pad}}`;
  };
  return fmt(level ?? {}, '');
}

export function levelForMount(kind, level) {
  if (kind === 'maze') return { type: 'MAZE', ...level };
  if (kind === 'pezali') return { equationMode: 'fixe', ...level };
  return { ...level };
}

/** Grille du labyrinthe pour la version imprimable (tableau de cases, symboles lisibles sans couleur). */
function printMaze(level, h) {
  const g = level?.grid;
  if (!Array.isArray(g) || !g.length) return '';
  const p = level.startPos || {};
  const arrow = ['→', '↓', '←', '↑'][p.dir ?? 0] || '→';
  const sym = (c, x, y) => (x === p.x && y === p.y ? `<b>${arrow}</b>` : c === CELL.ARRIVEE ? '<b>A</b>' : c === CELL.DANGER ? '<b>!</b>' : '');
  const rows = g.map((r, y) => `<tr>${r.map((c, x) => `<td class="${c === CELL.MUR || c === 0 ? 'zf-pr-mur' : 'zf-pr-case'}">${sym(c, x, y)}</td>`).join('')}</tr>`).join('');
  return `<table class="zf-pr-laby" aria-label="Labyrinthe">${rows}</table><p class="zf-pr-legende">${h.esc(`${arrow} : départ (le groupe regarde dans le sens de la flèche) ; A : arrivée ; « ! » : danger, à éviter ; cases hachurées : murs.`)}</p>`;
}

/* ------------------------------------------------------------------ */
/* Enregistrement dans le moteur                                       */
/* ------------------------------------------------------------------ */

/** Repli sans moteur Markdown : texte brut, mais le contenu des formules $…$ est laissé intact. */
const plain = md => String(md || '').split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/).map((part, i) => (i % 2 ? part
  : part.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^\w])[*_](.+?)[*_](?!\w)/g, '$1$2'))).join('').replace(/\s*\n+\s*/g, ' ').trim();

/** Espace fine insécable devant ; : ! ? » et après «, pour qu'aucune ligne imprimée ne commence par ces signes. */
const NNBSP = '\u202F';
export const frSpaces = t => String(t).replace(/ ([;:!?»])/g, `${NNBSP}$1`).replace(/« /g, `«${NNBSP}`);

/** Adresse imprimable : coupures possibles après / ? & = # (sinon elle part entière à la ligne). */
const urlHtml = (url, esc) => esc(url).replace(/(\/|\?|&amp;|=|#)(?=.)/g, '$1<wbr>');

/** Effets en incise de livre : « inscrivez … : Rame du passeur, vous perdez 1 point de CHANCE, ». */
function fxClause(list, adv, h) {
  const t = (list || []).map(e => String(h.effectText(e, adv) || '').trim().replace(/\.$/, '')).filter(Boolean)
    .map(x => x.charAt(0).toLowerCase() + x.slice(1));
  return t.length ? `${h.esc(frSpaces(t.join(', ')))}, ` : '';
}

export function printBlock(b, adv, h) {
  const head = `<p><b>${b.title ? `Défi Zefor${NNBSP}: ${h.esc(b.title)}` : 'Défi Zefor'}.</b></p>`;
  // La consigne est rendue comme à l'écran (Markdown et formules) quand l'impression fournit le moteur Markdown.
  const desc = b.description ? (h.markdown ? `<div class="zf-pr-desc">${h.markdown(b.description)}</div>` : `<p>${h.esc(plain(b.description))}</p>`) : '';
  if (isIntegre(b)) return printIntegre(b, adv, h, head, desc);
  const url = String(b.url || '').trim();
  const where = `<p class="zf-pr-where">Ce défi se fait sur zefor974${NNBSP}:</p><p class="zf-url">${url ? urlHtml(url, h.esc) : '(adresse à compléter)'}</p>`;
  const parts = [];
  parts.push(`Quand vous l'avez réussi, notez le code obtenu, ${fxClause(b.successEffects, adv, h)}puis ${h.go(b.success)}.`);
  const min = minScoreOf(b);
  if (min != null) parts.push(`(Le défi n'est réussi qu'avec un score d'au moins ${String(min).replace('.', ',')}.)`);
  if (b.failure) parts.push(`Si vous n'y parvenez pas, ${fxClause(b.failureEffects, adv, h)}${h.go(b.failure)}.`);
  if (b.allowSkip) parts.push(`Vous pouvez aussi renoncer au défi${NNBSP}: ${fxClause(b.skipEffects, adv, h)}${h.go(b.skipTo || b.success)}.`);
  return `<div class="pr-block zf-print">${head}${desc}${where}<p>${parts.join(' ')}</p></div>`;
}

/**
 * Version imprimable d'un défi intégré : il ne se joue que dans l'application. Le texte de repli le dit, recopie la consigne
 * (et, pour un labyrinthe, la grille à résoudre sur papier), puis donne la porte de secours : le parcours zefor974 avec
 * son code (repli), ou « renoncer au défi » si l'auteur l'a permis.
 */
function printIntegre(b, adv, h, head, desc) {
  const kind = kindOf(b), level = levelOf(b) || {};
  const consigne = levelText(level);
  const parts = [`<p class="zf-pr-app">Ce défi se joue dans l’application Livre-Héros${kind ? ` (${h.esc(KINDS[kind].short)})` : ''}.${consigne ? ` Consigne${NNBSP}: ${h.esc(frSpaces(consigne))}` : ''}</p>`];
  if (kind === 'maze') parts.push(printMaze(level, h));
  const fb = fallbackBlock(b);
  const next = [];
  if (fb) {
    const url = String(fb.url || '').trim();
    next.push(url
      ? `Sur papier, faites-le sur zefor974${NNBSP}:</p><p class="zf-url">${urlHtml(url, h.esc)}</p><p>Quand vous l'avez réussi, notez le code obtenu, ${fxClause(b.successEffects, adv, h)}puis ${h.go(b.success)}.`
      : `Sur papier, demandez le code de secours à l'adulte qui vous accompagne${NNBSP}; notez-le, ${fxClause(b.successEffects, adv, h)}puis ${h.go(b.success)}.`);
  } else next.push(`Dans l'application, sa réussite vous mène au <b>${h.esc(b.success || '?')}</b>.`);
  if (b.failure) next.push(`Si vous n'y parvenez pas, ${fxClause(b.failureEffects, adv, h)}${h.go(b.failure)}.`);
  if (b.allowSkip) next.push(`Vous pouvez aussi renoncer au défi${NNBSP}: ${fxClause(b.skipEffects, adv, h)}${h.go(b.skipTo || b.success)}.`);
  return `<div class="pr-block zf-print zf-print-integre">${head}${desc}${parts.join('')}<p>${next.join(' ')}</p></div>`;
}

function validateIntegre(b, adv, report, where) {
  const kind = kindOf(b);
  if (!b.activity || typeof b.activity !== 'object') report('error', `${where} : activité intégrée sans « activity » ({ kind, level }).`);
  else if (!kind) report('error', `${where} : type d’activité inconnu « ${b.activity.kind ?? ''} » (maze, brume ou pezali).`);
  else for (const p of checkLevel(kind, b.activity.level)) report(p.level, `${where} : ${KINDS[kind].short}, ${p.text}`);
  if (!b.success) report('error', `${where} : pas de destination en cas de réussite du défi Zefor.`);
  const { minScore, minStars } = passOf(b);
  const raw = b.pass || {};
  if (raw.minScore != null && raw.minScore !== '' && (minScore == null || minScore < 0 || minScore > 1)) report('error', `${where} : « pass.minScore » est une part des étoiles, entre 0 et 1 (0,5 = au moins 2 étoiles sur 4).`);
  if (raw.minStars != null && raw.minStars !== '' && (minStars == null || minStars < 1 || minStars > MAX_STARS)) report('error', `${where} : « pass.minStars » vaut de 1 à ${MAX_STARS}.`);
  if (kind === 'pezali' && ((minScore != null && minScore > 0) || minStars != null)) report('info', `${where} : Pezali ne donne pas d’étoiles (toute réussite vaut 1) : l’exigence de score n’a pas d’effet.`);
  if (b.fallback != null) {
    const fb = fallbackBlock(b);
    if (!fb) report('error', `${where} : le repli doit être en mode code, message ou retour.`);
    else {
      const url = String(fb.url || '').trim();
      if (url && !urlOrigin(url)) report('error', `${where}, repli : l'adresse du parcours Zefor doit commencer par https://.`);
      if (!url && fb.mode !== 'code') report('error', `${where}, repli : l'adresse du parcours Zefor est vide.`);
      if (fb.mode === 'code' && !hasCodes(adv, fb)) report('error', `${where}, repli : aucun code de secours. Ajoutez-en un (ou activez les codes personnels dans Règles › Zefor).`);
      if (fb.mode === 'message' && !allowedOrigins(adv, fb).length) report('error', `${where}, repli : indiquez l'origine de Zefor (Règles › Zefor) pour accepter ses messages.`);
    }
  } else if (!b.allowSkip) report('warning', `${where} : si le paquet zefor ne se charge pas (application hors ligne avant d’avoir joué ce défi, site sans vendor/zefor/), le joueur reste bloqué. Ajoutez un repli (code de secours) ou permettez de continuer sans le défi.`);
  if (b.allowSkip && b.skipTo === b.success && !(b.skipEffects || []).length) report('info', `${where} : continuer sans le défi ne coûte rien.`);
  checkEffects(b.successEffects, adv, report, `${where}, effets de réussite`);
  checkEffects(b.failureEffects, adv, report, `${where}, effets d’échec`);
  checkEffects(b.skipEffects, adv, report, `${where}, effets sans le défi`);
}

export function validateBlock(b, adv, report, where) {
  if (isIntegre(b)) { validateIntegre(b, adv, report, where); return; }
  const mode = modeOf(b);
  const url = String(b.url || '').trim();
  if (!url) report('warning', `${where} : l'adresse du parcours Zefor est vide (le bouton « Ouvrir le parcours » ne marchera pas).`);
  else if (!urlOrigin(url)) report('error', `${where} : l'adresse du parcours Zefor doit commencer par https://.`);
  if (!b.success) report('error', `${where} : pas de destination en cas de réussite du défi Zefor.`);
  if (b.mode && !MODES.includes(b.mode)) report('warning', `${where} : mode « ${b.mode} » inconnu, le mode « code » sera utilisé.`);
  if (mode === 'code' && !hasCodes(adv, b)) report('error', `${where} : aucun code de réussite. Ajoutez-en un, ou activez les codes personnels dans Règles › Zefor.`);
  if ((b.codeHashes || []).length !== hashesOf(b).length) report('warning', `${where} : certaines empreintes de code sont illisibles (64 caractères hexadécimaux attendus).`);
  if (mode === 'message') {
    const allowed = allowedOrigins(adv, b);
    if (!allowed.length) report('error', `${where} : indiquez l'origine de Zefor (Règles › Zefor) pour accepter ses messages.`);
    else if (url && urlOrigin(url) && !allowed.includes(urlOrigin(url))) report('warning', `${where} : l'adresse du parcours (${urlOrigin(url)}) n'est pas une origine autorisée (${allowed.join(', ')}) : ses messages seront refusés.`);
  }
  if (b.minScore !== undefined && b.minScore !== '' && b.minScore !== null && minScoreOf(b) == null) report('warning', `${where} : le score minimum n'est pas un nombre.`);
  const z = rulesOf(adv);
  if (mode !== 'code') {
    if (z.publicKeyJwk && parseJwk(z.publicKeyJwk).error) report('error', `${where} : la clé publique de Règles › Zefor est illisible : aucun résultat ne sera accepté.`);
    else if (!z.publicKeyJwk) report('info', `${where} : résultats non signés — un élève astucieux pourrait fabriquer un faux résultat (acceptable pour un jeu).`);
  }
  if (b.allowSkip && b.skipTo === b.success && !(b.skipEffects || []).length) report('info', `${where} : continuer sans le défi ne coûte rien.`);
  checkEffects(b.successEffects, adv, report, `${where}, effets de réussite`);
  checkEffects(b.failureEffects, adv, report, `${where}, effets d’échec`);
  checkEffects(b.skipEffects, adv, report, `${where}, effets sans le défi`);
}

const remapFx = (list, remapCond) => (remapCond ? list.map(e => (e?.if ? { ...e, if: remapCond(e.if) } : e)) : list);

registerNormalize(adv => { adv.rules.zefor = { ...DEFAULT_RULES, ...(adv.rules.zefor || {}) }; });
registerHeroInit(state => { state.zefor = { done: {} }; });
registerBlock(TYPE, {
  targets: (b, i) => [
    { to: b.success, kind: 'zefor', label: 'défi réussi', ref: ['blocks', i, 'success'] },
    b.failure && { to: b.failure, kind: 'zefor', label: 'défi raté', ref: ['blocks', i, 'failure'] },
    b.allowSkip && b.skipTo && { to: b.skipTo, kind: 'zefor', label: 'sans le défi', ref: ['blocks', i, 'skipTo'] },
  ].filter(Boolean),
  // success et failure sont déjà renumérotés par le moteur (validate.js) ; il reste skipTo et les conditions des effets.
  remap: (b, m, remapCond) => {
    const x = { ...b };
    if (x.skipTo) x.skipTo = m(x.skipTo);
    for (const k of ['successEffects', 'failureEffects', 'skipEffects']) if (Array.isArray(x[k])) x[k] = remapFx(x[k], remapCond);
    return x;
  },
  validate: validateBlock,
  print: printBlock,
});
