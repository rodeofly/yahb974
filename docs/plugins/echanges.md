# Greffon « échanges » : Twine, ink et co-écriture

Ce greffon fait communiquer Livre-Héros avec les autres outils d'écriture interactive et permet d'écrire
une aventure **à plusieurs** :

- **Exporter vers…** Twine (fichier Twee ou archive), ink (éditeur Inky) ou JSON brut, pour publier
  ailleurs, relire le texte dans un autre outil ou archiver ;
- **Importer depuis Twine** une histoire existante (Harlowe, SugarCube, Twine 1) : chaque passage devient
  un paragraphe numéroté, chaque lien un choix ;
- **Fusionner une autre aventure** : les paragraphes écrits par un·e co-auteur·e (ou par une classe, un
  groupe d'élèves…) sont ajoutés à la suite des vôtres, sans rien écraser.

Une aventure qui n'utilise pas ce greffon s'ouvre et se joue exactement comme avant : il n'ajoute aucun champ
obligatoire au format.

## Exporter vers un autre outil

Dans l'éditeur, bouton **Exporter vers…** (barre du haut), puis choisissez un format. Le menu se parcourt
au clavier (flèches haut et bas, Entrée, Échap pour fermer).

| Format | Fichier | Pour quoi faire |
|---|---|---|
| **Twine : fichier Twee** | `mon-aventure.twee` | Twine 2.6 ou plus (Bibliothèque › Importer), Tweego, ou tout éditeur de texte. |
| **Twine : archive** | `mon-aventure-twine.html` | Archive de bibliothèque Twine 2 : Bibliothèque › Importer dans Twine. |
| **ink (Inky)** | `mon-aventure.ink` | Script ink à ouvrir dans Inky (Inkle), puis à publier pour le web. |
| **JSON brut** | `mon-aventure.json` | Le fichier `adventure.json` seul, sans les images (le `.lhz` du bouton **Exporter** les contient). |

### Ce que devient une aventure dans Twine et dans ink

Twine et ink n'ont ni caractéristiques ni dés. Comme dans la **version imprimable**, les règles deviennent
des phrases et des liens que le lecteur suit selon ses propres jets :

| Dans Livre-Héros | Dans Twine (Harlowe 3.3) | Dans ink |
|---|---|---|
| Paragraphe 12 | passage nommé `12` | nœud `=== p12 ===` |
| Choix « Ouvrir la porte » → 34 | `[[Ouvrir la porte->34]]` | `+ [Ouvrir la porte] -> p34` |
| Titre du paragraphe | ligne `### Titre` en tête du passage | étiquette `# titre: …` |
| Illustration | `<img src="images/…">` (copiez le dossier `images/` du `.lhz` à côté de l'histoire publiée) | étiquette `# image: …` |
| Fin (mort / victoire) | étiquette `mort` / `victoire` | `-> END` et étiquette `# fin: …` |
| Test de Chance | phrase + `[[Chanceux->12]]` `[[Malchanceux->13]]` | phrase + deux choix |
| Test d'une autre caractéristique | phrase + `[[Réussite->…]]` `[[Échec->…]]` | idem |
| Table de dés | phrase + un lien par ligne (`[[1 à 3 : …->…]]`) | un choix par ligne |
| Combat | adversaires et règles en toutes lettres + `[[Vous êtes vainqueur->…]]`, fuite, défaite | idem |
| Formules | un lien par code (`[[ZAP->…]]`) | un choix par code |
| Boutique | liste des objets et de leurs prix | idem |
| Effets d'entrée | phrase en italique (« Vous perdez 2 points d'ENDURANCE. ») | logique `~ …` quand c'est possible (objets, mots-clés, or), sinon phrase |
| Condition d'un choix | commentaire lisible `<!-- Condition : vous possédez : Clé d'argent -->` | `+ {obj_cle >= 1} [Ouvrir] -> p34` quand c'est possible, sinon commentaire `// Condition non traduite : …` |
| Effets d'un choix | commentaire `<!-- En choisissant : … -->` | lignes `~ …` sous le choix, ou phrase |

Détails utiles :

- **Twine** : le format d'histoire est **Harlowe 3.3**. Les caractères que Harlowe interpréterait
  (`$variable`, `(macro:)`, crochets, `//`, accolades) sont protégés par le balisage « verbatim » `` `…` ``.
  `_italique_` devient `*italique*`. L'IFID (identifiant de l'histoire) est **stable** : exporter deux fois la
  même aventure donne le même IFID, ce qui permet aux outils de reconnaître la même histoire. Une
  histoire importée depuis Twine garde son IFID d'origine.
