# Greffon « carte » : cartes illustrées cliquables et carte du monde

Ce greffon ajoute trois choses à vos aventures :

1. **Le bloc « Carte »** : une illustration (plan de ville, vallée, donjon…) sur laquelle vous tracez des
   **zones cliquables**. Chaque zone mène à un paragraphe, comme un choix. Une zone peut être fermée
   par une condition (« il faut la Clé de fer ») : le joueur la voit alors avec un **cadenas** et la raison.
2. **La carte du monde** : une grande carte ouverte depuis la Feuille d'Aventure. Elle montre les lieux
   déjà visités, le lieu où se trouve le héros (« Vous êtes ici ») et le chemin parcouru.
3. **Des lieux « à découvrir »** : l'effet *Révéler un lieu* (le héros trouve une carte au trésor, un
   villageois lui indique la tour…) et des conditions *est déjà allé à*, *n'est jamais allé à*,
   *connaît l'emplacement de*.

Tout reste lisible sans les couleurs : les zones sont encadrées de **pointillés épais** avec une
étiquette écrite, les zones fermées ont un **cadenas**, des **points** et une trame hachurée ; sur la
carte du monde, chaque sorte de lieu a sa **forme** (disque plein, anneau, double cercle, « ? »).

## Le bloc « Carte »

### Dans l'éditeur

1. Ouvrez un paragraphe, puis dans « Jets de dés, combats, boutique » cliquez sur **Carte**.
2. **Image de la carte** : ajoutez l'illustration (elle est compressée automatiquement).
3. **Description de l'image** : une phrase lue par les lecteurs d'écran (« Carte de la vallée : le
   village au nord, le marais au sud… »).
