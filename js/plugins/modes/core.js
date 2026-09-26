// Greffon « modes » — moteur pur (aucun DOM, testable dans Node).
// Modes de jeu selon l'âge (ou le niveau) : une même aventure, plusieurs versions.
//   Règles     : adv.rules.modes = [{ id, label, ages, description, icon?, rules?: { …surcharges de adv.rules }, prefs?: { ttsAuto?, size? } }]
//   Paragraphe : sec.variants = { [idMode]: { title?, text?, image?, sound?, onEnter?, blocks?, choices?, ending?, … } }
//   Choix, bloc : modes: [idMode, …] (visible seulement dans ces modes ; absent = tous)
//   Condition  : { mode: id | [ids] }
//   État       : state.mode (null par défaut, fixé à la création du héros)
// applyMode(adv, id) construit l'aventure « effective » d'un mode ; le jeu, l'impression et la vérification l'utilisent.
// Voir docs/plugins/modes.md.

import { registerCondition, registerHeroInit, registerNormalize, registerTargets, registerRemap, registerAssets, ext } from '../../core/plugins.js';
import { targetsOf } from '../../core/rules.js';
import { validate, reachable } from '../../core/validate.js';

/* ------------------------------------------------------------------ */
/* Lecture des modes                                                   */
/* ------------------------------------------------------------------ */

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** Modes de l'aventure, dans l'ordre (le premier est le mode par défaut). Jamais undefined. */
export const listModes = adv => (Array.isArray(adv?.rules?.modes) ? adv.rules.modes.filter(m => isObj(m) && m.id) : []);
export const hasModes = adv => listModes(adv).length > 0;
export const modeById = (adv, id) => listModes(adv).find(m => m.id === id) || null;
/** Mode réellement joué : celui demandé s'il existe, sinon le premier de la liste ; null si l'aventure n'a pas de modes. */
export const resolveMode = (adv, id) => modeById(adv, id) || listModes(adv)[0] || null;
/** Nom affiché : « Petit explorateur (5-7 ans) ». */
export const modeTitle = m => (m ? `${m.label || m.id}${m.ages ? ` (${m.ages})` : ''}` : '');
/** Un choix ou un bloc est-il visible dans ce mode ? (`modes` absent = tous les modes) */
export const visibleIn = (x, modeId) => !Array.isArray(x?.modes) || x.modes.includes(modeId);

/** Identifiant libre pour un nouveau mode, tiré de son nom (« Petit explorateur » → petit-explorateur). */
export function newModeId(adv, label = 'mode') {
  const base = String(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'mode';
  const used = new Set(listModes(adv).map(m => m.id));
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

/* ------------------------------------------------------------------ */
/* Aventure effective d'un mode                                        */
/* ------------------------------------------------------------------ */

/** Fusion profonde des objets simples (les tableaux et les valeurs sont remplacés). Ne modifie rien. */
export function mergeRules(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined || k === 'modes') continue;
    out[k] = isObj(v) && isObj(base?.[k]) ? mergeRules(base[k], v) : structuredClone(v);
  }
  return out;
}

/**
 * Paragraphe tel qu'il se lit dans un mode : les champs de sec.variants[mode] remplacent ceux de l'original
 * (une valeur null compte : « ending: null » retire la fin), puis les choix et blocs réservés à d'autres modes disparaissent.
 * Renvoie un nouvel objet, sans `variants`.
 */
export function sectionFor(sec, modeId) {
  const { variants, ...s } = structuredClone(sec);
  const v = variants?.[modeId];
  if (isObj(v)) for (const [k, val] of Object.entries(v)) if (val !== undefined && k !== 'variants') s[k] = val;
  s.choices = (s.choices || []).filter(c => visibleIn(c, modeId));
  s.blocks = (s.blocks || []).filter(b => visibleIn(b, modeId));
  return s;
}

/**
 * Aventure effective pour un mode : NOUVELLE aventure (l'original n'est pas modifié) où
 * - chaque paragraphe prend les champs de sa variante pour ce mode ;
 * - les choix et blocs dont `modes` ne contient pas ce mode sont retirés ;
 * - les règles du mode (mode.rules) sont fusionnées dans adv.rules.
 * Mode inconnu ou absent : le premier mode. Aventure sans modes : renvoyée telle quelle.
 * Les numéros de blocs et de choix de l'état de jeu (state.blocks, choose) se rapportent à cette aventure effective.
 */
