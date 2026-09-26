// Greffon « partage » — partie pure (aucun accès au DOM, testable dans Node).
//
// Lien magique : l'aventure entière voyage dans l'ancre de l'URL, #/importer/<jeton>.
// Le jeton est du base64url (lettres, chiffres, « - » et « _ ») de :
//   octet 0      version du format (1)
//   octets 1-4   taille du JSON décompressé (entier non signé, gros-boutiste)
//   octets 5-6   nombre d'images et de sons retirés (ils ne voyagent pas dans un lien)
//   octets 7-10  CRC-32 des octets 5-6 puis du JSON décompressé (détecte un lien coupé ou modifié)
//   octets 11-…  JSON de l'aventure compressé en DEFLATE brut (fflate)
// Voir docs/plugins/partage.md.

import { deflateSync, inflateSync, strToU8, strFromU8 } from '../../lib/fflate.js';
import qrcode from '../../lib/qrcode/qrcode.js';
import { normalizeAdventure, slug } from '../../core/rules.js';

export const TOKEN_VERSION = 1;
const HEADER = 11;
/** Au-delà de cette longueur de lien, un QR code devient trop dense pour être scanné sur un écran. */
export const QR_MAX = 2000;
/** Au-delà, le lien devient déraisonnable (messageries, navigateurs) : on propose le fichier .lhz. */
export const LINK_MAX = 60000;
/** Taille maximale acceptée pour le JSON décompressé (protège contre les liens piégés). */
export const JSON_MAX = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Erreurs lisibles                                                    */
/* ------------------------------------------------------------------ */

const ERRORS = {
  vide: ['Ce lien est incomplet', 'Il manque la partie du lien qui contient l’aventure.'],
  caracteres: ['Ce lien magique est abîmé', 'Il contient des caractères inattendus : il a sans doute été modifié en chemin (espace, retour à la ligne, correction automatique…).'],
  tronque: ['Ce lien magique est abîmé', 'Il est incomplet : il a probablement été coupé par la messagerie qui l’a transmis.'],
  abime: ['Ce lien magique est abîmé', 'Son contenu ne correspond plus à sa somme de contrôle : une partie du lien a été perdue ou modifiée.'],
  version: ['Ce lien vient d’une version plus récente', 'Il a été créé par une version plus récente de Livre-Héros. Rechargez la page pour mettre l’application à jour, puis rouvrez le lien.'],
  taille: ['Ce lien magique est abîmé', 'Il annonce une aventure démesurément grande : il a sans doute été altéré.'],
  illisible: ['Ce lien magique est abîmé', 'Son contenu ne peut pas être lu comme une aventure.'],
  'pas-aventure': ['Ce lien ne contient pas d’aventure', 'Le contenu du lien n’est pas une aventure Livre-Héros (il n’a aucun paragraphe).'],
};

export class ShareError extends Error {
  constructor(code) {
    const [title, message] = ERRORS[code] || ERRORS.illisible;
    super(message);
    this.name = 'ShareError';
    this.code = code;
    this.title = title;
  }
}

/* ------------------------------------------------------------------ */
/* base64url et CRC-32                                                 */
/* ------------------------------------------------------------------ */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) REV[ALPHA.charCodeAt(i)] = i;
REV[43] = 62; REV[47] = 63; // « + » et « / » du base64 classique, acceptés en lecture

/** Octets → texte base64url sans remplissage. */
export function toBase64url(bytes) {
  const out = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out.push(ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63]);
  }
  const rest = bytes.length - i;
  if (rest) {
    const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    out.push(ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + (rest === 2 ? ALPHA[(n >> 6) & 63] : ''));
  }
  return out.join('');
}

/**
 * Texte base64url (ou base64 classique) → octets. Lève ShareError si le texte est abîmé.
 * `strict` : refuse aussi un dernier caractère dont les bits inutilisés ne sont pas nuls (signe d'altération).
 */
export function fromBase64url(text, { strict = true } = {}) {
  const s = String(text).replace(/=+$/, '');
  if (s.length % 4 === 1) throw new ShareError('tronque');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? REV[c] : -1;
    if (v < 0) throw new ShareError('caracteres');
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
  }
  // Un encodeur correct laisse à zéro les bits inutilisés du dernier caractère.
  if (strict && !tailIsClean(s)) throw new ShareError('abime');
  return out.subarray(0, o);
}

