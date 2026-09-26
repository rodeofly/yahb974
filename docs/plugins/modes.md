# Greffon « modes » : une aventure, plusieurs versions selon l'âge

Un **mode de jeu** est une version de l'aventure adaptée à un public : par exemple
« Petit explorateur (5-7 ans) », « Explorateur (8-9 ans) », « Grand explorateur (10-11 ans et plus) ».
On écrit **une seule** aventure ; pour chaque mode, on raccourcit un texte, on change une image ou une fin,
on montre ou on cache un choix, un défi, un combat.

Le lecteur choisit son mode en créant son héros. Une aventure **sans** modes se joue exactement comme avant :
aucun écran supplémentaire.

## Dans l'éditeur

### Onglet « Modes »

- **Ajouter trois modes (5-7, 8-9, 10-11 ans)** crée d'un coup trois modes prêts à modifier ;
  **Ajouter un mode** en crée un vide.
- Pour chaque mode : **Nom**, **Âges**, **Icône** (pousse, arbuste, grand arbre, boussole, cerveau…),
  **Description** montrée au lecteur quand il choisit.
- **Réglages du mode** :
  - **Retour en arrière** : comme dans les Règles, autorisé ou interdit (pratique : autorisé pour les petits) ;
  - **Lecture à voix haute** : au choix du lecteur, automatique à chaque paragraphe, ou désactivée ;
  - **Taille du texte** en pixels (vide = au choix du lecteur).

  Ces deux derniers réglages s'appliquent **pendant la partie seulement** : à la sortie de la partie
  (retour à la bibliothèque, nouveau héros), les réglages du lecteur reviennent. Si le lecteur change lui-même
  un réglage pendant la partie, son choix est gardé. Si la page est fermée en pleine partie, ses réglages
  reviennent au prochain lancement de l'application.
- Flèches **monter / descendre** : l'ordre des cartes. **Le premier mode est proposé par défaut.**
- **Supprimer** un mode efface ses variantes ; un choix ou un bloc réservé à ce seul mode n'est alors plus visible nulle part
  (la vérification le signale).
- **Tester en mode …** lance une partie d'essai dans ce mode ; **Imprimer cette version** ouvre la version imprimable du mode.
- **Vérifier par mode** : chaque mode est vérifié comme une aventure à part. Pour chacun : le nombre de paragraphes
  atteignables, de victoires et de fins, puis les erreurs et avertissements **des seuls paragraphes qu'on peut atteindre
  dans ce mode** (les autres servent aux autres modes ; ils sont résumés en une ligne « jamais atteints dans ce mode »).
  Un mode sans victoire atteignable est signalé.

### Panneau « Variantes selon le mode » (dans chaque paragraphe)

Sous les choix, un volet par mode. Son résumé dit ce qui change (« titre · texte · fin : aucune · 1 choix caché »)
ou « identique à l'original ».

- **Titre** et **Texte** dans ce mode : vide = ceux de l'original. **Partir du texte de l'original pour l'adapter**
  recopie le texte pour le raccourcir.
