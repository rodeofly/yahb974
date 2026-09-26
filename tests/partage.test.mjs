import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, strToU8 } from '../js/lib/fflate.js';
import { newAdventure, normalizeAdventure } from '../js/core/rules.js';
import {
  toBase64url, fromBase64url, crc32, isLocalMedia, stripLocalMedia, packAdventure, unpackAdventure, ShareError,
  shareMode, QR_MAX, LINK_MAX, JSON_MAX, parseSharedLink, qrMatrix, qrSvg, uniqueId, isSafeId, importLink, playLink,
  baseOf, cleanToken, frNumber, frSize, TOKEN_VERSION,
} from '../js/plugins/partage/core.js';

const BASE = 'https://rodeofly.github.io/yahb974/';

function sample() {
  const a = newAdventure('Le Pont des Soupirs');
  a.id = 'le-pont-des-soupirs-ab12';
  a.meta.updated = '2026-09-01T08:00:00.000Z';
  a.meta.author = 'Ibrahim';
  a.meta.description = 'Une aventure à la Réunion : « cirques », volcans et énigmes — $x^2 = 4$.';
  a.meta.cover = 'images/couverture-kx1.webp';
  a.meta.sound = 'sons/pluie-kx2.mp3';
  a.items = { cle: { name: 'Clé d’argent', image: 'images/cle-kx3.png' }, carte: { name: 'Carte', image: 'https://exemple.org/carte.png' } };
  a.sections = {
    '1': { title: 'Départ', text: 'Vous vous éveillez à l’aube. 🌋 Où aller ?', image: 'images/1-kx4.webp', sound: 'sons/vent-kx5.ogg',
      choices: [{ text: 'Le pont', to: '2' }, { text: 'La grotte', to: '3', if: { has: 'cle' } }] },
    '2': { text: 'Un gobelin surgit.', blocks: [{ type: 'combat', enemies: [{ name: 'Gobelin', skill: 5, health: 5, image: 'images/gobelin-kx6.webp' }], win: '3' }] },
    '3': { text: 'Victoire !', ending: 'victory', gallery: ['images/a-kx7.png', 'légende', 'images/a-kx7.png'] },
  };
  return normalizeAdventure(a);
}

/** Petit générateur reproductible pour fabriquer des textes peu compressibles. */
function words(n, seed = 1) {
  const letters = 'abcdefghijklmnopqrstuvwxyzéèàç';
  let s = seed >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 8; };
  return Array.from({ length: n }, () => Array.from({ length: 2 + (r() % 8) }, () => letters[r() % letters.length]).join('')).join(' ');
}
function bigAdventure(sections, wordsPer, seed = 7) {
  const a = newAdventure('Grande aventure');
  a.id = `grande-aventure-${sections}`;
  a.meta.updated = '2026-09-01T08:00:00.000Z';
  a.sections = {};
  for (let i = 1; i <= sections; i++) {
    a.sections[String(i)] = { text: words(wordsPer, seed + i), choices: i < sections ? [{ text: 'Continuer', to: String(i + 1) }] : [], ending: i === sections ? 'victory' : null };
  }
  return normalizeAdventure(a);
}

/** Construit un jeton à la main (pour tester les en-têtes abîmés). */
function rawToken({ version = TOKEN_VERSION, json = '{"sections":{"1":{"text":"x"}}}', size, crc, media = 0, body } = {}) {
  const u = strToU8(json);
  const b = body || deflateSync(u);
  const out = new Uint8Array(11 + b.length);
  const dv = new DataView(out.buffer);
  out[0] = version;
  dv.setUint32(1, size ?? u.length);
  dv.setUint16(5, media);
  dv.setUint32(7, crc ?? crc32(u, crc32(out.subarray(5, 7))));
  out.set(b, 11);
  return toBase64url(out);
}

/** Ce que doit redonner l'import : l'aventure sans ses fichiers locaux, normalisée, sans date de modification. */
function expected(adv) {
  const a = normalizeAdventure(stripLocalMedia(adv).adventure);
  delete a.meta.updated;
  return a;
}

const codeOf = fn => { try { fn(); return 'aucune erreur'; } catch (e) { return e instanceof ShareError ? e.code : `autre erreur : ${e.message}`; } };

