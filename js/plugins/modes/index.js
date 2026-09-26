// Greffon « modes » — interface : choix du mode à la création du héros, Feuille d'Aventure,
// onglet « Modes » et panneau « Variantes selon le mode » de l'éditeur, condition, version imprimable.
// Voir docs/plugins/modes.md.

import { html, useMemo, useLayoutEffect } from '../../lib/preact-htm.js';
import { Icon, loadCSS, confirmBox, prefs, applyPrefs } from '../../ui/common.js';
import { Text, Num, Select, ImageSlot } from '../../ui/editor.js';
import {
  ui, registerAdvTransform, registerCreatorPanel, registerSheetPanel, registerEditorTab, registerSectionPanel,
  registerConditionUI, registerPrintOption, registerPrintSection,
} from '../../ui/registry.js';
import * as M from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ------------------------------------------------------------------ */
/* Icônes des modes (tracés propres au greffon + quelques icônes communes) */
/* ------------------------------------------------------------------ */

const CORE_ICONS = new Set(['star', 'heart', 'sun', 'moon', 'book', 'flag', 'map']);
const OWN = {
  pousse: '<path d="M12 21v-8"/><path d="M12 13C12 9 9 7 5 7c0 4 3 6 7 6z"/><path d="M12 11c0-3.5 2.5-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5z"/><path d="M8 21h8"/>',
  arbuste: '<path d="M12 21v-6"/><circle cx="12" cy="10" r="5.5"/><path d="M8 21h8"/>',
  arbre: '<path d="M12 21v-4"/><path d="M12 2l5 6h-2.5l4 5h-3l4 4H4.5l4-4h-3l4-5H7z"/><path d="M8 21h8"/>',
  boussole: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  loupe: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  montagne: '<path d="M2 20L9 7l4 7 3-4 6 10z"/><path d="M7.5 10l1.5 1.5L10.5 10"/>',
  lanterne: '<path d="M10 3h4M9 5h6M8 7h8l-1 12H9z"/><path d="M12 10v6M9 21h6"/>',
  cerveau: '<path d="M11 4.5A3 3 0 0 0 5.5 6 3 3 0 0 0 4 11a3 3 0 0 0 1 5 3 3 0 0 0 4 3.5 2.5 2.5 0 0 0 2-1z"/><path d="M13 4.5A3 3 0 0 1 18.5 6 3 3 0 0 1 20 11a3 3 0 0 1-1 5 3 3 0 0 1-4 3.5 2.5 2.5 0 0 1-2-1z"/><path d="M12 4v15"/>',
};
const ICONS = [['pousse', 'Jeune pousse'], ['arbuste', 'Arbuste'], ['arbre', 'Grand arbre'], ['boussole', 'Boussole'], ['loupe', 'Loupe'],
  ['montagne', 'Montagne'], ['lanterne', 'Lanterne'], ['cerveau', 'Cerveau'], ['map', 'Carte'], ['star', 'Étoile'], ['heart', 'Cœur'],
  ['sun', 'Soleil'], ['moon', 'Lune'], ['book', 'Livre'], ['flag', 'Drapeau']];
const DEFAULT_ICONS = ['pousse', 'arbuste', 'arbre'];
const iconOf = (adv, m) => m?.icon || DEFAULT_ICONS[M.listModes(adv).findIndex(x => x.id === m?.id)] || 'boussole';

