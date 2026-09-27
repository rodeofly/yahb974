# Écrire un greffon Livre-Héros

Un greffon ajoute une fonctionnalité sans modifier le cœur de l'application. Il vit dans son dossier :

```
js/plugins/<nom>/
  core.js    moteur pur : effets, conditions, blocs, règles de combat… (aucun DOM, testable dans Node)
  index.js   interface : importe ./core.js puis déclare écrans, panneaux, onglets, réglages…
  style.css  (facultatif) chargé par index.js avec loadCSS(new URL('./style.css', import.meta.url))
tests/<nom>.test.mjs        tests Node du core.js (node --test tests/)
docs/plugins/<nom>.md       documentation du greffon (auteurs d'aventures + format JSON)
```

Activation : une ligne `import './<nom>/index.js';` dans `js/plugins/index.js` et, si le greffon a un
moteur, `import './<nom>/core.js';` dans `js/plugins/core.js`, **chacune sur la ligne réservée `// [<nom>]`**
(les lignes vides autour évitent les conflits de fusion git).

## Moteur pur — `js/core/plugins.js`

```js
import { registerEffect, registerCondition, registerBlock, registerCombatHook,
         registerHeroInit, registerNormalize, registerChoiceGuard, registerEnterHook } from '../../core/plugins.js';
```

| Fonction | Rôle | Signature du crochet |
|---|---|---|
| `registerNormalize(fn)` | valeurs par défaut des règles / de l'aventure | `fn(adv)` modifie `adv` (déjà cloné) |
| `registerHeroInit(fn)` | champs d'état d'un nouveau héros | `fn(state, adv, cls, rng)` modifie `state` |
| `registerTargets(fn)` | renvois d'un paragraphe hors choix et blocs (graphe, vérification, paragraphes atteignables) | `fn(sec)` → `[{ to, kind, label, ref }]` (ex. choix des variantes selon le mode) ; renvoyez `[]` si rien |
| `registerEffect(op, def)` | nouvel effet `{ op: '<op>', … }` | `def.apply(s, e, adv, messages)` modifie `s` (déjà cloné) et pousse `{ kind: 'gain'|'loss'|'info', text }` ; `def.describe(e, adv)` texte court ; `def.print?(e, adv)` phrase de livre (« Vous gagnez… ») ; `def.validate?(e, adv, report, where)` avec `report(level, message)` |
| `registerCondition(def)` | nouvelle condition | `def.match(c)` → vrai si c'est la sienne (ex. `'counter' in c`) ; `def.check(c, state, adv)` ; `def.describe(c, adv)` (« avoir 3 points de Réputation ») ; `def.print?` ; `def.validate?` |
| `registerBlock(type, def)` | nouveau bloc interactif (moteur) | `def.targets(b, i)` → `[{ to, kind, label, ref }]` (graphe, vérification) ; `def.remap?(b, m, remapCond)` pour la renumérotation (`m(ancienNuméro)` → nouveau) ; `def.validate?(b, adv, report, where)` ; `def.print?(b, adv, h)` → HTML de la version imprimable, avec `h = { go, esc, UP, plural, condText, effectText }` |
| `registerRemap(fn)` | renumérotation / renommage des paragraphes | `fn(adv, m, remapCond)` : `adv` est déjà une copie, mettez à jour vos champs hors paragraphes qui citent des numéros (`m(ancien)` → nouveau, `remapCond(c)` pour une condition) |
| `registerCombatHook(def)` | modifie les combats | `attackMod(state, adv, combat)`, `damageMod(…)`, `armor(…)` (nombres ajoutés/retirés à chaque assaut) ; `round(ctx)` après l'échange principal avec `ctx = { state, adv, combat, rng, lines, roll, target }` (ex. compagnons) : modifiez `ctx.state`, `ctx.combat`, poussez des lignes de journal et, pour l'affichage, `ctx.combat.last.extra.push(texte)` |
| `registerChoiceGuard(fn)` | bloque tous les choix avec une raison | `fn(state, adv)` → `'Votre sac est trop lourd.'` ou `null` |
| `registerEnterHook(fn)` | après les effets d'entrée d'un paragraphe | `fn(s, adv, sectionId, messages)` modifie `s` |
| `registerAssets(fn)` | fichiers à inclure dans l'export `.lhz` | `fn(adv)` → `['images/carte.webp', …]` (images ou sons cités par vos blocs ou vos champs) |