test('base64url : aller-retour et compatibilité avec Node', () => {
  for (let len = 0; len < 70; len++) {
    const bytes = new Uint8Array(len).map((_, i) => (i * 97 + len * 13) & 255);
    const t = toBase64url(bytes);
    assert.equal(t, Buffer.from(bytes).toString('base64url'));
    assert.match(t, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual([...fromBase64url(t)], [...bytes]);
  }
  // base64 classique avec remplissage accepté en lecture
  const b = new Uint8Array([251, 255, 191, 0, 1]);
  assert.deepEqual([...fromBase64url(Buffer.from(b).toString('base64'))], [...b]);
});

test('CRC-32 : valeur de référence', () => {
  assert.equal(crc32(strToU8('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(strToU8('6789'), crc32(strToU8('12345'))), 0xcbf43926, 'enchaînement');
});

test('fichiers locaux reconnus, URL et textes ignorés', () => {
  for (const p of ['images/1.webp', 'sons/pluie-kx2.mp3', 'images/sous/dossier/x.PNG', 'cartes/ile.svg']) assert.ok(isLocalMedia(p), p);
  for (const p of ['https://exemple.org/a.png', 'data:image/png;base64,AAA', 'blob:xyz/a.png', 'image.png', 'un texte avec images/a.png', 'images/a.txt', null, 3]) assert.ok(!isLocalMedia(p), String(p));
});

test('les images et sons locaux sont retirés, partout, sans toucher l’original', () => {
  const adv = sample();
  const before = JSON.stringify(adv);
  const { adventure, removed } = stripLocalMedia(adv);
  assert.equal(JSON.stringify(adv), before, 'l’aventure reçue ne doit pas être modifiée');
  assert.equal(adventure.meta.cover, null);
  assert.equal(adventure.meta.sound, null);
  assert.equal(adventure.sections['1'].image, null);
  assert.equal(adventure.sections['1'].sound, null);
  assert.equal(adventure.sections['2'].blocks[0].enemies[0].image, null);
  assert.equal(adventure.items.cle.image, null);
  assert.equal(adventure.items.carte.image, 'https://exemple.org/carte.png', 'une URL publique reste');
  assert.deepEqual(adventure.sections['3'].gallery, ['légende'], 'les listes (greffons) sont nettoyées aussi');
  assert.equal(removed.length, 7);
  assert.equal(removed.filter(r => r.kind === 'son').length, 2);
});

test('lien magique : aller-retour complet', () => {
  const adv = sample();
  const before = JSON.stringify(adv);
  const { token, removed, jsonBytes } = packAdventure(adv);
  assert.equal(JSON.stringify(adv), before, 'packAdventure ne modifie pas l’aventure');
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'uniquement des caractères sûrs dans une URL');
  assert.ok(token.length < jsonBytes, 'le lien est compressé');
  const { adventure, missingMedia } = unpackAdventure(token);
  assert.equal(missingMedia, removed.length);
  assert.deepEqual(adventure, expected(adv));
  assert.equal(adventure.sections['1'].text, 'Vous vous éveillez à l’aube. 🌋 Où aller ?');
  assert.equal(adventure.meta.description, adv.meta.description);
  assert.deepEqual(adventure.sections['1'].choices[1].if, { has: 'cle' });
  // le jeton survit à l'ancre d'une URL, au découpage d'un courriel et à l'encodage %xx
  const url = importLink(BASE, token);
  const back = parseSharedLink(url.replace(/(.{60})/g, '$1\n'));
  assert.equal(back.kind, 'import');
  assert.deepEqual(unpackAdventure(back.token).adventure, adventure);
  assert.deepEqual(unpackAdventure(encodeURIComponent(token)).adventure, adventure);
  assert.deepEqual(unpackAdventure(token + '='.repeat((4 - (token.length % 4)) % 4)).adventure, adventure, 'remplissage « = » toléré');
});

test('lien magique : une aventure sans images ne signale rien', () => {
  const a = normalizeAdventure(newAdventure('Simple'));
  const { token, removed } = packAdventure(a);
  assert.equal(removed.length, 0);
  assert.equal(unpackAdventure(token).missingMedia, 0);
  assert.deepEqual(unpackAdventure(token).adventure, expected(a));
});

test('lien magique : les valeurs par défaut ne sont pas écrites, les règles personnalisées sont gardées', () => {
  const a = normalizeAdventure(newAdventure('Vide'));
  const empty = importLink(BASE, packAdventure(a).token);
  assert.ok(empty.length < 300, `une aventure vide tient en ${empty.length} caractères`);
  const b = sample();
  b.rules.stats.push({ id: 'magie', label: 'Magie', roll: '2d6' });
  b.rules.provisions = 0;
  b.rules.spells.enabled = true;
  b.rules.spells.book = [{ code: 'ZAP', name: 'Éclair', cost: 2 }];
  b.rules.zefor = { niveau: 3 }; // règle ajoutée par un greffon
  b.sections['2'].place = 'Pont';
  const back = unpackAdventure(packAdventure(b).token).adventure;
  assert.deepEqual(back.rules, b.rules);
  assert.deepEqual(back, expected(b));
  // un jeton écrit à la main sans règles reçoit les règles du format 1
  const bare = unpackAdventure(rawToken({ json: '{"sections":{"1":{"text":"Seul"}}}' })).adventure;
  assert.equal(bare.rules.provisions, 2);
  assert.deepEqual(bare.rules.stats.map(x => x.id), ['habilete', 'endurance', 'chance']);
  assert.equal(bare.sections['1'].ending, null);
  assert.deepEqual(bare.sections['1'].choices, []);
});

test('lien abîmé : messages clairs, jamais d’erreur brute', () => {
  const { token } = packAdventure(sample());
  assert.equal(codeOf(() => unpackAdventure('')), 'vide');
  assert.equal(codeOf(() => unpackAdventure(undefined)), 'vide');
  assert.equal(codeOf(() => unpackAdventure(token.slice(0, 5))), 'tronque');
  assert.equal(codeOf(() => unpackAdventure(token.slice(0, -40))), 'tronque');
  assert.equal(codeOf(() => unpackAdventure(token.slice(0, 20) + '!' + token.slice(21))), 'caracteres');
  assert.equal(codeOf(() => unpackAdventure(token.slice(0, 30) + 'é' + token.slice(31))), 'caracteres');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ version: 2 }))), 'version');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ version: 0 }))), 'abime');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ crc: 12345 }))), 'abime');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ size: 5 }))), 'abime');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ size: 500 }))), 'tronque');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ size: JSON_MAX + 1 }))), 'taille');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ json: '{"titre":"pas une aventure"}' }))), 'pas-aventure');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ json: '[1,2,3]' }))), 'pas-aventure');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ json: '{"format":"autre/1","sections":{"1":{}}}' }))), 'pas-aventure');
  assert.equal(codeOf(() => unpackAdventure(rawToken({ json: '{"sections": ' }))), 'illisible');
  const e = (() => { try { unpackAdventure(token.slice(0, -40)); } catch (x) { return x; } })();
  assert.ok(e.title && e.message.length > 20, 'titre et explication en français');
});

