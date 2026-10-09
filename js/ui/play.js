// Écran de jeu : création du héros, lecture, blocs interactifs, feuille d'aventure, fins.

import { html, useState, useEffect, useRef, useMemo } from '../lib/preact-htm.js';
import { Icon, Dice, Prose, AssetImg, Modal, toast, confirmBox, InlineText, loadGraphLibs } from './common.js';
import { loadAdventure, assetUrl } from '../store/library.js';
import { sfx, ambience, speak, stopSpeaking, ttsAvailable } from './audio.js';
import { prefs } from './common.js';
import { putSave, listSaves, deleteSave } from '../store/db.js';
import * as R from '../core/rules.js';
import * as C from '../core/combat.js';
import { ui, sorted, runHooks, effectiveAdventure } from './registry.js';

export function Play({ id, query }) {
  const [adv, setAdv] = useState(null);
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | menu | create | read
  const [saves, setSaves] = useState([]);
  const [game, setGame] = useState(null);         // { state, messages, stamp }
  const slot = useRef('auto');
  const test = !!query.test;
  // Aventure effective d'une partie (greffons : mode de jeu…), en cache par aventure et par state.mode.
  const effCache = useRef({ adv: null, map: new Map() });
  const effective = (a, state) => {
    if (effCache.current.adv !== a) effCache.current = { adv: a, map: new Map() };
    const { map } = effCache.current, key = JSON.stringify(state?.mode ?? null);
    if (!map.has(key)) map.set(key, effectiveAdventure(a, state));
    return map.get(key);
  };

  useEffect(() => {
    loadAdventure(id).then(async ({ adventure, source }) => {
      setAdv(adventure); setSource(source);
      if (test) {
        const ctx = { test, query };
        const a = effective(adventure, prepareHero(R.createHero(adventure, { seed: 1 }).state, adventure, {}, ctx));
        const { state } = R.createHero(a, { classId: query.class });
        prepareHero(state, adventure, {}, ctx);
        const r = R.start(state, a, query.from || a.start);
        runHooks('onStart', a, r.state, { test });
        setGame({ state: r.state, messages: r.messages, stamp: 1 });
        setPhase('read');
        return;
      }
      const list = await listSaves(adventure.id);
      setSaves(list);
      setPhase(list.length ? 'menu' : 'create');
    }).catch(e => setError(e.message));
  }, [id]);

  const update = (state, messages = []) => {
    const a = effective(adv, state);
    setGame(g => {
      const prev = g?.state || null;
      runHooks('onUpdate', a, prev, state, { test });
      if (state.ended && !prev?.ended) runHooks('onEnd', a, state, { test });
      // messages === null : mise à jour discrète (sac regardé, notes) qui garde les messages affichés.
      return { state, messages: messages === null ? (g?.messages || []) : messages, stamp: (g?.stamp || 0) + 1 };
    });
    if (!test) putSave(adv.id, slot.current, { state, title: adv.meta.title, section: state.section, hero: state.hero.name });
  };

  if (error) return html`<main class="page"><h1>Impossible d'ouvrir l'aventure</h1><p>${error}</p><a class="btn" href="#/">Retour à la bibliothèque</a></main>`;
  if (phase === 'loading') return html`<main class="page"><p class="muted">Chargement…</p></main>`;

  if (phase === 'menu') return html`<main class="creator">
    <span class="eyebrow">${adv.meta.title}</span>
    <h1>Reprendre une partie ?</h1>
    <div class="stack">
      ${saves.map(s => html`<div class="rollrow" key=${s.slot}>
        <div><b>${s.hero || 'Héros'}</b><div class="subtle">${endLabel(effective(adv, s.state), s.state) || `Paragraphe ${s.section}`}</div></div>
        <span class="subtle">${new Date(s.savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${s.slot === 'auto' ? ' · automatique' : ''}</span>
        <div class="row">
          <button class="btn primary small" onClick=${() => { slot.current = s.slot; setGame({ state: s.state, messages: [], stamp: 1 }); setPhase('read'); }}>Reprendre</button>
          <button class="btn small danger" aria-label="Supprimer la sauvegarde" onClick=${async () => { await deleteSave(adv.id, s.slot); const l = await listSaves(adv.id); setSaves(l); if (!l.length) setPhase('create'); }}><${Icon} name="trash" /></button>
        </div>
      </div>`)}
    </div>
    <div><button class="btn" onClick=${() => setPhase('create')}><${Icon} name="plus" />Nouvelle partie</button></div>
  </main>`;

  if (phase === 'create') return html`<${Creator} adv=${adv} source=${source} query=${query} onStart=${state => {
    slot.current = 'auto';
    const a = effective(adv, state);
    const r = R.start(state, a, a.start);
    runHooks('onStart', a, r.state, { test });
    update(r.state, r.messages);
    setPhase('read');
  }} />`;

  return html`<${Reader} adv=${effective(adv, game.state)} source=${source} game=${game} update=${update} test=${test}
    onRestart=${() => { setGame(null); setPhase('create'); }}
    onSaveAs=${async () => { const s = 'p' + Date.now(); await putSave(adv.id, s, { state: game.state, title: adv.meta.title, section: game.state.section, hero: game.state.hero.name }); toast('Partie sauvegardée.'); }} />`;
}

/* ------------------------------------------------------------------ */
/* Création du héros                                                   */
/* ------------------------------------------------------------------ */

/** Les greffons de la création (mode de jeu…) complètent l'état du héros ; `choices` = choix de leurs panneaux, par id. */
function prepareHero(state, adv, choices = {}, ctx = {}) {
  for (const p of sorted(ui.creatorPanels)) p.beforeStart?.(state, choices[p.id], adv, ctx);
  return state;
}

function Creator({ adv: loaded, source, query = {}, onStart }) {
  const [choices, setChoices] = useState({});
  // Aventure dans laquelle le héros sera créé : les choix des panneaux (mode de jeu…) peuvent en changer les règles.
  const adv = useMemo(() => effectiveAdventure(loaded, prepareHero(R.createHero(loaded, { seed: 1 }).state, loaded, choices, { test: false, query })), [loaded, choices]);
  const classes = adv.rules.classes || [];
  const [classId, setClassId] = useState(classes[0]?.id || null);
  const [name, setName] = useState('');
  const [hero, setHero] = useState(null);
  const [stamp, setStamp] = useState(0);
  const rollAll = () => { setHero(R.createHero(adv, { classId, name: name.trim() || 'Héros' })); setStamp(s => s + 1); };
  const rulesSig = JSON.stringify(adv.rules);
  useEffect(() => { setHero(null); }, [classId, rulesSig]);
  const cls = classes.find(c => c.id === classId);
  const rows = [...adv.rules.stats.map(s => ({ id: s.id, label: s.label, expr: cls?.rolls?.[s.id] || s.roll })),
    { id: 'gold', label: 'Pièces d’or', expr: cls?.gold || adv.rules.gold || '0' }].filter(r => r.id !== 'gold' || r.expr !== '0');
  const panel = p => html`<${p.Panel} key=${p.id} adv=${adv} classId=${classId} hero=${hero} query=${query} choice=${choices[p.id]} setChoice=${v => setChoices(c => ({ ...c, [p.id]: v }))} />`;

  return html`<main class="creator">
    <div class="stack" style="gap:6px">
      <span class="eyebrow">${adv.meta.title}</span>
      <h1>Votre héros</h1>
      ${adv.meta.description && html`<p class="muted" style="margin:0">${adv.meta.description}</p>`}
    </div>
    ${adv.meta.cover && html`<div class="illus"><${AssetImg} adv=${adv} source=${source} path=${adv.meta.cover} alt="" /></div>`}
    ${sorted(ui.creatorPanels).filter(p => p.place === 'top').map(panel)}
    <label class="field">Nom du héros<input type="text" id="hero-name" value=${name} onInput=${e => setName(e.target.value)} placeholder="Héros" /></label>
    ${classes.length > 1 && html`<div class="stack" style="gap:8px"><span class="eyebrow">Classe</span>
      <div class="classes">${classes.map(c => html`<button class="class-opt" aria-pressed=${c.id === classId} onClick=${() => setClassId(c.id)}><b>${c.label}</b><span class="subtle">${c.description || ''}</span></button>`)}</div></div>`}
    <div class="rolls">
      ${rows.map(r => html`<div class="rollrow" key=${r.id}>
        <b>${r.label}</b>
        <span class="formula">${r.expr}</span>
        ${hero ? html`<${Dice} result=${hero.rolls[r.id]} stamp=${stamp} />` : html`<span class="muted">—</span>`}
      </div>`)}
      <div class="rollrow"><b>Repas</b><span class="formula">${cls?.provisions ?? adv.rules.provisions ?? 0}</span><span class="dice-total">${cls?.provisions ?? adv.rules.provisions ?? 0}</span></div>
    </div>
    ${sorted(ui.creatorPanels).filter(p => p.place !== 'top').map(panel)}
    <div class="row">
      <button class="btn ${hero ? '' : 'primary'}" onClick=${rollAll}><${Icon} name="dice" />${hero ? 'Relancer les dés' : 'Lancer les dés'}</button>
      <button class="btn primary" disabled=${!hero} onClick=${() => { const s = structuredClone(hero.state); s.hero.name = name.trim() || 'Héros'; prepareHero(s, loaded, choices, { test: false, query }); onStart(s); }}><${Icon} name="play" />Commencer l'aventure</button>
    </div>
  </main>`;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

function Reader({ adv, source, game, update, test, onRestart, onSaveAs }) {
  const { state, messages, stamp } = game;
  const sec = adv.sections[state.section];
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [map, setMap] = useState(false);
  const [bag, setBag] = useState(null); // null = sac fermé ; sinon l'onglet à ouvrir ('' = le premier)
  const bagRef = useRef(bag);
  bagRef.current = bag;
  const topRef = useRef();
  const [talking, setTalking] = useState(false);
  const readAloud = () => {
    // Les blocs visibles (défi, carte…) se lisent aussi : question, propositions, consigne (voir `speech` dans registry.js).
    const blockLines = state.ended ? [] : (sec.blocks || []).map((b, i) => { try { return ui.blocks.get(b.type)?.speech?.(b, { adv, state, index: i }) || ''; } catch { return ''; } });
    const lines = [sec.title, sec.text, ...blockLines, ...R.choicesFor(state, adv).filter(c => c.available).map((c, i) => `Choix ${i + 1} : ${c.text || 'continuer'}.`)];
    setTalking(true);
    speak(lines.filter(Boolean).join('. '), { onEnd: () => setTalking(false) });
  };
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' });
    sfx.page();
    const path = sec.sound || adv.meta.sound;
    if (path) assetUrl(adv, source, path).then(u => ambience(u, sec.sound ? sec.soundLoop !== false : true)); else ambience(null);
    if (prefs.get('ttsAuto', false) && ttsAvailable()) readAloud(); else { stopSpeaking(); setTalking(false); }
  }, [state.section, state.turn]);
  useEffect(() => () => stopSpeaking(), []);
  // Touche I : ouvrir le sac (hors champ de saisie et hors fenêtre déjà ouverte).
  useEffect(() => {
    if (!ui.inventory) return undefined;
    const k = e => {
      if (e.key !== 'i' && e.key !== 'I') return;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
      if (bagRef.current !== null || document.querySelector('.modal-portal .modal')) return; // fermer : Échap, comme toute fenêtre
      e.preventDefault();
      setBag('');
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const go = (to, extra = []) => { const r = R.enter(state, adv, to); update(r.state, [...extra, ...r.messages]); };
  const choose = i => { const r = R.choose(state, adv, i); update(r.state, r.messages); };
  const goBack = () => { if (state.history.length) update(R.back(state), [{ kind: 'info', text: 'Vous revenez au paragraphe précédent.' }]); };
  const choices = R.choicesFor(state, adv);

  return html`<div class="play">
    <article class="reader" ref=${topRef} aria-live="polite">
      ${test && html`<p class="badge" style="margin:0 auto 12px">Mode test : rien n'est sauvegardé</p>`}
      ${state.cheat && html`<p class="badge" style="margin:0 auto 12px"><span aria-hidden="true">🃏</span> Mode triche</p>`}
      <div class="sec-num">${state.section}${sec.title && html`<small>${sec.title}</small>`}</div>
      ${ttsAvailable() && html`<div class="row" style="justify-content:center;margin:-8px 0 14px">
        ${talking ? html`<button class="btn small" onClick=${() => { stopSpeaking(); setTalking(false); }}><${Icon} name="stop" />Arrêter la lecture</button>`
          : html`<button class="btn small" onClick=${readAloud}><${Icon} name="speaker" />Écouter</button>`}
      </div>`}
      ${sec.image && html`<figure class="illus"><${AssetImg} adv=${adv} source=${source} path=${sec.image} alt=${sec.alt || sec.title || `Illustration du paragraphe ${state.section}`} onClick=${e => setLightbox(e.target.src)} /></figure>`}
      <${Prose} text=${sec.text} />
      ${messages?.length > 0 && html`<div class="msgs">${messages.map(m => html`<div class=${'msg ' + m.kind}><${Icon} name=${m.kind === 'loss' ? 'down' : m.kind === 'gain' ? 'up' : 'check'} />${m.text}</div>`)}</div>`}
      ${!state.ended && (sec.blocks || []).map((b, i) => html`<${Block} key=${state.turn + '-' + i} adv=${adv} source=${source} state=${state} index=${i} block=${b} update=${update} go=${go} />`)}
      ${!state.ended && !state.combat?.over && choices.length > 0 && html`<nav class="choices" aria-label="Choix">
        ${choices.map(c => html`<button class="choice" disabled=${!c.available} onClick=${() => choose(c.index)}>
          <${InlineText} text=${c.text || 'Continuer'} /><span class="go">${c.to}</span>
          ${!c.available && html`<span class="why"><${Icon} name="lock" />${c.reason}</span>`}
        </button>`)}
      </nav>`}
      ${!state.ended && adv.rules.freeJump && html`<form class="jump row" style="justify-content:center;gap:8px;margin-top:16px" onSubmit=${e => {
        e.preventDefault(); const v = String(new FormData(e.target).get('n') || '').trim();
        if (adv.sections[v]) go(v); else update(state, [{ kind: 'info', text: `Il n'y a pas de paragraphe ${v || '?'}.` }]);
      }}>
        <label>Rendez-vous au n° <input name="n" type="number" min="1" inputmode="numeric" style="width:6em" aria-label="Numéro de paragraphe" /></label>
        <button class="btn small" type="submit"><${Icon} name="play" />Y aller</button>
      </form>`}
      ${state.ended && html`<${Ending} adv=${adv} state=${state} onRestart=${onRestart} onBack=${adv.rules.allowBack && state.history.length ? goBack : null} />`}
    </article>
    <${Sheet} adv=${adv} source=${source} state=${state} update=${update} open=${sheetOpen} onClose=${() => setSheetOpen(false)}
      onBack=${adv.rules.allowBack !== false && state.history.length && !state.ended ? goBack : null}
      onMap=${() => setMap(true)} onSave=${test ? null : onSaveAs} onBag=${ui.inventory ? tab => setBag(tab || '') : null} />
    <div class="play-fab">
      ${ui.inventory && html`<button class="btn sheet-toggle" onClick=${() => setBag('')} aria-label="Ouvrir le sac (touche I)"><${Icon} name="bag" />Sac${newCount(state) ? html` <span class="badge">${newCount(state)}</span>` : null}</button>`}
      <button class="btn primary sheet-toggle" onClick=${() => setSheetOpen(o => !o)} aria-expanded=${sheetOpen} aria-controls="feuille-aventure">
        <${Icon} name="sheet" />Feuille · ${state.stats[adv.rules.combat.health]?.cur ?? ''}
      </button>
    </div>
    ${bag !== null && ui.inventory && html`<${ui.inventory} adv=${adv} source=${source} state=${state} update=${update} tab=${bag} onClose=${() => setBag(null)} />`}
    ${lightbox && html`<div class="overlay lightbox" onClick=${() => setLightbox(null)}><img src=${lightbox} alt="" /></div>`}
    ${map && html`<${MapModal} adv=${adv} state=${state} onClose=${() => setMap(false)} />`}
  </div>`;
}

/* ---------- fins ---------- */
/** Libellé d'une partie terminée (liste des sauvegardes) : titre de fin propre au paragraphe, sinon Victoire / Mort. */
export function endLabel(adv, state) {
  if (!state?.ended) return '';
  const sec = adv?.sections?.[state.section] || {};
  return sec.endingTitle || (state.ended === 'victory' ? 'Victoire' : state.ended === 'death' ? 'Mort' : 'Fin');
}

function Ending({ adv, state, onRestart, onBack }) {
  const win = state.ended === 'victory';
  // Une fin peut avoir son propre titre et sa propre icône (ex. « Le groupe se replie », icône lune pour les petits).
  const sec = adv.sections[state.section] || {};
  const icon = sec.endingIcon || (win ? 'crown' : 'skull');
  const title = sec.endingTitle || (win ? 'Victoire !' : 'Votre aventure s’achève ici');
  // Fin personnalisée (titre ou icône propres, ex. un repli) : ni son funèbre, ni phrase générique « Votre aventure s’achève ici. ».
  const custom = !win && !!(sec.endingTitle || sec.endingIcon);
  const reason = custom && state.endReason === R.GENERIC_END ? '' : state.endReason || '';
  const visited = Object.keys(state.visited).length;
  const total = Object.keys(adv.sections).length;
  useEffect(() => { win ? sfx.win() : custom ? sfx.page() : sfx.death(); }, []);
  return html`<section class="ending">
    <span class="mark"><${Icon} name=${icon} /></span>
    <h2>${title}</h2>
    ${reason && html`<p class="muted">${reason}</p>`}
    <p>${visited} paragraphe${visited > 1 ? 's' : ''} lu${visited > 1 ? 's' : ''} sur ${total} · ${state.turn} étape${state.turn > 1 ? 's' : ''}</p>
    ${sorted(ui.endingPanels).map(p => html`<${p.Panel} adv=${adv} state=${state} />`)}
    <div class="row" style="justify-content:center">
      <button class="btn primary" onClick=${onRestart}><${Icon} name="dice" />Nouveau héros</button>
      ${onBack && html`<button class="btn" onClick=${onBack}><${Icon} name="back" />Revenir en arrière</button>`}
      <a class="btn" href="#/">Bibliothèque</a>
    </div>
  </section>`;
}

/* ---------- blocs interactifs ---------- */
function Block(props) {
  const T = { test: TestBlock, roll: RollBlock, combat: CombatBlock, shop: ShopBlock, spells: SpellsBlock }[props.block.type] || ui.blocks.get(props.block.type)?.Player;
  return T ? html`<${T} ...${props} />` : null;
}

function Continue({ to, go, label = 'Continuer' }) {
  return to ? html`<button class="btn primary" onClick=${() => go(to)}>${label}<span class="mono">→ ${to}</span></button>` : null;
}

/** Règle du test en une phrase ; tutoie le joueur si l'aventure le demande (`rules.tu`, ou `rules.defis.tu`). */
function testRule(adv, state, block) {
  const stat = R.statLabel(adv, block.stat);
  const target = `${state.stats[block.stat]?.cur}${block.mod ? ` ${block.mod > 0 ? '+' : ''}${block.mod}` : ''}`;
  const cost = block.cost ?? (block.stat === adv.rules.combat.luck ? 1 : 0);
  if (adv.rules.tu ?? adv.rules.defis?.tu) return `Lance ${block.dice || '2d6'} : tu réussis si le total ne dépasse pas ${target} (${stat}).${cost ? ` Le test te coûte 1 point de ${stat}.` : ''}`;
  return `Lancez ${block.dice || '2d6'} : réussite si le total est inférieur ou égal à votre ${stat} (${target}).${cost ? ` Le test vous coûte 1 point de ${stat}.` : ''}`;
}

function TestBlock({ adv, state, index, block, update, go }) {
  const res = state.blocks[index];
  const [stamp, setStamp] = useState(0);
  const label = block.label || `Tester votre ${R.statLabel(adv, block.stat)}`;
  const act = () => { const r = R.resolveTest(state, adv, index); setTimeout(() => sfx.luck(r.result.success), 650); update(r.state, []); setStamp(s => s + 1); };
  return html`<section class="block">
    <h3><${Icon} name=${block.stat === adv.rules.combat.luck ? 'clover' : 'dice'} />${label}</h3>
    <p class="subtle" style="margin:0">${testRule(adv, state, block)}</p>
    ${!res ? html`<div><button class="btn primary" onClick=${act}><${Icon} name="dice" />Lancer les dés</button></div>` : html`
      <${Dice} result=${res.roll} stamp=${stamp} />
      <div class=${'outcome ' + (res.success ? 'ok' : 'ko')}>${res.success ? (block.successText || 'Réussi') : (block.failureText || 'Raté')} : ${res.roll.total} contre ${res.target}</div>
      <div><${Continue} to=${res.success ? block.success : block.failure} go=${go} /></div>`}
  </section>`;
}

function RollBlock({ adv, state, index, block, update, go }) {
  const res = state.blocks[index];
  const [stamp, setStamp] = useState(0);
  const act = () => { const r = R.resolveRoll(state, adv, index); update(r.state, []); setStamp(s => s + 1); };
  return html`<section class="block">
    <h3><${Icon} name="dice" />${block.label || `Lancez ${block.dice || '1d6'}`}</h3>
    <table class="table-roll"><tbody>${(block.table || []).map(t => html`<tr class=${res?.row === t || (res?.row && res.row.to === t.to && res.row.min === t.min) ? 'hit' : ''}>
      <td class="mono">${t.min === t.max ? t.min : `${t.min} – ${t.max}`}</td><td>${t.text || ''}</td><td class="mono">→ ${t.to}</td></tr>`)}</tbody></table>
    ${!res ? html`<div><button class="btn primary" onClick=${act}><${Icon} name="dice" />Lancer</button></div>` : html`
      <${Dice} result=${res.roll} stamp=${stamp} />
      ${block.addStat && html`<span class="subtle">+ ${R.statLabel(adv, block.addStat)} = ${res.total}</span>`}
      <div><${Continue} to=${res.row?.to} go=${go} /></div>`}
  </section>`;
}

function CombatBlock({ adv, source, state, index, block, update, go }) {
  const c = state.combat?.block === index ? state.combat : null;
  const hp = state.stats[adv.rules.combat.health];
  const [stamp, setStamp] = useState(0);
  const act = fn => {
    const next = fn(state, adv);
    const last = next.combat?.last;
    if (fn === C.useLuck && last?.luck) sfx.luck(last.luck.lucky);
    else if (last) { if (last.exchanges.some(x => x.outcome === 'wounded')) sfx.wound(); else if (last.exchanges.some(x => x.outcome === 'hit')) sfx.hit(); }
    update(next, []); setStamp(s => s + 1);
  };
  const exit = c?.over ? C.combatExit(state, adv) : null;
  const last = c?.last;
  const fleeOk = block.flee && (!c || !c.fleeAfter || c.round >= c.fleeAfter);
  const W = C.combatWords(adv), F = C.fillWords;
  const foeHp = W.foeHealth || R.statLabel(adv, adv.rules.combat.health);
  if (!c) return html`<section class="block">
    <h3><${Icon} name="sword" />${W.title}</h3>
    ${block.note && html`<p class="rule"><span class="emoji" aria-hidden="true">📜</span>${block.note}</p>`}
    <div class="fighters">${(block.enemies || []).map(e => html`<div class="fighter">
      ${e.image && html`<${AssetImg} adv=${adv} source=${source} path=${e.image} alt=${e.name} />`}
      <span class="fname">${e.name}</span>
      <span class="statline"><span>${R.statLabel(adv, adv.rules.combat.skill)}</span><b class="mono">${e.skill}</b></span>
      <span class="statline"><span>${foeHp}</span><b class="mono">${e.health}</b></span>
    </div>`)}</div>
    ${block.enemies?.length > 1 && html`<p class="subtle" style="margin:0">${block.mode === 'together' ? W.together : W.sequential}</p>`}
    <div class="row">
      <button class="btn primary" onClick=${() => update(C.startCombat(state, adv, index), [])}><${Icon} name="sword" />${W.start}</button>
      ${block.flee && !block.fleeAfter && html`<button class="btn" onClick=${() => update(C.flee(C.startCombat(state, adv, index), adv), [])}>${W.flee} (−${block.fleeDamage ?? adv.rules.combat.fleeDamage})</button>`}
    </div>
  </section>`;

  return html`<section class="block">
    <h3><${Icon} name="sword" />${W.title}${c.round ? ` · ${F(W.round, { round: c.round })}` : ''}</h3>
    ${block.note && html`<p class="rule"><span class="emoji" aria-hidden="true">📜</span>${block.note}</p>`}
    <div class="fighters">
      <div class="fighter"><span class="fname"><${Icon} name="heart" />${state.hero.name}</span>
        <span class="statline"><span>${R.statLabel(adv, adv.rules.combat.skill)}</span><b class="mono">${state.stats[adv.rules.combat.skill].cur}${(c.playerMod + (last?.mods?.attack || 0)) ? ` ${(c.playerMod + (last?.mods?.attack || 0)) > 0 ? '+' : ''}${c.playerMod + (last?.mods?.attack || 0)}` : ''}</b></span>
        <span class="statline"><span>${R.statLabel(adv, adv.rules.combat.health)}</span><b class="mono">${hp.cur} / ${hp.init}</b></span>
        <div class="bar me"><span style=${`width:${100 * hp.cur / hp.init}%`}></span></div>
      </div>
      ${c.enemies.map(e => html`<button class=${'fighter' + (e.down ? ' down' : '') + (c.mode === 'together' && e.id === c.target && !e.down ? ' target' : '')} style="text-align:left"
          disabled=${c.mode !== 'together' || e.down || c.over} onClick=${() => update({ ...state, combat: { ...c, target: e.id } }, [])}
          aria-pressed=${c.mode === 'together' ? e.id === c.target : undefined}>
        <span class="fname">${e.name}</span>
        <span class="statline"><span>${R.statLabel(adv, adv.rules.combat.skill)}</span><b class="mono">${e.skill}</b></span>
        <span class="statline"><span>${foeHp}</span><b class="mono">${e.health} / ${e.max}</b></span>
        <div class="bar"><span style=${`width:${100 * e.health / e.max}%`}></span></div>
      </button>`)}
    </div>
    ${c.mode === 'together' && !c.over && html`<p class="subtle" style="margin:0">${W.target}</p>`}
    ${last && html`<div class="round">
      ${last.exchanges.map(x => html`<div class="vs">
        <span>${W.you}</span><${Dice} result=${{ dice: x.player.dice, total: x.player.total, mod: 0 }} stamp=${stamp} showTotal=${false} /><b>${x.player.total}</b>
        <span>${F(W.versus, { name: x.name })}</span><${Dice} result=${{ dice: x.foe.dice, total: x.foe.total, mod: 0 }} stamp=${stamp} showTotal=${false} /><b>${x.foe.total}</b>
        <span class=${x.outcome === 'wounded' ? 'msg loss' : x.outcome === 'hit' ? 'msg gain' : 'msg'} style="padding:2px 8px">${F(W[x.outcome] || '', { n: x.damage, name: x.name })}</span>
      </div>`)}
      ${last.luck && html`<div class=${'outcome ' + (last.luck.lucky ? 'ok' : 'ko')}>Chance : ${last.luck.total} — ${last.luck.lucky ? 'Chanceux' : 'Malchanceux'}</div>`}
      ${(last.extra || []).map(x => html`<div class="subtle">${x}</div>`)}
    </div>`}
    ${c.log.length > 1 && html`<ol class="history" aria-label="Assauts précédents">${c.log.slice(0, -1).slice(-5).map(l => html`<li>${l}</li>`)}</ol>`}
    ${sorted(ui.combatPanels).map(p => html`<${p.Panel} adv=${adv} source=${source} state=${state} combat=${c} update=${update} />`)}
    ${!c.over ? html`<div class="row">
      <button class="btn primary" onClick=${() => act(C.attackRound)}><${Icon} name="dice" />${W.attack}</button>
      ${c.canLuck && html`<button class="btn" onClick=${() => act(C.useLuck)}><${Icon} name="clover" />${W.luck} (${state.stats[adv.rules.combat.luck].cur})</button>`}
      <button class="btn" onClick=${() => act(C.autoFight)}>${W.auto}</button>
      ${block.flee && html`<button class="btn" disabled=${!fleeOk} onClick=${() => act(C.flee)}>${W.flee}${block.fleeAfter && !fleeOk ? ` (après ${block.fleeAfter} assauts)` : ''}</button>`}
    </div>` : html`<div class=${'outcome ' + (c.over === 'win' ? 'ok' : 'ko')}>${{ win: W.win, flee: W.fled, lose: W.lose }[c.over]}</div>
      ${!state.ended && html`<div><${Continue} to=${exit} go=${go} /></div>`}`}
    ${c.log.length > 0 && html`<details><summary class="subtle">Journal du combat (${c.log.length})</summary><div class="log">${c.log.map(l => html`<span>${l}</span>`)}</div></details>`}
  </section>`;
}

function SpellsBlock({ adv, state, index, block, update }) {
  const [code, setCode] = useState('');
  const [book, setBook] = useState(false);
  const sp = adv.rules.spells;
  const tried = state.blocks[index]?.tried || [];
  const cast = c => { const r = R.castSpell(state, adv, index, c); sfx.magic(); update(r.state, r.messages); setCode(''); };
  const costOf = o => o.cost ?? (block.costInText ? null : R.spellOf(adv, o.code)?.cost ?? sp.unknownCost ?? 0);
  if (!R.canCast(state, adv)) return html`<section class="block"><h3><${Icon} name="star" />${block.label || 'Formules magiques'}</h3>
    <p class="subtle" style="margin:0">Vous ne maîtrisez pas la magie : ${sp.casters?.length ? `seul${sp.casters.length > 1 ? 's' : ''} ${sp.casters.map(c => adv.rules.classes.find(x => x.id === c)?.label || c).join(', ')} peu${sp.casters.length > 1 ? 'vent' : 't'} lancer ces formules` : 'le système de formules est désactivé'}.</p></section>`;
  return html`<section class="block">
    <h3><${Icon} name="star" />${block.label || 'Lancer une formule'}</h3>
    ${sp.typeCode ? html`
      <p class="subtle" style="margin:0">Tapez le code de trois lettres de la formule que vous voulez prononcer.</p>
      <form class="row" onSubmit=${e => { e.preventDefault(); if (code.trim()) cast(code); }}>
        <input type="text" id=${`spell-${index}`} value=${code} maxlength="3" onInput=${e => setCode(e.target.value.toUpperCase())} style="width:90px;font-family:var(--mono);font-size:20px;letter-spacing:.2em;text-transform:uppercase" aria-label="Code de la formule" autocomplete="off" />
        <button class="btn primary" disabled=${code.trim().length < 3}>Prononcer</button>
      </form>
      ${tried.length > 0 && html`<p class="subtle" style="margin:0">Déjà essayé sans effet : ${tried.join(', ')}</p>`}`
    : html`<div class="row">${(block.options || []).map(o => { const c = costOf(o); return html`<button class="btn" onClick=${() => cast(o.code)}>
        <b class="mono" style="letter-spacing:.1em">${String(o.code).toUpperCase()}</b>${c ? html`<span class="subtle">−${c} ${R.statLabel(adv, sp.stat)}</span>` : null}</button>`; })}</div>`}
    <div><button class="btn small ghost" onClick=${() => setBook(true)}><${Icon} name="book" />Livre des formules</button></div>
    ${book && html`<${SpellBook} adv=${adv} state=${state} onClose=${() => setBook(false)} />`}
  </section>`;
}

function SpellBook({ adv, state, onClose }) {
  const [q, setQ] = useState('');
  const list = (adv.rules.spells.book || []).filter(x => !q || `${x.code} ${x.name} ${x.description}`.toLowerCase().includes(q.toLowerCase()));
  return html`<${Modal} title="Livre des formules" onClose=${onClose} wide>
    <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Chercher un code ou un mot…" aria-label="Chercher une formule" />
    <div class="stack" style="gap:8px">${list.map(x => html`<div class="rollrow" style="grid-template-columns:70px 1fr auto;align-items:start">
      <b class="mono" style="font-size:20px;letter-spacing:.1em">${x.code}</b>
      <div><b>${x.name !== x.code ? x.name : ''}</b><div class="subtle" style="text-align:var(--align, justify)">${x.description}</div>
        ${x.requires && html`<div class="subtle">Nécessite : ${R.itemName(adv, x.requires)} ${state?.inventory?.[x.requires] ? '(vous l’avez)' : '(vous ne l’avez pas)'}</div>`}</div>
      <span class="pill">${x.cost} ${R.statLabel(adv, adv.rules.spells.stat)}</span>
    </div>`)}</div>
  <//>`;
}

function ShopBlock({ adv, source, state, index, block, update }) {
  return html`<section class="block">
    <h3><${Icon} name="coin" />${block.label || 'Marchand'} <span class="pill" style="margin-left:auto">${state.gold} PO</span></h3>
    <div class="stack" style="gap:8px">${(block.offers || []).map((o, j) => {
      const it = adv.items[o.item] || { name: o.item };
      const bought = (state.blocks[index] || {})[j] || 0;
      const soldOut = o.stock && bought >= o.stock;
      return html`<div class="rollrow" style="grid-template-columns:1fr auto auto">
        <div><b>${it.name}</b>${it.description && html`<div class="subtle">${it.description}</div>`}</div>
        <span class="mono">${o.price} PO</span>
        <button class="btn small" disabled=${state.gold < o.price || soldOut} onClick=${() => { const r = R.buy(state, adv, index, j); if (r.state.gold < state.gold) sfx.coin(); update(r.state, r.messages); }}>${soldOut ? 'Épuisé' : bought ? 'Racheter' : 'Acheter'}</button>
      </div>`;
    })}</div>
    ${(block.wants || []).length > 0 && html`<h4 style="margin:10px 0 4px">${block.wantsLabel || 'Le marchand rachète'}</h4>
    <div class="stack" style="gap:8px">${block.wants.map((w, j) => {
      const it = adv.items[w.item] || { name: w.item };
      const sold = ((state.blocks[index] || {}).sold || {})[j] || 0;
      const done = w.stock && sold >= w.stock;
      const have = (state.inventory?.[w.item] || 0) > 0;
      return html`<div class="rollrow" style="grid-template-columns:1fr auto auto">
        <div><b>${it.name}</b>${!have && !done && html`<div class="subtle">Tu n’en as pas.</div>`}</div>
        <span class="mono">+${w.price} PO</span>
        <button class="btn small" disabled=${!have || done} onClick=${() => { const r = R.sell(state, adv, index, j); if (r.state.gold > state.gold) sfx.coin(); update(r.state, r.messages); }}>${done ? 'Déjà vendu' : 'Vendre'}</button>
      </div>`;
    })}</div>`}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Feuille d'aventure                                                  */
/* ------------------------------------------------------------------ */

/** Vrai tant que la requête média correspond (mis à jour quand la fenêtre change de taille). */
function useMedia(q) {
  const get = () => typeof matchMedia === 'function' && matchMedia(q).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(q), f = () => setOn(m.matches);
    m.addEventListener?.('change', f);
    f();
    return () => m.removeEventListener?.('change', f);
  }, [q]);
  return on;
}

/** Objets du sac jamais regardés (greffon inventaire). */
const newCount = state => Object.entries(state.inventory || {}).filter(([id, q]) => q > 0 && !state.seenItems?.[id]).length;
/** Le joueur peut-il ajouter ou retirer des objets lui-même ? (feuille libre, ou partie en mode triche) */
const editable = (adv, state) => !adv.rules.sheet?.locked || !!state.cheat;

function Sheet({ adv, source, state, update, open, onClose, onBack, onMap, onSave, onBag }) {
  const [free, setFree] = useState(null);
  const [book, setBook] = useState(false);
  const [expr, setExpr] = useState('2d6');
  const prev = useRef(state.stats);
  const changed = useMemo(() => { const c = {}; for (const k in state.stats) c[k] = prev.current[k]?.cur !== state.stats[k].cur; prev.current = state.stats; return c; }, [state.stats]);
  const freeRoll = () => { try { const r = R.freeRoll(state, expr); update(r.state, []); setFree({ ...r.result, stamp: Date.now() }); } catch (e) { toast(e.message); } };
  const luck = () => { const r = R.testLuck(state, adv); setTimeout(() => sfx.luck(r.result.success), 650); update(r.state, [{ kind: r.result.success ? 'gain' : 'loss', text: `Test de Chance : ${r.result.roll.total} — ${r.result.success ? 'Chanceux' : 'Malchanceux'}` }]); setFree({ ...r.result.roll, stamp: Date.now() }); };
  const inv = Object.entries(state.inventory).filter(([, q]) => q > 0);
  // Sur téléphone, la feuille fermée est hors de l'écran : inerte (ni Tab, ni lecteur d'écran) tant qu'elle est fermée.
  const narrow = useMedia('(max-width: 900px)');
  const asideRef = useRef();
  useEffect(() => { if (open && narrow) asideRef.current?.querySelector('.sheet-toggle')?.focus(); }, [open, narrow]);
  return html`<aside id="feuille-aventure" ref=${asideRef} class=${'sheet' + (open ? ' open' : '')} aria-label="Feuille d'aventure" inert=${narrow && !open}>
    <h2><span>${state.hero.name}</span>${state.hero.classId && html`<span class="badge">${adv.rules.classes.find(c => c.id === state.hero.classId)?.label}</span>`}${state.cheat && html`<span class="badge" title="Partie en mode triche">🃏 triche</span>`}</h2>
    <button class="btn small sheet-toggle" onClick=${onClose}>Fermer la feuille</button>
    <div class="stats">${adv.rules.stats.map(s => { const v = state.stats[s.id]; return html`<div class=${'stat' + (changed[s.id] ? ' flash' : '')} key=${s.id + v.cur}>
      <span class="label">${s.label}</span><span class="val">${v.cur}<small> / ${v.init}</small></span>
      <div class="bar me"><span style=${`width:${Math.max(0, Math.min(100, 100 * v.cur / v.init))}%`}></span></div>
    </div>`; })}</div>
    ${adv.rules.time?.enabled && html`<div class="row" style="justify-content:space-between">
      <span class="row" style="gap:6px"><${Icon} name="sun" />Jour <b class="mono">${state.day || 1}</b></span>
      <span class="row" style="gap:6px">${state.ate ? html`<${Icon} name="check" />A mangé aujourd’hui` : html`<${Icon} name="x" />Pas encore mangé`}</span>
    </div>`}
    <div class="row" style="justify-content:space-between">
      <span class="row" style="gap:6px"><span class="emoji" aria-hidden="true">💰</span><b class="mono">${state.gold}</b> pièces d’or</span>
      <span class="row" style="gap:6px"><span class="emoji" aria-hidden="true">🍞</span><b class="mono">${state.provisions}</b> repas</span>
    </div>
    ${(() => {
      // Inutile de manger quand la caractéristique soignée est au maximum (sauf si les journées exigent un repas).
      const st = state.stats[adv.rules.meal.stat];
      const full = !!st && st.cur >= st.init && !(adv.rules.time?.enabled && adv.rules.time.mealRequired !== false);
      return html`<button class="btn small" disabled=${!state.provisions || state.ended || full} title=${full ? `${R.statLabel(adv, adv.rules.meal.stat)} déjà au maximum` : ''} onClick=${() => { const r = R.eat(state, adv); update(r.state, r.messages); }}>Manger un repas (+${adv.rules.meal.heal} ${R.statLabel(adv, adv.rules.meal.stat)})</button>`;
    })()}
    ${onBag ? html`<div class="stack" style="gap:6px"><span class="eyebrow">Sac à dos</span>
      <button class="inv-strip" onClick=${() => onBag('')} aria-label=${`Ouvrir le sac : ${inv.length} objet${inv.length > 1 ? 's' : ''}${newCount(state) ? `, dont ${newCount(state)} nouveau${newCount(state) > 1 ? 'x' : ''}` : ''}`}>
        ${inv.slice(0, 10).map(([id]) => html`<span class="inv-chip" key=${id} aria-hidden="true">${adv.items[id]?.icon || '•'}</span>`)}
        ${inv.length > 10 && html`<span class="inv-strip-more" aria-hidden="true">+${inv.length - 10}</span>`}
        ${!inv.length && html`<span class="subtle">Vide.</span>`}
        <span class="inv-strip-open"><${Icon} name="bag" />Ouvrir${newCount(state) ? html` <span class="badge">${newCount(state)} nouveau${newCount(state) > 1 ? 'x' : ''}</span>` : null}</span>
      </button>
    </div>` : html`<div class="stack" style="gap:6px"><span class="eyebrow">Sac à dos</span>
      ${inv.length ? html`<ul class="inv">${inv.map(([id, q]) => { const it = adv.items[id] || { name: id }; return html`<li title=${it.description || ''}>
        <span>${it.icon ? html`<span class="emoji" aria-hidden="true">${it.icon}</span>` : null}${it.name}${q > 1 ? ` ×${q}` : ''}</span>
        <span class="row" style="gap:4px">
          ${it.use?.length && !state.ended ? html`<button class="btn small" aria-label=${`Utiliser : ${it.name}`} onClick=${() => { const r = R.useItem(state, adv, id); update(r.state, r.messages); }}>Utiliser</button>` : null}
          ${!state.ended && ui.itemActions.filter(a => a.show(it, state, adv, id)).map(a => { const label = a.label(it, state, adv, id); return html`<button class="btn small" aria-label=${a.ariaLabel?.(it, state, adv, id) || `${label} : ${it.name}`} onClick=${() => { const r = a.run(state, adv, id); update(r.state, r.messages || []); }}>${label}</button>`; })}
          ${!state.ended && editable(adv, state) && html`<button class="btn small ghost" aria-label=${`Retirer : ${it.name}`} title="Retirer du sac (comme on raye un objet sur la feuille)" onClick=${() => { const r = R.applyEffects(state, adv, [{ op: 'take', item: id }]); update(r.state, r.messages); }}><${Icon} name="x" /></button>`}
        </span>
      </li>`; })}</ul>` : html`<span class="subtle">Vide.</span>`}
      ${!state.ended && editable(adv, state) && Object.keys(adv.items).some(id => !(state.inventory[id] > 0)) && html`<form class="row" style="gap:6px" onSubmit=${e => { e.preventDefault(); const id = new FormData(e.target).get('item'); if (id && adv.items[id]) { const r = R.applyEffects(state, adv, [{ op: 'give', item: id }]); update(r.state, r.messages); } }}>
        <select name="item" aria-label="Objet à ajouter au sac" style="flex:1;min-width:0">
          ${Object.entries(adv.items).filter(([id]) => !(state.inventory[id] > 0)).map(([id, it]) => html`<option value=${id}>${it.icon ? it.icon + ' ' : ''}${it.name}</option>`)}
        </select>
        <button class="btn small" type="submit" title="Ajouter un objet que le texte vous donne"><${Icon} name="plus" />Ajouter</button>
      </form>`}
    </div>`}
    ${sorted(ui.sheetPanels).map(p => html`<${p.Panel} adv=${adv} source=${source} state=${state} update=${update} />`)}
    <label class="field">Notes<textarea id="sheet-notes" rows="3" value=${state.notes} onChange=${e => update({ ...state, notes: e.target.value }, [])}></textarea></label>
    <div class="stack" style="gap:8px"><span class="eyebrow">Dés</span>
      <div class="row"><input type="text" id="free-dice" value=${expr} onInput=${e => setExpr(e.target.value)} style="width:90px" aria-label="Formule de dés" />
        <button class="btn small" onClick=${freeRoll}><${Icon} name="dice" />Lancer</button>
        <button class="btn small" onClick=${luck} disabled=${state.ended}><${Icon} name="clover" />Tester ma Chance</button></div>
      ${free && html`<${Dice} result=${free} stamp=${free.stamp} />`}
    </div>
    <div class="row">
      ${onBack && html`<button class="btn small" onClick=${onBack}><${Icon} name="back" />Revenir</button>`}
      <button class="btn small" onClick=${onMap}><${Icon} name="route" />Paragraphes visités</button>
      ${adv.rules.spells?.enabled && html`<button class="btn small" onClick=${() => setBook(true)}><${Icon} name="book" />Formules</button>`}
      ${onSave && html`<button class="btn small" onClick=${onSave}><${Icon} name="save" />Sauvegarder</button>`}
      <a class="btn small" href="#/">Quitter</a>
    </div>
    ${book && html`<${SpellBook} adv=${adv} state=${state} onClose=${() => setBook(false)} />`}
  </aside>`;
}

/* ---------- carte des paragraphes visités ---------- */
function MapModal({ adv, state, onClose }) {
  const ref = useRef();
  const [libs, setLibs] = useState(() => !!window.cytoscape);
  useEffect(() => { if (!libs) loadGraphLibs({ withLayouts: false }).then(() => setLibs(true)).catch(() => {}); }, []);
  useEffect(() => {
    if (!libs || !window.cytoscape || !ref.current) return undefined;
    const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const seen = new Set(Object.keys(state.visited));
    const els = [];
    seen.forEach(id => { const s = adv.sections[id]; if (s) els.push({ data: { id }, classes: [s.ending || '', id === state.section ? 'here' : ''].join(' ') }); });
    seen.forEach(id => R.targetsOf(adv.sections[id] || {}).forEach((t, i) => { if (seen.has(t.to)) els.push({ data: { id: `${id}-${i}`, source: id, target: t.to } }); }));
    const cy = window.cytoscape({ container: ref.current, elements: els, layout: { name: 'cose', animate: false, nodeRepulsion: 9000, idealEdgeLength: 50 },
      style: [
        { selector: 'node', style: { label: 'data(id)', 'background-color': css('--normal'), color: '#fff', 'text-valign': 'center', 'font-size': 10, 'font-family': 'JetBrains Mono', width: 28, height: 28 } },
        { selector: 'node.death', style: { shape: 'rectangle', 'background-color': css('--death'), color: css('--death-ink') } },
        { selector: 'node.victory', style: { shape: 'diamond', 'background-color': css('--gold'), color: '#111', width: 36, height: 36 } },
        { selector: 'node.here', style: { 'border-width': 5, 'border-style': 'double', 'border-color': css('--ink'), width: 40, height: 40 } },
        { selector: 'edge', style: { width: 1.5, 'line-color': css('--line'), 'target-arrow-color': css('--line'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier' } },
      ] });
    return () => cy.destroy();
  }, [libs]);
  const n = Object.keys(state.visited).length;
  return html`<${Modal} title="Carte de votre voyage" onClose=${onClose} wide>
    <p class="subtle" style="margin:0">${n} paragraphe${n > 1 ? 's' : ''} visité${n > 1 ? 's' : ''} sur ${Object.keys(adv.sections).length}. Double bordure : vous êtes ici. Carré : mort. Losange : victoire.</p>
    <div ref=${ref} style="height:60vh;border:1px solid var(--line);border-radius:8px;background:var(--paper)"></div>
  <//>`;
}

// Composants réutilisables par les greffons (voir docs/PLUGINS.md).
export { Continue, SpellBook };
