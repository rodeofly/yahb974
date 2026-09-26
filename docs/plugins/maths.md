# Greffon « maths » : des formules dans vos aventures

Ce greffon affiche de vraies formules mathématiques (fractions, puissances, racines, vecteurs, systèmes…)
dans le texte des paragraphes et dans les choix. Il suffit d'écrire la formule entre deux signes `$`,
comme dans LaTeX. Le rendu est fait par [KaTeX](https://katex.org), copié dans l'application : **tout marche
hors ligne**, sur téléphone comme sur ordinateur, en thème clair ou sombre, et dans la version imprimable.

Idéal pour un livre-jeu de classe : l'énigme du sphinx est une équation, la bonne réponse ouvre le passage.

## Écrire une formule

| Vous tapez | Vous obtenez |
|---|---|
| `Le sphinx demande $\frac{3}{4} + \frac{1}{8}$.` | la formule au fil du texte |
| `$$x^2 = 16$$` (seul dans son paragraphe) | la formule centrée sur sa propre ligne |
| `Le passeur demande 5 $.` | un simple montant : « 5 $ » |
| `Il vous reste \$12.` | un dollar collé au nombre : « $12 » |

Règles précises (celles de Pandoc) :

- **En ligne** : `$…$`. Le `$` ouvrant doit être suivi d'un caractère (pas d'une espace) et ne pas suivre un
  chiffre ; le `$` fermant doit suivre un caractère et ne pas être suivi d'un chiffre. C'est ce qui évite de
  prendre « 5 $ », « 12$ » ou « entre $20 et $30 » pour des formules.
- **Centrée** : `$$…$$`, sur une ou plusieurs lignes. Seule dans son paragraphe (lignes vides autour), elle forme
  un bloc ; au milieu d'une phrase, elle s'affiche quand même centrée.
- Une formule ne traverse jamais une **ligne vide** (changement de paragraphe).
- `\$` écrit un vrai signe dollar hors formule. Dans une formule, `\$` reste le dollar de LaTeX.
- Les formules marchent **dans le gras et l'italique** : `**Calculez $x^2$ pour $x = 3$**`.

### Conventions françaises

- **Virgule décimale** : `$3,14$` s'affiche « 3,14 », sans l'espace qu'ajoute LaTeX après une virgule
  (comme avec le paquet `icomma`). Une virgule suivie d'une espace reste une ponctuation : `$\{1, 2, 3\}$`.
