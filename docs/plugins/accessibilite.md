# Greffon « accessibilite » : confort de lecture

Ce greffon permet à chaque lecteur d'adapter l'affichage à sa vue et à sa façon de lire. Il vise en
particulier les lecteurs **daltoniens ou malvoyants** et les élèves **dyslexiques**. Tout se règle **par appareil**,
dans la fenêtre **Réglages** (roue dentée en haut à droite), section **Confort de lecture**. Les changements
s'appliquent immédiatement, sans recharger la page, et sont conservés d'une visite à l'autre.

L'auteur d'une aventure n'a rien à faire : **aucun champ n'est ajouté au format des aventures**. Toutes les
aventures, anciennes ou nouvelles, profitent de ces réglages. Les conseils ci-dessous (« Écrire pour tous »)
aident à en tirer le meilleur parti.

## Les réglages

| Réglage | Choix | Effet |
|---|---|---|
| **Police de lecture** | Alegreya (par défaut) · Atkinson Hyperlegible · OpenDyslexic | Chaque choix montre un échantillon « Aa Il1 O0 bdpq » dans sa police. Atkinson Hyperlegible distingue nettement I, l et 1, ou O et 0 (malvoyance). OpenDyslexic alourdit le bas des lettres pour éviter les confusions b/d/p/q (dyslexie). |
| **Appliquer à** | Texte de l'aventure · Toute l'interface | Par défaut, seuls les paragraphes et les choix changent. Avec « Toute l'interface », les menus, la Feuille d'Aventure, l'éditeur et les boutons changent aussi. Les chiffres (numéros, caractéristiques) gardent leur police à chasse fixe. |
| **Interlignage** | Normal · Aéré | Aéré : lignes plus espacées (2 au lieu de 1,65), paragraphes et choix plus séparés. |
| **Espacement des lettres** | Normal · Élargi | Élargi : 0,12 em entre les lettres et 0,16 em entre les mots (valeurs du critère WCAG 1.4.12). OpenDyslexic étant déjà large, elle n'est élargie que de 0,05 em. |
| **Très contrasté** | Non · Noir sur blanc · Jaune sur noir | Redéfinit toutes les couleurs de l'application. Tout texte a un contraste d'au moins **7:1** avec son fond (niveau AAA). Ce mode remplace le thème clair ou sombre. |
| **Guide de lecture** | Aucun · Ligne survolée · Règle de lecture | *Ligne survolée* : la ligne sous la souris est teintée et encadrée de deux traits épais. *Règle de lecture* : le reste de l'écran est voilé et la ligne est bordée de deux traits. Le guide ne suit que le texte des paragraphes. Sur un écran tactile, touchez la ligne que vous lisez. |
| **Réduire les animations** | case à cocher | Coupe l'animation des dés et le glissement de la feuille d'aventure, même si l'appareil ne demande pas de réduire les animations. |
| **Version imprimable** | case à cocher | Par défaut, le livre imprimé garde sa typographie (Alegreya). Cochez la case pour imprimer aussi avec la police, l'interlignage et l'espacement choisis, par exemple pour préparer un livret destiné à un élève dyslexique. Le mode très contrasté ne s'imprime jamais : le papier reste blanc. |

Deux boutons complètent la section :

- **Réglage conseillé pour la dyslexie** : OpenDyslexic, interlignage aéré, lettres espacées. Ce bouton décoche
  aussi « Texte justifié » : un texte aligné à gauche garde des espaces réguliers entre les mots, ce qui aide
  les lecteurs dyslexiques. Les autres réglages (contraste, guide) restent tels quels.
- **Rétablir la lecture d'origine** : remet tous les réglages de cette section à leur valeur de départ et recoche
  « Texte justifié ».

Un **aperçu** montre en direct un extrait de paragraphe avec les réglages choisis.

### Sans la couleur

Aucune information ne repose sur la couleur seule. Voici ce qui change en mode très contrasté :