/** Vrai si les bits inutilisés du dernier caractère sont nuls, comme les laisse un encodeur correct. */
function tailIsClean(text) {
  const s = String(text).replace(/=+$/, '');
  const unused = { 2: 4, 3: 2 }[s.length % 4];
  if (!unused) return true;
  const v = REV[s.charCodeAt(s.length - 1)];
  return (v & ((1 << unused) - 1)) === 0;
}

let CRC_TABLE = null;
/** CRC-32 (celui des fichiers zip). `prev` permet d'enchaîner plusieurs morceaux. */
export function crc32(bytes, prev = 0) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* Préparation de l'aventure                                           */
/* ------------------------------------------------------------------ */

const MEDIA_EXT = /\.(webp|png|jpe?g|gif|svg|avif|bmp|mp3|ogg|oga|opus|wav|m4a|aac|flac|weba|webm)$/i;
const SOUND_EXT = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|weba|webm)$/i;

/** Vrai pour un chemin de fichier local de l'aventure (« images/1.webp », « sons/pluie.mp3 »…), faux pour une URL. */
export function isLocalMedia(v) {
  return typeof v === 'string' && v.length < 400 && !/^[a-z][\w+.-]*:/i.test(v) && !/\s/.test(v) && v.includes('/') && MEDIA_EXT.test(v);
}

/**
 * Copie de l'aventure sans ses fichiers locaux (images, sons), qui ne peuvent pas voyager dans un lien.
 * Parcourt tout le JSON : les champs ajoutés par d'autres greffons sont aussi nettoyés.
 * Renvoie { adventure, removed: [{ path, kind: 'image'|'son' }] } (chemins distincts).
 */
export function stripLocalMedia(adv) {
  const removed = new Map();
  const walk = v => {
    if (Array.isArray(v)) return v.filter(x => !(isLocalMedia(x) && removed.set(x, 1))).map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (isLocalMedia(x)) { removed.set(x, 1); o[k] = null; } else o[k] = walk(x);
      }
      return o;
    }
    return v;
  };
  const adventure = walk(adv);
  return { adventure, removed: [...removed.keys()].map(path => ({ path, kind: SOUND_EXT.test(path) ? 'son' : 'image' })) };
}

/*
 * Valeurs par défaut du format 1 du lien magique. Pour raccourcir le lien, une valeur égale à celle-ci n'est pas
 * écrite, et elle est remise telle quelle à l'import. C'est un instantané figé (et non DEFAULT_RULES / newSection()) :
 * si les réglages par défaut de l'application changent un jour, un ancien lien gardera exactement son sens.
 */
const V1_RULES = {
  stats: [{ id: 'habilete', label: 'Habileté', roll: '1d6+6' }, { id: 'endurance', label: 'Endurance', roll: '2d6+12' }, { id: 'chance', label: 'Chance', roll: '1d6+6' }],
  classes: [{ id: 'guerrier', label: 'Guerrier', description: 'Combat au corps à corps.', rolls: {}, items: [] }],
  gold: '0',
  provisions: 2,
  meal: { stat: 'endurance', heal: 4 },
  combat: { skill: 'habilete', health: 'endurance', damage: 2, luck: 'chance', fleeDamage: 2 },
  startItems: [],
  allowBack: true,
  spells: { enabled: false, stat: 'endurance', casters: [], typeCode: false, unknownCost: 0, book: [] },
  time: { enabled: false, mealRequired: true, stat: 'endurance', penalty: 3 },
};
const V1_META = { author: '', description: '', cover: null, sound: null };
const V1_SECTION = { title: '', text: '', image: null, place: '', onEnter: [], blocks: [], choices: [], ending: null };

/** Égalité profonde de valeurs JSON (l'ordre des clés ne compte pas). */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
}
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const omitDefaults = (obj, defaults) => { if (isObj(obj)) for (const [k, v] of Object.entries(defaults)) if (k in obj && same(obj[k], v)) delete obj[k]; };
const fillDefaults = (obj, defaults) => { for (const [k, v] of Object.entries(defaults)) if (!(k in obj)) obj[k] = structuredClone(v); };

