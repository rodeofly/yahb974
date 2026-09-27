// Greffon « compagnons » — interface : feuille d'aventure, combat, éditeur, effets, conditions, impression.
// Le moteur (arrivée, départ, soins, combat) est dans ./core.js. Voir docs/plugins/compagnons.md.

import './core.js';
import { html, useState } from '../../lib/preact-htm.js';
import { Icon, AssetImg, confirmBox, loadCSS } from '../../ui/common.js';
import { registerSheetPanel, registerCombatPanel, registerEditorTab, registerEffectUI, registerConditionUI, registerPrintSection, registerEndingPanel } from '../../ui/registry.js';
import { Text, Num, Select, ImageSlot } from '../../ui/editor.js';
import { statLabel, slug } from '../../core/rules.js';
import { companionsOf, companionDamage, companionUsages, freeCompanionId, de } from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ------------------------------------------------------------------ */
/* Petits éléments communs                                             */
/* ------------------------------------------------------------------ */

// Icône « groupe » dessinée ici (pas d'émoji, pas de modification de common.js).
const GROUP = '<circle cx="9" cy="8" r="3.2"/><path d="M3 20.5a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.2 14.4A4.8 4.8 0 0 1 21.5 19"/>';
const GroupIcon = () => html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: GROUP }}></svg>`;

const SK = adv => statLabel(adv, adv.rules.combat.skill);
const HP = adv => statLabel(adv, adv.rules.combat.health);
const pct = (v, max) => Math.max(0, Math.min(100, (100 * v) / Math.max(1, max)));
/** État lisible sans couleur (noms, pas d'adjectif genré). */
const shape = (h, max) => (h >= max ? 'Indemne' : h * 3 <= max ? 'Blessures graves' : 'Blessures légères');
/**
 * Montrer les caractéristiques de combat des compagnons (habileté, santé, blessures, dégâts) ? Seulement si l'aventure
 * contient au moins un combat, sauf réglage explicite `rules.companionStats` (true / false). Sans combat, un compagnon
 * n'est qu'un portrait, un nom et une description.
 */
const statsCache = new WeakMap();
export function companionStats(adv) {
  const r = adv?.rules?.companionStats;
  if (typeof r === 'boolean') return r;
  if (!adv || typeof adv !== 'object') return true;
  if (!statsCache.has(adv)) {
    const hasCombat = Object.values(adv.sections || {}).some(sec => [sec, ...Object.values(sec?.variants || {})]
      .some(v => (v?.blocks || []).some(b => b?.type === 'combat')));
    statsCache.set(adv, hasCombat);
  }
  return statsCache.get(adv);
}
const optionsOf = adv => Object.entries(adv.companions || {}).map(([id, c]) => [id, c.name || id]);

/** Portrait carré ; l'initiale reste visible tant que l'image charge (ou s'il n'y en a pas). */
function Portrait({ adv, source, c, big }) {
  return html`<span class=${'cmp-portrait' + (big ? ' big' : '')} aria-hidden="true">
    <span class="cmp-initial">${(c.name || '?').trim().charAt(0).toUpperCase()}</span>
    ${c.image && html`<${AssetImg} adv=${adv} source=${source} path=${c.image} alt="" />`}
  </span>`;
}

function Bar({ adv, v, max, name }) {
  return html`<div class="bar me" role="img" aria-label=${`${HP(adv)} de ${name} : ${v} sur ${max}`}><span style=${`width:${pct(v, max)}%`}></span></div>`;
}

/* ------------------------------------------------------------------ */
/* Feuille d'aventure                                                  */
/* ------------------------------------------------------------------ */

function SheetPanel({ adv, source, state }) {
  if (!Object.keys(adv.companions || {}).length) return null;
  const list = companionsOf(state, adv);
  const stats = companionStats(adv);
  return html`<section class="stack cmp-sheet" style="gap:6px" aria-label="Compagnons">
    <span class="eyebrow cmp-eyebrow"><${GroupIcon} />Compagnons${list.length ? ` (${list.length})` : ''}</span>
    ${list.length ? html`<ul class="cmp-list">${list.map(c => html`<li class="cmp-card" key=${c.id}>
      <${Portrait} adv=${adv} source=${source} c=${c} />
      <div class="cmp-body">
        <div class="cmp-head"><b class="cmp-name">${c.name}</b>${stats && html`<span class="cmp-shape">${shape(c.health, c.max)}</span>`}</div>
        ${stats && html`<div class="statline"><span>${SK(adv)}</span><b class="mono">${c.skill}</b></div>
        <div class="statline"><span>${HP(adv)}</span><b class="mono cmp-hp">${c.health}<small> / ${c.max}</small></b></div>
        <${Bar} adv=${adv} v=${c.health} max=${c.max} name=${c.name} />
        <div class="statline subtle"><span>Dégâts infligés</span><b class="mono">${c.damage}</b></div>`}
        ${c.description && html`<p class="cmp-desc" lang="fr">${c.description}</p>`}
      </div>
    </li>`)}</ul>` : html`<span class="subtle">Personne ne vous accompagne pour l’instant.</span>`}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Combat                                                              */
