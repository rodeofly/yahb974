// Greffon « carte » — moteur pur (aucun DOM, testable dans Node).
//
// 1. Bloc « map » : une image avec des zones cliquables qui renvoient à des paragraphes.
//    { type: 'map', image, alt, label?, hotspots: [{ x, y, w, h, label, to, if?, hideIfUnavailable?, effects? }] }
//    x, y, w, h sont en pourcentage de l'image (0 à 100).
// 2. Carte du monde : adv.meta.worldMap = { image, places: { [lieu]: { x, y } }, known?: [lieux], revealUnvisited, showPath }.
//    Les lieux sont les valeurs du champ « Lieu » (section.place) des paragraphes. `known` : lieux connus dès le départ
//    (par exemple, ceux d'un livre précédent de la même série).
// 3. Effet { op: 'revealPlace', place } : le héros apprend où se trouve un lieu (il apparaît sur sa carte).
// 4. Conditions { placeVisited }, { placeNotVisited }, { placeKnown } : être (ou non) déjà allé dans un lieu.
// 5. Voyage sur le plateau : worldMap.path = [{ x, y }] (les cases, dans l'ordre), worldMap.places[lieu].case (la case
//    d'arrêt du lieu ; sinon la plus proche), worldMap.travel = { token: 'images/pion.png' ou un émoji, label? } :
//    quand le lieu change, le plateau s'affiche et le pion avance de case en case (travelHops).
// Voir docs/plugins/carte.md.

import { registerBlock, registerEffect, registerCondition, registerHeroInit, registerNormalize, registerAssets, findCondition, ext } from '../../core/plugins.js';
import { check, describeCondition, choiceGuard, enter, targetsOf } from '../../core/rules.js';

export const TYPE = 'map';

/* ------------------------------------------------------------------ */
/* Géométrie                                                           */
/* ------------------------------------------------------------------ */

export const clamp = (v, min = 0, max = 100) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : min));
export const round1 = v => Math.round(Number(v) * 10) / 10;

/** Rectangle d'une zone ramené dans l'image (0 à 100 %). */
export function rectOf(h) {
  const x = clamp(h?.x), y = clamp(h?.y);
  return { x, y, w: clamp(h?.w, 0, 100 - x), h: clamp(h?.h, 0, 100 - y) };
}

/* ------------------------------------------------------------------ */
/* Bloc « map » : zones jouables                                       */
/* ------------------------------------------------------------------ */

/** Zones du bloc avec leur disponibilité (comme choicesFor) ; les zones cachées sont retirées. */
export function hotspotsFor(state, adv, block) {
  const guard = choiceGuard(state, adv);
  return (block?.hotspots || []).map((h, index) => {
    const ok = check(h.if, state, adv);
    const hidden = !ok && !!h.hideIfUnavailable;
    if (!h.to) return { ...h, index, available: false, hidden, reason: 'Ce passage ne mène nulle part.' };
    if (guard) return { ...h, index, available: false, hidden, reason: guard };
    return { ...h, index, available: ok, hidden, reason: ok ? '' : `Il faut ${describeCondition(h.if, adv)}.` };
  }).filter(h => !h.hidden);
}

/** Emprunte la zone `hotspotIndex` du bloc `blockIndex` du paragraphe courant. Renvoie { state, messages }. */
export function chooseHotspot(state, adv, blockIndex, hotspotIndex) {
  const b = adv.sections[state.section]?.blocks?.[blockIndex];
  const h = b?.type === TYPE ? b.hotspots?.[hotspotIndex] : null;
  if (!h) throw new Error('Zone inconnue.');
  if (!h.to || !check(h.if, state, adv) || choiceGuard(state, adv)) throw new Error('Ce passage n’est pas disponible.');
  return enter(state, adv, h.to, { viaEffects: h.effects || [] });
}

/* ------------------------------------------------------------------ */
/* Lieux et carte du monde                                             */
/* ------------------------------------------------------------------ */

/** Nom de lieu normalisé (espaces superflus retirés). */
export const placeName = p => String(p ?? '').replace(/\s+/g, ' ').trim();

