# Greffon « zefor » : des défis zefor974 qui débloquent la suite du livre

Ce greffon relie une aventure à **zefor974**, la plateforme d'exercices de Maths974 (« Maths974 — entraîne-toi » :
Automaths, Blokaly, Pezali, Aljeb…). À un moment de l'histoire, le livre propose un **Défi Zefor** : l'élève ouvre
un parcours sur zefor, le réussit, et la suite de l'aventure se débloque. S'il échoue, il peut réessayer, accepter
l'échec (s'il existe un paragraphe prévu pour cela) ou, si vous l'autorisez, continuer sans le défi contre un prix.

Livre-Héros reste un site sans serveur. Le résultat voyage d'une de quatre façons, au choix de l'auteur, pour chaque défi.

| Mode | Ce que fait l'élève | Ce que doit faire zefor | Remarques |
|---|---|---|---|
| **Code** | tape le code de réussite affiché par zefor | afficher un code à la fin du parcours | marche partout, même sur un autre appareil et sur papier ; un code fixe peut circuler, pas un code personnel |
| **Message** | rien : le livre se débloque seul | envoyer un message à la fenêtre du livre (`postMessage`) | le parcours s'ouvre dans un nouvel onglet ou **dans le paragraphe** (cadre, protocole m974 de Maths974) |
| **Retour** | rien : zefor le ramène au livre | rediriger vers l'adresse de retour du livre | pratique sur téléphone ; le résultat passe à l'onglet de l'aventure ou attend la reprise de la partie |
| **Intégré** | joue l'activité **dans le paragraphe** (labyrinthe, brume, balance) | rien : le livre embarque le moteur zefor (paquet `vendor/zefor/`) | résultat immédiat, hors ligne une fois l'activité jouée ; voir [Mode intégré](#mode-intégré) |

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
  n'attendait ce résultat (application installée sur iPhone/iPad, autre navigateur), elle affiche un **code de transfert**
  à taper dans la partie, **seulement** si : le bloc est en mode retour, les codes personnels sont activés, l'aventure
  déclare une clé publique (Règles › Zefor) et le résultat est signé et vérifié. Sinon, une adresse tapée à la main
  suffirait à obtenir le code : la page invite plutôt à demander un code de réussite.
- Chaque bloc n'écoute que le canal de son mode : un bloc en mode code ne se débloque qu'avec un code (jamais par
  l'adresse de retour ni par un message), un bloc en mode message n'accepte que les messages, un bloc en mode retour
  que l'onglet de retour. Un résultat arrivé par un autre canal est refusé.
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

## Mode intégré

Le défi se joue **dans la page** : l'enfant programme le labyrinthe, compte sous la brume ou équilibre la balance sans
quitter le livre, sans code à taper ni réseau (une fois l'activité mise en cache). Trois activités de zefor974 :

| Activité (`kind`) | Ce que fait l'enfant | Score normalisé (0 à 1) |
|---|---|---|
| `maze` — labyrinthe Blokaly | programme le groupe avec des blocs (avancer, tourner…) jusqu'à l'arrivée, sans passer par une case danger | étoiles ÷ 4 (4 étoiles = le nombre de blocs optimal ; une victoire vaut au moins 1 étoile) |
| `brume` — combien sous la brume ? | compte les objets visibles et trouve combien la brume en cache | étoiles ÷ 4 (4 au premier essai, 2 au second, 1 si la brume a été levée) |
| `pezali` — balance | isole x sur une balance (retirer, diviser…) | 1 (la balance ne donne pas d'étoiles) |

### Dans l'éditeur

1. Bloc **Défi Zefor**, liste **Où se joue le défi** : *Dans le livre : activité zefor intégrée*.
2. **Activité jouée dans le livre** : labyrinthe, brume ou balance (changer d'activité propose un niveau d'exemple).
3. **Réussite exigée** : il suffit de réussir, ou au moins 2, 3 ou 4 étoiles sur 4 (`pass.minScore` = 0,5, 0,75 ou 1).
4. **Niveau (JSON)** : le niveau de l'activité, vérifié à chaque frappe. Une erreur de syntaxe garde le dernier niveau
   valide ; les erreurs du niveau (départ sur un mur, arrivée inaccessible, comptes de la brume faux, solution de la
   balance non entière…) sont listées en clair et reprises par l'onglet **Vérifier**.
5. **Essayer l'activité** ouvre l'activité dans une fenêtre et dit si le défi serait réussi (étoiles, score).
6. **Repli si l'activité ne se charge pas** (recommandé) : adresse du parcours zefor974 et **codes de secours**
   (empreintes, comme en mode code). Sans repli, cochez au moins *Permettre de continuer sans le défi* : sinon le
   lecteur hors ligne qui n'a encore jamais joué ce défi reste bloqué (l'onglet Vérifier le signale).

### Pendant la partie

- L'activité apparaît dans un cadre **à fond clair**, même en thème sombre (la carte zefor n'existe qu'en clair). Le
  bouton **Agrandir** la passe en plein écran (Échap pour réduire), **Recommencer** la remet à zéro. Sur téléphone, le plateau du labyrinthe passe
  au-dessus des blocs.
- Un essai raté (le programme n'arrive pas, mauvaise réponse) est compté (« 2 essais sans réussir ») sans conclure le défi.
- Réussite : **Défi réussi !**, les étoiles en symboles (★★★☆) et en toutes lettres (« 3 étoiles sur 4 »), puis
  **Continuer → N** (effets de réussite, paragraphe de réussite).
- Réussite sans assez d'étoiles : **Défi pas encore réussi** (cadre en tirets, cercle barré), l'exigence rappelée,
  **Recommencer l'activité** ou **Accepter l'échec → N**.
- **J'abandonne le défi** (s'il y a un paragraphe d'échec) et **Continuer sans le défi** (si permis) restent proposés.
- **Paquet absent** (site sans `vendor/zefor/`, ou hors ligne avant la première partie) : « L'activité zefor n'a pas pu
  se charger : … », **Réessayer de charger l'activité**, puis le **repli** (parcours zefor974 et code de secours) ou
  *Continuer sans le défi*.
- Mode test : **Simuler une réussite** (4 étoiles) et **Simuler un échec**.
- Changer de paragraphe démonte l'activité (Blockly, minuteries, écouteurs).
- À l'arrivée sur le paragraphe, l'activité ne prend pas le focus et la page ne défile pas jusqu'à elle (la brume se
  donne le focus en se montant) : on lit d'abord le texte. Après **Recommencer** ou **Réessayer**, le focus va dans l'activité.

### Version imprimable

« **Défi Zefor : Le chemin discret.** Ce défi se joue dans l'application Livre-Héros (labyrinthe). Consigne : … »,
suivi, pour un labyrinthe, de **la grille à résoudre sur papier** (→ départ, A arrivée, « ! » danger, cases hachurées
pour les murs), puis du repli : « Sur papier, faites-le sur zefor974 : <adresse>. Quand vous l'avez réussi, notez le code
obtenu, puis rendez-vous au 71. » (ou « demandez le code de secours à l'adulte qui vous accompagne »), et « Si vous n'y
parvenez pas… », « Vous pouvez aussi renoncer au défi… ». Seuls les défis intégrés avec repli ont une ligne dans la case
**Codes des défis Zefor** de la Feuille d'Aventure.

### Format JSON du bloc

```jsonc
{
  "type": "zefor",
  "mode": "integre",
  "title": "Le chemin discret",
  "description": "Laverdure trace dans la poussière le chemin qui évite les chasseurs. **Programme-le !**",
  "activity": {
    "kind": "maze",                                  // "maze" | "brume" | "pezali"
    "level": { … }                                   // voir ci-dessous
  },
  "pass": { "minScore": 0.5 },                       // facultatif : part des étoiles (0 à 1), ou "minStars": 1 à 4
  "fallback": {                                      // facultatif : même format qu'un bloc code, message ou retour
    "mode": "code",
    "url": "https://zefor.maths974.fr/#jeu=maze&niveau=mission-neurones.lvl_4",
    "exercise": "maze:mission-neurones.lvl_4",
    "codeHashes": ["<sha256 de « sel:CODE »>"], "codeSalt": "mon-aventure"
  },
  "success": "71", "failure": "70",
  "allowSkip": true, "skipTo": "72", "skipEffects": [],
  "successEffects": [], "failureEffects": []
}
```

**Niveaux** (écrits comme dans zefor974 ; un texte peut être une chaîne ou `{ "fr": "…", "rcf": "…" }`) :

```jsonc
// Labyrinthe : 1 chemin, 2 départ, 3 arrivée, 4 mur, 5 danger ; x = colonne, y = ligne, comptées depuis 0 ;
// dir : 0 est, 1 sud, 2 ouest, 3 nord.
{ "instruction": { "fr": "Guide le groupe jusqu’à la cascade sans passer devant le chasseur." },
  "grid": [[4,4,4,4,4,4,4],[4,2,1,1,5,4,4],[4,4,4,1,4,4,4],[4,4,4,1,1,3,4],[4,4,4,4,4,4,4]],
  "startPos": { "x": 1, "y": 1, "dir": 0 },
  "allowedBlocks": ["maze_move_forward", "maze_turn"],   // aussi maze_forever, maze_if, maze_if_else
  "maxBlocks": 8,
  "decor": { "danger": "yeux", "but": "cascade" } }

// Brume : total, points (x de 0 à 100, y de 0 à 70 ; « sous » = numéro de la brume qui le cache),
// brumes (teinte A, B ou C : chaque teinte a aussi sa forme, ◆ ▼ ★), caches (combien sous chaque teinte).
{ "instruction": { "fr": "Il y a 15 mangues. Combien sont cachées sous la brume ?" },
  "total": 15, "points": [{ "x": 18, "y": 22, "sous": 0 }, …, { "x": 60, "y": 20 }, …],
  "brumes": [{ "teinte": "A", "x": 28, "y": 27, "r": 16 }], "caches": { "A": 8 } }

// Balance : équation à coefficients entiers, solution entière ; opérations parmi add, sub, mul, div.
{ "equationMode": "fixe", "gauche": "3x + 2", "droite": "11", "operations": ["sub", "div"],
  "consigne": { "fr": "Trois sacs de provisions et 2 kg de riz pèsent autant que 11 kg. Combien pèse un sac ?" } }
```

**Décor du labyrinthe** (`decor`, facultatif) : zefor dessine une tête de mort sur les cases danger ; le paquet de
Livre-Héros la remplace **à la construction** par un décor neutre, choisi par le niveau. Noms connus, dessinés par un
pictogramme lisible sans la couleur :

| `decor.danger` | | `decor.but` | |
|---|---|---|---|
| `yeux` (par défaut), `chasseur` | 👀 on est vu | `drapeau` (par défaut) | 🏁 |
| `buisson` | 🌿 | `cascade` | 💧 |
| `rocher` | 🪨 | `maison` | 🏠 |
| `ronces` | 🌵 | `grotte` | ⛰️ |
| `eau` | 🌊 | `etoile` | ⭐ |
| `chien` | 🐕 | `tresor` | 💎 |
| `lanterne` | 🏮 | `feu` | 🔥 |
| `stop` | ⛔ | `arbre`, `campement` | 🌳, ⛺ |

On peut aussi donner directement un pictogramme ou un mot court (4 caractères au plus). Ailleurs, le décor par défaut.

**Pendant la partie**, `state.blocks[i] = { status: "pending"|"success"|"failure", tries, opened, result }` avec
`result = { success, score (0 à 1), via: "integre", scoreOk, stars?, maxStars? }` ; le bilan de fin compte le défi comme
les autres (`state.zefor.done`).

### Le paquet `vendor/zefor/`

Le moteur de zefor974 est un **code propriétaire** : il n'est pas dans le dépôt (public) de Livre-Héros, qui ignore
`vendor/zefor/` (`.gitignore`). On le construit hors des deux dépôts, sans rien modifier dans zefor974 :

```sh
node /home/florian/Ibrahim/livre-heros/zefor-paquet/construire.mjs            # trois modules autonomes
node /home/florian/Ibrahim/livre-heros/zefor-paquet/construire.mjs --partage  # morceaux communs (plusieurs activités)
```

Le script écrit `maze.js` + `maze.css` + `blockly-media/`, `brume.js`, `pezali.js` + `pezali.css` + `logo.svg` (≈ 330,
100 et 140 Ko compressés ; voir `zefor-paquet/README.md`). Le greffon les charge **à la demande** par `import()` (chemin
`vendor/zefor/<activité>.js` à la racine du site) : une aventure sans défi intégré ne télécharge rien. Le service worker
ne les précharge pas (pas dans `SHELL`) ; il les garde **à la première utilisation**, comme tout fichier du site : un défi
déjà joué une fois fonctionne ensuite hors ligne. Pour publier le livre avec ses défis, copiez `vendor/zefor/` sur le
serveur à côté de `index.html` (hors git).

Pour les tests, l'activité montée est exposée dans `window.__zeforIntegre = { kind, api, host, level }` (par exemple
`api.ecrireXml(xml)` puis `api.run()` pour le labyrinthe). Le crochet de test de Pezali (`.pz-root.__lhTest`) n'existe que
si `globalThis.__LH_ZEFOR_TEST__` est vrai avant le montage.

## Limites

- Le parcours zefor a besoin d'Internet ; prévoyez « continuer sans le défi » pour le hors-ligne.
- Mode intégré : seuls le labyrinthe, la brume et la balance sont dans le paquet (pas encore de fiche Automaths ni
  d'énoncé DSL, ni de frise, de tortue ou de prédiction). Un défi intégré ne laisse aucune trace dans zefor974.
- Mode intégré : la balance Pezali ne supporte qu'une instance par page (identifiants HTML fixes) et laisse deux petits
  écouteurs sur `document` après son démontage (sans effet). Son bouton ↻ (« nouvelle équation » tirée au hasard) est
  masqué dans le livre : le bouton **Recommencer** du cadre remet la balance du niveau.
- Mode intégré : la solution est lisible par un enfant qui ouvrirait les outils du navigateur. Sans enjeu à cet âge.
- Sans signature, un élève motivé peut fabriquer un faux résultat (console du navigateur, adresse de retour tapée à la main).
  Les codes personnels et les signatures compliquent beaucoup la triche, sans la rendre impossible sur un site statique
  (voir docs/ZEFOR.md). Pour un jeu en classe, c'est assumé.
- Sur iPhone ou iPad, une application **installée** sur l'écran d'accueil ne partage pas son stockage avec Safari :
  le mode retour y passe par le code de transfert (codes personnels et signature activés) ; sinon préférez le mode code.