- **Intervalles** : `\intff{a}{b}` donne [a ; b], `\intfo{a}{b}` [a ; b[, `\intof{a}{b}` ]a ; b], `\intoo{a}{b}` ]a ; b[
  (f : fermé, o : ouvert). Exemple : `$x \in \intfo{0}{1} \cup \intoo{3}{+\infty}$`.
- **Ensembles** : `\N`, `\Z`, `\D`, `\Q`, `\R`, `\C` (et `\K`).
- **Vecteurs** : `\vect{AB}` (flèche longue) ou `\vec{u}` ; coordonnées en colonne :
  `$\vec{u}\begin{pmatrix} 2 \\ -1 \end{pmatrix}$`.
- `\leqslant` et `\geqslant` donnent les ⩽ ⩾ des manuels français.
- Pourcentage : `$15\,\%$` (le `%` seul est un commentaire en LaTeX).

## Dans l'éditeur : l'onglet « Maths »

L'onglet **Maths** apparaît dans l'éditeur de chaque aventure. Son titre devient **Maths (2)** quand deux
formules sont à corriger. On y trouve :

1. **Écrire des formules** : le rappel des règles ci-dessus.
2. **Formules de l'aventure** : toutes les formules des paragraphes, des choix et des blocs sont vérifiées.
   Chaque erreur est affichée avec son paragraphe (bouton pour l'ouvrir), la formule et une explication en
   français (« Commande inconnue : \fracc », « Accolade fermante « } » manquante »…).
3. **Aperçu du paragraphe** en cours : son texte et ses choix, formules rendues.
4. **Essayer** : un champ où l'on tape du texte avec des formules et qui s'affiche aussitôt. Le bouton
   « Ajouter à la fin du paragraphe N » recopie l'essai dans le paragraphe ouvert.
5. **Exemples à copier**, classés par thème (nombres et calculs, équations et systèmes, fonctions et suites,
   géométrie et vecteurs, ensembles et intervalles, probabilités, logique et algorithmique). « Copier » met le
   code, dollars compris, dans le presse-papiers ; « Essayer » le place dans le champ d'essai.

Pendant la lecture, une formule incorrecte ne bloque rien : son code s'affiche dans un **cadre pointillé
précédé d'une croix** ✗ (formule illisible) ou **souligné en vagues** (commande inconnue), en plus de la
couleur d'alerte. Survolez-la pour lire l'erreur.

## Où les formules s'affichent

- Texte des paragraphes (lecture, aperçu de l'éditeur, version imprimable).
- Texte des **choix** : `Répondre $\frac{7}{8}$` (lecture et version imprimable).
- Tout bloc d'un autre greffon qui affiche son texte avec la mise en forme des paragraphes (défis, énigmes…).

Ne sont **pas** mis en forme : titres de paragraphes, noms et descriptions d'objets, libellés des blocs de
dés et de combat. La lecture à voix haute lit le code de la formule tel quel : pour un paragraphe destiné à
être écouté, écrivez aussi la formule en toutes lettres.

## Format JSON

Le greffon n'ajoute **aucun champ** : les formules vivent dans les chaînes de texte existantes. Une aventure
écrite avec des formules s'ouvre sans le greffon (on voit alors le code `$…$`), et une aventure sans formule
s'affiche exactement comme avant. En JSON, chaque barre oblique inverse s'écrit `\\` :

```json
{
  "sections": {
    "12": {
      "title": "Le pont du sphinx",
      "text": "Le sphinx vous barre la route : **combien vaut $\\frac{3}{4} + \\frac{1}{8}$ ?**\n\n$$\\begin{cases} x + y = 10 \\\\ x - y = 4 \\end{cases}$$\n\nLe passeur, lui, demande 5 $.",
      "choices": [
        { "text": "Répondre $\\frac{7}{8}$", "to": "45" },
        { "text": "Répondre $\\frac{4}{12}$", "to": "31" }
      ]
    }
  }
}
```

## Conseils

- Au fil du texte, préférez `\frac` à `\dfrac` : la ligne reste basse. Gardez `\dfrac` pour les formules centrées.
- Une longue formule centrée défile horizontalement sur téléphone au lieu de déborder.
- Les couleurs viennent du texte : rien à régler pour le thème sombre ni pour l'impression (encre noire).
- Les formules sont aussi données aux lecteurs d'écran (MathML).

## Pour les développeurs

```
js/plugins/maths/
  parse.js    extraction pure des formules (extractMath, restoreMath, formulasOf, frenchDecimal, frenchError)
  render.js   KaTeX : renderTex(tex, display) avec cache, texError(tex) pour la vérification, MACROS
  aide.js     onglet « Maths » de l'éditeur
  index.js    registerMarkdown, registerEditorTab, chargement du CSS KaTeX, préchargement des polices
  style.css
js/lib/katex/ KaTeX 0.16.47 (katex.min.js en UMD, katex.min.css limité aux polices woff2, fonts/, LICENSE)
tests/maths.test.mjs
```

- `registerMarkdown` : `before(src)` remplace chaque formule par un marqueur `\uE000m<n>\uE001` (caractères
  d'usage privé, insensibles à l'échappement HTML et au gras/italique) ; `after(html)` réinsère
  `katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' })`.
  Un paragraphe réduit à une formule centrée devient `<div class="maths-bloc">`.
- `katex.min.js` est un UMD : importé comme module ES, il s'installe sur `self.katex`. Dans Node, les tests
  posent `globalThis.self = globalThis` avant l'import.
- KaTeX nomme `overlay` la flèche de `\vec` ; `style.css` annule sur `.katex .overlay` le style des fenêtres
  modales de l'application (même nom de classe).
- Hors ligne : dès qu'une formule s'affiche, les 20 polices KaTeX sont demandées une fois pour que le service
  worker les mette en cache.
- Choix : `js/ui/common.js` exporte `inlineMarkdown(texte)` et `<InlineText text=…>` (texte échappé puis
  greffons du Markdown, sans autre mise en forme) ; `play.js` et `print.js` s'en servent pour le texte des choix.
  Sans greffon, le résultat est identique à l'ancien texte échappé.