/** Lieux cités par les paragraphes : [{ name, sections: [numéros] }], par ordre alphabétique. */
export function placesOf(adv) {
  const m = new Map();
  for (const [id, s] of Object.entries(adv?.sections || {})) {
    const p = placeName(s?.place);
    if (!p) continue;
    if (!m.has(p)) m.set(p, []);
    m.get(p).push(id);
  }
  return [...m].map(([name, sections]) => ({ name, sections })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Tri des numéros de paragraphes : 2 avant 10, puis les identifiants non numériques. */
const byNum = (a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b), 'fr');

/**
 * Lieu de chaque paragraphe, pour la carte du monde en mode triche : le sien, sinon celui du paragraphe le plus proche
 * qui y mène (paragraphes ajoutés sans lieu, comme ceux d'une campagne). Map id → { place, inherited }.
 * Les paragraphes qu'aucun paragraphe avec lieu n'atteint restent sans lieu.
 */
export function placeOfSections(adv) {
  const out = new Map();
  const queue = [];
  for (const id of Object.keys(adv?.sections || {}).sort(byNum)) {
    const p = placeName(adv.sections[id]?.place);
    if (p) { out.set(id, { place: p, inherited: false }); queue.push(id); }
  }
  // Parcours en largeur depuis tous les paragraphes situés à la fois : chacun hérite du lieu le plus proche.
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const t of targetsOf(adv.sections[from] || {})) {
      if (!adv.sections[t.to] || out.has(t.to)) continue;
      out.set(t.to, { place: out.get(from).place, inherited: true });
      queue.push(t.to);
    }
  }
  return out;
}

/** Paragraphes de chaque lieu, héritiers compris : Map lieu → [{ id, inherited }], par numéro. */
export function sectionsByPlace(adv) {
  const m = new Map();
  for (const [id, x] of placeOfSections(adv)) {
    if (!m.has(x.place)) m.set(x.place, []);
    m.get(x.place).push({ id, inherited: x.inherited });
  }
  for (const list of m.values()) list.sort((a, b) => byNum(a.id, b.id));
  return m;
}

