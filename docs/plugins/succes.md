# Greffon « succes » : succès, progression du joueur et statistiques d'auteur

Les **succès** (on dit aussi trophées) récompensent le lecteur : atteindre la victoire, mourir une première fois,
découvrir une salle cachée, finir l'aventure avec la clé de bronze… Ils donnent envie de rejouer pour tout explorer.
Le greffon tient aussi, **sur chaque appareil**, des statistiques de parties : utiles au joueur (« j'ai exploré 34 % »)
et à l'auteur (« où meurt-on le plus ? quels paragraphes personne ne lit ? »).

Tout reste dans le navigateur : rien n'est envoyé sur Internet. Une aventure sans succès s'ouvre et se joue
exactement comme avant ; elle profite seulement des statistiques.

## Ce que voit le joueur

- **Pendant la partie** : quand un succès est obtenu, une notification « Succès débloqué : Spéléologue » apparaît,
  avec un petit carillon (coupé si les effets sonores sont désactivés dans les Réglages).
- **Feuille d'Aventure** : une section « Succès » avec une jauge « 3 sur 8 » (une case par succès, pleine
  quand il est débloqué) et un bouton **Voir les succès** qui ouvre la liste complète.
- **Écran de fin** (victoire ou mort) :
  1. « Pendant cette partie » : les succès obtenus au cours de cette partie, marqués **Nouveau** ;
  2. « Tous les succès » : la liste complète. Un succès **débloqué** a une coche dans un disque plein, un cadre
     épais et sa date (« Débloqué le 26 septembre 2026 ») ; un succès **verrouillé** a un cadenas, un cadre
     en pointillés et la mention « Verrouillé » ; un succès **secret** non débloqué s'affiche « ??? ».
  3. une ligne de progression : « aventure explorée à 34 % · fins découvertes : 2 sur 5 · 4 parties ».
- **Bibliothèque** : sur la carte de l'aventure, trois petites jauges chiffrées :
  **Exploré 34 %** (paragraphes lus au moins une fois), **Fins 2/5** (paragraphes de fin atteints),
  **Succès 3/8**. Rien ne s'affiche pour une aventure jamais jouée et sans succès.
- **Version imprimable** : une annexe « Succès » à cocher. Les succès secrets y sont masqués (« ??? ») avec une
  ligne pour écrire leur nom quand on les découvre.

Rien ne repose sur la couleur : chaque état a sa forme (disque plein ou cercle en pointillés, cadre continu
ou en pointillés), son icône et son texte.

## Dans l'éditeur

### Onglet « Succès »

