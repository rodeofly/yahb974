# Relier zefor974 à Livre-Héros

Ce document s'adresse au développeur de **zefor974** (« Maths974 — entraîne-toi », https://zefor.maths974.fr).
Il décrit ce que Livre-Héros envoie à zefor quand un élève ouvre un **Défi Zefor** dans une aventure, et ce que zefor
doit renvoyer pour débloquer la suite. Le greffon côté Livre-Héros est déjà écrit et testé (`js/plugins/zefor/`) ;
son mode d'emploi pour les auteurs est dans [docs/plugins/zefor.md](plugins/zefor.md).

Livre-Héros est un site **statique**, sans serveur, publié sur `https://rodeofly.github.io/yahb974/`. Il ne lit
**jamais** les données de zefor (Supabase, stockage du navigateur) et n'envoie **aucune** donnée sur l'élève.
Tout passe par l'adresse ouverte, et par un résultat que zefor renvoie de lui-même.

## En bref : par où commencer

| Mode | Travail côté zefor | L'élève | Protection contre la triche |
|---|---|---|---|
| **code** (fixe) | afficher un code à la fin du parcours | tape le code | faible : le code peut circuler dans la classe |
| **code** (personnel) | calculer le code à partir de `lh_nonce` (HMAC, 10 lignes) | tape le code | moyenne : chaque partie a son code |
| **retour** | rediriger vers `lh_return` avec le résultat | rien | faible sans signature, forte avec une signature serveur |
| **message** (onglet) | `window.opener.postMessage(…)` | rien | faible sans signature, forte avec une signature serveur |
| **message** (cadre m974) | brancher le SDK `@maths974/embed/child` déjà présent dans zefor | rien | idem |

Ordre conseillé : 1) **code fixe** (aucun changement de code, juste un texte affiché) ; 2) **code personnel** ou
**retour** ; 3) **cadre m974**, qui réutilise ton protocole existant ; 4) **signature côté serveur** si tu veux une vraie
garantie.

---

## 1. Ce que Livre-Héros ajoute à l'adresse du parcours

L'auteur de l'aventure saisit l'adresse du parcours (par exemple `https://zefor.maths974.fr/#parcours=…`).
Au clic sur « Ouvrir le parcours Zefor », Livre-Héros ajoute ces paramètres dans la **partie `?…` de l'adresse**,
**avant** le `#` (le fragment `#parcours=…` de zefor est conservé tel quel) :

| Paramètre | Exemple | Sens |
|---|---|---|
| `lh_nonce` | `Qm3x2k9_aB-VpZ0n1c8R4w` | jeton aléatoire de 128 bits (base64url, 22 caractères), **différent à chaque ouverture**. À renvoyer tel quel. |
| `lh_mode` | `code`, `message`, `retour` | comment l'auteur veut recevoir le résultat |
| `lh_return` | `https://rodeofly.github.io/yahb974/#/zefor-retour/mon-aventure/12.0` | adresse de retour (mode retour) : le livre, l'aventure et le défi |
| `lh_origin` | `https://rodeofly.github.io` | origine de Livre-Héros, à utiliser comme `targetOrigin` de `postMessage` |
| `lh_exercise` | `pezali:3` | identifiant d'exercice attendu (seulement si l'auteur l'a rempli) |
| `lh_display` | `cadre` | présent quand le parcours est affiché dans un cadre (iframe) du livre |
| `m974`, `session`, `activity` | `1`, `<nonce>`, `blokaly:maze:4` | en mode cadre, les paramètres du protocole m974 (`session` = le nonce) |

Exemple complet :

```
https://zefor.maths974.fr/?lh_nonce=Qm3x2k9_aB-VpZ0n1c8R4w&lh_mode=retour
  &lh_return=https%3A%2F%2Frodeofly.github.io%2Fyahb974%2F%23%2Fzefor-retour%2Fmon-aventure%2F12.0
  &lh_origin=https%3A%2F%2Frodeofly.github.io&lh_exercise=pezali%3A3#parcours=eyJpZCI6…
```

Points d'attention :

- zefor efface puis garde en mémoire le fragment `#…` : **lis les `lh_*` dès le démarrage**, depuis `location.search`,
  avant tout nettoyage de l'adresse, et garde-les pour la durée de l'onglet (`sessionStorage`).
