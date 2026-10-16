# Greffon « inventaire » : le sac, les indices et le mode triche

Le sac à dos de la Feuille d'Aventure devient une **fenêtre de sac**, à la manière des jeux d'aventure : des
onglets, une grille de cases, et pour chaque objet sa **fiche** (grande icône, description, indice). Le livre
peut aussi **tenir la feuille** : le joueur ne s'ajoute plus d'objets lui-même, sauf s'il passe sa partie en
**mode triche**, un choix délibéré qui débloque tout mais ne compte plus.

Une aventure sans réglage garde son sac habituel : un seul onglet « Objets », et la feuille libre.

## Pour le joueur

- **Ouvrir le sac** : la touche **I**, la bande du sac dans la Feuille d'Aventure (les dix premiers objets en
  petites cases, puis « Ouvrir »), ou, sur téléphone, le bouton **Sac** à côté de « Feuille ».
- **Onglets** : les catégories d'objets (Objets, La quête…), puis les **collections**, puis les onglets
  ajoutés par d'autres greffons (la **Carte** du monde, le **Carnet** de notes de la partie).
- **Une collection** montre toutes ses cases, trouvées ou non (« ? » pour une case vide, avec son numéro), et
  le compte (« 8/33 »). Si elle porte un **message**, chaque objet trouvé dévoile une lettre.
- **Un tableau des badges** (collection `board`) : chaque badge garde son icône (grisée et 🔒 tant qu'il n'est
  pas gagné), son nom et **comment le gagner** ; une jauge « 3 sur 9 ». La Feuille d'Aventure en montre une
  petite grille (3 × 3 par défaut) qui ouvre le tableau, et l'écran de fin le bilan des badges. Un badge gagné
  s'annonce « Badge gagné : 🙋 Joker ! » et sa fiche s'ouvre comme celle d'un objet.
- **Un badge gagné est un moment d'arrêt** : le badge surgit au milieu d'un feu d'artifice et tourne sur lui-même
  devant des rayons, avec une fanfare ; un toucher le retourne pour lire sa carte (comment il a été gagné, sa fiche) ;
  « Ranger dans le sac » (ou Échap) l'envoie voler jusqu'aux badges de la feuille (ou au bouton Sac). Plusieurs
  badges gagnés d'un coup passent l'un après l'autre ; rien en mode triche ni au-delà de trois d'un coup ; sans
  animation si l'appareil réduit les animations. `"celebrate": false` sur la collection la rend discrète.
- **Une image** (objet avec `image`, par exemple un plateau de jeu) : la fiche prend toute la largeur et montre
  l'image ; un toucher l'agrandit. Elle se choisit dans l'éditeur (onglet Objets, volet « Dans le sac »).