Règles du moteur : **ne jamais modifier les objets reçus** en dehors des crochets qui fournissent un état déjà cloné ;
les fonctions exportées par un greffon prennent un état et renvoient `{ state, messages }` (état neuf).
Les dés passent par la graine de la partie : `makeRng(state.rng)` puis `state.rng = rng.state()` (voir `withRng` dans rules.js).
Pour l'état d'un bloc pendant la visite d'un paragraphe, utilisez `state.blocks[index]` (vidé à chaque changement de paragraphe).
L'état persistant du greffon va dans `state.<nomDuGreffon>` (créé par `registerHeroInit`).

## Interface — `js/ui/registry.js`

```js
import { registerBlockUI, registerEffectUI, registerConditionUI, registerSheetPanel, registerItemAction,
         registerItemFields, registerRulesSection, registerEditorTab, registerEditorAction, registerSettings,
         registerLibraryExtra, registerLibraryAction, registerCardAction, registerEndingPanel, registerCombatPanel,
         registerRunHook, registerRoute, registerPrintSection, registerMarkdown, registerCreatorPanel,
         registerAdvTransform, registerSectionPanel, registerPrintOption, effectiveAdventure } from '../../ui/registry.js';
```

| Fonction | Où ça s'affiche | Propriétés |
|---|---|---|
| `registerBlockUI(type, def)` | bloc dans la lecture et dans l'éditeur | `label`, `icon` (nom d'icône de common.js), `order`, `create(adv)` → champs initiaux du bloc (sans `type`), `Player({ adv, source, state, index, block, update, go })`, `Editor({ adv, block, set, onChange, tgt })` — `set(patch)` fusionne, `tgt(valeur, onChange, libellé)` affiche un champ de destination ; facultatif : `speech(block, { adv, state, index })` → texte lu à voix haute avec le paragraphe (question, consigne…) |
| `registerEffectUI(op, def)` | liste « Type » des effets | `label`, `order`, `blank(adv)` → effet complet `{ op, … }`, `Fields({ e, upd, adv })` |
| `registerConditionUI(def)` | liste « Le héros… » des conditions | `t` (identifiant de ligne), `label`, `match(c)` → ligne `{ …champs }` ou `null`, `toCond(row)` → condition, `blank(adv)` → ligne, `Fields({ row, upd, adv })` |
| `registerSheetPanel(def)` | feuille d'aventure, après le sac à dos | `id`, `order`, `Panel({ adv, source, state, update })` |
| `registerItemAction(def)` | boutons à côté d'un objet du sac | `show(it, state, adv, id)`, `label(…)`, `run(state, adv, id)` → `{ state, messages }` |
| `registerItemFields(def)` | fiche d'un objet (onglet Objets) | `Fields({ it, id, set, adv })` |
| `registerRulesSection(def)` | onglet Règles | `Section({ adv, change, set })` — `set(patch)` fusionne dans `adv.rules` |
| `registerEditorTab(def)` | nouvel onglet de l'éditeur | `id`, `label(adv)`, `order`, `Tab({ adv, change, open, current })` — `change(a => { …; return a; })` |
| `registerEditorAction(def)` | barre du haut de l'éditeur | `Action({ adv, change })` |
| `registerSettings(def)` | fenêtre Réglages | `Panel({ prefs, set })` (pour vos propres préférences, utilisez `prefs.get/set` de common.js) |
| `registerLibraryExtra / registerLibraryAction / registerCardAction` | bibliothèque | `Extra({ entry })`, `Action({ refresh })`, `Action({ entry, refresh })` |
| `registerEndingPanel(def)` | écran de mort / victoire | `Panel({ adv, state })` |
| `registerCombatPanel(def)` | pendant un combat | `Panel({ adv, source, state, combat, update })` |
| `registerRunHook(def)` | suivi des parties | `onStart(adv, state, { test })`, `onUpdate(adv, prev, next, { test })`, `onEnd(adv, state, { test })` |
| `registerRoute(nom, Composant)` | page `#/<nom>/<id>/<sub>?…` | `Composant({ id, sub, query })` |
| `registerPrintSection(def)` | version imprimable | `where: 'rules' | 'sheet' | 'appendix'`, `Section({ adv })` |
| `registerMarkdown(def)` | texte des paragraphes | `before(src)` → `{ src, after(html) }` : mettez de côté des morceaux (ex. `$x^2$`) avant l'échappement HTML et réinsérez-les après |
| `registerCreatorPanel(def)` | création du héros | `id`, `order`, `place?: 'top'` (avant le nom du héros ; sinon après les dés), `Panel({ adv, classId, hero, choice, setChoice, query })` — `choice` / `setChoice(v)` : mémoire du panneau pendant la création ; `beforeStart?(state, choice, adv, { test, query })` modifie l'état du héros juste avant le départ (`adv` : l'aventure chargée ; aussi en mode test, avec `choice` indéfini : lisez alors `query`). Il est aussi appelé sur un héros provisoire pour savoir dans quelle aventure effective tirer les dés : pas d'effet de bord |
| `registerAdvTransform(fn)` | aventure effective d'une partie | `fn(adv, state)` → nouvelle aventure (ou `adv` inchangée) ; **ne modifie pas** `adv`. La lecture, les blocs, les choix, la feuille, les crochets de suivi et la création du héros reçoivent l'aventure transformée. Mise en cache par aventure et par `state.mode` : ne dépendez que de champs fixés à la création (ex. `state.mode`). `effectiveAdventure(adv, state)` applique toutes les transformations |
| `registerSectionPanel(def)` | formulaire d'un paragraphe (éditeur), après les choix | `id`, `order`, `Panel({ adv, sid, sec, set, change })` — `set(patch)` fusionne dans le paragraphe |
| `registerPrintOption(def)` | contrôles de la version imprimable | `id`, `order`, `init?(query)` → valeur de départ (ex. `?mode=` de l'adresse), `apply?(adv, valeur)` → aventure imprimée (avant le mélange des numéros), `Control({ adv, value, set })` |

Composants et champs réutilisables :
- `js/ui/common.js` : `html`, `Icon`, `Dice`, `Prose`, `markdown`, `AssetImg`, `Modal`, `toast`, `confirmBox`, `prefs`, `loadCSS`.
- `js/ui/editor.js` : `Text`, `Num`, `Select`, `Target`, `ConditionEditor`, `EffectsEditor`, `ImageSlot`, `SoundSlot`, `nextId`, `sortIds`.
- `js/ui/play.js` : `Continue` (bouton « Continuer → N »), `SpellBook`.
- `js/ui/audio.js` : `sfx.dice/hit/wound/luck/page/coin/win/death/magic`.
- `js/store/db.js` : `kvGet/kvPut/kvDelete/kvList(prefix)` — magasin clé-valeur local des greffons (préfixez vos clés : `'succes|' + adv.id`).
- `js/store/library.js` : `loadAdventure`, `saveAdventure`, `exportAdventure`, `importAdventure`, `addImage`, `assetUrl`, `download`.

## Conventions (obligatoires)

- **Tout en français**, vocabulaire des livres-jeux (paragraphe, Feuille d'Aventure, HABILETÉ, ENDURANCE, CHANCE…).
- **Daltonisme** : aucune information portée par la couleur seule. Forme, taille, bordure, icône ou texte d'abord ; la couleur en renfort.
- Texte long justifié avec césure (la classe `.prose` le fait déjà) ; `lang="fr"` si vous créez un nouveau conteneur de texte.
- Utilisez les jetons de couleur de `css/app.css` (`--ink`, `--muted`, `--line`, `--surface`, `--paper`, `--accent`…) : clair et sombre fonctionnent alors seuls.
- Accessibilité : chaque champ a un libellé, chaque bouton-icône un `aria-label`, focus visible, `prefers-reduced-motion` respecté.
- **Hors ligne** : aucune ressource externe (CDN, API). Toute bibliothèque est copiée dans `js/lib/<nom>/` avec sa licence, et ajoutée à `THIRD_PARTY.md`.
  Ajoutez chaque fichier du greffon (et de sa bibliothèque) à `SHELL` dans `sw.js`, et changez `VERSION` ;
  `tests/sw.test.mjs` échoue si un `.js` ou un `.css` manque. Les polices citées par une feuille listée dans
  `FONT_SHEETS` (url(….woff2)) sont mises en cache à l'installation.
- Pas d'émoji comme icône ; ajoutez au besoin un tracé dans l'objet `P` de `common.js` (signalez-le) ou dessinez un petit SVG dans votre greffon.
- Le format des aventures reste **rétrocompatible** : une aventure sans vos champs doit s'ouvrir et se jouer normalement.
- Pas de `confirm()`/`alert()` : utilisez `confirmBox()` et `toast()`.
