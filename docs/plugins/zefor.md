# Greffon « zefor » : des défis zefor974 qui débloquent la suite du livre

Ce greffon relie une aventure à **zefor974**, la plateforme d'exercices de Maths974 (« Maths974 — entraîne-toi » :
Automaths, Blokaly, Pezali, Aljeb…). À un moment de l'histoire, le livre propose un **Défi Zefor** : l'élève ouvre
un parcours sur zefor, le réussit, et la suite de l'aventure se débloque. S'il échoue, il peut réessayer, accepter
l'échec (s'il existe un paragraphe prévu pour cela) ou, si vous l'autorisez, continuer sans le défi contre un prix.

Livre-Héros reste un site sans serveur. Le résultat voyage d'une de trois façons, au choix de l'auteur, pour chaque défi.

| Mode | Ce que fait l'élève | Ce que doit faire zefor | Remarques |
|---|---|---|---|
| **Code** | tape le code de réussite affiché par zefor | afficher un code à la fin du parcours | marche partout, même sur un autre appareil et sur papier ; un code fixe peut circuler, pas un code personnel |
| **Message** | rien : le livre se débloque seul | envoyer un message à la fenêtre du livre (`postMessage`) | le parcours s'ouvre dans un nouvel onglet ou **dans le paragraphe** (cadre, protocole m974 de Maths974) |
| **Retour** | rien : zefor le ramène au livre | rediriger vers l'adresse de retour du livre | pratique sur téléphone ; le résultat passe à l'onglet de l'aventure ou attend la reprise de la partie |

Le détail technique, côté zefor, est dans [docs/ZEFOR.md](../ZEFOR.md).

## Dans l'éditeur