test('lien abîmé : toute coupure ou altération est détectée', () => {
  const { token } = packAdventure(sample());
  for (let cut = 1; cut < token.length; cut++) {
    assert.equal(codeOf(() => unpackAdventure(token.slice(0, cut))), 'tronque', `coupé à ${cut}`);
  }
  for (let i = 0; i < token.length; i += 3) {
    const ch = token[i] === 'A' ? 'B' : 'A';
    const c = codeOf(() => unpackAdventure(token.slice(0, i) + ch + token.slice(i + 1)));
    assert.ok(c !== 'aucune erreur' && !c.startsWith('autre'), `altéré en ${i} : ${c}`);
  }
});

test('lien piégé : une bombe de décompression est refusée', () => {
  const huge = '{"sections":{"1":{"text":"' + 'a'.repeat(3_000_000) + '"}}}';
  // la taille annoncée est petite, le flux réel énorme : la vérification échoue sans tout décompresser
  assert.equal(codeOf(() => unpackAdventure(rawToken({ json: huge, size: 1000 }))), 'abime');
});

test('identifiants : nettoyés et uniques', () => {
  const t = rawToken({ json: JSON.stringify({ id: '../../pirate', meta: { title: 'Pirate' }, sections: { 1: { text: 'x' } } }) });
  assert.equal(unpackAdventure(t).adventure.id, 'pirate');
  assert.ok(isSafeId('la-tour-de-brume'));
  assert.ok(!isSafeId('a/b') && !isSafeId('') && !isSafeId(null));
  let i = 0;
  const seq = [0, 0, 0.5];
  const rand = () => seq[i++ % seq.length];
  const taken = new Set(['mon-livre-0000']);
  const id = uniqueId('Mon livre', taken, rand);
  assert.match(id, /^mon-livre-[0-9a-z]{4}$/);
  assert.ok(!taken.has(id));
  assert.equal(uniqueId('Mon livre', new Set(['mon-livre-0000', 'mon-livre-2']), () => 0), 'mon-livre-3');
});

