// Greffon « zefor » — moteur pur (aucun accès au DOM, testable dans Node).
// Relie l'aventure à zefor974 (« Maths974 — entraîne-toi » : exercices, Blokaly, Pezali, Aljeb…) :
// un parcours réussi sur zefor débloque la suite du livre. Aucun serveur côté Livre-Héros.
//
// Trois façons de recevoir le résultat :
//   code    : zefor affiche un code de réussite, le joueur le tape (empreinte SHA-256 comparée, ou code personnel HMAC) ;
//   message : zefor, ouvert en fenêtre (ou dans un cadre), envoie un message au livre (postMessage) ;
//   retour  : zefor redirige vers <application>#/zefor-retour/<aventure>?nonce=…&success=1&score=…&sig=…
//
// Bloc « zefor » :
//   { type: 'zefor', title, description (Markdown), url, exercise?, mode: 'code'|'message'|'retour', display?: 'fenetre'|'cadre',
//     codeHashes: ['<sha256 hex de « sel:CODE »>'], codeSalt?, minScore?, success, failure?,
//     allowSkip?, skipLabel?, skipTo?, skipEffects?: [], successEffects?: [], failureEffects?: [] }
// Règles : adv.rules.zefor = { origin?: 'https://…' (une ou plusieurs origines), publicKeyJwk?: clé ECDSA P-256, codeKey?: clé HMAC }
// État pendant la visite du paragraphe : state.blocks[index] = { nonce, status: 'pending'|'success'|'failure', opened, tries, wrong, result }
// Bilan de la partie : state.zefor.done['<paragraphe>#<index>'] = { ok, via, score, title, section }
// Voir docs/plugins/zefor.md (auteurs) et docs/ZEFOR.md (développeur de zefor974).

import { registerBlock, registerNormalize, registerHeroInit } from '../../core/plugins.js';
import { enter } from '../../core/rules.js';

export const TYPE = 'zefor';
export const MODES = ['code', 'message', 'retour'];
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
 */
export async function checkResult(result, { adv, block, nonce, origin } = {}) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'format' };
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
 * que l'élève tape dans sa partie. Seulement si l'aventure a une clé de codes personnels et que le résultat
 * est authentique (signature si exigée) et suffisant (exercice, score minimum). Sinon null.
 */
export async function transferCode(adv, ref, result) {
  const { codeKey } = rulesOf(adv);
  const r = parseBlockRef(ref);
  const block = r && adv?.sections?.[r.section]?.blocks?.[r.index];
  if (!codeKey || !block || block.type !== TYPE || !result?.nonce) return null;
  const chk = await checkResult(result, { adv, block, nonce: result.nonce });
  if (!chk.ok || !chk.success) return null;
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

const VIA = { code: 'code de réussite', personal: 'code personnel', message: 'message de Zefor', retour: 'retour de Zefor', simulation: 'simulation (mode test)' };
export const viaLabel = v => VIA[v] || v || '';

/** Enregistre un résultat (déjà vérifié) pour le bloc. */
export function recordResult(state, adv, index, { success, score = null, via = 'code', exercise = '', scoreOk = true } = {}) {
  const s = structuredClone(state);
  const prev = s.blocks[index] || {};
  s.blocks[index] = { tries: 0, ...prev, status: success ? 'success' : 'failure', wrong: false, result: { success: !!success, score, via, exercise, scoreOk } };
  const sc = score != null ? ` (score : ${String(score).replace('.', ',')})` : '';
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
/* Enregistrement dans le moteur                                       */
/* ------------------------------------------------------------------ */

const plain = md => String(md || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_](.+?)[*_]/g, '$1').replace(/\s*\n+\s*/g, ' ').trim();

/** Effets en incise de livre : « inscrivez … : Rame du passeur, vous perdez 1 point de CHANCE, ». */
function fxClause(list, adv, h) {
  const t = (list || []).map(e => String(h.effectText(e, adv) || '').trim().replace(/\.$/, '')).filter(Boolean)
    .map(x => x.charAt(0).toLowerCase() + x.slice(1));
  return t.length ? `${h.esc(t.join(', '))}, ` : '';
}

export function printBlock(b, adv, h) {
  const parts = [`<b>${b.title ? `Défi Zefor : ${h.esc(b.title)}` : 'Défi Zefor'}.</b>`];
  if (b.description) parts.push(h.esc(plain(b.description)));
  parts.push(`Ce défi se fait sur zefor974 : <span class="zf-url">${h.esc(String(b.url || '').trim() || '(adresse à compléter)')}</span>.`);
  parts.push(`Quand vous l'avez réussi, notez le code obtenu, ${fxClause(b.successEffects, adv, h)}puis ${h.go(b.success)}.`);
  const min = minScoreOf(b);
  if (min != null) parts.push(`(Le défi n'est réussi qu'avec un score d'au moins ${String(min).replace('.', ',')}.)`);
  if (b.failure) parts.push(`Si vous n'y parvenez pas, ${fxClause(b.failureEffects, adv, h)}${h.go(b.failure)}.`);
  if (b.allowSkip) parts.push(`Vous pouvez aussi renoncer au défi : ${fxClause(b.skipEffects, adv, h)}${h.go(b.skipTo || b.success)}.`);
  return `<div class="pr-block zf-print"><p>${parts.join(' ')}</p></div>`;
}

export function validateBlock(b, adv, report, where) {
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
}

registerNormalize(adv => { adv.rules.zefor = { ...DEFAULT_RULES, ...(adv.rules.zefor || {}) }; });
registerHeroInit(state => { state.zefor = { done: {} }; });
registerBlock(TYPE, {
  targets: (b, i) => [
    { to: b.success, kind: 'zefor', label: 'défi réussi', ref: ['blocks', i, 'success'] },
    b.failure && { to: b.failure, kind: 'zefor', label: 'défi raté', ref: ['blocks', i, 'failure'] },
    b.allowSkip && b.skipTo && { to: b.skipTo, kind: 'zefor', label: 'sans le défi', ref: ['blocks', i, 'skipTo'] },
  ].filter(Boolean),
  // success et failure sont déjà renumérotés par le moteur (validate.js) ; il ne reste que skipTo.
  remap: (b, m) => (b.skipTo ? { ...b, skipTo: m(b.skipTo) } : b),
  validate: validateBlock,
  print: printBlock,
});
