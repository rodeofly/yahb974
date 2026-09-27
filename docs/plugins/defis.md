# Greffon « défis » : énigmes et exercices qui débloquent la suite

Un **défi** est un bloc qu'on place dans un paragraphe : une question (énigme, calcul, exercice de logique,
de programmation « débranchée »…) à laquelle le joueur doit répondre pour avancer.
Bonne réponse : il continue vers le paragraphe de réussite. Essais épuisés ou abandon : il part vers le paragraphe d'échec.

Cinq types de défis :

| Type | Le joueur… | Exemple |
|---|---|---|
| Réponse à écrire (`text`) | tape un mot, une phrase, une expression | « Quelle est la capitale de La Réunion ? » |
| Nombre (`number`) | tape un nombre (clavier numérique sur téléphone), avec une tolérance possible | « Combien font 7 × 8 ? », « Arrondir π au centième » |
| QCM (`qcm`) | choisit une seule proposition | « Lequel est le plus grand : 0,9 / 0,15 / 1,02 ? » |
| Cases à cocher (`multi`) | coche toutes les bonnes propositions, et seulement elles | « Cochez les nombres pairs » |
| Remettre dans l'ordre (`order`) | range des éléments avec les boutons Monter / Descendre (souris, doigt ou clavier) | les étapes d'un algorithme, des fractions du plus petit au plus grand |

## Dans l'éditeur

Dans un paragraphe, section « Jets de dés, combats, boutique », bouton **Défi**. Le formulaire propose :

- **Type de défi**, **Titre** (facultatif), **Question** en Markdown (`**gras**`, `*italique*`, formules entre `$…$`
  si le greffon de mathématiques est installé), avec un **aperçu** rendu juste en dessous.
- **Figure ou illustration** (facultative) : une image montrée avec la question — utile pour une figure de géométrie.
- **Réponses** selon le type :
  - réponse écrite : une ou plusieurs réponses acceptées. Les majuscules, les accents, les espaces en trop,
    les apostrophes typographiques et la ponctuation finale ne comptent pas (« SAINT-DÉNIS. » = « Saint-Denis »).
    L'éditeur montre la forme comparée. La case **Ignorer toutes les espaces** sert aux expressions (« 2x + 3 » = « 2x+3 ») ;
  - nombre : la valeur attendue, une **tolérance** (0 = valeur exacte ; 0,01 accepte 3,13 à 3,15 pour 3,14),
    éventuellement d'autres valeurs acceptées, et une **unité** affichée après le champ (le joueur peut la retaper, elle est ignorée).
    Le joueur écrit indifféremment 3,5 ou 3.5, avec des espaces (1 000), et dispose d'un bouton ± pour les nombres négatifs ;
  - QCM / cases à cocher : les propositions (repérées A, B, C… dans cet ordre) et la case **Bonne réponse** de chacune ;
  - remettre dans l'ordre : les éléments écrits **dans le bon ordre** ; ils sont mélangés pour le joueur,
    différemment à chaque partie (avec la graine de la partie : recharger ne change pas le mélange).
- **Chiffrer les réponses** (réponse écrite ou nombre exact) : voir plus bas.
- **Essais** : nombre d'essais (0 = illimité), **le joueur peut renoncer**, **montrer la bonne réponse après un échec**.
  Une réponse vide, illisible (« douze » dans un champ numérique) ou fausse *déjà proposée* ne coûte pas d'essai.
