// Greffon « succes » — interface : suivi des parties (succès, statistiques), bibliothèque, écran de fin,
// Feuille d'Aventure, onglets « Succès » et « Statistiques » de l'éditeur, version imprimable.
// Tout est enregistré dans ce navigateur (magasin clé-valeur des greffons) : rien n'est envoyé sur Internet.
// Voir docs/plugins/succes.md.

import { html, useState, useEffect } from '../../lib/preact-htm.js';
import { Icon, Modal, toast, confirmBox, loadCSS } from '../../ui/common.js';
import { Text, Select, ConditionEditor } from '../../ui/editor.js';
import {
  registerRunHook, registerEndingPanel, registerLibraryExtra, registerEditorTab, registerPrintSection, registerSheetPanel,
} from '../../ui/registry.js';
import { kvGet, kvPut, kvDelete } from '../../store/db.js';
import { loadAdventure } from '../../store/library.js';
import { sfx } from '../../ui/audio.js';
import * as S from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ------------------------------------------------------------------ */
/* Stockage : succès débloqués et statistiques, par aventure           */
/* ------------------------------------------------------------------ */

const KEY = {
  unlocked: id => 'succes|' + id,
  stats: (id, test) => (test ? 'stats-test|' : 'stats|') + id,
};

// Les écritures passent l'une après l'autre : deux clics rapides ne perdent aucune visite.
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn); chain = p.catch(e => console.warn('[greffon succes]', e)); return p; };

// Les écrans ouverts (fin, feuille, éditeur) se rechargent quand les données d'une aventure changent.
const listeners = new Set();
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = advId => listeners.forEach(f => { try { f(advId); } catch (e) { console.warn('[greffon succes]', e); } });

async function readAll(advId) {
  const [u, s, t] = await Promise.all([kvGet(KEY.unlocked(advId)), kvGet(KEY.stats(advId)), kvGet(KEY.stats(advId, true))]);
  return { unlocked: u && typeof u === 'object' ? u : {}, stats: S.normalizeStats(s), statsTest: S.normalizeStats(t) };
}

/** Succès débloqués et statistiques d'une aventure, tenus à jour. null pendant le chargement. */
function useStore(advId) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let on = true;
    const load = () => readAll(advId).then(d => on && setData(d)).catch(() => on && setData({ unlocked: {}, stats: S.emptyStats(), statsTest: S.emptyStats() }));
    load();
    const off = subscribe(id => { if (id === advId) load(); });
    return () => { on = false; off(); };
  }, [advId]);
  return data;
}

/* ------------------------------------------------------------------ */
/* Suivi des parties                                                   */
/* ------------------------------------------------------------------ */

const lastVisited = new Map();  // adv.id → visites de l'état précédent (le premier onUpdate n'a pas de « prev »)
const testHits = new Map();     // adv.id|début de partie → Set des succès qu'une partie de test aurait débloqués
const runKey = (adv, state) => `${adv.id}|${state?.started || ''}`;
const titleOf = (adv, id) => S.achievementsOf(adv).find(a => a.id === id)?.title || id;

function announce(adv, ids, test, delay = 0) {
  if (!ids.length) return;
  const say = () => {
    const titles = ids.map(id => titleOf(adv, id));
    if (titles.length === 1 || (!test && titles.length === 2)) titles.forEach(t => toast(test ? `Succès obtenu (partie de test, non enregistré) : ${t}` : `Succès débloqué : ${t}`));
    else toast(`${titles.length} succès ${test ? 'obtenus (partie de test, non enregistrés)' : 'débloqués'} : ${titles.join(', ')}`);
    sfx.coin();
  };
  if (delay) setTimeout(say, delay); else say();
}

/** Débloque (ou, en test, note seulement) les succès remplis. Renvoie les nouveaux. */
async function unlock(adv, state, phase, test, delay = 0) {
  const ids = S.evaluateAchievements(adv, state, phase);
  if (!ids.length) return [];
  if (test) {
    const k = runKey(adv, state);
    const hits = testHits.get(k) || new Set();
    const fresh = ids.filter(id => !hits.has(id));
    fresh.forEach(id => hits.add(id));
    testHits.set(k, hits);
    announce(adv, fresh, true, delay);
    return fresh;
  }
  const unlocked = (await kvGet(KEY.unlocked(adv.id))) || {};
  const fresh = ids.filter(id => !unlocked[id]);
  if (!fresh.length) return [];
  const now = new Date().toISOString();
  await kvPut(KEY.unlocked(adv.id), { ...unlocked, ...Object.fromEntries(fresh.map(id => [id, now])) });
  announce(adv, fresh, false, delay);
  return fresh;
}

