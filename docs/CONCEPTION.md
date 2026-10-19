# Livre-Héros : moteur d'aventures dont vous êtes le héros

Application web installable (PWA) pour **écrire**, **tester** et **jouer** des livres-jeux dans l'esprit
de *Défis Fantastiques* / *Sorcellerie !*. Aucun serveur applicatif, aucune base de données :
tout tourne dans le navigateur, fonctionne hors ligne, et une aventure se partage sous forme de fichier.

## 1. Tout ce qui peut devenir interactif

Légende : ✅ présent · 🔜 prévu, l'architecture le permet déjà. Entre crochets, le greffon qui apporte la fonction
(voir [PLUGINS.md](PLUGINS.md) et la documentation de chaque greffon dans [plugins/](plugins/)).

### Côté joueur

| Domaine | Fonction | État |
|---|---|---|
| Création du héros | Tirage animé des caractéristiques (HABILETÉ, ENDURANCE, CHANCE, or…) selon les règles de l'aventure | ✅ |
| | Choix d'une classe (Guerrier / Sorcier) qui modifie les formules de tirage et l'équipement | ✅ |
| | Relancer le tirage, nommer son héros | ✅ |
| Lecture | Paragraphe avec illustration, texte mis en forme, numéro du paragraphe | ✅ |
| | Choix conditionnels : grisés avec la raison (« il vous faut la Clé d'argent »), ou cachés | ✅ |
| | Effets automatiques à l'entrée d'un paragraphe (perte d'ENDURANCE, objet trouvé, or…) avec notification | ✅ |
| | Effets déclenchés par un choix (payer 3 pièces d'or pour passer) | ✅ |
| Dés | Lanceur de dés animé (1d6, 2d6, formules « 2d6+3 ») toujours disponible | ✅ |
| | Tester sa Chance / son Habileté (la Chance baisse après chaque test) | ✅ |
| | Table de dés : « 1-2 → 245, 3-4 → 69, 5-6 → 99 » | ✅ |
| Combat | Simulation d'assauts : Force d'Attaque = 2d6 + HABILETÉ, 2 points de dégâts | ✅ |
| | Utiliser sa Chance pour augmenter / réduire les dégâts | ✅ |
| | Plusieurs adversaires, l'un après l'autre ou ensemble | ✅ |
| | Fuite (avec dégâts), modificateurs (arme, bonus/malus de Force d'Attaque), journal du combat | ✅ |
| | Mode automatique « jusqu'à la fin » ou assaut par assaut | ✅ |
| Feuille d'aventure | Caractéristiques actuelles / initiales, or, repas, objets, notes libres, mis à jour en direct | ✅ |
| | Manger un repas (+ENDURANCE, plafonné au niveau initial) | ✅ |
| | Utiliser un objet (potion : effet défini par l'auteur) | ✅ |
| Boutique | Acheter des objets contre de l'or, et les revendre au marchand (liste « Le marchand rachète ») | ✅ |
| Sauvegarde | Sauvegarde automatique, emplacements multiples, reprise | ✅ |
| | « Doigt dans la page » : revenir en arrière (optionnel, désactivable par l'auteur) | ✅ |
| Fins | Écran de mort / de victoire, statistiques de la partie, recommencer | ✅ |
| Carte | Carte des paragraphes visités, fins découvertes | ✅ |
| Magie | Formules à codes (ZAP, HOR…), coût, objet requis, classes autorisées, fausses formules, saisie de mémoire, livre des formules consultable | ✅ |
| Temps | Jours, obligation de manger chaque jour (pénalité le lendemain), repas offerts | ✅ |
| Ambiance | Effets sonores synthétisés, musique par paragraphe ou pour toute l'aventure, lecture à voix haute | ✅ |
| Accessibilité | Thème clair/sombre, taille du texte, texte justifié, formes plutôt que couleurs | ✅ |
| Succès | Succès (secrets ou non, en fin de partie ou en pleine partie), progression Exploré % / Fins / Succès dans la bibliothèque [succes] | ✅ |
| Équipement | Emplacements (arme, armure, bouclier, bijou), bonus de combat, malus sans arme, sac à capacité limitée [equipement] | ✅ |
| Compteurs | Réputation, Temps, Malédiction… visibles ou secrets, avec seuils de message, de mort ou de victoire [compteurs] | ✅ |
| Compagnons | Alliés qui rejoignent le héros, combattent à ses côtés, peuvent tomber [compagnons] | ✅ |
| Campagne | Plusieurs livres à la suite : passeport du voyageur (code + QR, enregistré sur l'appareil), vocabulaire du combat par mode [campagne] | ✅ |
| Défis | Énigmes et exercices (réponse, nombre, QCM, cases, remise en ordre), indices payants, réponses chiffrées [defis] | ✅ |
| Zefor974 | Parcours zefor974 (maths, logique, programmation, Blokaly…) dont la réussite débloque la suite : code, message ou page de retour signée [zefor] | ✅ |
| Formules | Formules mathématiques `$…$` / `$$…$$` (KaTeX, hors ligne) dans les paragraphes et les choix [maths] | ✅ |
| Cartes | Image à zones cliquables (avec conditions et effets), carte du monde avec lieux visités et chemin parcouru [carte] | ✅ |
| Confort de lecture | Polices Atkinson Hyperlegible et OpenDyslexic, interlignage, espacement, très contrasté (≥ 7:1), guide de lecture [accessibilite] | ✅ |

### Côté auteur

| Domaine | Fonction | État |
|---|---|---|
| Écriture | Liste des paragraphes, éditeur de texte (Markdown léger), titre, lieu | ✅ |
| | Choix avec conditions et effets, sans code : listes déroulantes | ✅ |
| | Blocs interactifs : test, table de dés, combat, boutique | ✅ |
| | Fin de partie (mort / victoire) | ✅ |
| Images | Import d'une image par paragraphe, redimensionnée et compressée dans le navigateur (WebP) | ✅ |
| | Illustrations d'adversaires et d'objets | ✅ |
| Structure | Graphe de l'aventure : ressorts ou frise, par lieu ou par jour, chemin le plus court, passages obligés, épinglage | ✅ |
| | Vérification : liens cassés, paragraphes orphelins, impasses non marquées comme fin | ✅ |
| | Renumérotation aléatoire des paragraphes (comme dans les livres) | ✅ |
| Règles | Caractéristiques, formules de tirage, dégâts, classes, objets : tout est paramétrable | ✅ |
| Test | Jouer à partir de n'importe quel paragraphe, avec un héros de test | ✅ |
| Partage | Export / import d'un fichier `.lhz` (zip : `adventure.json` + images) | ✅ |
| | Publication : déposer le dossier de l'aventure dans `adventures/` du site | ✅ |
| | Impression / PDF façon livre (A4 ou A5, règles, Feuille d'Aventure, Livre des formules), numéros mélangés | ✅ |
| | Co-écriture : fusion de deux aventures avec rapport (renommages, collisions d'images) [echanges] | ✅ |
| | Export Twine (Twee 3, archive HTML) et ink, import Twine 1/2 [echanges] | ✅ |
| | Partage par lien, « lien magique » (aventure dans l'adresse), QR code projetable, fichier [partage] | ✅ |
| | Statistiques d'auteur : morts par paragraphe, fins atteintes, paragraphes jamais lus [succes] | ✅ |
| | Onglet Maths : vérification des formules, aperçu, exemples à copier [maths] | ✅ |

## 2. Architecture

```
Navigateur (hors ligne après la 1re visite)
├── index.html + service worker (sw.js)   ← cache de l'application et des aventures publiées
├── js/core/     moteur PUR (aucun accès au DOM) : dés, règles, effets, combat, validation
├── js/store/    persistance : IndexedDB (aventures, images, sauvegardes) + import/export zip
├── js/ui/       interface Preact + htm (sans étape de compilation)
│                bibliothèque · création du héros · lecture · combat · feuille · éditeur · graphe
└── js/plugins/  greffons : <nom>/core.js (moteur pur, crochets de js/core/plugins.js)
                 et <nom>/index.js (interface, registres de js/ui/registry.js) — voir PLUGINS.md
```

### Pourquoi ces choix

- **Site statique, sans compilation.** Modules ES natifs, bibliothèques copiées dans `js/lib/`.
  On l'héberge n'importe où (GitHub Pages, Netlify, un NAS, une clé USB avec un petit serveur local).
  Pas de `npm install` pour contribuer : on édite un fichier, on recharge.
- **Pas de base de données.** Chaque navigateur garde ses données dans **IndexedDB** :
  - `adventures` : les aventures en cours d'écriture (JSON) ;
  - `assets` : les images, stockées en `Blob` (pas en base64, donc légères) ;
  - `saves` : les parties sauvegardées.
  On échange une aventure en exportant un fichier `.lhz` (un zip). C'est aussi la sauvegarde de sécurité.
- **PWA.** Le `manifest` rend l'application installable (téléphone, tablette, ordinateur).
  Le service worker met en cache l'application (stratégie « cache d'abord, mise à jour en arrière-plan »)
  et les aventures publiées au moment où on les ouvre. Quand une nouvelle version prend la main alors que la page tourne
  encore sur les fichiers d'avant, un bandeau propose « Recharger » (jamais imposé : une partie peut être en cours).
- **Moteur séparé de l'interface.** `js/core` est testé en Node (`node --test tests/`).
  Le même moteur pourra servir plus tard à une version imprimable, un bot, ou une application mobile.
- **Dés reproductibles.** Le générateur aléatoire est « à graine » : une partie sauvegardée garde son état
  aléatoire, ce qui empêche de recharger pour relancer un dé (optionnel, choisi par l'auteur).

### Format d'une aventure (`adventure.json`)

```jsonc
{
  "format": "livre-heros/1",
  "id": "la-tour-de-brume",
  "meta": { "title": "La Tour de Brume", "author": "…", "cover": "images/cover.webp", "description": "…" },
  "rules": {
    "stats": [
      { "id": "habilete",  "label": "Habileté",  "roll": "1d6+6" },
      { "id": "endurance", "label": "Endurance", "roll": "2d6+12" },
      { "id": "chance",    "label": "Chance",    "roll": "1d6+6" }
    ],
    "classes": [ { "id": "guerrier", "label": "Guerrier", "rolls": {} },
                 { "id": "sorcier",  "label": "Sorcier",  "rolls": { "habilete": "1d6+4" } } ],
    "gold": "2d6", "provisions": 2, "meal": { "stat": "endurance", "heal": 4 },
    "combat": { "skill": "habilete", "health": "endurance", "damage": 2, "luck": "chance", "fleeDamage": 2 },
    "allowBack": true,
    "economy": true,    // false : ni or ni repas sur la feuille ni à la création (livre sans économie)
    "freeJump": false   // true : le joueur peut taper un numéro de paragraphe (énigmes « rendez-vous au numéro calculé » des livres papier)
  },
  "items": { "cle-argent": { "name": "Clé d'argent", "description": "Un 111 est gravé dessus." } },
  "start": "1",
  "sections": {
    "1": {
      "text": "Vous vous éveillez à l'aube…",
      "image": "images/1.webp",
      "onEnter": [ { "op": "stat", "stat": "endurance", "add": -2 } ],
      "blocks":  [ { "type": "combat", "enemies": [ { "name": "Gobelin", "skill": 7, "health": 6 } ], "win": "186", "flee": "120" } ],
      "choices": [ { "text": "Ouvrir la porte", "to": "44", "if": { "has": "cle-argent" }, "effects": [] } ],
      // facultatif : "group" sur un choix range les choix sous un intitulé ; "choiceLayout": "columns" met les groupes côte à côte
      "ending": null
    }
  }
}
```

**Conditions** : `{has}`, `{flag}`, `{stat, gte|lte|eq}`, `{gold, gte}`, `{visited}`, `{class}`, combinées par `{all:[…]}`, `{any:[…]}`, `{not:…}`.
**Effets** : `stat` (add / set / `"initial"` / addInitial), `gold`, `provisions`, `give`, `take`, `flag`, `note`, `newDay`, `meal`.
**Conditions supplémentaires** : `{caster}`, `{ate}`, `{day, gte}`.
**Blocs** : `test` (caractéristique contre 2d6), `roll` (table de dés), `combat` (`enemies`, `win`, `flee?`, `lose?`, `mode?: "together"`, `note?` : règle spéciale affichée au-dessus des combattants), `shop` (`offers: [{item, price, stock?}]` : ce que le marchand vend ; `wants: [{item, price, stock?}]` : ce qu'il rachète), `spells` (options `{code, to, cost?}`), `actions` (greffon objets : boutons en un clic).
**Règles** : `spells: {enabled, stat, casters, typeCode, unknownCost, book: [{code, name, cost, requires, description}]}`, `time: {enabled, mealRequired, stat, penalty}`. `tu: true` : le moteur tutoie le joueur (règle des tests de caractéristique, « Lance 2d6 : tu réussis si… » ; « Noté sur ta feuille » ; retour en arrière) ; sans `tu`, `defis.tu` sert aussi. `economy: false` : ni or ni repas (création, feuille, version imprimable). Sans caractéristiques (`stats: []`) et avec une bourse fixe, la création ne demande pas de lancer les dés, et la version imprimable omet dés, combats et Chance.
**Son** : `meta.sound` (ambiance générale), `sections[n].sound` + `soundLoop`.
**Renvois cachés** : `sections[n].links: [{ to, label? }]` — destinations que le joueur atteint en tapant un numéro trouvé dans le texte (règle `freeJump`) ; pas de bouton en lecture, mais comptés dans le graphe (pointillés), la vérification et les paragraphes atteignables.
**Repères** : `meta.markers: [{ id, label, icon (emoji), kind?: "item", sections: ["12", …] }]` — paragraphes mis en avant dans le graphe (badge, liste « Repères ») ; ex. les Sept Serpents d'un livre.
**Lecture** : `rules.numbers: false` cache les numéros de paragraphe pendant la lecture (titres seuls, ou l'**étape** de l'auteur : `sections[n].step` — « 3 », « B » — sur `rules.steps`, affichée « 3/9 » avec une jauge ; les choix portent l'étape où ils mènent, « › », ou « ↺ » s'ils restent sur le paragraphe ; pas de carte des paragraphes visités ; la version imprimable et l'éditeur gardent les numéros). `rules.continuous: true` : **lecture continue**, les paragraphes lus restent au-dessus du paragraphe courant (texte, illustration, puis le choix qui en est sorti, sans rien d'interactif) ; la suite s'ajoute en bas puis la page remonte jusqu'à ce qu'elle soit en haut de l'écran ; chaque nouveau paragraphe apparaît comme de l'encre (morceau par morceau, flou puis net, de gauche à droite ; rien si l'appareil réduit les animations) ; trente au plus à l'écran ; un choix qui reste sur le paragraphe n'ajoute rien ; « Revenir » retire le dernier. Le fil est gardé dans la partie (`state.trail`, avec le texte du choix) et suit les retours en arrière ; une ancienne sauvegarde commence au paragraphe courant.
**Télé** : `meta.tele: { url, title?, cinema? }` (`url` absolue, relative au livre, ou avec `{host}` remplacé par la machine qui sert le livre : `http://{host}:8081/`) affiche une page compagnon (un monde en 3D, une carte animée…) à côté de l'en-tête du paragraphe, qui passe à gauche (numéro, titre, « Écouter ») ; sur téléphone, la télé vient sous l'en-tête. `sections[n].tele` donne un repère libre (« sentier-3:etape-2 ») ; sans repère, la télé garde celui du dernier paragraphe qui en avait un. Le lecteur l'envoie par `postMessage({ type: "livre-heros:tele", cue, section }, origine de la page)` au chargement, à chaque changement et quand la page annonce `{ type: "livre-heros:tele-ready" }`. La page compagnon peut proposer ses vues (`{ type: "livre-heros:tele-views", views: [{ id, icon, label, active?, disabled? }] }`) : le lecteur les met en boutons dans la barre de la télé et renvoie `{ type: "livre-heros:tele-view", id }`. Le plein écran (⛶) est celui de **toute la page**, en cinéma (barre du haut masquée) : la pastille, la feuille, le sac et la carte restent à portée. Le cadre (sans navigation ni fenêtres : `sandbox`) reste monté d'un paragraphe à l'autre ; le lecteur peut l'éteindre (l'appareil s'en souvient). Avec la télé, la lecture prend toute la largeur (numéro, titre et boutons plus petits) ; quand la page défile, la télé s'envole en vignette en haut à droite, réductible en pastille. Le récit passe en **sous-titres** en bas de la télé, comme une légende (un paragraphe par carton, les longs coupés entre deux phrases) ; le lecteur envoie sa hauteur (`legend`, en pixels) pour que la page compagnon pose ses boutons juste au-dessus ; un toucher sur la télé hors d'un objet (`livre-heros:tele-tap`) fait avancer la légende, « ‹ » au premier sous-titre revient au paragraphe précédent (si le livre le permet) ; qui avancent à la molette, aux flèches ou d'un clic ; **le défi et les choix n'apparaissent qu'au dernier sous-titre** (« Passer le récit » toujours proposé), puis la page descend jusqu'à eux ; les messages (gains, notes) surgissent un instant puis s'effacent (`rules.toasts: true` pour le même effet sans télé) ; le **plein écran** prend toute la télé, sous-titres compris (même en mode « Texte »), les choix y restent en boutons ; les **blocs** du paragraphe (défis, activités) s'ouvrent ensuite dans une fenêtre au-dessus de la télé, qui reçoit `paused: true` et peut s'arrêter derrière (« Voir la télé » ou Échap cachent la fenêtre, une pastille « Reprendre le défi » la rappelle ; un nouveau paragraphe rend la télé en grand, et en plein écran si elle l'était quand le défi s'est ouvert ; en plein écran, les messages s'affichent dans la télé) ; le bouton « Texte » remet le récit sous la télé (l'appareil s'en souvient ; le texte complet reste lu par les lecteurs d'écran). **Cinéma** (`meta.tele.cinema: true` pour l'ouvrir d'emblée, bouton « Cinéma » / « Page », l'appareil s'en souvient) : (ouvert d'emblée ; préférences de la télé propres à chaque livre) le monde de la télé occupe tout l'écran sous la barre du haut ; le livre passe par-dessus (les défis et les messages **dans** la télé, visibles aussi en plein écran) : une pastille (numéro, titre, Écouter, Page, Carte, Sac, Feuille, et la progression : compteurs visibles, collections trouvées sur le total ; sa hauteur part vers la page compagnon, `top`, qui range ses cartes dessous), les sous-titres, les boutons dans la télé, les défis en fenêtre, les messages ; la feuille d'aventure devient un tiroir ; une fin de partie revient à la page. Un bloc `tele: "cote"` (défi facultatif) s'ouvre en panneau sur le côté, sans arrêter la télé. Pas de télé en lecture continue ni en mode saisie.
**La carte du monde, autre vue des choix** : hors triche, un lieu connu où mène un choix possible du paragraphe (le paragraphe d'arrivée porte ce lieu) est marqué ✈ et s'atteint d'un clic, qui fait ce choix ; la carte, la télé et les boutons passent par le même événement `livre-heros:choose` ({ index | tag, section }).
**Feuille repliable** : sur grand écran, « Replier › » au-dessus de la feuille d'aventure la range (la lecture prend toute la largeur), « 📜 Feuille ‹ » la rouvre ; l'appareil s'en souvient. Sur téléphone, la feuille reste un tiroir.
**Carnet horodaté** : `rules.noteTime: true` : chaque note (`op: note`) commence par l'heure (« 13 h 17 · … »).
**Icônes des livres** : partout où un livre donne une icône (objets, badges, onglets du sac, cartes, pion), c'est un émoji **ou une image du livre** (`"icon": "images/icones/main.svg"`) : un SVG est dessiné dans la couleur du texte (lisible en clair et en sombre), un PNG (pictogramme) tel quel. Pour l'accessibilité : un seul système d'icônes par public, une icône par idée, toujours avec le mot (WCAG 3.2.4, FALC).
**Avatar** : `rules.avatars` = `'initials'` (médaillon aux initiales du nom, huit couleurs au texte blanc lisible), `[{ label, list: [émojis] }]` (ou une simple liste d'émojis) ; absent : des personnages (féminin, masculin, neutre) et des émojis sobres ; `false` : pas d'avatar. Choisi à la création, changé en touchant l'avatar sur la feuille ; état : `state.hero.avatar`.
**Feuille** : Notes et Dés repliables (l'appareil se souvient de ce qui est ouvert) ; le lanceur de dés propose 1d6 à 1d20 en un toucher, montre les derniers lancers et salue un double ou un maximum ; « Tester ma Chance » seulement si l'aventure a une caractéristique de Chance ; Paragraphes visités, Sauvegarder et Quitter en icônes.
**Saisie rapide** (choix regroupés) : sur téléphone (ou `choiceLayout: "tabs"`), un groupe à la fois : des onglets collés en haut (un élève par onglet ; glisser à gauche ou à droite pour changer), sous eux ce qui concerne le groupe (les compteurs dont la ligne est son nom), puis ses boutons en grille. Le bouton **Mode saisie** (`rules.focusLabel` pour le nommer, « Mode évaluation » ; `rules.groupsLabel` pour les onglets, « Élèves ») ne garde que la saisie : ni texte, ni image, ni paragraphes lus, ni voyage sur le plateau ; en-tête et messages compacts ; seuls restent les blocs `keepInFocus` (minuteur). L'appareil s'en souvient.
**Choix regroupés** : `choices[i].group` (texte libre) range les choix sous un intitulé, dans l'ordre de leur premier choix ; les choix sans groupe forment un bloc sans intitulé. `sections[n].choiceLayout: "columns"` affiche les groupes côte à côte avec des boutons compacts (une colonne par élève, par lieu…). Un choix qui ramène au paragraphe courant porte la marque ↺.
**Graphe** : regroupement « Par étape » (tranches de distance au départ, choisi d'office au-delà de 150 paragraphes), « Voisinage » (rayon autour du paragraphe ouvert), « Masquer les morts ».

#### Champs ajoutés par les greffons

Tous sont facultatifs : une aventure qui ne les a pas s'ouvre et se joue comme avant. Le détail est dans `docs/plugins/<nom>.md`.

| Greffon | Aventure | Effets / conditions / blocs | État de la partie |
|---|---|---|---|
| [equipement](plugins/equipement.md) | `rules.equipment: {enabled, slots:[{id,label}], capacity, unarmedPenalty, weaponSlot}` ; objets : `slot`, `attack`, `damage`, `armor`, `small` | `{op:"equip", item}`, `{op:"unequip", slot, take?}` ; `{equipped, negate?}`, `{equippedSlot, negate?}` | `state.equipement` |
| [minuteur](plugins/minuteur.md) | — | bloc `{type:"timer", seconds, label?, after?}` : compte à rebours pour le lecteur, sans effet | — |
| [compteurs](plugins/compteurs.md) | `rules.counters: [{id, label, start, min?, max?, visible, quiet?, icon?, row?, column?, table?, triggers:[{when:"gte"\|"lte", value, action:"message"\|"death"\|"victory", message}]}]` | `{op:"counter", counter, add\|set}` (nombre ou dés) ; `{counter, gte\|lte\|eq}` | `state.counters` |
| [compagnons](plugins/compagnons.md) | `companions: {id: {name, skill, health, damage?, image?, description?}}` | `{op:"companion", companion, action:"join"\|"leave"\|"heal"\|"hurt", amount?}` ; `{companion}`, `{not:{companion}}`, `{companions:true, gte\|lte\|eq}` | `state.companions` |
| [campagne](plugins/campagne.md) | `rules.campaign: {id, title, book, prefix, modes, fields:{stats, counters, items, flags, companions, gold}, newcomer}` ; fin : `passport: false` | — | `state.campaign = {from, code}` |
| [defis](plugins/defis.md) | — | bloc `{type:"challenge", kind:"text"\|"number"\|"qcm"\|"multi"\|"order", question, answers, attempts, hints:[{text, cost}], success, failure, successEffects, failureEffects, hashed?, salt?}` | `state.blocks[i]` |
| [zefor](plugins/zefor.md) | `rules.zefor: {origin, publicKeyJwk, codeKey}` | bloc `{type:"zefor", url, exercise?, mode:"code"\|"message"\|"retour", codeHashes, codeSalt, minScore?, success, failure?, allowSkip?, skipTo?, skipEffects?}` | `state.zefor.done` |
| [maths](plugins/maths.md) | aucun champ : `$…$` et `$$…$$` dans les textes | — | — |
| [carte](plugins/carte.md) | `meta.worldMap: {image, alt?, places:{nom:{x,y}}, revealUnvisited?, showPath?}` | bloc `{type:"map", image, alt, hotspots:[{x,y,w,h,label,to,if?,hideIfUnavailable?,effects?}]}` ; `{op:"revealPlace", place}` ; `{placeVisited}`, `{placeNotVisited}`, `{placeKnown}` | `state.carte` |
| [succes](plugins/succes.md) | `achievements: [{id, title, description, secret, when:"end"\|"anytime", ending, cond?}]` | — | magasin local `succes\|<id>`, `stats\|<id>` |
| [echanges](plugins/echanges.md) | `meta.ifid` (IFID Twine réutilisé à l'export) | — | — |
| [partage](plugins/partage.md) | aucun champ ; lien `#/importer/<jeton>` (JSON compressé, en-tête versionné + CRC-32) | — | — |
| [accessibilite](plugins/accessibilite.md) | aucun champ ; préférences du lecteur (`lh.a11y`) | — | — |

### Publication d'une aventure

1. Dans l'éditeur : **Exporter** → `mon-aventure.lhz`.
2. Pour la partager à des joueurs : l'envoyer (ils font **Importer**), ou la publier sur le site :
   dézipper dans `adventures/mon-aventure/` et ajouter une ligne dans `adventures/index.json`.
3. **Rayons de la bibliothèque** : une ligne de l'index peut porter `series` (le rayon : une série, une campagne),
   `seriesOrder` (le tome) et `seriesNote` (la présentation du rayon). La bibliothèque range alors les cartes par
   rayon (raccourcis vers chaque rayon en tête ; le titre du livre perd le nom de la série qu'il répète), les tomes
   dans l'ordre ; sans `series` nulle part, la grille est celle d'avant. Une ligne peut aussi être un **document à
   lire** : `kind: "document"`, `href` (le PDF), `coverUrl` (sa vignette) ; une aventure peut renvoyer à son livre
   d'origine par `pdf`. Une copie importée d'une aventure publiée la remplace dans la liste (une seule carte).
   En local, `npm run dev -- --bibliotheque catalogue.json` fabrique cet index à partir de dossiers, de `.lhz` et de
   PDF (voir `tools/dev.py`).