function MIcon({ name, title }) {
  if (CORE_ICONS.has(name)) return html`<${Icon} name=${name} title=${title} />`;
  return html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined} dangerouslySetInnerHTML=${{ __html: (title ? `<title>${title}</title>` : '') + (OWN[name] || OWN.boussole) }}></svg>`;
}

/** Ce que le mode change pour le lecteur, en mots (cartes de la création). */
function modeFeatures(m) {
  const out = [];
  if (m.prefs?.ttsAuto === true) out.push(['speaker', 'Lu à voix haute']);
  if (m.prefs?.ttsAuto === false) out.push(['stop', 'Sans lecture automatique']);
  if (Number(m.prefs?.size) > 0) out.push(['book', `Texte en ${m.prefs.size} px`]);
  if (m.rules && 'allowBack' in m.rules) out.push(['back', m.rules.allowBack === false ? 'Pas de retour en arrière' : 'Retour en arrière permis']);
  return out;
}

/* ------------------------------------------------------------------ */
/* Aventure effective pendant la partie                                */
/* ------------------------------------------------------------------ */

registerAdvTransform((adv, state) => (M.hasModes(adv) ? M.applyMode(adv, state?.mode) : adv));

/* ------------------------------------------------------------------ */
/* Préférences du mode (lecture à voix haute, taille du texte)         */
/* ------------------------------------------------------------------ */

// Le temps de la partie, le mode impose ses réglages ; ceux du lecteur sont gardés dans « lh.modes.reglages »
// et remis en place à la sortie de la partie (ou au prochain lancement si la page a été fermée entre-temps).
// Un réglage que le lecteur a changé lui-même pendant la partie n'est pas écrasé.
const BACKUP = 'modes.reglages';
const PREF_KEYS = ['ttsAuto', 'size'];
const stored = k => { try { return localStorage.getItem('lh.' + k); } catch { return null; } };
const forget = k => { try { localStorage.removeItem('lh.' + k); } catch { /* stockage indisponible */ } };
const clampSize = n => Math.max(15, Math.min(28, Math.round(Number(n))));

export function applyModePrefs(p) {
  restoreModePrefs();
  const saved = {};
  for (const k of PREF_KEYS) {
    let v = p?.[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'size') { if (!(Number(v) > 0)) continue; v = clampSize(v); }
    if (k === 'ttsAuto') v = !!v;
    saved[k] = { had: stored(k) !== null, was: prefs.get(k, null), set: v };
    prefs.set(k, v);
  }
  if (!Object.keys(saved).length) return;
  prefs.set(BACKUP, saved);
  applyPrefs();
}

export function restoreModePrefs() {
  const saved = prefs.get(BACKUP, null);
  if (!saved) return;
  for (const [k, { had, was, set }] of Object.entries(saved)) {
    if (JSON.stringify(prefs.get(k, null)) !== JSON.stringify(set)) continue; // changé par le lecteur pendant la partie : on le garde
    if (had) prefs.set(k, was); else forget(k);
  }
  forget(BACKUP);
  applyPrefs();
}

restoreModePrefs(); // page fermée en pleine partie la dernière fois

/** Applique les réglages du mode tant que le composant est affiché (la Feuille d'Aventure vit aussi longtemps que la lecture). */
function useModePrefs(mode) {
  const key = JSON.stringify(mode?.prefs || null);
  // useLayoutEffect : avant l'effet de la lecture qui décide de lire le paragraphe à voix haute.
  useLayoutEffect(() => {
    if (!mode?.prefs) return undefined;
    applyModePrefs(mode.prefs);
    return () => restoreModePrefs();
  }, [key]);
}

/* ------------------------------------------------------------------ */
/* Création du héros : cartes des modes                                */
/* ------------------------------------------------------------------ */

function ModePicker({ adv, choice, setChoice, query }) {
  const modes = M.listModes(adv);
  if (!modes.length) return null;
  const current = M.resolveMode(adv, choice ?? query?.mode)?.id;
  return html`<fieldset class="modes-pick">
    <legend class="eyebrow">Mode de jeu</legend>
    <p class="subtle" style="margin:0">Choisissez la version de l'histoire qui convient au lecteur.</p>
    <div class="mode-cards">
      ${modes.map(m => {
        const on = m.id === current;
        const feats = modeFeatures(m);
        return html`<label class=${'mode-card' + (on ? ' on' : '')} key=${m.id}>
          <input type="radio" class="mode-radio" name="lh-mode" value=${m.id} checked=${on} onChange=${() => setChoice(m.id)} />
          <span class="mode-ico"><${MIcon} name=${iconOf(adv, m)} /></span>
          <span class="mode-txt">
            <b class="mode-name">${m.label || m.id}</b>
            ${m.ages && html`<span class="mode-ages">${m.ages}</span>`}
            ${m.description && html`<span class="mode-desc">${m.description}</span>`}
            ${feats.length > 0 && html`<span class="mode-feats">${feats.map(([i, t]) => html`<span><${Icon} name=${i} />${t}</span>`)}</span>`}
          </span>
          <span class="mode-tick" aria-hidden="true">${on ? html`<${Icon} name="check" />Choisi` : html`<span class="mode-ring"></span>Choisir`}</span>
        </label>`;
      })}
    </div>
  </fieldset>`;
}

registerCreatorPanel({
  id: 'modes', order: 5, place: 'top', Panel: ModePicker,
  // Mode choisi sur les cartes, sinon celui du lien (?mode=…, aussi en mode test), sinon le premier.
  beforeStart: (state, choice, adv, ctx) => { if (M.hasModes(adv)) state.mode = M.resolveMode(adv, choice ?? ctx?.query?.mode)?.id ?? null; },
});

/* ------------------------------------------------------------------ */
/* Feuille d'Aventure                                                  */
/* ------------------------------------------------------------------ */

function SheetMode({ adv, state }) {
  const m = M.hasModes(adv) ? M.resolveMode(adv, state.mode) : null;
  useModePrefs(m);
  if (!m) return null;
  return html`<div class="mode-sheet">
    <span class="mode-ico small"><${MIcon} name=${iconOf(adv, m)} /></span>
    <span class="stack" style="gap:0"><span class="eyebrow">Mode de jeu</span><b>${m.label || m.id}</b>${m.ages && html`<span class="subtle">${m.ages}</span>`}</span>
  </div>`;
}
registerSheetPanel({ id: 'modes', order: 1, Panel: SheetMode });

/* ------------------------------------------------------------------ */
/* Condition « joue dans le mode »                                     */
/* ------------------------------------------------------------------ */

const own = (c, k) => !!c && Object.prototype.hasOwnProperty.call(c, k);
registerConditionUI({
  t: 'mode', label: 'joue dans le mode', order: 80,
  match: c => (own(c, 'mode') ? { v: (Array.isArray(c.mode) ? c.mode : [c.mode]).filter(Boolean) } : null),
  toCond: r => { const v = Array.isArray(r.v) ? r.v : [r.v].filter(Boolean); return { mode: v.length === 1 ? v[0] : v }; },
  blank: adv => ({ v: M.listModes(adv).slice(0, 1).map(m => m.id) }),
  Fields: ({ row, upd, adv }) => {
    const modes = M.listModes(adv);
    const v = Array.isArray(row.v) ? row.v : [row.v].filter(Boolean);
    if (!modes.length) return html`<span class="subtle">Aucun mode : créez-en dans l'onglet Modes.</span>`;
    return html`<div class="mode-cond"><span>Mode(s)</span><div class="row" style="gap:4px">${modes.map(m => html`<label class="chk">
      <input type="checkbox" checked=${v.includes(m.id)} onChange=${e => upd({ v: modes.map(x => x.id).filter(id => (id === m.id ? e.target.checked : v.includes(id))) })} /> ${m.label || m.id}</label>`)}</div></div>`;
  },
});

