// Registre des extensions de l'interface. Un greffon (js/plugins/<nom>/index.js) y déclare ses écrans :
// bloc jouable et éditable, panneau de la feuille d'aventure, onglet de l'éditeur, réglage, route, etc.
// Aucun import ici : ce fichier peut être importé par tous sans créer de dépendance circulaire.
// Voir docs/PLUGINS.md.

export const ui = {
  /** type → { label, icon, order, create(adv) → bloc, Player(props), Editor(props) } */
  blocks: new Map(),
  /** op → { label, order, blank(adv) → effet, Fields({ e, upd, adv }) } */
  effects: new Map(),
  /** [{ t, label, order, match(c) → row|null, toCond(row) → condition, blank(adv) → row, Fields({ row, upd, adv }) }] */
  conditions: [],
  /** [{ id, order, Panel({ adv, source, state, update }) }] : sections de la feuille d'aventure */
  sheetPanels: [],
  /** [{ id, show(it, state, adv, itemId) → bool, label(it, state, adv, itemId) → string, run(state, adv, itemId) → { state, messages } }] */
  itemActions: [],
  /** [{ id, order, Fields({ it, id, set, adv }) }] : champs supplémentaires d'un objet dans l'éditeur */
  itemFields: [],
  /** [{ id, order, Section({ adv, change, set }) }] : sections de l'onglet Règles */
  rulesSections: [],
  /** [{ id, order, label(adv) → string, Tab({ adv, change, open, current }) }] : onglets de l'éditeur */
  editorTabs: [],
  /** [{ id, order, Action({ adv, change }) }] : boutons de la barre de l'éditeur */
  editorActions: [],
  /** [{ id, order, Panel({ prefs, set }) }] : sections de la fenêtre Réglages */
  settings: [],
  /** [{ id, order, Extra({ entry }) }] : informations sur les cartes de la bibliothèque */
  libraryExtras: [],
  /** [{ id, order, Action({ refresh }) }] : boutons en tête de la bibliothèque */
  libraryActions: [],
  /** [{ id, order, Action({ entry, refresh }) }] : boutons sur chaque carte de la bibliothèque */
  cardActions: [],
  /** [{ id, order, Panel({ adv, state }) }] : sous l'écran de mort ou de victoire */
  endingPanels: [],
  /** [{ id, order, Panel({ adv, source, state, combat, update }) }] : dans le bloc de combat en cours */
  combatPanels: [],
  /** [{ id, onStart?(adv, state), onUpdate?(adv, prev, next), onEnd?(adv, state) }] : suivi des parties */
  runHooks: [],
  /** nom → Composant({ id, sub, query }) : nouvelles pages (#/<nom>/<id>/<sub>) */
  routes: new Map(),
  /** [{ where: 'rules'|'sheet'|'appendix', order, Section({ adv }) }] : version imprimable */
  printSections: [],
  /** [{ before(src) → { src, after(html) → html } }] : extensions du Markdown (mathématiques…) */
  markdown: [],
  /** [{ id, order, place?: 'top'|'bottom', Panel({ adv, classId, hero, choice, setChoice, query }), beforeStart?(state, choice, adv, { test, query }) }] : écran de création du héros */
  creatorPanels: [],
  /** [(adv, state) → adv] : aventure effective d'une partie (ex. mode de jeu), sans modifier adv ; voir effectiveAdventure */
  advTransforms: [],
  /** [{ id, order, Panel({ adv, sid, sec, set, change }) }] : panneaux du formulaire d'un paragraphe (éditeur, après les choix) */
  sectionPanels: [],
  /** [{ id, order, init?(query) → valeur, apply?(adv, valeur) → adv, Control({ adv, value, set }) }] : options de la version imprimable */
  printOptions: [],
};

export const registerBlockUI = (type, def) => { ui.blocks.set(type, def); };
export const registerEffectUI = (op, def) => { ui.effects.set(op, def); };
export const registerConditionUI = def => { ui.conditions.push(def); };
export const registerSheetPanel = def => { ui.sheetPanels.push(def); };
export const registerItemAction = def => { ui.itemActions.push(def); };
export const registerItemFields = def => { ui.itemFields.push(def); };
export const registerRulesSection = def => { ui.rulesSections.push(def); };
export const registerEditorTab = def => { ui.editorTabs.push(def); };
export const registerEditorAction = def => { ui.editorActions.push(def); };
export const registerSettings = def => { ui.settings.push(def); };
export const registerLibraryExtra = def => { ui.libraryExtras.push(def); };
export const registerLibraryAction = def => { ui.libraryActions.push(def); };
export const registerCardAction = def => { ui.cardActions.push(def); };
export const registerEndingPanel = def => { ui.endingPanels.push(def); };
export const registerCombatPanel = def => { ui.combatPanels.push(def); };
export const registerRunHook = def => { ui.runHooks.push(def); };
export const registerRoute = (name, Component) => { ui.routes.set(name, Component); };
export const registerPrintSection = def => { ui.printSections.push(def); };
export const registerMarkdown = def => { ui.markdown.push(def); };
export const registerCreatorPanel = def => { ui.creatorPanels.push(def); };
export const registerAdvTransform = fn => { ui.advTransforms.push(fn); };
export const registerSectionPanel = def => { ui.sectionPanels.push(def); };
export const registerPrintOption = def => { ui.printOptions.push(def); };

export const sorted = list => [...list].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

/**
 * Aventure effective d'une partie : l'aventure passée par les transformations des greffons (mode de jeu…).
 * Sans transformation, renvoie `adv` tel quel. Le jeu met le résultat en cache par aventure et par `state.mode` :
 * une transformation ne doit dépendre que de champs d'état fixés à la création du héros.
 */
export function effectiveAdventure(adv, state) {
  let a = adv;
  for (const f of ui.advTransforms) a = f(a, state) || a;
  return a;
}

/** Appelle un crochet de suivi sans jamais casser la partie si un greffon échoue. */
export function runHooks(name, ...args) {
  for (const h of ui.runHooks) {
    try { const r = h[name]?.(...args); if (r?.catch) r.catch(e => console.warn(`[greffon ${h.id}]`, e)); }
    catch (e) { console.warn(`[greffon ${h.id}]`, e); }
  }
}
