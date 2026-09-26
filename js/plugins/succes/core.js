// Greffon « succes » — partie pure (aucun DOM, testable dans Node).
// Succès de l'aventure (adv.achievements), évaluation selon l'état de la partie,
// et calculs des statistiques du joueur / de l'auteur (parties, fins, morts, paragraphes visités).
// Voir docs/plugins/succes.md.

import { registerNormalize, registerRemap } from '../../core/plugins.js';
import { check, describeCondition, slug } from '../../core/rules.js';

export const WHEN = ['end', 'anytime'];
export const ENDINGS = ['victory', 'death'];

/* ------------------------------------------------------------------ */
/* Format des succès                                                   */
/* ------------------------------------------------------------------ */

/** Complète un succès écrit à la main : valeurs par défaut, champs inconnus conservés. */
export function normalizeAchievement(a = {}) {
  const out = {
    ...a,
    id: String(a.id ?? '').trim(),
    title: String(a.title ?? ''),
    description: String(a.description ?? ''),
    secret: !!a.secret,
    when: WHEN.includes(a.when) ? a.when : 'end',
    ending: ENDINGS.includes(a.ending) ? a.ending : null,
  };
  if (!a.cond) delete out.cond;
  return out;
}

registerNormalize(adv => {
  adv.achievements = Array.isArray(adv.achievements) ? adv.achievements.filter(a => a && typeof a === 'object').map(normalizeAchievement) : [];
});

// Renommer ou renuméroter les paragraphes met aussi à jour les conditions « est passé par le … » des succès.
registerRemap((adv, m, remapCond) => {
  if (Array.isArray(adv.achievements)) adv.achievements = adv.achievements.map(a => (a?.cond ? { ...a, cond: remapCond(a.cond) } : a));
});

export const achievementsOf = adv => (Array.isArray(adv?.achievements) ? adv.achievements.filter(a => a && a.id) : []);

/** Identifiant libre et stable pour un nouveau succès (« victoire », « victoire-2 »…). */
export function uniqueId(base, taken) {
  const used = new Set(taken);
  const root = slug(base || 'succes') || 'succes';
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) if (!used.has(`${root}-${i}`)) return `${root}-${i}`;
}

/* ------------------------------------------------------------------ */
/* Évaluation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Identifiants des succès remplis par `state`.
 * phase 'anytime' : en cours de partie, seuls les succès « à tout moment » sont examinés ;
 * phase 'end' : la partie est finie, tous les succès sont examinés (ceux « à tout moment » aussi,
 * au cas où la condition devient vraie sur le dernier paragraphe).
 * Un succès lié à une fin (ending) n'est rempli que si la partie s'est terminée ainsi.
 */
export function evaluateAchievements(adv, state, phase = 'end') {
  if (!state) return [];
  const out = [];
  for (const a of achievementsOf(adv)) {
    if (phase !== 'end' && a.when !== 'anytime') continue;
    if (a.when !== 'anytime' && !state.ended) continue;
    if (a.ending && state.ended !== a.ending) continue;
    let ok = false;
    try { ok = check(a.cond, state, adv); } catch { ok = false; } // condition d'un greffon absent : jamais remplie
    if (ok && !out.includes(a.id)) out.push(a.id);
  }
  return out;
}

/** Succès remplis qui ne sont pas encore dans `unlocked` ({ id: dateISO }). */
export const newlyUnlocked = (adv, state, phase, unlocked = {}) => evaluateAchievements(adv, state, phase).filter(id => !unlocked?.[id]);

/** Ce que le joueur peut voir d'un succès : les secrets restent « ??? » tant qu'ils ne sont pas débloqués. */
export function achievementView(a, unlockedAt = null) {
  const unlocked = !!unlockedAt;
  const hidden = !!a.secret && !unlocked;
  return {
    id: a.id,
    unlocked,
    date: unlockedAt || null,
    secret: !!a.secret,
    hidden,
    title: hidden ? '???' : a.title || 'Succès sans nom',
    description: hidden ? 'Succès secret : continuez à explorer pour le découvrir.' : a.description || '',
  };
}