4. **Tracez les zones** en faisant glisser la souris ou le doigt sur l'image. Chaque zone porte un
   numéro. Pour la modifier :
   - glissez-la pour la **déplacer**, tirez son **coin carré** pour la **redimensionner** ;
   - ou réglez-la au clavier avec les champs *Gauche*, *Haut*, *Largeur*, *Hauteur* (en % de l'image) ;
   - le bouton **Zone au centre** ajoute une zone sans souris.
5. Pour chaque zone : l'**étiquette** affichée sur la carte (« La tour noire ») et **Rendez-vous au**
   (le numéro du paragraphe, ou « ＋ » pour en créer un).
6. Cliquez sur le numéro d'une zone pour la sélectionner et régler en plus :
   - une **condition** (même éditeur que pour les choix) et, si vous voulez, *Cacher cette zone si la
     condition n'est pas remplie* (passage secret) ;
   - des **effets en empruntant ce passage** (payer le passeur, perdre de l'Endurance…).

L'onglet **Vérifier** signale : une carte sans image ou sans zone, une zone sans destination ou sans
étiquette, une zone qui dépasse de l'image, un objet inconnu dans une condition.

### Pour le joueur

La carte s'affiche dans le paragraphe, à la taille de l'écran. Il touche ou clique une zone pour s'y
rendre ; au clavier, la touche Tab passe d'une zone à l'autre et Entrée la choisit. Sous la carte, une
légende rappelle chaque destination et, pour les zones fermées, la raison (« Il faut avoir : Clé de
fer »). Si l'image manque, les destinations sont proposées comme des choix ordinaires.

### Version imprimable

L'image est imprimée avec les zones encadrées, suivie de la liste :
« Pour aller vers le marais, rendez-vous au **2**. », « *Si vous possédez : Clé de fer* — pour aller
vers la tour noire, rendez-vous au **3**. » Les effets sont rappelés entre parenthèses.

## La carte du monde

### Dans l'éditeur

1. Donnez un **Lieu** à vos paragraphes (champ « Lieu » de l'onglet Paragraphe) : « Brumeval »,
   « Marais », « Tour noire »… Plusieurs paragraphes peuvent partager le même lieu.
2. Onglet **Carte du monde** : ajoutez l'image de la carte.
3. La liste de droite contient tous les lieux trouvés dans vos paragraphes (« placé » ou « à placer »).
   **Cliquez sur un lieu, puis cliquez sur la carte** pour le placer. Le lieu suivant à placer est
   choisi tout seul. Les champs *Horizontal* et *Vertical* permettent un réglage précis ; les numéros
   de paragraphes ouvrent les paragraphes de ce lieu.
4. Options :
   - **Montrer les lieux pas encore visités sous forme de « ? »** : le joueur sait qu'il y a quelque
     chose à découvrir, sans savoir quoi. Sinon, ils restent cachés.
   - **Tracer le chemin parcouru** : une ligne pointillée relie les lieux dans l'ordre du voyage.

### Pour le joueur

Le bouton **Carte du monde** apparaît dans la Feuille d'Aventure dès que la carte a une image.
Les repères :

| Forme | Signification |
|---|---|
| grand double cercle + « Vous êtes ici » | lieu actuel (« Dernier lieu connu » si le paragraphe n'a pas de lieu) |
| disque plein + nom | lieu déjà visité |
| anneau vide + nom (cadre en tirets) | lieu connu (révélé), pas encore visité |
| cercle en tirets avec « ? » | lieu inconnu (seulement avec l'option « ? ») |
| ligne de points | chemin parcouru |

Une phrase résume aussi la carte (« Vous êtes ici : Brumeval. Lieux visités : Brumeval, Marais. »).

### Version imprimable

La carte du monde est ajoutée en annexe, sur une nouvelle page, avec tous les lieux nommés et une
case à cocher par lieu.

## Révéler un lieu, conditions de lieu

- Effet **Révéler un lieu (carte du monde)** : le lieu apparaît sur la carte du joueur (anneau vide)
  avant même qu'il y soit allé, avec le message « Nouveau lieu sur votre carte du monde : … ».
- Conditions (liste « Le héros… ») :
  - **est déjà allé à (lieu)** : au moins un paragraphe de ce lieu a été visité ;
  - **n'est jamais allé à (lieu)** ;
  - **connaît l'emplacement de (lieu)** : lieu révélé ou déjà visité.

Exemple : sur la carte de la vallée, la zone « La tour noire » a la condition *connaît l'emplacement de
« Tour noire »* et l'option *Cacher cette zone* ; elle n'apparaît qu'après la rencontre du vieil ermite
qui révèle la tour.

## Format JSON

```jsonc
{
  "meta": {
    "worldMap": {
      "image": "images/monde.webp",
      "alt": "La vallée de Brumeval et la côte",   // facultatif
      "places": { "Brumeval": { "x": 32, "y": 42 }, "Tour noire": { "x": 66, "y": 22 } },
      "revealUnvisited": false,                    // true : lieux non visités affichés « ? »
      "showPath": true                             // facultatif, vrai par défaut
    }
  },
  "sections": {
    "1": {
      "place": "Brumeval",
      "text": "Vous dépliez la carte de la vallée.",
      "blocks": [{
        "type": "map",
        "image": "images/vallee.webp",
        "alt": "Carte de la vallée : forêt au nord, marais au sud-ouest.",
        "label": "Où voulez-vous aller ?",          // facultatif
        "hotspots": [
          { "x": 8, "y": 58, "w": 30, "h": 32, "label": "Le marais", "to": "2" },
          { "x": 64, "y": 6, "w": 22, "h": 40, "label": "La tour noire", "to": "3",
            "if": { "placeKnown": "Tour noire" }, "hideIfUnavailable": true },
          { "x": 70, "y": 70, "w": 29, "h": 29, "label": "Le bac du port", "to": "5",
            "effects": [{ "op": "gold", "add": -1 }] }
        ]
      }]
    },
    "2": { "place": "Marais", "onEnter": [{ "op": "revealPlace", "place": "Tour noire" }] }
  }
}
```

- `x`, `y` : coin supérieur gauche de la zone, `w`, `h` : largeur et hauteur, **en pourcentage de
  l'image** (0 à 100) : les zones suivent l'image quelle que soit la taille de l'écran.
- `if`, `hideIfUnavailable`, `effects` : comme pour un choix. `to` est mis à jour par la renumérotation.
- Conditions : `{ "placeVisited": "Marais" }`, `{ "placeNotVisited": "Marais" }`, `{ "placeKnown": "Tour noire" }`.
- Effet : `{ "op": "revealPlace", "place": "Tour noire" }`. Les lieux révélés sont gardés dans la partie
  (`state.carte.revealed`).
- Les images des cartes sont incluses dans l'export `.lhz`.
- Une aventure sans ces champs fonctionne comme avant ; une ancienne sauvegarde sans `state.carte` aussi.