registerRunHook({
  id: 'succes',
  onStart(adv, state, { test } = {}) {
    if (!adv || !state) return;
    lastVisited.set(adv.id, state.visited || {});
    if (test) testHits.set(runKey(adv, state), new Set());
    const now = new Date().toISOString();
    return serial(async () => {
      const k = KEY.stats(adv.id, test);
      await kvPut(k, S.statsOnStart(await kvGet(k), state, now));
      await unlock(adv, state, 'anytime', test);
      emit(adv.id);
    });
  },
  onUpdate(adv, prev, next, { test } = {}) {
    if (!adv || !next) return;
    const diff = S.visitDiff(prev?.visited || lastVisited.get(adv.id) || {}, next.visited || {});
    lastVisited.set(adv.id, next.visited || {});
    const hasVisits = Object.keys(diff).length > 0;
    const candidates = S.evaluateAchievements(adv, next, 'anytime');
    if (!hasVisits && !candidates.length) return;
    const now = new Date().toISOString();
    return serial(async () => {
      if (hasVisits) { const k = KEY.stats(adv.id, test); await kvPut(k, S.addVisits(await kvGet(k), diff, now)); }
      if (candidates.length) await unlock(adv, next, 'anytime', test);
      emit(adv.id);
    });
  },
  onEnd(adv, state, { test } = {}) {
    if (!adv || !state?.ended) return;
    const now = new Date().toISOString();
    return serial(async () => {
      const k = KEY.stats(adv.id, test);
      await kvPut(k, S.statsOnEnd(await kvGet(k), state, now));
      await unlock(adv, state, 'end', test, 1200); // après la musique de victoire ou de mort
      emit(adv.id);
    });
  },
});

/* ------------------------------------------------------------------ */
/* Petits composants partagés                                          */
/* ------------------------------------------------------------------ */

