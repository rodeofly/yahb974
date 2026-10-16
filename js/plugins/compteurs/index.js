// Greffon « compteurs » — interface : Feuille d'Aventure, onglet Règles, effets, conditions,
// création du héros, écran de fin et version imprimable. Voir docs/plugins/compteurs.md.

import { html, useState, useRef, useEffect } from '../../lib/preact-htm.js';
import { Icon, loadCSS, confirmBox, toast } from '../../ui/common.js';
import { Text, Num, Select } from '../../ui/editor.js';
import {
  registerSheetPanel, registerRulesSection, registerEffectUI, registerConditionUI,
  registerPrintSection, registerCreatorPanel, registerEndingPanel, registerGroupPanel,
} from '../../ui/registry.js';
import { applyEffects } from '../../core/rules.js';
import { isDice, range } from '../../core/dice.js';
import * as K from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ------------------------------------------------------------------ */
/* Icônes                                                              */
/* ------------------------------------------------------------------ */

// Icônes déjà dessinées dans common.js, et quelques tracés propres au greffon.
const CORE_ICONS = new Set(['heart', 'star', 'sun', 'moon', 'flag', 'skull', 'crown', 'clover', 'coin', 'book', 'sword', 'lock']);
const OWN = {
  tally: '<path d="M6 5v14M10 5v14M14 5v14M18 5v14M3 17L21 7"/>',
  hourglass: '<path d="M6 3h12M6 21h12"/><path d="M7 3v3l5 6 5-6V3M7 21v-3l5-6 5 6v3"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
  flame: '<path d="M12 21c-4 0-7-2.7-7-6.5 0-3.5 3-5.5 4-9 2 1.5 3 3 3 5 1-1 1.5-2 1.5-3.5 3 2 5.5 5 5.5 7.5 0 3.8-3 6.5-7 6.5z"/>',
};
const ICONS = [['tally', 'Bâtons (par défaut)'], ['heart', 'Cœur'], ['star', 'Étoile'], ['sun', 'Soleil'], ['moon', 'Lune'], ['flag', 'Drapeau'],
  ['hourglass', 'Sablier'], ['eye', 'Œil'], ['shield', 'Bouclier'], ['flame', 'Flamme'], ['skull', 'Crâne'], ['crown', 'Couronne'],
  ['clover', 'Trèfle'], ['coin', 'Pièce'], ['book', 'Livre'], ['sword', 'Épée'], ['lock', 'Cadenas']];