- **Nouveau succès** crée une fiche vide. Les **modèles** en créent une toute prête à adapter :
  « Victoire », « Première mort », « Fortune » (victoire avec au moins 20 Pièces d'Or) et
  « Passage par le N » (succès secret obtenu en passant par le paragraphe ouvert dans l'éditeur).
- Pour chaque succès :
  - **Titre** et **Description** : ce que lit le joueur (la description dit comment l'obtenir, ou reste
    énigmatique : c'est vous qui voyez) ;
  - **Moment** :
    - *À la fin de la partie* : examiné quand la partie se termine ; choisissez alors la **Fin concernée** :
      « Victoire ou mort », « Victoire seulement » ou « Mort du héros seulement » ;
    - *En pleine partie, dès que la condition est remplie* : examiné après chaque action du joueur
      (et aussi à la fin) ;
  - **Succès secret** : titre et description remplacés par « ??? » tant qu'il n'est pas obtenu ;
  - **Condition** : la même liste « Le héros… » que pour les choix (possède l'objet, est marqué, caractéristique ≥,
    pièces d'or ≥, est passé par le paragraphe, classe… et les conditions des autres greffons). Plusieurs lignes
    se combinent avec « toutes » ou « au moins une ». Sans condition, un succès « à la fin » est obtenu par toute
    fin du bon type.
  - un **résumé** en français vérifie votre réglage : « Débloqué à la fin de la partie, en cas de victoire,
    si le héros remplit : avoir : Clé de bronze. » ;
  - l'état **sur cet appareil** : « Débloqué le … » ou « Pas encore débloqué ».
- Les boutons flèches changent l'ordre d'affichage ; **Supprimer** demande confirmation.
- Des avertissements signalent les oublis : titre vide, identifiant en double, paragraphe ou objet cité qui
  n'existe pas, succès « en pleine partie » sans condition (il serait obtenu dès le premier paragraphe),
  fin « Victoire » demandée alors qu'aucun paragraphe n'est une victoire.
- **Reverrouiller les succès sur cet appareil** efface vos propres déblocages (pratique pour rejouer comme
  un nouveau lecteur). Les autres appareils ne sont pas concernés.
- **Renuméroter** ou **renommer** des paragraphes met aussi à jour les conditions « est passé par le … » des succès.

Les parties lancées avec **Tester d'ici** ne débloquent aucun succès : une notification « Succès obtenu
(partie de test, non enregistré) » vous montre seulement ce qui aurait été obtenu, et l'écran de fin
les liste sous « Pendant cette partie ».

### Onglet « Statistiques »

La vue auteur des parties jouées **sur cet appareil** :

- une bascule **Parties réelles** / **Parties de test** (les parties « Tester d'ici » sont comptées à part) ;
- **Parties**, **Victoires**, **Morts** (avec leur pourcentage) et **Sans fin** (parties abandonnées ou en cours),
  avec la date de la dernière partie ;
- **Où l'on meurt le plus** : paragraphe, nombre de morts, part des morts (barre et pourcentage).
  « hors fin » signale une mort au combat ou par épuisement sur un paragraphe qui n'est pas une fin ;
- **Fins atteintes** : chaque paragraphe de fin, « atteinte 3 fois » ou « jamais atteinte » ;
- **Paragraphes jamais lus** et **Paragraphes les plus lus** ;
- un clic sur un numéro ouvre le paragraphe dans l'éditeur ;
- **Remettre à zéro** efface (après confirmation) les statistiques affichées : réelles ou de test.

Pour réunir les statistiques de vos lecteurs, jouez sur le même appareil (classe, club de lecture) :
chaque navigateur garde les siennes.

## Format JSON

Les succès sont une liste `achievements` à la racine de l'aventure (absente = aucun succès) :

```jsonc
{
  "achievements": [
    {
      "id": "cle-victoire",          // identifiant stable : ne le changez pas, il sert à mémoriser les déblocages
      "title": "Clé en main",
      "description": "Gagner en ayant la clé de bronze.",
      "secret": false,               // true : « ??? » tant qu'il n'est pas débloqué
      "when": "end",                 // "end" (fin de partie) ou "anytime" (en pleine partie)
      "ending": "victory",           // null (toute fin), "victory" ou "death"
      "cond": { "has": "cle" }       // facultatif : une condition comme celles des choix
    },
    { "id": "cave", "title": "Spéléologue", "description": "Descendre dans la cave.",
      "secret": true, "when": "anytime", "ending": null, "cond": { "visited": "3" } }
  ]
}
```

Règles d'évaluation :

| `when` | `ending` | Débloqué quand… |
|---|---|---|
| `"end"` | `null` | la partie se termine (victoire ou mort) et la condition est remplie |
| `"end"` | `"victory"` / `"death"` | la partie se termine de cette façon et la condition est remplie |
| `"anytime"` | `null` | la condition devient vraie à n'importe quel moment de la partie |
| `"anytime"` | `"victory"` / `"death"` | comme `"end"` avec cette fin (la fin est exigée) |

Une condition qui cite un greffon absent n'est jamais remplie ; un succès sans `id` est ignoré.

### Données enregistrées dans le navigateur

Magasin clé-valeur des greffons (IndexedDB, voir `js/store/db.js`) :

| Clé | Contenu |
|---|---|
| `succes|<id de l'aventure>` | `{ "<id du succès>": "2026-09-26T10:00:00.000Z", … }` : date de déblocage |
| `stats|<id de l'aventure>` | parties réelles : `{ runs, victories, deaths, endings: { "<paragraphe>": n }, deathsAt: { "<paragraphe>": n }, visited: { "<paragraphe>": n }, lastPlayed }` |
| `stats-test|<id de l'aventure>` | même format, pour les parties « Tester d'ici » |

`visited` compte les **lectures** de chaque paragraphe (un retour en arrière ne retire rien, relire compte à nouveau) ;
`endings` compte les fins par paragraphe (victoires et morts), `deathsAt` les morts seulement.
Après une renumérotation, les statistiques déjà enregistrées restent attachées aux anciens numéros.

## Exemple complet

```json
{
  "format": "livre-heros/1",
  "id": "crypte-succes",
  "meta": { "title": "La crypte des succès", "author": "Florian" },
  "items": { "cle": { "name": "Clé de bronze" } },
  "start": "1",
  "sections": {
    "1": { "text": "Vous voici devant la crypte.", "choices": [
      { "text": "Descendre dans la cave", "to": "3", "effects": [{ "op": "give", "item": "cle" }] },
      { "text": "Entrer par la grande porte", "to": "2" },
      { "text": "Sauter dans le gouffre", "to": "4" } ] },
    "2": { "text": "Le trésor est à vous.", "ending": "victory" },
    "3": { "text": "Une cave humide.", "choices": [{ "text": "Remonter", "to": "1" }] },
    "4": { "text": "Vous tombez longtemps.", "ending": "death" }
  },
  "achievements": [
    { "id": "vainqueur", "title": "Vainqueur de la crypte", "description": "Terminer par une victoire.", "when": "end", "ending": "victory" },
    { "id": "chute", "title": "Première chute", "description": "Mourir une première fois.", "when": "end", "ending": "death" },
    { "id": "cave", "title": "Spéléologue", "description": "Descendre dans la cave.", "secret": true, "when": "anytime", "cond": { "visited": "3" } },
    { "id": "cle-victoire", "title": "Clé en main", "description": "Gagner avec la clé de bronze.", "when": "end", "ending": "victory", "cond": { "has": "cle" } }
  ]
}
```

## Pour les développeurs

- `js/plugins/succes/core.js` (pur, testé dans `tests/succes.test.mjs`) : `evaluateAchievements(adv, state, phase)`
  → identifiants remplis (`phase` = `'anytime'` ou `'end'`), `newlyUnlocked`, `achievementView` (masquage des secrets),
  `describeAchievement`, `achievementProblems`, et les calculs de statistiques (`statsOnStart`, `addVisits`,
  `visitDiff`, `statsOnEnd`, `progress`, `deathRanking`, `neverVisited`, `endingsReached`, `mostVisited`).
- `js/plugins/succes/index.js` : suivi par `registerRunHook` (`onStart`, `onUpdate`, `onEnd`, avec `{ test }`),
  écritures en file (aucune visite perdue sur deux clics rapides), panneaux de fin et de feuille, carte de
  bibliothèque, onglets de l'éditeur, annexe imprimable.
- Point d'extension ajouté au moteur : `registerRemap(fn)` (`js/core/plugins.js`, appelé par `remap()` dans
  `js/core/validate.js`) pour que la renumérotation mette à jour les champs d'un greffon situés hors des paragraphes.