export function applyMode(adv, modeId) {
  const mode = resolveMode(adv, modeId);
  if (!mode) return adv;
  const { sections, ...rest } = adv;
  const a = structuredClone(rest);
  a.rules = mergeRules(a.rules, mode.rules);
  a.rules.modes = structuredClone(listModes(adv));
  a.sections = Object.fromEntries(Object.entries(sections || {}).map(([id, sec]) => [id, sectionFor(sec, mode.id)]));
  a.appliedMode = mode.id;
  return a;
}

/* ------------------------------------------------------------------ */
/* Vérification par mode                                               */
/* ------------------------------------------------------------------ */

const ids = adv => Object.keys(adv.sections || {}).sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b));

/** Bilan d'un mode : { mode, total, reachable: [ids], unused: [ids], victories, deaths } (paragraphes atteignables depuis le départ). */
export function modeSummary(adv, modeId) {
  const eff = applyMode(adv, modeId);
  const reach = reachable(eff);
  const all = ids(eff);
  return {
    mode: resolveMode(adv, modeId),
    total: all.length,
    reachable: all.filter(i => reach.has(i)),
    unused: all.filter(i => !reach.has(i)),
    victories: all.filter(i => reach.has(i) && eff.sections[i].ending === 'victory'),
    deaths: all.filter(i => reach.has(i) && eff.sections[i].ending === 'death'),
  };
}

/**
 * Vérifie chaque mode : validate() sur l'aventure effective de chaque mode, problèmes préfixés par le nom du mode.
 * Seuls les paragraphes atteignables dans ce mode comptent (les autres servent à d'autres modes) ; ils sont résumés en une ligne.
 * S'ajoutent les erreurs propres aux modes : identifiants, variantes ou listes `modes` qui citent un mode inconnu,
 * choix ou bloc visible dans aucun mode. Renvoie [{ mode, section, level, message }].
 */