/** Lieux où le héros est déjà allé, d'après state.visited. */
export function visitedPlaces(state, adv) {
  const out = new Set();
  for (const id of Object.keys(state?.visited || {})) {
    const p = placeName(adv?.sections?.[id]?.place);
    if (p) out.add(p);
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Lieux connus dès le départ (adv.meta.worldMap.known). */
export const knownAtStart = adv => (Array.isArray(adv?.meta?.worldMap?.known) ? adv.meta.worldMap.known.map(placeName).filter(Boolean) : []);

/** Lieux connus sans forcément y être allé : révélés par l'effet revealPlace, ou connus dès le départ. */
export const knownPlaces = (state, adv) => [...new Set([...knownAtStart(adv), ...(Array.isArray(state?.carte?.revealed) ? state.carte.revealed : [])])];

/** Suite des lieux traversés, dans l'ordre (d'après le journal), sans répétition immédiate. */
export function journey(state, adv) {
  const seen = new Set(Object.keys(state?.visited || {}));
  const out = [];
  for (const e of state?.log || []) {
    if (!seen.has(String(e.section))) continue; // paragraphe annulé par un retour en arrière
    const p = placeName(adv?.sections?.[e.section]?.place);
    if (p && out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

/** Lieu actuel : celui du paragraphe courant, sinon le dernier lieu traversé. { name, exact } ou null. */
export function currentPlace(state, adv) {
  const here = placeName(adv?.sections?.[state?.section]?.place);
  if (here) return { name: here, exact: true };
  const j = journey(state, adv);
  return j.length ? { name: j[j.length - 1], exact: false } : null;
}

/** Position d'un lieu sur la carte du monde, ou null s'il n'y est pas placé. */
export function placePos(adv, name) {
  const places = adv?.meta?.worldMap?.places || {};
  const n = placeName(name);
  const key = Object.keys(places).find(k => placeName(k) === n);
  const p = key !== undefined ? places[key] : null;
  return p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: clamp(p.x), y: clamp(p.y) } : null;
}

/** Un pion d'image (« images/pion.png ») plutôt qu'un émoji. */
export const isImagePath = v => typeof v === 'string' && /\.(png|jpe?g|webp|svg|gif)$/i.test(v.trim());

/** Cases du plateau (worldMap.path), en pourcentage de l'image ; [] sans chemin. Accepte [x, y] ou { x, y }. */
export function pathOf(adv) {
  const p = adv?.meta?.worldMap?.path;
  return (Array.isArray(p) ? p : []).map(q => (Array.isArray(q) ? { x: q[0], y: q[1] } : q))
    .filter(q => q && Number.isFinite(Number(q.x)) && Number.isFinite(Number(q.y))).map(q => ({ x: clamp(q.x), y: clamp(q.y) }));
}

/** Case d'arrêt d'un lieu sur le chemin : `places[lieu].case`, sinon la case la plus proche du lieu ; null sinon. */
export function placeCase(adv, name) {
  const path = pathOf(adv);
  if (!path.length) return null;
  const places = adv?.meta?.worldMap?.places || {};
  const n = placeName(name);
  const key = Object.keys(places).find(k => placeName(k) === n);
  if (key === undefined) return null;
  const c = Number(places[key]?.case);
  if (Number.isInteger(c) && c >= 0 && c < path.length) return c;
  const pos = placePos(adv, n);
  if (!pos) return null;
  let best = 0, d = Infinity;
  path.forEach((q, i) => { const e = (q.x - pos.x) ** 2 + (q.y - pos.y) ** 2; if (e < d) { d = e; best = i; } });
  return best;
}

/** Cases parcourues pour aller d'un lieu à l'autre (indices, départ et arrivée compris), ou null (pas de voyage). */
export function travelHops(adv, from, to) {
  const wm = adv?.meta?.worldMap;
  if (!wm?.travel || !wm.image) return null;
  const a = placeCase(adv, from), b = placeCase(adv, to);
  if (a === null || b === null || a === b) return null;
  const step = a < b ? 1 : -1, out = [];
  for (let i = a; i !== b + step; i += step) out.push(i);
  return out;
}

/**
 * Repères à afficher sur la carte du monde du joueur :
 * [{ name, x, y, status: 'here' | 'visited' | 'known' | 'unknown', approx? }].
 * Les lieux jamais visités ni révélés sont masqués, ou montrés comme « ? » si revealUnvisited.
 */
export function worldMarkers(state, adv) {
  const wm = adv?.meta?.worldMap;
  if (!wm) return [];
  const visited = new Set(visitedPlaces(state, adv));
  const known = new Set(knownPlaces(state, adv).map(placeName));
  const here = currentPlace(state, adv);
  const out = [];
  for (const raw of Object.keys(wm.places || {})) {
    const name = placeName(raw);
    const pos = placePos(adv, name);
    if (!name || !pos) continue;
    const status = here?.name === name ? 'here' : visited.has(name) ? 'visited' : known.has(name) ? 'known' : wm.revealUnvisited ? 'unknown' : null;
    if (!status) continue;
    out.push({ name, ...pos, status, ...(status === 'here' && !here.exact ? { approx: true } : {}) });
  }
  return out;
}

/**
 * Ce que réserve un paragraphe (carte du monde en mode triche) : { combats: [noms des adversaires], items: [ids] }.
 * Les objets sont ceux que donne un effet « give » à l'entrée, dans un bloc (réussite d'un défi, zone de carte…) ou
 * dans un choix. Passer l'aventure du mode joué : variantes appliquées, blocs et choix des autres modes retirés.
 */
export function sectionStakes(adv, id) {
  const s = adv?.sections?.[id];
  const out = { combats: [], items: [] };
  if (!s) return out;
  for (const b of s.blocks || []) if (b?.type === 'combat') out.combats.push(...(b.enemies || []).map(e => e?.name).filter(Boolean));
  const walk = o => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.op === 'give' && o.item && !out.items.includes(o.item)) out.items.push(o.item);
    Object.values(o).forEach(walk);
  };
  walk([s.onEnter, s.blocks, s.choices]);
  return out;
}

/** Points du chemin parcouru (lieux placés sur la carte, dans l'ordre du voyage). */
export function journeyPoints(state, adv) {
  const out = [];
  for (const name of journey(state, adv)) {
    const p = placePos(adv, name);
    if (p) out.push({ name, ...p });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Vérifications partagées                                             */
/* ------------------------------------------------------------------ */

function walkCond(c, adv, report, where) {
  if (!c || typeof c !== 'object') return;
  (c.all || c.any || []).forEach(x => walkCond(x, adv, report, where));
  if (c.not) walkCond(c.not, adv, report, where);
  if (c.has && !adv.items?.[c.has]) report('warning', `${where} : l'objet « ${c.has} » n'est pas dans la liste des objets.`);
  if (c.visited && !adv.sections?.[c.visited]) report('error', `${where} : la condition cite le paragraphe ${c.visited}, qui n'existe pas.`);
  if (c.stat && !adv.rules?.stats?.find(s => s.id === c.stat)) report('error', `${where} : caractéristique inconnue « ${c.stat} ».`);
  findCondition(c)?.validate?.(c, adv, report, where);
}

function walkEffects(list, adv, report, where) {
  (list || []).forEach(e => {
    if (e.item && !adv.items?.[e.item]) report('warning', `${where} : l'objet « ${e.item} » n'est pas dans la liste des objets.`);
    if (e.stat && !adv.rules?.stats?.find(s => s.id === e.stat)) report('error', `${where} : caractéristique inconnue « ${e.stat} ».`);
    walkCond(e.if, adv, report, where);
    ext.effects.get(e.op)?.validate?.(e, adv, report, where);
  });
}

/** « Le marais » → « le marais » au milieu d'une phrase (les noms propres ne sont pas touchés). */
export const midSentence = s => String(s ?? '').replace(/^(?:(Le|La|Les|Un|Une|Des|Du|Au|Aux)(?=\s)|L(?=['’]))/, m => m.toLowerCase());

const zoneName = (h, j) => (h?.label?.trim() ? `la zone « ${h.label.trim()} »` : `la zone n°${j + 1}`);
const placeUsed = (adv, p) => placesOf(adv).some(x => x.name === placeName(p));

/* ------------------------------------------------------------------ */
/* Enregistrement dans le moteur                                       */
/* ------------------------------------------------------------------ */

registerBlock(TYPE, {
  targets: b => (b.hotspots || []).map((h, j) => ({ to: h.to, kind: 'map', label: h.label || `zone ${j + 1}`, ref: ['hotspots', j] })),

  remap(b, m, remapCond) {
    return {
      ...b,
      hotspots: (b.hotspots || []).map(h => {
        const x = { ...h, to: m(h.to) };
        if (h.if) x.if = remapCond(h.if);
        if (h.effects) x.effects = h.effects.map(e => (e.if ? { ...e, if: remapCond(e.if) } : e));
        return x;
      }),
    };
  },

  validate(b, adv, report, where) {
    if (!b.image) report('warning', `${where} : la carte n'a pas d'image (les zones ne seront proposées que sous forme de liste).`);
    else if (!String(b.alt || '').trim()) report('info', `${where} : décrivez l'image de la carte (lecture à voix haute, lecteurs d'écran).`);
    const hs = b.hotspots || [];
    if (!hs.length) report('error', `${where} : aucune zone cliquable sur la carte.`);
    hs.forEach((h, j) => {
      const name = zoneName(h, j);
      if (!h.to) report('error', `${where} : ${name} n'a pas de destination.`);
      if (!String(h.label || '').trim()) report('warning', `${where} : la zone n°${j + 1} n'a pas d'étiquette (le joueur ne saura pas où elle mène).`);
      const r = [h.x, h.y, h.w, h.h].map(Number);
      if (r.some(v => !Number.isFinite(v)) || r[2] <= 0 || r[3] <= 0) report('error', `${where} : ${name} n'a pas de dimensions valides.`);
      else if (r[0] < 0 || r[1] < 0 || r[0] + r[2] > 100.05 || r[1] + r[3] > 100.05) report('warning', `${where} : ${name} dépasse du bord de l'image.`);
      walkCond(h.if, adv, report, `${where}, ${name}`);
      walkEffects(h.effects, adv, report, `${where}, ${name}`);
    });
  },

  print(b, adv, h) {
    const hs = b.hotspots || [];
    const zones = hs.map((z, j) => {
      const r = rectOf(z);
      return `<span class="carte-pr-zone" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%"><span>${h.esc(z.label || String(j + 1))}</span></span>`;
    }).join('');
    const fig = b.image
      ? `<figure class="carte-pr-fig"><span class="carte-pr-frame"><lh-carte-img data-adv="${h.esc(adv.id)}" data-path="${h.esc(b.image)}" data-alt="${h.esc(b.alt || '')}"></lh-carte-img>${zones}</span></figure>`
      : '';
    const items = hs.filter(z => z.to).map(z => {
      const dest = `pour aller vers ${h.esc(midSentence(z.label) || 'cette destination')}, ${h.go(z.to)}.`;
      const line = z.if ? `<i>Si ${h.esc(h.condText(z.if, adv))}</i> — ${dest}` : dest.charAt(0).toUpperCase() + dest.slice(1);
      const fx = (z.effects || []).map(e => h.effectText(e, adv)).filter(Boolean);
      return `<li>${line}${fx.length ? ` <span class="pr-small">(${h.esc(fx.join(' '))})</span>` : ''}</li>`;
    }).join('');
    return `<div class="pr-block carte-pr">${b.label ? `<p><b>${h.esc(b.label)}</b></p>` : ''}${fig}<ul class="pr-choices">${items}</ul></div>`;
  },
});

registerNormalize(adv => {
  const wm = adv.meta?.worldMap;
  if (wm && typeof wm === 'object') adv.meta.worldMap = { image: null, revealUnvisited: false, ...wm, places: { ...(wm.places || {}) } };
});

registerHeroInit(state => { state.carte = { revealed: [] }; });

registerEffect('revealPlace', {
  apply(s, e, adv, messages) {
    const p = placeName(e.place);
    if (!p) return;
    const rev = Array.isArray(s.carte?.revealed) ? s.carte.revealed : [];
    if (rev.includes(p)) return;
    s.carte = { ...(s.carte || {}), revealed: [...rev, p] };
    if (!visitedPlaces(s, adv).includes(p)) messages.push({ kind: 'info', text: `Nouveau lieu sur votre carte du monde : ${p}` });
  },
  describe: e => `révèle « ${placeName(e.place)} » sur la carte du monde`,
  print: e => `notez sur votre Feuille d'Aventure le lieu « ${placeName(e.place)} » : vous savez désormais où il se trouve.`,
  validate(e, adv, report, where) {
    const p = placeName(e.place);
    if (!p) report('error', `${where} : le lieu à révéler n'est pas précisé.`);
    else if (!placeUsed(adv, p)) report('warning', `${where} : aucun paragraphe n'a pour lieu « ${p} ».`);
    else if (adv.meta?.worldMap && !placePos(adv, p)) report('info', `${where} : « ${p} » n'est pas encore placé sur la carte du monde.`);
  },
});

const COND_KEYS = ['placeVisited', 'placeNotVisited', 'placeKnown'];
const condPlace = c => placeName(c.placeVisited ?? c.placeNotVisited ?? c.placeKnown);

registerCondition({
  id: 'carte-lieu',
  match: c => COND_KEYS.some(k => k in c),
  check(c, state, adv) {
    const p = condPlace(c);
    const v = visitedPlaces(state, adv).includes(p);
    if ('placeVisited' in c) return v;
    if ('placeNotVisited' in c) return !v;
    return v || knownPlaces(state, adv).map(placeName).includes(p);
  },
  describe(c) {
    const p = condPlace(c);
    if ('placeVisited' in c) return `être déjà allé à « ${p} »`;
    if ('placeNotVisited' in c) return `ne jamais être allé à « ${p} »`;
    return `connaître l'emplacement de « ${p} »`;
  },
  print(c) {
    const p = condPlace(c);
    if ('placeVisited' in c) return `vous êtes déjà allé à « ${p} »`;
    if ('placeNotVisited' in c) return `vous n'êtes jamais allé à « ${p} »`;
    return `vous connaissez l'emplacement de « ${p} » (noté sur votre Feuille d'Aventure, ou lieu déjà visité)`;
  },
  validate(c, adv, report, where) {
    const p = condPlace(c);
    if (!p) report('error', `${where} : la condition de lieu ne précise pas le lieu.`);
    else if (!placeUsed(adv, p)) report('warning', `${where} : aucun paragraphe n'a pour lieu « ${p} ».`);
  },
});

registerAssets(adv => [
  adv.meta?.worldMap?.image,
  ...[adv.meta?.worldMap?.travel?.token].filter(isImagePath),
  ...Object.values(adv.sections || {}).flatMap(s => (s.blocks || []).filter(b => b.type === TYPE).map(b => b.image)),
]);
