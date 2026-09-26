// Tests du greffon « zefor » (moteur pur) : empreintes, codes personnels, adresse du parcours,
// lecture et vérification des résultats (nonce, origine, exercice, score, signature ECDSA), état de la partie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import * as Z from '../js/plugins/zefor/core.js';
import { newAdventure, normalizeAdventure, createHero, start, targetsOf } from '../js/core/rules.js';
import { validate, renumber } from '../js/core/validate.js';
import { makeRng } from '../js/core/dice.js';

const ID = 'aventure-zefor';

function sample(block = {}) {
  const a = newAdventure('Zefor');
  a.id = ID;
  a.sections = {
    '1': { text: 'La balance du passeur.', choices: [], onEnter: [], blocks: [{
      type: 'zefor', title: 'La balance', description: 'Équilibrez la **balance**.', url: 'https://zefor.maths974.fr/#parcours=abc',
      mode: 'code', codeHashes: [], success: '2', failure: '3', ...block,
    }] },
    '2': { text: 'Réussi.', ending: 'victory', choices: [], blocks: [], onEnter: [] },
    '3': { text: 'Raté.', ending: 'death', choices: [], blocks: [], onEnter: [] },
    '4': { text: 'Sans le défi.', choices: [{ text: 'Suite', to: '2' }], blocks: [], onEnter: [] },
  };
  return normalizeAdventure(a);
}
const hero = adv => start(createHero(adv, { seed: 4 }).state, adv).state;
const sha = s => createHash('sha256').update(s).digest('hex');

/* ---------- empreintes et codes ---------- */