/* ------------------------------------------------------------------ */

const OUTCOME = { hit: ['up', 'Touché'], wounded: ['down', 'Blessure'], parry: ['x', 'Paré'], draw: ['x', 'Égalité'] };

function CombatPanel({ adv, source, state, combat: c }) {
  const list = companionsOf(state, adv);
  const fallen = c.fallen || [];
  if (!list.length && !fallen.length) return null;
  const standing = c.enemies.filter(e => e.health > (c.stopAt || 0));
  const foe = standing.find(e => e.id === c.target) || standing[0];
  const lastOf = id => (c.last?.allies || []).find(x => x.id === id);
  return html`<div class="cmp-combat" role="group" aria-label="Vos compagnons dans ce combat">
    <span class="eyebrow cmp-eyebrow"><${GroupIcon} />À vos côtés</span>
    <div class="fighters">
      ${list.map(m => { const x = lastOf(m.id); return html`<div class="fighter cmp-ally" key=${m.id}>
        <span class="fname"><${Portrait} adv=${adv} source=${source} c=${m} />${m.name}</span>
        <span class="statline"><span>${SK(adv)}</span><b class="mono">${m.skill}</b></span>
        <span class="statline"><span>${HP(adv)}</span><b class="mono">${m.health} / ${m.max}</b></span>
        <${Bar} adv=${adv} v=${m.health} max=${m.max} name=${m.name} />
        ${x && html`<span class=${'cmp-last ' + x.outcome}><${Icon} name=${OUTCOME[x.outcome][0]} />${OUTCOME[x.outcome][1]}${x.damage ? ` −${x.damage}` : ''} · ${x.ally.total} contre ${x.foe.total}</span>`}
        ${!c.over && foe && html`<span class="subtle">Cible : ${foe.name}</span>`}
      </div>`; })}
      ${fallen.map(f => html`<div class="fighter cmp-ally cmp-fallen" key=${'f' + f.id}>
        <span class="fname"><${Icon} name="skull" /><s>${f.name}</s></span>
        <span class="subtle">Hors de combat : ne vous accompagne plus.</span>
      </div>`)}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Fin de partie                                                       */
/* ------------------------------------------------------------------ */

function EndingPanel({ adv, state }) {
  const list = companionsOf(state, adv);
  if (!list.length) return null;
  const stats = companionStats(adv);
  return html`<p class="cmp-ending"><${GroupIcon} /><span>À vos côtés jusqu’au bout : ${list.map((c, i) => html`${i ? (i === list.length - 1 ? ' et ' : ', ') : ''}<b>${c.name}</b>${stats ? ` (${c.health} / ${c.max})` : ''}`)}.</span></p>`;
}

/* ------------------------------------------------------------------ */
/* Éditeur : onglet Compagnons                                         */
/* ------------------------------------------------------------------ */

const KIND = { join: 'arrive', leave: 'part', heal: 'regagne des points', hurt: 'perd des points', condition: 'condition' };

function Usages({ adv, id, open }) {
  // Un bouton par paragraphe et par type d'usage, avec le nombre d'occurrences (deux choix du même paragraphe…).
  const uses = [];
  for (const u of companionUsages(adv, id)) {
    const same = uses.find(x => x.section === u.section && x.kind === u.kind && (x.section || x.where === u.where));
    if (same) { same.n += 1; same.where += ', ' + u.where; } else uses.push({ ...u, n: 1 });
  }
  if (!uses.length) return html`<p class="subtle" style="margin:0">Ce compagnon n’apparaît encore dans aucun paragraphe : ajoutez l’effet « Compagnon → se joint au héros » là où il rejoint le héros.</p>`;
  const joins = uses.some(u => u.kind === 'join');
  return html`<div class="stack" style="gap:4px">
    <span class="subtle">Utilisé dans l’aventure :</span>
    <div class="row cmp-uses">${uses.map(u => u.section
      ? html`<button type="button" class="btn small" onClick=${() => open(u.section)} title=${u.where} aria-label=${`Ouvrir le paragraphe ${u.section} (${KIND[u.kind] || u.kind}, ${u.where})`}><b class="mono">${u.section}</b> ${KIND[u.kind] || u.kind}${u.n > 1 ? ` ×${u.n}` : ''}</button>`
      : html`<span class="badge">${u.where} : ${KIND[u.kind] || u.kind}</span>`)}</div>
    ${!joins && html`<p class="subtle" style="margin:0">Attention : aucun paragraphe ne fait arriver ce compagnon.</p>`}
  </div>`;
}

function CompanionsTab({ adv, change, open }) {
  const [name, setName] = useState('');
  const list = Object.entries(adv.companions || {});
  const set = (id, patch) => change(a => { a.companions = { ...(a.companions || {}) }; a.companions[id] = { ...a.companions[id], ...patch }; return a; });
  const add = () => {
    const n = name.trim() || 'Compagnon';
    const id = freeCompanionId(adv, slug(n));
    change(a => { a.companions = { ...(a.companions || {}), [id]: { name: n, skill: 7, health: 8, damage: companionDamage(adv, {}), description: '', image: null } }; return a; });
    setName('');
  };
  const remove = async (id, c) => {
    const where = [...new Set(companionUsages(adv, id).map(u => u.section).filter(Boolean))];
    const msg = `Supprimer le compagnon « ${c.name || id} » ?${where.length ? ` Il est encore cité au${where.length > 1 ? 'x paragraphes' : ' paragraphe'} ${where.join(', ')} : ces effets et conditions seront signalés dans « Vérifier ».` : ''}`;
    if (await confirmBox(msg, 'Supprimer')) change(a => { a.companions = { ...(a.companions || {}) }; delete a.companions[id]; return a; });
  };
  return html`<div class="ed-form cmp-editor">
    <p class="muted" style="margin:0">Les compagnons voyagent aux côtés du héros. Créez-les ici, puis faites-les arriver ou partir avec l’effet
      « Compagnon » (à l’arrivée sur un paragraphe ou en faisant un choix). Pendant un combat, chacun frappe à son tour après l’assaut du héros :
      2 dés + son ${SK(adv)} contre 2 dés + l’${SK(adv)} de l’adversaire. La condition « est accompagné de » réserve des choix à ceux qui voyagent avec lui.</p>
    <form class="row" style="align-items:end" onSubmit=${e => { e.preventDefault(); add(); }}>
      <div style="flex:1;min-width:200px"><${Text} label="Nom du nouveau compagnon" value=${name} onChange=${setName} placeholder="Kaya" /></div>
      <button class="btn primary" type="submit"><${Icon} name="plus" />Ajouter</button>
    </form>
    ${!list.length && html`<p class="subtle" style="margin:0">Aucun compagnon pour l’instant.</p>`}
    ${list.map(([id, c]) => html`<section class="panel cmp-edit" key=${id} aria-label=${`Compagnon ${c.name || id}`}>
      <header><h3 class="cmp-eyebrow"><${GroupIcon} />${c.name || id} <span class="subtle mono">${id}</span></h3>
        <button type="button" class="btn small danger" onClick=${() => remove(id, c)}><${Icon} name="trash" />Supprimer</button></header>
      <div class="grid2">
        <${Text} label="Nom" value=${c.name} onChange=${v => set(id, { name: v })} />
        <${Num} label=${SK(adv)} value=${c.skill} min="0" onChange=${v => set(id, { skill: v })} />
        <${Num} label=${`${HP(adv)} de départ`} value=${c.health} min="1" onChange=${v => set(id, { health: v })} />
        <${Num} label="Dégâts infligés" value=${c.damage ?? companionDamage(adv, {})} min="0" onChange=${v => set(id, { damage: v })} />
      </div>
      <${Text} area rows="2" label="Description (sur la Feuille d’Aventure du joueur)" value=${c.description} onChange=${v => set(id, { description: v })} placeholder="Archère silencieuse, elle connaît les sentiers de la forêt." />
      <${ImageSlot} adv=${adv} path=${c.image} name=${'compagnon-' + id} label="Portrait" onChange=${p => set(id, { image: p })} />
      <${Usages} adv=${adv} id=${id} open=${open} />
    </section>`)}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Effet « Compagnon » et conditions dans l'éditeur                    */
/* ------------------------------------------------------------------ */

const NoCompanion = () => html`<span class="subtle">Créez d’abord un compagnon dans l’onglet Compagnons.</span>`;

function EffectFields({ e, upd, adv }) {
  const opts = optionsOf(adv);
  if (!opts.length) return html`<${NoCompanion} />`;
  const action = e.action || 'join';
  return html`
    <${Select} label="Compagnon" value=${e.companion} onChange=${v => upd({ companion: v })} options=${[['', '—'], ...opts]} />
    <${Select} label="Action" value=${action} onChange=${v => upd({ action: v, amount: undefined })}
      options=${[['join', 'se joint au héros'], ['leave', 'quitte le héros'], ['heal', `regagne ${de(HP(adv))}`], ['hurt', `perd ${de(HP(adv))}`]]} />
    ${action === 'join' && html`<${Num} label=${`${HP(adv)} à l’arrivée (vide = pleine)`} value=${e.amount} min="1" onChange=${n => upd({ amount: n })} />`}
    ${action === 'heal' && html`<${Num} label="Points rendus (vide = tous)" value=${e.amount} min="0" onChange=${n => upd({ amount: n })} />`}
    ${action === 'hurt' && html`<${Num} label="Points perdus" value=${e.amount ?? 2} min="0" onChange=${n => upd({ amount: n })} />`}`;
}

function CompanionPick({ row, upd, adv }) {
  const opts = optionsOf(adv);
  if (!opts.length) return html`<${NoCompanion} />`;
  return html`<${Select} label="Compagnon" value=${row.v} onChange=${v => upd({ v })} options=${[['', '—'], ...opts]} />`;
}

const isObj = c => !!c && typeof c === 'object' && !Array.isArray(c);

registerEffectUI('companion', {
  label: 'Compagnon',
  order: 30,
  blank: adv => ({ op: 'companion', companion: Object.keys(adv.companions || {})[0] || '', action: 'join' }),
  Fields: EffectFields,
});

registerConditionUI({
  t: 'companion', label: 'est accompagné de', order: 30,
  match: c => (isObj(c) && 'companion' in c ? { v: c.companion } : null),
  toCond: r => ({ companion: r.v || '' }),
  blank: adv => ({ v: Object.keys(adv.companions || {})[0] || '' }),
  Fields: CompanionPick,
});

registerConditionUI({
  t: 'notcompanion', label: 'n’est pas accompagné de', order: 31,
  match: c => (isObj(c) && isObj(c.not) && Object.keys(c).length === 1 && 'companion' in c.not ? { v: c.not.companion } : null),
  toCond: r => ({ not: { companion: r.v || '' } }),
  blank: adv => ({ v: Object.keys(adv.companions || {})[0] || '' }),
  Fields: CompanionPick,
});

registerConditionUI({
  t: 'companions', label: 'nombre de compagnons ≥', order: 32,
  match: c => (isObj(c) && 'companions' in c ? { n: c.gte ?? (typeof c.companions === 'number' ? c.companions : 1) } : null),
  toCond: r => ({ companions: true, gte: r.n ?? 1 }),
  blank: () => ({ n: 1 }),
  Fields: ({ row, upd }) => html`<${Num} label="Au moins" value=${row.n} min="0" onChange=${n => upd({ n })} />`,
});

/* ------------------------------------------------------------------ */
/* Version imprimable                                                  */
/* ------------------------------------------------------------------ */

function PrintRules({ adv }) {
  if (!Object.keys(adv.companions || {}).length) return null;
  const S = SK(adv).toUpperCase(), H = HP(adv).toUpperCase();
  if (!companionStats(adv)) return html`<div class="cmp-print">
    <h3>Vos compagnons</h3>
    <p>Au fil de l'aventure, des compagnons peuvent se joindre à vous, puis vous quitter. Notez leur nom dans la case Compagnons de votre Feuille d'Aventure, et rayez-le quand ils partent.</p>
  </div>`;
  return html`<div class="cmp-print">
    <h3>Vos compagnons</h3>
    <p>Au fil de l'aventure, des compagnons peuvent se joindre à vous. Notez chacun d'eux dans la case Compagnons de votre Feuille d'Aventure,
      avec son ${S}, son ${H} et ses dégâts. Un compagnon ne peut pas dépasser son total de départ ${de(H)}.</p>
    <p>Pendant un combat, après chacun de vos Assauts, chaque compagnon attaque à son tour votre adversaire (s'il vient d'être vaincu, le suivant) :
      lancez deux dés pour le compagnon et ajoutez son ${S}, puis deux dés pour l'adversaire et ajoutez le sien. Si le compagnon l'emporte,
      l'adversaire perd autant de points ${de(H)} que les dégâts du compagnon ; si l'adversaire l'emporte, le compagnon perd les points que
      l'adversaire inflige d'habitude. En cas d'égalité, personne n'est touché. Un adversaire vaincu par un compagnon compte comme une victoire.</p>
    <p>Un compagnon qui n’a plus aucun point ${de(H)} est mort : rayez son nom. Votre Chance ne s'applique qu'à vos propres Assauts.</p>
  </div>`;
}

function PrintSheet({ adv }) {
  const n = Object.keys(adv.companions || {}).length;
  if (!n) return null;
  const rows = Math.min(6, Math.max(3, n));
  if (!companionStats(adv)) return html`<div class="pr-box pr-wide cmp-pr-box"><b>COMPAGNONS</b>
    <table class="cmp-pr-table"><thead><tr><th>Nom</th></tr></thead>
      <tbody>${Array.from({ length: rows }, () => html`<tr><td></td></tr>`)}</tbody></table>
  </div>`;
  return html`<div class="pr-box pr-wide cmp-pr-box"><b>COMPAGNONS</b>
    <table class="cmp-pr-table"><thead><tr><th>Nom</th><th>${SK(adv).toUpperCase()}</th><th>${HP(adv).toUpperCase()} (départ / actuelle)</th><th>Dégâts</th></tr></thead>
      <tbody>${Array.from({ length: rows }, () => html`<tr><td></td><td></td><td></td><td></td></tr>`)}</tbody></table>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

registerSheetPanel({ id: 'compagnons', order: 30, Panel: SheetPanel });
registerCombatPanel({ id: 'compagnons', order: 30, Panel: CombatPanel });
registerEndingPanel({ id: 'compagnons', order: 30, Panel: EndingPanel });
registerEditorTab({ id: 'compagnons', order: 30, label: adv => `Compagnons${Object.keys(adv.companions || {}).length ? ` (${Object.keys(adv.companions).length})` : ''}`, Tab: CompanionsTab });
registerPrintSection({ where: 'rules', order: 30, Section: PrintRules });
registerPrintSection({ where: 'sheet', order: 30, Section: PrintSheet });
