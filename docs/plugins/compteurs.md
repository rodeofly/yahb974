# Greffon « compteurs »

Des **compteurs libres** pour suivre tout ce qui n'est pas une caractéristique : Réputation, Temps restant,
Malédiction, Savoir, Suspicion des gardes, Points de Foi… Le héros les voit sur sa Feuille d'Aventure (sauf
les compteurs secrets), le texte les fait monter ou descendre, certains choix ne s'ouvrent qu'à partir d'un
certain total, et un seuil peut afficher un message, tuer le héros ou lui donner la victoire.

## Dans l'éditeur

### 1. Créer un compteur (onglet **Règles**, section **Compteurs**)

- **+ Compteur** crée un compteur vide ; les boutons **Modèles** (Réputation, Temps, Malédiction, Savoir)
  en créent un déjà réglé, à adapter.
- **Nom** : ce que lit le joueur (« Réputation »).
- **Identifiant** : le nom court utilisé dans le fichier de l'aventure (`reputation`). Pour le changer, tapez le
  nouveau puis **Renommer** : tous les effets et conditions qui l'utilisent sont mis à jour.
- **Départ** : un nombre (`0`, `12`) ou une formule de dés (`1d6`, `2d6+3`). L'éditeur indique les valeurs
  possibles, ou signale une formule invalide.
- **Minimum / Maximum** : le compteur ne sort jamais de ces bornes (laissez vide pour « aucune limite »).
  Avec un maximum, la Feuille d'Aventure affiche une barre.
- **Icône** : cœur, étoile, soleil, lune, drapeau, sablier, œil, bouclier, flamme, crâne, couronne…
- **Visible sur la Feuille d'Aventure** : décoché, le compteur est **secret** : le joueur ne le voit pas et
  aucun message n'annonce ses changements (seuls les messages de ses déclencheurs s'affichent). En mode
  « Tester d'ici », les compteurs secrets restent visibles, marqués « secret ».
- **Déclencheurs** : « quand la valeur *atteint ou dépasse (≥)* / *descend à ou sous (≤)* tel seuil, alors
  *afficher un message* / *mort du héros* / *victoire* », avec un texte.
  Un déclencheur agit **au moment où le seuil est franchi** : le message « On chante vos exploits » s'affiche
  quand la Réputation passe de 4 à 5, pas à chaque point gagné ensuite. Si elle redescend sous 5 puis y
  remonte, il s'affiche de nouveau. Pour la mort et la victoire, le texte devient la phrase de fin de partie.

Les problèmes de réglage (identifiant en double, minimum plus grand que le maximum, seuil impossible à
atteindre, condition déjà vraie au départ…) s'affichent sous chaque compteur.

### 2. Faire varier un compteur : l'effet **Compteur**

Partout où l'on ajoute un **Effet** (à l'arrivée sur un paragraphe, en choisissant un choix, en utilisant un
objet), choisissez le type **Compteur**, puis :

- **ajouter / retirer** un nombre de points (`1`, `-2`) ou un jet de dés (`1d6`, `-1d6`) ;
- ou **fixer la valeur à** un nombre.

Le résultat reste entre le minimum et le maximum, puis les déclencheurs sont vérifiés.
Le joueur voit par exemple « +1 Réputation (total : 3) ».

### 3. Ouvrir ou fermer un choix : la condition **a un compteur**

Dans la condition d'un choix, choisissez « Le héros… **a un compteur** », le compteur, puis **au moins (≥)**,
**au plus (≤)**, **exactement (=)** ou **entre… et…**. Un choix indisponible est grisé avec la raison
(« Il faut avoir au moins 5 points de Réputation. »), ou caché si vous cochez la case prévue.

### 4. Version imprimable

