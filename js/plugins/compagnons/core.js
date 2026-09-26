// Greffon « compagnons » — moteur pur (aucun DOM, testable dans Node).
// Des alliés voyagent avec le héros : ils arrivent, partent, se soignent, sont blessés,
// et frappent à leur tour pendant les combats (après l'échange du héros).
//
// Aventure : adv.companions = { id: { name, skill, health, damage?, image?, description? } }
// État     : state.companions = [{ id, health, max }]  (seulement les compagnons présents et vivants)
// Effet    : { op: 'companion', companion: id, action: 'join'|'leave'|'heal'|'hurt', amount? }
// Conditions : { companion: id } · { not: { companion: id } } · { companions: true, gte|lte|eq: n } (ou { companions: n } = au moins n)
// Voir docs/plugins/compagnons.md.

import { registerEffect, registerCondition, registerCombatHook, registerHeroInit, registerNormalize } from '../../core/plugins.js';
import { statLabel } from '../../core/rules.js';

export const ACTIONS = ['join', 'leave', 'heal', 'hurt'];

/* ------------------------------------------------------------------ */
/* Lecture de l'aventure et de l'état                                  */
/* ------------------------------------------------------------------ */

export const companionDef = (adv, id) => (adv?.companions && Object.prototype.hasOwnProperty.call(adv.companions, id) ? adv.companions[id] : null);
export const companionName = (adv, id) => companionDef(adv, id)?.name || id || '?';
/** Dégâts infligés par un compagnon : les siens, sinon ceux de la règle de combat (2 par défaut). */
export const companionDamage = (adv, def) => Math.max(0, Number(def?.damage ?? adv?.rules?.combat?.damage ?? 2) || 0);
const hpLabel = adv => statLabel(adv, adv.rules?.combat?.health || 'endurance');
const pts = n => `${n} point${Math.abs(n) > 1 ? 's' : ''}`;
/** « de » + mot, avec élision devant une voyelle : de('Endurance') → « d’Endurance ». */
export const de = word => (/^[aeiouyhâàéèêëîïôöûüœ]/i.test(word) ? `d’${word}` : `de ${word}`);

/** Compagnons présents et vivants, avec leur fiche : [{ id, name, skill, damage, image, description, health, max }]. */
export function companionsOf(state, adv) {
  return (state?.companions || []).filter(m => m.health > 0).map(m => {
    const d = companionDef(adv, m.id) || {};
    return { ...d, id: m.id, name: d.name || m.id, skill: Number(d.skill) || 0, damage: companionDamage(adv, d), image: d.image || null, description: d.description || '', health: m.health, max: m.max };
  });
}

export const hasCompanion = (state, id) => (state?.companions || []).some(m => m.id === id && m.health > 0);
export const companionCount = state => (state?.companions || []).filter(m => m.health > 0).length;

/* ------------------------------------------------------------------ */
/* Effet { op: 'companion' }                                           */
/* ------------------------------------------------------------------ */

/** Applique l'effet sur `s` (état déjà cloné par le moteur) et pousse les messages. */
export function applyCompanion(s, e, adv, messages) {
  const def = companionDef(adv, e.companion);
  if (!def) return;
  s.companions = Array.isArray(s.companions) ? s.companions.filter(m => m && m.health > 0) : [];
  const name = def.name || e.companion;
  const max = Math.max(1, Number(def.health) || 1);
  const here = s.companions.find(m => m.id === e.companion);
  const amount = e.amount === undefined || e.amount === null || e.amount === '' ? null : Math.max(0, Number(e.amount) || 0);
  switch (e.action || 'join') {
    case 'join': {
      if (here) { messages.push({ kind: 'info', text: `${name} est déjà à vos côtés.` }); break; }
      const health = amount ? Math.min(max, amount) : max;
      s.companions.push({ id: e.companion, health, max });
      messages.push({ kind: 'gain', text: `${name} se joint à vous.` });
      break;
    }
    case 'leave':
      if (!here) break;
      s.companions = s.companions.filter(m => m.id !== e.companion);
      messages.push({ kind: 'loss', text: `${name} vous quitte.` });
      break;
    case 'heal': {
      if (!here) break;
      const before = here.health;
      here.health = amount === null ? here.max : Math.min(here.max, here.health + amount);
      const d = here.health - before;
      if (d) messages.push({ kind: 'gain', text: `${name} récupère ${pts(d)} ${de(hpLabel(adv))} (${here.health} / ${here.max}).` });
      break;
    }
    case 'hurt': {
      if (!here) break;
      const d = Math.min(here.health, amount ?? 2);
      if (!d) break;
      here.health -= d;
      messages.push({ kind: 'loss', text: `${name} perd ${pts(d)} ${de(hpLabel(adv))} (${here.health} / ${here.max}).` });
      if (here.health <= 0) {
        s.companions = s.companions.filter(m => m.id !== e.companion);
        messages.push({ kind: 'loss', text: `${name} succombe à ses blessures.` });
      }
      break;
    }
    default: break;
  }
}

