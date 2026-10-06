// Combat façon Défis Fantastiques.
// Assaut : Force d'Attaque = 2d6 + Habileté (+ modificateurs). La plus forte blesse l'autre.
// Après un assaut, on peut Tenter sa Chance pour moduler les dégâts.

import { makeRng, roll } from './dice.js';
import { checkDeath, statLabel } from './rules.js';
import { ext, sumCombat } from './plugins.js';

/**
 * Vocabulaire du combat : `rules.combat.words` remplace tout ou partie de ces libellés (un mode peut le faire
 * aussi, ex. « duel de courage » pour les petits : personne n'est blessé, l'adversaire recule).
 * Repères remplacés : {name} adversaire, {n} points, {stat} caractéristique de vie, {round}, {me}, {foe}, {txt}, {total}.
 */
export const COMBAT_WORDS = {
  title: 'Combat', round: 'assaut {round}', start: 'Combattre', attack: 'Assaut', auto: 'Combat automatique',
  flee: 'Fuir', luck: 'Tenter sa Chance', you: 'Vous', versus: 'contre {name}',
  together: 'Ils vous attaquent tous en même temps.', sequential: 'Vous les affrontez l’un après l’autre.',
  target: 'Choisissez votre cible (cadre épais). Les autres adversaires attaquent aussi : vous ne faites que parer leurs coups.',
  hit: 'Touché ! −{n}', wounded: 'Blessé −{n}', draw: 'Égalité', parry: 'Paré', harmless: 'Touché, sans blessure',
  win: 'Vous avez gagné le combat.', lose: 'Vous avez perdu le combat.', fled: 'Vous avez pris la fuite.',
  foeHealth: '', down: '{name} est vaincu.', spare: '{name} renonce au combat.', death: 'Vous avez succombé au combat.',
  logRound: 'Assaut {round} — vous {me} contre {name} {foe} : {txt}.',
  logHit: 'vous blessez {name} (−{n})', logWounded: '{name} vous blesse (−{n} {stat})', logDraw: 'vous esquivez tous les deux',
  logParry: 'vous parez l\'attaque de {name}', logHarmless: '{name} vous touche sans vous blesser',
  logFlee: 'Vous prenez la fuite (−{n} {stat}).',
  logLuckyHit: 'Chanceux ({total}) : blessure grave, {name} perd 2 points de plus.',
  logUnluckyHit: 'Malchanceux ({total}) : simple égratignure, {name} récupère 1 point.',
  logLuckyWound: 'Chanceux ({total}) : vous amortissez le coup, +1 {stat}.',
  logUnluckyWound: 'Malchanceux ({total}) : le coup est plus grave, −1 {stat}.',
};

/** Libellés du combat pour cette aventure (et ce mode), complétés par les valeurs par défaut. */
export function combatWords(adv) {
  const w = adv?.rules?.combat?.words;
  return { ...COMBAT_WORDS, ...(w && typeof w === 'object' ? Object.fromEntries(Object.entries(w).filter(([, v]) => typeof v === 'string' && v !== '')) : {}) };
}

/** Remplace les repères {clé} d'un libellé. */
export const fillWords = (txt, vars = {}) => String(txt).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/** Démarre le combat du bloc `blockIndex` du paragraphe courant. */
/** Dégâts saisis : 0 est une vraie valeur (adversaire inoffensif) ; vide ou absent = valeur par défaut. */
const dmgOf = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));

export function startCombat(state, adv, blockIndex) {
  const block = adv.sections[state.section].blocks[blockIndex];
  const ruleDamage = dmgOf(adv.rules.combat.damage) ?? 2;
  const s = structuredClone(state);
  s.combat = {
    block: blockIndex,
    mode: block.mode === 'together' ? 'together' : 'sequential',
    enemies: (block.enemies || []).map((e, i) => ({
      id: i, name: e.name || `Adversaire ${i + 1}`, image: e.image || null,
      skill: Number(e.skill) || 0, health: Number(e.health) || 1, max: Number(e.health) || 1,
      damage: dmgOf(e.damage) ?? ruleDamage, attackMod: Number(e.attackMod || 0),
    })),
    target: 0,
    round: 0,
    playerMod: Number(block.attackMod || 0),
    playerDamage: dmgOf(block.damage) ?? ruleDamage,
    last: null,        // dernier assaut, pour l'affichage et la Chance
    canLuck: false,
    log: [],
    over: null,        // 'win' | 'lose' | 'flee'
    fleeAfter: Number(block.fleeAfter || 0),
    stopAt: Number(block.stopAt || 0), // combat jusqu'à ce que l'adversaire tombe à N (ex. 3 : on l'épargne)
  };
  return s;
}