- **Règles** : un paragraphe « Les compteurs » explique chaque compteur, ses bornes et ses déclencheurs
  (« Dès que votre Temps descend à 0 ou moins, votre aventure s'achève : « Le soleil se couche… » »).
- **Feuille d'Aventure** : une case par compteur visible avec sa valeur de départ. Si le compteur a un
  minimum et un maximum proches (16 valeurs au plus), la case contient une réglette numérotée : la valeur de
  départ a un cadre épais, les seuils de mort ou de victoire un cadre double avec un crâne ou une couronne.
  Les compteurs secrets partagent une case « Autres compteurs ».
- **Effets** : « Ajoutez 1 point de Réputation sur votre Feuille d'Aventure, sans dépasser 10. »
- **Conditions** : « Si votre Réputation est de 3 ou plus — … »

Sur papier, un déclencheur ne peut pas agir seul : c'est la règle imprimée qui demande au lecteur de vérifier
ses seuils.

## Format JSON

```jsonc
"rules": {
  "counters": [
    {
      "id": "temps",              // identifiant (lettres, chiffres, tirets)
      "label": "Temps",           // nom affiché
      "start": "1d6+6",           // nombre ou formule de dés (défaut 0)
      "min": 0,                   // facultatif
      "max": 12,                  // facultatif (active la barre)
      "visible": true,            // false = compteur secret (défaut true)
      "icon": "hourglass",        // facultatif : tally (défaut), heart, star, sun, moon, flag, hourglass, eye,
                                  //   shield, flame, skull, crown, clover, coin, book, sword, lock
      "triggers": [
        { "when": "lte", "value": 0, "action": "death", "message": "Le soleil se couche : vous arrivez trop tard." }
      ]
    }
  ]
}
```

- `triggers[].when` : `"gte"` (atteint ou dépasse) ou `"lte"` (descend à ou sous).
- `triggers[].action` : `"message"`, `"death"` ou `"victory"`.

**État de la partie** : `state.counters = { "temps": 9, "reputation": 2 }`. Les valeurs de départ sont tirées
avec la graine de la partie (une partie rechargée ne relance pas les dés). Une ancienne sauvegarde sans
compteurs, ou un compteur ajouté après le début d'une partie, est créé au paragraphe suivant.

**Effet** :

```jsonc
{ "op": "counter", "counter": "reputation", "add": 1 }       // ajoute 1
{ "op": "counter", "counter": "temps", "add": -2 }           // retire 2
{ "op": "counter", "counter": "temps", "add": "-1d6" }       // retire 1d6
{ "op": "counter", "counter": "malediction", "set": 0 }      // remet à 0
```

**Condition** (combinable avec `all`, `any`, `not` comme les autres) :

```jsonc
{ "counter": "reputation", "gte": 5 }            // au moins 5
{ "counter": "temps", "lte": 2 }                 // au plus 2
{ "counter": "savoir", "eq": 3 }                 // exactement 3
{ "counter": "reputation", "gte": 2, "lte": 4 }  // entre 2 et 4
```

Une aventure sans `rules.counters` s'ouvre et se joue comme avant.

## Exemple complet

```jsonc
{
  "format": "livre-heros/1",
  "id": "le-marche-de-saint-pierre",
  "meta": { "title": "Le marché de Saint-Pierre" },
  "rules": {
    "counters": [
      { "id": "reputation", "label": "Réputation", "start": 2, "min": 0, "max": 10, "icon": "star",
        "triggers": [
          { "when": "gte", "value": 5, "action": "message", "message": "On chante vos exploits dans les tavernes." },
          { "when": "gte", "value": 10, "action": "victory", "message": "Le gouverneur vous nomme capitaine du port." }
        ] },
      { "id": "temps", "label": "Temps", "start": "1d6+6", "min": 0, "max": 12, "icon": "hourglass",
        "triggers": [ { "when": "lte", "value": 0, "action": "death", "message": "Le bateau est parti sans vous." } ] },
      { "id": "suspicion", "label": "Suspicion", "start": 0, "min": 0, "visible": false, "icon": "eye" }
    ]
  },
  "start": "1",
  "sections": {
    "1": {
      "text": "Le marché s'éveille. Une marchande a renversé ses paniers de letchis.",
      "choices": [
        { "text": "L'aider à tout ramasser", "to": "2",
          "effects": [ { "op": "counter", "counter": "reputation", "add": 2 }, { "op": "counter", "counter": "temps", "add": -1 } ] },
        { "text": "Monter à bord du navire du gouverneur", "to": "3", "if": { "counter": "reputation", "gte": 5 } }
      ]
    },
    "2": { "text": "…", "onEnter": [ { "op": "counter", "counter": "suspicion", "add": 1 } ], "choices": [ { "text": "Revenir", "to": "1" } ] },
    "3": { "text": "…", "ending": "victory" }
  }
}
```

## Pour les développeurs

Moteur pur : `js/plugins/compteurs/core.js` (effet `counter`, condition `{ counter }`, initialisation du héros,
normalisation, crochet d'entrée de paragraphe). Fonctions utiles exportées : `counterValue`, `counterProblems`,
`counterUsage`, `renameCounter`, `freeId`. Tests : `tests/compteurs.test.mjs`.