- la police choisie est marquée par un cadre épais et une coche ✓, en plus du bouton radio ;
- un choix ou un bouton indisponible garde un texte lisible : sa bordure passe en tirets au lieu de pâlir ;
- un adversaire vaincu a une bordure en tirets et son nom est barré ;
- la cible d'un combat a un cadre plus épais (4 px) ;
- le contour du champ ou du bouton actif (clavier) est plus épais (3 px) ;
- les formes du graphe de l'éditeur ne changent pas (hexagone pour un combat, carré pour une mort, losange pour une victoire…).

## Écrire pour tous (conseils aux auteurs)

- Écrivez vos paragraphes comme du **texte**, pas dans les images : le texte suit la police, la taille, le contraste
  et la lecture à voix haute. Une illustration ne doit jamais être le seul endroit où figure un indice.
- Ne désignez rien par sa seule couleur (« prenez la porte rouge ») sans un autre repère : forme, matière,
  position (« la porte ronde, peinte en rouge, à gauche »).
- Donnez un titre à chaque paragraphe illustré : il sert de texte de remplacement à l'illustration.
- Des phrases et des paragraphes courts se lisent mieux avec OpenDyslexic, qui prend plus de place.

## Stockage des préférences

Les préférences sont enregistrées dans le navigateur (`localStorage`, clé `lh.a11y`), jamais dans l'aventure :

```json
{
  "font": "opendyslexic",
  "scope": "reading",
  "leading": "airy",
  "spacing": "wide",
  "contrast": "yb",
  "motion": false,
  "guide": "line",
  "print": false
}
```

| Clé | Valeurs (défaut en premier) |
|---|---|
| `font` | `alegreya`, `atkinson`, `opendyslexic` |
| `scope` | `reading`, `all` |
| `leading` | `normal`, `airy` |
| `spacing` | `normal`, `wide` |
| `contrast` | `off`, `bw` (noir sur blanc), `yb` (jaune sur noir) |
| `motion` | `false`, `true` |
| `guide` | `off`, `line`, `ruler` |
| `print` | `false`, `true` |

Une valeur inconnue ou abîmée est remplacée par la valeur par défaut (`normalizePrefs` dans `core.js`).

## Pour les auteurs de greffons

- Le greffon pose sur `<html>` des attributs `data-a11y-font`, `data-a11y-scope`, `data-a11y-leading`,
  `data-a11y-spacing`, `data-a11y-contrast`, `data-a11y-motion`, `data-a11y-guide` et `data-a11y-print`. Avec les
  réglages par défaut, aucun attribut n'est posé : l'application est exactement la même que sans le greffon.
- En mode très contrasté, **tous les jetons de couleur** de `css/app.css` (`--ink`, `--muted`, `--line`, `--surface`,
  `--paper`, `--accent`, `--loss`, `--gain`…) sont redéfinis. Un greffon qui n'utilise que ces jetons est donc
  lisible sans rien ajouter. Évitez les couleurs écrites en dur.
- Mettez le texte long dans un élément `.prose` (composant `Prose` de `common.js`) : il reçoit alors la police
  de lecture, l'interlignage, l'espacement et le guide de lecture.
- La famille de police choisie est disponible dans la variable CSS `--a11y-family`, qui n'est définie que lorsqu'une
  autre police qu'Alegreya est choisie.
- `core.js` (sans DOM, testé dans `tests/accessibilite.test.mjs`) exporte `normalizePrefs`, `a11yAttributes`,
  les palettes `PALETTES`, `contrastRatio` et la géométrie du guide (`lineBand`, `rulerMasks`). `index.js` exporte
  `readA11y()` et `applyA11y(prefs)`.

## Polices incluses

Elles se trouvent dans `fonts/accessibilite/`, sous licence SIL Open Font License 1.1 (textes des licences dans le
même dossier) :

- **Atkinson Hyperlegible** (Braille Institute) : normal, italique, gras et gras italique, sous-ensembles latin et latin étendu ;
- **OpenDyslexic** 0.920 (Abbie Gonzalez, paquet `@fontsource/opendyslexic` 5.3.0) : mêmes quatre variantes, latin complet.

Le navigateur ne télécharge une police que si elle est choisie. Si l'application a déjà été ouverte une fois
(service worker actif), toutes les variantes de la police choisie sont alors mises en cache pour la lecture hors ligne.