/** Retire les valeurs par défaut (règles, informations, paragraphes) et la date de modification. Modifie `adv`. */
function compact(adv) {
  omitDefaults(adv.rules, V1_RULES);
  if (isObj(adv.meta)) { omitDefaults(adv.meta, V1_META); delete adv.meta.updated; }
  for (const s of Object.values(isObj(adv.sections) ? adv.sections : {})) omitDefaults(s, V1_SECTION);
  return adv;
}

/** Remet les valeurs omises par compact(). Modifie `data`. */
function expand(data) {
  data.rules = isObj(data.rules) ? data.rules : {};
  fillDefaults(data.rules, V1_RULES);
  data.meta = isObj(data.meta) ? data.meta : {};
  fillDefaults(data.meta, V1_META);
  for (const s of Object.values(data.sections)) if (isObj(s)) fillDefaults(s, V1_SECTION);
  return data;
}

/* ------------------------------------------------------------------ */
/* Lien magique : aller et retour                                      */
/* ------------------------------------------------------------------ */

/**
 * Transforme une aventure en jeton de lien magique.
 * Renvoie { token, removed, jsonBytes } ; l'aventure reçue n'est pas modifiée.
 */
export function packAdventure(adv) {
  const { adventure, removed } = stripLocalMedia(adv);
  compact(adventure);
  const json = strToU8(JSON.stringify(adventure));
  const body = deflateSync(json, { level: 9 });
  const out = new Uint8Array(HEADER + body.length);
  const dv = new DataView(out.buffer);
  out[0] = TOKEN_VERSION;
  dv.setUint32(1, json.length);
  dv.setUint16(5, Math.min(removed.length, 0xffff));
  dv.setUint32(7, crc32(json, crc32(out.subarray(5, 7))));
  out.set(body, HEADER);
  return { token: toBase64url(out), removed, jsonBytes: json.length };
}

/** Nettoie un jeton recopié à la main ou coupé par un courriel (espaces, retours à la ligne, %xx). */
export function cleanToken(token) {
  let s = String(token ?? '').replace(/\s+/g, '');
  if (s.includes('%')) { try { s = decodeURIComponent(s); } catch { /* laissé tel quel : l'erreur sera signalée plus loin */ } }
  return s;
}

/**
 * Jeton → { adventure (normalisée), missingMedia }. Lève une ShareError (code, title, message) si le lien est abîmé.
 */