const alive = c => c.enemies.filter(e => e.health > c.stopAt);

/** Joue un assaut. */
export function attackRound(state, adv) {
  if (!state.combat || state.combat.over) return state;
  const rng = makeRng(state.rng);
  const s = structuredClone(state);
  const c = s.combat;
  const skillId = adv.rules.combat.skill, hpId = adv.rules.combat.health;
  const me = s.stats[skillId].cur;
  const living = alive(c);
  if (!living.length) { c.over = 'win'; return s; }
  if (c.mode === 'sequential' || !living.find(e => e.id === c.target)) c.target = living[0].id;
  c.round += 1;
  const lines = [];
  let wounded = false, hit = null;

  // Le joueur contre sa cible, puis (combat simultané) contre chaque autre adversaire qui ne fait que se défendre.
  const opponents = c.mode === 'together' ? living : [living[0]];
  const exchanges = [];
  // Modificateurs apportés par les greffons (équipement, compagnons…), recalculés à chaque assaut.
  const mods = { attack: sumCombat('attackMod', s, adv, c), damage: sumCombat('damageMod', s, adv, c), armor: sumCombat('armor', s, adv, c) };
  const dealt = Math.max(1, c.playerDamage + mods.damage);
  for (const e of opponents) {
    const pr = roll('2d6', rng), er = roll('2d6', rng);
    const pa = pr.total + me + c.playerMod + mods.attack, ea = er.total + e.skill + e.attackMod;
    const taken = e.damage > 0 ? Math.max(1, e.damage - mods.armor) : 0;
    const isTarget = e.id === c.target;
    let outcome;
    if (pa > ea) {
      if (isTarget) { e.health = Math.max(0, e.health - dealt); outcome = 'hit'; hit = e.id; }
      else outcome = 'parry';
    } else if (ea > pa && taken > 0) {
      s.stats[hpId].cur = Math.max(0, s.stats[hpId].cur - taken); outcome = 'wounded'; wounded = true;
    } else if (ea > pa) outcome = 'harmless'; // adversaire à 0 dégât : il touche sans blesser (pas de Chance à tenter)
    else outcome = 'draw';
    exchanges.push({ enemy: e.id, name: e.name, player: { dice: pr.dice, total: pa }, foe: { dice: er.dice, total: ea }, outcome, damage: outcome === 'wounded' ? taken : outcome === 'hit' ? dealt : 0 });
    const W = combatWords(adv), v = { name: e.name, stat: statLabel(adv, hpId) };
    const txt = { hit: fillWords(W.logHit, { ...v, n: dealt }), wounded: fillWords(W.logWounded, { ...v, n: taken }), draw: fillWords(W.logDraw, v), parry: fillWords(W.logParry, v), harmless: fillWords(W.logHarmless, v) }[outcome];
    lines.push(fillWords(W.logRound, { ...v, round: c.round, me: pa, foe: ea, txt }));
  }
  c.last = { round: c.round, exchanges, luckUsed: false, mods, extra: [] };
  // Tour des greffons (ex. les compagnons frappent à leur tour) : ils peuvent modifier s, c, et ajouter des lignes.
  for (const h of ext.combat) h.round?.({ state: s, adv, combat: c, rng, lines, roll, target: c.enemies.find(x => x.id === c.target) });
  // Pas de Chance sur un adversaire déjà abattu (par le héros ou par un compagnon) : elle ne pourrait que le ranimer.
  const hitStanding = hit !== null && c.enemies[hit] && !c.enemies[hit].down && c.enemies[hit].health > c.stopAt;
  c.canLuck = !!(hitStanding || wounded);
  c.log = [...c.log, ...lines];
  settle(s, adv);
  s.rng = rng.state();
  return s;
}