test('codes : normalisation et empreinte SHA-256 de « sel:CODE »', async () => {
  assert.equal(Z.normalizeCode(' brume-4821 '), 'BRUME4821');
  assert.equal(Z.normalizeCode('Éclair à 3'), 'ECLAIRA3');
  assert.equal(await Z.codeHash(ID, 'brume 4821'), sha(`${ID}:BRUME4821`));
  assert.equal(await Z.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('codes : le bon code est accepté, un autre refusé, le sel survit à une copie', async () => {
  const adv = sample();
  const h = await Z.codeHash(ID, 'BRUME-4821');
  const b = { ...adv.sections['1'].blocks[0], codeHashes: [h.toUpperCase()], codeSalt: ID };
  assert.equal(await Z.checkCode(adv, b, 'brume4821'), 'static');
  assert.equal(await Z.checkCode(adv, b, 'BRUME 4822'), null);
  assert.equal(await Z.checkCode(adv, b, '   '), null);
  const copy = { ...adv, id: 'zefor-copie' };
  assert.equal(await Z.checkCode(copy, b, 'BRUME-4821'), 'static', 'codeSalt garde l’identifiant d’origine');
  assert.equal(await Z.checkCode(copy, { ...b, codeSalt: undefined }, 'BRUME-4821'), null);
});

test('codes personnels : HMAC-SHA256 du nonce, 6 caractères de Crockford, liés à la partie', async () => {
  const key = Z.newCodeKey();
  const raw = Buffer.from(key, 'base64url');
  assert.equal(raw.length, 32);
  const nonce = Z.newNonce();
  const code = await Z.personalCode(key, nonce);
  // Calcul indépendant avec node:crypto (ce que ferait zefor côté serveur).
  const mac = createHmac('sha256', raw).update(nonce).digest();
  const bits = [...mac.subarray(0, 4)].map(b => b.toString(2).padStart(8, '0')).join('');
  const expected = Array.from({ length: 6 }, (_, i) => Z.CROCKFORD[parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join('');
  assert.equal(code, expected);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{6}$/);
  const adv = sample({ codeHashes: [] });
  adv.rules.zefor.codeKey = key;
  const b = adv.sections['1'].blocks[0];
  const typed = Z.formatPersonal(code).toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
  assert.equal(await Z.checkCode(adv, b, typed, nonce), 'personal', 'O/0 et I/L/1 confondus sont acceptés');
  assert.equal(await Z.checkCode(adv, b, code, Z.newNonce()), null, 'le code d’une autre partie est refusé');
  assert.equal(await Z.checkCode(adv, b, code), null, 'sans nonce, pas de code personnel');
});

test('nonce : aléatoire, base64url, 22 caractères', () => {
  const a = Z.newNonce(), b = Z.newNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual([...Z.b64urlToBytes(Z.bytesToB64url(new Uint8Array([251, 255, 0, 62])))], [251, 255, 0, 62]);
  assert.equal(Z.b64urlToBytes('a b+c/d'.replace(' ', '+')).length, 5);
  assert.equal(Z.b64urlToBytes('%%%'), null);
});

/* ---------- adresse du parcours ---------- */

test('adresse du parcours : paramètres lh_*, le fragment # de zefor est conservé', () => {
  const adv = sample({ exercise: 'pezali:3' });
  const b = adv.sections['1'].blocks[0];
  const u = new URL(Z.buildUrl(b, { nonce: 'N0nce_test-123', returnUrl: 'https://rodeofly.github.io/yahb974/#/zefor-retour/x', origin: 'https://rodeofly.github.io' }));
  assert.equal(u.origin, 'https://zefor.maths974.fr');
  assert.equal(u.hash, '#parcours=abc');
  assert.equal(u.searchParams.get('lh_nonce'), 'N0nce_test-123');
  assert.equal(u.searchParams.get('lh_mode'), 'code');
  assert.equal(u.searchParams.get('lh_return'), 'https://rodeofly.github.io/yahb974/#/zefor-retour/x');
  assert.equal(u.searchParams.get('lh_origin'), 'https://rodeofly.github.io');
  assert.equal(u.searchParams.get('lh_exercise'), 'pezali:3');
  assert.equal(u.searchParams.get('m974'), null);
  const cadre = new URL(Z.buildUrl({ ...b, mode: 'message', display: 'cadre' }, { nonce: 'abcdefgh' }));
  assert.equal(cadre.searchParams.get('m974'), '1');
  assert.equal(cadre.searchParams.get('session'), 'abcdefgh');
  assert.equal(cadre.searchParams.get('activity'), 'pezali:3');
  assert.equal(Z.buildUrl({ url: 'javascript:alert(1)' }, { nonce: 'x' }), null);
  assert.equal(Z.buildUrl({ url: '' }, { nonce: 'x' }), null);
});

/* ---------- lecture des résultats ---------- */

test('messages : format zefor:result et format m974:attempt', () => {
  const r = Z.parseMessage({ type: 'zefor:result', exercise: 'blokaly:maze:4', success: true, score: 85, nonce: 'n1', signature: 'abc' });
  assert.deepEqual(r, { exercise: 'blokaly:maze:4', success: true, score: 85, scoreText: '85', nonce: 'n1', signature: 'abc', format: 'zefor' });
  const m = Z.parseMessage({ type: 'm974:attempt', version: 1, app: 'zefor', session: 'n2', payload: { app: 'zefor', activityId: 'pezali:2', ts: 'x', outcome: { passed: true, score: 3, stars: 3, maxStars: 4 } } });
  assert.equal(m.nonce, 'n2'); assert.equal(m.exercise, 'pezali:2'); assert.equal(m.success, true); assert.equal(m.score, 3); assert.equal(m.stars, 3); assert.equal(m.format, 'm974');
  assert.equal(Z.parseMessage({ type: 'm974:ready' }), null);
  assert.equal(Z.parseMessage({ type: 'zefor:result', success: true }), null, 'nonce obligatoire');
  assert.equal(Z.parseMessage('zefor:result'), null);
  assert.equal(Z.parseMessage(null), null);
});

test('adresse de retour : lecture des paramètres (objet ou URLSearchParams)', () => {
  const q = new URLSearchParams('nonce=abc_DEF-12&exercise=aljeb%3A5&success=1&score=72&sig=AB+CD');
  const r = Z.parseReturn(q);
  assert.equal(r.nonce, 'abc_DEF-12'); assert.equal(r.exercise, 'aljeb:5'); assert.equal(r.success, true);
  assert.equal(r.score, 72); assert.equal(r.scoreText, '72'); assert.equal(r.signature, 'AB CD'); assert.equal(r.format, 'retour');
  assert.equal(Z.parseReturn({ nonce: 'x', success: '0' }).success, false);
  assert.equal(Z.parseReturn({ nonce: 'x', success: 'true', score: '12,5' }).score, 12.5);
  assert.equal(Z.parseReturn({ success: '1' }), null);
  assert.equal(Z.parseReturn({ lh_nonce: 'y', success: 'oui' }).nonce, 'y');
  assert.equal(Z.signedData(Z.parseReturn({ nonce: 'n', exercise: 'e', success: '1', score: '7' })), 'e|1|7|n');
  assert.equal(Z.signedData({ exercise: 'e', success: false, nonce: 'n' }), 'e|0||n');
});

/* ---------- vérification ---------- */

test('vérification : nonce, origine, exercice et score minimum', async () => {
  const adv = sample({ mode: 'message', minScore: 70 });
  const block = adv.sections['1'].blocks[0];
  const ok = { exercise: 'x', success: true, score: 80, scoreText: '80', nonce: 'N', signature: '' };
  assert.deepEqual(await Z.checkResult(ok, { adv, block, nonce: 'N', origin: 'https://zefor.maths974.fr' }), { ok: true, success: true, scoreOk: true, verified: false });
  assert.equal((await Z.checkResult(ok, { adv, block, nonce: 'AUTRE', origin: 'https://zefor.maths974.fr' })).reason, 'nonce');
  assert.equal((await Z.checkResult(ok, { adv, block, nonce: 'N', origin: 'https://pirate.example' })).reason, 'origin');
  assert.equal((await Z.checkResult(ok, { adv, block, nonce: undefined })).reason, 'nonce');
  assert.equal((await Z.checkResult(ok, { adv, block, nonce: 'N' })).ok, true, 'sans origine (BroadcastChannel, retour) : pas de contrôle d’origine');
  const low = await Z.checkResult({ ...ok, score: 50, scoreText: '50' }, { adv, block, nonce: 'N' });
  assert.equal(low.ok, true); assert.equal(low.success, false); assert.equal(low.scoreOk, false);
  const noScore = await Z.checkResult({ ...ok, score: null, scoreText: '' }, { adv, block, nonce: 'N' });
  assert.equal(noScore.success, false, 'score exigé mais absent');
  assert.equal((await Z.checkResult({ ...ok, success: false }, { adv, block, nonce: 'N' })).success, false);
  // Origine des règles (liste) prioritaire sur celle de l'adresse.
  adv.rules.zefor.origin = 'https://prof.maths974.fr/, https://rodeofly.github.io';
  assert.deepEqual(Z.allowedOrigins(adv, block), ['https://prof.maths974.fr', 'https://rodeofly.github.io']);
  assert.equal((await Z.checkResult(ok, { adv, block, nonce: 'N', origin: 'https://zefor.maths974.fr' })).reason, 'origin');
  assert.equal((await Z.checkResult(ok, { adv, block, nonce: 'N', origin: 'https://rodeofly.github.io' })).ok, true);
  // Exercice attendu.
  const strict = { ...block, exercise: 'pezali:3' };
  assert.equal((await Z.checkResult(ok, { adv, block: strict, nonce: 'N' })).reason, 'exercise');
  assert.equal((await Z.checkResult({ ...ok, exercise: 'pezali:3' }, { adv, block: strict, nonce: 'N' })).ok, true);
});

test('signature ECDSA P-256 : générée avec WebCrypto, vérifiée, falsification détectée', async () => {
  const { publicJwk, privateJwk } = await Z.generateKeyPair();
  assert.deepEqual(Object.keys(publicJwk).sort(), ['crv', 'kty', 'x', 'y']);
  assert.ok(privateJwk.d);
  const adv = sample({ mode: 'retour' });
  adv.rules.zefor.publicKeyJwk = publicJwk;
  const block = adv.sections['1'].blocks[0];
  const nonce = Z.newNonce();
  const raw = { exercise: 'blokaly:turtle:2', success: true, score: 90, nonce };
  const sig = await Z.signResult(privateJwk, raw);
  assert.equal(Z.b64urlToBytes(sig).length, 64);
  // Par l'adresse de retour (le score arrive en texte, la signature en base64url).
  const viaUrl = Z.parseReturn(new URLSearchParams({ nonce, exercise: raw.exercise, success: '1', score: '90', sig }));
  assert.equal(await Z.verifySignature(publicJwk, viaUrl), true);
  assert.deepEqual(await Z.checkResult(viaUrl, { adv, block, nonce }), { ok: true, success: true, scoreOk: true, verified: true });
  // Par message.
  const viaMsg = Z.parseMessage({ type: 'zefor:result', ...raw, signature: sig });
  assert.equal((await Z.checkResult(viaMsg, { adv, block, nonce })).ok, true);
  // Falsifications.
  assert.equal((await Z.checkResult({ ...viaUrl, score: 99, scoreText: '99' }, { adv, block, nonce })).reason, 'signature');
  assert.equal((await Z.checkResult({ ...viaUrl, success: true, exercise: 'autre' }, { adv, block, nonce })).reason, 'signature');
  assert.equal((await Z.checkResult({ ...viaUrl, signature: '' }, { adv, block, nonce })).reason, 'unsigned');
  assert.equal((await Z.checkResult({ ...viaUrl, signature: 'nimporte-quoi' }, { adv, block, nonce })).reason, 'signature');
  const other = await Z.generateKeyPair();
  const forged = await Z.signResult(other.privateJwk, raw);
  assert.equal((await Z.checkResult({ ...viaUrl, signature: forged }, { adv, block, nonce })).reason, 'signature');
  // Un échec signé est authentique mais pas une réussite.
  const failSig = await Z.signResult(privateJwk, { ...raw, success: false });
  const fail = await Z.checkResult(Z.parseMessage({ type: 'zefor:result', ...raw, success: false, signature: failSig }), { adv, block, nonce });
  assert.equal(fail.ok, true); assert.equal(fail.success, false);
});

test('signature : format DER de node:crypto accepté, clé publique d’OpenSSL/Node lisible', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const parsed = Z.parseJwk(JSON.stringify(jwk));
  assert.equal(parsed.private, false);
  const r = { exercise: 'aljeb:1', success: true, score: 100, nonce: 'abcdEFGH' };
  const der = nodeSign('sha256', Buffer.from(Z.signedData(r)), privateKey); // DER par défaut
  assert.equal(await Z.verifySignature(parsed.jwk, { ...r, signature: der.toString('base64') }), true);
  const p1363 = nodeSign('sha256', Buffer.from(Z.signedData(r)), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  assert.equal(await Z.verifySignature(parsed.jwk, { ...r, signature: p1363.toString('base64url') }), true);
});

test('clé JWK collée : erreurs lisibles, partie privée écartée', async () => {
  assert.equal(Z.parseJwk('').error, 'vide');
  assert.match(Z.parseJwk('{pas du json').error, /JSON/);
  assert.match(Z.parseJwk({ kty: 'RSA' }).error, /P-256/);
  assert.match(Z.parseJwk({ kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' }).error, /coordonnées/);
  const { privateJwk } = await Z.generateKeyPair();
  const p = Z.parseJwk(privateJwk);
  assert.equal(p.private, true);
  assert.equal(p.jwk.d, undefined, 'seule la partie publique est gardée');
});

/* ---------- état de la partie ---------- */

test('partie : nonce gardé pendant l’attente, renouvelé après un échec', () => {
  const adv = sample({ mode: 'retour' });
  const s0 = hero(adv);
  const o1 = Z.openChallenge(s0, adv, 0, 'nonce-1');
  assert.equal(s0.blocks[0], undefined, 'état d’origine intact');
  assert.equal(o1.state.blocks[0].nonce, 'nonce-1');
  assert.equal(o1.state.blocks[0].status, 'pending');
  const o2 = Z.openChallenge(o1.state, adv, 0, 'nonce-2');
  assert.equal(o2.nonce, 'nonce-1'); assert.equal(o2.state.blocks[0].opened, 2);
  const f = Z.recordResult(o2.state, adv, 0, { success: false, score: 40, via: 'retour' });
  assert.equal(f.state.blocks[0].status, 'failure');
  assert.equal(f.messages[0].kind, 'loss');
  const o3 = Z.openChallenge(f.state, adv, 0, 'nonce-3');
  assert.equal(o3.nonce, 'nonce-3');
  assert.equal(o3.state.blocks[0].result, null);
});

test('partie : réussite → effets de réussite et paragraphe suivant, bilan enregistré', () => {
  const adv = sample({ successEffects: [{ op: 'gold', add: 5 }] });
  let s = hero(adv);
  const gold = s.gold;
  assert.throws(() => Z.continueChallenge(s, adv, 0), /pas encore réussi/);
  s = Z.wrongCode(s, 0).state;
  assert.equal(s.blocks[0].tries, 1); assert.equal(s.blocks[0].wrong, true);
  const r = Z.recordResult(s, adv, 0, { success: true, score: 95, via: 'code' });
  assert.match(r.messages[0].text, /réussi \(score : 95\)/);
  const c = Z.continueChallenge(r.state, adv, 0);
  assert.equal(c.state.section, '2');
  assert.equal(c.state.gold, gold + 5);
  assert.deepEqual(c.state.zefor.done['1#0'], { ok: true, via: 'code', score: 95, title: 'La balance', section: '1' });
  assert.deepEqual(Z.summary(c.state), { list: [c.state.zefor.done['1#0']], ok: 1, total: 1 });
});

test('partie : abandon vers l’échec, continuer sans le défi avec son prix', () => {
  const adv = sample({ allowSkip: true, skipTo: '4', skipEffects: [{ op: 'stat', stat: 'chance', add: -1 }], failureEffects: [{ op: 'flag', flag: 'balance-ratee' }] });
  const s = hero(adv);
  const f = Z.failChallenge(s, adv, 0);
  assert.equal(f.state.section, '3');
  assert.equal(f.state.flags['balance-ratee'], true);
  assert.equal(f.state.zefor.done['1#0'].via, 'abandon');
  const k = Z.skipChallenge(s, adv, 0);
  assert.equal(k.state.section, '4');
  assert.equal(k.state.stats.chance.cur, s.stats.chance.cur - 1);
  assert.equal(k.messages[0].text, 'Vous continuez sans relever le défi.');
  assert.equal(k.state.zefor.done['1#0'].ok, false);
  const noSkip = sample();
  assert.throws(() => Z.skipChallenge(hero(noSkip), noSkip, 0), /ne peut pas/);
  const noFail = sample({ failure: '' });
  assert.throws(() => Z.failChallenge(hero(noFail), noFail, 0), /pas de paragraphe/);
  // Sans skipTo : on continue vers la réussite.
  const toSuccess = sample({ allowSkip: true });
  assert.equal(Z.skipChallenge(hero(toSuccess), toSuccess, 0).state.section, '2');
});

test('partie : une ancienne sauvegarde sans state.zefor fonctionne', () => {
  const adv = sample();
  const s = hero(adv);
  delete s.zefor;
  const r = Z.recordResult(s, adv, 0, { success: true, via: 'simulation' });
  assert.equal(Z.continueChallenge(r.state, adv, 0).state.zefor.done['1#0'].via, 'simulation');
  assert.deepEqual(Z.summary({}), { list: [], ok: 0, total: 0 });
});

/* ---------- intégration au moteur ---------- */

test('moteur : règles par défaut, héros, cibles du graphe, renumérotation', () => {
  const plainAdv = normalizeAdventure(newAdventure('Sans zefor'));
  assert.deepEqual(plainAdv.rules.zefor, { origin: '', publicKeyJwk: null, codeKey: '' });
  assert.deepEqual(createHero(plainAdv, { seed: 1 }).state.zefor, { done: {} });
  const adv = sample({ allowSkip: true, skipTo: '4' });
  const t = targetsOf(adv.sections['1']);
  assert.deepEqual(t.map(x => [x.to, x.kind, x.label]), [['2', 'zefor', 'défi réussi'], ['3', 'zefor', 'défi raté'], ['4', 'zefor', 'sans le défi']]);
  const { adventure, mapping } = renumber(adv, makeRng(3));
  const b = adventure.sections[mapping['1']].blocks[0];
  assert.equal(b.success, mapping['2']); assert.equal(b.failure, mapping['3']); assert.equal(b.skipTo, mapping['4']);
});

test('vérification de l’aventure : erreurs et avertissements du bloc', async () => {
  const msgs = adv => validate(adv).filter(p => p.section === '1').map(p => `${p.level}: ${p.message}`);
  const noCode = msgs(sample());
  assert.ok(noCode.some(m => m.startsWith('error') && /aucun code de réussite/.test(m)));
  const withCode = sample({ codeHashes: [await Z.codeHash(ID, 'OK')] });
  assert.ok(!msgs(withCode).some(m => m.startsWith('error')));
  assert.ok(msgs(sample({ success: '' })).some(m => /destination en cas de réussite/.test(m)));
  assert.ok(msgs(sample({ url: 'ftp://x' })).some(m => m.startsWith('error') && /https/.test(m)));
  assert.ok(msgs(sample({ url: '' })).some(m => m.startsWith('warning') && /vide/.test(m)));
  const msg = sample({ mode: 'message', url: '' });
  assert.ok(msgs(msg).some(m => m.startsWith('error') && /origine/.test(m)));
  assert.ok(msgs(sample({ mode: 'retour' })).some(m => m.startsWith('info') && /non signés/.test(m)));
  const other = sample({ mode: 'message' });
  other.rules.zefor.origin = 'https://ailleurs.example';
  assert.ok(msgs(other).some(m => m.startsWith('warning') && /origine autorisée/.test(m)));
  assert.ok(msgs(sample({ minScore: 'beaucoup', codeHashes: ['zz'] })).some(m => /n'est pas un nombre/.test(m)));
  assert.ok(msgs(sample({ codeHashes: ['zz'] })).some(m => /illisibles/.test(m)));
});

test('impression : consigne de livre-jeu avec l’adresse et les renvois', async () => {
  const { ext } = await import('../js/core/plugins.js');
  const adv = sample({ minScore: 12.5, allowSkip: true, skipTo: '4', skipEffects: [{ op: 'stat', stat: 'chance', add: -1 }] });
  const h = { go: n => `rendez-vous au <b>${n}</b>`, esc: s => String(s).replace(/</g, '&lt;'), effectText: e => `vous perdez 1 point de CHANCE.` };
  const out = ext.blocks.get('zefor').print(adv.sections['1'].blocks[0], adv, h);
  assert.match(out, /Défi Zefor\u202F: La balance\./);
  assert.match(out, /Ce défi se fait sur zefor974\u202F:<\/p><p class="zf-url">https:\/<wbr>\/<wbr>zefor\.maths974\.fr\/<wbr>#<wbr>parcours=<wbr>abc<\/p>/);
  assert.match(out, /Quand vous l'avez réussi, notez le code obtenu, puis rendez-vous au <b>2<\/b>\./);
  assert.match(out, /Équilibrez la balance\./);
  assert.match(out, /au moins 12,5/);
  assert.match(out, /Si vous n'y parvenez pas, rendez-vous au <b>3<\/b>/);
  assert.match(out, /renoncer au défi\u202F: vous perdez 1 point de CHANCE, rendez-vous au <b>4<\/b>/);
  const withFx = ext.blocks.get('zefor').print({ ...adv.sections['1'].blocks[0], successEffects: [{ op: 'give', item: 'x' }] }, adv, { ...h, effectText: () => 'Inscrivez sur votre Feuille d’Aventure : Rame.' });
  assert.match(withFx, /notez le code obtenu, inscrivez sur votre Feuille d’Aventure\u202F: Rame, puis rendez-vous au <b>2<\/b>\./);
});

test('page de retour : référence du bloc et code de transfert (autre navigateur)', async () => {
  assert.deepEqual(Z.parseBlockRef('40.0'), { section: '40', index: 0 });
  assert.deepEqual(Z.parseBlockRef(Z.blockRef('la.porte', 2)), { section: 'la.porte', index: 2 });
  assert.equal(Z.parseBlockRef('40'), null);
  assert.equal(Z.parseBlockRef('40.x'), null);
  assert.equal(Z.parseBlockRef(undefined), null);
  const adv = sample({ mode: 'retour', minScore: 50 });
  const nonce = Z.newNonce();
  const ok = Z.parseReturn({ nonce, success: '1', score: '80' });
  assert.equal(await Z.transferCode(adv, '1.0', ok), null, 'sans clé de codes personnels : pas de code');
  adv.rules.zefor.codeKey = Z.newCodeKey();
  assert.equal(await Z.transferCode(adv, '1.0', ok), null, 'sans clé publique : une adresse tapée à la main ne donne aucun code');
  const { publicJwk, privateJwk } = await Z.generateKeyPair();
  adv.rules.zefor.publicKeyJwk = publicJwk;
  assert.equal(await Z.transferCode(adv, '1.0', ok), null, 'signature exigée');
  const signed = async x => ({ ...x, signature: await Z.signResult(privateJwk, x) });
  const code = await Z.transferCode(adv, '1.0', await signed(ok));
  assert.equal(code, await Z.personalCode(adv.rules.zefor.codeKey, nonce));
  assert.equal(await Z.checkCode(adv, adv.sections['1'].blocks[0], code, nonce), 'personal', 'la partie accepte le code de transfert');
  assert.equal(await Z.transferCode(adv, '1.0', await signed({ ...ok, score: 10 })), null, 'score insuffisant');
  assert.equal(await Z.transferCode(adv, '1.0', await signed({ ...ok, success: false })), null, 'échec');
  assert.equal(await Z.transferCode(adv, '2.0', await signed(ok)), null, 'pas de défi à cet endroit');
  adv.sections['1'].blocks[0].mode = 'code';
  assert.equal(await Z.transferCode(adv, '1.0', await signed(ok)), null, 'bloc en mode code : jamais de code de transfert');
});

test('un résultat arrivé par un canal qui ne correspond pas au mode du bloc est refusé', async () => {
  const adv = sample({ mode: 'code' });
  const block = adv.sections['1'].blocks[0];
  const res = Z.parseReturn({ nonce: 'N', success: '1' });
  assert.equal((await Z.checkResult(res, { adv, block, nonce: 'N', channel: 'retour' })).reason, 'mode');
  assert.equal((await Z.checkResult(res, { adv, block, nonce: 'N', channel: 'message', origin: 'https://zefor.maths974.fr' })).reason, 'mode');
  block.mode = 'retour';
  assert.equal((await Z.checkResult(res, { adv, block, nonce: 'N', channel: 'retour' })).ok, true);
});

test('vérification et renumérotation : effets et conditions des effets du bloc Zefor', async () => {
  await import('../js/plugins/compagnons/core.js');
  const { renameSection } = await import('../js/core/validate.js');
  const bad = [{ op: 'give', item: 'fantome' }, { op: 'stat', stat: 'magie', add: 1 }, { op: 'companion', companion: 'personne', action: 'join' }, { op: 'flag', flag: 'x', if: { visited: '99' } }];
  const adv = sample({ successEffects: bad, failureEffects: [{ op: 'gold', add: 1, if: { visited: '4' } }], skipEffects: [{ op: 'gold', add: 1, if: { not: { visited: '4' } } }], allowSkip: true, skipTo: '4' });
  const msgs = validate(adv).map(p => p.message).join('\n');
  assert.match(msgs, /objet « fantome »/);
  assert.match(msgs, /caractéristique inconnue « magie »/);
  assert.match(msgs, /compagnon inconnu « personne »/);
  assert.match(msgs, /paragraphe 99, qui n'existe pas/);
  const r = renameSection(adv, '4', '40');
  const b = r.sections['1'].blocks[0];
  assert.equal(b.skipTo, '40');
  assert.deepEqual(b.failureEffects[0].if, { visited: '40' });
  assert.deepEqual(b.skipEffects[0].if, { not: { visited: '40' } });
});

/* ---------- mode intégré : activité zefor jouée dans la page ---------- */

const integre = (more = {}) => sample({
  mode: 'integre', url: undefined, codeHashes: undefined,
  activity: { kind: 'maze', level: Z.sampleLevel('maze') }, pass: { minScore: 0.5 }, allowSkip: true, skipTo: '4', ...more,
});

test('intégré : score normalisé (étoiles / maximum, au moins 1 étoile pour une victoire, Pezali = 1)', () => {
  assert.equal(Z.scoreIntegre('maze', { passed: true, etoiles: 3, maxEtoiles: 4 }), 0.75);
  assert.equal(Z.scoreIntegre('maze', { passed: true, etoiles: 4, maxEtoiles: 4 }), 1);
  assert.equal(Z.scoreIntegre('maze', { passed: true, etoiles: 0, maxEtoiles: 4 }), 0.25, 'une victoire vaut au moins 1 étoile');
  assert.equal(Z.scoreIntegre('maze', { passed: true }), 0.25, 'sans étoiles : 1 sur 4');
  assert.equal(Z.scoreIntegre('brume', { passed: true, etoiles: 2, maxEtoiles: 4 }), 0.5);
  assert.equal(Z.scoreIntegre('brume', { passed: true, etoiles: 1 }), 0.25, 'brume levée : 1 étoile');
  assert.equal(Z.scoreIntegre('maze', { passed: true, etoiles: 9, maxEtoiles: 4 }), 1, 'plafonné');
  assert.equal(Z.scoreIntegre('maze', { passed: true, etoiles: 2, maxEtoiles: 3 }), 0.67);
  assert.equal(Z.scoreIntegre('maze', { passed: true, etoiles: 2, maxEtoiles: 0 }), 0.5, 'maximum invalide → 4');
  assert.equal(Z.scoreIntegre('pezali', { passed: true, value: 3, etoiles: 4, maxEtoiles: 4 }), 1);
  assert.equal(Z.scoreIntegre('pezali', { passed: true }), 1);
  assert.equal(Z.scoreIntegre('maze', { passed: false, etoiles: 4 }), 0);
  assert.equal(Z.scoreIntegre('maze', null), 0);
  assert.equal(Z.scoreIntegre('brume', 'réussi'), 0);
  assert.deepEqual(Z.starsOf({ etoiles: 3, maxEtoiles: 4 }), { stars: 3, maxStars: 4 });
  assert.equal(Z.starsText(1), '1 étoile sur 4');
  assert.equal(Z.starsText(3, 4), '3 étoiles sur 4');
});

test('intégré : verdict selon pass.minScore et pass.minStars', () => {
  const b = { mode: 'integre', activity: { kind: 'maze', level: {} }, pass: { minScore: 0.5 } };
  assert.deepEqual(Z.judgeIntegre(b, { passed: true, etoiles: 1, maxEtoiles: 4 }), { success: false, score: 0.25, scoreOk: false, stars: 1, maxStars: 4 });
  assert.equal(Z.judgeIntegre(b, { passed: true, etoiles: 2, maxEtoiles: 4 }).success, true);
  assert.equal(Z.judgeIntegre({ ...b, pass: { minStars: 3 } }, { passed: true, etoiles: 2 }).success, false);
  assert.equal(Z.judgeIntegre({ ...b, pass: { minStars: 3 } }, { passed: true, etoiles: 3 }).success, true);
  assert.equal(Z.judgeIntegre({ ...b, pass: undefined }, { passed: true, etoiles: 1 }).success, true, 'sans exigence : réussir suffit');
  assert.equal(Z.judgeIntegre({ ...b, pass: { minScore: 0.75 } }, { passed: true, etoiles: 3 }).success, true, '0,75 pile');
  assert.equal(Z.judgeIntegre(b, { passed: false }).success, false);
  const pz = { mode: 'integre', activity: { kind: 'pezali', level: {} }, pass: { minScore: 1 } };
  const v = Z.judgeIntegre(pz, { passed: true, value: 3 });
  assert.deepEqual(v, { success: true, score: 1, scoreOk: true }, 'Pezali : pas d’étoiles, score 1');
  assert.deepEqual(Z.passOf({ pass: { minScore: '0.5', minStars: '' } }), { minScore: 0.5, minStars: null });
});

test('intégré : vérification des niveaux (labyrinthe, brume, balance)', () => {
  for (const k of Object.keys(Z.KINDS)) assert.deepEqual(Z.checkLevel(k, Z.sampleLevel(k)), [], `exemple ${k}`);
  const errs = (k, l) => Z.checkLevel(k, l).filter(p => p.level === 'error').map(p => p.text).join(' | ');
  const maze = Z.sampleLevel('maze');
  assert.equal(Z.mazePath(maze), 6, 'plus court chemin du chemin discret');
  assert.match(errs('maze', { ...maze, grid: [[4, 4, 4, 4], [4, 2, 5, 3], [4, 4, 4, 4]], startPos: { x: 1, y: 1 } }), /aucun chemin/);
  assert.match(errs('maze', { ...maze, startPos: { x: 0, y: 0 } }), /départ est sur un mur/);
  assert.match(errs('maze', { ...maze, startPos: { x: 20, y: 0 } }), /hors de la grille/);
  assert.match(errs('maze', { ...maze, grid: [[2, 1, 1]] }), /pas d’arrivée/);
  assert.match(errs('maze', { ...maze, grid: [[2, 3], [1]] }), /même longueur/);
  assert.match(errs('maze', { ...maze, grid: 'abc' }), /grille/);
  assert.match(errs('maze', { ...maze, allowedBlocks: ['maze_turn'] }), /ne peut pas avancer/);
  assert.match(errs('maze', { ...maze, maxBlocks: -2 }), /maxBlocks/);
  assert.match(errs('maze', { ...maze, startPos: { x: 1, y: 1, dir: 7 } }), /direction/);
  assert.ok(Z.checkLevel('maze', { ...maze, decor: { danger: 'un grand méchant loup' } }).some(p => p.level === 'warning' && /décor « danger »/.test(p.text)));
  assert.deepEqual(Z.checkLevel('maze', { ...maze, decor: { danger: '🐍', but: 'maison' } }), [], 'pictogramme court ou nom connu');
  assert.ok(Z.checkLevel('maze', { ...maze, decor: undefined }).some(p => p.level === 'info' && /yeux/.test(p.text)));
  const brume = Z.sampleLevel('brume');
  assert.match(errs('brume', { ...brume, total: 16 }), /ne tombent pas juste/);
  assert.match(errs('brume', { ...brume, caches: { A: 0 } }), /caches\.A/);
  assert.match(errs('brume', { ...brume, brumes: [{ teinte: 'Z', x: 1, y: 1, r: 3 }] }), /teinte/);
  assert.match(errs('brume', { ...brume, brumes: [{ teinte: 'A', x: 1, y: 1, r: 3 }, { teinte: 'B', x: 50, y: 30, r: 5 }], caches: { A: 4, B: 4 } }), /nombres différents/);
  assert.ok(Z.checkLevel('brume', { ...brume, points: brume.points.map((p, i) => (i === 0 ? { x: p.x, y: p.y } : p)), total: 15 }).some(p => /recouvre 7 points/.test(p.text)));
  const pz = Z.sampleLevel('pezali');
  assert.match(errs('pezali', { ...pz, droite: '12' }), /pas un nombre entier/);
  assert.match(errs('pezali', { ...pz, gauche: 'x + y' }), /il faut une équation/);
  assert.match(errs('pezali', { ...pz, gauche: 'x + 2', droite: 'x + 5' }), /un seul côté/);
  assert.match(errs('pezali', { ...pz, operations: ['sub', 'racine'] }), /racine/);
  assert.deepEqual(Z.parseLinear('3x + 2'), { a: 3, b: 2 });
  assert.deepEqual(Z.parseLinear(' -x − 4 + 2x'), { a: 1, b: -4 });
  assert.deepEqual(Z.parseLinear('11'), { a: 0, b: 11 });
  assert.equal(Z.parseLinear('3y'), null);
  assert.equal(Z.parseLinear(''), null);
  assert.match(errs('balance', {}), /type d’activité inconnu/);
  assert.match(errs('maze', null), /objet JSON/);
  assert.ok(Z.checkLevel('pezali', { ...pz, consigne: undefined }).some(p => p.level === 'warning' && /consigne/.test(p.text)));
  assert.equal(Z.levelForMount('maze', { grid: [] }).type, 'MAZE');
  assert.equal(Z.levelForMount('pezali', { gauche: 'x' }).equationMode, 'fixe');
});

test('intégré : vérification de l’aventure (activité, exigence, repli, sortie de secours)', async () => {
  const msgs = adv => validate(adv).filter(p => p.section === '1').map(p => `${p.level}: ${p.message}`);
  const ok = msgs(integre());
  assert.ok(!ok.some(m => /^(error|warning)/.test(m)), ok.join('\n'));
  assert.ok(!ok.some(m => /adresse du parcours/.test(m)), 'pas d’adresse exigée en mode intégré');
  assert.ok(msgs(integre({ activity: { kind: 'tortue', level: {} } })).some(m => m.startsWith('error') && /inconnu « tortue »/.test(m)));
  assert.ok(msgs(integre({ activity: undefined })).some(m => m.startsWith('error') && /activity/.test(m)));
  assert.ok(msgs(integre({ activity: { kind: 'maze', level: { ...Z.sampleLevel('maze'), startPos: { x: 0, y: 0 } } } })).some(m => m.startsWith('error') && /labyrinthe, le départ est sur un mur/.test(m)));
  assert.ok(msgs(integre({ success: '' })).some(m => m.startsWith('error') && /destination/.test(m)));
  assert.ok(msgs(integre({ pass: { minScore: 70 } })).some(m => m.startsWith('error') && /entre 0 et 1/.test(m)));
  assert.ok(msgs(integre({ pass: { minStars: 5 } })).some(m => m.startsWith('error') && /minStars/.test(m)));
  assert.ok(msgs(integre({ allowSkip: false })).some(m => m.startsWith('warning') && /reste bloqué/.test(m)));
  assert.ok(msgs(integre({ allowSkip: false, fallback: { mode: 'code', url: '', codeHashes: [] } })).some(m => m.startsWith('error') && /repli : aucun code de secours/.test(m)));
  const h = await Z.codeHash(ID, 'SECOURS-1');
  const good = msgs(integre({ allowSkip: false, fallback: { mode: 'code', url: 'https://zefor.maths974.fr/#jeu=maze', codeHashes: [h], codeSalt: ID } }));
  assert.ok(!good.some(m => /^(error|warning)/.test(m)), good.join('\n'));
  assert.ok(msgs(integre({ fallback: { mode: 'code', url: 'ftp://x', codeHashes: [h] } })).some(m => m.startsWith('error') && /https/.test(m)));
  assert.ok(msgs(integre({ fallback: { mode: 'integre' } })).some(m => m.startsWith('error') && /code, message ou retour/.test(m)));
  assert.ok(msgs(integre({ activity: { kind: 'pezali', level: Z.sampleLevel('pezali') }, pass: { minScore: 1 } })).some(m => m.startsWith('info') && /Pezali ne donne pas d’étoiles/.test(m)));
});

test('intégré : cibles du graphe et renumérotation (le niveau et le repli ne bougent pas)', () => {
  const adv = integre({ fallback: { mode: 'code', url: 'https://zefor.maths974.fr/', codeHashes: [] }, failureEffects: [{ op: 'gold', add: 1, if: { visited: '4' } }] });
  assert.deepEqual(targetsOf(adv.sections['1']).map(x => [x.to, x.label]), [['2', 'défi réussi'], ['3', 'défi raté'], ['4', 'sans le défi']]);
  const { adventure, mapping } = renumber(adv, makeRng(7));
  const b = adventure.sections[mapping['1']].blocks[0];
  assert.equal(b.mode, 'integre');
  assert.equal(b.success, mapping['2']); assert.equal(b.failure, mapping['3']); assert.equal(b.skipTo, mapping['4']);
  assert.deepEqual(b.failureEffects[0].if, { visited: mapping['4'] });
  assert.deepEqual(b.activity, adv.sections['1'].blocks[0].activity, 'le niveau n’est pas renuméroté');
  assert.deepEqual(b.fallback, adv.sections['1'].blocks[0].fallback);
  assert.deepEqual(b.pass, { minScore: 0.5 });
});

test('intégré : partie jouée (essais ratés, réussite avec étoiles, bilan, recommencer)', () => {
  const adv = integre({ successEffects: [{ op: 'gold', add: 3 }] });
  const gold = hero(adv).gold;
  let s = Z.missIntegre(hero(adv), 0).state;
  s = Z.missIntegre(s, 0).state;
  assert.equal(s.blocks[0].tries, 2);
  assert.equal(s.blocks[0].status, undefined, 'un essai raté ne conclut rien');
  const v1 = Z.judgeIntegre(adv.sections['1'].blocks[0], { passed: true, etoiles: 1, maxEtoiles: 4 });
  let r = Z.recordResult(s, adv, 0, { success: v1.success, score: v1.score, via: 'integre', scoreOk: v1.scoreOk, stars: v1.stars, maxStars: v1.maxStars });
  assert.equal(r.state.blocks[0].status, 'failure');
  assert.equal(r.messages[0].text, 'Défi Zefor non réussi (1 étoile sur 4) : score insuffisant.');
  assert.throws(() => Z.continueChallenge(r.state, adv, 0), /pas encore réussi/);
  s = Z.startIntegre(r.state, 0).state;
  assert.equal(s.blocks[0].status, 'pending'); assert.equal(s.blocks[0].result, null);
  const v2 = Z.judgeIntegre(adv.sections['1'].blocks[0], { passed: true, etoiles: 3, maxEtoiles: 4 });
  r = Z.recordResult(s, adv, 0, { success: v2.success, score: v2.score, via: 'integre', scoreOk: v2.scoreOk, stars: v2.stars, maxStars: v2.maxStars });
  assert.equal(r.messages[0].text, 'Défi Zefor réussi (3 étoiles sur 4).');
  assert.deepEqual(r.state.blocks[0].result, { success: true, score: 0.75, via: 'integre', exercise: '', scoreOk: true, stars: 3, maxStars: 4 });
  const done = Z.continueChallenge(r.state, adv, 0).state;
  assert.equal(done.section, '2');
  assert.equal(done.gold, gold + 3, 'effet de réussite appliqué');
  assert.deepEqual(done.zefor.done['1#0'], { ok: true, via: 'integre', score: 0.75, title: 'La balance', section: '1' });
  assert.equal(Z.viaLabel('integre'), 'l’activité jouée dans le livre');
  // Abandon après des essais ratés : paragraphe d'échec.
  const lost = Z.failChallenge(Z.missIntegre(hero(adv), 0).state, adv, 0).state;
  assert.equal(lost.section, '3');
  assert.equal(lost.zefor.done['1#0'].via, 'abandon');
});

test('intégré : repli (bloc effectif, code de secours, code de transfert en mode retour)', async () => {
  const h = await Z.codeHash(ID, 'SECOURS-1');
  const adv = integre({ fallback: { mode: 'code', url: 'https://zefor.maths974.fr/#jeu=maze', codeHashes: [h], codeSalt: ID, exercise: 'maze:chemin' } });
  const b = adv.sections['1'].blocks[0];
  const fb = Z.fallbackBlock(b);
  assert.equal(fb.mode, 'code'); assert.equal(fb.url, 'https://zefor.maths974.fr/#jeu=maze'); assert.equal(fb.success, '2');
  assert.equal(fb.activity, undefined); assert.equal(fb.fallback, undefined); assert.equal(fb.pass, undefined);
  assert.equal(await Z.checkCode(adv, fb, 'secours 1'), 'static');
  assert.equal(Z.fallbackBlock({ ...b, fallback: undefined }), null);
  assert.equal(Z.fallbackBlock({ ...b, fallback: { mode: 'integre' } }), null);
  assert.equal(Z.fallbackBlock({ ...b, fallback: { url: 'https://x.fr' } }).mode, 'code', 'mode code par défaut');
  // Repli en mode retour : le code de transfert fonctionne comme pour un bloc « retour ».
  const adv2 = integre({ fallback: { mode: 'retour', url: 'https://zefor.maths974.fr/' } });
  adv2.rules.zefor.codeKey = Z.newCodeKey();
  const { publicJwk, privateJwk } = await Z.generateKeyPair();
  adv2.rules.zefor.publicKeyJwk = publicJwk;
  const nonce = Z.newNonce();
  const res = Z.parseReturn({ nonce, success: '1' });
  res.signature = await Z.signResult(privateJwk, res);
  assert.equal(await Z.transferCode(adv2, '1.0', res), await Z.personalCode(adv2.rules.zefor.codeKey, nonce));
  adv2.sections['1'].blocks[0].fallback = undefined;
  assert.equal(await Z.transferCode(adv2, '1.0', res), null, 'sans repli retour : pas de code de transfert');
});

test('intégré : version imprimable (texte de repli, grille du labyrinthe, code de secours)', async () => {
  const { ext } = await import('../js/core/plugins.js');
  const print = (b, adv) => ext.blocks.get('zefor').print(b, adv, { go: n => `rendez-vous au <b>${n}</b>`, esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), effectText: () => 'vous perdez 1 point de CHANCE.' });
  const adv = integre({ skipEffects: [{ op: 'stat', stat: 'chance', add: -1 }] });
  const out = print(adv.sections['1'].blocks[0], adv);
  assert.match(out, /Défi Zefor : La balance\./);
  assert.match(out, /Ce défi se joue dans l’application Livre-Héros \(labyrinthe\)\. Consigne : Guide le groupe/);
  assert.match(out, /<table class="zf-pr-laby"/);
  assert.equal((out.match(/<tr>/g) || []).length, 5, 'une ligne de tableau par ligne de la grille');
  assert.match(out, /<b>→<\/b>/); assert.match(out, /<b>A<\/b>/); assert.match(out, /<b>!<\/b>/);
  assert.match(out, /Dans l'application, sa réussite vous mène au <b>2<\/b>\./);
  assert.match(out, /Si vous n'y parvenez pas, rendez-vous au <b>3<\/b>/);
  assert.match(out, /renoncer au défi : vous perdez 1 point de CHANCE, rendez-vous au <b>4<\/b>/);
  assert.doesNotMatch(out, /undefined/);
  const withFb = print({ ...adv.sections['1'].blocks[0], fallback: { mode: 'code', url: 'https://zefor.maths974.fr/#jeu=maze', codeHashes: [] } }, adv);
  assert.match(withFb, /Sur papier, faites-le sur zefor974 :<\/p><p class="zf-url">https:/);
  assert.match(withFb, /notez le code obtenu, puis rendez-vous au <b>2<\/b>\./);
  const teacher = print({ ...adv.sections['1'].blocks[0], fallback: { mode: 'code', codeHashes: [] } }, adv);
  assert.match(teacher, /demandez le code de secours à l'adulte qui vous accompagne/);
  const pz = print({ ...adv.sections['1'].blocks[0], activity: { kind: 'pezali', level: Z.sampleLevel('pezali') } }, adv);
  assert.match(pz, /\(balance\)\. Consigne : Trois sacs/);
  assert.doesNotMatch(pz, /zf-pr-laby/);
});

test('intégré : JSON du niveau lisible dans l’éditeur (une ligne de grille par ligne), sans perte', () => {
  for (const k of Object.keys(Z.KINDS)) {
    const lvl = Z.sampleLevel(k);
    assert.deepEqual(JSON.parse(Z.prettyLevel(lvl)), lvl, k);
  }
  const t = Z.prettyLevel(Z.sampleLevel('maze'));
  assert.match(t, /\n {4}\[4, 2, 1, 1, 5, 4, 4\],\n/);
  assert.match(t, /"startPos": \{ "x": 1, "y": 1, "dir": 0 \}/);
  assert.equal(Z.prettyLevel(undefined), '{}');
  assert.deepEqual(JSON.parse(Z.prettyLevel({ a: [], b: {}, c: undefined, d: [1, [2, 3]], e: 'x, y' })), { a: [], b: {}, d: [1, [2, 3]], e: 'x, y' });
});