export function unpackAdventure(token) {
  const t = cleanToken(token);
  if (!t) throw new ShareError('vide');
  // Lecture souple d'abord : un lien coupé doit être signalé comme « coupé », pas comme « modifié ».
  const bytes = fromBase64url(t, { strict: false });
  if (bytes.length <= HEADER) throw new ShareError(bytes.length && bytes[0] > TOKEN_VERSION ? 'version' : 'tronque');
  if (bytes[0] > TOKEN_VERSION) throw new ShareError('version');
  if (bytes[0] !== TOKEN_VERSION) throw new ShareError('abime');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = dv.getUint32(1), missingMedia = dv.getUint16(5), crc = dv.getUint32(7);
  if (size > JSON_MAX) throw new ShareError('taille');
  let json;
  // Un octet de plus que la taille annoncée : si le flux en produit davantage, la vérification échoue.
  try { json = inflateSync(bytes.subarray(HEADER), { out: new Uint8Array(size + 1) }); }
  catch { throw new ShareError('tronque'); }
  if (json.length < size) throw new ShareError('tronque');
  if (json.length !== size || crc32(json, crc32(bytes.subarray(5, 7))) !== crc || !tailIsClean(t)) throw new ShareError('abime');
  let data;
  try { data = JSON.parse(strFromU8(json)); } catch { throw new ShareError('illisible'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.sections || typeof data.sections !== 'object'
    || Array.isArray(data.sections) || !Object.keys(data.sections).length) throw new ShareError('pas-aventure');
  if (data.format && !String(data.format).startsWith('livre-heros/')) throw new ShareError('pas-aventure');
  const adventure = normalizeAdventure(expand(data));
  adventure.meta.title = String(adventure.meta.title || 'Sans titre');
  if (!isSafeId(adventure.id)) adventure.id = slug(adventure.id || adventure.meta.title);
  return { adventure, missingMedia };
}

/** Identifiant utilisable tel quel dans une URL et dans le stockage local. */
export const isSafeId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(id);

/** Nouvel identifiant (« titre-x7k2 ») absent de `taken` (Set). `rand` permet des tests reproductibles. */
export function uniqueId(title, taken = new Set(), rand = Math.random) {
  const base = slug(title);
  for (let i = 0; i < 200; i++) {
    const id = `${base}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
    if (!taken.has(id)) return id;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ------------------------------------------------------------------ */
/* Liens                                                               */
/* ------------------------------------------------------------------ */

/** Adresse de l'application sans ancre ni paramètres (ex. « https://exemple.org/livre/ »). */
export const baseOf = href => String(href).split('#')[0].split('?')[0];
export const playLink = (base, id) => `${base}#/jouer/${encodeURIComponent(id)}`;
export const importLink = (base, token) => `${base}#/importer/${token}`;

/** Que peut-on faire d'un lien de cette longueur ? 'qr' (QR code + lien), 'link' (lien seul), 'file' (fichier). */
export function shareMode(length) {
  if (length <= QR_MAX) return 'qr';
  if (length < LINK_MAX) return 'link';
  return 'file';
}

/**
 * Reconnaît un lien collé par l'utilisateur : lien magique, lien direct vers une aventure, ou jeton seul.
 * Renvoie { kind: 'import', token } | { kind: 'play', id } | null.
 */
export function parseSharedLink(text) {
  const s = String(text ?? '').replace(/\s+/g, '');
  if (!s) return null;
  const dec = x => { try { return decodeURIComponent(x); } catch { return x; } };
  let m = s.match(/#\/importer\/([^?#/]+)/);
  if (m) return { kind: 'import', token: dec(m[1]) };
  m = s.match(/#\/jouer\/([^?#/]+)/);
  if (m) return { kind: 'play', id: dec(m[1]) };
  if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return { kind: 'import', token: s };
  return null;
}

/* ------------------------------------------------------------------ */
/* QR code                                                             */
/* ------------------------------------------------------------------ */

/**
 * Matrice d'un QR code sous forme de tracé SVG (une ligne par suite de modules noirs), marge de 4 modules.
 * Correction d'erreur M pour un lien court, L pour un lien long (modules plus gros, donc plus lisibles).
 * Renvoie { size, modules, level, path } ou null si le texte est trop long.
 */
export function qrMatrix(text, level) {
  const lvl = level || (String(text).length <= 400 ? 'M' : 'L');
  let q;
  try { q = qrcode(0, lvl); q.addData(String(text), 'Byte'); q.make(); } catch { return null; }
  const n = q.getModuleCount(), m = 4;
  const parts = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!q.isDark(r, c)) { c++; continue; }
      let e = c;
      while (e < n && q.isDark(r, e)) e++;
      parts.push(`M${c + m} ${r + m}h${e - c}v1h-${e - c}z`);
      c = e;
    }
  }
  return { size: n + 2 * m, modules: n, level: lvl, path: parts.join('') };
}

const escXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Fichier SVG autonome du QR code (noir sur blanc, toujours : c'est ce que lisent les téléphones). */
export function qrSvg(text, { title = '', level, scale = 8 } = {}) {
  const q = qrMatrix(text, level);
  if (!q) return null;
  const px = q.size * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${q.size} ${q.size}" width="${px}" height="${px}" shape-rendering="crispEdges">`
    + (title ? `<title>${escXml(title)}</title>` : '')
    + `<rect width="${q.size}" height="${q.size}" fill="#fff"/><path fill="#000" d="${q.path}"/></svg>`;
}

/** « 1 834 » : nombre avec espace fine insécable, à la française. */
export const frNumber = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** « 12 ko », « 1,4 Mo ». */
export function frSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${frNumber(bytes / 1024)} ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}
