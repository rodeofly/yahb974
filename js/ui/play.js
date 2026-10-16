// Écran de jeu : création du héros, lecture, blocs interactifs, feuille d'aventure, fins.

import { html, useState, useEffect, useLayoutEffect, useRef, useMemo } from '../lib/preact-htm.js';
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
  const avatars = R.avatarGroups(adv);
  const [avatar, setAvatar] = useState(() => avatars[0]?.list[0] || null);
  const [hero, setHero] = useState(null);
  const [stamp, setStamp] = useState(0);
  const rollAll = () => { setHero(R.createHero(adv, { classId, name: name.trim() || 'Héros' })); setStamp(s => s + 1); };
  const rulesSig = JSON.stringify(adv.rules);
  // Rien à tirer (aucune caractéristique, bourse fixe) : le héros est prêt d'emblée, sans bouton « Lancer les dés ».
  const roll = R.needsRoll(adv, classId);
  const economy = adv.rules.economy !== false;
  useEffect(() => { setHero(roll ? null : R.createHero(adv, { classId, name: 'Héros' })); }, [classId, rulesSig]);
  const cls = classes.find(c => c.id === classId);
  const rows = [...adv.rules.stats.map(s => ({ id: s.id, label: s.label, expr: cls?.rolls?.[s.id] || s.roll })),
    { id: 'gold', label: 'Pièces d’or', expr: cls?.gold || adv.rules.gold || '0' }].filter(r => r.id !== 'gold' || (economy && r.expr !== '0'));
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
    ${avatars.length > 0 && html`<div class="stack" style="gap:8px"><span class="eyebrow">Avatar</span>
      <${AvatarPicker} groups=${avatars} value=${avatar} onPick=${setAvatar} /></div>`}
    ${classes.length > 1 && html`<div class="stack" style="gap:8px"><span class="eyebrow">Classe</span>
      <div class="classes">${classes.map(c => html`<button class="class-opt" aria-pressed=${c.id === classId} onClick=${() => setClassId(c.id)}><b>${c.label}</b><span class="subtle">${c.description || ''}</span></button>`)}</div></div>`}
    ${(rows.length > 0 || economy) && html`<div class="rolls">
      ${rows.map(r => html`<div class="rollrow" key=${r.id}>
        <b>${r.label}</b>
        <span class="formula">${r.expr}</span>
        ${hero ? html`<${Dice} result=${hero.rolls[r.id]} stamp=${stamp} />` : html`<span class="muted">—</span>`}
      </div>`)}
      ${economy && html`<div class="rollrow"><b>Repas</b><span class="formula">${cls?.provisions ?? adv.rules.provisions ?? 0}</span><span class="dice-total">${cls?.provisions ?? adv.rules.provisions ?? 0}</span></div>`}
    </div>`}
    ${sorted(ui.creatorPanels).filter(p => p.place !== 'top').map(panel)}
    <div class="row">
      ${roll && html`<button class="btn ${hero ? '' : 'primary'}" onClick=${rollAll}><${Icon} name="dice" />${hero ? 'Relancer les dés' : 'Lancer les dés'}</button>`}
      <button class="btn primary" disabled=${!hero} onClick=${() => { const s = structuredClone(hero.state); s.hero.name = name.trim() || 'Héros'; if (avatar) s.hero.avatar = avatar; prepareHero(s, loaded, choices, { test: false, query }); onStart(s); }}><${Icon} name="play" />Commencer l'aventure</button>
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
  const lastSection = useRef(null);
  const curRef = useRef(null);
  // Réglages de lecture du livre : `rules.numbers: false` cache les numéros ; `rules.continuous: true` garde les
  // paragraphes lus au-dessus du paragraphe courant (lecture continue, défilement sans fin).
  const numbers = adv.rules.numbers !== false;
  const continuous = !!adv.rules.continuous;
  useEffect(() => {
    // Choix « ↺ » (on reste sur le paragraphe : une observation notée, par exemple) : pas de défilement ni de son de page ;
    // le message de l'effet s'affiche juste au-dessus des choix.
    const first = lastSection.current === null;
    const stay = lastSection.current === state.section;
    lastSection.current = state.section;
    if (stay) return;
    // Lecture continue : on glisse jusqu'au nouveau paragraphe, les précédents restent au-dessus.
    if (continuous) curRef.current?.scrollIntoView({ block: 'start', behavior: first || reducedMotion() ? 'auto' : 'smooth' });
    else topRef.current?.scrollIntoView({ block: 'start' });
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
  // Choix « ↺ » : les messages s'insèrent au-dessus des choix ; on fait défiler d'autant pour que les boutons
  // ne bougent pas sous le doigt (une observation par toucher, sans viser de nouveau).
  const navRef = useRef(null);
  const anchor = useRef(null);
  const choose = i => {
    const c = choices.find(x => x.index === i);
    anchor.current = c && String(c.to) === String(state.section) && navRef.current ? navRef.current.getBoundingClientRect().top : null;
    const r = R.choose(state, adv, i); update(r.state, r.messages);
  };
  useLayoutEffect(() => {
    if (anchor.current === null || !navRef.current) return;
    const d = navRef.current.getBoundingClientRect().top - anchor.current;
    anchor.current = null;
    if (d) window.scrollBy(0, d);
  }, [stamp]);
  const goBack = () => { if (state.history.length) update(R.back(state), [{ kind: 'info', text: R.tutoie(adv) ? 'Tu reviens au paragraphe précédent.' : 'Vous revenez au paragraphe précédent.' }]); };
  const choices = R.choicesFor(state, adv);
  const blocks = R.groupChoices(choices);
  const grouped = blocks.some(b => b.group);
  const choiceButton = c => html`<button class="choice" disabled=${!c.available} onClick=${() => choose(c.index)}>
    <${InlineText} text=${c.text || 'Continuer'} />${String(c.to) === String(state.section)
      ? html`<span class="go stay" title="On reste sur ce paragraphe" aria-label="reste ici">↺</span>` : numbers ? html`<span class="go">${c.to}</span>` : html`<span class="go next" aria-hidden="true">›</span>`}
    ${!c.available && html`<span class="why"><${Icon} name="lock" />${c.reason}</span>`}
  </button>`;

  return html`<div class="play">
    <article class=${'reader' + (continuous ? ' continuous' : '')} ref=${topRef} aria-live=${continuous ? null : 'polite'}>
      ${test && html`<p class="badge" style="margin:0 auto 12px">Mode test : rien n'est sauvegardé</p>`}
      ${state.cheat && html`<p class="badge" style="margin:0 auto 12px"><span aria-hidden="true">🃏</span> Mode triche</p>`}
      ${continuous && html`<${Feed} adv=${adv} source=${source} state=${state} numbers=${numbers} onImage=${setLightbox} />`}
      <div class="feed-current" ref=${curRef} aria-live=${continuous ? 'polite' : null}>
      ${(numbers || sec.title) && html`<div class=${'sec-num' + (numbers ? '' : ' titled')}>${numbers && state.section}${sec.title && html`<small>${sec.title}</small>`}</div>`}
      ${ttsAvailable() && html`<div class="row" style="justify-content:center;margin:-8px 0 14px">
        ${talking ? html`<button class="btn small" onClick=${() => { stopSpeaking(); setTalking(false); }}><${Icon} name="stop" />Arrêter la lecture</button>`
          : html`<button class="btn small" onClick=${readAloud}><${Icon} name="speaker" />Écouter</button>`}
      </div>`}
      ${sec.image && html`<figure class="illus"><${AssetImg} adv=${adv} source=${source} path=${sec.image} alt=${sec.alt || sec.title || `Illustration du paragraphe ${state.section}`} onClick=${e => setLightbox(e.target.src)} /></figure>`}
      <${Prose} text=${sec.text} />
      ${messages?.length > 0 && html`<div class="msgs">${messages.map(m => html`<div class=${'msg ' + m.kind + (m.alert ? ' alert' : '')} role=${m.alert ? 'alert' : null}><${Icon} name=${m.alert ? 'flag' : m.kind === 'loss' ? 'down' : m.kind === 'gain' ? 'up' : 'check'} />${m.text}</div>`)}</div>`}
      ${!state.ended && (sec.blocks || []).map((b, i) => html`<${Block} key=${state.turn + '-' + i} adv=${adv} source=${source} state=${state} index=${i} block=${b} update=${update} go=${go} />`)}
      ${!state.ended && !state.combat?.over && choices.length > 0 && (grouped
        ? html`<nav ref=${navRef} class=${'choices grouped' + (sec.choiceLayout === 'columns' ? ' cols' : '')} aria-label="Choix">
            ${blocks.map((b, k) => b.group
              ? html`<section class="choice-group" key=${'g' + k} aria-label=${b.group}><h3 class="choice-group-title">${b.group}</h3>${b.choices.map(choiceButton)}</section>`
              : html`<div class="choice-group free" key=${'g' + k}>${b.choices.map(choiceButton)}</div>`)}
          </nav>`
        : html`<nav ref=${navRef} class="choices" aria-label="Choix">${choices.map(choiceButton)}</nav>`)}
      ${!state.ended && adv.rules.freeJump && html`<form class="jump row" style="justify-content:center;gap:8px;margin-top:16px" onSubmit=${e => {
        e.preventDefault(); const v = String(new FormData(e.target).get('n') || '').trim();
        if (adv.sections[v]) go(v); else update(state, [{ kind: 'info', text: `Il n'y a pas de paragraphe ${v || '?'}.` }]);
      }}>
        <label>Rendez-vous au n° <input name="n" type="number" min="1" inputmode="numeric" style="width:6em" aria-label="Numéro de paragraphe" /></label>
        <button class="btn small" type="submit"><${Icon} name="play" />Y aller</button>
      </form>`}
      ${state.ended && html`<${Ending} adv=${adv} state=${state} onRestart=${onRestart} onBack=${adv.rules.allowBack && state.history.length ? goBack : null} />`}
      </div>
    </article>
    <${Sheet} adv=${adv} source=${source} state=${state} update=${update} open=${sheetOpen} onClose=${() => setSheetOpen(false)}
      onBack=${adv.rules.allowBack !== false && state.history.length && !state.ended ? goBack : null}
      onMap=${numbers ? () => setMap(true) : null} onSave=${test ? null : onSaveAs} onBag=${ui.inventory ? tab => setBag(tab || '') : null} />
    <div class="play-fab">
      ${ui.inventory && html`<button class="btn sheet-toggle" onClick=${() => setBag('')} aria-label="Ouvrir le sac (touche I)"><${Icon} name="bag" />Sac${newCount(state) ? html` <span class="badge">${newCount(state)}</span>` : null}</button>`}
      <button class="btn primary sheet-toggle" onClick=${() => setSheetOpen(o => !o)} aria-expanded=${sheetOpen} aria-controls="feuille-aventure">
        <${Icon} name="sheet" />Feuille${state.stats[adv.rules.combat.health] ? ` · ${state.stats[adv.rules.combat.health].cur}` : ''}
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
  const title = sec.endingTitle || (win ? 'Victoire !' : R.tutoie(adv) ? 'Ton aventure s’achève ici' : 'Votre aventure s’achève ici');
  // Fin personnalisée (titre ou icône propres, ex. un repli) : ni son funèbre, ni phrase générique « Votre aventure s’achève ici. ».
  const custom = !win && !!(sec.endingTitle || sec.endingIcon);
  const reason = custom && (state.endReason === R.GENERIC_END || state.endReason === R.GENERIC_END_TU) ? '' : state.endReason || '';
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
  if (R.tutoie(adv)) return `Lance ${block.dice || '2d6'} : tu réussis si le total ne dépasse pas ${target} (${stat}).${cost ? ` Le test te coûte 1 point de ${stat}.` : ''}`;
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
  const [book, setBook] = useState(false);
  const [pickAvatar, setPickAvatar] = useState(false);
  const avatars = R.avatarGroups(adv);
  const prev = useRef(state.stats);
  const changed = useMemo(() => { const c = {}; for (const k in state.stats) c[k] = prev.current[k]?.cur !== state.stats[k].cur; prev.current = state.stats; return c; }, [state.stats]);
  // Notes et dés : repliables ; l'appareil se souvient de ce qui était ouvert.
  const [fold] = useState(() => ({ notes: prefs.get('sheet.notes', !!state.notes), dice: prefs.get('sheet.dice', false) }));
  const noteLines = String(state.notes || '').split('\n').filter(l => l.trim()).length;
  // Les badges (collections `board` du greffon inventaire) ont leur propre bande : pas dans celle du sac.
  const onBoard = new Set((adv.rules.inventory?.collections || []).filter(c => c?.board).flatMap(c => c.items || []));
  const inv = Object.entries(state.inventory).filter(([id, q]) => q > 0 && !onBoard.has(id));
  // Sur téléphone, la feuille fermée est hors de l'écran : inerte (ni Tab, ni lecteur d'écran) tant qu'elle est fermée.
  const narrow = useMedia('(max-width: 900px)');
  const asideRef = useRef();
  useEffect(() => { if (open && narrow) asideRef.current?.querySelector('.sheet-toggle')?.focus(); }, [open, narrow]);
  return html`<aside id="feuille-aventure" ref=${asideRef} class=${'sheet' + (open ? ' open' : '')} aria-label="Feuille d'aventure" inert=${narrow && !open}>
    <h2>${avatars.length > 0 && html`<button class=${'avatar' + (state.hero.avatar ? '' : ' empty')} onClick=${() => setPickAvatar(true)}
        title="Changer d'avatar" aria-label=${state.hero.avatar ? `Avatar ${state.hero.avatar} : changer` : 'Choisir un avatar'}>${state.hero.avatar || '+'}</button>`}<span class="hero-name">${state.hero.name}</span>${state.hero.classId && html`<span class="badge">${adv.rules.classes.find(c => c.id === state.hero.classId)?.label}</span>`}${state.cheat && html`<span class="badge" title="Partie en mode triche">🃏 triche</span>`}</h2>
    <button class="btn small sheet-toggle" onClick=${onClose}>Fermer la feuille</button>
    <div class="stats">${adv.rules.stats.map(s => { const v = state.stats[s.id]; return html`<div class=${'stat' + (changed[s.id] ? ' flash' : '')} key=${s.id + v.cur}>
      <span class="label">${s.label}</span><span class="val">${v.cur}<small> / ${v.init}</small></span>
      <div class="bar me"><span style=${`width:${Math.max(0, Math.min(100, 100 * v.cur / v.init))}%`}></span></div>
    </div>`; })}</div>
    ${adv.rules.time?.enabled && html`<div class="row" style="justify-content:space-between">
      <span class="row" style="gap:6px"><${Icon} name="sun" />Jour <b class="mono">${state.day || 1}</b></span>
      <span class="row" style="gap:6px">${state.ate ? html`<${Icon} name="check" />A mangé aujourd’hui` : html`<${Icon} name="x" />Pas encore mangé`}</span>
    </div>`}
    ${adv.rules.economy !== false && html`<div class="row" style="justify-content:space-between">
      <span class="row" style="gap:6px"><span class="emoji" aria-hidden="true">💰</span><b class="mono">${state.gold}</b> pièces d’or</span>
      <span class="row" style="gap:6px"><span class="emoji" aria-hidden="true">🍞</span><b class="mono">${state.provisions}</b> repas</span>
    </div>`}
    ${adv.rules.economy !== false && (() => {
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
    ${sorted(ui.sheetPanels).map(p => html`<${p.Panel} adv=${adv} source=${source} state=${state} update=${update} onBag=${onBag} />`)}
    <details class="sheet-fold" open=${fold.notes} onToggle=${e => prefs.set('sheet.notes', e.currentTarget.open)}>
      <summary><span class="eyebrow">Notes</span>${noteLines > 0 && html`<span class="subtle">${noteLines} ligne${noteLines > 1 ? 's' : ''}</span>`}</summary>
      <textarea id="sheet-notes" rows="4" aria-label="Notes" value=${state.notes} onChange=${e => update({ ...state, notes: e.target.value }, [])}></textarea>
    </details>
    <details class="sheet-fold dice-fold" open=${fold.dice} onToggle=${e => prefs.set('sheet.dice', e.currentTarget.open)}>
      <summary><span class="eyebrow"><span aria-hidden="true">🎲</span> Dés</span><span class="subtle">lancer pour de vrai</span></summary>
      <${DiceBox} adv=${adv} state=${state} update=${update} />
    </details>
    <div class="sheet-tools">
      ${onBack && html`<button class="btn small" onClick=${onBack}><${Icon} name="back" />Revenir</button>`}
      <span class="sheet-icons">
        ${onMap && html`<button class="btn small" onClick=${onMap} title="Paragraphes visités" aria-label="Paragraphes visités"><${Icon} name="route" /></button>`}
        ${adv.rules.spells?.enabled && html`<button class="btn small" onClick=${() => setBook(true)} title="Formules" aria-label="Formules"><${Icon} name="book" /></button>`}
        ${onSave && html`<button class="btn small" onClick=${onSave} title="Sauvegarder" aria-label="Sauvegarder"><${Icon} name="save" /></button>`}
        <a class="btn small" href="#/" title="Quitter" aria-label="Quitter"><${Icon} name="exit" /></a>
      </span>
    </div>
    ${book && html`<${SpellBook} adv=${adv} state=${state} onClose=${() => setBook(false)} />`}
    ${pickAvatar && html`<${Modal} title="Ton avatar" onClose=${() => setPickAvatar(false)}>
      <${AvatarPicker} groups=${avatars} value=${state.hero.avatar} onPick=${v => { update({ ...state, hero: { ...state.hero, avatar: v } }, null); setPickAvatar(false); }} />
    <//>`}
  </aside>`;
}

/* ---------- lecture continue ---------- */
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
/** Nombre de paragraphes lus gardés à l'écran au-dessus du paragraphe courant. */
const FEED_MAX = 30;
/**
 * Les paragraphes déjà lus (`state.trail`), au-dessus du paragraphe courant : texte et illustration, puis le choix
 * qui en est sorti. Rien n'y est interactif (ni dés, ni combat, ni choix). Une ancienne sauvegarde sans fil de lecture
 * commence au paragraphe courant.
 */
function Feed({ adv, source, state, numbers, onImage }) {
  const trail = state.trail?.length ? state.trail : [];
  const end = trail.length && trail[trail.length - 1].section === state.section ? trail.length - 1 : trail.length;
  const from = Math.max(0, end - FEED_MAX);
  if (end <= 0) return null;
  return html`<div class="feed" aria-label="Paragraphes déjà lus">
    ${from > 0 && html`<p class="feed-more subtle">${from} paragraphe${from > 1 ? 's' : ''} plus haut dans la lecture</p>`}
    ${trail.slice(from, end).map((p, k) => {
      const s = adv.sections[p.section];
      if (!s) return null;
      const via = trail[from + k + 1]?.via;
      return html`<section class="feed-past" key=${from + k + '-' + p.section}>
        ${(numbers || s.title) && html`<div class=${'sec-num' + (numbers ? '' : ' titled')}>${numbers && p.section}${s.title && html`<small>${s.title}</small>`}</div>`}
        ${s.image && html`<figure class="illus"><${AssetImg} adv=${adv} source=${source} path=${s.image} alt=${s.alt || s.title || ''} onClick=${e => onImage(e.target.src)} /></figure>`}
        <${Prose} text=${s.text} />
        ${via && html`<p class="feed-choice"><span aria-hidden="true">→</span> <${InlineText} text=${via} /></p>`}
      </section>`;
    })}
  </div>`;
}

/* ---------- avatar ---------- */
/** Choix de l'avatar : un groupe par ligne (personnages féminin, masculin, neutre ; émojis sobres). */
function AvatarPicker({ groups, value, onPick }) {
  return html`<div class="avatar-pick">${groups.map(g => html`<div class="avatar-group" role="radiogroup" aria-label=${g.label || 'Avatars'}>
    ${g.label && html`<span class="subtle">${g.label}</span>`}
    <div class="avatar-row">${g.list.map(a => html`<button type="button" role="radio" aria-checked=${a === value ? 'true' : 'false'}
      class=${'avatar' + (a === value ? ' on' : '')} onClick=${() => onPick(a)}>${a}</button>`)}</div>
  </div>`)}</div>`;
}

/* ---------- les dés de la feuille ---------- */
const QUICK_DICE = ['1d6', '2d6', '3d6', '1d10', '1d12', '1d20'];
/** Ce que le résultat a de remarquable : tous au maximum, que des 1, un double. */
function diceHype(r) {
  const n = r.dice.length, sides = r.sides || 6;
  if (!n) return null;
  if (r.dice.every(v => v === sides)) return { text: n > 1 ? 'Que des maximums !' : 'Maximum !', icon: '🎉', kind: 'top' };
  if (n > 1 && r.dice.every(v => v === 1)) return { text: 'Que des 1…', icon: '😬', kind: 'low' };
  if (n === 2 && r.dice[0] === r.dice[1]) return { text: 'Double !', icon: '✨', kind: 'top' };
  if (n === 3 && r.dice[0] === r.dice[1] && r.dice[1] === r.dice[2]) return { text: 'Triple !', icon: '✨', kind: 'top' };
  return null;
}
/** Lanceur de dés : formules courantes en un toucher, gros bouton, dés colorés, total qui saute, derniers lancers. */
function DiceBox({ adv, state, update }) {
  const [expr, setExpr] = useState(() => prefs.get('sheet.diceExpr', '2d6'));
  const [free, setFree] = useState(null);
  const [hist, setHist] = useState([]);
  const show = res => { const r = { ...res, stamp: Date.now() }; setFree(r); setHist(h => [r, ...h].slice(0, 6)); };
  const go = (e = expr) => {
    try { const r = R.freeRoll(state, e); update(r.state, null); setExpr(e); prefs.set('sheet.diceExpr', e); show(r.result); } catch (err) { toast(err.message); }
  };
  const hasLuck = !!state.stats?.[adv.rules.combat?.luck];
  const luck = () => { const r = R.testLuck(state, adv); setTimeout(() => sfx.luck(r.result.success), 650); update(r.state, [{ kind: r.result.success ? 'gain' : 'loss', text: `Test de Chance : ${r.result.roll.total} — ${r.result.success ? 'Chanceux' : 'Malchanceux'}` }]); show(r.result.roll); };
  const hype = free && diceHype(free);
  return html`<div class="dicebox">
    <div class="dice-chips" role="group" aria-label="Formules courantes">
      ${QUICK_DICE.map(q => html`<button type="button" class="dice-chip" aria-pressed=${q === expr ? 'true' : 'false'} onClick=${() => go(q)}>${q.toUpperCase()}</button>`)}
    </div>
    <div class="row" style="gap:6px">
      <input type="text" id="free-dice" value=${expr} onInput=${e => setExpr(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') go(); }} aria-label="Formule de dés" placeholder="2d6+1" />
      <button class="btn primary dice-go" onClick=${() => go()}><${Icon} name="dice" />Lancer !</button>
    </div>
    ${hasLuck && html`<button class="btn small" onClick=${luck} disabled=${state.ended}><${Icon} name="clover" />Tester ma Chance</button>`}
    <div class="dice-stage" aria-live="polite">
      ${free ? html`<${Dice} result=${free} stamp=${free.stamp} />` : html`<span class="subtle">Touche une formule ou « Lancer ! »</span>`}
      ${hype && html`<span class=${'dice-hype ' + hype.kind} key=${free.stamp}><span aria-hidden="true">${hype.icon}</span> ${hype.text}</span>`}
    </div>
    ${hist.length > 1 && html`<p class="dice-hist" aria-label="Derniers lancers">${hist.slice(1).map(h => html`<span class="mono" key=${h.stamp}>${String(h.expr).toUpperCase()} → ${h.total}</span>`)}</p>`}
  </div>`;
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