- Le nonce ne contient rien sur l'élève. Ne l'envoie pas à Supabase sauf si tu signes côté serveur (§ 6).
- Ne mets jamais d'information sur l'élève dans `lh_return` (même règle que `URL_SAFE_KEYS` de m974).

```js
// Au démarrage de zefor (avant de nettoyer l'adresse)
const q = new URLSearchParams(location.search);
const livreHeros = q.get('lh_nonce') ? {
  nonce: q.get('lh_nonce'),
  mode: q.get('lh_mode') || 'code',
  retour: q.get('lh_return'),
  origine: q.get('lh_origin'),
  exercice: q.get('lh_exercise'),
} : null;
if (livreHeros) sessionStorage.setItem('livre-heros', JSON.stringify(livreHeros));
```

Le **résultat** que Livre-Héros attend contient toujours quatre informations :

| Champ | Type | Exemple |
|---|---|---|
| `exercise` | texte | `pezali:3` (ton identifiant d'activité ; obligatoire si l'auteur a rempli `lh_exercise`) |
| `success` | booléen (`1`/`0` dans une adresse) | `true` |
| `score` | nombre, facultatif | `85` (l'auteur peut exiger un score minimum) |
| `nonce` | texte | la valeur exacte de `lh_nonce` |

Plus, facultativement, une **signature** (§ 6).

---

## 2. Mode « code »

### 2a. Code fixe

L'auteur choisit un code (par exemple `BRUME-4821`) et le donne à zefor ; Livre-Héros n'en garde qu'une empreinte.
zefor l'affiche quand l'élève a réussi :

> Bravo ! Ton code pour Livre-Héros : **BRUME-4821**

Majuscules, accents, espaces et tirets ne comptent pas. Rien d'autre à programmer : il suffit que le parcours
(ou la séance) sache quel code afficher. Question : où le stocker (champ du parcours dans l'espace prof ?).

### 2b. Code personnel (conseillé)

L'auteur active « Codes personnels » dans *Règles › Zefor* et te donne une **clé secrète** (base64url, 32 octets).
Le code dépend alors du nonce : il est différent pour chaque élève et chaque partie.

Code = 6 caractères (base32 de Crockford) tirés des 30 premiers bits de `HMAC-SHA256(clé, nonce)`, affichés `XXX-XXX` :

```js
// Navigateur, Deno (Supabase Edge Functions) ou Node 20+ : même code (WebCrypto).
async function codePersonnel(cleB64url, nonce) {
  const b64 = cleB64url.replace(/-/g, '+').replace(/_/g, '/');
  const brut = Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
  const cle = await crypto.subtle.importKey('raw', brut, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(nonce)));
  const bits = [...mac.slice(0, 4)].map(o => o.toString(2).padStart(8, '0')).join('');
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const code = Array.from({ length: 6 }, (_, i) => A[parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join('');
  return code.slice(0, 3) + '-' + code.slice(3);          // ex. « 7KQ-M2P »
}
// À la fin du parcours réussi :
if (livreHeros?.mode === 'code') afficher(`Ton code pour Livre-Héros : ${await codePersonnel(CLE_DU_PARCOURS, livreHeros.nonce)}`);
```

Livre-Héros tolère les confusions `O`/`0` et `I`/`L`/`1`. Si l'élève a ouvert zefor **sans** passer par le livre
(pas de `lh_nonce`), affiche le code fixe s'il y en a un.

---

## 3. Mode « retour »

zefor redirige l'onglet vers `lh_return` en ajoutant le résultat **après** le `#…` :

```js
function retourLivreHeros({ exercise, success, score, signature }) {
  const p = new URLSearchParams({ nonce: livreHeros.nonce, exercise, success: success ? '1' : '0' });
  if (score != null) p.set('score', String(score));
  if (signature) p.set('sig', signature);
  const r = livreHeros.retour;
  location.href = r + (r.includes('?') ? '&' : '?') + p;   // pas new URL(r).searchParams : les paramètres iraient avant le #
}
```

Résultat : `https://rodeofly.github.io/yahb974/#/zefor-retour/mon-aventure/12.0?nonce=…&exercise=pezali%3A3&success=1&score=85&sig=…`.
(Livre-Héros accepte aussi les paramètres placés avant le `#`, par sécurité.)

La page `#/zefor-retour` de Livre-Héros vérifie la signature (si l'aventure en exige une), transmet le résultat à
l'onglet de la partie (`BroadcastChannel('livre-heros-zefor')`) **et** le range dans le stockage local, au cas où
l'élève joue dans ce même onglet (téléphone) : la partie le lit à la reprise. Elle affiche « Résultat transmis,
retournez à votre aventure ». Si aucune partie de ce navigateur n'attendait le résultat (application installée sur
iPhone/iPad, autre navigateur) et que les codes personnels sont activés, elle affiche un **code de transfert** à taper.

Pour vérifier le côté zefor à la main :
`https://rodeofly.github.io/yahb974/#/zefor-retour?nonce=TEST&success=1&score=90` doit afficher « Résultat transmis ».

---

## 4. Mode « message » dans un nouvel onglet

Le livre a ouvert zefor avec `window.open` : `window.opener` est la fenêtre du livre.

```js
const ORIGINES_LIVRE_HEROS = ['https://rodeofly.github.io', 'http://localhost:8080'];

function envoyerAuLivre({ exercise, success, score, signature }) {
  const cible = window.opener || (window.parent !== window ? window.parent : null);
  const origine = livreHeros?.origine;
  if (!cible || !ORIGINES_LIVRE_HEROS.includes(origine)) return false;     // ne parle qu'au livre
  cible.postMessage({ type: 'zefor:result', exercise, success, score, nonce: livreHeros.nonce, signature }, origine);
  return true;
}
// À la fin du parcours :
if (!envoyerAuLivre(r)) { if (livreHeros?.retour) retourLivreHeros(r); else afficherCode(); }
```

Livre-Héros n'accepte que les messages venant de l'origine déclarée par l'auteur (`https://zefor.maths974.fr`),
portant le bon nonce (et le bon exercice s'il est exigé). **N'active pas** l'en-tête
`Cross-Origin-Opener-Policy: same-origin` sur zefor : il couperait `window.opener`.

---

## 5. Mode « message » dans un cadre : le protocole m974

C'est la recommandation de la recherche (§ 9) : le parcours s'affiche **dans le paragraphe**, et zefor parle le
protocole **m974** qu'il connaît déjà (`src/zefor-core/embed/`, copié de `@maths974/embed`).

Livre-Héros charge l'iframe avec `?m974=1&session=<nonce>&activity=<exercice>` (+ les `lh_*`) et joue le rôle
d'hôte : à `m974:ready` il répond `m974:launch` (`session` = nonce, `payload = { activity, kind: 'graded', locale: 'fr' }`),
puis il attend `m974:attempt`. Côté zefor, il manque seulement de brancher le SDK « child » :

```js
import { connect } from './embed/child.js';                     // src/zefor-core/embed/ (copie de @maths974/embed)
const q = new URLSearchParams(location.search);
let m974 = null;
if (q.get('m974') === '1') {
  m974 = connect({ app: 'zefor' });                               // lit « session » dans l'adresse
  m974.ready(q.get('activity'));
}
// À la fin d'un exercice, d'un niveau Blokaly, d'une pesée Pezali :
m974?.reportAttempt({
  ...makeAttempt({ app: 'zefor', activityId, passed, score }),   // outcome.passed, outcome.score
  signature,                                                      // facultatif (§ 6)
});
```

Livre-Héros lit `session` (= nonce), `payload.activityId`, `payload.outcome.passed` (ou `payload.passed`),
`payload.outcome.score` et `payload.signature`. Il suffit donc que l'enveloppe m974 porte la bonne `session`,
ce que fait déjà le SDK child.

Deux conditions côté serveur de zefor :

- ne pas interdire l'affichage en cadre : si tu ajoutes `frame-ancestors`, mets `frame-ancestors 'self' https://rodeofly.github.io` ;
- les activités affichées dans zefor via un autre cadre (Aljeb sur `ftobe-maths974.github.io`) doivent rester autorisées par ta CSP.

L'élève peut aussi ouvrir le cadre dans un onglet : il n'y a alors ni parent ni opener, et zefor doit se rabattre sur
`lh_return` ou sur un code (voir le code du § 4).

---

## 6. Signer les résultats (facultatif, recommandé pour les modes message et retour)

Sans signature, n'importe qui peut taper dans la barre d'adresse
`…#/zefor-retour/mon-aventure/12.0?nonce=…&success=1`, ou envoyer le message depuis la console. Avec une signature,
Livre-Héros refuse tout résultat qui ne vient pas de zefor.

- **Algorithme** : ECDSA sur la courbe P-256 avec SHA-256 (WebCrypto : `{ name: 'ECDSA', hash: 'SHA-256' }`).
- **Texte signé** : `exercise|success|score|nonce`, avec `success` = `1` ou `0` et `score` écrit exactement comme dans le
  résultat (vide s'il n'y a pas de score). Exemple : `pezali:3|1|85|Qm3x2k9_aB-VpZ0n1c8R4w`.
  Écris le score en entier (`85`, pas `85.0`).
- **Signature** : 64 octets bruts (r‖s, format de WebCrypto) en **base64url** ; le format DER d'OpenSSL et de `node:crypto`
  est aussi accepté.
- **Clés** : l'auteur colle la clé **publique** (JWK) dans *Règles › Zefor*. La clé **privée** reste chez zefor.
  Pour essayer, le bouton « Générer une paire de clés de test » de Livre-Héros te donne une paire.

Génération d'une paire hors de Livre-Héros :

```js
// Navigateur ou Deno
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
console.log('publique', JSON.stringify(await crypto.subtle.exportKey('jwk', k.publicKey)));   // → Livre-Héros
console.log('privée',   JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey)));  // → secret de zefor
```

```sh
# ou avec OpenSSL + Node
openssl ecparam -name prime256v1 -genkey -noout -out zefor-prive.pem
node -e "const c=require('crypto'),f=require('fs');console.log(JSON.stringify(c.createPublicKey(f.readFileSync('zefor-prive.pem')).export({format:'jwk'})))"
```

Signature :

```js
async function signer(clePrivee, { exercise, success, score, nonce }) {
  const { kty, crv, x, y, d } = clePrivee;
  const cle = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const texte = [exercise, success ? '1' : '0', score == null ? '' : String(score), nonce].join('|');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, new TextEncoder().encode(texte)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

### Où signer ?

- **Dans le navigateur de l'élève** : facile, mais la clé privée est alors dans le JavaScript de zefor, donc lisible par
  un élève curieux. Cela arrête les tricheurs ordinaires (adresse tapée à la main), pas un élève qui lit le code.
- **Sur un serveur** (conseillé) : une fonction Supabase Edge (Deno, même API WebCrypto) signe **après avoir vérifié**
  la tentative dans ta base (par exemple la copie déposée par `rpc/deposer_copie`). La clé privée ne quitte jamais le serveur ;
  c'est la seule vraie garantie. Esquisse (noms de tables à adapter) :

```ts
// supabase/functions/signer-livre-heros/index.ts
const PRIVEE = JSON.parse(Deno.env.get('LIVRE_HEROS_CLE_PRIVEE')!);
Deno.serve(async req => {
  const { tentative, nonce } = await req.json();
  // 1. Relire la tentative côté serveur (jamais la croire sur parole) :
  //    const { data } = await supabase.from('copies').select('activite, reussi, score').eq('id', tentative).single();
  const r = { exercise: data.activite, success: data.reussi, score: data.score, nonce };
  return Response.json({ ...r, signature: await signer(PRIVEE, r) });
});
```

---

## 7. Sécurité : ce qui est protégé, ce qui ne l'est pas

Protégé par Livre-Héros :

- **Nonce** : 128 bits aléatoires par ouverture, gardés dans la sauvegarde de la partie. Un résultat ne vaut que pour
  l'ouverture qui l'a demandé : un vieux lien, celui d'un camarade ou d'une partie précédente est refusé. Après un échec,
  « Réessayer » tire un nouveau nonce.
- **Origine** : en mode message, seuls les messages de l'origine déclarée sont acceptés.
- **Exercice** : si l'auteur l'exige, un résultat d'un exercice plus facile est refusé.
- **Score minimum** : vérifié par le livre.
- **Signature** : si une clé publique est déclarée, tout résultat non signé ou falsifié est refusé
  (score modifié, exercice changé, autre clé…).

Limites assumées (site statique, usage scolaire) :

- **Sans signature**, un élève motivé peut fabriquer un résultat (console du navigateur, adresse tapée à la main).
- **Codes fixes** : ils circulent vite dans une classe. Les **codes personnels** l'empêchent, mais leur clé est dans le
  fichier de l'aventure : un élève très motivé pourrait la trouver et calculer son code.
- **Signature dans le navigateur** : la clé privée est lisible dans le code de zefor.
- Seule une **signature côté serveur, après vérification de la tentative**, résiste à un élève qui lit le code.
  Pour un jeu en classe, les niveaux intermédiaires suffisent largement.

Données personnelles : Livre-Héros n'envoie rien sur l'élève et n'en reçoit rien (le nonce est un nombre aléatoire).
Il n'y a ni cookie, ni appel à Supabase, ni lecture des données GAR.

---

## 8. Exemples de blocs (dans `sections["…"].blocks` d'une aventure)

```jsonc
// Code fixe : aucun changement dans zefor, il affiche « BRUME-4821 » en fin de parcours.
{ "type": "zefor", "title": "L'énigme du passeur", "mode": "code",
  "description": "Réussissez le parcours **Automaths** pour monter dans la barque.",
  "url": "https://zefor.maths974.fr/#parcours=…",
  "codeHashes": ["0498cd00af6d…"], "codeSalt": "la-tour-de-brume",
  "success": "50", "failure": "90",
  "allowSkip": true, "skipLabel": "Payer le passeur", "skipEffects": [{ "op": "stat", "stat": "chance", "add": -1 }] }

// Retour, résultat signé, score minimum.
{ "type": "zefor", "title": "La balance de Pezali", "mode": "retour", "exercise": "pezali:3", "minScore": 70,
  "url": "https://zefor.maths974.fr/?activity=pezali:3", "success": "120", "failure": "121" }

// Message dans un nouvel onglet.
{ "type": "zefor", "title": "Le calcul du troll", "mode": "message",
  "url": "https://zefor.maths974.fr/?activity=automaths:priorites", "success": "33" }

// Cadre m974 : le labyrinthe Blokaly s'affiche dans le paragraphe.
{ "type": "zefor", "title": "Le labyrinthe du robot", "mode": "message", "display": "cadre",
  "exercise": "blokaly:maze:4", "url": "https://zefor.maths974.fr/?activity=blokaly:maze:4",
  "success": "13", "successEffects": [{ "op": "flag", "flag": "robot-allie" }] }
```

Et dans `rules` :

```json
"zefor": {
  "origin": "https://zefor.maths974.fr",
  "publicKeyJwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" },
  "codeKey": "…clé des codes personnels…"
}
```

Tester sans zefor : dans l'éditeur, **Tester d'ici** puis **Simuler une réussite**. Le test automatique du greffon
utilise une fausse page zefor (servie sur une autre origine) qui implémente les quatre protocoles de ce document.

---

## 9. Ce que l'on sait de zefor974 (recherche du 26/09/2026)

### Public

- « zefor974 » et « zefor » ne renvoient, dans les moteurs de recherche, qu'au rappeur Zefor ; Pezali et Blokaly
  n'apparaissent dans aucun résultat lié à Maths974. Seul maths974.fr est indexé (Google Sites de l'association :
  Automaths974, Rapido974, Guides de survie, Packs premium), sans lien vers zefor. `zefor974.fr`, `zefor.re` et
  `zefor974.re` n'existent pas.
- **Application élève** : https://zefor.maths974.fr/, titre « Maths974 — entraîne-toi », application d'une page
  (Vite, Apache) ; toute adresse inconnue renvoie l'accueil. **Espace prof** : https://prof.maths974.fr.
- **Accueil** : Zefor, Automaths, Rapido, parcours DNB974, parcours par compétences, guides de survie cycles 3 et 4 ;
  rubrique Jeux : **Blokaly** (« Apprends à programmer en jouant »), **Pezali** (« Résous des équations en équilibrant »),
  **Aljeb** (« Le calcul littéral, en manipulant »). Langues fr, en, créole réunionnais (rcf), es, via `?lang=`.
- **Catalogue** : Blokaly (`maze`, `turtle`, `equation`, `math`, `motif`, `prediction`, `brume`), Manipuler (`pezali`
  intégré, `aljeb` en cadre depuis `ftobe-maths974.github.io/aljeb974/`), Externe (`mathalea`), Zefor (`automaths`).
  L'activité « brume » n'a aucun rapport avec « La Tour de Brume ».
- **Technologies** : Blokaly repose sur Google Blockly (format XML `startBlocks`, `solutionBlocks`) ; KaTeX, nerdamer.
  Pezali autonome : https://github.com/rodeofly/pezali974 (Matter.js), publié sur https://rodeofly.github.io/pezali974/.
- **Politique de sécurité** (balise `<meta>`) : connexions vers le site et le Supabase `qgxtziajrpoosujtlnin.supabase.co` ;
  cadres depuis le site et `https://rodeofly.github.io`. Pas de `X-Frame-Options` ni de `frame-ancestors` :
  zefor peut aujourd'hui être affiché dans un cadre de Livre-Héros. Aucune trace de LTI, SCORM ou xAPI.
- **Comptes élèves** : GAR (`/functions/v1/gar`, `rpc/gar_echanger_ticket`, ticket `#t=…`), code de séance + identifiant
  + mot de passe (`rpc/connexion_eleve`), recherche de séance (`rpc/seance_par_code`), dépôt de copies
  (`rpc/deposer_copie`, `rpc/deposer_copie_identifiee`).
- **Liens directs** (contenu dans `#…`, effacé puis gardé pour l'onglet) : `#seance=<JSON base64url>` (parcours du prof,
  vues `worldmap`, `campagne`, `doc`), `#s=CODE` (séance à 6 caractères), `#parcours=<JSON base64url>` (campagne Blokaly
  complète `{id, levels[]}`, fabricable sans serveur), `#guide`, `#apercu=`. **Aucun lien vers un exercice isolé.**
- **Progression** : dans le navigateur, propre au site (`blokaly:progress:<id>`, `maths974:competences:attempts`,
  `maths974:parcours:…`) ; illisible par un autre site.
- **Protocole m974 v1** : zefor contient la partie « hôte » (`m974:ready`, `launch`, `attempt`, `progress`, `exit`,
  `command` ; paramètres d'adresse autorisés `m974`, `session`, `activity`, `level`, `mode`, `kind`, `locale`, `timeLimit` ;
  tentative `{app, activityId, ts, outcome:{passed, score, stars?, maxStars?}, measures, competencies}`).
- **zefor ne signale pas aujourd'hui une réussite à la page qui l'affiche** : aucun `postMessage` vers le parent à la
  réussite ; seul `#apercu` envoie `zefor:ticket` et `zefor:taille`, vers l'espace prof. Ni Pezali (GitHub Pages) ni Aljeb
  ne contiennent `m974` ou `postMessage`.

### Lu avec ton accès (non public)

- `rodeofly/zefor974` (privé) : protocole dans `src/zefor-core/embed/protocol.js` et `host.js`, copiés de `@maths974/embed`.
- `rodeofly/orchestrateur-maths974` (public) : `src/lib/m974/protocol.js`, `host.js`, `attempt.js` (`makeAttempt`).
- Partie « activité » : `/home/florian/dev/archives/maths974-embed/src/child.js` (`connect({app})`, `ready()`,
  `reportAttempt()`, `progress()`, `exit()` ; sans effet hors cadre). C'est elle que le § 5 branche.
- Documentation : `docs/ECRIRE-UN-NIVEAU-BLOKALY.md`, `docs/rapports/2026-09-24-brume.md`. Copie locale :
  `/home/florian/dev/zefor974` (commit f9db80b du 26/09/2026).

### Hypothèses (à vérifier)

- **H1** « zefor974 » est le nom du projet ; le public voit « Maths974 — entraîne-toi ».
- **H2** « Blokaly » est un nom choisi, pas une faute pour « Blockly ».
- **H3** Aljeb en cadre serait bloqué par la CSP de zefor (`ftobe-maths974.github.io` absent de la liste des cadres).
- **H4** Si tu ajoutes `frame-ancestors 'self'`, le mode cadre de Livre-Héros cessera de marcher : ajoute `https://rodeofly.github.io`.

### Ce qui en découle

- Livre-Héros ne peut pas lire la progression de zefor : **c'est à zefor d'envoyer le résultat** (§ 2 à 5).
- Il manque côté zefor : un **lien direct vers un exercice** (par exemple `?activity=blokaly:<campagne>:<niveau>`),
  l'appel au SDK child en fin d'exercice (§ 5), et l'affichage d'un code (§ 2), le plus simple.
- `#parcours=` permet déjà à un auteur de fabriquer une campagne Blokaly pour son aventure et de la mettre dans
  l'adresse du défi ; seul manque le signal de réussite.
- À éviter : lire les résultats dans Supabase depuis Livre-Héros (données de mineurs issues du GAR, serveur à ajouter).
- Plus tard : intégrer Pezali et Blokaly directement dans Livre-Héros (`mount(el, {config, onPass})`) rendrait les défis
  jouables hors ligne, au prix de code copié du dépôt privé et d'une application plus lourde.

---

## 10. Liste de contrôle côté zefor

- [ ] Lire `lh_nonce`, `lh_mode`, `lh_return`, `lh_origin`, `lh_exercise` au démarrage, avant de nettoyer l'adresse.
- [ ] Mode code : afficher le code fixe, ou le code personnel (§ 2b), en fin de parcours réussi.
- [ ] Mode retour : rediriger vers `lh_return` + `?nonce=…&exercise=…&success=1&score=…[&sig=…]`.
- [ ] Mode message : `window.opener.postMessage({ type: 'zefor:result', … }, lh_origin)` avec une liste d'origines autorisées.
- [ ] Mode cadre : `connect({ app: 'zefor' })`, `ready()`, `reportAttempt()` quand `m974=1`.
- [ ] Pas de `Cross-Origin-Opener-Policy: same-origin` ; si `frame-ancestors`, y inclure `https://rodeofly.github.io`.
- [ ] Facultatif : signer (§ 6), de préférence sur le serveur.
- [ ] Essayer avec l'aventure de test : *Tester d'ici*, puis un vrai parcours.

---

## 11. Questions à se poser sur zefor

1. Quel mode veux-tu livrer en premier ? Le code fixe ne demande aucun développement ; le retour, une redirection.
2. Peut-on ouvrir **un exercice précis** par son adresse ? Aujourd'hui seuls `#seance=`, `#s=` et `#parcours=` existent.
   Quel format pour `?activity=` (par exemple `blokaly:maze:4`, `pezali:3`, `automaths:<id>`) ?
3. Quels **identifiants d'exercice** stables peux-tu garantir (ils servent à `exercise` et à la signature) ?
4. Quelle **échelle de score** : sur 100, sur 20, étoiles de 0 à 4 ? Les auteurs en ont besoin pour le score minimum.
   Faut-il transmettre les étoiles (`stars`, `maxStars`) plutôt qu'un score ?
5. Qu'est-ce qu'une **réussite** : un exercice, un niveau Blokaly, une campagne entière, une séance ?
6. zefor garde-t-il `location.search` au démarrage (il efface le `#`) ? Peut-il conserver les `lh_*` pendant tout le parcours ?
7. Les élèves sont-ils **connectés** (GAR, code de séance) quand ils font un défi du livre, ou en invité ?
   Le défi doit-il aussi compter dans la progression vue par le prof ?
8. Où stocker, côté zefor, les **codes fixes** et la **clé des codes personnels** d'une aventure (champ du parcours dans
   l'espace prof, fichier de configuration…) ?
9. Une **signature côté serveur** est-elle envisageable (fonction Supabase Edge) ? Les tentatives sont-elles vérifiées
   côté serveur, ou seulement déclarées par le navigateur ?
10. Comptes-tu ajouter `frame-ancestors` ou `Cross-Origin-Opener-Policy` sur zefor ? (§ 4 et 5)
11. **Pezali et Aljeb** : via zefor (Pezali intégré, Aljeb en cadre) ou via leurs versions GitHub Pages autonomes, qui
    ne parlent ni m974 ni `postMessage` ? L'hypothèse H3 (Aljeb bloqué en cadre) est-elle vraie ?
12. Veux-tu passer la **langue** (`?lang=fr|rcf|en|es`) depuis le livre ?
13. Les élèves utilisent-ils des **iPad/iPhone** avec l'application installée ? (Le mode retour y passe alors par le code de transfert.)
14. À terme, préfères-tu **embarquer Pezali et Blokaly dans Livre-Héros** (hors ligne) plutôt que de passer par zefor ?