/** Phrase de l'éditeur : quand et à quelle condition le succès se débloque. */
export function describeAchievement(a, adv) {
  const when = a.when === 'anytime'
    ? (a.ending ? `à la ${a.ending === 'victory' ? 'victoire' : 'mort du héros'}` : 'dès que la condition est remplie, en pleine partie')
    : a.ending === 'victory' ? 'à la fin de la partie, en cas de victoire'
      : a.ending === 'death' ? 'à la fin de la partie, si le héros meurt'
        : 'à la fin de la partie, quelle qu’elle soit';
  let cond = '';
  try { cond = a.cond ? describeCondition(a.cond, adv) : ''; } catch { cond = ''; }
  if (!cond) return a.when === 'anytime' && !a.ending ? 'Débloqué dès le début de la partie (aucune condition).' : `Débloqué ${when}.`;
  return `Débloqué ${when}, si le héros remplit : ${cond}.`;
}

/** Avertissements de l'éditeur pour un succès. */
export function achievementProblems(a, adv) {
  const out = [];
  const all = Array.isArray(adv.achievements) ? adv.achievements : [];
  if (!a.id) out.push('Identifiant manquant : ce succès sera ignoré.');
  else if (all.filter(x => x?.id === a.id).length > 1) out.push(`Identifiant « ${a.id} » en double : un seul des deux sera compté.`);
  if (!String(a.title || '').trim()) out.push('Donnez un titre à ce succès.');
  if (a.when === 'anytime' && !a.cond && !a.ending) out.push('Sans condition, ce succès « en pleine partie » est débloqué dès le premier paragraphe.');
  if (a.ending && !Object.values(adv.sections || {}).some(s => s.ending === a.ending)) out.push(`Aucun paragraphe n'est marqué « ${a.ending === 'victory' ? 'Victoire' : 'Mort du héros'} » : ce succès risque d'être impossible à obtenir.`);
  const walk = c => {
    if (!c || typeof c !== 'object') return;
    (c.all || c.any || []).forEach(walk);
    if (c.not) walk(c.not);
    if (c.visited && !adv.sections?.[c.visited]) out.push(`La condition cite le paragraphe ${c.visited}, qui n'existe pas.`);
    if (c.has && !adv.items?.[c.has]) out.push(`La condition cite l'objet « ${c.has} », absent de la liste des objets.`);
  };
  walk(a.cond);
  return out;
}

/* ------------------------------------------------------------------ */
/* Statistiques                                                        */
/* ------------------------------------------------------------------ */

export const emptyStats = () => ({ runs: 0, victories: 0, deaths: 0, endings: {}, deathsAt: {}, visited: {}, lastPlayed: null });

/** Complète des statistiques lues dans le stockage (anciennes ou incomplètes). */
export function normalizeStats(s) {
  const e = emptyStats();
  if (!s || typeof s !== 'object') return e;
  return {
    ...e, ...s,
    endings: { ...(s.endings || {}) }, deathsAt: { ...(s.deathsAt || {}) }, visited: { ...(s.visited || {}) },
    runs: Number(s.runs) || 0, victories: Number(s.victories) || 0, deaths: Number(s.deaths) || 0,
  };
}

const bump = (map, key, n = 1) => ({ ...map, [key]: (map[key] || 0) + n });

/** Visites nouvelles entre deux états (un retour en arrière ne retire rien). */
export function visitDiff(before = {}, after = {}) {
  const out = {};
  for (const [sid, n] of Object.entries(after || {})) {
    const d = (Number(n) || 0) - (Number(before?.[sid]) || 0);
    if (d > 0) out[sid] = d;
  }
  return out;
}