export function validateModes(adv) {
  const modes = listModes(adv);
  const out = [];
  if (!modes.length) return out;
  const known = new Set(modes.map(m => m.id));
  const push = (mode, section, level, message) => out.push({ mode, section, level, message });
  const seen = new Set();
  modes.forEach((m, i) => {
    if (seen.has(m.id)) push(m.id, null, 'error', `Deux modes ont le même identifiant « ${m.id} ».`);
    seen.add(m.id);
    if (!String(m.label || '').trim()) push(m.id, null, 'warning', `Le mode n°${i + 1} (${m.id}) n'a pas de nom.`);
  });
  for (const id of ids(adv)) {
    const sec = adv.sections[id];
    for (const k of Object.keys(sec.variants || {})) if (!known.has(k)) push(null, id, 'warning', `Variante pour un mode inconnu « ${k} » (ignorée).`);
    const lists = [['choix', sec.choices || []], ['bloc', sec.blocks || []]];
    for (const [what, list] of lists) list.forEach((x, j) => {
      if (!Array.isArray(x.modes)) return;
      x.modes.filter(k => !known.has(k)).forEach(k => push(null, id, 'warning', `Le ${what} n°${j + 1} cite un mode inconnu « ${k} ».`));
      if (!x.modes.some(k => known.has(k))) push(null, id, 'warning', `Le ${what} n°${j + 1} n'est visible dans aucun mode.`);
    });
  }
  for (const m of modes) {
    const eff = applyMode(adv, m.id);
    const reach = reachable(eff);
    const name = m.label || m.id;
    for (const p of validate(eff)) {
      if (p.section && !reach.has(p.section)) continue;
      push(m.id, p.section, p.level, `[${name}] ${p.message}`);
    }
    const unused = ids(eff).filter(i => !reach.has(i));
    if (unused.length) push(m.id, null, 'info', `[${name}] ${unused.length} paragraphe${unused.length > 1 ? 's' : ''} jamais atteint${unused.length > 1 ? 's' : ''} dans ce mode : ${unused.join(', ')}.`);
    if (![...reach].some(i => eff.sections[i]?.ending === 'victory')) push(m.id, null, 'warning', `[${name}] Aucune victoire n'est atteignable dans ce mode.`);
  }
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* ------------------------------------------------------------------ */
/* Branchements dans le moteur                                         */
/* ------------------------------------------------------------------ */

registerNormalize(a => { if (!Array.isArray(a.rules.modes)) a.rules.modes = []; });

// Le mode est choisi à la création du héros (panneau de création, lien ?mode=…) ; null = premier mode, ou aucun.
registerHeroInit(state => { if (state.mode === undefined) state.mode = null; });

const modeList = c => (Array.isArray(c.mode) ? c.mode : [c.mode]).filter(Boolean);
const modeNames = (c, adv) => modeList(c).map(id => modeById(adv, id)?.label || id);
const orList = l => (l.length > 1 ? `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}` : l[0] || '?');

registerCondition({
  id: 'mode',
  match: c => Object.prototype.hasOwnProperty.call(c, 'mode'),
  check: (c, state, adv) => modeList(c).includes(resolveMode(adv, state.mode)?.id ?? state.mode),
  describe: (c, adv) => `jouer en mode ${orList(modeNames(c, adv))}`,
  print: (c, adv) => `vous lisez la version « ${orList(modeNames(c, adv))} »`,
  validate: (c, adv, report, where) => {
    const l = modeList(c);
    if (!l.length) report('error', `${where} : condition de mode sans mode choisi.`);
    l.filter(id => !modeById(adv, id)).forEach(id => report('error', `${where} : mode inconnu « ${id} » (onglet Modes).`));
  },
});

// Renvois des variantes : le graphe et la vérification de l'aventure voient aussi les paragraphes propres à un mode.
registerTargets(sec => {
  if (!isObj(sec?.variants)) return [];
  const base = new Set(targetsOf({ ...sec, variants: undefined }).map(t => t.to));
  const out = [];
  for (const [mode, v] of Object.entries(sec.variants)) {
    if (!isObj(v) || (v.choices === undefined && v.blocks === undefined)) continue;
    for (const t of targetsOf({ choices: v.choices || [], blocks: v.blocks || [] })) {
      if (base.has(t.to)) continue;
      base.add(t.to);
      out.push({ ...t, label: `${t.label ? t.label + ' ' : ''}[${mode}]`, ref: ['variants', mode, ...(t.ref || [])], mode });
    }
  }
  return out;
});

// Renumérotation et renommage : les renvois des variantes suivent.
function remapBlock(b, m, remapCond) {
  const x = { ...b };
  ['success', 'failure', 'win', 'flee', 'lose'].forEach(k => { if (x[k]) x[k] = m(x[k]); });
  if (x.table) x.table = x.table.map(t => ({ ...t, to: m(t.to) }));
  if (x.options) x.options = x.options.map(o => ({ ...o, to: m(o.to) }));
  const plug = ext.blocks.get(x.type);
  return plug?.remap ? plug.remap(x, m, remapCond) : x;
}
registerRemap((adv, m, remapCond) => {
  const fx = list => (list || []).map(e => (e.if ? { ...e, if: remapCond(e.if) } : e));
  for (const sec of Object.values(adv.sections || {})) {
    for (const v of Object.values(isObj(sec.variants) ? sec.variants : {})) {
      if (!isObj(v)) continue;
      if (Array.isArray(v.choices)) v.choices = v.choices.map(c => ({ ...c, to: m(c.to), if: remapCond(c.if), effects: fx(c.effects) }));
      if (Array.isArray(v.onEnter)) v.onEnter = fx(v.onEnter);
      if (Array.isArray(v.blocks)) v.blocks = v.blocks.map(b => remapBlock(b, m, remapCond));
    }
  }
});

// Export .lhz : images et sons des variantes.
registerAssets(adv => Object.values(adv.sections || {}).flatMap(sec => Object.values(isObj(sec.variants) ? sec.variants : {})
  .flatMap(v => [v?.image, v?.sound, ...(v?.blocks || []).flatMap(b => [...(b.enemies || []).map(e => e.image), typeof b.image === 'string' ? b.image : null])])
  .filter(p => typeof p === 'string' && p)));