- **Indices** : révélés un par un, dans l'ordre, à la demande du joueur. Chacun a un **coût** (les effets habituels :
  −1 CHANCE, −2 pièces d'or, perdre un objet…) ; vide = gratuit. Un indice que le joueur ne peut pas payer
  (pas assez d'or, objet absent) est grisé avec la raison ; un indice qui le tuerait demande confirmation.
- **Suite de l'aventure** : *Si bonne réponse, aller au* / *Si échec, aller au*, et les **effets** de réussite
  (donner un objet, poser une marque pour ouvrir un passage plus loin, gagner de la CHANCE…) et d'échec.
  Une destination laissée vide laisse le joueur continuer avec les choix du paragraphe : pratique pour un défi
  **facultatif** qui rapporte un objet ou une marque.
- **Explication** (Markdown) : montrée à la fin du défi, réussi ou non. C'est l'endroit pour la correction.

L'onglet **Vérifier** signale : question vide, aucune réponse acceptée, QCM sans bonne réponse (ou avec plusieurs),
moins de deux propositions ou éléments, défi sans issue alors que le paragraphe n'a pas de choix, caractéristique
ou objet inconnu dans un coût ou un effet, empreinte chiffrée invalide.

### Débloquer une étape

Deux façons, qui se combinent :

1. **Directement** : la destination « Si bonne réponse » mène à la suite, l'échec à un détour (ou à une fin).
2. **Plus tard** : l'effet de réussite pose une **marque** (ex. `pont-repare`) ou donne un **objet** ; ailleurs dans
   le livre, un choix exige cette marque ou cet objet (« Traverser le pont », condition *est marqué pont-repare*).

### Réponses chiffrées

Un fichier d'aventure (`.lhz` ou `adventure.json`) se lit facilement : un élève curieux y trouverait les réponses.
En cochant **Chiffrer les réponses**, chaque réponse est remplacée par son **empreinte SHA-256**
(celle de `identifiant-de-l-aventure:réponse-normalisée`). L'application compare l'empreinte de la réponse du joueur :
le joueur ne peut pas lire la solution dans le fichier.

- C'est **irréversible** : personne ne peut relire une réponse chiffrée, pas même l'auteur. Notez-les ailleurs.
- On peut toujours **ajouter** une réponse acceptée : elle est chiffrée dès la saisie, jamais enregistrée en clair.
- Décocher la case efface les réponses chiffrées (il faut les ressaisir).
- Seules les réponses écrites et les **nombres exacts** (tolérance 0) se chiffrent : un QCM se devinerait en essayant chaque
  proposition, et une tolérance ne se vérifie pas sur une empreinte.
- Limite honnête : un nombre (ou un mot très court) reste devinable par un élève patient qui essaierait toutes les valeurs
  avec un programme. Le chiffrement empêche de lire la réponse d'un coup d'œil, pas un calcul acharné.
- Le sel (`salt`) est l'identifiant de l'aventure au moment du chiffrement : une copie de l'aventure (« Copier pour modifier »,
  import en copie) garde des réponses valides.

## Pendant la partie

Le bloc affiche le titre, le type (« Une seule bonne réponse · 3 essais · 2 indices »), la figure, la question,
le champ adapté et le bouton **Valider**. Le retour ne repose jamais sur la couleur seule :

- **Bonne réponse !** : icône coche, cadre plein ;
- **Ce n'est pas ça. Il vous reste 2 essais.** : icône croix, cadre en tirets ;
- message d'information (saisie illisible, réponse déjà proposée, abandon) : icône « i », cadre pointillé.

Les essais restants sont aussi dessinés (cases pleines = essais utilisés, cases vides = essais restants).
Dans un QCM, une proposition déjà essayée est marquée « déjà essayé » ; après un échec avec « montrer la bonne réponse »,
les propositions portent « bonne réponse » / « votre choix ». Un son accompagne chaque verdict.
Une fois le défi terminé : l'explication, puis le bouton **Continuer → N**.

La **Feuille d'Aventure** montre un bilan « Défis : ✓ 3 réussis · ✗ 1 manqué · 2 indices », repris sur l'écran de fin
(« Défis relevés : 3 sur 4 rencontrés »). Il n'apparaît que si l'aventure contient des défis.

## Version imprimable

- Les règles expliquent le principe des défis sur papier.
- Chaque défi imprime sa question, ses propositions (A, B, C…), les éléments à ordonner (mélangés, toujours de la même façon),
  une ligne « Votre réponse : ……… », ses indices **imprimés à l'envers** avec leur coût, puis :
  « Notez votre réponse puis consultez les Solutions des défis en fin de livre (défi du **12**) : si elle est juste,
  rendez-vous au **30** ; sinon au **45**. »
- L'annexe **Solutions des défis**, sur une nouvelle page, liste les défis par numéro de paragraphe (« 12 a », « 12 b »
  s'il y en a plusieurs dans le même paragraphe) avec la ou les réponses et l'explication. Réponse chiffrée :
  « réponse chiffrée : à vérifier dans l'application ».

## Format JSON

```jsonc
{
  "type": "challenge",
  "kind": "text",                    // "text" | "number" | "qcm" | "multi" | "order"
  "title": "L'énigme du passeur",
  "question": "Quelle est la **capitale** de La Réunion ?",
  "image": "images/carte-1a2b.webp", // facultatif
  "answers": ["Saint-Denis", "St-Denis"],
  "attempts": 3,                     // 0 = illimité
  "allowGiveUp": false,
  "revealAnswer": true,              // montrer la bonne réponse après un échec (sans effet si chiffré)
  "ignoreSpaces": false,             // text : ignorer toutes les espaces
  "hints": [
    { "text": "Elle porte le nom d'un saint.", "cost": [ { "op": "stat", "stat": "chance", "add": -1 } ] }
  ],
  "success": "30",                   // vide : le joueur continue avec les choix du paragraphe
  "failure": "45",
  "successEffects": [ { "op": "flag", "flag": "passeur-convaincu" } ],
  "failureEffects": [ { "op": "stat", "stat": "endurance", "add": -2 } ],
  "explanation": "Saint-Denis est le chef-lieu de La Réunion.",
  "hashed": false
}
```