export function addVisits(stats, diff, now = new Date().toISOString()) {
  const s = normalizeStats(stats);
  const keys = Object.keys(diff || {});
  if (!keys.length) return s;
  for (const k of keys) s.visited = bump(s.visited, k, diff[k]);
  s.lastPlayed = now;
  return s;
}

/** Nouvelle partie (l'état a déjà franchi le paragraphe de départ). */
export function statsOnStart(stats, state, now = new Date().toISOString()) {
  const s = addVisits(stats, visitDiff({}, state?.visited || {}), now);
  s.runs += 1;
  s.lastPlayed = now;
  return s;
}

/** Fin de partie : victoire, mort, paragraphe de la fin. */
export function statsOnEnd(stats, state, now = new Date().toISOString()) {
  const s = normalizeStats(stats);
  if (!state?.ended) return s;
  const sid = String(state.section ?? '');
  if (state.ended === 'victory') s.victories += 1;
  if (state.ended === 'death') { s.deaths += 1; if (sid) s.deathsAt = bump(s.deathsAt, sid); }
  if (sid) s.endings = bump(s.endings, sid);
  s.lastPlayed = now;
  return s;
}

const endingIds = adv => Object.entries(adv.sections || {}).filter(([, s]) => s?.ending).map(([id]) => id);

/** Progression affichée sur la bibliothèque et l'écran de fin. */
export function progress(adv, stats, unlocked = {}) {
  const s = normalizeStats(stats);
  const ids = Object.keys(adv.sections || {});
  const seen = ids.filter(id => s.visited[id] > 0).length;
  const ends = endingIds(adv);
  const list = achievementsOf(adv);
  return {
    runs: s.runs,
    explored: { n: seen, total: ids.length, pct: ids.length ? Math.round((100 * seen) / ids.length) : 0 },
    endings: { n: ends.filter(id => s.endings[id] > 0).length, total: ends.length },
    achievements: { n: list.filter(a => unlocked?.[a.id]).length, total: list.length },
  };
}

/** Paragraphes où l'on meurt le plus : [{ sid, n, share }] triés, share entre 0 et 1. */
export function deathRanking(stats, limit = 10) {
  const s = normalizeStats(stats);
  const total = Object.values(s.deathsAt).reduce((a, b) => a + b, 0);
  return Object.entries(s.deathsAt).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || (Number(a[0]) || 0) - (Number(b[0]) || 0))
    .slice(0, limit).map(([sid, n]) => ({ sid, n, share: total ? n / total : 0 }));
}

/** Paragraphes les plus lus : [{ sid, n }]. */
export function mostVisited(stats, limit = 10) {
  const s = normalizeStats(stats);
  return Object.entries(s.visited).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || (Number(a[0]) || 0) - (Number(b[0]) || 0))
    .slice(0, limit).map(([sid, n]) => ({ sid, n }));
}

const byNumber = (a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || String(a).localeCompare(String(b));

/** Paragraphes jamais lus (dans l'ordre des numéros). */
export function neverVisited(adv, stats) {
  const s = normalizeStats(stats);
  return Object.keys(adv.sections || {}).filter(id => !(s.visited[id] > 0)).sort(byNumber);
}

/** Toutes les fins de l'aventure avec le nombre de fois qu'on les a atteintes. */
export function endingsReached(adv, stats) {
  const s = normalizeStats(stats);
  return endingIds(adv).sort(byNumber).map(sid => ({ sid, kind: adv.sections[sid].ending, n: s.endings[sid] || 0 }));
}

/** Morts survenues hors d'un paragraphe de fin (combat perdu, ENDURANCE à zéro…). */
export function otherDeaths(adv, stats) {
  const s = normalizeStats(stats);
  return Object.entries(s.deathsAt).filter(([sid, n]) => n > 0 && !adv.sections?.[sid]?.ending).map(([sid, n]) => ({ sid, n })).sort((a, b) => b.n - a.n);
}

/** Pourcentage arrondi, sans division par zéro. */
export const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);