- **ink** : les objets deviennent des variables `VAR obj_… = 0` (nombre d'exemplaires ; les objets de départ
  valent 1), les mots-clés `VAR marque_… = false`, l'or `VAR pieces_or` (tiré au départ avec `RANDOM`). Les
  conditions simples (avoir un objet, un mot-clé, de l'or, être passé par un paragraphe, et leurs
  combinaisons « et / ou / pas ») sont traduites ; les autres (caractéristiques, classes, compteurs,
  compagnons…) restent en commentaire et le choix est alors toujours proposé. Les choix sont **persistants**
  (`+`) : comme dans un livre, un choix reste proposé quand on revient sur un paragraphe. Si tous les choix
  d'un paragraphe sont conditionnels, un choix de repli invisible (`+ -> END`) évite l'erreur « plus de contenu ».
  Le Markdown (`**gras**`) est retiré, ink ne l'affichant pas. Le fichier produit se compile sans erreur ni
  avertissement avec le compilateur ink (vérifié avec inkjs, le portage JavaScript d'inklecate).

## Importer depuis Twine

Dans la **bibliothèque**, bouton **Importer depuis Twine**, puis choisissez :

- un fichier **Twee** (`.twee`, `.tw`, `.txt`) : Twee 3 (Twine 2.6+, Tweego), Twee 2 ou Twee 1 ;
- une **archive Twine 2** (`.html`, menu Bibliothèque › Archiver de Twine) ou une **histoire publiée** (`.html`) ;
- un fichier **Twine 1** publié (`.html`).

Un aperçu s'affiche : titre, nombre de paragraphes, de choix, de fins, et les avertissements (liens vers
un passage qui n'existe pas, images non importées…). Si l'archive contient plusieurs histoires, choisissez
laquelle importer. **Créer l'aventure et l'ouvrir** l'enregistre sur cet appareil et ouvre l'éditeur.

Ce que fait l'import :

- **Numérotation** : si les passages portent déjà des numéros (`12`, `6b`…), ils sont gardés ; sinon ils sont
  numérotés de 1 à N en suivant les liens depuis le passage de départ (qui devient le **1**), et le nom du passage
  devient le **titre** du paragraphe (« Untitled Passage » est ignoré).
- **Liens → choix**, dans l'ordre du texte : `[[texte->cible]]`, `[[cible<-texte]]`, `[[texte|cible]]`,
  `[[cible]]`, `[[…][$réglage]]` (le réglage est ignoré), `(link-goto: "texte", "cible")`, `<<link "texte" "cible">>`.
  `(goto: "cible")` et `<<goto "cible">>` deviennent un choix « Continuer ». Une ligne qui ne contient que des
  liens disparaît du texte ; un lien au milieu d'une phrase y laisse son texte.
- **Macros** Harlowe `(set: …)`, `(if: …)[…]` et SugarCube `<<set …>>`, `<<if>>…<</if>>` sont **retirées**, mais
  le texte narratif de leurs crochets est gardé (les deux branches d'un `(if:)…(else:)` restent : relisez-les).
  Les variables affichées (`$or`) sont retirées.
- **Balisage** : `''gras''` → `**gras**`, `//italique//` → `*italique*`, titres `#` / `!` → `### `, HTML retiré
  (`<br>` devient un retour à la ligne), commentaires `<!-- -->` et `/* */` retirés, entités HTML décodées.
- **Fins** : étiquette `death`, `mort`, `gameover`, `défaite` → **mort** ; `victory`, `victoire`, `win`, `succès`
  → **victoire**. Un passage sans lien ni étiquette est signalé par l'onglet **Vérifier** : marquez-le comme fin.
- Les passages spéciaux (`StoryInit`, `StoryMenu`…) et ceux étiquetés `script`, `stylesheet`, `widget`,
  `Twine.private` sont ignorés.
- **Images** : une image en ligne (`https://…`) devient l'illustration du paragraphe ; une image locale ne peut
  pas être importée (le fichier n'est pas dans l'archive) : ajoutez-la dans l'éditeur.
- Les **règles** sont celles d'une nouvelle aventure (HABILETÉ, ENDURANCE, CHANCE) : à adapter dans l'onglet Règles.

## Fusionner une autre aventure (co-écriture)

Scénario type : Alice écrit le village (paragraphes 1 à 40), Bob écrit la forêt dans sa propre aventure
(paragraphes 1 à 25). Bob exporte sa partie (**Exporter** → `.lhz`) et l'envoie à Alice, qui ouvre la sienne
dans l'éditeur et clique sur **Fusionner…**.

1. **Source** : un fichier (`.lhz`, `.json`, `.twee` ou archive Twine `.html`) ou une aventure de la
   bibliothèque (publiée ou sur cet appareil).
2. **Aperçu et réglages** (rien n'est modifié à ce stade) :
   - **Numéroter à partir de** : par défaut, juste après votre plus grand numéro (41 dans l'exemple) ; les
     numéros déjà pris sont sautés, on peut donc viser une plage libre (500, par exemple) ;
   - **Préfixe des identifiants en double** : par défaut, un mot du titre de l'autre aventure (`foret-`) ;
   - **Garder une seule fois les objets, compagnons et compteurs identiques** (coché par défaut) ;
   - **Relier** : numéro d'un de vos paragraphes où ajouter un choix vers le départ de la partie ajoutée,
     et le texte de ce choix (« Entrer dans la forêt »).

   La liste **Ce qui va se passer** se met à jour à chaque réglage.
3. **Fusionner** : les paragraphes, objets et images sont ajoutés, puis le **rapport** s'affiche ; le bouton
   **Ouvrir le paragraphe 41** mène au départ de la partie ajoutée.

Règles de la fusion :

- Les paragraphes de l'autre aventure sont **renumérotés à la suite** ; tous leurs renvois (choix, tests,
  combats, tables, formules, conditions « est passé par ») suivent.
- Un **objet**, un **compagnon** ou un **compteur** dont l'identifiant existe déjà **avec une autre définition**
  est renommé avec le préfixe (`cle` → `foret-cle`) et toutes ses mentions dans la partie ajoutée sont mises à
  jour (conditions, effets, boutiques, objets de départ des classes, objet requis d'une formule, objet porté).
  S'il est **identique**, il est gardé une seule fois (la clé trouvée par Alice ouvre aussi la grille de Bob).
- Les **mots-clés** (marques) sont partagés : le rapport liste ceux qui servent dans les deux parties.
- Les **caractéristiques**, **classes** et **formules** qui manquent sont ajoutées ; les autres **règles**
  (combat, or, repas, journées) restent celles de votre aventure. Le rapport prévient si l'autre aventure
  utilise des formules ou des journées désactivées chez vous.
- Une **image** ou un **son** dont le chemin est déjà pris est renommé (`images/p1.webp` → `images/foret-p1.webp`).
- Les **auteur·es** sont réunis (« Alice et Bob »). Votre titre, votre couverture et votre départ ne changent pas.

Les lignes du rapport commencent par un mot et une icône (**Info**, **Renommé** avec un cadre en tirets,
**Attention** avec un cadre épais) : aucune information ne repose sur la couleur.

Astuce : exportez votre aventure (`.lhz`) avant une grosse fusion. Pour annuler, réimportez cet export.

## Format JSON

Le greffon n'ajoute qu'un champ facultatif :

```jsonc
"meta": {
  "title": "La Grotte et le Dragon",
  "ifid": "1A2B3C4D-1111-4222-8333-444455556666"   // IFID de l'histoire Twine d'origine (UUID), réutilisé à l'export
}
```

Une histoire Twine importée donne une aventure ordinaire :

```text
:: StoryTitle
La Grotte

:: StoryData
{ "ifid": "1A2B3C4D-1111-4222-8333-444455556666", "format": "Harlowe", "format-version": "3.3.9", "start": "Début" }

:: Début
Vous arrivez devant une montagne.
[[Entrer->Entrée de la grotte]]

:: Entrée de la grotte
(set: $torche to true)Il fait sombre. (if: $torche)[Votre torche éclaire une fresque.]
[[Avancer->Le dragon]]

:: Le dragon [death]
Le dragon vous dévore.
```

devient :

```json
{
  "format": "livre-heros/1",
  "meta": { "title": "La Grotte", "ifid": "1A2B3C4D-1111-4222-8333-444455556666" },
  "start": "1",
  "sections": {
    "1": { "title": "Début", "text": "Vous arrivez devant une montagne.", "choices": [ { "text": "Entrer", "to": "2" } ] },
    "2": { "title": "Entrée de la grotte", "text": "Il fait sombre. Votre torche éclaire une fresque.", "choices": [ { "text": "Avancer", "to": "3" } ] },
    "3": { "title": "Le dragon", "text": "Le dragon vous dévore.", "ending": "death", "choices": [] }
  }
}
```

## Pour les développeurs

Moteur pur, sans DOM (testé dans Node) : `js/plugins/echanges/core.js`.

| Fonction | Rôle |
|---|---|
| `toTwee(adv)`, `toTwineHTML(adv)`, `toInk(adv, { sticky })`, `toJSON(adv)` | exports (texte) |
| `fromTwee(text, { warnings, id })`, `fromTwineHTML(html, { story, warnings, id })` | imports → aventure normalisée ; `warnings` reçoit les avertissements |
| `parseStory(text)`, `detectFormat(text)`, `twineStories(html)` | lecture d'un fichier de format quelconque |
| `mergeAdventures(base, other, options)` | → `{ adventure, mapping, report, assetMap }` |
| `ifidOf(adv)`, `storyStats(adv)`, `countLinks(adv)`, `cleanPassage(text, format)` | outils |

`mergeAdventures` : `options = { prefix, startAt, shareIdentical = true, prefixFlags = false, link: { from, text }, takenAssets: [] }`.
`mapping` associe chaque ancien numéro de l'autre aventure à son nouveau numéro ; `report` détaille les
paragraphes ajoutés, les objets / compagnons / compteurs (`added`, `shared`, `renamed`), les mots-clés communs,
les caractéristiques, classes et formules ajoutées, les fichiers renommés, les avertissements, et `lines`
(phrases prêtes à afficher, `kind` : `info`, `rename`, `warning`) ; `assetMap` donne, pour chaque image ou son
de l'autre aventure, le chemin sous lequel le copier. Les renvois passent par `remap()` de `js/core/validate.js`,
donc les blocs des autres greffons qui déclarent `remap` sont renumérotés eux aussi.

Tests : `tests/echanges.test.mjs` (aller-retour Twee, archive Twine 2 écrite à la main, SugarCube, Twine 1,
ink bien formé, fusion).