/** Tenter sa Chance après un assaut (une seule fois par assaut). */
export function useLuck(state, adv) {
  const c0 = state.combat;
  if (!c0?.canLuck || c0.over) return state;
  const rng = makeRng(state.rng);
  const s = structuredClone(state);
  const c = s.combat;
  const luck = s.stats[adv.rules.combat.luck], hp = s.stats[adv.rules.combat.health];
  const r = roll('2d6', rng);
  const lucky = r.total <= luck.cur;
  luck.cur = Math.max(0, luck.cur - 1);
  const lines = [];
  const W = combatWords(adv), stat = statLabel(adv, adv.rules.combat.health);
  for (const ex of c.last.exchanges) {
    if (ex.outcome === 'hit') {
      const e = c.enemies[ex.enemy];
      if (!e || e.down || e.health <= c.stopAt) continue; // adversaire déjà vaincu : la Chance ne le concerne plus
      if (lucky) { e.health = Math.max(0, e.health - 2); lines.push(fillWords(W.logLuckyHit, { total: r.total, name: e.name })); }
      else { e.health = Math.min(e.max, e.health + 1); lines.push(fillWords(W.logUnluckyHit, { total: r.total, name: e.name })); }
    }
    if (ex.outcome === 'wounded') {
      if (lucky) { hp.cur = Math.min(hp.init, hp.cur + 1); lines.push(fillWords(W.logLuckyWound, { total: r.total, stat })); }
      else { hp.cur = Math.max(0, hp.cur - 1); lines.push(fillWords(W.logUnluckyWound, { total: r.total, stat })); }
    }
  }
  c.last.luckUsed = true;
  c.last.luck = { dice: r.dice, total: r.total, lucky };
  c.canLuck = false;
  c.log = [...c.log, ...lines];
  settle(s, adv);
  s.rng = rng.state();
  return s;
}

/** Prendre la fuite : l'adversaire porte un dernier coup. */
export function flee(state, adv) {
  const block = adv.sections[state.section].blocks[state.combat.block];
  if (!block.flee || state.combat.over) return state;
  if (state.combat.fleeAfter && state.combat.round < state.combat.fleeAfter) return state;
  const s = structuredClone(state);
  const dmg = Number(block.fleeDamage ?? adv.rules.combat.fleeDamage ?? 2);
  const hp = s.stats[adv.rules.combat.health];
  hp.cur = Math.max(0, hp.cur - dmg);
  s.combat.log = [...s.combat.log, fillWords(combatWords(adv).logFlee, { n: dmg, stat: statLabel(adv, adv.rules.combat.health) })];
  s.combat.over = 'flee';
  s.combat.canLuck = false;
  return checkDeath(s, adv);
}

/** Joue les assauts jusqu'à la fin, sans jamais utiliser la Chance. */
export function autoFight(state, adv, maxRounds = 200) {
  let s = state;
  for (let i = 0; i < maxRounds && s.combat && !s.combat.over; i++) s = attackRound(s, adv);
  return s;
}

function settle(s, adv) {
  const c = s.combat;
  const W = combatWords(adv);
  c.enemies.forEach(e => { if (e.health <= c.stopAt && !e.down) { e.down = true; c.log.push(fillWords(c.stopAt ? W.spare : W.down, { name: e.name })); } });
  if (s.stats[adv.rules.combat.health].cur <= 0) {
    c.over = 'lose'; c.canLuck = false;
    const block = adv.sections[s.section].blocks[c.block];
    if (!block.lose) { s.ended = 'death'; s.endReason = W.death; }
  } else if (!alive(c).length) { c.over = 'win'; }
  // Après victoire ou défaite, la Chance ne peut plus changer l'issue sauf si le dernier coup peut être amorti.
  if (c.over === 'win') c.canLuck = false;
}

/** Destination à la fin du combat. */
export function combatExit(state, adv) {
  const c = state.combat;
  if (!c?.over) return null;
  const block = adv.sections[state.section].blocks[c.block];
  return { win: block.win, flee: block.flee, lose: block.lose }[c.over] || null;
}

/** Probabilité de victoire estimée par simulation (aide pour l'auteur). */
export function estimateWinRate(adv, block, hero = { skill: 9, health: 20 }, runs = 2000) {
  let wins = 0;
  const fakeAdv = { ...adv, sections: { x: { blocks: [block], choices: [] } } };
  for (let i = 0; i < runs; i++) {
    let s = {
      section: 'x', rng: (i * 2654435761) >>> 0,
      stats: { [adv.rules.combat.skill]: { cur: hero.skill, init: hero.skill }, [adv.rules.combat.health]: { cur: hero.health, init: hero.health }, [adv.rules.combat.luck]: { cur: 9, init: 9 } },
    };
    s = startCombat(s, fakeAdv, 0);
    s = autoFight(s, fakeAdv);
    if (s.combat.over === 'win') wins++;
  }
  return wins / runs;
}
