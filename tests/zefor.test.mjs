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
  assert.match(out, /Défi Zefor : La balance\./);
  assert.match(out, /Ce défi se fait sur zefor974 : <span class="zf-url">https:\/\/zefor\.maths974\.fr\/#parcours=abc<\/span>\. Quand vous l'avez réussi, notez le code obtenu, puis rendez-vous au <b>2<\/b>\./);
  assert.match(out, /Équilibrez la balance\./);
  assert.match(out, /au moins 12,5/);
  assert.match(out, /Si vous n'y parvenez pas, rendez-vous au <b>3<\/b>/);
  assert.match(out, /renoncer au défi : vous perdez 1 point de CHANCE, rendez-vous au <b>4<\/b>/);
  const withFx = ext.blocks.get('zefor').print({ ...adv.sections['1'].blocks[0], successEffects: [{ op: 'give', item: 'x' }] }, adv, { ...h, effectText: () => 'Inscrivez sur votre Feuille d’Aventure : Rame.' });
  assert.match(withFx, /notez le code obtenu, inscrivez sur votre Feuille d’Aventure : Rame, puis rendez-vous au <b>2<\/b>\./);
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
  const code = await Z.transferCode(adv, '1.0', ok);
  assert.equal(code, await Z.personalCode(adv.rules.zefor.codeKey, nonce));
  assert.equal(await Z.checkCode(adv, adv.sections['1'].blocks[0], code, nonce), 'personal', 'la partie accepte le code de transfert');
  assert.equal(await Z.transferCode(adv, '1.0', { ...ok, score: 10 }), null, 'score insuffisant');
  assert.equal(await Z.transferCode(adv, '1.0', { ...ok, success: false }), null, 'échec');
  assert.equal(await Z.transferCode(adv, '2.0', ok), null, 'pas de défi à cet endroit');
  const { publicJwk, privateJwk } = await Z.generateKeyPair();
  adv.rules.zefor.publicKeyJwk = publicJwk;
  assert.equal(await Z.transferCode(adv, '1.0', ok), null, 'signature exigée');
  const sig = await Z.signResult(privateJwk, ok);
  assert.equal(await Z.transferCode(adv, '1.0', { ...ok, signature: sig }), code);
});