- **Illustration** propre au mode, ou **Pas d'illustration dans ce mode**.
- **Fin de l'aventure dans ce mode** : comme l'original, aucune (l'aventure continue), mort du héros / fin, victoire.
- **Choix visibles dans ce mode** et **Blocs visibles dans ce mode** : une case par choix et par bloc (test, combat,
  défi, boutique…). Décocher cache ce choix ou ce bloc dans ce mode seulement.
- **Tester en mode …** ouvre une partie d'essai **à partir de ce paragraphe**, dans ce mode.
- **Effacer les adaptations** remet ce paragraphe comme l'original pour ce mode.

Le formulaire du haut (texte, image, choix, blocs) reste **l'original** : c'est lui qui sert quand un mode ne dit rien.

### Condition « joue dans le mode »

Dans la liste « Le héros… » des conditions : **joue dans le mode**, avec une case par mode, combinable avec
les autres conditions (« joue dans le mode Grand explorateur **et** possède la carte »). Un choix dont la condition
n'est pas remplie est grisé avec sa raison (ou caché si vous cochez « Cacher ce choix… »). Pour **montrer ou cacher**
simplement un choix selon le mode, préférez les cases du panneau « Variantes selon le mode ».
Dans le fichier, la même condition sert aussi sur un effet : `{ "op": "stat", "stat": "chance", "add": -1, "if": { "mode": "grand" } }`
ne s'applique qu'aux grands.

## Recette : fins douces pour les petits, vraies fins pour les grands

Exemple de *Mission neurones* : le groupe de marrons traverse une clairière et se fait repérer (paragraphe 15).

1. Dans le 15, écrivez l'original pour les grands, sobrement, avec la note historique ; **Fin de l'aventure : Mort du héros**.
2. Ajoutez un choix « Se replier et réessayer » → 12 (le paragraphe d'avant).
3. Volet **Grand explorateur** : décochez ce choix (une fin n'a pas de choix).
4. Volet **Petit explorateur** : texte « Le groupe est repéré : il se replie en silence dans la forêt. On réessaie ? »,
   **Fin : Aucune : l'aventure continue**. Le choix « Se replier et réessayer » reste coché.
5. Volet **Explorateur** : à vous de choisir (fin douce ou vraie fin).
6. **Vérifier par mode** : les petits n'ont plus de fin au 15, les grands en ont une.

Autres idées : un défi facile pour les petits et un défi plus dur pour les grands (deux blocs, chacun visible dans son mode) ;
des indices gratuits pour les petits (deux versions du même défi : indices gratuits visibles chez les petits,
indices payants chez les grands) ; un paragraphe entier réservé aux petits (le vieux sage qui explique), atteint
par un choix visible seulement chez eux ; plus de repas au départ et une fuite sans dégâts
(règles du mode `provisions` et `combat.fleeDamage`, dans le fichier).

## Pendant la partie

- **Création du héros** : les cartes des modes (icône, nom, âges, description, et ce que le mode change :
  « Lu à voix haute », « Texte en 22 px », « Retour en arrière permis ») sont proposées avant le nom du héros.
  Le mode choisi a une **bordure épaisse**, un **disque plein** autour de son icône et la mention **Choisi** (pas seulement une couleur).
  On change de carte à la souris, au doigt ou avec les flèches du clavier.
- **Feuille d'Aventure** : un cadre rappelle le mode (icône, nom, âges).
- Le mode est enregistré dans la sauvegarde : une partie reprise continue dans son mode.
- **Lien direct** : `#/jouer/<aventure>?mode=petit` présélectionne un mode (pratique pour une classe) ;
  `#/jouer/<aventure>?test=1&from=12&mode=grand` lance une partie d'essai au 12 en mode grand.

## Version imprimable

Quand l'aventure a des modes, les contrôles d'impression proposent **Version : Petit explorateur (5-7 ans)…**.
Le livre imprimé est celui de ce mode (textes, images, choix, blocs, fins, règles du mode) ; la page « Comment jouer »
indique la version. Le lien `#/imprimer/<aventure>?mode=petit` ouvre directement cette version (l'adresse suit le menu,
pour la partager). Tous les paragraphes sont imprimés, même ceux qui ne servent pas dans ce mode.

## Format JSON

```json
{
  "rules": {
    "allowBack": false,
    "modes": [
      { "id": "petit", "label": "Petit explorateur", "ages": "5-7 ans", "icon": "pousse",
        "description": "Textes courts, lus à voix haute.",
        "rules": { "allowBack": true, "provisions": 4, "combat": { "fleeDamage": 0 } },
        "prefs": { "ttsAuto": true, "size": 22 } },
      { "id": "grand", "label": "Grand explorateur", "ages": "10-11 ans et plus", "icon": "arbre", "description": "" }
    ]
  },
  "sections": {
    "15": {
      "text": "Un détachement vous surprend… (original, pour les grands)",
      "ending": "death",
      "variants": {
        "petit": { "text": "Le groupe se replie en silence. On réessaie ?", "ending": null, "image": "images/repli.webp" }
      },
      "choices": [ { "text": "Se replier et réessayer", "to": "12", "modes": ["petit"] } ],
      "blocks": [ { "type": "test", "stat": "chance", "success": "16", "failure": "15", "modes": ["grand"] } ]
    }
  }
}
```

- `rules.modes` : liste ordonnée (le premier est le mode par défaut ; absent ou `[]` = pas de modes).
  `id` sert dans les liens et le fichier (il ne change pas quand on renomme le mode).
  `icon` : `pousse`, `arbuste`, `arbre`, `boussole`, `loupe`, `montagne`, `lanterne`, `cerveau`, `map`, `star`, `heart`,
  `sun`, `moon`, `book`, `flag`.
  `rules` : n'importe quelles règles de l'aventure, **fusionnées** dans `adv.rules` (les objets sont fusionnés clé par clé,
  les listes remplacées) — y compris les règles d'autres greffons. Les règles de départ (caractéristiques, or, repas,
  objets, classes) valent dès la création du héros : les dés sont tirés avec les règles du mode choisi.
  `prefs` : `ttsAuto` (booléen) et `size` (15 à 28 px), appliqués pendant la partie.
- `sections[n].variants[idMode]` : chaque champ présent **remplace** celui de l'original dans ce mode
  (`title`, `text`, `image`, `sound`, `place`, `onEnter`, `blocks`, `choices`, `ending`… ; `null` compte :
  `"ending": null` retire la fin, `"image": null` retire l'image). `choices`, `blocks` et `onEnter` remplacent toute la liste :
  l'éditeur l'indique et propose de revenir à l'original.
- `modes` sur un choix ou un bloc : visible **seulement** dans ces modes ; absent = tous les modes ; `[]` = aucun.
- Condition : `{ "mode": "petit" }` ou `{ "mode": ["petit", "moyen"] }`, combinable avec `all`, `any`, `not`.
- État de la partie : `state.mode` (identifiant du mode, `null` si l'aventure n'a pas de modes).

L'aventure « effective » d'un mode (`applyMode(adv, id)` dans `js/plugins/modes/core.js`) est celle que jouent
la lecture, les blocs, la feuille, les greffons, l'impression et la vérification par mode. Un mode inconnu ou absent
revient au premier mode.

## Limites

- Les listes `choices`, `blocks` et `onEnter` propres à un mode s'écrivent dans le fichier (l'éditeur les montre,
  sans les modifier). Dans l'éditeur, on adapte un paragraphe en cachant ou montrant les choix et blocs de l'original.
- La vérification générale (onglet Vérifier) tient compte des renvois de toutes les variantes : un paragraphe
  réservé aux petits n'y est pas « inaccessible ». Elle peut signaler « paragraphe de fin qui propose pourtant des sorties »
  pour une fin qui n'en est une que chez les grands : c'est normal, l'onglet Modes vérifie chaque mode exactement.
- La lecture automatique et la taille du texte du mode sont écrites dans les réglages de l'appareil pendant la partie,
  puis remises comme avant ; deux onglets ouverts en même temps sur deux modes différents se gêneraient.
- Une partie commencée avant l'ajout des modes se joue dans le premier mode.