/* ------------------------------------------------------------------ */
/* Éditeur : onglet « Modes »                                          */
/* ------------------------------------------------------------------ */

const PRESETS = [
  { id: 'petit', label: 'Petit explorateur', ages: '5-7 ans', icon: 'pousse',
    description: 'Des textes courts et des défis simples, lus à voix haute. Pas de fin brutale : en cas d’échec, on se replie et on réessaie.',
    rules: { allowBack: true }, prefs: { ttsAuto: true, size: 22 } },
  { id: 'explorateur', label: 'Explorateur', ages: '8-9 ans', icon: 'arbuste',
    description: 'L’histoire complète, avec des aides.', rules: { allowBack: true } },
  { id: 'grand', label: 'Grand explorateur', ages: '10-11 ans et plus', icon: 'arbre',
    description: 'L’histoire complète. Certaines fins sont de vraies fins, racontées sobrement.' },
];

const tri = (v, yes = 'oui', no = 'non') => (v === true ? yes : v === false ? no : '');
const fromTri = v => (v === 'oui' ? true : v === 'non' ? false : undefined);
const clean = o => { const x = { ...o }; for (const k of Object.keys(x)) if (x[k] === undefined) delete x[k]; return Object.keys(x).length ? x : undefined; };
const sortIds = l => [...l].sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b));
const hashId = adv => encodeURIComponent(adv.id);

/** Paragraphes qui ont une variante pour ce mode ou un choix / bloc réservé. */
function adaptedIn(adv, id) {
  return sortIds(Object.entries(adv.sections).filter(([, s]) => (s.variants && s.variants[id]) || [...(s.choices || []), ...(s.blocks || [])].some(x => Array.isArray(x.modes))).map(([k]) => k));
}