const isTestRun = () => /[?&]test=1(&|$)/.test(location.hash);
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } };
const fmtDateTime = iso => { try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }); } catch { return ''; } };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const secLabel = (adv, sid) => { const s = adv.sections?.[sid]; return s ? (s.title || String(s.text || '').replace(/[*_#>]/g, '').slice(0, 60) || '(vide)') : '(ce paragraphe n’existe plus)'; };

/** Jauge : libellé et chiffres au-dessus, barre continue ou cases (une par fin / par succès). */
function Meter({ label, n, total, text, percent }) {
  const segmented = !percent && total > 0 && total <= 12;
  const width = percent ? Math.max(0, Math.min(100, n)) : S.pct(n, total);
  return html`<div class="sc-meter">
    <span class="sc-meter-head"><span>${label}</span><b class="mono">${text}</b></span>
    ${segmented
      ? html`<span class="sc-seg" aria-hidden="true">${Array.from({ length: total }, (_, i) => html`<i class=${i < n ? 'on' : ''}></i>`)}</span>`
      : html`<span class="sc-bar" aria-hidden="true"><i style=${`width:${width}%`}></i></span>`}
  </div>`;
}

/** Une ligne de succès : coche + date si débloqué, cadenas sinon, « ??? » pour un secret. */
function Item({ a, at, isNew, test }) {
  const v = S.achievementView(a, test ? 'test' : at);
  const state = test ? 'Obtenu en test (non enregistré)' : v.unlocked ? `Débloqué le ${fmtDate(v.date)}` : v.hidden ? 'Secret' : 'Verrouillé';
  return html`<li class=${'sc-item ' + (v.unlocked ? 'is-on' : 'is-off') + (v.hidden ? ' is-secret' : '')}>
    <span class="sc-ico"><${Icon} name=${v.unlocked ? 'check' : 'lock'} /></span>
    <span class="sc-txt">
      <b>${v.title}${isNew && html` <span class="sc-new-tag"><${Icon} name="star" />Nouveau</span>`}</b>
      ${v.description && html`<span class="sc-desc">${v.description}</span>`}
    </span>
    <span class="sc-state">${state}</span>
  </li>`;
}

function AchList({ adv, unlocked, fresh = [], label }) {
  return html`<ul class="sc-list" aria-label=${label}>${S.achievementsOf(adv).map(a => html`<${Item} key=${a.id} a=${a} at=${unlocked?.[a.id]} isNew=${fresh.includes(a.id)} />`)}</ul>`;
}

/* ------------------------------------------------------------------ */
/* Bibliothèque : « Exploré 34 % · Fins 2/5 · Succès 3/8 »             */
/* ------------------------------------------------------------------ */

function LibraryExtra({ entry }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    let on = true;
    Promise.all([loadAdventure(entry.id), readAll(entry.id)])
      .then(([{ adventure }, d]) => on && setP(S.progress(adventure, d.stats, d.unlocked)))
      .catch(() => { /* aventure illisible : pas de progression */ });
    return () => { on = false; };
  }, [entry.id, entry.updated]);
  if (!p || (!p.runs && !p.achievements.total)) return null;
  const parts = [`Exploré ${p.explored.pct} %`];
  if (p.endings.total) parts.push(`Fins ${p.endings.n}/${p.endings.total}`);
  if (p.achievements.total) parts.push(`Succès ${p.achievements.n}/${p.achievements.total}`);
  const sentence = `Progression : ${parts.join(' · ')}`;
  return html`<div class="sc-lib" role="group" aria-label=${sentence} title=${`${sentence}${p.runs ? ` (${plural(p.runs, 'partie', 'parties')})` : ''}`}>
    <${Meter} label="Exploré" n=${p.explored.pct} text=${`${p.explored.pct} %`} percent />
    ${p.endings.total > 0 && html`<${Meter} label="Fins" n=${p.endings.n} total=${p.endings.total} text=${`${p.endings.n}/${p.endings.total}`} />`}
    ${p.achievements.total > 0 && html`<${Meter} label="Succès" n=${p.achievements.n} total=${p.achievements.total} text=${`${p.achievements.n}/${p.achievements.total}`} />`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Écran de fin                                                        */
/* ------------------------------------------------------------------ */

function EndingPanel({ adv, state }) {
  const store = useStore(adv.id);
  const test = isTestRun();
  const list = S.achievementsOf(adv);
  if (!store) return null;
  const p = S.progress(adv, store.stats, store.unlocked);
  const since = state.started || null;
  const fresh = test
    ? [...new Set([...(testHits.get(runKey(adv, state)) || []), ...S.evaluateAchievements(adv, state, 'end')])]
    : since ? list.filter(a => store.unlocked[a.id] && store.unlocked[a.id] >= since).map(a => a.id) : [];
  const progressLine = !test && p.runs > 0 && html`<p class="subtle sc-progress">
    Toutes parties confondues : aventure explorée à ${p.explored.pct} %${p.endings.total ? ` · fins découvertes : ${p.endings.n} sur ${p.endings.total}` : ''} · ${plural(p.runs, 'partie', 'parties')}.</p>`;
  if (!list.length) return progressLine || null;
  const byId = Object.fromEntries(list.map(a => [a.id, a]));
  return html`<section class="sc-panel" aria-label="Succès">
    <h3><${Icon} name="star" />Succès<span class="sc-count" aria-label=${`${p.achievements.n} succès débloqués sur ${p.achievements.total}`}>${p.achievements.n} / ${p.achievements.total}</span></h3>
    ${test && html`<p class="subtle sc-note"><${Icon} name="flag" />Partie de test : aucun succès n'est enregistré. Voici ceux que cette partie aurait débloqués.</p>`}
    <div class="stack" style="gap:6px">
      <span class="eyebrow">Pendant cette partie</span>
      ${fresh.length
        ? html`<ul class="sc-list" aria-label="Succès obtenus pendant cette partie">${fresh.filter(id => byId[id]).map(id => html`<${Item} key=${id} a=${byId[id]} at=${store.unlocked[id]} isNew=${!test} test=${test} />`)}</ul>`
        : html`<p class="subtle" style="margin:0">Aucun nouveau succès cette fois-ci.</p>`}
    </div>
    <details class="sc-all" open=${list.length <= 8}>
      <summary><b>Tous les succès</b> <span class="subtle">(${p.achievements.n} débloqué${p.achievements.n > 1 ? 's' : ''} sur ${p.achievements.total})</span></summary>
      <${AchList} adv=${adv} unlocked=${store.unlocked} fresh=${test ? [] : fresh} label="Tous les succès" />
    </details>
    ${progressLine}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Feuille d'Aventure : compteur et liste                              */
/* ------------------------------------------------------------------ */

function SheetPanel({ adv }) {
  const store = useStore(adv.id);
  const [open, setOpen] = useState(false);
  const list = S.achievementsOf(adv);
  if (!list.length || !store) return null;
  const n = list.filter(a => store.unlocked[a.id]).length;
  return html`<div class="stack sc-sheet" style="gap:6px">
    <span class="eyebrow">Succès</span>
    <${Meter} label="Débloqués" n=${n} total=${list.length} text=${`${n} sur ${list.length}`} />
    <div><button class="btn small" onClick=${() => setOpen(true)}><${Icon} name="star" />Voir les succès</button></div>
    ${open && html`<${Modal} title=${`Succès — ${n} sur ${list.length}`} onClose=${() => setOpen(false)}>
      ${isTestRun() && html`<p class="subtle" style="margin:0">Partie de test : les succès obtenus maintenant ne sont pas enregistrés.</p>`}
      <${AchList} adv=${adv} unlocked=${store.unlocked} label="Liste des succès" />
    <//>`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Éditeur : onglet « Succès »                                         */
/* ------------------------------------------------------------------ */

const WHEN_OPTIONS = [['end', 'À la fin de la partie'], ['anytime', 'En pleine partie, dès que la condition est remplie']];
const ENDING_OPTIONS = [['', 'Victoire ou mort'], ['victory', 'Victoire seulement'], ['death', 'Mort du héros seulement']];

function templates(current) {
  return [
    { label: 'Victoire', base: 'victoire', data: { title: 'Victorieux', description: 'Terminer l’aventure par une victoire.', when: 'end', ending: 'victory' } },
    { label: 'Première mort', base: 'premiere-mort', data: { title: 'Première chute', description: 'Mourir une première fois. Cela arrive aux meilleurs.', when: 'end', ending: 'death' } },
    { label: 'Fortune', base: 'fortune', data: { title: 'Fortune faite', description: 'Finir victorieux avec au moins 20 Pièces d’Or.', when: 'end', ending: 'victory', cond: { gold: true, gte: 20 } } },
    current && { label: `Passage par le ${current}`, base: `decouverte-${current}`, data: { title: 'Découverte', description: 'Trouver un endroit que peu d’aventuriers ont vu.', secret: true, when: 'anytime', cond: { visited: current } } },
  ].filter(Boolean);
}

function AchievementsTab({ adv, change, current }) {
  const store = useStore(adv.id);
  const list = Array.isArray(adv.achievements) ? adv.achievements : [];
  const edit = (i, patch) => change(a => { a.achievements = (a.achievements || []).map((x, j) => (j === i ? { ...x, ...patch } : x)); return a; });
  const add = (base, data) => change(a => {
    const l = Array.isArray(a.achievements) ? a.achievements : [];
    a.achievements = [...l, S.normalizeAchievement({ ...data, id: S.uniqueId(base, l.map(x => x?.id)) })];
    return a;
  });
  const move = (i, d) => change(a => { const l = a.achievements; const k = i + d; if (k < 0 || k >= l.length) return a; [l[i], l[k]] = [l[k], l[i]]; return a; });
  const remove = async i => {
    if (await confirmBox(`Supprimer le succès « ${list[i].title || list[i].id} » ?`, 'Supprimer')) change(a => { a.achievements = a.achievements.filter((_, j) => j !== i); return a; });
  };
  const relock = async () => {
    if (!(await confirmBox(`Reverrouiller tous les succès de « ${adv.meta.title} » sur cet appareil ? Les joueurs des autres appareils ne sont pas concernés.`, 'Reverrouiller'))) return;
    await kvDelete(KEY.unlocked(adv.id)); emit(adv.id); toast('Succès reverrouillés sur cet appareil.');
  };
  const nUnlocked = store ? list.filter(a => store.unlocked[a.id]).length : 0;
  return html`<div class="ed-form sc-ed">
    <p class="muted" style="margin:0">Les succès récompensent le joueur : atteindre une fin, trouver un paragraphe caché, finir avec un objet… Ils s'affichent sur l'écran de fin, dans la Feuille d'Aventure et sur la carte de l'aventure dans la bibliothèque. Un succès secret reste caché (« ??? ») tant qu'il n'est pas obtenu. Les parties lancées avec « Tester d'ici » n'en débloquent aucun.</p>
    <div class="row">
      <button class="btn primary" onClick=${() => add('succes', { title: 'Nouveau succès', description: '', when: 'end' })}><${Icon} name="plus" />Nouveau succès</button>
      <span class="subtle">Modèles :</span>
      ${templates(current).map(t => html`<button class="btn small" onClick=${() => add(t.base, t.data)}><${Icon} name="plus" />${t.label}</button>`)}
    </div>
    ${!list.length && html`<p class="subtle">Aucun succès pour l'instant. Commencez par un modèle, puis modifiez son titre et sa description.</p>`}
    ${list.map((a, i) => {
      const problems = S.achievementProblems(a, adv);
      const at = store?.unlocked?.[a.id];
      return html`<section class="panel sc-ed-item" key=${i + ':' + a.id}>
        <header>
          <h3 class="sc-ed-title"><span class="sc-num mono">${i + 1}</span><span>${a.title || 'Sans titre'}</span>
            ${a.secret && html`<span class="badge"><${Icon} name="lock" />Secret</span>`}
            <span class="subtle mono">${a.id}</span></h3>
          <div class="row">
            <button class="btn small" aria-label=${`Monter le succès ${i + 1}`} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} name="up" /></button>
            <button class="btn small" aria-label=${`Descendre le succès ${i + 1}`} disabled=${i === list.length - 1} onClick=${() => move(i, 1)}><${Icon} name="down" /></button>
            <button class="btn small danger" onClick=${() => remove(i)}><${Icon} name="trash" />Supprimer</button>
          </div>
        </header>
        ${problems.length > 0 && html`<ul class="problems">${problems.map(m => html`<li><span class="lvl warning">Attention</span><span></span><span>${m}</span></li>`)}</ul>`}
        <div class="grid2">
          <${Text} label="Titre" value=${a.title} onChange=${v => edit(i, { title: v })} placeholder="Explorateur des brumes" />
          <${Select} label="Moment" value=${a.when} onChange=${v => edit(i, v === 'anytime' ? { when: v, ending: null } : { when: v })} options=${WHEN_OPTIONS} />
          ${a.when !== 'anytime' && html`<${Select} label="Fin concernée" value=${a.ending || ''} onChange=${v => edit(i, { ending: v || null })} options=${ENDING_OPTIONS} />`}
        </div>
        <${Text} area rows="2" label="Description (ce que lit le joueur)" value=${a.description} onChange=${v => edit(i, { description: v })} placeholder="Traverser le marais sans perdre un seul point d’Endurance." />
        <label class="row"><input type="checkbox" checked=${!!a.secret} onChange=${e => edit(i, { secret: e.target.checked })} /> Succès secret : titre et description cachés (« ??? ») tant qu'il n'est pas débloqué</label>
        <${ConditionEditor} adv=${adv} value=${a.cond} onChange=${v => edit(i, { cond: v })} />
        <p class="sc-sum"><${Icon} name="flag" /><span>${S.describeAchievement(a, adv)}</span></p>
        <p class="subtle" style="margin:0">${at ? html`<${Icon} name="check" /> Débloqué sur cet appareil le ${fmtDate(at)}.` : html`<${Icon} name="lock" /> Pas encore débloqué sur cet appareil.`}</p>
      </section>`;
    })}
    ${nUnlocked > 0 && html`<div class="row"><button class="btn small danger" onClick=${relock}><${Icon} name="lock" />Reverrouiller les succès sur cet appareil (${nUnlocked})</button></div>`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Éditeur : onglet « Statistiques » (vue auteur)                      */
/* ------------------------------------------------------------------ */

function Tile({ icon, label, value, sub }) {
  return html`<div class="sc-tile"><span class="k"><${Icon} name=${icon} />${label}</span><b class="v mono">${value}</b>${sub && html`<span class="subtle">${sub}</span>`}</div>`;
}

function Share({ n, total }) {
  const p = S.pct(n, total);
  return html`<span class="sc-share"><span class="sc-bar" aria-hidden="true"><i style=${`width:${p}%`}></i></span><span class="mono">${p} %</span></span>`;
}

function SecButton({ adv, sid, open }) {
  return adv.sections?.[sid]
    ? html`<button class="btn small mono" onClick=${() => open(sid)} aria-label=${`Ouvrir le paragraphe ${sid}`}>${sid}</button>`
    : html`<span class="mono sc-gone">${sid}</span>`;
}

function StatsTab({ adv, open }) {
  const store = useStore(adv.id);
  const [mode, setMode] = useState('real');
  if (!store) return html`<div class="ed-form"><p class="muted">Chargement…</p></div>`;
  const test = mode === 'test';
  const st = test ? store.statsTest : store.stats;
  const finished = st.victories + st.deaths;
  const unfinished = Math.max(0, st.runs - finished);
  const deaths = S.deathRanking(st, 12);
  const ends = S.endingsReached(adv, st);
  const never = S.neverVisited(adv, st);
  const top = S.mostVisited(st, 8);
  const total = Object.keys(adv.sections).length;
  const reset = async () => {
    if (!(await confirmBox(`Remettre à zéro les statistiques des ${test ? 'parties de test' : 'parties réelles'} de « ${adv.meta.title} » sur cet appareil ?`, 'Remettre à zéro'))) return;
    await kvDelete(KEY.stats(adv.id, test)); emit(adv.id); toast('Statistiques remises à zéro.');
  };
  return html`<div class="ed-form sc-stats">
    <p class="muted" style="margin:0">Parties jouées sur cet appareil (rien n'est envoyé sur Internet). Les parties lancées avec « Tester d'ici » sont comptées à part.</p>
    <div class="seg" role="group" aria-label="Parties comptées">
      <button aria-pressed=${String(!test)} onClick=${() => setMode('real')}>Parties réelles (${store.stats.runs})</button>
      <button aria-pressed=${String(test)} onClick=${() => setMode('test')}>Parties de test (${store.statsTest.runs})</button>
    </div>
    ${!st.runs && !finished ? html`<p class="muted sc-empty">Aucune ${test ? 'partie de test' : 'partie'} enregistrée pour l'instant. ${test ? 'Utilisez « Tester d’ici » pour en lancer une.' : 'Jouez l’aventure (bouton « Jouer ») pour remplir ces statistiques.'}</p>` : html`
      <div class="sc-tiles">
        <${Tile} icon="play" label="Parties" value=${st.runs} sub=${st.lastPlayed ? `dernière : ${fmtDateTime(st.lastPlayed)}` : ''} />
        <${Tile} icon="crown" label="Victoires" value=${st.victories} sub=${`${S.pct(st.victories, st.runs)} % des parties`} />
        <${Tile} icon="skull" label="Morts" value=${st.deaths} sub=${`${S.pct(st.deaths, st.runs)} % des parties`} />
        <${Tile} icon="stop" label="Sans fin" value=${unfinished} sub="abandonnées ou en cours" />
      </div>

      <section class="panel"><header><h3><${Icon} name="skull" />Où l'on meurt le plus</h3><span class="subtle">${plural(st.deaths, 'mort', 'morts')}</span></header>
        ${deaths.length ? html`<table class="sc-table">
          <thead><tr><th scope="col">Paragraphe</th><th scope="col">Morts</th><th scope="col">Part des morts</th></tr></thead>
          <tbody>${deaths.map(d => html`<tr>
            <td><span class="sc-secline"><${SecButton} adv=${adv} sid=${d.sid} open=${open} /><span class="sc-sectitle">${secLabel(adv, d.sid)}</span>
              ${adv.sections[d.sid] && !adv.sections[d.sid].ending && html`<span class="badge">hors fin</span>`}</span></td>
            <td class="mono">${d.n}</td>
            <td><${Share} n=${d.n} total=${st.deaths} /></td>
          </tr>`)}</tbody></table>
          <p class="subtle" style="margin:0">« hors fin » : mort au combat ou par épuisement, sur un paragraphe qui n'est pas une fin.</p>`
        : html`<p class="subtle" style="margin:0">Personne n'est encore mort.</p>`}
      </section>

      <section class="panel"><header><h3><${Icon} name="crown" />Fins atteintes</h3><span class="subtle">${ends.filter(e => e.n).length} sur ${ends.length}</span></header>
        ${ends.length ? html`<ul class="sc-ends">${ends.map(e => html`<li class=${e.n ? 'is-on' : 'is-off'}>
          <span class="sc-kind"><${Icon} name=${e.kind === 'victory' ? 'crown' : 'skull'} />${e.kind === 'victory' ? 'Victoire' : e.kind === 'death' ? 'Mort' : e.kind}</span>
          <span class="sc-secline"><${SecButton} adv=${adv} sid=${e.sid} open=${open} /><span class="sc-sectitle">${secLabel(adv, e.sid)}</span></span>
          <span class="sc-times">${e.n ? `atteinte ${e.n} fois` : 'jamais atteinte'}</span>
        </li>`)}</ul>` : html`<p class="subtle" style="margin:0">Aucun paragraphe n'est marqué comme une fin.</p>`}
      </section>

      <section class="panel"><header><h3><${Icon} name="map" />Paragraphes jamais lus</h3><span class="subtle">${never.length} sur ${total}</span></header>
        ${never.length ? html`<div class="sc-chips">${never.slice(0, 80).map(sid => html`<${SecButton} adv=${adv} sid=${sid} open=${open} />`)}${never.length > 80 && html`<span class="subtle">… et ${never.length - 80} autres</span>`}</div>`
          : html`<p class="subtle" style="margin:0">Tous les paragraphes ont été lus au moins une fois.</p>`}
      </section>

      ${top.length > 0 && html`<section class="panel"><header><h3><${Icon} name="book" />Paragraphes les plus lus</h3></header>
        <table class="sc-table"><thead><tr><th scope="col">Paragraphe</th><th scope="col">Lectures</th><th scope="col">Par rapport au plus lu</th></tr></thead>
          <tbody>${top.map(v => html`<tr><td><span class="sc-secline"><${SecButton} adv=${adv} sid=${v.sid} open=${open} /><span class="sc-sectitle">${secLabel(adv, v.sid)}</span></span></td>
            <td class="mono">${v.n}</td><td><${Share} n=${v.n} total=${top[0].n} /></td></tr>`)}</tbody></table>
      </section>`}
    `}
    <div class="row"><button class="btn danger" disabled=${!st.runs && !finished && !Object.keys(st.visited).length} onClick=${reset}><${Icon} name="trash" />Remettre à zéro</button>
      <span class="subtle">${test ? 'Efface seulement les parties de test.' : 'Efface seulement les parties réelles.'}</span></div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Version imprimable : liste à cocher                                 */
/* ------------------------------------------------------------------ */

function PrintSection({ adv }) {
  const list = S.achievementsOf(adv);
  if (!list.length) return null;
  const hint = a => (a.ending === 'victory' ? ' (en cas de victoire)' : a.ending === 'death' ? ' (à la mort du héros)' : '');
  return html`<div class="sc-print">
    <h2>Succès</h2>
    <p>Cochez un succès dès que vous l'obtenez. Les succès secrets ne se dévoilent qu'en jouant : quand vous en découvrez un, notez son nom sur la ligne.</p>
    <ul class="sc-pr-list">${list.map(a => html`<li>
      <span class="sc-pr-box" aria-hidden="true"></span>
      ${a.secret
        ? html`<span><b>???</b> <span class="pr-small">Succès secret :</span> <span class="sc-pr-line"></span></span>`
        : html`<span><b>${a.title || a.id}</b>${a.description ? html` — ${a.description}` : hint(a)}</span>`}
    </li>`)}</ul>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Enregistrement                                                      */
/* ------------------------------------------------------------------ */

registerLibraryExtra({ id: 'succes', order: 60, Extra: LibraryExtra });
registerEndingPanel({ id: 'succes', order: 60, Panel: EndingPanel });
registerSheetPanel({ id: 'succes', order: 80, Panel: SheetPanel });
registerEditorTab({ id: 'succes', order: 60, label: adv => `Succès${adv.achievements?.length ? ` (${adv.achievements.length})` : ''}`, Tab: AchievementsTab });
registerEditorTab({ id: 'statistiques', order: 61, label: () => 'Statistiques', Tab: StatsTab });
registerPrintSection({ id: 'succes', where: 'appendix', order: 60, Section: PrintSection });
