// Écran de jeu : création du héros, lecture, blocs interactifs, feuille d'aventure, fins.

import { html, useState, useEffect, useLayoutEffect, useRef, useMemo } from '../lib/preact-htm.js';
import { Icon, Dice, Prose, AssetImg, Modal, Glyph, iconText, isAssetIcon, toast, confirmBox, InlineText, loadGraphLibs } from './common.js';
import { loadAdventure, assetUrl } from '../store/library.js';
import { sfx, ambience, speak, stopSpeaking, ttsAvailable } from './audio.js';
import { prefs } from './common.js';
import { putSave, listSaves, deleteSave } from '../store/db.js';
import * as R from '../core/rules.js';
import * as C from '../core/combat.js';
import { ui, sorted, runHooks, effectiveAdventure } from './registry.js';
import { knownPlaces, visitedPlaces } from '../plugins/carte/core.js';

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
      runHooks('onUpdate', a, prev, state, { test, source });
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
  const avMode = R.avatarMode(adv);
  const [avatar, setAvatar] = useState(() => avatars[0]?.list[0] || null);
  const [avColor, setAvColor] = useState(R.AVATAR_COLORS[0].color);
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
    ${avMode === 'initials' && html`<div class="stack" style="gap:8px"><span class="eyebrow">Avatar</span>
      <${InitialsPicker} name=${name || 'Héros'} value=${avColor} onPick=${setAvColor} /></div>`}
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
      <button class="btn primary" disabled=${!hero} onClick=${() => { const s = structuredClone(hero.state); s.hero.name = name.trim() || 'Héros'; if (avMode === 'initials') s.hero.color = avColor; else if (avatar) s.hero.avatar = avatar; prepareHero(s, loaded, choices, { test: false, query }); onStart(s); }}><${Icon} name="play" />Commencer l'aventure</button>
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
  // La feuille d'aventure repliable sur grand écran (Florian, 18/10) : la lecture prend alors toute la largeur.
  const [sheetFolded, setSheetFolded] = useState(() => { try { return localStorage.getItem('livre-heros:feuille-repliee') === 'oui'; } catch { return false; } });
  const foldSheet = v => { setSheetFolded(v); try { localStorage.setItem('livre-heros:feuille-repliee', v ? 'oui' : 'non'); } catch { /* pour cette visite */ } };
  const [lightbox, setLightbox] = useState(null);
  const [map, setMap] = useState(false);
  const [bag, setBag] = useState(null); // null = sac fermé ; sinon l'onglet à ouvrir ('' = le premier)
  const bagRef = useRef(bag);
  bagRef.current = bag;
  const topRef = useRef();
  const [talking, setTalking] = useState(false);
  // Avec la télé : le récit en sous-titres dans la télé (l'appareil s'en souvient), ou le texte sous la télé.
  // Préférences de la télé propres à chaque livre (la télé éteinte dans l'un ne l'éteint pas dans l'autre).
  const bookPref = key => `${key}:${adv.id || ''}`;
  const [subsOn, setSubsOn] = useState(() => { try { return localStorage.getItem(bookPref(SUBS_PREF)) !== 'off'; } catch { return true; } });
  const toggleSubs = () => setSubsOn(v => { try { localStorage.setItem(bookPref(SUBS_PREF), v ? 'off' : 'on'); } catch { /* pour cette visite */ } return !v; });
  // La télé allumée ou éteinte (l'appareil s'en souvient), et le sous-titre en cours (remis au début à chaque paragraphe).
  const [teleShown, setTeleShown] = useState(() => { try { return localStorage.getItem(bookPref(TELE_PREF)) !== 'off'; } catch { return true; } });
  const showTele = v => { setTeleShown(v); try { localStorage.setItem(bookPref(TELE_PREF), v ? 'on' : 'off'); } catch { /* pour cette visite */ } };
  const [subAt, setSubAt] = useState(0);
  useEffect(() => setSubAt(0), [state.section]);
  // La télé en plein écran : on continue d'y lire le récit (sous-titres, même en mode « Texte ») et d'y choisir.
  const [teleFull, setTeleFull] = useState(false);
  // Le plein écran de la télé est celui de toute la page, en cinéma : la pastille, la feuille, le sac et la carte du
  // monde restent à portée (le plein écran d'un seul élément les cacherait tous).
  useEffect(() => {
    const onChange = () => { const on = document.fullscreenElement === document.documentElement; setTeleFull(on); document.documentElement.classList.toggle('lh-full', on); };
    document.addEventListener('fullscreenchange', onChange);
    return () => { document.removeEventListener('fullscreenchange', onChange); document.documentElement.classList.remove('lh-full'); };
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
    setCinema(true); document.documentElement.requestFullscreen?.().catch(() => {});
  };
  // Le cinéma : la télé (le monde en 3D) devient l'écran principal, le livre passe par-dessus (en-tête, sous-titres,
  // boutons, défis, messages, carte et sac). `meta.tele.cinema` le propose d'emblée ; l'appareil se souvient du choix.
  const [cinemaPref, setCinemaPref] = useState(() => { try { const v = localStorage.getItem(bookPref(CINEMA_PREF)); return v ? v === 'on' : null; } catch { return null; } });
  const setCinema = v => { setCinemaPref(v); try { localStorage.setItem(bookPref(CINEMA_PREF), v ? 'on' : 'off'); } catch { /* pour cette visite */ } };
  // Le défi s'ouvre dans une fenêtre au-dessus de la télé (mise en pause derrière) ; « Voir la télé » la cache un moment.
  const [popHidden, setPopHidden] = useState(false);
  useEffect(() => setPopHidden(false), [state.section]);
  // Chaque nouvelle série de messages repart pour son apparition (ils s'effacent seuls avec la télé).
  const msgSeq = useRef({ list: null, n: 0 });
  if (messages !== msgSeq.current.list) msgSeq.current = { list: messages, n: msgSeq.current.n + 1 };
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
    // La suite s'ajoute en bas ; un instant après, la page remonte jusqu'à ce que le nouveau paragraphe soit en haut.
    if (continuous) {
      if (first || reducedMotion()) curRef.current?.scrollIntoView({ block: 'start' });
      else setTimeout(() => curRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 180);
    } else topRef.current?.scrollIntoView({ block: 'start' });
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
  // Saisie rapide (choix regroupés : un groupe = un élève…) : un groupe à la fois, en onglets, sur téléphone et en
  // « mode saisie » ; le mode saisie ne garde que les onglets, les boutons, les messages et les blocs utiles (minuteur).
  const groupNames = blocks.filter(b => b.group).map(b => b.group);
  const [focusPref, setFocusPref] = useState(() => prefs.get('focus', false));
  const focus = focusPref && grouped && !state.ended;
  const phone = useMedia('(max-width: 700px)');
  const tabbed = grouped && (focus || phone || sec.choiceLayout === 'tabs');
  const [tab, setTab] = useState(null);
  const current = groupNames.includes(tab) ? tab : groupNames[0];
  useEffect(() => { document.documentElement.classList.toggle('lh-focus', !!focus); }, [focus]);
  useEffect(() => () => document.documentElement.classList.remove('lh-focus'), []);
  const toggleFocus = () => { const v = !focusPref; setFocusPref(v); prefs.set('focus', v); };
  // Glisser vers la gauche ou la droite sur les boutons : groupe suivant ou précédent (sans noter d'observation).
  const swipe = useRef(null);
  const swipeStart = e => { swipe.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const swipeEnd = e => {
    const s = swipe.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && groupNames.length > 1) {
      s.moved = true;
      const i = groupNames.indexOf(current);
      setTab(groupNames[(i + (dx < 0 ? 1 : -1) + groupNames.length) % groupNames.length]);
    }
  };
  const swipeClick = e => { if (swipe.current?.moved) { e.stopPropagation(); e.preventDefault(); } swipe.current = null; };
  // Sans numéros : le choix qui mène à une autre étape en montre le numéro (« 3 »), sinon « › ».
  const goStep = c => { const st = adv.sections[c.to]?.step; return st != null && st !== '' && String(st) !== String(sec.step ?? '')
    ? html`<span class="go step" aria-label=${`étape ${st}`}>${st}</span>` : html`<span class="go next" aria-hidden="true">›</span>`; };
  // Messages de la dernière action ; en mode saisie, juste au-dessus des boutons, en plus court.
  // Avec la télé (ou `rules.toasts`), les messages surgissent un instant puis s'effacent, sans pousser la page.
  const toasts = (!!adv.meta?.tele?.url && !continuous && !focus) || !!adv.rules.toasts;
  const msgsView = messages?.length > 0 && html`<div key=${'m' + msgSeq.current.n} class=${'msgs' + (focus ? ' compact' : '') + (toasts ? ' toasts' : '')} role=${toasts ? 'status' : null}>${messages.map(m => html`<div class=${'msg ' + m.kind + (m.alert ? ' alert' : '')} role=${m.alert ? 'alert' : null}><${Icon} name=${m.alert ? 'flag' : m.kind === 'loss' ? 'down' : m.kind === 'gain' ? 'up' : 'check'} />${m.text}</div>`)}</div>`;
  const choiceButton = c => html`<button class="choice" disabled=${!c.available} onClick=${() => choose(c.index)}>
    <${InlineText} text=${c.text || 'Continuer'} />${String(c.to) === String(state.section)
      ? html`<span class="go stay" title="On reste sur ce paragraphe" aria-label="reste ici">↺</span>` : numbers ? html`<span class="go">${c.to}</span>` : goStep(c)}
    ${!c.available && html`<span class="why"><${Icon} name="lock" />${c.reason}</span>`}
  </button>`;

  const listen = !focus && ttsAvailable() && (talking
    ? html`<button class="btn small" onClick=${() => { stopSpeaking(); setTalking(false); }}><${Icon} name="stop" />Arrêter la lecture</button>`
    : html`<button class="btn small" onClick=${readAloud}><${Icon} name="speaker" />Écouter</button>`);
  // La télé (meta.tele) : l'en-tête à gauche, la télé à droite, hors du paragraphe pour ne pas recharger la page à chaque pas.
  const teleOn = !!adv.meta?.tele?.url && !continuous && !focus;
  const cinema = teleOn && teleShown && !state.ended && (cinemaPref ?? !!adv.meta.tele.cinema);
  // `meta.tele.home: { to, label, title? }` : un retour toujours à portée dans la pastille (le grand saut d'un livre de randonnée).
  const teleHome = teleOn && adv.meta.tele.home?.to && adv.sections[adv.meta.tele.home.to] ? { label: '⌂ Accueil', ...adv.meta.tele.home } : null;
  useEffect(() => { document.documentElement.classList.toggle('lh-cinema', cinema); return () => document.documentElement.classList.remove('lh-cinema'); }, [cinema]);
  // En cinéma et en plein écran, le récit est toujours en sous-titres (le texte est derrière le monde).
  const subs = teleOn && teleShown && (subsOn || teleFull || cinema) && !!sec.text;
  const lines = useMemo(() => (subs ? subtitles(sec.text) : null), [subs, sec.text]);
  // Le défi et les choix n'arrivent qu'une fois le récit lu (dernier sous-titre atteint, ou « Passer le récit »).
  const readDone = !lines || lines.length <= 1 || subAt >= lines.length - 1;
  const pop = teleOn && teleShown && readDone && !state.ended && (sec.blocks || []).length > 0;
  // Un défi facultatif « pour réfléchir en marchant » (`tele: 'cote'` sur tous les blocs) : un panneau sur le côté,
  // sans arrêter la télé.
  const popSide = pop && (sec.blocks || []).every(b => b.tele === 'cote');
  useEffect(() => {
    if (!pop || popHidden) return undefined;
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented) setPopHidden(true); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [pop, popHidden, popSide]);
  // Au bout des sous-titres : la page descend jusqu'à ce qu'il reste à faire (défi, choix).
  // En plein écran, seul un défi à jouer dans la page fait sortir de la télé (les choix y sont déjà, en boutons) ;
  // avec la télé, le défi surgit de lui-même dans sa fenêtre.
  const toNext = () => {
    if (teleFull && !(sec.blocks || []).length) return;
    if (teleOn && teleShown && (sec.blocks || []).length) { setPopHidden(false); return; }
    curRef.current?.querySelector('.block, nav.choices, .ending')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Un bouton pressé dans la télé : le même choix qu'ici (par son numéro, ou par son repère `tele`) ; une chose
  // de la télé qui n'a pas de bouton ici (la caisse encore fermée) montre ce qu'il reste à faire.
  const teleChoice = ({ index, tag, section }) => {
    if (section != null && String(section) !== String(state.section)) return;
    const pick = Number.isInteger(index) ? choices.find(c => c.index === index) : tag ? choices.find(c => c.available && c.tele === tag) : null;
    if (pick?.available && !state.ended) choose(pick.index); else toNext();
  };
  // Un défi du paragraphe vient d'être réussi : la page (ou la fenêtre du défi) descend jusqu'à « Continuer »,
  // qui prend le focus (Florian, 18/10). Pour tous les blocs : zefor (status) comme défis (solved).
  const wins = Object.values(state.blocks || {}).filter(b => b?.status === 'success' || b?.solved).length;
  const lastWins = useRef(wins);
  useEffect(() => {
    const before = lastWins.current; lastWins.current = wins;
    if (wins <= before) return undefined;
    const t = setTimeout(() => {
      const root = document.querySelector('.block-pop:not(.is-hidden) .block-pop-card') || curRef.current;
      const next = [...(root?.querySelectorAll('.block button') || [])].filter(b => !b.disabled && /^Continuer/.test(b.textContent.trim())).at(-1);
      if (!next) return;
      next.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
      next.focus({ preventScroll: true });
    }, 250);
    return () => clearTimeout(t);
  }, [wins]);
  // Les autres vues des choix (la carte du monde…) demandent un choix par un événement : un seul chemin pour choisir.
  useEffect(() => {
    const onRequest = e => teleChoice(e.detail || {});
    addEventListener('livre-heros:choose', onRequest);
    return () => removeEventListener('livre-heros:choose', onRequest);
  });

  // En cinéma, la pastille montre aussi la progression : compteurs visibles et collections à compléter (badges, guide…).
  const chipRef = useRef(null);
  const progressView = (() => {
    const bits = [];
    for (const c of adv.rules.counters || []) if (c.visible && !c.quiet) bits.push({ k: 'c-' + c.id, icon: COUNTER_EMOJI[c.icon] || '•', text: String(state.counters?.[c.id] ?? c.start ?? 0), label: c.label });
    for (const col of adv.rules.inventory?.collections || []) {
      const items = col.items || [];
      if (!items.length) continue;
      bits.push({ k: 'i-' + col.id, icon: col.icon || '•', text: `${items.filter(i => state.inventory?.[i] > 0).length}/${items.length}`, label: col.label });
    }
    return bits.length ? html`<div class="sec-progress" aria-label="Progression">${bits.map(b => html`<span key=${b.k} title=${b.label}><span aria-hidden="true">${b.icon}</span> ${b.text}<span class="sr-only"> ${b.label}</span></span>`)}</div>` : null;
  })();
  // Le défi, dans la télé elle-même (il reste visible en plein écran et en cinéma, sans jamais quitter le monde) ;
  // « Voir la télé » le cache, une pastille le rappelle. Les blocs ne changent jamais de place : leur état est gardé.
  const popView = pop && html`<div class=${'block-pop' + (popHidden ? ' is-hidden' : '') + (popSide ? ' side' : '')} key=${'pop' + state.section} role="dialog" aria-modal=${popHidden || popSide ? null : 'true'} aria-label=${sec.title ? `Défi : ${sec.title}` : 'Défi'}>
      <div class="block-pop-card">
        <div class="block-pop-bar"><b><span aria-hidden="true">🧩</span> ${popSide ? 'Pour réfléchir en marchant' : 'À toi de jouer'}</b>
          <button type="button" class="btn small" onClick=${() => setPopHidden(true)} title="Regarder la télé (Échap) ; le défi t’attend">📺 Voir la télé</button></div>
        ${(sec.blocks || []).map((b, i) => html`<${Block} key=${state.turn + '-' + i} adv=${adv} source=${source} state=${state} index=${i} block=${b} update=${update} go=${go} />`)}
      </div>
    </div>
    ${popHidden && html`<button type="button" class="block-pop-pill btn primary" onClick=${() => setPopHidden(false)}><span aria-hidden="true">🧩</span>Reprendre le défi</button>`}`;

  return html`<div class=${'play' + (teleOn ? ' with-tele' : '') + (cinema ? ' cinema' : '') + (pop && !popHidden ? (popSide ? ' popping-side' : ' popping') : '') + (sheetFolded && !cinema ? ' sheet-folded' : '')}>
    <article class=${'reader' + (continuous ? ' continuous' : '') + (focus ? ' focus' : '')} ref=${topRef} aria-live=${continuous ? null : 'polite'}>
      ${test && html`<p class="badge" style="margin:0 auto 12px">Mode test : rien n'est sauvegardé</p>`}
      ${state.cheat && html`<p class="badge" style="margin:0 auto 12px"><span aria-hidden="true">🃏</span> Mode triche</p>`}
      ${continuous && !focus && html`<${Feed} adv=${adv} source=${source} state=${state} numbers=${numbers} onImage=${setLightbox} />`}
      ${teleOn && html`<div class="sec-top">
        <div class="sec-top-left" ref=${chipRef}><${SecHead} adv=${adv} id=${state.section} sec=${sec} numbers=${numbers} />${listen}
          <div class="sec-tools">
          ${teleHome && String(state.section) !== String(teleHome.to) && !state.ended && html`<button class="btn small" onClick=${() => go(teleHome.to)} title=${teleHome.title || teleHome.label}>${teleHome.label}</button>`}
          ${sec.text && !cinema && html`<button class="btn small" onClick=${toggleSubs} aria-pressed=${subsOn ? 'true' : 'false'} title=${subsOn ? 'Lire le texte sous la télé' : 'Lire le récit en sous-titres dans la télé'}>
            <span aria-hidden="true">${subsOn ? '📜' : '💬'}</span>${subsOn ? 'Texte' : 'Sous-titres'}</button>`}
          ${teleShown && html`<button class="btn small" onClick=${() => setCinema(!cinema)} aria-pressed=${cinema ? 'true' : 'false'} title=${cinema ? 'Revenir à la page du livre' : 'Le monde en 3D en grand, le livre par-dessus'}>
            <span aria-hidden="true">${cinema ? '📖' : '🎬'}</span>${cinema ? 'Page' : 'Cinéma'}</button>`}
          ${cinema && adv.meta?.worldMap?.image && ui.inventory && html`<button class="btn small" onClick=${() => setBag('x-carte-monde')} title="La carte du monde : un lieu marqué ✈ s'atteint d'un clic"><span aria-hidden="true">🗺️</span>Carte</button>`}
          ${cinema && ui.inventory && html`<button class="btn small" onClick=${() => setBag('')} title="Le sac (touche I)"><span aria-hidden="true">🎒</span>Sac${newCount(state) ? html` <span class="badge">${newCount(state)}</span>` : null}</button>`}
          ${cinema && html`<button class="btn small" onClick=${() => setSheetOpen(o => !o)} aria-expanded=${sheetOpen} aria-controls="feuille-aventure"><span aria-hidden="true">📜</span>Feuille</button>`}
          </div>
          ${cinema && progressView}</div>
        <${Tele} adv=${adv} state=${state} lines=${lines} at=${subAt} setAt=${setSubAt} onEnd=${toNext} onSkip=${() => { setSubAt(lines ? lines.length - 1 : 0); setPopHidden(false); }}
          onBack=${adv.rules.allowBack !== false && state.history.length && !state.ended ? goBack : null} chipRef=${cinema ? chipRef : null} shown=${teleShown} setShown=${showTele} onFull=${toggleFull} full=${teleFull} paused=${pop && !popHidden && !popSide} cinema=${cinema}
          overlay=${cinema ? html`${popView}${toasts && !focus ? msgsView : null}` : null}
          choices=${state.ended || !readDone ? [] : choices.filter(c => c.available)} onChoice=${teleChoice} />
      </div>`}
      <div class="feed-current ink" key=${'p' + state.section + '-' + (state.trail?.length || 0)} ref=${curRef} aria-live=${continuous ? 'polite' : null}>
      ${teleOn ? html`<h2 class="sr-only">${numbers ? `${state.section}. ` : ''}${sec.title || ''}</h2>` : html`<${SecHead} adv=${adv} id=${state.section} sec=${sec} numbers=${numbers} />`}
      ${grouped && !state.ended && html`<div class="focus-bar"><button type="button" role="switch" aria-checked=${focus ? 'true' : 'false'}
        class=${'focus-toggle' + (focus ? ' on' : '')} onClick=${toggleFocus} title=${focus ? 'Revenir au paragraphe complet' : 'Ne garder que la saisie : un élève à la fois, de grands boutons'}>
        <${Icon} name="grid" />${adv.rules.focusLabel || 'Mode saisie'}<span class="focus-state">${focus ? 'activé' : 'désactivé'}</span></button></div>`}
      ${!teleOn && listen && html`<div class="row" style="justify-content:center;margin:-8px 0 14px">${listen}</div>`}
      ${!focus && sec.image && html`<figure class="illus"><${AssetImg} adv=${adv} source=${source} path=${sec.image} alt=${sec.alt || sec.title || `Illustration du paragraphe ${state.section}`} onClick=${e => setLightbox(e.target.src)} /></figure>`}
      ${!focus && (subs ? html`<div class="sr-only"><${Prose} text=${sec.text} /></div>` : html`<${Prose} text=${sec.text} />`)}
      ${!focus && !toasts && msgsView}
      ${!readDone && html`<div class="read-gate"><span>Récit : sous-titre ${subAt + 1} sur ${lines.length}, dans la télé (molette, flèches ou ›)</span>
        <button class="btn small" onClick=${() => setSubAt(lines.length - 1)}>Passer le récit ▸</button></div>`}
      ${readDone && !pop && !state.ended && (sec.blocks || []).map((b, i) => (focus && !ui.blocks.get(b.type)?.keepInFocus ? null : html`<${Block} key=${state.turn + '-' + i} adv=${adv} source=${source} state=${state} index=${i} block=${b} update=${update} go=${go} />`))}
      ${readDone && !state.ended && !state.combat?.over && choices.length > 0 && tabbed && html`<nav ref=${navRef} class=${'choices capture' + (focus ? ' focus' : '')} aria-label="Saisie">
          <div class="capture-tabs" role="tablist" aria-label=${adv.rules.groupsLabel || 'Groupes'}>
            ${groupNames.map(g => html`<button type="button" role="tab" key=${g} aria-selected=${g === current ? 'true' : 'false'} class="capture-tab" onClick=${() => setTab(g)}>${g}</button>`)}
          </div>
          ${sorted(ui.groupPanels).map(p => html`<${p.Panel} key=${p.id} adv=${adv} state=${state} group=${current} />`)}
          ${focus && msgsView}
          <div class="capture-grid" role="tabpanel" aria-label=${current} onPointerDown=${swipeStart} onPointerUp=${swipeEnd} onClickCapture=${swipeClick}>
            ${(blocks.find(b => b.group === current)?.choices || []).map(choiceButton)}
          </div>
          ${blocks.filter(b => !b.group).map((b, k) => html`<div class="choice-group free" key=${'f' + k}>${b.choices.map(choiceButton)}</div>`)}
        </nav>`}
      ${readDone && !state.ended && !state.combat?.over && choices.length > 0 && !tabbed && (grouped
        ? html`<nav ref=${navRef} class=${'choices grouped' + (sec.choiceLayout === 'columns' ? ' cols' : '')} aria-label="Choix">
            ${blocks.map((b, k) => b.group
              ? html`<section class="choice-group" key=${'g' + k} aria-label=${b.group}><h3 class="choice-group-title">${b.group}</h3>${b.choices.map(choiceButton)}</section>`
              : html`<div class="choice-group free" key=${'g' + k}>${b.choices.map(choiceButton)}</div>`)}
          </nav>`
        : html`<nav ref=${navRef} class="choices" aria-label="Choix">${choices.map(choiceButton)}</nav>`)}
      ${readDone && !state.ended && adv.rules.freeJump && html`<form class="jump row" style="justify-content:center;gap:8px;margin-top:16px" onSubmit=${e => {
        e.preventDefault(); const v = String(new FormData(e.target).get('n') || '').trim();
        if (adv.sections[v]) go(v); else update(state, [{ kind: 'info', text: `Il n'y a pas de paragraphe ${v || '?'}.` }]);
      }}>
        <label>Rendez-vous au n° <input name="n" type="number" min="1" inputmode="numeric" style="width:6em" aria-label="Numéro de paragraphe" /></label>
        <button class="btn small" type="submit"><${Icon} name="play" />Y aller</button>
      </form>`}
      ${state.ended && html`<${Ending} adv=${adv} source=${source} state=${state} onRestart=${onRestart} onBack=${adv.rules.allowBack && state.history.length ? goBack : null} />`}
      </div>
    </article>
    ${!cinema && popView}
    ${toasts && !focus && !cinema && msgsView}
    ${!cinema && html`<button type="button" class="sheet-fold-toggle btn small" onClick=${() => foldSheet(!sheetFolded)} aria-expanded=${sheetFolded ? 'false' : 'true'} aria-controls="feuille-aventure"
      title=${sheetFolded ? 'Montrer la feuille d’aventure' : 'Replier la feuille d’aventure'}>${sheetFolded ? html`<span aria-hidden="true">📜</span>Feuille ‹` : html`Replier ›`}</button>`}
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

function Ending({ adv, source, state, onRestart, onBack }) {
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
    ${sorted(ui.endingPanels).map(p => html`<${p.Panel} adv=${adv} source=${source} state=${state} />`)}
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

/**
 * Un assaut, lisible par un enfant : une ligne par combattant (dés + Habileté + bonus = total), la ligne
 * gagnante en couleur, puis une phrase qui compare les deux totaux et dit ce qui arrive.
 */
function Assaut({ adv, x, W, stamp }) {
  const F = C.fillWords;
  const skillLabel = R.statLabel(adv, adv.rules.combat.skill);
  const p = x.player.total, f = x.foe.total;
  const side = (who, r, cls) => {
    const sum = r.dice.reduce((a, b) => a + b, 0);
    // Anciennes parties sauvegardées : pas de détail, on montre l'écart entre le total et les dés.
    const skill = r.skill ?? r.total - sum, bonus = r.skill == null ? 0 : (r.bonus || 0);
    const sign = n => (n < 0 ? `− ${-n}` : `+ ${n}`);
    return html`<div class=${'assaut-side ' + cls}>
      <span class="who">${who}</span>
      <${Dice} result=${{ dice: r.dice, total: r.total, mod: 0 }} stamp=${stamp} showTotal=${false} />
      <span class="calc"><span class="n">${sum}</span><small>${W.dice}</small> <span class="n">${sign(skill)}</span><small>${skillLabel}</small>${bonus ? html` <span class="n">${sign(bonus)}</span><small>${W.bonus}</small>` : null} <span class="n">=</span></span>
      <b class="tot">${r.total}</b>
    </div>`;
  };
  const tone = x.outcome === 'wounded' ? 'loss' : x.outcome === 'hit' ? 'gain' : '';
  return html`<div class="assaut">
    ${side(W.you, x.player, p > f ? 'win' : p < f ? 'lose' : '')}
    ${side(x.name, x.foe, f > p ? 'win' : f < p ? 'lose' : '')}
    <div class=${'verdict ' + tone}>
      <span class="cmp">${F(p > f ? W.more : p < f ? W.less : W.same, { me: p, foe: f })}</span>
      <span aria-hidden="true">→</span>
      <span>${F(W[x.outcome] || '', { n: x.damage, name: x.name })}</span>
    </div>
  </div>`;
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
      ${last.exchanges.map(x => html`<${Assaut} adv=${adv} x=${x} W=${W} stamp=${stamp} />`)}
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
  const avMode = R.avatarMode(adv);
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
    <h2>${avMode === 'initials' && html`<button class="avatar initials" style=${`--av:${state.hero.color || R.AVATAR_COLORS[0].color}`} onClick=${() => setPickAvatar(true)}
        title="Changer la couleur de l'avatar" aria-label=${`Avatar ${R.initialsOf(state.hero.name)} : changer la couleur`}>${R.initialsOf(state.hero.name)}</button>`}${avatars.length > 0 && html`<button class=${'avatar' + (state.hero.avatar ? '' : ' empty')} onClick=${() => setPickAvatar(true)}
        title="Changer d'avatar" aria-label=${state.hero.avatar ? `Avatar ${state.hero.avatar} : changer` : 'Choisir un avatar'}>${state.hero.avatar || '+'}</button>`}<span class="hero-name">${state.hero.name}</span>${state.hero.classId && html`<span class="badge">${adv.rules.classes.find(c => c.id === state.hero.classId)?.label}</span>`}${state.cheat && html`<span class="badge" title="Partie en mode triche">🃏 triche</span>`}</h2>
    <button class="btn small sheet-toggle" onClick=${onClose}>Fermer la feuille</button>
    ${sorted(ui.sheetPanels).filter(p => p.place === 'top').map(p => html`<${p.Panel} adv=${adv} source=${source} state=${state} update=${update} onBag=${onBag} />`)}
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
        ${inv.slice(0, 10).map(([id]) => html`<span class="inv-chip" key=${id} aria-hidden="true"><${Glyph} adv=${adv} source=${source} icon=${adv.items[id]?.icon || '•'} /></span>`)}
        ${inv.length > 10 && html`<span class="inv-strip-more" aria-hidden="true">+${inv.length - 10}</span>`}
        ${!inv.length && html`<span class="subtle">Vide.</span>`}
        <span class="inv-strip-open"><${Icon} name="bag" />Ouvrir${newCount(state) ? html` <span class="badge">${newCount(state)} nouveau${newCount(state) > 1 ? 'x' : ''}</span>` : null}</span>
      </button>
    </div>` : html`<div class="stack" style="gap:6px"><span class="eyebrow">Sac à dos</span>
      ${inv.length ? html`<ul class="inv">${inv.map(([id, q]) => { const it = adv.items[id] || { name: id }; return html`<li title=${it.description || ''}>
        <span>${it.icon ? html`<${Glyph} adv=${adv} source=${source} icon=${it.icon} className="emoji" />` : null}${it.name}${q > 1 ? ` ×${q}` : ''}</span>
        <span class="row" style="gap:4px">
          ${it.use?.length && !state.ended ? html`<button class="btn small" aria-label=${`Utiliser : ${it.name}`} onClick=${() => { const r = R.useItem(state, adv, id); update(r.state, r.messages); }}>Utiliser</button>` : null}
          ${!state.ended && ui.itemActions.filter(a => a.show(it, state, adv, id)).map(a => { const label = a.label(it, state, adv, id); return html`<button class="btn small" aria-label=${a.ariaLabel?.(it, state, adv, id) || `${label} : ${it.name}`} onClick=${() => { const r = a.run(state, adv, id); update(r.state, r.messages || []); }}>${label}</button>`; })}
          ${!state.ended && editable(adv, state) && html`<button class="btn small ghost" aria-label=${`Retirer : ${it.name}`} title="Retirer du sac (comme on raye un objet sur la feuille)" onClick=${() => { const r = R.applyEffects(state, adv, [{ op: 'take', item: id }]); update(r.state, r.messages); }}><${Icon} name="x" /></button>`}
        </span>
      </li>`; })}</ul>` : html`<span class="subtle">Vide.</span>`}
      ${!state.ended && editable(adv, state) && Object.keys(adv.items).some(id => !(state.inventory[id] > 0)) && html`<form class="row" style="gap:6px" onSubmit=${e => { e.preventDefault(); const id = new FormData(e.target).get('item'); if (id && adv.items[id]) { const r = R.applyEffects(state, adv, [{ op: 'give', item: id }]); update(r.state, r.messages); } }}>
        <select name="item" aria-label="Objet à ajouter au sac" style="flex:1;min-width:0">
          ${Object.entries(adv.items).filter(([id]) => !(state.inventory[id] > 0)).map(([id, it]) => html`<option value=${id}>${iconText(it.icon)}${it.name}</option>`)}
        </select>
        <button class="btn small" type="submit" title="Ajouter un objet que le texte vous donne"><${Icon} name="plus" />Ajouter</button>
      </form>`}
    </div>`}
    ${sorted(ui.sheetPanels).filter(p => p.place !== 'top').map(p => html`<${p.Panel} adv=${adv} source=${source} state=${state} update=${update} onBag=${onBag} />`)}
    <details class="sheet-fold" open=${fold.notes} onToggle=${e => prefs.set('sheet.notes', e.currentTarget.open)}>
      <summary><span class="eyebrow">Notes</span>${noteLines > 0 && html`<span class="subtle">${noteLines} ligne${noteLines > 1 ? 's' : ''}</span>`}</summary>
      <textarea id="sheet-notes" rows="4" aria-label="Notes" value=${state.notes} onChange=${e => update({ ...state, notes: e.target.value }, [])}></textarea>
    </details>
    <details class="sheet-fold dice-fold" open=${fold.dice} onToggle=${e => prefs.set('sheet.dice', e.currentTarget.open)}>
      <summary><span class="eyebrow"><${Icon} name="dice" /> Dés</span><span class="subtle">lancer pour de vrai</span></summary>
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
      ${avMode === 'initials'
        ? html`<${InitialsPicker} name=${state.hero.name} value=${state.hero.color || R.AVATAR_COLORS[0].color} onPick=${v => { update({ ...state, hero: { ...state.hero, color: v } }, null); setPickAvatar(false); }} />`
        : html`<${AvatarPicker} groups=${avatars} value=${state.hero.avatar} onPick=${v => { update({ ...state, hero: { ...state.hero, avatar: v } }, null); setPickAvatar(false); }} />`}
    <//>`}
  </aside>`;
}

/* ---------- la télé : une page compagnon qui suit l'histoire ---------- */
/**
 * `meta.tele = { url, title? }` : une page (un monde en 3D, une carte animée…) affichée à côté de l'en-tête. Chaque
 * paragraphe peut porter un repère `tele` (« sentier-3:etape-2 ») ; sans repère, la télé garde celui du dernier
 * paragraphe qui en avait un. Le repère part par postMessage({ type: 'livre-heros:tele', cue, section }) vers l'origine
 * de la page, au chargement, à chaque changement, et quand la page annonce { type: 'livre-heros:tele-ready' }.
 * Le cadre reste monté d'un paragraphe à l'autre : la page ne se recharge pas. Masquable (l'appareil s'en souvient).
 */
export function teleCue(adv, state) {
  const cueOf = id => adv.sections[id]?.tele;
  if (cueOf(state.section)) return String(cueOf(state.section));
  for (let i = (state.history || []).length - 1; i >= 0; i--) if (cueOf(state.history[i]?.section)) return String(cueOf(state.history[i].section));
  return '';
}
const TELE_PREF = 'livre-heros:tele', SUBS_PREF = 'livre-heros:sous-titres', CINEMA_PREF = 'livre-heros:cinema';
/**
 * Le récit découpé en sous-titres : un paragraphe par carton, un titre (###) avec le paragraphe qui le suit, et les
 * longs paragraphes coupés entre deux phrases (≈ 220 signes), sans jamais couper un passage en gras ou en italique.
 */
export function subtitles(text) {
  const out = [];
  let title = '';
  for (const raw of String(text || '').split(/\n\s*\n/)) {
    const p = raw.trim();
    if (!p) continue;
    if (/^#{1,6}\s/.test(p)) { title = p.replace(/^#+\s*/, ''); continue; }
    const pieces = [];
    if (p.length > 260 && !/^([-*>]|\d+\.)\s/.test(p)) {
      let cur = '';
      for (const s of p.split(/(?<=[.!?…»])\s+(?=[«—A-ZÀ-ÖØ-Þ])/u)) {
        const open = t => ((t.match(/\*\*/g) || []).length % 2) || ((t.replace(/\*\*/g, '').match(/[*_]/g) || []).length % 2);
        if (cur && cur.length + s.length > 220 && !open(cur)) { pieces.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
      }
      if (cur) pieces.push(cur);
    } else pieces.push(p);
    pieces.forEach((x, i) => out.push(i === 0 && title ? `**${title}**\n\n${x}` : x));
    title = '';
  }
  if (title) out.push(`**${title}**`);
  return out;
}
/**
 * Ce que donne un choix (objets, compteurs, or), pour que la télé le montre sur son propre bouton :
 * [{ icon (émoji), name, text }]. Les effets soumis à une condition fausse sont ignorés.
 */
const COUNTER_EMOJI = { coin: '🪙', star: '⭐', heart: '❤️', flag: '🚩' };
export function givesOf(adv, state, effects = []) {
  const plainText = t => String(t || '').split(/\n\s*\n/)[0].replace(/\*\*|[*_]/g, '').trim();
  const lower = t => t.charAt(0).toLowerCase() + t.slice(1);
  const out = [];
  for (const e of effects || []) {
    if (!e || (e.if && !R.check(e.if, state, adv))) continue;
    if (e.op === 'give') { const it = adv.items?.[e.item]; if (it) out.push({ icon: it.icon && !isAssetIcon(it.icon) ? it.icon : '🎁', name: it.name || e.item, text: plainText(it.description) }); }
    else if (e.op === 'counter' && Number(e.add) > 0) { const c = (adv.rules.counters || []).find(x => x.id === e.counter); out.push({ icon: COUNTER_EMOJI[c?.icon] || '➕', name: `${e.add} ${lower(c?.label || e.counter)}`, text: '' }); }
    else if (e.op === 'gold' && Number(e.add) > 0) out.push({ icon: '💰', name: `${e.add} pièces d’or`, text: '' });
  }
  return out;
}
function Tele({ adv, state, lines = null, at = 0, setAt, onEnd, onSkip, onBack, chipRef = null, shown = true, setShown, onFull, full = false, paused = false, overlay = null, cinema = false, choices = [], onChoice }) {
  const tele = adv.meta.tele, frame = useRef(null), dock = useRef(null), fig = useRef(null), cue = teleCue(adv, state);
  // Les vues que propose la page compagnon (livre-heros:tele-views), en boutons dans la barre de la télé.
  const [views, setViews] = useState([]);
  // Les boutons du paragraphe, aussi dans la télé : { index, text, tag, gives }.
  const buttons = choices.map(c => ({ index: c.index, text: c.text || 'Continuer', tag: c.tele || null, gives: givesOf(adv, state, c.effects) }));
  const buttonsKey = JSON.stringify(buttons);
  const n = lines?.length || 0, cur = Math.min(at, Math.max(0, n - 1));
  const next = () => (cur < n - 1 ? setAt(cur + 1) : onEnd?.());
  // Au premier sous-titre, « ‹ » revient au paragraphe précédent (si le livre le permet).
  const prev = () => (cur > 0 ? setAt(cur - 1) : onBack?.());
  // La hauteur de la légende, envoyée à la page compagnon : ses boutons se posent juste au-dessus.
  const subsRef = useRef(null), [legend, setLegend] = useState(0);
  useEffect(() => {
    const el = subsRef.current;
    if (!el || typeof ResizeObserver !== 'function') { setLegend(0); return undefined; }
    const ro = new ResizeObserver(() => setLegend(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [n > 0]);
  // La molette fait défiler les sous-titres (une marche par cran, sans emballement) ; ← et → aussi, quand la télé a le focus.
  const wheelAt = useRef(0);
  const wheelStep = dy => {
    if (!n || Math.abs(dy) < 4) return false;
    const now = Date.now(); if (now - wheelAt.current < 380) return true; wheelAt.current = now;
    if (dy > 0) next(); else prev();
    return true;
  };
  const onWheel = e => { if (wheelStep(e.deltaY)) e.preventDefault(); };
  const onKey = e => { if (!n) return; if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); } if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); } };
  // « {host} » : la machine qui sert le livre (la même télé depuis ce poste, une tablette ou un autre ordinateur du réseau).
  const target = useMemo(() => { try { const u = new URL(String(tele.url).replace(/\{host\}/g, location.hostname), location.href); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } }, [tele.url]);
  // `paused` : un défi est ouvert par-dessus, la page peut s'arrêter (et économiser l'appareil).
  // Et ce que couvre la pastille du livre en haut (cinéma) : la page compagnon range ses cartes en dessous.
  // Mesurée à chaque envoi (la mise en page du cinéma s'installe après le premier rendu), et quand la pastille change.
  const measureTop = () => { const chip = chipRef?.current, f = fig.current?.getBoundingClientRect(); return chip && f ? Math.max(0, Math.round(chip.getBoundingClientRect().bottom - f.top)) : 0; };
  const [top, setTop] = useState(0);
  useEffect(() => {
    const chip = chipRef?.current;
    if (!chip || typeof ResizeObserver !== 'function') { setTop(0); return undefined; }
    const measure = () => requestAnimationFrame(() => setTop(measureTop()));
    const ro = new ResizeObserver(measure); ro.observe(chip); measure();
    addEventListener('resize', measure);
    return () => { ro.disconnect(); removeEventListener('resize', measure); };
  }, [chipRef, shown]);
  // Les lieux connus et visités de la carte du monde : la page compagnon peut montrer ce que le lecteur a découvert
  // (les sentiers cachés d'un livre de randonnée, par exemple).
  const visited = adv.meta.worldMap ? visitedPlaces(state, adv) : [];
  const places = adv.meta.worldMap ? [...new Set([...knownPlaces(state, adv), ...visited])] : [];
  const placesKey = places.join('|') + '#' + visited.join('|');
  const send = () => { const w = frame.current?.contentWindow; if (w && target && cue) w.postMessage({ type: 'livre-heros:tele', cue, section: state.section, choices: buttons, paused, legend: n ? legend : 0, top: chipRef ? measureTop() : 0, places, visited }, target.origin); };
  useEffect(send, [cue, shown, buttonsKey, paused, n ? legend : 0, top, placesKey]);
  // Réabonné à chaque rendu (repère, boutons et sous-titres à jour) : la page prête, un bouton pressé, la molette.
  useEffect(() => {
    const onMessage = e => {
      if (e.source !== frame.current?.contentWindow || e.origin !== target?.origin) return;
      const type = e.data?.type;
      if (type === 'livre-heros:tele-ready') send();
      else if (type === 'livre-heros:tele-choice') onChoice?.(e.data);
      else if (type === 'livre-heros:tele-wheel') wheelStep(Number(e.data.deltaY) || 0);
      else if (type === 'livre-heros:tele-tap' && n) next(); // un toucher sur le monde (pas sur un objet) : la suite du récit
      else if (type === 'livre-heros:tele-views' && Array.isArray(e.data.views)) setViews(e.data.views.slice(0, 8).map(v => ({ id: String(v.id || ''), icon: String(v.icon || '•').slice(0, 4), label: String(v.label || v.id || ''), active: !!v.active, disabled: !!v.disabled })).filter(v => v.id));
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  });
  // Quand on fait défiler la page, la télé s'envole en vignette en haut à droite (réductible) ; sa place reste
  // réservée (pas de saut de mise en page) et le cadre n'est jamais déplacé dans la page (il se rechargerait).
  const [floating, setFloating] = useState(false), [mini, setMini] = useState(false);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(([e]) => setFloating(e.intersectionRatio < 0.45 && e.boundingClientRect.top < 120), { threshold: [0, 0.45, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, !!target]);
  useEffect(() => { if (!floating) setMini(false); }, [floating]);
  // Un nouveau paragraphe (un défi réussi, par exemple) : la télé revient en grand.
  useEffect(() => setMini(false), [state.section]);
  const title = tele.title || 'La télé de l’aventure';
  if (!target) return null;
  if (!shown) return html`<div class="tele-off"><button class="btn small" onClick=${() => setShown?.(true)}><span aria-hidden="true">📺</span>Allumer la télé</button></div>`;
  const fly = floating && !cinema;
  return html`<div class="tele-dock" ref=${dock}><figure ref=${fig} tabindex="-1" style=${`--legend:${n ? legend : 0}px`} class=${'tele' + (n ? ' with-subs' : '') + (fly ? ' is-floating' : '') + (fly && mini ? ' is-mini' : '')} onWheel=${onWheel} onKeyDown=${onKey}>
    <iframe ref=${frame} src=${target.href} title=${title} allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-pointer-lock" onLoad=${send}></iframe>
    ${n > 0 && html`<div class="tele-subs" ref=${subsRef} aria-hidden="true">
      <div class="tele-sub" key=${state.section + '-' + cur} onClick=${next}><${Prose} text=${lines[cur]} /></div>
      <div class="tele-subs-nav">
        <button type="button" onClick=${prev} disabled=${cur === 0 && !onBack} aria-label=${cur > 0 ? 'Sous-titre précédent' : 'Paragraphe précédent'} title=${cur > 0 ? 'Sous-titre précédent' : 'Paragraphe précédent'}>‹</button>
        <span>${cur + 1} / ${n}</span>
        <button type="button" onClick=${next} aria-label=${cur < n - 1 ? 'Sous-titre suivant' : 'Aller à la suite'}>${cur < n - 1 ? '›' : '▾'}</button>
        ${cur < n - 1 && onSkip && html`<button type="button" class="tele-skip" onClick=${onSkip} title="Passer le récit : aller tout de suite au défi ou aux choix">Passer le récit ⏭</button>`}
      </div>
    </div>`}
    ${overlay}
    <figcaption class="tele-bar">${fly && mini ? html`<button type="button" class="tele-pill" onClick=${() => setMini(false)} aria-label="Agrandir la télé"><span aria-hidden="true">📺</span>${title}</button>` : html`<span>${title}</span>`}
      ${fly && !mini && html`<button type="button" onClick=${() => setMini(true)} aria-label="Réduire la télé" title="Réduire">–</button>`}
      ${!(fly && mini) && views.map(v => html`<button type="button" key=${v.id} class=${'tele-view' + (v.active ? ' on' : '')} disabled=${!!v.disabled} aria-pressed=${v.active ? 'true' : 'false'} title=${v.label} aria-label=${v.label}
          onClick=${() => frame.current?.contentWindow?.postMessage({ type: 'livre-heros:tele-view', id: v.id }, target.origin)}>${v.icon}</button>`)}
      ${!(fly && mini) && html`<button type="button" onClick=${onFull} aria-pressed=${full ? 'true' : 'false'} aria-label=${full ? 'Quitter le plein écran' : 'Plein écran'} title=${full ? 'Quitter le plein écran' : 'Plein écran (cinéma : le récit continue en sous-titres)'}>⛶</button>`}
      <button type="button" onClick=${() => setShown?.(false)} aria-label="Éteindre la télé" title="Éteindre la télé">×</button></figcaption>
  </figure></div>`;
}

/* ---------- en-tête d'un paragraphe ---------- */
/**
 * Numéro du paragraphe et titre ; sans numéros (`rules.numbers: false`), l'étape de l'auteur (`sections[n].step`,
 * « 3 », « B »…) sur `rules.steps` (« 3/9 », avec une jauge), ou le titre seul.
 */
function SecHead({ adv, id, sec, numbers }) {
  const step = sec.step != null && sec.step !== '' ? String(sec.step) : null;
  const total = Number(adv.rules.steps) || 0;
  if (numbers) return html`<div class="sec-num">${id}${sec.title && html`<small>${sec.title}</small>`}</div>`;
  if (step) {
    const n = Number(step);
    return html`<div class="sec-num stepped" aria-label=${`Étape ${step}${total ? ` sur ${total}` : ''}${sec.title ? ` : ${sec.title}` : ''}`}>
      <span class="sec-step" aria-hidden="true">${step}${total ? html`<span class="of">/${total}</span>` : null}</span>
      ${total > 1 && Number.isInteger(n) && html`<span class="sec-gauge" aria-hidden="true">${Array.from({ length: total }, (_, k) => html`<i class=${k < n ? 'on' : ''}></i>`)}</span>`}
      ${sec.title && html`<small aria-hidden="true">${sec.title}</small>`}
    </div>`;
  }
  return sec.title ? html`<div class="sec-num titled"><small>${sec.title}</small></div>` : null;
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
        <${SecHead} adv=${adv} id=${p.section} sec=${s} numbers=${numbers} />
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

/** Médaillon aux initiales : on choisit sa couleur (huit couleurs, texte blanc toujours lisible). */
function InitialsPicker({ name, value, onPick }) {
  const ini = R.initialsOf(name);
  return html`<div class="avatar-row" role="radiogroup" aria-label="Couleur de l'avatar">
    ${R.AVATAR_COLORS.map(c => html`<button type="button" role="radio" aria-checked=${c.color === value ? 'true' : 'false'} aria-label=${`${ini}, ${c.name}`}
      class=${'avatar initials' + (c.color === value ? ' on' : '')} style=${`--av:${c.color}`} onClick=${() => onPick(c.color)}>${ini}</button>`)}
  </div>`;
}

/* ---------- les dés de la feuille ---------- */
const QUICK_DICE = ['1d6', '2d6', '3d6', '1d10', '1d12', '1d20'];
/** Ce que le résultat a de remarquable : tous au maximum, que des 1, un double. */
function diceHype(r) {
  const n = r.dice.length, sides = r.sides || 6;
  if (!n) return null;
  if (r.dice.every(v => v === sides)) return { text: n > 1 ? 'Que des maximums !' : 'Maximum !', icon: 'star', kind: 'top' };
  if (n > 1 && r.dice.every(v => v === 1)) return { text: 'Que des 1…', icon: 'down', kind: 'low' };
  if (n === 2 && r.dice[0] === r.dice[1]) return { text: 'Double !', icon: 'star', kind: 'top' };
  if (n === 3 && r.dice[0] === r.dice[1] && r.dice[1] === r.dice[2]) return { text: 'Triple !', icon: 'star', kind: 'top' };
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
      ${hype && html`<span class=${'dice-hype ' + hype.kind} key=${free.stamp}><${Icon} name=${hype.icon} />${hype.text}</span>`}
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