function ModeEditor({ adv, mode: m, index: i, count, change, open }) {
  const upd = patch => change(a => { a.rules.modes[i] = clean({ ...a.rules.modes[i], ...patch }) || { id: m.id }; return a; });
  const setRule = (k, v) => upd({ rules: clean({ ...(m.rules || {}), [k]: v }) });
  const setPref = (k, v) => upd({ prefs: clean({ ...(m.prefs || {}), [k]: v }) });
  const move = d => change(a => { const k = i + d; if (k < 0 || k >= a.rules.modes.length) return a; [a.rules.modes[i], a.rules.modes[k]] = [a.rules.modes[k], a.rules.modes[i]]; return a; });
  const remove = async () => {
    const n = Object.values(adv.sections).filter(s => s.variants?.[m.id]).length;
    if (!(await confirmBox(`Supprimer le mode « ${m.label || m.id} » ?${n ? ` Ses variantes (${n} paragraphe${n > 1 ? 's' : ''}) seront effacées.` : ''} Les choix et blocs réservés à ce seul mode ne seront plus visibles nulle part.`, 'Supprimer'))) return;
    change(a => {
      a.rules.modes = a.rules.modes.filter(x => x.id !== m.id);
      const all = a.rules.modes.map(x => x.id);
      for (const s of Object.values(a.sections)) {
        if (s.variants) { delete s.variants[m.id]; if (!Object.keys(s.variants).length) delete s.variants; }
        for (const x of [...(s.choices || []), ...(s.blocks || [])]) {
          if (!Array.isArray(x.modes)) continue;
          x.modes = x.modes.filter(k => k !== m.id);
          if (all.length && all.every(k => x.modes.includes(k))) delete x.modes;
        }
      }
      return a;
    });
  };
  const others = Object.keys(m.rules || {}).filter(k => k !== 'allowBack');
  const adapted = adaptedIn(adv, m.id);
  return html`<section class="panel mode-edit">
    <header>
      <h3 class="row" style="gap:10px"><span class="mode-ico small"><${MIcon} name=${iconOf(adv, m)} /></span>${m.label || m.id}
        ${i === 0 && html`<span class="badge">Par défaut</span>`}</h3>
      <div class="row">
        <span class="subtle mono" title="Identifiant (liens, fichier)">${m.id}</span>
        <button class="btn small" disabled=${i === 0} onClick=${() => move(-1)} aria-label=${`Monter le mode ${m.label || m.id}`}><${Icon} name="up" /></button>
        <button class="btn small" disabled=${i === count - 1} onClick=${() => move(1)} aria-label=${`Descendre le mode ${m.label || m.id}`}><${Icon} name="down" /></button>
        <button class="btn small danger" onClick=${remove}><${Icon} name="trash" />Supprimer</button>
      </div>
    </header>
    <div class="grid2">
      <${Text} label="Nom du mode" value=${m.label} onChange=${v => upd({ label: v })} placeholder="Petit explorateur" />
      <${Text} label="Âges" value=${m.ages} onChange=${v => upd({ ages: v })} placeholder="5-7 ans" />
      <${Select} label="Icône" value=${m.icon || iconOf(adv, m)} onChange=${v => upd({ icon: v })} options=${ICONS} />
    </div>
    <${Text} area rows="2" label="Description (montrée au lecteur quand il choisit)" value=${m.description} onChange=${v => upd({ description: v })} />
    <div class="grid2">
      <${Select} label="Retour en arrière" value=${tri(m.rules?.allowBack)} onChange=${v => setRule('allowBack', fromTri(v))}
        options=${[['', `Comme dans les Règles (${adv.rules.allowBack !== false ? 'autorisé' : 'interdit'})`], ['oui', 'Autorisé'], ['non', 'Interdit']]} />
      <${Select} label="Lecture à voix haute" value=${tri(m.prefs?.ttsAuto)} onChange=${v => setPref('ttsAuto', fromTri(v))}
        options=${[['', 'Au choix du lecteur'], ['oui', 'Automatique à chaque paragraphe'], ['non', 'Désactivée']]} />
      <${Num} label="Taille du texte en px (vide = au choix du lecteur)" value=${m.prefs?.size} min="15" max="28" onChange=${v => setPref('size', v || undefined)} />
    </div>
    <p class="subtle" style="margin:0">Le premier mode de la liste est proposé par défaut. La lecture automatique et la taille du texte s'appliquent pendant la partie ; les réglages du lecteur reviennent ensuite.</p>
    ${others.length > 0 && html`<p class="subtle" style="margin:0">Autres règles modifiées dans ce mode (fichier) : ${others.join(', ')}.</p>`}
    <div class="row">
      <span class="subtle">${adapted.length ? `Paragraphes adaptés : ` : 'Aucun paragraphe adapté pour l’instant (panneau « Variantes selon le mode » de chaque paragraphe).'}</span>
      ${adapted.slice(0, 40).map(id => html`<button class="btn small mono" onClick=${() => open(id)} aria-label=${`Ouvrir le paragraphe ${id}`}>${id}</button>`)}
      ${adapted.length > 40 && html`<span class="subtle">…</span>`}
    </div>
    <div class="row">
      <a class="btn small" href=${`#/jouer/${hashId(adv)}?test=1&mode=${encodeURIComponent(m.id)}`}><${Icon} name="play" />Tester en mode ${m.label || m.id}</a>
      <a class="btn small" href=${`#/imprimer/${hashId(adv)}?mode=${encodeURIComponent(m.id)}`}><${Icon} name="print" />Imprimer cette version</a>
    </div>
  </section>`;
}

const LEVEL = { error: 'Erreur', warning: 'Attention', info: 'Info' };

function ModesCheck({ adv, open }) {
  const modes = M.listModes(adv);
  const problems = useMemo(() => M.validateModes(adv), [adv]);
  const summaries = useMemo(() => modes.map(m => M.modeSummary(adv, m.id)), [adv]);
  const list = pb => html`<ul class="problems">${pb.map(p => html`<li>
    <span class=${'lvl ' + p.level}>${LEVEL[p.level]}</span>
    ${p.section ? html`<button class="btn small mono" onClick=${() => open(p.section)}>${p.section}</button>` : html`<span></span>`}
    <span>${p.message}</span></li>`)}</ul>`;
  const common = problems.filter(p => !p.mode);
  return html`<section class="panel mode-check"><header><h3>Vérifier par mode</h3></header>
    <p class="subtle" style="margin:0">Chaque mode est vérifié comme une aventure à part : seuls comptent les paragraphes qu'on peut atteindre dans ce mode.</p>
    ${common.length > 0 && html`<div class="stack" style="gap:6px"><b>Tous les modes</b>${list(common)}</div>`}
    ${summaries.map(sm => {
      const m = sm.mode;
      const pb = problems.filter(p => p.mode === m.id);
      const errs = pb.filter(p => p.level === 'error').length, warns = pb.filter(p => p.level === 'warning').length;
      return html`<details class="mode-check-one" open=${errs + warns > 0}>
        <summary>
          <span class="mode-ico small"><${MIcon} name=${iconOf(adv, m)} /></span>
          <b>${m.label || m.id}</b>
          <span><b class="mono">${sm.reachable.length}</b> paragraphe${sm.reachable.length > 1 ? 's' : ''} atteignable${sm.reachable.length > 1 ? 's' : ''} sur ${sm.total}</span>
          <span class="row" style="gap:4px"><${Icon} name="crown" /><b class="mono">${sm.victories.length}</b> victoire${sm.victories.length > 1 ? 's' : ''}</span>
          <span class="row" style="gap:4px"><${Icon} name="skull" /><b class="mono">${sm.deaths.length}</b> fin${sm.deaths.length > 1 ? 's' : ''} (mort, capture…)</span>
          <span class=${errs ? 'mode-count bad' : 'mode-count'}>${errs ? `${errs} erreur${errs > 1 ? 's' : ''}` : 'aucune erreur'}${warns ? ` · ${warns} avertissement${warns > 1 ? 's' : ''}` : ''}</span>
        </summary>
        ${pb.length ? list(pb) : html`<p class="outcome ok" style="margin:8px 0 0">Aucun problème dans ce mode.</p>`}
      </details>`;
    })}
  </section>`;
}

function ModesTab({ adv, change, open }) {
  const modes = M.listModes(adv);
  const add = (preset = {}) => change(a => {
    a.rules.modes = Array.isArray(a.rules.modes) ? a.rules.modes : [];
    const label = preset.label || `Mode ${a.rules.modes.length + 1}`;
    a.rules.modes.push({ ...structuredClone(preset), id: M.modeById(a, preset.id) || !preset.id ? M.newModeId(a, label) : preset.id, label, ages: preset.ages || '', description: preset.description || '' });
    return a;
  });
  return html`<div class="ed-form">
    <p class="muted" style="margin:0">Une même aventure, plusieurs versions selon l'âge : le lecteur choisit son mode en créant son héros.
      Dans chaque paragraphe, le panneau <b>Variantes selon le mode</b> permet de raccourcir le texte, changer l'image ou la fin,
      et de montrer ou cacher chaque choix et chaque bloc selon le mode.</p>
    ${!modes.length && html`<div class="panel">
      <p style="margin:0">Aucun mode : l'aventure se joue comme d'habitude, sans écran de choix.</p>
      <div class="row">
        <button class="btn primary" onClick=${() => PRESETS.forEach(p => add(p))}><${Icon} name="plus" />Ajouter trois modes (5-7, 8-9, 10-11 ans)</button>
        <button class="btn" onClick=${() => add()}><${Icon} name="plus" />Ajouter un mode vide</button>
      </div>
    </div>`}
    ${modes.map((m, i) => html`<${ModeEditor} key=${m.id} adv=${adv} mode=${m} index=${i} count=${modes.length} change=${change} open=${open} />`)}
    ${modes.length > 0 && html`<div><button class="btn" onClick=${() => add()}><${Icon} name="plus" />Ajouter un mode</button></div>`}
    ${modes.length > 0 && html`<${ModesCheck} adv=${adv} open=${open} />`}
  </div>`;
}

registerEditorTab({ id: 'modes', order: 60, label: adv => `Modes${M.listModes(adv).length ? ` (${M.listModes(adv).length})` : ''}`, Tab: ModesTab });

/* ------------------------------------------------------------------ */
/* Éditeur : panneau « Variantes selon le mode » d'un paragraphe       */
/* ------------------------------------------------------------------ */

const BLOCK_NAMES = { test: 'Test', roll: 'Table de dés', combat: 'Combat', shop: 'Boutique', spells: 'Formules magiques' };
const blockName = b => BLOCK_NAMES[b.type] || ui.blocks.get(b.type)?.label || b.type;
const blockHint = b => b.label || (b.enemies || []).map(e => e.name).join(', ') || b.title || '';
const ENDINGS = { death: 'mort du héros / fin', victory: 'victoire' };
const endingName = e => (e ? ENDINGS[e] || e : 'aucune');
const KNOWN = ['title', 'text', 'image', 'ending', 'choices', 'blocks', 'onEnter'];

function VariantEditor({ adv, sid, sec, mode: m, modes, change }) {
  const v = (sec.variants && sec.variants[m.id]) || {};
  const setV = patch => change(a => {
    const s = a.sections[sid];
    const next = clean({ ...((s.variants && s.variants[m.id]) || {}), ...patch });
    const all = { ...(s.variants || {}) };
    if (next) all[m.id] = next; else delete all[m.id];
    if (Object.keys(all).length) s.variants = all; else delete s.variants;
    return a;
  });
  const toggle = (key, i, on) => change(a => {
    const x = a.sections[sid][key][i];
    const ids = modes.map(k => k.id);
    const cur = Array.isArray(x.modes) ? x.modes : ids;
    const list = ids.filter(id => (id === m.id ? on : cur.includes(id)));
    if (list.length === ids.length) delete x.modes; else x.modes = list;
    return a;
  });
  const hidden = key => (sec[key] || []).filter(x => !M.visibleIn(x, m.id)).length;
  const others = Object.keys(v).filter(k => !KNOWN.includes(k));
  const status = [
    v.title !== undefined && 'titre', v.text !== undefined && 'texte', v.image !== undefined && (v.image === null ? 'sans image' : 'image'),
    v.ending !== undefined && `fin : ${endingName(v.ending)}`,
    v.choices !== undefined ? 'choix remplacés' : hidden('choices') && `${hidden('choices')} choix caché${hidden('choices') > 1 ? 's' : ''}`,
    v.blocks !== undefined ? 'blocs remplacés' : hidden('blocks') && `${hidden('blocks')} bloc${hidden('blocks') > 1 ? 's' : ''} caché${hidden('blocks') > 1 ? 's' : ''}`,
    v.onEnter !== undefined && 'effets d’entrée', ...others,
  ].filter(Boolean);
  const label = m.label || m.id;
  const eff = M.sectionFor(sec, m.id);
  return html`<details class="mode-variant" open=${status.length > 0}>
    <summary>
      <span class="mode-ico small"><${MIcon} name=${iconOf(adv, m)} /></span>
      <b>${label}</b>${m.ages && html`<span class="subtle">${m.ages}</span>`}
      <span class="mode-status">${status.length ? status.join(' · ') : 'identique à l’original'}</span>
    </summary>
    <div class="stack">
      <${Text} label="Titre dans ce mode (vide = celui de l’original)" value=${v.title ?? ''} placeholder=${sec.title || ''} onChange=${t => setV({ title: t === '' ? undefined : t })} />
      <${Text} area rows="5" label="Texte dans ce mode (vide = texte de l’original)" value=${v.text ?? ''} placeholder=${(sec.text || '').slice(0, 160)} onChange=${t => setV({ text: t === '' ? undefined : t })} />
      ${v.text === undefined && sec.text && html`<div><button class="btn small" onClick=${() => setV({ text: sec.text })}><${Icon} name="edit" />Partir du texte de l'original pour l'adapter</button></div>`}
      <label class="row subtle"><input type="checkbox" checked=${v.image === null} onChange=${e => setV({ image: e.target.checked ? null : undefined })} /> Pas d'illustration dans ce mode</label>
      ${v.image !== null && html`<${ImageSlot} adv=${adv} path=${v.image || null} name=${`p${sid}-${m.id}`} label=${`Illustration pour ce mode (sinon : ${sec.image ? 'celle de l’original' : 'aucune'})`} onChange=${p => setV({ image: p || undefined })} />`}
      <${Select} label="Fin de l'aventure dans ce mode" value=${v.ending === undefined ? 'same' : v.ending === null ? 'none' : v.ending} onChange=${x => setV({ ending: x === 'same' ? undefined : x === 'none' ? null : x })}
        options=${[['same', `Comme l’original (${endingName(sec.ending)})`], ['none', 'Aucune : l’aventure continue'], ['death', 'Mort du héros / fin (capture…)'], ['victory', 'Victoire']]} />
      ${eff.ending && eff.choices.length > 0 && html`<p class="subtle" style="margin:0"><${Icon} name="lock" /> Dans ce mode, ce paragraphe est une fin : ses ${eff.choices.length} choix visibles ne seront pas proposés.</p>`}

      <div class="stack" style="gap:6px">
        <span class="eyebrow">Choix visibles dans ce mode</span>
        ${v.choices !== undefined ? html`<p class="subtle" style="margin:0">Ce mode a sa propre liste de ${v.choices.length} choix (définie dans le fichier) : ${v.choices.map(c => `${c.text || 'Continuer'} → ${c.to}`).join(' ; ')}.</p>
            <div><button class="btn small" onClick=${() => setV({ choices: undefined })}>Revenir aux choix de l'original</button></div>`
          : (sec.choices || []).length ? html`<div class="mode-vis">${sec.choices.map((c, i) => html`<label class="chk">
              <input type="checkbox" checked=${M.visibleIn(c, m.id)} onChange=${e => toggle('choices', i, e.target.checked)} />
              <span>Choix ${i + 1} : ${c.text || 'Continuer'} <span class="mono">→ ${c.to || '?'}</span></span></label>`)}</div>`
          : html`<span class="subtle">Aucun choix dans ce paragraphe.</span>`}
      </div>
      <div class="stack" style="gap:6px">
        <span class="eyebrow">Blocs visibles dans ce mode</span>
        ${v.blocks !== undefined ? html`<p class="subtle" style="margin:0">Ce mode a ses propres blocs (${v.blocks.length}, définis dans le fichier).</p>
            <div><button class="btn small" onClick=${() => setV({ blocks: undefined })}>Revenir aux blocs de l'original</button></div>`
          : (sec.blocks || []).length ? html`<div class="mode-vis">${sec.blocks.map((b, i) => html`<label class="chk">
              <input type="checkbox" checked=${M.visibleIn(b, m.id)} onChange=${e => toggle('blocks', i, e.target.checked)} />
              <span>Bloc ${i + 1} : ${blockName(b)}${blockHint(b) ? ` (${blockHint(b)})` : ''}</span></label>`)}</div>`
          : html`<span class="subtle">Aucun bloc dans ce paragraphe.</span>`}
      </div>
      ${v.onEnter !== undefined && html`<div class="row"><span class="subtle">Ce mode a ses propres effets d'entrée (${v.onEnter.length}, définis dans le fichier).</span>
        <button class="btn small" onClick=${() => setV({ onEnter: undefined })}>Revenir aux effets de l'original</button></div>`}
      ${others.length > 0 && html`<div class="row"><span class="subtle">Autres champs propres à ce mode (fichier) : ${others.join(', ')}.</span>
        <button class="btn small" onClick=${() => setV(Object.fromEntries(others.map(k => [k, undefined])))}>Revenir à l'original</button></div>`}
      <div class="row">
        <a class="btn small" href=${`#/jouer/${hashId(adv)}?test=1&from=${encodeURIComponent(sid)}&mode=${encodeURIComponent(m.id)}`}><${Icon} name="play" />Tester en mode ${label}</a>
        ${status.length > 0 && html`<button class="btn small danger" onClick=${async () => {
          if (await confirmBox(`Effacer les adaptations du paragraphe ${sid} pour le mode « ${label} » ?`, 'Effacer')) change(a => {
            const s = a.sections[sid];
            if (s.variants) { delete s.variants[m.id]; if (!Object.keys(s.variants).length) delete s.variants; }
            for (const x of [...(s.choices || []), ...(s.blocks || [])]) if (Array.isArray(x.modes) && !x.modes.includes(m.id)) { x.modes = [...x.modes, m.id]; if (modes.every(k => x.modes.includes(k.id))) delete x.modes; }
            return a;
          });
        }}><${Icon} name="trash" />Effacer les adaptations</button>`}
      </div>
    </div>
  </details>`;
}

function VariantsPanel({ adv, sid, sec, change }) {
  const modes = M.listModes(adv);
  if (!modes.length) return null;
  return html`<section class="panel mode-variants"><header><h3>Variantes selon le mode</h3></header>
    <p class="subtle" style="margin:0">Ce qui change pour chaque mode. Un champ vide reprend celui de l'original (formulaire ci-dessus).</p>
    ${modes.map(m => html`<${VariantEditor} key=${m.id} adv=${adv} sid=${sid} sec=${sec} mode=${m} modes=${modes} change=${change} />`)}
  </section>`;
}

registerSectionPanel({ id: 'modes', order: 10, Panel: VariantsPanel });

/* ------------------------------------------------------------------ */
/* Version imprimable : une version par mode                           */
/* ------------------------------------------------------------------ */

function PrintModeControl({ adv, value, set }) {
  const modes = M.listModes(adv);
  if (!modes.length) return null;
  const cur = M.resolveMode(adv, value).id;
  const pick = id => {
    set(id);
    // Lien partageable : #/imprimer/<id>?mode=<mode> (sans recharger la page).
    const [path, q = ''] = location.hash.slice(1).split('?');
    const p = new URLSearchParams(q); p.set('mode', id);
    try { history.replaceState(null, '', `#${path}?${p}`); } catch { /* sans importance */ }
  };
  return html`<label class="chk mode-print"><${MIcon} name=${iconOf(adv, M.modeById(adv, cur))} />Version
    <select value=${cur} onChange=${e => pick(e.target.value)} aria-label="Mode de jeu de la version imprimée">
      ${modes.map(m => html`<option value=${m.id}>${M.modeTitle(m)}</option>`)}
    </select></label>`;
}

registerPrintOption({
  id: 'modes', order: 5, Control: PrintModeControl,
  init: query => query?.mode || null,
  apply: (adv, value) => (M.hasModes(adv) ? M.applyMode(adv, value) : adv),
});

registerPrintSection({
  where: 'rules', order: 1,
  Section: ({ adv }) => {
    const m = adv.appliedMode ? M.modeById(adv, adv.appliedMode) : null;
    if (!m) return null;
    return html`<p class="pr-mode"><b>Version « ${m.label || m.id} »</b>${m.ages ? ` (${m.ages})` : ''}.${m.description ? ` ${m.description}` : ''}</p>`;
  },
});