export function describeCompanionEffect(e, adv) {
  const name = companionName(adv, e.companion);
  const n = e.amount === undefined || e.amount === null || e.amount === '' ? null : Number(e.amount);
  switch (e.action || 'join') {
    case 'join': return `${name} se joint au héros${n ? ` (${n} ${de(hpLabel(adv))})` : ''}`;
    case 'leave': return `${name} quitte le héros`;
    case 'heal': return n === null ? `${name} retrouve toute son ${hpLabel(adv)}` : `${name} récupère ${pts(n)} ${de(hpLabel(adv))}`;
    case 'hurt': return `${name} perd ${pts(n ?? 2)} ${de(hpLabel(adv))}`;
    default: return `compagnon : ${e.action}`;
  }
}

/** Phrase de livre imprimé (effectText met la majuscule). */
export function printCompanionEffect(e, adv) {
  const def = companionDef(adv, e.companion) || {};
  const name = def.name || e.companion;
  const UP = id => statLabel(adv, id).toUpperCase();
  const C = adv.rules?.combat || {};
  const HP = UP(C.health || 'endurance');
  const n = e.amount === undefined || e.amount === null || e.amount === '' ? null : Number(e.amount);
  switch (e.action || 'join') {
    case 'join': return `${name} se joint à vous : notez ce compagnon dans la case Compagnons de votre Feuille d'Aventure (${UP(C.skill || 'habilete')} ${Number(def.skill) || 0}, ${HP} ${n ? `${n} sur ${Number(def.health) || 0}` : Number(def.health) || 0}${def.damage !== undefined && def.damage !== null && def.damage !== '' ? `, dégâts ${def.damage}` : ''}).`;
    case 'leave': return `${name} vous quitte : rayez ce nom de la case Compagnons.`;
    case 'heal': return n === null ? `si ${name} vous accompagne, son ${HP} revient à son total de départ.` : `si ${name} vous accompagne, rendez-lui ${pts(n)} ${de(HP)} (sans dépasser son total de départ).`;
    case 'hurt': return `si ${name} vous accompagne, retirez-lui ${pts(n ?? 2)} ${de(HP)} ; à zéro, ce compagnon meurt : rayez son nom.`;
    default: return '';
  }
}