1. Dans un paragraphe, section **Jets de dés, combats, boutique**, cliquez sur **Défi Zefor**.
2. Remplissez :
   - **Titre du défi** et **Consigne pour le joueur** (Markdown léger : `**gras**`, `*italique*`) ;
   - **Adresse du parcours Zefor** (`https://zefor.maths974.fr/…`). Le lien « ouvrir l'adresse pour vérifier » l'ouvre dans un onglet ;
   - **Identifiant de l'exercice** (facultatif, ex. `pezali:3`, `blokaly:maze:4`) : s'il est rempli, un résultat qui concerne un autre exercice est refusé ;
   - **Comment le livre apprend la réussite** : code, message ou retour (voir le tableau). En mode message, choisissez **où s'affiche le parcours** : nouvel onglet, ou dans le paragraphe (cadre) ;
   - **Score minimum** (facultatif, sur l'échelle de zefor) : en dessous, le parcours compte comme raté.
3. **Codes de réussite** (obligatoires en mode code, en secours dans les autres modes) : tapez le code que zefor affichera
   puis **Ajouter un code de réussite**. Le code est aussitôt transformé en empreinte SHA-256 : il n'est jamais enregistré
   en clair dans l'aventure. **Notez-le** pour le donner à zefor. Majuscules, accents, espaces et tirets ne comptent pas
   (`brume-4821` = `BRUME 4821`). Visez au moins 6 caractères. Le champ **Vérifier un code** dit si un code est accepté.
4. **Si le défi est réussi, aller au** (obligatoire) et **Si le défi est raté, aller au** (facultatif).
5. **Permettre de continuer sans le défi** : utile hors ligne ou si zefor est indisponible. Choisissez le texte du bouton,
   la destination (vide = comme la réussite) et le **prix à payer** (ex. −1 CHANCE, −2 ENDURANCE).
6. **Effets** (facultatif) : effets appliqués en cas de réussite (donner un objet, marquer un mot-clé pour ouvrir un arc
   plus loin…) ou d'échec.

L'onglet **Vérifier** signale un défi sans destination, sans code en mode code, une adresse invalide, une origine manquante
en mode message, etc.

### Tester

**Tester d'ici** ouvre la lecture en mode test : le défi affiche alors **Simuler une réussite** et **Simuler un échec**,
pour parcourir l'histoire sans passer par zefor. Ces boutons n'apparaissent jamais dans une vraie partie.

### Onglet Règles › Zefor

- **Origine autorisée de Zefor** (mode message) : `https://zefor.maths974.fr` (plusieurs adresses possibles, séparées par des
  espaces). Seuls les messages venant de ces sites sont acceptés. Vide : l'origine de l'adresse de chaque défi.
- **Résultats signés** (facultatif, modes message et retour) : collez la **clé publique** de zefor (JWK ECDSA P-256).
  Tout résultat non signé, ou mal signé, est alors refusé. **Générer une paire de clés de test** enregistre une clé publique
  et affiche une seule fois la clé privée à donner à zefor. Si vous collez par erreur une clé privée, seule sa partie publique
  est gardée.
- **Codes personnels** (mode code) : chaque partie reçoit un code différent, calculé par zefor à partir d'une clé secrète
  et du paramètre `lh_nonce`. Un élève ne peut plus donner son code à un autre. Donnez la clé affichée à zefor.
  Les codes fixes restent acceptés en plus.
- **Adresse de retour** de l'aventure : pour information (zefor la reçoit automatiquement).

## Pendant la partie

- **Ouvrir le parcours Zefor** ouvre le parcours (onglet ou cadre) avec un **nonce** aléatoire : ce jeton lie le résultat
  à cette ouverture précise, un vieux résultat ou celui d'un camarade ne peut pas resservir.
- Mode code : l'élève tape le code (zone « Code de réussite donné par Zefor »). Un mauvais code est signalé (icône et texte),
  sans limite d'essais.
- Modes message et retour : « En attente du résultat… » (sablier, cadre en pointillés), puis le résultat s'affiche :
  **Défi réussi !** (cadre plein, cercle coché) ou **Parcours non réussi** (cadre en tirets, cercle barré, score et minimum).
  Un résultat refusé (signature, site non autorisé, autre exercice) est expliqué en clair.
- Après une réussite, **Continuer → N** applique les effets de réussite puis ouvre le paragraphe prévu.
- Hors ligne, un avertissement le signale et propose de continuer sans le défi (si c'est permis).
- **Page de retour** (`#/zefor-retour/…`) : « Résultat transmis, retournez à votre aventure ». Si aucune partie de ce navigateur
  n'attendait ce résultat (application installée sur iPhone/iPad, autre navigateur) et que les codes personnels sont activés,
  elle affiche un **code de transfert** à taper dans la partie.
- L'écran de fin affiche le bilan : « Défis Zefor : 2 réussis sur 3 ».

## Version imprimable

Chaque défi devient une consigne de livre-jeu : « **Défi Zefor : L'énigme du passeur.** Ce défi se fait sur zefor974 :
https://…. Quand vous l'avez réussi, notez le code obtenu, puis rendez-vous au **50**. Si vous n'y parvenez pas, rendez-vous
au **90**. » Les règles expliquent les défis Zefor et la Feuille d'Aventure a une case **Codes des défis Zefor**.

## Format JSON

```jsonc
// Dans sections["10"].blocks :
{
  "type": "zefor",
  "title": "L'énigme du passeur",
  "description": "Réussissez le parcours **Automaths** pour monter dans la barque.",
  "url": "https://zefor.maths974.fr/#parcours=…",
  "exercise": "automaths:fractions-1",         // facultatif : identifiant exigé dans le résultat
  "mode": "code",                              // "code" | "message" | "retour"
  "display": "fenetre",                        // mode message : "fenetre" (défaut) | "cadre" (m974)
  "codeHashes": ["0498cd00af6d…"],             // SHA-256 hex de codeSalt + ":" + CODE normalisé
  "codeSalt": "mon-aventure-x1y2",             // fixé par l'éditeur (identifiant de l'aventure au 1er code)
  "minScore": 70,                              // facultatif
  "success": "50",                             // obligatoire
  "failure": "90",                             // facultatif
  "successEffects": [{ "op": "give", "item": "rame" }],
  "failureEffects": [],
  "allowSkip": true,                           // facultatif
  "skipLabel": "Payer le passeur et passer",
  "skipTo": "50",                              // vide = success
  "skipEffects": [{ "op": "stat", "stat": "chance", "add": -1 }]
}

// Dans rules :
"zefor": {
  "origin": "https://zefor.maths974.fr",       // mode message (une ou plusieurs, séparées par des espaces)
  "publicKeyJwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" },   // ou null
  "codeKey": "…"                               // clé des codes personnels (base64url, 32 octets) ou ""
}
```

**Code normalisé** : sans accents, en majuscules, sans rien d'autre que A–Z et 0–9. L'empreinte d'un code se calcule
avec `codeHash(sel, code)` de `js/plugins/zefor/core.js`.

**Pendant la partie**, `state.blocks[i] = { nonce, status: "pending"|"success"|"failure", opened, tries, wrong, result }`
et le bilan est gardé dans `state.zefor.done["<paragraphe>#<index>"] = { ok, via, score, title, section }`.
Une aventure sans défi Zefor, ou une ancienne sauvegarde, fonctionne comme avant.

## Exemple : un arc débloqué par Blokaly

```json
{
  "12": {
    "title": "La salle des automates",
    "text": "Un robot de cuivre garde la porte du laboratoire. Sur son dos, un panneau : *programme-moi*.",
    "blocks": [{
      "type": "zefor", "title": "Le labyrinthe du robot", "mode": "message", "display": "cadre",
      "description": "Programmez le robot pour qu'il sorte du labyrinthe.",
      "url": "https://zefor.maths974.fr/?activity=blokaly:maze:4", "exercise": "blokaly:maze:4",
      "success": "13", "successEffects": [{ "op": "flag", "flag": "robot-allie" }],
      "allowSkip": true, "skipTo": "20", "skipEffects": [{ "op": "stat", "stat": "endurance", "add": -3 }]
    }],
    "choices": []
  }
}
```

Plus loin, un choix conditionné par le mot-clé `robot-allie` ouvre un arc réservé à ceux qui ont réussi.

## Limites

- Le parcours zefor a besoin d'Internet ; prévoyez « continuer sans le défi » pour le hors-ligne.
- Sans signature, un élève motivé peut fabriquer un faux résultat (console du navigateur, adresse de retour tapée à la main).
  Les codes personnels et les signatures compliquent beaucoup la triche, sans la rendre impossible sur un site statique
  (voir docs/ZEFOR.md). Pour un jeu en classe, c'est assumé.
- Sur iPhone ou iPad, une application **installée** sur l'écran d'accueil ne partage pas son stockage avec Safari :
  le mode retour y passe par le code de transfert (codes personnels activés) ; sinon préférez le mode code.
