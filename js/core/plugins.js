// Registre des extensions du moteur (partie pure : aucun accès au DOM, utilisable dans Node).
// Un greffon (js/plugins/<nom>/core.js) enregistre ici ses effets, conditions, blocs et règles de combat.
// Le moteur (rules.js, combat.js, validate.js) consulte ce registre pour tout ce qu'il ne connaît pas lui-même.
// Voir docs/PLUGINS.md.

export const ext = {
  /** op → { apply(s, e, adv, messages), describe(e, adv) → string, print?(e, adv) → string, validate?(e, adv, report, where) } */
  effects: new Map(),
  /** [{ id, match(c) → bool, check(c, state, adv) → bool, describe(c, adv) → string, print?(c, adv) → string, validate?(c, adv, report, where) }] */
  conditions: [],
  /** type → { targets(b, i) → [{ to, kind, label, ref }], remap?(b, m) → b, validate?(b, adv, report, where), print?(b, adv, h) → html } */
  blocks: new Map(),
  /** [(adv, m, remapCond) → void] : renumérotation / renommage des paragraphes ; `adv` (copie) est modifiable, m(ancien) → nouveau. */
  remap: [],
  /** [{ attackMod?(state, adv, combat) → n, damageMod?(state, adv, combat) → n, armor?(state, adv, combat) → n, round?(ctx) }] */
  combat: [],
  /** [(state, adv, cls, rng) → void] : complète l'état d'un nouveau héros (compteurs, équipement…). */
  heroInit: [],
  /** [(adv) → void] : complète les règles d'une aventure chargée (valeurs par défaut). */
  normalize: [],
  /** [(state, adv) → string|null] : si une raison est renvoyée, tous les choix sont bloqués (ex. sac trop plein). */
  choiceGuards: [],
  /** [(s, adv, sectionId, messages) → void] : après les effets d'entrée d'un paragraphe (s modifiable). */
  onEnter: [],
  /** [(adv) → [chemin]] : images ou sons cités par un greffon, à inclure dans l'export .lhz. */
  assets: [],
};

export const registerEffect = (op, def) => { ext.effects.set(op, def); };
export const registerCondition = def => { ext.conditions.push(def); };
export const registerBlock = (type, def) => { ext.blocks.set(type, def); };
export const registerRemap = fn => { ext.remap.push(fn); };
export const registerCombatHook = def => { ext.combat.push(def); };
export const registerHeroInit = fn => { ext.heroInit.push(fn); };
export const registerNormalize = fn => { ext.normalize.push(fn); };
export const registerChoiceGuard = fn => { ext.choiceGuards.push(fn); };
export const registerEnterHook = fn => { ext.onEnter.push(fn); };
export const registerAssets = fn => { ext.assets.push(fn); };

export const findCondition = c => (c && typeof c === 'object' ? ext.conditions.find(d => d.match(c)) || null : null);
export const sumCombat = (name, ...args) => ext.combat.reduce((n, h) => n + (Number(h[name]?.(...args)) || 0), 0);