test('taille : seuils du QR code, du lien et du fichier', () => {
  assert.equal(shareMode(80), 'qr');
  assert.equal(shareMode(QR_MAX), 'qr');
  assert.equal(shareMode(QR_MAX + 1), 'link');
  assert.equal(shareMode(LINK_MAX - 1), 'link');
  assert.equal(shareMode(LINK_MAX), 'file');
  const small = importLink(BASE, packAdventure(sample()).token);
  assert.equal(shareMode(small.length), 'qr', `petite aventure : ${small.length} caractères`);
  const medium = importLink(BASE, packAdventure(bigAdventure(30, 100)).token);
  assert.equal(shareMode(medium.length), 'link', `aventure moyenne : ${medium.length} caractères`);
  const huge = importLink(BASE, packAdventure(bigAdventure(200, 100)).token);
  assert.equal(shareMode(huge.length), 'file', `grande aventure : ${huge.length} caractères`);
  assert.deepEqual(unpackAdventure(parseSharedLink(huge).token).adventure, expected(bigAdventure(200, 100)));
});

test('liens : adresse de base, lien direct, liens collés', () => {
  assert.equal(baseOf('https://x.org/livre/index.html?a=1#/jouer/z'), 'https://x.org/livre/index.html');
  assert.equal(playLink(BASE, 'la tour'), BASE + '#/jouer/la%20tour');
  assert.deepEqual(parseSharedLink(`  ${BASE}#/jouer/la-tour-de-brume  `), { kind: 'play', id: 'la-tour-de-brume' });
  assert.deepEqual(parseSharedLink('http://localhost:8080/#/importer/AbCd_-12?x=1'), { kind: 'import', token: 'AbCd_-12' });
  assert.deepEqual(parseSharedLink('AQAAAAAAAAAAAAAAAAAAAA'), { kind: 'import', token: 'AQAAAAAAAAAAAAAAAAAAAA' });
  assert.equal(parseSharedLink('bonjour'), null);
  assert.equal(parseSharedLink(''), null);
  assert.equal(cleanToken(' ab\ncd \t'), 'abcd');
});

test('QR code : tracé SVG, lien court et long, texte trop long refusé', () => {
  const short = qrMatrix(playLink(BASE, 'la-tour-de-brume'));
  assert.equal(short.level, 'M');
  assert.equal(short.size, short.modules + 8, 'marge de 4 modules');
  assert.match(short.path, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
  assert.deepEqual(qrMatrix(playLink(BASE, 'la-tour-de-brume')), short, 'déterministe');
  const long = qrMatrix(BASE + '#/importer/' + 'A'.repeat(QR_MAX - BASE.length - 11));
  assert.ok(long && long.level === 'L' && long.modules > short.modules);
  assert.equal(qrMatrix('x'.repeat(3500)), null);
  const svg = qrSvg('https://exemple.org', { title: 'Lien « <test> »' });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /<title>Lien « &lt;test&gt; »<\/title>/);
  assert.match(svg, /fill="#fff"/);
  assert.equal(qrSvg('x'.repeat(3500)), null);
});

test('nombres et tailles à la française', () => {
  assert.equal(frNumber(1834), '1 834');
  assert.equal(frNumber(60000), '60 000');
  assert.equal(frSize(512), '512 o');
  assert.equal(frSize(12 * 1024), '12 ko');
  assert.equal(frSize(1.4 * 1024 * 1024), '1,4 Mo');
});