Forme de `answers` selon `kind` :

| `kind` | `answers` |
|---|---|
| `text` | `["réponse 1", "réponse 2"]` |
| `number` | `{ "value": 3.14, "tolerance": 0.01 }` ou une liste de tels objets ; `"unit": "cm"` (facultatif) sur le bloc |
| `qcm`, `multi` | `[{ "text": "0,9", "correct": false }, { "text": "1,02", "correct": true }]` |
| `order` | `["Lundi", "Mardi", "Mercredi"]` (le bon ordre) |
| chiffré (`"hashed": true`, `text` ou `number`) | `["<64 caractères hexadécimaux>", …]` et `"salt": "<identifiant de l'aventure>"` |

Champs facultatifs du bloc : `"alt"` (texte alternatif de la figure ; sinon « Figure : titre »).

Réglages de l'aventure, facultatifs, dans `rules.defis` :

```jsonc
"rules": { "defis": {
  "tu": true,                          // messages au joueur tutoyés : « Ce n’est pas ça. Essaie encore ! », « Ta réponse »…
  "giveUpLabel": "Passer l’énigme"     // libellé du bouton d'abandon (défaut : « Renoncer à ce défi »)
} }
```

**Coûts des indices** : un indice qui coûte des points d'une caractéristique (CHANCE…) est refusé quand le héros n'en a pas
assez (« Il vous faut 1 point de Chance »), comme pour l'or ou les repas. Seule la caractéristique de santé du combat
(ENDURANCE) peut être payée jusqu'à la mort, après confirmation.

**Lecture à voix haute** : le bouton « Écouter » du paragraphe (et la lecture automatique) lit aussi les défis visibles :
titre, question, propositions (A, B, C…) ou éléments à ranger, dans l'ordre affiché. Une fois le défi terminé, il lit le verdict
et l'explication. Avec la lecture automatique, un indice révélé et le verdict de chaque réponse sont lus aussitôt.

Une aventure sans défi n'est pas concernée ; un défi ouvert sans le greffon est signalé « type de bloc inconnu » et ignoré.

### Exemple complet : un paragraphe à nombre, avec indice payant

```json
"12": {
  "title": "Le péage du troll",
  "text": "Un troll compte ses pièces au milieu du pont. « Réponds juste, ou fais demi-tour ! »",
  "blocks": [{
    "type": "challenge", "kind": "number", "title": "Le calcul du troll",
    "question": "Le troll a 7 sacs de 8 pièces. Combien de pièces en tout ?",
    "answers": { "value": 56, "tolerance": 0 }, "attempts": 2,
    "hints": [{ "text": "Multipliez le nombre de sacs par le nombre de pièces par sac.", "cost": [{ "op": "gold", "add": -1 }] }],
    "success": "30", "failure": "45",
    "successEffects": [{ "op": "gold", "add": 3 }],
    "explanation": "7 × 8 = 56."
  }],
  "choices": []
}
```

## Pour les développeurs

Le moteur (`js/plugins/defis/core.js`) est pur et testé (`tests/defis.test.mjs`). Fonctions utiles à d'autres greffons
(par exemple pour des exercices venus d'une autre plateforme) :

- `checkAnswer(block, input, adv)` : booléen pour les réponses en clair, promesse pour les chiffrées ; `checkAnswerAsync` : toujours une promesse ;
- `submit(state, adv, index, input)` → `{ state, messages, correct, finished, counted, feedback }` (lève une erreur pour un défi chiffré) ; `submitAsync` pour tous ;
- `useHint(state, adv, index)`, `giveUp(state, adv, index)`, `blockState`, `exitOf`, `summary`, `verdict` ;
- `normalizeText`, `parseNumber`, `hashAnswer(salt, réponseNormalisée)`, `sha256Hex` (crypto.subtle, avec un calcul en JavaScript pur
  quand la page n'est pas servie en https ou sur localhost) ;
- `printChallenge`, `solutionsOf` pour la version imprimable.

État pendant la visite : `state.blocks[index] = { tries, hints, solved, failed, order, wrong, last, gaveUp }` (créé à l'entrée du paragraphe).
Bilan de la partie : `state.defis.done["<paragraphe>#<index>"] = { ok, tries, hints }`.
Les messages du verdict portent `verdict: true` : l'interface les affiche dans le bloc et ne transmet que les effets à la lecture.
