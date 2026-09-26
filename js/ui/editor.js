// Éditeur d'aventure : paragraphes, blocs, conditions, objets, règles, graphe, vérification.

import { html, useState, useEffect, useRef, useMemo } from '../lib/preact-htm.js';
import { Icon, AssetImg, toast, confirmBox, Modal } from './common.js';
import { loadAdventure, saveAdventure, addImage, addAudio, exportAdventure, download, forgetAssetUrl, assetUrl } from '../store/library.js';
import { deleteAsset, deleteAdventure } from '../store/db.js';
import * as R from '../core/rules.js';
import { validate, renumber, renameSection, reachable } from '../core/validate.js';
import { estimateWinRate } from '../core/combat.js';
import { isDice, range } from '../core/dice.js';
import { GraphTab } from './graph.js';
import { ui, sorted } from './registry.js';

const sortIds = ids => ids.sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b));
const nextId = adv => String(Math.max(0, ...Object.keys(adv.sections).map(Number).filter(n => !isNaN(n))) + 1);
const kindOf = sec => sec.ending || (sec.blocks || []).map(b => b.type).find(t => t === 'combat') || (sec.blocks || [])[0]?.type || 'normal';

export function Editor({ id, sectionId }) {
  const [adv, setAdv] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('section');
  const [saved, setSaved] = useState('');
  const [filter, setFilter] = useState('');
  const timer = useRef();

  useEffect(() => {
    loadAdventure(id).then(({ adventure, source }) => {
      if (source !== 'local') { location.hash = '#/'; toast('Cette aventure est publiée : utilisez « Copier pour modifier ».'); return; }
      setAdv(adventure);
    }).catch(e => setError(e.message));
  }, [id]);

  const current = sectionId && adv?.sections[sectionId] ? sectionId : adv?.start;
  const open = sid => { location.hash = `#/ecrire/${encodeURIComponent(id)}/${encodeURIComponent(sid)}`; setTab('section'); };

  /** Toute modification passe ici : mise à jour immédiate, enregistrement différé. */
  const change = fn => setAdv(a => {
    const next = typeof fn === 'function' ? fn(structuredClone(a)) : fn;
    clearTimeout(timer.current);
    setSaved('Modifications non enregistrées…');
    timer.current = setTimeout(() => saveAdventure(next).then(() => setSaved('Enregistré')).catch(e => setSaved('Échec de l’enregistrement : ' + e.message)), 500);
    return next;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const problems = useMemo(() => (adv ? validate(adv) : []), [adv]);
  if (error) return html`<main class="page"><h1>Impossible d'ouvrir l'aventure</h1><p>${error}</p></main>`;
  if (!adv) return html`<main class="page"><p class="muted">Chargement…</p></main>`;

  const ids = sortIds(Object.keys(adv.sections));
  const q = filter.trim().toLowerCase();
  const shown = q ? ids.filter(i => i.includes(q) || (adv.sections[i].title + ' ' + adv.sections[i].text).toLowerCase().includes(q)) : ids;
  const errs = problems.filter(p => p.level === 'error').length;
  const addSection = (text = '') => { const nid = nextId(adv); change(a => { a.sections[nid] = R.newSection(text); return a; }); open(nid); return nid; };

  const plugTabs = sorted(ui.editorTabs);
  const tabs = [['section', `Paragraphe ${current}`], ['graph', 'Graphe'], ['items', 'Objets'], ['rules', 'Règles'], ...plugTabs.map(t => [t.id, t.label(adv)]), ['info', 'Infos'], ['check', `Vérifier${errs ? ` (${errs})` : ''}`]];
  return html`
    <div class="topbar" style="top:61px;z-index:15;border-top:0">
      <span class="crumb">${adv.meta.title}</span>
      <span class="saved" aria-live="polite">${saved}</span>
      <span class="spacer"></span>
      <a class="btn small" href=${`#/jouer/${encodeURIComponent(id)}?test=1&from=${encodeURIComponent(current)}`}><${Icon} name="play" />Tester d'ici</a>
      <a class="btn small" href=${`#/jouer/${encodeURIComponent(id)}`}>Jouer</a>
      <a class="btn small" href=${`#/imprimer/${encodeURIComponent(id)}`}><${Icon} name="print" />Imprimer</a>
      <button class="btn small" onClick=${async () => download(await exportAdventure(adv, 'local'), `${R.slug(adv.meta.title)}.lhz`)}><${Icon} name="download" />Exporter</button>
      ${sorted(ui.editorActions).map(a => html`<${a.Action} adv=${adv} change=${change} />`)}
    </div>
    <div class="editor">
      <aside class="ed-side">
        <div class="head">
          <input type="search" id="ed-filter" placeholder="Numéro ou mot…" value=${filter} onInput=${e => setFilter(e.target.value)} aria-label="Filtrer les paragraphes" />
          <button class="btn small primary" onClick=${() => addSection()}><${Icon} name="plus" />Nouveau paragraphe</button>
        </div>
        <div class="subtle" style="padding:6px 12px">${ids.length} paragraphes</div>
        <nav class="ed-list" aria-label="Paragraphes">${shown.map(i => { const s = adv.sections[i]; const k = kindOf(s); return html`
          <button class="ed-item" aria-current=${i === current && tab === 'section'} onClick=${() => open(i)} key=${i}>
            <span class="n">${i}</span>
            <span class="t">${s.title || s.text.slice(0, 60) || '(vide)'}</span>
            <span class="k" title=${k}>${i === adv.start ? html`<${Icon} name="flag" title="Départ" />` : ''}${k === 'death' ? html`<${Icon} name="skull" title="Mort" />` : k === 'victory' ? html`<${Icon} name="crown" title="Victoire" />` : k === 'combat' ? html`<${Icon} name="sword" title="Combat" />` : k === 'test' || k === 'roll' ? html`<${Icon} name="dice" title="Dés" />` : k === 'shop' ? html`<${Icon} name="coin" title="Boutique" />` : ''}</span>
          </button>`; })}</nav>
      </aside>
      <section class="ed-main">
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${l}</button>`)}</div>
        <div class="ed-pane" style=${tab === 'graph' ? 'padding:0;overflow:hidden' : ''}>
          ${tab === 'section' && html`<${SectionForm} key=${current} adv=${adv} sid=${current} change=${change} open=${open} addSection=${addSection} problems=${problems.filter(p => p.section === current)} />`}
          ${tab === 'graph' && html`<${GraphTab} adv=${adv} change=${change} open=${open} current=${current} />`}
          ${tab === 'items' && html`<${ItemsTab} adv=${adv} change=${change} />`}
          ${tab === 'rules' && html`<${RulesTab} adv=${adv} change=${change} />`}
          ${tab === 'info' && html`<${InfoTab} adv=${adv} change=${change} open=${open} />`}
          ${tab === 'check' && html`<${CheckTab} adv=${adv} problems=${problems} open=${open} />`}
          ${plugTabs.filter(t => t.id === tab).map(t => html`<${t.Tab} adv=${adv} change=${change} open=${open} current=${current} />`)}
        </div>
      </section>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Petits champs réutilisables                                         */
/* ------------------------------------------------------------------ */

let uid = 0;
const useId = p => useMemo(() => `${p}-${++uid}`, []);

function Text({ label, value, onChange, placeholder, area, rows = 3 }) {
  const id = useId('f');
  return html`<label class="field" for=${id}>${label}
    ${area ? html`<textarea id=${id} rows=${rows} value=${value || ''} placeholder=${placeholder} onInput=${e => onChange(e.target.value)}></textarea>`
      : html`<input type="text" id=${id} value=${value ?? ''} placeholder=${placeholder} onInput=${e => onChange(e.target.value)} />`}</label>`;
}
function Num({ label, value, onChange, min, max }) {
  const id = useId('n');
  return html`<label class="field" for=${id}>${label}<input type="number" id=${id} value=${value ?? ''} min=${min} max=${max} onInput=${e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} /></label>`;
}
function Select({ label, value, onChange, options }) {
  const id = useId('s');
  return html`<label class="field" for=${id}>${label}<select id=${id} value=${value ?? ''} onChange=${e => onChange(e.target.value)}>
    ${options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></label>`;
}

/** Destination : numéro existant, ou création immédiate d'un nouveau paragraphe. */
function Target({ label = 'Aller au', value, onChange, adv, addSection, open }) {
  const id = useId('t');
  const exists = value && adv.sections[value];
  return html`<label class="field" for=${id}>${label}
    <span class="row" style="flex-wrap:nowrap;gap:4px">
      <input type="text" id=${id} list="all-sections" value=${value || ''} onInput=${e => onChange(e.target.value.trim())} style="font-family:var(--mono);min-width:64px" />
      ${exists ? html`<button type="button" class="btn small ghost" title="Ouvrir" onClick=${() => open(value)}>↗</button>`
        : html`<button type="button" class="btn small" title="Créer un nouveau paragraphe" onClick=${() => { const n = addSection ? null : null; const nid = nextId(adv); onChange(nid); setTimeout(() => addSectionAt(nid), 0); }}>＋</button>`}
    </span>
    ${value && !exists && html`<span class="subtle" style="color:var(--loss)">n'existe pas encore</span>`}
  </label>`;
  function addSectionAt(nid) { window.dispatchEvent(new CustomEvent('lh-create-section', { detail: nid })); }
}

/* ------------------------------------------------------------------ */
/* Conditions et effets                                                */
/* ------------------------------------------------------------------ */

const COND_TYPES = [['caster', 'sait lancer des formules'], ['notcaster', 'ne sait pas lancer de formules'], ['ate', 'a mangé aujourd’hui'], ['notate', 'n’a pas mangé aujourd’hui'], ['daygte', 'jour ≥'], ['has', 'possède l’objet'], ['nothas', 'ne possède pas l’objet'], ['flag', 'est marqué'], ['notflag', 'n’est pas marqué'], ['stat', 'caractéristique ≥'], ['statlte', 'caractéristique ≤'], ['gold', 'pièces d’or ≥'], ['visited', 'est passé par le'], ['notvisited', 'n’est pas passé par le'], ['class', 'est de la classe']];

function condToRows(cond) {
  if (!cond) return { mode: 'all', rows: [] };
  const list = cond.all ? cond.all : cond.any ? cond.any : [cond];
  const plugRow = c => { for (const d of ui.conditions) { const r = d.match(c); if (r) return { ...r, t: d.t }; } return null; };
  return {
    mode: cond.any ? 'any' : 'all',
    rows: list.map(c => plugRow(c) || (c.caster !== undefined ? { t: c.caster ? 'caster' : 'notcaster' } : c.ate !== undefined ? { t: c.ate ? 'ate' : 'notate' } : c.day !== undefined ? { t: 'daygte', n: c.gte ?? c.day } : c.has ? { t: 'has', v: c.has } : c.not?.has ? { t: 'nothas', v: c.not.has } : c.flag ? { t: 'flag', v: c.flag } : c.not?.flag ? { t: 'notflag', v: c.not.flag }
      : c.visited ? { t: 'visited', v: c.visited } : c.not?.visited ? { t: 'notvisited', v: c.not.visited } : c.class ? { t: 'class', v: c.class }
      : c.gold !== undefined ? { t: 'gold', n: c.gte } : c.stat ? { t: c.lte !== undefined ? 'statlte' : 'stat', v: c.stat, n: c.lte ?? c.gte } : { t: 'has', v: '' })),
  };
}
function rowsToCond({ mode, rows }) {
  const list = rows.map(r => ui.conditions.find(d => d.t === r.t)?.toCond(r) || ({ has: { has: r.v }, nothas: { not: { has: r.v } }, flag: { flag: r.v }, notflag: { not: { flag: r.v } }, visited: { visited: r.v }, notvisited: { not: { visited: r.v } }, class: { class: r.v },
    caster: { caster: true }, notcaster: { caster: false }, ate: { ate: true }, notate: { ate: false }, daygte: { day: true, gte: r.n ?? 1 },
    gold: { gold: true, gte: r.n ?? 0 }, stat: { stat: r.v, gte: r.n ?? 0 }, statlte: { stat: r.v, lte: r.n ?? 0 } }[r.t])).filter(Boolean);
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  return mode === 'any' ? { any: list } : { all: list };
}

function ConditionEditor({ value, onChange, adv }) {
  const st = condToRows(value);
  const set = next => onChange(rowsToCond(next));
  const items = Object.entries(adv.items).map(([k, v]) => [k, v.name]);
  const stats = adv.rules.stats.map(s => [s.id, s.label]);
  const types = [...COND_TYPES, ...sorted(ui.conditions).map(d => [d.t, d.label])];
  return html`<div class="stack" style="gap:6px">
    <div class="row"><span class="subtle">Condition${st.rows.length > 1 ? html` : <select value=${st.mode} onChange=${e => set({ ...st, mode: e.target.value })} aria-label="Mode"><option value="all">toutes</option><option value="any">au moins une</option></select>` : ''}</span>
      <button type="button" class="btn small" onClick=${() => set({ ...st, rows: [...st.rows, { t: 'has', v: items[0]?.[0] || '' }] })}><${Icon} name="plus" />Condition</button></div>
    ${st.rows.map((r, i) => {
      const upd = patch => set({ ...st, rows: st.rows.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
      const plug = ui.conditions.find(d => d.t === r.t);
      const valueField = plug ? html`<${plug.Fields} row=${r} upd=${upd} adv=${adv} />` : ['has', 'nothas'].includes(r.t) ? html`<${Select} label="Objet" value=${r.v} onChange=${v => upd({ v })} options=${[['', '—'], ...items]} />`
        : ['stat', 'statlte'].includes(r.t) ? html`<${Select} label="Caractéristique" value=${r.v} onChange=${v => upd({ v })} options=${stats} />`
        : r.t === 'class' ? html`<${Select} label="Classe" value=${r.v} onChange=${v => upd({ v })} options=${(adv.rules.classes || []).map(c => [c.id, c.label])} />`
        : ['gold', 'caster', 'notcaster', 'ate', 'notate', 'daygte'].includes(r.t) ? null
        : html`<${Text} label=${r.t.includes('visited') ? 'Paragraphe' : 'Marque'} value=${r.v} onChange=${v => upd({ v })} />`;
      return html`<div class="rowline">
        <${Select} label="Le héros…" value=${r.t} onChange=${t => { const p = ui.conditions.find(d => d.t === t); set({ ...st, rows: st.rows.map((x, j) => (j === i ? (p ? { ...p.blank(adv), t } : { t, v: ['has', 'nothas'].includes(t) ? items[0]?.[0] || '' : ['stat', 'statlte'].includes(t) ? stats[0][0] : t === 'class' ? adv.rules.classes?.[0]?.id : '' }) : x)) }); }} options=${types} />
        ${valueField}
        ${!plug && ['stat', 'statlte', 'gold', 'daygte'].includes(r.t) && html`<${Num} label="Valeur" value=${r.n} onChange=${n => upd({ n })} />`}
        <button type="button" class="btn small danger rm" aria-label="Retirer la condition" onClick=${() => set({ ...st, rows: st.rows.filter((_, j) => j !== i) })}><${Icon} name="x" /></button>
      </div>`;
    })}
  </div>`;
}

const EFFECT_TYPES = [['newDay', 'Nouveau jour (la nuit passe)'], ['meal', 'Repas offert (auberge…)'], ['stat', 'Caractéristique'], ['gold', 'Pièces d’or'], ['provisions', 'Repas'], ['give', 'Donner un objet'], ['take', 'Retirer un objet'], ['flag', 'Marquer'], ['note', 'Note sur la feuille']];

function EffectsEditor({ value = [], onChange, adv, title = 'Effets' }) {
  const items = Object.entries(adv.items).map(([k, v]) => [k, v.name]);
  const stats = adv.rules.stats.map(s => [s.id, s.label]);
  const upd = (i, patch) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const types = [...EFFECT_TYPES, ...sorted([...ui.effects].map(([op, d]) => ({ op, ...d }))).map(d => [d.op, d.label])];
  const blank = op => ui.effects.get(op)?.blank(adv) || ({ stat: { op, stat: stats[1]?.[0] || stats[0][0], add: -2 }, gold: { op, add: 5 }, provisions: { op, add: 1 }, give: { op, item: items[0]?.[0] || '' }, take: { op, item: items[0]?.[0] || '' }, flag: { op, flag: '' }, note: { op, text: '' }, newDay: { op }, meal: { op } }[op]);
  return html`<div class="stack" style="gap:6px">
    <div class="row"><span class="subtle">${title}</span>
      <button type="button" class="btn small" onClick=${() => onChange([...value, blank('stat')])}><${Icon} name="plus" />Effet</button></div>
    ${value.map((e, i) => html`<div class="rowline">
      <${Select} label="Type" value=${e.op} onChange=${op => onChange(value.map((x, j) => (j === i ? blank(op) : x)))} options=${types} />
      ${ui.effects.get(e.op) && html`<${ui.effects.get(e.op).Fields} e=${e} upd=${patch => upd(i, patch)} adv=${adv} />`}
      ${e.op === 'stat' && html`
        <${Select} label="Caractéristique" value=${e.stat} onChange=${v => upd(i, { stat: v })} options=${stats} />
        <${Select} label="Action" value=${e.set === 'initial' ? 'initial' : e.addInitial !== undefined ? 'init' : 'add'} onChange=${v => upd(i, v === 'initial' ? { set: 'initial', add: undefined, addInitial: undefined } : v === 'init' ? { addInitial: 1, add: undefined, set: undefined } : { add: -2, set: undefined, addInitial: undefined })}
          options=${[['add', 'ajouter / retirer'], ['initial', 'revenir au total initial'], ['init', 'changer le total initial']]} />
        ${e.set !== 'initial' && html`<${Num} label="Points" value=${e.addInitial ?? e.add} onChange=${n => upd(i, e.addInitial !== undefined ? { addInitial: n } : { add: n })} />`}`}
      ${['gold', 'provisions'].includes(e.op) && html`<${Num} label="Quantité (+/−)" value=${e.add} onChange=${n => upd(i, { add: n })} />`}
      ${['give', 'take'].includes(e.op) && html`<${Select} label="Objet" value=${e.item} onChange=${v => upd(i, { item: v })} options=${[['', '—'], ...items]} />`}
      ${e.op === 'give' && html`<${Num} label="Nombre" value=${e.qty || 1} min="1" onChange=${n => upd(i, { qty: n })} />`}
      ${e.op === 'flag' && html`<${Text} label="Marque" value=${e.flag} onChange=${v => upd(i, { flag: v })} placeholder="ex. porte-ouverte" />`}
      ${e.op === 'note' && html`<${Text} label="Texte" value=${e.text} onChange=${v => upd(i, { text: v })} />`}
      ${e.op === 'meal' && html`<${Num} label="Points rendus (vide = règle)" value=${e.heal} onChange=${n => upd(i, { heal: n })} />`}
      ${e.op === 'newDay' && html`<span class="subtle">${adv.rules.time?.enabled ? (adv.rules.time.mealRequired !== false ? `Sans repas la veille : −${adv.rules.time.penalty} ${R.statLabel(adv, adv.rules.time.stat)}.` : 'Le jour avance, sans obligation de manger.') : 'Activez les journées dans les Règles.'}</span>`}
      <button type="button" class="btn small danger rm" aria-label="Retirer l'effet" onClick=${() => onChange(value.filter((_, j) => j !== i))}><${Icon} name="x" /></button>
    </div>`)}
    ${!items.length && value.some(e => ['give', 'take'].includes(e.op)) && html`<span class="subtle">Créez d'abord vos objets dans l'onglet Objets.</span>`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Image                                                               */
/* ------------------------------------------------------------------ */

function ImageSlot({ adv, path, onChange, label = 'Illustration', name }) {
  const ref = useRef();
  const [bump, setBump] = useState(0);
  const pick = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const p = await addImage(adv, f, name); onChange(p); setBump(b => b + 1); } catch (err) { toast('Image illisible : ' + err.message); }
  };
  const remove = async () => { if (path) { forgetAssetUrl(adv, path); await deleteAsset(adv.id, path); } onChange(null); };
  return html`<div class="img-slot">
    <div class="thumb">${path ? html`<${AssetImg} adv=${adv} source="local" path=${path} alt="" bump=${bump} />` : html`<span><${Icon} name="image" /> aucune image</span>`}</div>
    <div class="stack" style="gap:6px">
      <span class="subtle">${label} — redimensionnée et compressée automatiquement (WebP).</span>
      <div class="row">
        <button type="button" class="btn small" onClick=${() => ref.current.click()}><${Icon} name="upload" />${path ? 'Remplacer' : 'Ajouter une image'}</button>
        ${path && html`<button type="button" class="btn small danger" onClick=${remove}>Retirer</button>`}
      </div>
      <input type="file" accept="image/*" hidden ref=${ref} onChange=${pick} />
    </div>
  </div>`;
}

function SoundSlot({ adv, path, onChange, label = 'Ambiance sonore', name, loop, onLoop }) {
  const ref = useRef();
  const [url, setUrl] = useState(null);
  useEffect(() => { let on = true; setUrl(null); if (path) assetUrl(adv, 'local', path).then(u => on && setUrl(u)); return () => { on = false; }; }, [path]);
  const pick = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { onChange(await addAudio(adv, f, name)); } catch (err) { toast('Son refusé : ' + err.message); }
  };
  const remove = async () => { if (path) { forgetAssetUrl(adv, path); await deleteAsset(adv.id, path); } onChange(null); };
  return html`<div class="stack" style="gap:6px">
    <span class="subtle">${label} — MP3, OGG ou WAV, 15 Mo maximum. Joué en fondu à l'arrivée ; le joueur peut couper le son dans les Réglages.</span>
    ${url && html`<audio controls src=${url} style="width:100%"></audio>`}
    <div class="row">
      <button type="button" class="btn small" onClick=${() => ref.current.click()}><${Icon} name="music" />${path ? 'Remplacer' : 'Ajouter un son'}</button>
      ${path && html`<button type="button" class="btn small danger" onClick=${remove}>Retirer</button>`}
      ${path && onLoop && html`<label class="row subtle"><input type="checkbox" checked=${loop !== false} onChange=${e => onLoop(e.target.checked)} /> En boucle</label>`}
    </div>
    <input type="file" accept="audio/*" hidden ref=${ref} onChange=${pick} />
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Formulaire d'un paragraphe                                          */
/* ------------------------------------------------------------------ */

function SectionForm({ adv, sid, change, open, addSection, problems }) {
  const sec = adv.sections[sid];
  const [newId, setNewId] = useState(sid);
  const set = patch => change(a => { Object.assign(a.sections[sid], patch); return a; });
  const setIn = (key, fn) => change(a => { a.sections[sid][key] = fn(structuredClone(a.sections[sid][key] || [])); return a; });
  useEffect(() => {
    const create = e => change(a => { if (!a.sections[e.detail]) a.sections[e.detail] = R.newSection(''); return a; });
    window.addEventListener('lh-create-section', create);
    return () => window.removeEventListener('lh-create-section', create);
  }, []);
  const tgt = (value, onChange, label) => html`<${Target} label=${label} value=${value} onChange=${onChange} adv=${adv} open=${open} />`;

  const rename = () => {
    try { const next = renameSection(adv, sid, newId); change(next); open(newId.trim()); } catch (e) { toast(e.message); setNewId(sid); }
  };
  const remove = async () => {
    const refs = Object.entries(adv.sections).filter(([i, s]) => i !== sid && R.targetsOf(s).some(t => t.to === sid)).map(([i]) => i);
    if (!(await confirmBox(`Supprimer le paragraphe ${sid} ?${refs.length ? ` Il est cité par : ${refs.join(', ')}.` : ''}`, 'Supprimer'))) return;
    change(a => { delete a.sections[sid]; if (a.start === sid) a.start = Object.keys(a.sections)[0]; return a; });
    open(adv.start === sid ? Object.keys(adv.sections).find(i => i !== sid) : adv.start);
  };
  const addBlock = type => setIn('blocks', b => [...b, {
    test: { type, stat: adv.rules.combat.luck, dice: '2d6', success: '', failure: '' },
    roll: { type, dice: '1d6', table: [{ min: 1, max: 3, to: '' }, { min: 4, max: 6, to: '' }] },
    combat: { type, enemies: [{ name: 'Gobelin', skill: 6, health: 5 }], mode: 'sequential', win: '', flee: '' },
    shop: { type, label: 'Marchand', offers: [] },
    spells: { type, label: 'Lancer une formule', costInText: false, options: [{ code: adv.rules.spells?.book?.[0]?.code || '', to: '' }] },
  }[type]]);

  return html`<div class="ed-form">
    <datalist id="all-sections">${sortIds(Object.keys(adv.sections)).map(i => html`<option value=${i}>${(adv.sections[i].title || adv.sections[i].text).slice(0, 50)}</option>`)}</datalist>
    <div class="row" style="justify-content:space-between;align-items:end">
      <div class="row" style="align-items:end">
        <label class="field" for="sec-id">Numéro<span class="row" style="flex-wrap:nowrap;gap:4px">
          <input type="text" id="sec-id" value=${newId} onInput=${e => setNewId(e.target.value)} style="width:90px;font-family:var(--mono);font-weight:700" />
          ${newId.trim() !== sid && html`<button class="btn small" onClick=${rename}>Renommer</button>`}</span></label>
        ${sid === adv.start ? html`<span class="badge"><${Icon} name="flag" />Départ</span>` : html`<button class="btn small" onClick=${() => change(a => { a.start = sid; return a; })}>Faire de ce paragraphe le départ</button>`}
      </div>
      <button class="btn small danger" onClick=${remove}><${Icon} name="trash" />Supprimer</button>
    </div>
    ${problems.length > 0 && html`<ul class="problems">${problems.map(p => html`<li><span class=${'lvl ' + p.level}>${{ error: 'Erreur', warning: 'Attention', info: 'Info' }[p.level]}</span><span></span><span>${p.message}</span></li>`)}</ul>`}
    <div class="grid2">
      <${Text} label="Titre (facultatif)" value=${sec.title} onChange=${v => set({ title: v })} />
      <${Text} label="Lieu (facultatif)" value=${sec.place} onChange=${v => set({ place: v })} />
    </div>
    <${Text} area rows="9" label="Texte — **gras**, *italique*, ligne vide = nouveau paragraphe" value=${sec.text} onChange=${v => set({ text: v })} />
    <${ImageSlot} adv=${adv} path=${sec.image} name=${'p' + sid} onChange=${p => set({ image: p })} />
    <details class="panel"><summary><b>Son</b> <span class="subtle">${sec.sound ? '— une ambiance est définie' : adv.meta.sound ? '— ambiance générale de l’aventure' : '— aucun'}</span></summary>
      <${SoundSlot} adv=${adv} path=${sec.sound} name=${'p' + sid} loop=${sec.soundLoop} onLoop=${v => set({ soundLoop: v })} onChange=${p => set({ sound: p })} />
    </details>

    <section class="panel"><header><h3>À l'arrivée sur ce paragraphe</h3></header>
      <${EffectsEditor} adv=${adv} value=${sec.onEnter} onChange=${v => set({ onEnter: v })} title="Effets appliqués automatiquement" />
      <${Select} label="Fin de l'aventure" value=${sec.ending || ''} onChange=${v => set({ ending: v || null })} options=${[['', 'Non, l’aventure continue'], ['death', 'Mort du héros'], ['victory', 'Victoire']]} />
    </section>

    <section class="panel"><header><h3>Jets de dés, combats, boutique</h3>
      <div class="row"><button class="btn small" onClick=${() => addBlock('test')}><${Icon} name="clover" />Test</button>
        <button class="btn small" onClick=${() => addBlock('roll')}><${Icon} name="dice" />Table de dés</button>
        <button class="btn small" onClick=${() => addBlock('combat')}><${Icon} name="sword" />Combat</button>
        <button class="btn small" onClick=${() => addBlock('shop')}><${Icon} name="coin" />Boutique</button>
        <button class="btn small" onClick=${() => addBlock('spells')}><${Icon} name="star" />Formules</button>
        ${sorted([...ui.blocks].map(([type, d]) => ({ type, ...d }))).map(d => html`<button class="btn small" onClick=${() => setIn('blocks', b => [...b, { type: d.type, ...d.create(adv) }])}><${Icon} name=${d.icon || 'plus'} />${d.label}</button>`)}</div></header>
      ${(sec.blocks || []).map((b, i) => html`<${BlockEditor} key=${i} adv=${adv} block=${b} tgt=${tgt} sid=${sid}
        onChange=${nb => setIn('blocks', l => l.map((x, j) => (j === i ? nb : x)))} onRemove=${() => setIn('blocks', l => l.filter((_, j) => j !== i))} />`)}
      ${!sec.blocks?.length && html`<span class="subtle">Aucun. Un test de Chance, un combat ou une table de dés s'ajoute ici.</span>`}
    </section>

    <section class="panel"><header><h3>Choix proposés au lecteur</h3>
      <button class="btn small primary" onClick=${() => setIn('choices', c => [...c, { text: '', to: '' }])}><${Icon} name="plus" />Choix</button></header>
      ${(sec.choices || []).map((c, i) => {
        const upd = patch => setIn('choices', l => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        const move = d => setIn('choices', l => { const k = i + d; if (k < 0 || k >= l.length) return l; [l[i], l[k]] = [l[k], l[i]]; return l; });
        return html`<div class="panel" style="background:var(--paper)">
          <div class="grid2" style="grid-template-columns:minmax(0,3fr) minmax(120px,1fr)">
            <${Text} label=${`Choix ${i + 1}`} value=${c.text} onChange=${v => upd({ text: v })} placeholder="Si vous voulez ouvrir la porte…" />
            ${tgt(c.to, v => upd({ to: v }))}
          </div>
          <${ConditionEditor} adv=${adv} value=${c.if} onChange=${v => upd({ if: v })} />
          ${c.if && html`<label class="row subtle"><input type="checkbox" checked=${!!c.hideIfUnavailable} onChange=${e => upd({ hideIfUnavailable: e.target.checked })} /> Cacher ce choix si la condition n'est pas remplie (sinon il est grisé avec la raison)</label>`}
          <${EffectsEditor} adv=${adv} value=${c.effects || []} onChange=${v => upd({ effects: v })} title="Effets en choisissant" />
          <div class="row"><button class="btn small" onClick=${() => move(-1)} aria-label="Monter"><${Icon} name="up" /></button><button class="btn small" onClick=${() => move(1)} aria-label="Descendre"><${Icon} name="down" /></button>
            <button class="btn small danger" onClick=${() => setIn('choices', l => l.filter((_, j) => j !== i))}><${Icon} name="trash" />Retirer ce choix</button></div>
        </div>`;
      })}
    </section>
  </div>`;
}

function BlockEditor({ adv, block, onChange, onRemove, tgt }) {
  const b = block;
  const set = patch => onChange({ ...b, ...patch });
  const stats = adv.rules.stats.map(s => [s.id, s.label]);
  const [rate, setRate] = useState(null);
  let body = null;
  const plug = ui.blocks.get(b.type);
  const title = { test: 'Test', roll: 'Table de dés', combat: 'Combat', shop: 'Boutique', spells: 'Formules magiques' }[b.type] || plug?.label || b.type;
  if (plug) body = html`<${plug.Editor} adv=${adv} block=${b} set=${set} onChange=${onChange} tgt=${tgt} />`;
  if (b.type === 'spells') {
    const book = adv.rules.spells?.book || [];
    body = html`
      ${!adv.rules.spells?.enabled && html`<p class="subtle" style="color:var(--loss);margin:0">Le système de formules est désactivé : activez-le dans l'onglet Règles.</p>`}
      <${Text} label="Libellé" value=${b.label} onChange=${v => set({ label: v })} />
      <label class="row subtle"><input type="checkbox" checked=${!!b.costInText} onChange=${e => set({ costInText: e.target.checked })} /> Le coût est déjà écrit dans les paragraphes d'arrivée (ne pas le retirer automatiquement)</label>
      <datalist id="spell-codes">${book.map(x => html`<option value=${x.code}>${x.name}</option>`)}</datalist>
      <p class="subtle" style="margin:0">Proposez aussi de fausses formules (codes absents du livre) : elles mènent en général à un paragraphe d'échec.</p>
      ${(b.options || []).map((o, j) => {
        const sp = book.find(x => x.code.toUpperCase() === String(o.code).toUpperCase());
        return html`<div class="rowline">
          <label class="field">Code<input type="text" list="spell-codes" value=${o.code} maxlength="3" style="font-family:var(--mono);text-transform:uppercase" onInput=${e => set({ options: b.options.map((x, k) => (k === j ? { ...x, code: e.target.value.toUpperCase() } : x)) })} /></label>
          <span class="subtle">${sp ? `${sp.name} · coût ${sp.cost}` : o.code ? 'fausse formule' : ''}</span>
          ${tgt(o.to, v => set({ options: b.options.map((x, k) => (k === j ? { ...x, to: v } : x)) }))}
          <${Num} label="Coût (vide = livre)" value=${o.cost} onChange=${v => set({ options: b.options.map((x, k) => (k === j ? { ...x, cost: v } : x)) })} />
          <button class="btn small danger rm" aria-label="Retirer la formule" onClick=${() => set({ options: b.options.filter((_, k) => k !== j) })}><${Icon} name="x" /></button>
        </div>`;
      })}
      <div><button class="btn small" onClick=${() => set({ options: [...(b.options || []), { code: '', to: '' }] })}><${Icon} name="plus" />Formule</button></div>`;
  }
  if (b.type === 'test') body = html`
    <div class="grid2">
      <${Select} label="Caractéristique testée" value=${b.stat} onChange=${v => set({ stat: v })} options=${stats} />
      <${Text} label="Dés" value=${b.dice || '2d6'} onChange=${v => set({ dice: v })} />
      <${Num} label="Coût après le test" value=${b.cost ?? (b.stat === adv.rules.combat.luck ? 1 : 0)} onChange=${v => set({ cost: v })} />
      <${Num} label="Bonus / malus" value=${b.mod || 0} onChange=${v => set({ mod: v })} />
    </div>
    <${Text} label="Libellé du bouton (facultatif)" value=${b.label} onChange=${v => set({ label: v })} placeholder=${`Tester votre ${R.statLabel(adv, b.stat)}`} />
    <div class="grid2">${tgt(b.success, v => set({ success: v }), 'Si réussite, aller au')}${tgt(b.failure, v => set({ failure: v }), 'Si échec, aller au')}</div>`;
  if (b.type === 'roll') {
    const r = isDice(b.dice || '1d6') ? range(b.dice || '1d6') : null;
    body = html`
      <div class="grid2"><${Text} label="Dés" value=${b.dice || '1d6'} onChange=${v => set({ dice: v })} />
        <${Select} label="Ajouter une caractéristique" value=${b.addStat || ''} onChange=${v => set({ addStat: v || undefined })} options=${[['', 'non'], ...stats]} /></div>
      ${r && html`<span class="subtle">Résultats possibles : ${r.min} à ${r.max}${b.addStat ? ` + ${R.statLabel(adv, b.addStat)}` : ''}.</span>`}
      ${(b.table || []).map((t, j) => html`<div class="rowline">
        <${Num} label="De" value=${t.min} onChange=${v => set({ table: b.table.map((x, k) => (k === j ? { ...x, min: v } : x)) })} />
        <${Num} label="À" value=${t.max} onChange=${v => set({ table: b.table.map((x, k) => (k === j ? { ...x, max: v } : x)) })} />
        <${Text} label="Texte (facultatif)" value=${t.text} onChange=${v => set({ table: b.table.map((x, k) => (k === j ? { ...x, text: v } : x)) })} />
        ${tgt(t.to, v => set({ table: b.table.map((x, k) => (k === j ? { ...x, to: v } : x)) }))}
        <button class="btn small danger rm" aria-label="Retirer la ligne" onClick=${() => set({ table: b.table.filter((_, k) => k !== j) })}><${Icon} name="x" /></button>
      </div>`)}
      <div><button class="btn small" onClick=${() => set({ table: [...(b.table || []), { min: 1, max: 1, to: '' }] })}><${Icon} name="plus" />Ligne</button></div>`;
  }
  if (b.type === 'combat') body = html`
    ${(b.enemies || []).map((e, j) => html`<div class="rowline">
      <${Text} label="Adversaire" value=${e.name} onChange=${v => set({ enemies: b.enemies.map((x, k) => (k === j ? { ...x, name: v } : x)) })} />
      <${Num} label=${R.statLabel(adv, adv.rules.combat.skill)} value=${e.skill} onChange=${v => set({ enemies: b.enemies.map((x, k) => (k === j ? { ...x, skill: v } : x)) })} />
      <${Num} label=${R.statLabel(adv, adv.rules.combat.health)} value=${e.health} onChange=${v => set({ enemies: b.enemies.map((x, k) => (k === j ? { ...x, health: v } : x)) })} />
      <${Num} label="Dégâts infligés" value=${e.damage ?? adv.rules.combat.damage} onChange=${v => set({ enemies: b.enemies.map((x, k) => (k === j ? { ...x, damage: v } : x)) })} />
      <button class="btn small danger rm" aria-label="Retirer l'adversaire" onClick=${() => set({ enemies: b.enemies.filter((_, k) => k !== j) })}><${Icon} name="x" /></button>
      <div style="grid-column:1/-1"><${ImageSlot} adv=${adv} path=${e.image} name=${e.name} label="Portrait" onChange=${p => set({ enemies: b.enemies.map((x, k) => (k === j ? { ...x, image: p } : x)) })} /></div>
    </div>`)}
    <div class="row"><button class="btn small" onClick=${() => set({ enemies: [...(b.enemies || []), { name: 'Adversaire', skill: 6, health: 6 }] })}><${Icon} name="plus" />Adversaire</button>
      <button class="btn small" onClick=${() => setRate([7, 9, 11].map(sk => [sk, estimateWinRate(adv, b, { skill: sk, health: 20 }, 1500)]))}>Estimer la difficulté</button></div>
    ${rate && html`<span class="subtle">Chances de victoire sans utiliser la Chance, avec 20 d'${R.statLabel(adv, adv.rules.combat.health)} : ${rate.map(([sk, r]) => `${R.statLabel(adv, adv.rules.combat.skill)} ${sk} → ${Math.round(r * 100)} %`).join(' · ')}</span>`}
    <div class="grid2">
      ${b.enemies?.length > 1 && html`<${Select} label="Plusieurs adversaires" value=${b.mode || 'sequential'} onChange=${v => set({ mode: v })} options=${[['sequential', 'l’un après l’autre'], ['together', 'tous en même temps']]} />`}
      <${Num} label="Bonus / malus de Force d'Attaque du héros" value=${b.attackMod || 0} onChange=${v => set({ attackMod: v })} />
      <${Num} label="Arrêter quand l'adversaire tombe à" value=${b.stopAt || 0} onChange=${v => set({ stopAt: v })} />
    </div>
    <div class="grid2">
      ${tgt(b.win, v => set({ win: v }), 'Si victoire, aller au')}
      ${tgt(b.flee, v => set({ flee: v }), 'Fuite possible vers (vide = impossible)')}
      ${tgt(b.lose, v => set({ lose: v }), 'Si défaite (vide = mort)')}
    </div>
    ${b.flee && html`<div class="grid2"><${Num} label="Dégâts en fuyant" value=${b.fleeDamage ?? adv.rules.combat.fleeDamage} onChange=${v => set({ fleeDamage: v })} />
      <${Num} label="Fuite possible après N assauts" value=${b.fleeAfter || 0} onChange=${v => set({ fleeAfter: v })} /></div>`}`;
  if (b.type === 'shop') {
    const items = Object.entries(adv.items).map(([k, v]) => [k, v.name]);
    body = html`
      <${Text} label="Nom" value=${b.label} onChange=${v => set({ label: v })} />
      ${(b.offers || []).map((o, j) => html`<div class="rowline">
        <${Select} label="Objet" value=${o.item} onChange=${v => set({ offers: b.offers.map((x, k) => (k === j ? { ...x, item: v } : x)) })} options=${[['', '—'], ...items]} />
        <${Num} label="Prix (PO)" value=${o.price} onChange=${v => set({ offers: b.offers.map((x, k) => (k === j ? { ...x, price: v } : x)) })} />
        <${Num} label="Stock (vide = illimité)" value=${o.stock} onChange=${v => set({ offers: b.offers.map((x, k) => (k === j ? { ...x, stock: v } : x)) })} />
        <button class="btn small danger rm" aria-label="Retirer l'offre" onClick=${() => set({ offers: b.offers.filter((_, k) => k !== j) })}><${Icon} name="x" /></button>
      </div>`)}
      <div><button class="btn small" disabled=${!items.length} onClick=${() => set({ offers: [...(b.offers || []), { item: items[0][0], price: 1 }] })}><${Icon} name="plus" />Offre</button>
        ${!items.length && html`<span class="subtle"> Créez d'abord des objets dans l'onglet Objets.</span>`}</div>`;
  }
  return html`<div class="panel" style="background:var(--paper)">
    <header><h3>${title}</h3><button class="btn small danger" onClick=${onRemove}><${Icon} name="trash" />Retirer</button></header>
    ${body}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Onglets : objets, règles, infos, vérification                       */
/* ------------------------------------------------------------------ */

function ItemsTab({ adv, change }) {
  const [nid, setNid] = useState('');
  const set = (id, patch) => change(a => { a.items[id] = { ...a.items[id], ...patch }; return a; });
  const add = () => {
    const id = R.slug(nid || 'objet');
    if (adv.items[id]) { toast('Cet identifiant existe déjà.'); return; }
    change(a => { a.items[id] = { name: nid || 'Objet', description: '' }; return a; }); setNid('');
  };
  return html`<div class="ed-form">
    <p class="muted" style="margin:0">Les objets servent dans les conditions (« il faut la clé »), les effets, la boutique et la feuille d'aventure. Un objet utilisable (potion) a des effets d'utilisation.</p>
    <div class="row" style="align-items:end"><${Text} label="Nom du nouvel objet" value=${nid} onChange=${setNid} placeholder="Clé d'argent" /><button class="btn primary" onClick=${add}><${Icon} name="plus" />Ajouter</button></div>
    ${Object.entries(adv.items).map(([id, it]) => html`<section class="panel" key=${id}>
      <header><h3>${it.name} <span class="subtle mono">${id}</span></h3>
        <button class="btn small danger" onClick=${async () => { if (await confirmBox(`Supprimer l'objet « ${it.name} » ?`, 'Supprimer')) change(a => { delete a.items[id]; return a; }); }}><${Icon} name="trash" />Supprimer</button></header>
      <div class="grid2"><${Text} label="Nom" value=${it.name} onChange=${v => set(id, { name: v })} /><${Text} label="Description" value=${it.description} onChange=${v => set(id, { description: v })} /></div>
      <${EffectsEditor} adv=${adv} value=${it.use || []} onChange=${v => set(id, { use: v })} title="Effets quand le héros l'utilise (vide = objet non utilisable)" />
      ${it.use?.length > 0 && html`<label class="row subtle"><input type="checkbox" checked=${it.consumable !== false} onChange=${e => set(id, { consumable: e.target.checked })} /> Disparaît après utilisation</label>`}
      ${sorted(ui.itemFields).map(f => html`<${f.Fields} it=${it} id=${id} set=${patch => set(id, patch)} adv=${adv} />`)}
    </section>`)}
  </div>`;
}

function RulesTab({ adv, change }) {
  const r = adv.rules;
  const set = patch => change(a => { a.rules = { ...a.rules, ...patch }; return a; });
  const stats = r.stats.map(s => [s.id, s.label]);
  const items = Object.entries(adv.items).map(([k, v]) => [k, v.name]);
  return html`<div class="ed-form">
    <section class="panel"><header><h3>Caractéristiques</h3><button class="btn small" onClick=${() => set({ stats: [...r.stats, { id: 'stat' + (r.stats.length + 1), label: 'Nouvelle', roll: '1d6+6' }] })}><${Icon} name="plus" />Caractéristique</button></header>
      ${r.stats.map((s, i) => html`<div class="rowline">
        <${Text} label="Nom" value=${s.label} onChange=${v => set({ stats: r.stats.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
        <label class="field">Identifiant<input type="text" value=${s.id} disabled /></label>
        <${Text} label="Tirage (ex. 2d6+12)" value=${s.roll} onChange=${v => set({ stats: r.stats.map((x, j) => (j === i ? { ...x, roll: v } : x)) })} />
        <span class="subtle">${isDice(s.roll) ? `de ${range(s.roll).min} à ${range(s.roll).max}` : 'formule invalide'}</span>
      </div>`)}
    </section>
    <section class="panel"><header><h3>Combat et départ</h3></header>
      <div class="grid2">
        <${Select} label="Habileté (attaque)" value=${r.combat.skill} onChange=${v => set({ combat: { ...r.combat, skill: v } })} options=${stats} />
        <${Select} label="Points de vie" value=${r.combat.health} onChange=${v => set({ combat: { ...r.combat, health: v } })} options=${stats} />
        <${Select} label="Chance" value=${r.combat.luck} onChange=${v => set({ combat: { ...r.combat, luck: v } })} options=${stats} />
        <${Num} label="Dégâts par coup" value=${r.combat.damage} onChange=${v => set({ combat: { ...r.combat, damage: v } })} />
        <${Num} label="Dégâts en fuyant" value=${r.combat.fleeDamage} onChange=${v => set({ combat: { ...r.combat, fleeDamage: v } })} />
        <${Text} label="Or de départ (formule)" value=${r.gold} onChange=${v => set({ gold: v })} />
        <${Num} label="Repas de départ" value=${r.provisions} onChange=${v => set({ provisions: v })} />
        <${Num} label="Un repas rend" value=${r.meal.heal} onChange=${v => set({ meal: { ...r.meal, heal: v } })} />
      </div>
      <label class="row"><input type="checkbox" checked=${r.allowBack !== false} onChange=${e => set({ allowBack: e.target.checked })} /> Autoriser le retour en arrière (« doigt dans la page »)</label>
    </section>
    <section class="panel"><header><h3>Journées et repas</h3></header>
      <label class="row"><input type="checkbox" checked=${!!r.time?.enabled} onChange=${e => set({ time: { ...r.time, enabled: e.target.checked } })} /> Compter les jours</label>
      ${r.time?.enabled && html`
        <p class="subtle" style="margin:0">Ajoutez l'effet « Nouveau jour » aux paragraphes où le héros se réveille. La feuille d'aventure affiche le jour et si le héros a mangé.</p>
        <label class="row"><input type="checkbox" checked=${r.time.mealRequired !== false} onChange=${e => set({ time: { ...r.time, mealRequired: e.target.checked } })} /> Obligation de manger chaque jour</label>
        ${r.time.mealRequired !== false && html`<div class="grid2">
          <${Num} label="Pénalité sans repas" value=${r.time.penalty} onChange=${v => set({ time: { ...r.time, penalty: v } })} />
          <${Select} label="Sur la caractéristique" value=${r.time.stat} onChange=${v => set({ time: { ...r.time, stat: v } })} options=${stats} />
        </div>`}`}
    </section>
    <${SpellsRules} adv=${adv} set=${set} stats=${stats} items=${items} />
    ${sorted(ui.rulesSections).map(r => html`<${r.Section} adv=${adv} change=${change} set=${set} />`)}
    <section class="panel"><header><h3>Classes de héros</h3><button class="btn small" onClick=${() => set({ classes: [...(r.classes || []), { id: 'classe' + ((r.classes || []).length + 1), label: 'Nouvelle classe', description: '', rolls: {}, items: [] }] })}><${Icon} name="plus" />Classe</button></header>
      ${(r.classes || []).map((c, i) => {
        const upd = patch => set({ classes: r.classes.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return html`<div class="panel" style="background:var(--paper)">
          <div class="grid2"><${Text} label="Nom" value=${c.label} onChange=${v => upd({ label: v })} /><${Text} label="Description" value=${c.description} onChange=${v => upd({ description: v })} /></div>
          <div class="grid2">${r.stats.map(s => html`<${Text} label=${`Tirage ${s.label}`} value=${c.rolls?.[s.id] || ''} placeholder=${s.roll} onChange=${v => upd({ rolls: { ...c.rolls, [s.id]: v || undefined } })} />`)}
            <${Text} label="Or de départ" value=${c.gold || ''} placeholder=${r.gold} onChange=${v => upd({ gold: v || undefined })} /></div>
          <${Select} label="Objet de départ en plus" value="" onChange=${v => v && upd({ items: [...(c.items || []), v] })} options=${[['', 'Ajouter…'], ...items]} />
          ${c.items?.length > 0 && html`<div class="row">${c.items.map((it, k) => html`<button class="badge" onClick=${() => upd({ items: c.items.filter((_, m) => m !== k) })}>${R.itemName(adv, it)} ✕</button>`)}</div>`}
          ${r.classes.length > 1 && html`<div><button class="btn small danger" onClick=${() => set({ classes: r.classes.filter((_, j) => j !== i) })}>Supprimer la classe</button></div>`}
        </div>`;
      })}
    </section>
  </div>`;
}

function SpellsRules({ adv, set, stats, items }) {
  const sp = adv.rules.spells || {};
  const upd = patch => set({ spells: { ...sp, ...patch } });
  const book = sp.book || [];
  const [q, setQ] = useState('');
  const setSpell = (i, patch) => upd({ book: book.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const shown = book.map((x, i) => [x, i]).filter(([x]) => !q || `${x.code} ${x.name} ${x.description}`.toLowerCase().includes(q.toLowerCase()));
  return html`<section class="panel"><header><h3>Formules magiques</h3></header>
    <label class="row"><input type="checkbox" checked=${!!sp.enabled} onChange=${e => upd({ enabled: e.target.checked })} /> Activer les formules (codes de trois lettres, façon Sorcellerie !)</label>
    ${sp.enabled && html`
      <div class="grid2">
        <${Select} label="Coût payé en" value=${sp.stat} onChange=${v => upd({ stat: v })} options=${stats} />
        <${Num} label="Coût d'un code inconnu tapé" value=${sp.unknownCost || 0} onChange=${v => upd({ unknownCost: v })} />
      </div>
      <div class="stack" style="gap:4px"><span class="subtle">Classes qui peuvent lancer des formules (aucune cochée = toutes)</span>
        <div class="row">${(adv.rules.classes || []).map(c => html`<label class="chk"><input type="checkbox" checked=${(sp.casters || []).includes(c.id)} onChange=${e => upd({ casters: e.target.checked ? [...(sp.casters || []), c.id] : (sp.casters || []).filter(x => x !== c.id) })} /> ${c.label}</label>`)}</div></div>
      <label class="row"><input type="checkbox" checked=${!!sp.typeCode} onChange=${e => upd({ typeCode: e.target.checked })} /> Le joueur doit taper le code de mémoire (sinon, les codes proposés sont des boutons)</label>
      <div class="row" style="justify-content:space-between"><b>Livre des formules (${book.length})</b>
        <div class="row"><input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Chercher…" aria-label="Chercher une formule" style="width:160px" />
        <button class="btn small" onClick=${() => upd({ book: [...book, { code: 'ABC', name: 'Nouvelle formule', cost: 1, description: '' }] })}><${Icon} name="plus" />Formule</button></div></div>
      ${shown.map(([x, i]) => html`<div class="rowline" key=${i}>
        <label class="field">Code<input type="text" value=${x.code} maxlength="3" style="font-family:var(--mono);text-transform:uppercase;width:80px" onInput=${e => setSpell(i, { code: e.target.value.toUpperCase() })} /></label>
        <${Text} label="Nom" value=${x.name} onChange=${v => setSpell(i, { name: v })} />
        <${Num} label="Coût" value=${x.cost} onChange=${v => setSpell(i, { cost: v })} />
        <${Select} label="Objet requis" value=${x.requires || ''} onChange=${v => setSpell(i, { requires: v || undefined })} options=${[['', 'aucun'], ...items]} />
        <button class="btn small danger rm" aria-label="Retirer la formule" onClick=${() => upd({ book: book.filter((_, j) => j !== i) })}><${Icon} name="x" /></button>
        <div style="grid-column:1/-1"><${Text} area rows="2" label="Effet (texte du livre des formules)" value=${x.description} onChange=${v => setSpell(i, { description: v })} /></div>
      </div>`)}`}
  </section>`;
}

function InfoTab({ adv, change, open }) {
  const setMeta = patch => change(a => { a.meta = { ...a.meta, ...patch }; return a; });
  const [confirmRenum, setConfirmRenum] = useState(false);
  return html`<div class="ed-form">
    <div class="grid2"><${Text} label="Titre" value=${adv.meta.title} onChange=${v => setMeta({ title: v })} /><${Text} label="Auteur·e" value=${adv.meta.author} onChange=${v => setMeta({ author: v })} /></div>
    <${Text} area label="Présentation" value=${adv.meta.description} onChange=${v => setMeta({ description: v })} />
    <${ImageSlot} adv=${adv} path=${adv.meta.cover} name="couverture" label="Couverture" onChange=${p => setMeta({ cover: p })} />
    <section class="panel"><header><h3>Ambiance générale</h3></header>
      <${SoundSlot} adv=${adv} path=${adv.meta.sound} name="ambiance" label="Musique jouée pendant toute l'aventure (un paragraphe avec son propre son la remplace)" onChange=${p => setMeta({ sound: p })} />
    </section>
    <section class="panel"><header><h3>Numérotation façon livre</h3></header>
      <p class="subtle" style="margin:0">Mélange les numéros de 1 à ${Object.keys(adv.sections).length} pour qu'on ne devine pas la suite en tournant les pages. Le départ devient le 1. Tous les renvois sont mis à jour.</p>
      ${confirmRenum ? html`<div class="row"><button class="btn primary" onClick=${() => { const { adventure } = renumber(adv); change(adventure); setConfirmRenum(false); toast('Paragraphes renumérotés.'); open('1'); }}>Oui, renuméroter</button><button class="btn" onClick=${() => setConfirmRenum(false)}>Annuler</button></div>`
        : html`<div><button class="btn" onClick=${() => setConfirmRenum(true)}>Renuméroter au hasard</button></div>`}
    </section>
    <section class="panel"><header><h3>Supprimer l'aventure</h3></header>
      <div><button class="btn danger" onClick=${async () => { if (await confirmBox(`Supprimer définitivement « ${adv.meta.title} » de ce navigateur ? Exportez-la d'abord si vous voulez la garder.`, 'Supprimer')) { await deleteAdventure(adv.id); location.hash = '#/'; } }}><${Icon} name="trash" />Supprimer de cet appareil</button></div>
    </section>
  </div>`;
}

function CheckTab({ adv, problems, open }) {
  const reach = reachable(adv).size, total = Object.keys(adv.sections).length;
  const endings = Object.values(adv.sections).filter(s => s.ending);
  return html`<div class="ed-form">
    <div class="row" style="gap:24px">
      <span><b class="mono">${total}</b> paragraphes</span>
      <span><b class="mono">${reach}</b> accessibles depuis le départ</span>
      <span><b class="mono">${endings.filter(s => s.ending === 'victory').length}</b> victoire(s) · <b class="mono">${endings.filter(s => s.ending === 'death').length}</b> mort(s)</span>
    </div>
    ${!problems.length ? html`<p class="outcome ok">Aucun problème détecté.</p>` : html`<ul class="problems">${problems.map(p => html`<li>
      <span class=${'lvl ' + p.level}>${{ error: 'Erreur', warning: 'Attention', info: 'Info' }[p.level]}</span>
      ${p.section ? html`<button class="btn small mono" onClick=${() => open(p.section)}>${p.section}</button>` : html`<span></span>`}
      <span>${p.message}</span></li>`)}</ul>`}
  </div>`;
}

// Champs et éditeurs réutilisables par les greffons (voir docs/PLUGINS.md).
export { Text, Num, Select, Target, ConditionEditor, EffectsEditor, ImageSlot, SoundSlot, nextId, sortIds };