function CIcon({ name, title }) {
  if (CORE_ICONS.has(name)) return html`<${Icon} name=${name} title=${title} />`;
  const d = OWN[name] || OWN.tally;
  return html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined} dangerouslySetInnerHTML=${{ __html: (title ? `<title>${title}</title>` : '') + d }}></svg>`;
}

/* ------------------------------------------------------------------ */
/* Petits textes partagés                                              */
/* ------------------------------------------------------------------ */

const bound = v => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const isTestRun = () => /[?&]test=1/.test(location.hash);
const endsOf = c => (c.triggers || []).filter(t => t.action === 'death' || t.action === 'victory');
const whenText = t => (t.when === 'lte' ? `à ${t.value} ou moins` : `à ${t.value} ou plus`);
const startLabel = c => (K.startIsFixed(c) ? String(Number(c.start ?? 0)) : String(c.start));

/* ------------------------------------------------------------------ */
/* Feuille d'Aventure                                                  */
/* ------------------------------------------------------------------ */

function SheetPanel({ adv, state, update }) {
  const test = isTestRun();
  const list = K.countersOf(adv).filter(c => c.id && (K.isVisible(c) || test));
  const values = Object.fromEntries(list.map(c => [c.id, K.counterValue(state, adv, c.id)]));
  const prev = useRef(null);
  const changed = {};
  if (prev.current) for (const id in values) if (id in prev.current && prev.current[id] !== values[id]) changed[id] = true;
  useEffect(() => { prev.current = values; });
  if (!list.length) return null;
  const bump = (c, n) => { const r = applyEffects(state, adv, [{ op: 'counter', counter: c.id, add: n }]); update(r.state, r.messages); };
  // Hors mode test, les compteurs rangés en lignes et colonnes s'affichent en tableau ; en mode test, tous en liste (boutons ±1).
  const { tables, rest } = test ? { tables: [], rest: list } : K.counterTables(list);
  return html`<div class="stack cpt-sheet" style="gap:6px">
    <span class="eyebrow">Compteurs</span>
    ${tables.map(tb => html`<${CounterTable} tb=${tb} value=${c => values[c.id]} changed=${changed} />`)}
    ${rest.length > 0 && html`<div class="stats">${rest.map(c => {
      const v = values[c.id];
      const min = bound(c.min) ?? 0, max = bound(c.max);
      const pct = max !== null && max > min ? Math.max(0, Math.min(100, (100 * (v - min)) / (max - min))) : null;
      const ends = endsOf(c);
      return html`<div class=${'stat cpt' + (changed[c.id] ? ' flash' : '') + (K.isVisible(c) ? '' : ' cpt-hidden')} key=${c.id}>
        <span class="label"><${CIcon} name=${c.icon} />${c.label || c.id}${!K.isVisible(c) && html` <span class="cpt-secret">secret</span>`}</span>
        <span class="val" key=${'v' + v}>${v}${max !== null && html`<small> / ${max}</small>`}</span>
        ${pct !== null && html`<div class="bar cpt-bar" role="img" aria-label=${`${c.label || c.id} : ${v} sur ${max}`}><span style=${`width:${pct}%`}></span></div>`}
        ${ends.length > 0 && html`<span class="cpt-ends">${ends.map(t => html`<span><${Icon} name=${t.action === 'death' ? 'skull' : 'crown'} />${t.action === 'death' ? 'Mort' : 'Victoire'} ${whenText(t)}</span>`)}</span>`}
        ${test && !state.ended && html`<span class="cpt-test">
          <span class="subtle">Test :</span>
          <button class="btn small" aria-label=${`Retirer 1 point ${K.de(c.label || c.id)} (mode test)`} onClick=${() => bump(c, -1)}>−1</button>
          <button class="btn small" aria-label=${`Ajouter 1 point ${K.de(c.label || c.id)} (mode test)`} onClick=${() => bump(c, 1)}>+1</button>
        </span>`}
      </div>`;
    })}</div>`}
  </div>`;
}

/** Tableau de compteurs (lignes × colonnes) : en-têtes avec l'icône de la colonne, cellule vide s'il n'y a pas de compteur. */
function CounterTable({ tb, value, changed = {} }) {
  return html`<div class="cpt-table-wrap"><table class="cpt-table">
    ${tb.title && html`<caption>${tb.title}</caption>`}
    <thead><tr><td></td>${tb.columns.map(k => html`<th scope="col"><span class="cpt-th"><${CIcon} name=${k.icon} />${k.label}</span></th>`)}</tr></thead>
    <tbody>${tb.rows.map(r => html`<tr><th scope="row">${r}</th>${tb.columns.map(k => {
      const c = tb.cell(r, k.label);
      return html`<td class=${changed[c?.id] ? 'flash' : ''} key=${c ? c.id + value(c) : k.label}>${c ? html`<span class="mono" aria-label=${`${c.label || c.id} : ${value(c)}`}>${value(c)}</span>` : html`<span class="subtle" aria-hidden="true">·</span>`}</td>`;
    })}</tr>`)}</tbody>
  </table></div>`;
}

registerSheetPanel({ id: 'compteurs', order: 20, Panel: SheetPanel });

/** Sous les onglets de la saisie : les compteurs de l'élève choisi (ceux dont la ligne est son nom). */
function GroupCounters({ adv, state, group }) {
  const list = K.countersOf(adv).filter(c => c.id && K.isVisible(c) && c.row === group);
  if (!list.length) return null;
  return html`<p class="cpt-group" aria-label=${`Compteurs de ${group}`}>
    ${list.map(c => html`<span class="cpt-chip" key=${c.id + K.counterValue(state, adv, c.id)}><${CIcon} name=${c.icon} />${c.column || c.label}<b class="mono">${K.counterValue(state, adv, c.id)}</b></span>`)}
  </p>`;
}
registerGroupPanel({ id: 'compteurs', order: 10, Panel: GroupCounters });

/* ------------------------------------------------------------------ */
/* Création du héros et écran de fin                                   */
/* ------------------------------------------------------------------ */

function CreatorPanel({ adv, hero }) {
  const list = K.countersOf(adv).filter(c => c.id && K.isVisible(c));
  if (!list.length) return null;
  const { tables, rest } = K.counterTables(list);
  const startOf = c => (hero ? hero.state.counters?.[c.id] ?? '—' : K.startIsFixed(c) ? K.clamp(c, Number(c.start ?? 0)) : '—');
  return html`<div class="stack" style="gap:8px">
    <span class="eyebrow">Compteurs</span>
    ${tables.map(tb => html`<${CounterTable} tb=${tb} value=${startOf} />`)}
    ${rest.length > 0 && html`<div class="rolls">${rest.map(c => html`<div class="rollrow" key=${c.id}>
      <b class="cpt-name"><${CIcon} name=${c.icon} />${c.label || c.id}</b>
      <span class="formula">${startLabel(c)}</span>
      ${hero ? html`<span class="dice-total">${hero.state.counters?.[c.id] ?? '—'}</span>`
        : K.startIsFixed(c) ? html`<span class="dice-total">${K.clamp(c, Number(c.start ?? 0))}</span>` : html`<span class="muted">—</span>`}
    </div>`)}</div>`}
  </div>`;
}

registerCreatorPanel({ id: 'compteurs', order: 20, Panel: CreatorPanel });

function EndingPanel({ adv, state }) {
  const list = K.countersOf(adv).filter(c => c.id && K.isVisible(c));
  if (!list.length) return null;
  const { tables, rest } = K.counterTables(list);
  return html`<div class="stack" style="gap:8px;align-items:center">
    ${tables.map(tb => html`<${CounterTable} tb=${tb} value=${c => K.counterValue(state, adv, c.id)} />`)}
    ${rest.length > 0 && html`<div class="cpt-final" aria-label="Compteurs en fin de partie">
      ${rest.map(c => html`<span class="pill cpt-pill"><${CIcon} name=${c.icon} />${c.label || c.id} : ${K.counterValue(state, adv, c.id)}</span>`)}
    </div>`}
  </div>`;
}

registerEndingPanel({ id: 'compteurs', order: 20, Panel: EndingPanel });

/* ------------------------------------------------------------------ */
/* Onglet Règles                                                       */
/* ------------------------------------------------------------------ */

const PRESETS = [
  { label: 'Réputation', start: 0, min: 0, max: 10, icon: 'star', triggers: [] },
  { label: 'Temps', start: 12, min: 0, icon: 'hourglass', triggers: [{ when: 'lte', value: 0, action: 'death', message: 'Le temps est écoulé : vous arrivez trop tard.' }] },
  { label: 'Malédiction', start: 0, min: 0, max: 6, icon: 'moon', triggers: [{ when: 'gte', value: 6, action: 'death', message: 'La malédiction vous a entièrement consumé.' }] },
  { label: 'Savoir', start: 0, min: 0, icon: 'book', triggers: [{ when: 'gte', value: 5, action: 'message', message: 'Vos connaissances s’étoffent : les vieux grimoires n’ont plus de secrets pour vous.' }] },
];

const LEVEL = { error: 'Erreur', warning: 'Attention', info: 'Info' };

function RulesSection({ adv, change }) {
  const list = K.countersOf(adv);
  const problems = K.counterProblems(adv);
  const setCounters = fn => change(a => { a.rules.counters = fn(structuredClone(K.countersOf(a))); return a; });
  const add = (preset = { label: 'Nouveau compteur', start: 0, min: 0, icon: 'tally', triggers: [] }) =>
    setCounters(l => [...l, { id: K.freeId({ rules: { counters: l } }, preset.label), visible: true, ...structuredClone(preset) }]);
  const unused = PRESETS.filter(p => !list.some(c => c.label === p.label));
  return html`<section class="panel cpt-rules"><header><h3>Compteurs</h3>
      <button class="btn small" onClick=${() => add()}><${Icon} name="plus" />Compteur</button></header>
    <p class="subtle" style="margin:0">Un compteur suit une valeur libre : réputation, temps restant, malédiction, savoir… Les effets
      « Compteur » le font monter ou descendre, les conditions « a un compteur » ouvrent ou ferment des choix, et ses déclencheurs
      peuvent afficher un message, tuer le héros ou lui donner la victoire quand un seuil est franchi. L'identifiant sert dans le fichier
      de l'aventure : « Renommer » met à jour tous les effets et conditions qui l'utilisent.</p>
    ${unused.length > 0 && html`<div class="row"><span class="subtle">Modèles :</span>
      ${unused.map(p => html`<button class="btn small" onClick=${() => add(p)}><${CIcon} name=${p.icon} />${p.label}</button>`)}</div>`}
    ${list.map((c, i) => html`<${CounterCard} key=${i + ':' + c.id} adv=${adv} c=${c} index=${i} change=${change} setCounters=${setCounters}
      problems=${problems.filter(p => p.id === c.id)} />`)}
    ${!list.length && html`<span class="subtle">Aucun compteur pour l'instant.</span>`}
  </section>`;
}

function CounterCard({ adv, c, index, change, setCounters, problems }) {
  const [newId, setNewId] = useState(c.id || '');
  useEffect(() => setNewId(c.id || ''), [c.id]);
  const upd = patch => setCounters(l => l.map((x, j) => (j === index ? { ...x, ...patch } : x)));
  const trig = (k, patch) => upd({ triggers: (c.triggers || []).map((t, j) => (j === k ? { ...t, ...patch } : t)) });
  const target = K.freeId({ rules: { counters: [] } }, newId);
  const rename = () => {
    try { K.renameCounter(adv, c.id, target); } catch (e) { toast(e.message); setNewId(c.id); return; }
    change(a => K.renameCounter(a, c.id, target));
    toast(`Identifiant changé : ${target}. Les effets et conditions ont été mis à jour.`);
  };
  const remove = async () => {
    const used = K.counterUsage(adv, c.id);
    const msg = `Supprimer le compteur « ${c.label || c.id} » ?${used.length ? ` Il est utilisé par : ${used.map(u => u.label).join(', ')}. Ces effets et conditions deviendront invalides.` : ''}`;
    if (!(await confirmBox(msg, 'Supprimer'))) return;
    setCounters(l => l.filter((_, j) => j !== index));
  };
  const hint = K.startIsFixed(c) ? '' : isDice(String(c.start)) ? `de ${range(String(c.start)).min} à ${range(String(c.start)).max}` : 'formule invalide';
  const idField = `cpt-id-${index}`;
  return html`<div class="panel cpt-card">
    <header><h3 class="cpt-name"><${CIcon} name=${c.icon} />${c.label || 'Sans nom'} <span class="subtle mono">${c.id}</span></h3>
      <button class="btn small danger" onClick=${remove}><${Icon} name="trash" />Supprimer</button></header>
    <div class="grid2 cpt-grid">
      <${Text} label="Nom" value=${c.label} onChange=${v => upd({ label: v })} placeholder="Réputation" />
      <label class="field" for=${idField}>Identifiant
        <span class="row" style="flex-wrap:nowrap;gap:4px">
          <input type="text" id=${idField} value=${newId} onInput=${e => setNewId(e.target.value)} style="font-family:var(--mono)" />
          ${newId.trim() && target !== c.id && html`<button class="btn small" onClick=${rename}>Renommer</button>`}
        </span></label>
      <${Text} label="Départ (nombre ou dés)" value=${c.start ?? 0} placeholder="0, 1d6, 2d6+3"
        onChange=${v => upd({ start: /^\s*[+-]?\d+\s*$/.test(v) ? Number(v) : v.trim() })} />
      <${Num} label="Minimum (vide = aucun)" value=${c.min} onChange=${v => upd({ min: v })} />
      <${Num} label="Maximum (vide = aucun)" value=${c.max} onChange=${v => upd({ max: v })} />
      <div class="cpt-iconpick"><${Select} label="Icône" value=${c.icon || 'tally'} onChange=${v => upd({ icon: v })} options=${ICONS} />
        <span class="cpt-preview" aria-hidden="true"><${CIcon} name=${c.icon} /></span></div>
      <${Text} label="Tableau : ligne (facultatif)" value=${c.row || ''} onChange=${v => upd({ row: v.trim() || undefined })} placeholder="Enzo" />
      <${Text} label="Tableau : colonne (facultatif)" value=${c.column || ''} onChange=${v => upd({ column: v.trim() || undefined })} placeholder="Décrochages" />
    </div>
    ${(c.row || c.column) && html`<span class="subtle">Avec une ligne et une colonne, le compteur s'affiche dans un tableau sur la feuille (une ligne par valeur de « ligne », une colonne par valeur de « colonne »)${c.row && c.column ? '' : ' : il manque ' + (c.row ? 'la colonne' : 'la ligne')}.</span>`}
    ${hint && html`<span class=${'subtle' + (hint === 'formule invalide' ? ' cpt-bad' : '')}>${hint === 'formule invalide' ? html`<${Icon} name="x" />Départ : formule de dés invalide (exemples : 6, 1d6, 2d6+3).` : `Départ tiré aux dés : ${hint}.`}</span>`}
    <label class="row"><input type="checkbox" checked=${K.isVisible(c)} onChange=${e => upd({ visible: e.target.checked })} />
      Visible sur la Feuille d'Aventure (décoché : compteur secret, sans message quand il change)</label>
    ${K.isVisible(c) && html`<label class="row"><input type="checkbox" checked=${!!c.quiet} onChange=${e => upd({ quiet: e.target.checked || undefined })} />
      Discret : pas de message à chaque changement (seuls les déclencheurs parlent)</label>`}
    <div class="stack" style="gap:6px">
      <div class="row" style="justify-content:space-between"><b>Déclencheurs</b>
        <button class="btn small" onClick=${() => upd({ triggers: [...(c.triggers || []), { when: 'gte', value: bound(c.max) ?? 5, action: 'message', message: '' }] })}><${Icon} name="plus" />Déclencheur</button></div>
      ${!(c.triggers || []).length && html`<span class="subtle">Aucun. Exemple : quand le Temps descend à 0 ou moins, le héros meurt.</span>`}
      ${(c.triggers || []).map((t, k) => html`<div class="rowline cpt-trigger">
        <${Select} label="Quand la valeur" value=${t.when || 'gte'} onChange=${v => trig(k, { when: v })} options=${[['gte', 'atteint ou dépasse (≥)'], ['lte', 'descend à ou sous (≤)']]} />
        <${Num} label="Seuil" value=${t.value} onChange=${v => trig(k, { value: v })} />
        <${Select} label="Alors" value=${t.action || 'message'} onChange=${v => trig(k, { action: v })} options=${[['message', 'afficher un message'], ['death', 'mort du héros'], ['victory', 'victoire']]} />
        <div class="cpt-msg"><${Text} label=${t.action === 'death' || t.action === 'victory' ? 'Texte de fin (facultatif)' : 'Message'} value=${t.message} onChange=${v => trig(k, { message: v })} placeholder=${t.action === 'death' ? 'Le temps est écoulé…' : t.action === 'victory' ? 'Le roi vous anoblit.' : 'On chante vos exploits dans les tavernes.'} /></div>
        <button class="btn small danger rm" aria-label=${`Retirer le déclencheur ${k + 1}`} onClick=${() => upd({ triggers: c.triggers.filter((_, j) => j !== k) })}><${Icon} name="x" /></button>
      </div>`)}
      ${(c.triggers || []).length > 0 && html`<span class="subtle">Un déclencheur agit au moment où le seuil est franchi (pas à chaque changement tant qu'on reste au-delà).</span>`}
    </div>
    ${problems.length > 0 && html`<ul class="problems">${problems.map(p => html`<li><span class=${'lvl ' + p.level}>${LEVEL[p.level]}</span><span></span><span>${p.message}</span></li>`)}</ul>`}
  </div>`;
}

registerRulesSection({ id: 'compteurs', order: 20, Section: RulesSection });

/* ------------------------------------------------------------------ */
/* Effets et conditions                                                */
/* ------------------------------------------------------------------ */

const counterOptions = adv => [['', '—'], ...K.countersOf(adv).map(c => [c.id, c.label || c.id])];
const toAmount = v => (/^\s*[+-]?\d+\s*$/.test(v) ? Number(v) : v);

function EffectFields({ e, upd, adv }) {
  if (!K.countersOf(adv).length) return html`<span class="subtle">Créez d'abord un compteur dans l'onglet Règles.</span>`;
  const mode = 'set' in e && (e.add === undefined || e.add === null) ? 'set' : 'add';
  const bad = mode === 'add' && e.add !== undefined && e.add !== '' && !K.parseAmount(e.add);
  return html`
    <${Select} label="Compteur" value=${e.counter || ''} onChange=${v => upd({ counter: v })} options=${counterOptions(adv)} />
    <${Select} label="Action" value=${mode} onChange=${v => upd(v === 'set' ? { set: 0, add: undefined } : { add: 1, set: undefined })}
      options=${[['add', 'ajouter / retirer'], ['set', 'fixer la valeur à']]} />
    ${mode === 'set' ? html`<${Num} label="Nouvelle valeur" value=${e.set} onChange=${n => upd({ set: n })} />`
      : html`<div class="stack" style="gap:2px"><${Text} label="Points (+/−) ou dés" value=${e.add ?? ''} placeholder="1, -2, 1d6, -1d6" onChange=${v => upd({ add: toAmount(v) })} />
        ${bad && html`<span class="subtle cpt-bad"><${Icon} name="x" /> quantité invalide</span>`}</div>`}`;
}

registerEffectUI('counter', {
  label: 'Compteur',
  order: 20,
  blank: adv => ({ op: 'counter', counter: K.countersOf(adv)[0]?.id || '', add: 1 }),
  Fields: EffectFields,
});

const has = v => bound(v) !== null;

function CondFields({ row, upd, adv }) {
  if (!K.countersOf(adv).length) return html`<span class="subtle">Créez d'abord un compteur dans l'onglet Règles.</span>`;
  return html`
    <${Select} label="Compteur" value=${row.counter || ''} onChange=${v => upd({ counter: v })} options=${counterOptions(adv)} />
    <${Select} label="Comparaison" value=${row.cmp || 'gte'} onChange=${v => upd({ cmp: v })}
      options=${[['gte', 'au moins (≥)'], ['lte', 'au plus (≤)'], ['eq', 'exactement (=)'], ['between', 'entre… et…']]} />
    <${Num} label=${row.cmp === 'between' ? 'De' : 'Valeur'} value=${row.n} onChange=${n => upd({ n })} />
    ${row.cmp === 'between' && html`<${Num} label="À" value=${row.n2} onChange=${n2 => upd({ n2 })} />`}`;
}

registerConditionUI({
  t: 'counter',
  label: 'a un compteur',
  order: 20,
  match: c => {
    if (!K.isCounterCond(c)) return null;
    if (has(c.eq)) return { counter: c.counter, cmp: 'eq', n: Number(c.eq) };
    if (has(c.gte) && has(c.lte)) return { counter: c.counter, cmp: 'between', n: Number(c.gte), n2: Number(c.lte) };
    if (has(c.lte)) return { counter: c.counter, cmp: 'lte', n: Number(c.lte) };
    return { counter: c.counter, cmp: 'gte', n: has(c.gte) ? Number(c.gte) : undefined };
  },
  toCond: r => {
    const n = r.n ?? 0;
    if (r.cmp === 'eq') return { counter: r.counter, eq: n };
    if (r.cmp === 'lte') return { counter: r.counter, lte: n };
    if (r.cmp === 'between') return { counter: r.counter, gte: n, lte: r.n2 ?? n };
    return { counter: r.counter, gte: n };
  },
  blank: adv => ({ counter: K.countersOf(adv)[0]?.id || '', cmp: 'gte', n: 1 }),
  Fields: CondFields,
});

/* ------------------------------------------------------------------ */
/* Version imprimable                                                  */
/* ------------------------------------------------------------------ */

const TRACK_MAX = 16; // au-delà, une case vide où écrire le total

function Track({ c }) {
  const min = bound(c.min), max = bound(c.max);
  if (min === null || max === null || max < min || max - min + 1 > TRACK_MAX) return null;
  const start = K.startIsFixed(c) ? K.clamp(c, Number(c.start ?? 0)) : null;
  const endAt = v => endsOf(c).find(t => Number(t.value) === v);
  return html`<span class="cpt-track" aria-hidden="true">${Array.from({ length: max - min + 1 }, (_, i) => {
    const v = min + i, t = endAt(v);
    return html`<span class=${'cpt-cell' + (v === start ? ' start' : '') + (t ? ' end' : '')}><b>${v}</b>${t && html`<${Icon} name=${t.action === 'death' ? 'skull' : 'crown'} />`}</span>`;
  })}</span>`;
}

function startWords(c) {
  if (K.startIsFixed(c)) { const n = K.clamp(c, Number(c.start ?? 0)); return `${n}`; }
  try { return `lancez ${K.diceWords(String(c.start))}`; } catch { return String(c.start); }
}

function boundsWords(c) {
  const min = bound(c.min), max = bound(c.max);
  if (min !== null && max !== null) return `jamais moins de ${min}, jamais plus de ${max}`;
  if (min !== null) return `jamais moins de ${min}`;
  if (max !== null) return `jamais plus de ${max}`;
  return '';
}

/** Départ et bornes communs à toutes les cases d'un tableau, sinon null (chaque case porte alors son départ). */
function commonStart(tb) {
  const cells = tb.rows.flatMap(r => tb.columns.map(k => tb.cell(r, k.label))).filter(Boolean);
  const key = c => [startWords(c), boundsWords(c)].join('|');
  return cells.every(c => key(c) === key(cells[0])) ? cells[0] : null;
}

/** Tableau imprimé : une case vide par compteur, pour y porter des bâtons (et la grille papier d'un livre du maître). */
function PrintTable({ tb }) {
  const common = commonStart(tb);
  return html`<div class="pr-box pr-wide cpt-pr-tablebox">
    ${tb.title && html`<b>${tb.title.toUpperCase()}</b>`}
    <table class="cpt-pr-table">
      <thead><tr><td></td>${tb.columns.map(k => html`<th scope="col"><${CIcon} name=${k.icon} /> ${k.label}</th>`)}</tr></thead>
      <tbody>${tb.rows.map(r => html`<tr><th scope="row">${r}</th>${tb.columns.map(k => {
        const c = tb.cell(r, k.label);
        return html`<td class=${c ? '' : 'cpt-pr-none'}>${c && !common && html`<span class="pr-small">départ : ${startWords(c)}</span>`}</td>`;
      })}</tr>`)}</tbody>
    </table>
    ${common && html`<span class="pr-small">Une marque par point. Départ : ${startWords(common)} dans chaque case${boundsWords(common) ? ` · ${boundsWords(common)}` : ''}.</span>`}
  </div>`;
}

function PrintSheet({ adv }) {
  const list = K.countersOf(adv).filter(c => c.id);
  if (!list.length) return null;
  const hidden = list.some(c => !K.isVisible(c));
  const { tables, rest: visible } = K.counterTables(list.filter(K.isVisible));
  return html`${tables.map(tb => html`<${PrintTable} tb=${tb} />`)}<div class="pr-grid cpt-pr-grid">
    ${visible.map(c => html`<div class="pr-box cpt-pr-box">
      <b class="cpt-name"><${CIcon} name=${c.icon} />${String(c.label || c.id).toUpperCase()}</b>
      <span class="pr-small">départ : ${startWords(c)}${boundsWords(c) ? ` · ${boundsWords(c)}` : ''}</span>
      <${Track} c=${c} />
    </div>`)}
    ${hidden && html`<div class="pr-box cpt-pr-box"><b>AUTRES COMPTEURS</b><span class="pr-small">notez ici les points que le texte vous demande d'inscrire</span></div>`}
  </div>`;
}

function triggerWords(c, t) {
  const label = c.label || c.id;
  const cond = t.when === 'lte' ? `descend à ${t.value} ou moins` : `atteint ${t.value} ou plus`;
  const msg = String(t.message || '').trim();
  const q = msg ? `« ${msg} »` : '';
  if (t.action === 'death' || t.action === 'victory') {
    const end = t.action === 'death' ? 'votre aventure s\'achève' : 'vous avez gagné';
    return `Dès que votre ${label} ${cond}, ${end}${q ? ` : ${q}` : '.'}`;
  }
  return q ? `Dès que votre ${label} ${cond} : ${q}` : '';
}

function PrintRules({ adv }) {
  const list = K.countersOf(adv).filter(c => c.id);
  if (!list.length) return null;
  return html`<h3>${list.length > 1 ? 'Les compteurs' : 'Le compteur'}</h3>
    <p>Votre Feuille d'Aventure comporte ${list.length > 1 ? 'des compteurs' : 'un compteur'}. Quand le texte vous demande d'ajouter ou de retirer
      des points, modifiez la case correspondante (entourez le nouveau total quand une réglette est imprimée). Un seuil n'agit qu'au moment
      où vous le franchissez.</p>
    <ul>${K.counterTables(list.filter(K.isVisible)).tables.map(tb => {
      const common = commonStart(tb);
      const cells = tb.rows.flatMap(r => tb.columns.map(k => tb.cell(r, k.label))).filter(Boolean);
      return html`<li><b>${tb.title ? `TABLEAU ${tb.title.toUpperCase()}` : 'LE TABLEAU'}</b> : une ligne par ${tb.rows.join(', ')} ; une colonne
        par ${tb.columns.map(k => k.label).join(', ')}.${common ? ` Chaque case part de ${startWords(common)}${boundsWords(common) ? ` (${boundsWords(common)})` : ''}.` : ''}
        ${cells.flatMap(c => (c.triggers || []).map(x => triggerWords(c, x)).filter(Boolean)).map(x => ' ' + x)}</li>`;
    })}${list.filter(c => !K.isVisible(c) || !K.counterTables([c]).tables.length).map(c => {
      const b = boundsWords(c);
      const st = K.startIsFixed(c) ? `votre total de départ est de ${startWords(c)}` : `${startWords(c)} pour connaître votre total de départ`;
      return html`<li><b>${String(c.label || c.id).toUpperCase()}</b>${K.isVisible(c) ? '' : ' (case Autres compteurs)'} : ${st}${b ? ` (${b})` : ''}.
        ${(c.triggers || []).map(t => triggerWords(c, t)).filter(Boolean).map(x => ' ' + x)}</li>`;
    })}</ul>`;
}

registerPrintSection({ where: 'sheet', order: 20, Section: PrintSheet });
registerPrintSection({ where: 'rules', order: 20, Section: PrintRules });