function validateCompanionEffect(e, adv, report, where) {
  if (!e.companion) report('error', `${where} : effet « compagnon » sans compagnon choisi.`);
  else if (!companionDef(adv, e.companion)) report('error', `${where} : compagnon inconnu « ${e.companion} » (onglet Compagnons).`);
  if (e.action && !ACTIONS.includes(e.action)) report('error', `${where} : action de compagnon inconnue « ${e.action} ».`);
  if (e.amount !== undefined && e.amount !== null && e.amount !== '' && !(Number(e.amount) >= 0)) report('warning', `${where} : le nombre de points d'un compagnon doit être positif.`);
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

const isObj = c => !!c && typeof c === 'object' && !Array.isArray(c);
/** Condition du greffon ? (y compris { not: { companion } }, pour une phrase imprimée naturelle.) */
export const isCompanionCond = c => isObj(c) && ('companion' in c || 'companions' in c || (isObj(c.not) && Object.keys(c).length === 1 && 'companion' in c.not));

/** Seuils d'une condition { companions } : { gte?, lte?, eq? }. { companions: 2 } seul = au moins 2 ; { companions: true } seul = au moins 1. */
function bounds(c) {
  const b = {};
  if (c.gte !== undefined && c.gte !== null && c.gte !== '') b.gte = Number(c.gte);
  if (c.lte !== undefined && c.lte !== null && c.lte !== '') b.lte = Number(c.lte);
  if (c.eq !== undefined && c.eq !== null && c.eq !== '') b.eq = Number(c.eq);
  if (!Object.keys(b).length) b.gte = typeof c.companions === 'number' ? c.companions : 1;
  return b;
}

export function checkCompanionCond(c, state) {
  if (isObj(c.not)) return !checkCompanionCond(c.not, state);
  if ('companion' in c) return hasCompanion(state, c.companion);
  const n = companionCount(state), b = bounds(c);
  if (b.gte !== undefined && !(n >= b.gte)) return false;
  if (b.lte !== undefined && !(n <= b.lte)) return false;
  if (b.eq !== undefined && !(n === b.eq)) return false;
  return true;
}

const countText = (b, verb) => {
  const noun = k => `compagnon${k > 1 ? 's' : ''}`;
  if (b.eq !== undefined) return `${verb} exactement ${b.eq} ${noun(b.eq)}`;
  const parts = [];
  if (b.gte !== undefined) parts.push(`au moins ${b.gte} ${noun(b.gte)}`);
  if (b.lte !== undefined) parts.push(`au plus ${b.lte} ${noun(b.lte)}`);
  return `${verb} ${parts.join(' et ')}`;
};

export function describeCompanionCond(c, adv) {
  if (isObj(c.not)) return 'companion' in c.not ? `ne pas être accompagné ${de(companionName(adv, c.not.companion))}` : `pas : ${describeCompanionCond(c.not, adv)}`;
  if ('companion' in c) return `être accompagné ${de(companionName(adv, c.companion))}`;
  return countText(bounds(c), 'avoir');
}

export function printCompanionCond(c, adv) {
  if (isObj(c.not)) return 'companion' in c.not ? `${companionName(adv, c.not.companion)} ne vous accompagne pas` : `pas (${printCompanionCond(c.not, adv)})`;
  if ('companion' in c) return `${companionName(adv, c.companion)} vous accompagne`;
  return countText(bounds(c), 'vous avez').replace(/^vous avez au moins 1 compagnon$/, 'au moins un compagnon vous accompagne');
}

function validateCompanionCond(c, adv, report, where) {
  const x = isObj(c.not) ? c.not : c;
  if ('companion' in x) {
    if (!x.companion) report('error', `${where} : condition « compagnon » sans compagnon choisi.`);
    else if (!companionDef(adv, x.companion)) report('error', `${where} : la condition cite le compagnon inconnu « ${x.companion} ».`);
  }
}

/* ------------------------------------------------------------------ */
/* Combat : chaque compagnon frappe après l'échange du héros           */
/* ------------------------------------------------------------------ */

/**
 * Tour des compagnons pendant un assaut. `ctx` = { state, adv, combat, rng, lines, roll } (voir combat.js) :
 * l'état et le combat sont déjà des copies, on les modifie. Pour chaque compagnon vivant :
 * 2d6 + HABILETÉ du compagnon contre 2d6 + HABILETÉ (+ bonus) de l'adversaire visé ; le plus fort blesse l'autre.
 * La cible est celle du héros si elle est encore debout, sinon le premier adversaire encore debout.
 */
export function companionRound({ state: s, adv, combat: c, rng, lines, roll }) {
  const party = (s.companions || []).filter(m => m && m.health > 0);
  if (!party.length || !c || c.over) return;
  const hp = s.stats?.[adv.rules?.combat?.health];
  if (hp && hp.cur <= 0) return; // le héros est tombé : le combat est perdu, ses compagnons ne frappent plus
  if (c.last) c.last.extra = c.last.extra || [];
  const allies = [];
  const stopAt = Number(c.stopAt) || 0;
  for (const m of party) {
    const standing = c.enemies.filter(e => e.health > stopAt);
    if (!standing.length) break;
    const def = companionDef(adv, m.id) || {};
    const name = def.name || m.id;
    const foe = standing.find(e => e.id === c.target) || standing[0];
    const cr = roll('2d6', rng), er = roll('2d6', rng);
    const ca = cr.total + (Number(def.skill) || 0);
    const ea = er.total + (Number(foe.skill) || 0) + (Number(foe.attackMod) || 0);
    const dealt = companionDamage(adv, def);
    const taken = Math.max(0, Number(foe.damage) || 0);
    let outcome, damage = 0, text, journal;
    if (ca > ea) {
      damage = Math.min(foe.health, dealt);
      foe.health = Math.max(0, foe.health - dealt);
      outcome = 'hit';
      text = `${name} frappe ${foe.name} : −${dealt}`;
      journal = `${name} blesse ${foe.name} (−${dealt})`;
    } else if (ea > ca && taken > 0) {
      damage = Math.min(m.health, taken);
      m.health = Math.max(0, m.health - taken);
      outcome = 'wounded';
      text = `${foe.name} blesse ${name} : −${taken} ${hpLabel(adv)}, reste ${m.health} / ${m.max}`;
      journal = `${foe.name} blesse ${name} (−${taken} ${hpLabel(adv)})`;
    } else if (ea > ca) {
      outcome = 'parry';
      text = journal = `${foe.name} pare l'attaque de ${name}`;
    } else {
      outcome = 'draw';
      text = journal = `${name} et ${foe.name} esquivent tous les deux`;
    }
    allies.push({ id: m.id, name, enemy: foe.id, foeName: foe.name, ally: { dice: cr.dice, total: ca }, foe: { dice: er.dice, total: ea }, outcome, damage });
    lines.push(`Assaut ${c.round} — ${name} ${ca} contre ${foe.name} ${ea} : ${journal}.`);
    c.last?.extra.push(`${text} (${ca} contre ${ea}).`);
    if (m.health <= 0) {
      c.fallen = [...(c.fallen || []), { id: m.id, name, max: m.max }];
      lines.push(`${name} tombe au combat.`);
      c.last?.extra.push(`${name} tombe au combat.`);
    }
  }
  if (c.last) c.last.allies = allies;
  s.companions = (s.companions || []).filter(m => m && m.health > 0);
}

/* ------------------------------------------------------------------ */
/* Aide pour l'éditeur : où un compagnon est-il utilisé ?              */
/* ------------------------------------------------------------------ */

/** [{ section, kind: 'join'|'leave'|'heal'|'hurt'|'condition', where }] */
export function companionUsages(adv, id) {
  const out = [];
  const walkCond = (sid, c, where) => {
    if (!isObj(c)) return;
    (c.all || c.any || []).forEach(x => walkCond(sid, x, where));
    if (isObj(c.not)) walkCond(sid, c.not, where);
    if (c.companion === id) out.push({ section: sid, kind: 'condition', where });
  };
  const walkBlock = (sid, node, where) => {
    if (Array.isArray(node)) { node.forEach(x => walkBlock(sid, x, where)); return; }
    if (!isObj(node)) return;
    if (node.op === 'companion') { if (node.companion === id) out.push({ section: sid, kind: node.action || 'join', where }); }
    else if (node.companion === id && !('op' in node)) out.push({ section: sid, kind: 'condition', where });
    for (const v of Object.values(node)) if (isObj(v) || Array.isArray(v)) walkBlock(sid, v, where);
  };
  const walkFx = (sid, list, where) => (list || []).forEach(e => {
    if (!isObj(e)) return;
    walkCond(sid, e.if, where);
    if (e.op === 'companion' && e.companion === id) out.push({ section: sid, kind: e.action || 'join', where });
  });
  for (const [sid, sec] of Object.entries(adv.sections || {})) {
    walkFx(sid, sec.onEnter, 'à l’arrivée');
    (sec.choices || []).forEach((ch, i) => { walkCond(sid, ch.if, `choix ${i + 1}`); walkFx(sid, ch.effects, `choix ${i + 1}`); });
    // Blocs (défi, Zefor, carte, boutique…) : parcours générique de leurs effets et conditions, où qu'ils soient.
    (sec.blocks || []).forEach((b, i) => walkBlock(sid, b, `bloc ${i + 1}${b?.type ? ` (${b.type})` : ''}`));
  }
  for (const [iid, it] of Object.entries(adv.items || {})) walkFx(null, it.use, `objet ${it.name || iid}`);
  return out;
}

/** Identifiant libre pour un nouveau compagnon, à partir d'un identifiant de base (déjà « slugifié »). */
export function freeCompanionId(adv, base) {
  const b = base || 'compagnon';
  if (!companionDef(adv, b)) return b;
  let i = 2;
  while (companionDef(adv, `${b}-${i}`)) i++;
  return `${b}-${i}`;
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

registerNormalize(adv => {
  if (!isObj(adv.companions)) adv.companions = {};
});

registerHeroInit(state => {
  state.companions = [];
});

registerEffect('companion', {
  apply: applyCompanion,
  describe: describeCompanionEffect,
  print: printCompanionEffect,
  validate: validateCompanionEffect,
});

registerCondition({
  id: 'companion',
  match: isCompanionCond,
  check: (c, state) => checkCompanionCond(c, state),
  describe: describeCompanionCond,
  print: printCompanionCond,
  validate: validateCompanionCond,
});

registerCombatHook({ round: companionRound });