- **Un paquet de cartes** (objet avec `cards`) : sa fiche prend toute la largeur et propose trois vues :
  **Plan** (toutes les cartes ; en tableau lignes × colonnes quand chaque carte a une ligne et une colonne),
  **Une à une** (on fait glisser la carte, ou ‹ › et les flèches du clavier ; filtre par ligne) et **Carrousel**
  (les cartes tournent autour de celle du milieu ; on les fait glisser, ou « Faire tourner »). Toucher une carte
  du plan l'ouvre en grand. L'appareil se souvient de la vue choisie pour chaque paquet.
  Une carte peut avoir **deux faces** : celle du lecteur (l'image, le mot, la réponse) et celle du joueur
  (`player`, par exemple l'image seule, sans le mot à trouver) ; le bouton **Côté élève** les fait voir, et la
  version imprimable imprime la face du joueur. Règle d'accessibilité : un pictogramme placé au-dessus d'un mot se
  lit comme ce mot ; l'image d'une carte est donc celle de son mot, et l'icône du thème (la zone) va dans le
  bandeau, à côté de son nom.
- **Le Carnet** : les notes de la partie (celles que le livre fait écrire, et les siennes), et **Télécharger le
  relevé** : un fichier Markdown avec la date, le héros, les compteurs (en tableau), les badges gagnés et à gagner,
  puis le carnet ligne à ligne, pour l'analyse après la partie. Avec `rules.noteTime: true`, chaque note commence
  par l'heure (« 13 h 17 · … »).
- **La version imprimable** ajoute une annexe « À découper » pour les paquets de cartes marqués `print` : cartes de
  58 × 82 mm, traits de coupe, couleurs et pictogrammes conservés ; `print: 3` imprime chaque carte trois fois (un
  jeu par joueur). Sur papier, le pied de carte ne garde que la ligne (le prénom).
- **La fiche** d'un objet : description, bouton **« Un indice : à quoi peut-il servir ? »** (l'indice dépend
  du mode de jeu : plus direct pour les petits, plus allusif pour les grands), et les actions de l'objet
  (Utiliser, Boire…).
- **Nouveau** : un objet reçu depuis la dernière ouverture du sac porte le mot « Nouveau » ; le bouton Sac et
  la bande de la feuille en donnent le nombre.
- Au clavier : flèches pour aller de case en case, Entrée pour la fiche, Échap pour fermer.

## La feuille tenue par le livre, et le mode triche

Avec `"sheet": { "locked": true }`, c'est l'aventure qui donne et qui prend : ni « Ajouter » ni « Retirer »
dans la feuille ou dans le sac. Avec `"cheat": true`, un volet **Mode triche** (replié, en bas du sac) propose
de passer la partie en triche, après confirmation :

- c'est **définitif pour la partie** ; un badge 🃏 l'indique dans la lecture et dans la feuille ;
- le joueur peut alors ajouter et retirer des objets, et **Tout débloquer** : tous les objets de l'aventure
  (un exemplaire), les marques et les compagnons transportés par la campagne, plus l'or et les compteurs
  prévus par `unlock` ;
- la partie compte comme une **partie de test** pour les succès : rien n'est enregistré ;
- dans une campagne qui déclare `cheatFlag`, le **passeport** porte cette marque : le livre suivant repart en
  mode triche (voir [campagne.md](campagne.md)).

Le mode test de l'auteur (`?test=1`) reste un outil d'auteur : il ne délivre pas de passeport.

## Pour l'auteur

- **Onglet Objets**, volet « Dans le sac » de chaque objet : *Onglet du sac* (catégorie), *Étiquette* (un
  texte très court affiché sur la case, par exemple une lettre), *Indice* (général) et un indice par mode.
- **Onglet Règles → Feuille et sac** : *Feuille tenue par le livre*, *Permettre le mode triche*, l'or donné
  par « Tout débloquer », et la liste des problèmes de réglage (message trop long ou trop court, catégorie
  inconnue).

Les catégories, les collections et les compteurs de « Tout débloquer » s'écrivent dans le fichier.

## Format JSON

```jsonc
{
  "items": {
    "lanterne": {
      "name": "Lanterne", "icon": "🏮", "description": "…",
      "category": "objets",                      // onglet du sac (absent : le premier)
      "hint": "Elle éclaire les grottes.",        // indice général
      "hints": { "petit": "…", "gardien": "…" }  // indice par mode (sinon l'indice général)
    },
    "piece-01": { "name": "Pièce n° 1", "icon": "🪙", "tag": "L" },  // tag : texte très court sur la case
    "badge-joker": { "name": "Joker !", "icon": "🙋", "description": "…",
      "earn": "Note un joker demandé par un élève.",   // badge : comment le gagner (visible avant)
      "gain": "Badge gagné" },                          // message à l'obtention (sinon « Objet obtenu »)
    "plateau": { "name": "Plateau", "icon": "🗺️", "image": "images/plateau.jpg", "alt": "…" },   // image dans la fiche
    "cartes": { "name": "Cartes des élèves", "icon": "🎴",
      "cards": { "view": "map", "print": true,          // vue de départ : map (plan), one (une à une), carousel ; print : à découper
        "list": [ { "title": "lama", "sub": "2 syllabes", "band": "Le pré", "step": "2", "color": "#558B2F",
                    "image": "images/pictos/2683.png",   // pictogramme au-dessus du mot (facultatif)
                    "icon": "images/icones/x.svg",        // petite icône du bandeau (facultatif ; émoji ou image)
                    "player": { "title": "", "image": "images/pictos/9067.png" },  // face du joueur (facultatif)
                    "row": "Enzo", "col": "Le pré", "foot": "syllabes" } ] } }
  },
  "rules": {
    "inventory": {
      "categories": [
        { "id": "objets", "label": "Objets", "icon": "🎒" },
        { "id": "quete", "label": "La quête", "icon": "📜" }
      ],
      "collections": [
        { "id": "pieces", "label": "Pièces", "icon": "🪙",
          "items": ["piece-01", "piece-02", "piece-03"],
          "message": "LE…" },                     // une lettre par objet, dans l'ordre ; espaces et ponctuation libres
        { "id": "badges", "label": "Badges", "icon": "🏅",
          "items": ["badge-joker", "badge-miroir"],
          "board": true, "columns": 3 }           // tableau des badges : 3 colonnes par défaut (1 à 6) ; "celebrate": false : sans célébration
      ]
    },
    "sheet": {
      "locked": true,                             // pas d'ajout ni de retrait par le joueur
      "cheat": true,                              // mode triche proposé
      "unlock": { "gold": 50, "counters": { "memoire": 50 } }
    }
  }
}
```

- Un objet d'une collection n'apparaît que dans sa collection ; un badge (collection `board`) n'apparaît ni dans
  la bande du sac ni dans son compte.
- Pour donner un badge une seule fois : `{ "op": "give", "item": "badge-joker", "if": { "not": { "has": "badge-joker" } } }`.
- La vérification signale un badge sans « comment le gagner ».
- Le message doit avoir **autant de lettres** que la collection a d'objets (les lettres accentuées comptent ;
  espaces, apostrophes et ponctuation ne comptent pas).
- État de la partie : `state.cheat = null | { turn, unlocked, passport? }`, `state.seenItems = { id: true }`.

## Pour les greffons

`js/ui/registry.js` :

- `registerInventory(Composant)` : la fenêtre du sac (celle de ce greffon) ;
  `Composant({ adv, source, state, update, tab, onClose })`.
- `registerInventoryTab({ id, order, label, icon, show?(adv, state), Tab({ adv, source, state, update }) })` :
  un onglet de plus dans le sac. Le greffon carte y met la carte du monde (`order: 80`), ce greffon le
  Carnet (`order: 90`).

Moteur pur (`core.js`, testé dans `tests/inventaire.test.mjs`) : `inventoryView`, `hintFor`, `canEditItems`,
`startCheat`, `unlockAll`, `newItems`, `markSeen`, `messageOf`, `inventoryProblems`.
