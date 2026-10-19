import { formatKm } from './trail-math.js';
import { THEME_COLORS } from './trail-layer.js';
import { initTrailMap } from './trail-map-ui.js';

// Fil d'Ariane panel: the eight itineraries, their fiches and tales, the troop
// controls, and a stage card for each riddle. Progress stays on this device.
const STORE_KEY = 'fil-ariane-v1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paragraphs = text => String(text || '').split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');

export async function initFilAriane(world, { container, dataUrl = './trails/fil-ariane.json', guideUrl = './trails/zarboutans.json', link = null, tele = false } = {}) {
  const hud = document.querySelector('.terrain-hud');
  if (!hud || !world?.trails) return null;
  let prefs = { level: 'debutant', speed: 'normal', stops: true, helicoAtStages: true, cut: true, done: {}, badges: {}, items: {}, open: true, trail: null, zarb: { revealed: [], met: [] } };
  // The gamebook's television starts afresh and keeps nothing: the explorer's own progress stays untouched.
  if (!tele) try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { /* Private browsing: defaults. */ }
  prefs.zarb = { revealed: [...(prefs.zarb?.revealed || [])], met: [...(prefs.zarb?.met || [])] };
  const save = () => { if (tele) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* Progress then lasts for this visit. */ } };

  const toggle = document.createElement('button');
  toggle.className = 'terrain-settings-button ariane-toggle'; toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false'); toggle.innerHTML = '🧵 <span>Fil d’Ariane</span>';
  hud.querySelector('.terrain-tools')?.prepend(toggle);
  // The sidebar: the Fil d'Ariane now, the gamebook's inventory next to it.
  const sidebar = document.createElement('aside'); sidebar.className = 'ariane-sidebar'; sidebar.hidden = true; sidebar.setAttribute('aria-label', 'Fil d’Ariane et inventaire');
  const tabs = document.createElement('nav'); tabs.className = 'ariane-tabs'; tabs.setAttribute('aria-label', 'Volets');
  tabs.innerHTML = `<button type="button" data-tab="fil" class="active" aria-pressed="true">🧵 Fil d’Ariane</button><button type="button" data-tab="inventaire" aria-pressed="false">🎒 Inventaire</button>`;
  const panel = document.createElement('div'); panel.className = 'ariane-panel';
  const inventory = document.createElement('div'); inventory.className = 'ariane-inventory'; inventory.hidden = true;
  sidebar.append(tabs, panel, inventory);
  const card = document.createElement('section'); card.className = 'ariane-card'; card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
  const lightbox = document.createElement('div'); lightbox.className = 'ariane-lightbox'; lightbox.hidden = true;
  // One camera bar in the top line, grouped by what each view looks at.
  const cams = document.createElement('nav'); cams.className = 'cam-bar'; cams.setAttribute('aria-label', 'Vues');
  const legacySwitch = hud.querySelector('.terrain-topline .camera-switch');
  if (legacySwitch) legacySwitch.after(cams); else hud.append(cams);
  hud.classList.add('cams-merged');
  // The extra click: arriving somewhere offers the quest instead of opening it.
  const prompt = document.createElement('div'); prompt.className = 'ariane-prompt'; prompt.hidden = true; prompt.setAttribute('role', 'status');
  // One button hides the bar and the sidebar together; a small tab brings them back.
  const menusToggle = document.createElement('button'); menusToggle.type = 'button'; menusToggle.className = 'terrain-icon-button ariane-menus-toggle'; menusToggle.title = 'Masquer les menus'; menusToggle.setAttribute('aria-label', 'Masquer les menus'); menusToggle.textContent = '⌃';
  hud.querySelector('.terrain-tools')?.append(menusToggle);
  const barTab = document.createElement('button'); barTab.type = 'button'; barTab.className = 'ariane-bar-tab'; barTab.textContent = '▾ Menus'; barTab.setAttribute('aria-label', 'Afficher les menus');
  // « Le guide zarboutan des sentiers de La Réunion »: the big title while the tangue falls.
  const titleCard = document.createElement('div'); titleCard.className = 'ariane-title-card'; titleCard.hidden = true; titleCard.setAttribute('aria-hidden', 'true');
  hud.append(sidebar, card, lightbox, prompt, barTab, titleCard);
  // A cut rather than a long flight (18/10: « des fois il vaut mieux une coupure
  // qu'une transition, pour le dépôt en hélicoptère ») : the picture fades to
  // black, the troop is set down, the picture comes back. On the world itself,
  // so that the television, without its menus, has it too.
  const veil = document.createElement('div'); veil.className = 'ariane-cut'; veil.hidden = true; veil.setAttribute('aria-live', 'polite');
  container.append(veil);
  let cutting = 0;
  function cut(action, caption = '') {
    const id = ++cutting;
    veil.textContent = caption; veil.hidden = false;
    requestAnimationFrame(() => veil.classList.add('is-in'));
    // A newer cut takes over: it sets the troop down where the story now is.
    setTimeout(() => {
      if (id !== cutting) return;
      action();
      setTimeout(() => { if (id !== cutting) return; veil.classList.remove('is-in'); setTimeout(() => { if (id === cutting) veil.hidden = true; }, 450); }, caption ? 900 : 300);
    }, 300);
  }

  let data, summaries = [], current = null, progress = { s: 0, length: 0, playing: false }, follow = false, cardStage = null, revealed = false;
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    toggle.remove(); sidebar.remove(); card.remove(); lightbox.remove(); menusToggle.remove(); barTab.remove();
    console.warn('Fil d’Ariane indisponible :', error.message); return null;
  }
  // The zarboutans' guide (optional): 32 elders at the end of hidden trails,
  // and the story of each of the eight doors.
  let guide = null;
  try { const response = await fetch(guideUrl); if (response.ok) guide = await response.json(); } catch { /* The trails work without it. */ }
  const ELEMENTS = Object.fromEntries((guide?.elements || []).map(e => [e.id, e]));
  const portes = guide?.portes || {};
  const zarboutans = guide?.zarboutans || [];
  const hiddenTrails = zarboutans.map(z => {
    const element = ELEMENTS[z.element] || {}, door = data.itineraires.find(t => t.id === z.sentier), trace = z.sentierCache.trace;
    return { id: z.id, numero: z.numero, cache: true, zarboutan: z, emoji: element.emoji || '🧓', couleur: element.couleur || '#c9a04a',
      titre: `${z.nom} · ${z.ilet.nom}`, titreCourt: z.nom, depuis: z.acces === 'proche' ? `Sentier caché de la porte ${door?.numero}` : `Îlet lointain · ${z.ilet.region}`,
      conte: z.sentierCache.texte, enPlus: [], trace, longueurM: z.sentierCache.longueurM,
      etapes: [{ id: 'depart', type: 'depart', nom: z.sentierCache.depart.nom, distanceM: 0, lon: trace[0][0], lat: trace[0][1] },
        { id: 'arrivee', type: 'arrivee', nom: z.ilet.nom, distanceM: z.sentierCache.longueurM, lon: trace.at(-1)[0], lat: trace.at(-1)[1] }] };
  });
  const allTrails = [...data.itineraires, ...hiddenTrails];
  const zarbOf = id => zarboutans.find(z => z.id === id);
  summaries = world.trails.load({ ...data, itineraires: allTrails });
  world.trails.setRevealed?.(prefs.zarb.revealed);
  if (guide) titleCard.innerHTML = `<span class="ariane-title-kicker">${esc(guide.titre)}</span><h1>Le guide zarboutan <small>des sentiers de La Réunion</small></h1><p>${zarboutans.length} zarboutans t’attendent au bout des sentiers cachés. Choisis une porte pour sauter.</p>`;
  // The minimap and the cross-section, top right; redrawn when the trail changes.
  const trailMap = initTrailMap(world, { hud });
  let mapTrail;
  const showOnMap = id => { if (mapTrail !== id) { mapTrail = id; trailMap.setTrail(id); } };
  const members = world.getMembers?.() || [];
  let member = prefs.member && members.some(m => m.id === prefs.member) ? prefs.member : 'tangue';
  // Only « Saut » stays in the bar (back to the start); every other view sits in a pop-up.
  cams.innerHTML = `
    <button type="button" class="cam-jump" data-view="skydive" title="Le grand saut : retour au départ, chute libre, choix du sentier">🪂 <span>Saut</span></button>
    <div class="cam-pop">
      <button type="button" class="cam-pop-toggle" aria-expanded="false" aria-haspopup="true" title="Choisir une vue">🎥 <span>Vues</span> ▾</button>
      <div class="cam-pop-panel" hidden>
    <div class="cam-group" data-caption="Île">
      <button type="button" data-view="panorama" title="L’île en panorama, qui tourne lentement">🌋 <span>Panorama</span></button>
      <button type="button" data-view="papangue" title="Papangue : grands cercles au-dessus du sentier, les yeux sur la troupe">🦅 <span>Papangue</span></button>
    </div>
    <div class="cam-group" data-caption="Troupe">
      <button type="button" data-view="loup" title="Stratégie : rôde au ras du sol autour de la troupe ; un clic l’arrête et donne la main">🐺 <span>Stratégie</span></button>
      <button type="button" data-view="helico" title="Hélicoptère : cercles autour de la troupe">🚁 <span>Hélico</span></button>
    </div>
    <div class="cam-group" data-caption="Personnage">
      <label><span class="sr-only">Personnage</span><select data-role="member">${members.map(m => `<option value="${esc(m.id)}">${esc(m.tenrec ? 'Le tangue (guide)' : m.label)}</option>`).join('')}</select></label>
      <button type="button" data-view="char-fps" title="Voir par ses yeux">👁 <span>Yeux</span></button>
      <button type="button" data-view="char-third" title="Le suivre de près">🎥 <span>Derrière</span></button>
      <button type="button" data-view="char-free" title="L’incarner et explorer librement (ZQSD, V pour changer de vue)">🧭 <span>Libre</span></button>
      <button type="button" data-view="glide" title="Déployer le planeur (G) : il suit le centre de l’écran ; glisser pour tourner, regarder vers le bas pour piquer, vers le haut pour freiner">🪁 <span>Planeur</span></button>
    </div>
    <div class="cam-group" data-caption="Carte">
      <button type="button" data-view="orbit" title="Carte de toute l’île">◈ <span>Carte</span></button>
    </div>
      </div>
    </div>`;
  cams.querySelector('[data-role="member"]').value = member;
  const popToggle = cams.querySelector('.cam-pop-toggle'), popPanel = cams.querySelector('.cam-pop-panel');
  const setPop = open => { popPanel.hidden = !open; popToggle.setAttribute('aria-expanded', String(open)); };
  popToggle.addEventListener('click', event => { event.stopPropagation(); setPop(popPanel.hidden); });
  document.addEventListener('pointerdown', event => { if (!popPanel.hidden && !event.target.closest('.cam-pop')) setPop(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !popPanel.hidden) setPop(false); });
  popPanel.addEventListener('click', event => { if (event.target.closest('[data-view]:not(:disabled)')) setPop(false); });
  const ACTIVE_FOR = { orbit: ['orbit'], panorama: ['panorama'], papangue: ['papangue'], skydive: ['skydive'], loup: ['loup', 'rts'], helico: ['helico', 'transfer'], glide: ['glide'] };
  function syncCams() {
    const view = world.getView?.() || {}, hasTrail = !!current;
    if (view.view !== 'skydive') titleCard.hidden = true;
    for (const b of cams.querySelectorAll('[data-view]')) {
      const id = b.dataset.view, needsTrail = ['papangue', 'loup', 'helico', 'char-fps', 'char-third'].includes(id) || (id === 'char-free' && member !== 'tangue');
      b.disabled = needsTrail && !hasTrail;
      const exploring = view.view === 'char-free' || view.view === 'third' || view.view === 'fps';
      const active = id.startsWith('char')
        ? (id === 'char-free' ? exploring && (view.character || 'tangue') === member : view.view === id && view.character === member)
        : (ACTIVE_FOR[id] || []).includes(view.view);
      b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
    }
    // The pop-up's button shows the view in use.
    const on = popPanel.querySelector('[data-view].active');
    popToggle.innerHTML = on ? `${esc(on.firstChild.textContent.trim())} <span>${esc(on.querySelector('span')?.textContent || 'Vues')}</span> ▾` : '🎥 <span>Vues</span> ▾';
    popToggle.classList.toggle('active', !!on);
  }
  function chooseView(view) {
    const now = world.getView?.() || {};
    if (view === 'skydive') { startJump(); syncCams(); return; }
    if (view === 'orbit' || view === 'glide') world.setCameraMode(view);
    else if (view === 'char-free' && !current) world.setCameraMode('third');
    else if ((view === 'char-fps' || view === 'char-third') && now.view === 'char-free' && now.character === member) world.setCameraMode(view === 'char-fps' ? 'fps' : 'third');
    else if (!world.setView(view, { character: member })) { message('Choisis d’abord un itinéraire dans le Fil d’Ariane.'); return; }
    const name = members.find(m => m.id === member)?.label || '';
    if (view === 'char-free') message(`Tu explores avec ${member === 'tangue' ? 'le tangue' : name} : ZQSD ou flèches pour marcher, V pour changer de vue.`);
    if (view === 'loup') message('Le loup rôde autour de la troupe. Un clic l’arrête et te donne la main.');
    if (view === 'glide') message('🪁 Le planeur suit le centre de l’écran : glisse pour tourner, regarde vers le bas pour piquer, vers le haut pour freiner. G pour le replier.');
    if ((view === 'char-fps' || view === 'char-third') && now.view !== 'char-free') { if (!progress.playing) world.trails.play(); message('Glisser pour regarder autour · Échap pour revenir à la carte.'); }
    syncCams();
  }
  cams.addEventListener('click', event => { const b = event.target.closest('[data-view]'); if (b && !b.disabled) chooseView(b.dataset.view); });
  cams.addEventListener('change', event => {
    if (event.target.dataset.role !== 'member') return;
    member = event.target.value; prefs.member = member; save();
    const view = world.getView?.().view;
    if (view?.startsWith('char')) chooseView(view); else syncCams();
  });
  setInterval(syncCams, 600);
  for (const [trailId, ids] of Object.entries(prefs.done || {})) world.trails.setDone(trailId, ids);
  world.trails.setSpeed(prefs.speed); world.trails.setStops(prefs.stops);
  const themes = Object.fromEntries(data.themes.map(t => [t.id, t]));
  const levels = data.niveaux;
  const itinerary = id => allTrails.find(t => t.id === id);
  const summary = id => summaries.find(t => t.id === id);
  const doneSet = id => new Set(prefs.done[id] || []);
  const riddleCount = t => t.etapes.filter(s => s.type === 'enigme').length;
  const solved = t => t.etapes.filter(s => s.type === 'enigme' && doneSet(t.id).has(s.id)).length;

  function message(text) {
    const toast = hud.querySelector('#terrain-toast'); if (!toast) return;
    toast.textContent = text; toast.hidden = false; clearTimeout(message.timer); message.timer = setTimeout(() => { toast.hidden = true; }, 4200);
  }
  function setOpen(value) {
    prefs.open = !!value; sidebar.hidden = !prefs.open; toggle.setAttribute('aria-expanded', String(prefs.open));
    hud.classList.toggle('ariane-open', prefs.open); save();
  }
  function levelPills() {
    return `<div class="ariane-levels" role="group" aria-label="Niveau des énigmes">${levels.map(l => `<button type="button" data-level="${l.id}" class="${l.id === prefs.level ? 'active' : ''}" aria-pressed="${l.id === prefs.level}">${esc(l.nom)}</button>`).join('')}</div>`;
  }
  function profileText(s) {
    return s ? `${formatKm(s.longueurM)} · ↗ ${s.profil.gain.toLocaleString('fr-FR')} m · ↘ ${s.profil.loss.toLocaleString('fr-FR')} m` : '';
  }

  function renderList() {
    current = null; prefs.trail = null; save(); syncCams?.(); showOnMap(null);
    panel.innerHTML = `
      <header class="ariane-head"><div><span class="terrain-eyebrow">LE FIL D’ARIANE · MAFATE</span><h2>Huit portes pour entrer dans le cirque</h2></div><button type="button" class="terrain-icon-button ariane-close" data-action="close" aria-label="Fermer le Fil d’Ariane">×</button></header>
      ${levelPills()}
      ${guide ? `<p class="ariane-doors">📖 Le guide zarboutan : ${prefs.zarb.met.length} / ${zarboutans.length} pages écrites · ${esc(messageSoFar())}</p>` : ''}
      <ol class="ariane-list">${data.itineraires.map(t => {
        const s = summary(t.id), n = solved(t), total = riddleCount(t);
        return `<li><button type="button" class="ariane-item" data-trail="${esc(t.id)}" style="--trail:${esc(t.couleur)}">
          <span class="ariane-num">${t.numero}</span>
          <span class="ariane-item-text"><strong>${esc(t.titre)}</strong><small>${esc(t.depuis)}</small><small class="ariane-stats">${esc(profileText(s))}</small></span>
          <span class="ariane-score" title="Énigmes résolues">${n ? `✓ ${n}/${total}` : `${total} énigmes`}</span></button></li>`;
      }).join('')}</ol>
      <p class="ariane-credit">Tracés : © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) · Relief : IGN · Fiches, contes et énigmes : collection « La Réunion expliquée aux petits explorateurs ».</p>`;
  }

  function renderTrail(id, { fly = true, stage = null, keep = false } = {}) {
    const t = itinerary(id); if (!t) return renderList();
    if (!keep && (current !== id || fly)) world.trails.select(id, { fly, stage });
    current = id; prefs.trail = t.cache ? prefs.trail : id; save(); syncCams(); showOnMap(id);
    if (t.cache) { renderHidden(t); return; }
    const door = portes[t.id];
    const s = summary(id), finished = doneSet(id);
    panel.innerHTML = `
      <header class="ariane-head"><button type="button" class="ariane-back" data-action="list">← Les 8 itinéraires</button><button type="button" class="terrain-icon-button ariane-close" data-action="close" aria-label="Fermer le Fil d’Ariane">×</button></header>
      <div class="ariane-title" style="--trail:${esc(t.couleur)}"><span class="ariane-num">${t.numero}</span><div><h2>${esc(t.titre)}</h2><small>${esc(t.depuis)}</small></div></div>
      ${t.image ? `<button type="button" class="ariane-fiche" data-action="zoom" aria-label="Agrandir la fiche illustrée"><img src="./trails/${esc(t.image)}" alt="Fiche technique illustrée : ${esc(t.titre)}" loading="lazy" decoding="async"></button>` : ''}
      <dl class="ariane-facts">
        <div><dt>Dénivelé (fiche)</dt><dd>${esc(t.fiche.denivele)}</dd></div>
        <div><dt>Durée</dt><dd>${esc(t.fiche.duree)}</dd></div>
        <div><dt>Tracé réel</dt><dd>${esc(profileText(s))} · de ${s.profil.start.toLocaleString('fr-FR')} à ${s.profil.end.toLocaleString('fr-FR')} m</dd></div>
        <div class="wide"><dt>Difficulté</dt><dd>${esc(t.fiche.difficulte)}</dd></div>
      </dl>
      <div class="ariane-controls">
        <button type="button" class="ariane-play" data-action="play">${progress.playing ? '⏸ Pause' : progress.s > 1 ? '▶ Reprendre' : '▶ En route !'}</button>
        <label class="ariane-speed"><span class="sr-only">Vitesse</span><select data-action="speed"><option value="lent">Marche lente</option><option value="normal">Marche normale</option><option value="rapide">Marche rapide</option></select></label>
        <button type="button" class="ariane-chip ${follow ? 'active' : ''}" data-action="follow" aria-pressed="${follow}" title="La caméra accompagne la troupe (F)">🎯 Suivre</button>
        <button type="button" class="ariane-chip" data-action="overview" title="Voir tout le sentier">🗺 Tout voir</button>
      </div>
      <div class="ariane-progress"><div><span style="width:0%"></span></div><small>0 m sur ${formatKm(s.longueurM)}</small></div>
      <label class="ariane-check"><input type="checkbox" data-action="stops" ${prefs.stops ? 'checked' : ''}> S’arrêter à chaque étape pour une énigme</label>
      <label class="ariane-check"><input type="checkbox" data-action="helico" ${prefs.helicoAtStages ? 'checked' : ''}> Passer en vue hélicoptère à chaque étape</label>
      <label class="ariane-check"><input type="checkbox" data-action="flight" ${prefs.cut ? '' : 'checked'}> Montrer le vol de l’hélicoptère (sinon, une coupure)</label>
      <p class="ariane-troop">Le tangue ouvre la marche : c’est le guide et le conteur. Derrière lui : le grand-père au chapeau de paille, Cimendef, Asma, Sarlave, Raharianne et Nanan Laverdure. Koko et Zéklèr, les lucioles, éclairent la route. Les boutons en bas changent de caméra.</p>
      ${levelPills()}
      <h3 class="ariane-h3">Les étapes</h3>
      <ol class="ariane-stages">${t.etapes.map((stage, i) => {
        const theme = themes[stage.theme], colour = THEME_COLORS[stage.theme || stage.type];
        const label = stage.type === 'depart' ? 'Départ' : stage.type === 'arrivee' ? 'Arrivée' : theme.nom;
        return `<li><button type="button" data-stage="${esc(stage.id)}" class="${finished.has(stage.id) ? 'done' : ''}" style="--stage:${colour}">
          <span class="ariane-stage-icon">${stage.type === 'depart' ? '⚑' : stage.type === 'arrivee' ? '🏁' : theme.emoji}</span>
          <span class="ariane-stage-text"><strong>${i && stage.type === 'enigme' ? `${i}. ` : ''}${esc(label)}</strong><small>${esc(stage.nom || 'Sur le sentier')} · ${formatKm(stage.distanceM)}</small></span>
          <span class="ariane-stage-state">${finished.has(stage.id) ? '✓' : ''}</span></button></li>`;
      }).join('')}</ol>
      ${door ? `<details class="ariane-tale ariane-door-tale" open><summary>${esc(door.glyphe.emoji)} ${esc(door.porte)} · ${esc(door.recit.titre)}</summary>${door.recit.texte.map(p => `<p>${esc(p)}</p>`).join('')}<p class="ariane-glyph">${esc(door.glyphe.emoji)} <b>${esc(door.glyphe.nom)}</b> : ${esc(door.glyphe.sens)}</p></details>` : ''}
      ${zarbList(t)}
      <details class="ariane-tale"${door ? '' : ' open'}><summary>Le conte</summary>${paragraphs(t.conte)}</details>
      ${t.recit ? `<details class="ariane-tale"><summary>Le récit : ${esc(t.recit.titre)}</summary>${t.recit.paragraphes.map(p => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
      <p class="ariane-help">Clique sur le sentier pour y envoyer la troupe. Glisser : déplacer la vue · clic droit ou deux doigts : tourner · molette : zoomer · Espace : marcher ou s’arrêter.</p>
      <p class="ariane-credit">Tracé : © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL), données ${esc((data.sources.tracesDate || '').slice(0, 10))}. Dénivelés réels calculés sur le relief IGN.</p>`;
    panel.querySelector('[data-action="speed"]').value = prefs.speed;
    updateProgress();
  }

  // ------------------------------------------------------------ zarboutans
  const met = id => prefs.zarb.met.includes(id), known = id => prefs.zarb.revealed.includes(id);
  // The four zarboutans of a door, in its panel: found, known or still hidden.
  function zarbList(t) {
    const list = zarboutans.filter(z => z.sentier === t.id); if (!list.length) return '';
    return `<h3 class="ariane-h3">🧓 Les zarboutans de cette porte</h3><ul class="ariane-zarb-door">${list.map(z => {
      const el = ELEMENTS[z.element] || {}, state = met(z.id) ? 'met' : known(z.id) ? 'known' : 'hidden';
      return `<li class="is-${state}" style="--el:${esc(el.couleur || '#999')}">${state === 'hidden'
        ? `<span class="ariane-zarb-icon">?</span><span><b>Zarboutan n° ${z.numero}</b><small>${z.acces === 'proche' ? 'Un sentier caché part du Fil d’Ariane.' : 'Un indice t’attend sur le sentier.'}</small></span>`
        : `<button type="button" data-zarb="${esc(z.id)}"><span class="ariane-zarb-icon">${esc(el.emoji || '🧓')}</span><span><b>${z.numero}. ${esc(z.nom)}</b><small>${esc(z.ilet.nom)}${state === 'met' ? ` · lettre « ${esc(z.lettre)} »` : ' · à rencontrer'}</small></span></button>`}</li>`;
    }).join('')}</ul>`;
  }
  function renderHidden(t) {
    const z = t.zarboutan, el = ELEMENTS[z.element] || {}, door = itinerary(z.sentier), s = summary(t.id);
    panel.innerHTML = `
      <header class="ariane-head"><button type="button" class="ariane-back" data-action="door" data-door="${esc(z.sentier)}">← ${esc(door?.titre || 'Le Fil d’Ariane')}</button><button type="button" class="terrain-icon-button ariane-close" data-action="close" aria-label="Fermer le Fil d’Ariane">×</button></header>
      <div class="ariane-title" style="--trail:${esc(t.couleur)}"><span class="ariane-num">${esc(el.emoji || '🧓')}</span><div><h2>${esc(met(z.id) ? z.nom : 'Le sentier caché')}</h2><small>Zarboutan n° ${z.numero} · ${esc(z.ilet.nom)} (${esc(z.ilet.region)})</small></div></div>
      <p class="ariane-zarb-clue">🌿 ${esc(z.sentierCache.texte)}</p>
      <dl class="ariane-facts">
        <div><dt>Sentier caché</dt><dd>${esc(profileText(s))}</dd></div>
        <div><dt>Élément</dt><dd>${esc(el.emoji || '')} ${esc(el.nom || '')}</dd></div>
        <div class="wide"><dt>Départ</dt><dd>${esc(z.sentierCache.depart.nom)}</dd></div>
      </dl>
      <div class="ariane-controls">
        <button type="button" class="ariane-play" data-action="play">${progress.playing ? '⏸ Pause' : progress.s > 1 ? '▶ Reprendre' : '▶ En route !'}</button>
        <label class="ariane-speed"><span class="sr-only">Vitesse</span><select data-action="speed"><option value="lent">Marche lente</option><option value="normal">Marche normale</option><option value="rapide">Marche rapide</option></select></label>
        ${met(z.id) ? `<button type="button" class="ariane-chip" data-zarb="${esc(z.id)}">📖 Sa page du guide</button>` : ''}
      </div>
      <div class="ariane-progress"><div><span style="width:0%"></span></div><small>0 m sur ${formatKm(s.longueurM)}</small></div>
      <p class="ariane-help">Au bout du sentier, un zarboutan t’attend dans son îlet. Il t’apprendra un truc et écrira une lettre dans ton guide.</p>
      <p class="ariane-credit">Sentier caché : © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) · Contes : « ${esc(guide?.titre || '')} ».</p>`;
    panel.querySelector('[data-action="speed"]').value = prefs.speed;
    updateProgress();
  }
  // A door's stage solved: its zarboutans' clues show up. A nearby one opens a
  // hidden trail right here; a faraway one appears on the map.
  let pendingClues = [];
  function cluesAt(trailId, stageId) {
    const found = zarboutans.filter(z => z.sentier === trailId && z.porte === stageId && !known(z.id));
    if (!found.length) return false;
    for (const z of found) prefs.zarb.revealed.push(z.id);
    save(); world.trails.setRevealed?.(prefs.zarb.revealed); beckonDoors(); fillChapters(); if (!inventory.hidden) renderInventory();
    pendingClues = found; showClue(); return true;
  }
  function showClue() {
    const z = pendingClues.shift(); if (!z) { prompt.hidden = true; return false; }
    const el = ELEMENTS[z.element] || {};
    prompt.style.setProperty('--stage', el.couleur || '#2f7d4f');
    prompt.innerHTML = z.acces === 'proche'
      ? `<span>🌿 ${esc(z.indice)}</span><button type="button" data-prompt="follow" data-zarb="${esc(z.id)}">Suivre le sentier caché ▸</button><button type="button" data-prompt="later">Continuer</button>`
      : `<span>📍 ${esc(z.indice)} · ${esc(z.ilet.nom)} apparaît sur la carte.</span><button type="button" data-prompt="fly" data-zarb="${esc(z.id)}">🚁 Y aller ▸</button><button type="button" data-prompt="later">Plus tard</button>`;
    prompt.hidden = false; pendingStage = null; return true;
  }
  // Onto a hidden trail: a nearby one starts where the troop stands; a
  // faraway one is reached by helicopter (or by the big jump).
  function goToZarboutan(id) {
    const t = itinerary(id); if (!t) return;
    closeCard(); prompt.hidden = true;
    if (world.getView?.().view === 'skydive') { world.trails.chooseSkydive(id); renderTrail(id, { fly: false, keep: true }); return; }
    if (t.zarboutan.acces === 'proche' && current === t.zarboutan.sentier) { renderTrail(id, { fly: false }); offerHidden(t); return; }
    if (prefs.cut) {
      cut(() => { renderTrail(id, { fly: false }); setOpen(true); world.setView?.('helico'); offerHidden(t); syncCams(); }, `🚁 La troupe est déposée au départ du sentier caché · ${t.zarboutan.ilet.nom}`);
      return;
    }
    const result = world.trails.travelToTrail?.(id);
    renderTrail(id, { fly: false, keep: true }); setOpen(true);
    if (result === true) message(`🚁 L’hélicoptère emmène la troupe vers ${t.zarboutan.ilet.nom}…`);
    else if (result === 'direct') offerHidden(t);
    else message('L’hélicoptère est déjà en vol.');
    syncCams();
  }
  function offerHidden(t) {
    const z = t.zarboutan, el = ELEMENTS[z.element] || {};
    prompt.style.setProperty('--stage', el.couleur || '#2f7d4f');
    prompt.innerHTML = `<span>🌿 Le sentier caché vers ${esc(z.ilet.nom)} · ${formatKm(z.sentierCache.longueurM)}</span><button type="button" data-prompt="walk">▶ En route ▸</button><button type="button" data-prompt="close" aria-label="Plus tard">×</button>`;
    prompt.hidden = false; pendingStage = null;
  }
  // The meeting: a badge with the letter, the gift, then the zarboutan's page.
  let meeting = null;
  function meetZarboutan(z) {
    // Already celebrating this one (a second arrival event): nothing more.
    if (meeting === z.id) return;
    const first = !met(z.id);
    if (first) { prefs.zarb.met.push(z.id); save(); fillChapters(); if (!inventory.hidden) renderInventory(); renderTrail(current, { fly: false, keep: true }); }
    const el = ELEMENTS[z.element] || {}, count = prefs.zarb.met.length;
    if (!first) { openZarbCard(z); return; }
    prompt.hidden = true; meeting = z.id;
    zarbBadge(z, { count, after: () => revealItems({ id: 'zarboutans' }, { type: 'arrivee', theme: null }, [{ id: z.don.id, icon: z.don.icone, name: z.don.nom, text: z.don.texte }], () => { meeting = null; openZarbCard(z); }, { kicker: `Le cadeau de ${z.nom}`, colour: el.couleur }) });
  }
  // The meeting's badge. Without `count`, the gamebook's television: the letter comes later, once the riddle is solved.
  function zarbBadge(z, { count = null, after = () => {} } = {}) {
    const el = ELEMENTS[z.element] || {};
    const badge = document.createElement('div'); badge.className = 'ariane-badge ariane-zarb-badge'; badge.setAttribute('role', 'dialog'); badge.setAttribute('aria-label', `Zarboutan rencontré : ${z.nom}`);
    badge.style.setProperty('--stage', el.couleur || '#ffd54a');
    badge.innerHTML = `<canvas class="ariane-badge-sky" aria-hidden="true"></canvas>
      <button type="button" class="ariane-badge-stage"><span class="ariane-badge-rays" aria-hidden="true"></span>
        <span class="ariane-badge-kicker">Zarboutan rencontré${count ? ` · ${count} / ${zarboutans.length}` : ` · n° ${z.numero}`}</span>
        <span class="ariane-badge-slogan">${esc(z.nom)}</span>
        <span class="ariane-badge-spin" aria-hidden="true"><span class="ariane-badge-icon">${esc(el.emoji || '🧓')}</span></span>
        <span class="ariane-badge-name">${esc(z.ilet.nom)} · ${esc(z.ilet.region)}</span>
        ${count ? `<span class="ariane-zarb-letter">Il écrit dans ton guide la lettre <b>${esc(z.lettre)}</b></span>
        <span class="ariane-badge-doors">${esc(messageSoFar())}</span>` : ''}</button>`;
    hud.append(badge);
    const stop = fireworks(badge.querySelector('canvas'), 3000); fanfare();
    let closed = false;
    const close = () => { if (closed) return; closed = true; stop(); badge.classList.add('is-leaving'); setTimeout(() => badge.remove(), 450); after(); };
    badge.addEventListener('click', close); setTimeout(close, 5200);
    badge.querySelector('button').focus({ preventScroll: true });
  }
  // The guide's message: the letters found so far, the others as dots.
  function messageSoFar() {
    if (!guide) return '';
    let i = 0;
    return [...guide.message].map(c => /[\p{L}]/u.test(c) ? (met(zarboutans[i++]?.id) ? c : '·') : c).join('');
  }
  let zarbCard = null, resume = null;
  function openZarbCard(z) { cardStage = null; zarbCard = z; revealed = false; renderZarbCard(); }
  function renderZarbCard() {
    const z = zarbCard; if (!z) return;
    const el = ELEMENTS[z.element] || {}, riddle = z.enigmes[prefs.level] || z.enigmes.debutant, door = itinerary(z.sentier);
    card.innerHTML = `<button type="button" class="ariane-card-close" data-card="close" aria-label="Fermer">×</button>
      <span class="terrain-eyebrow" style="color:${esc(el.couleur || '#2f7d4f')}">ZARBOUTAN N° ${z.numero} · ${esc(z.ilet.nom.toUpperCase())} · ${esc(el.emoji || '')} ${esc((el.nom || '').toUpperCase())}</span>
      <h3>${esc(el.emoji || '🧓')} ${esc(z.nom)}</h3>
      <div class="ariane-zarb-tale">${z.conte.map(p => `<p>${esc(p)}</p>`).join('')}</div>
      <p class="ariane-zarb-truc"><b>💡 Le truc de ${esc(z.nom)} :</b> ${esc(z.truc)}</p>
      <p class="ariane-zarb-note"><b>🧠 Dans ton cerveau :</b> ${esc(z.cerveau)}</p>
      <p class="ariane-zarb-note"><b>💛 Ce que tu ressens :</b> ${esc(z.emotion)}</p>
      ${levelPills()}
      <p class="ariane-narrator">🧓 ${esc(z.nom)} te pose une énigme :</p>
      <p class="ariane-question">${esc(riddle.question)}</p>
      ${revealed ? `<p class="ariane-answer"><b>Réponse :</b> ${esc(riddle.reponse)}</p>` : `<button type="button" class="ariane-chip" data-card="reveal">Voir la réponse</button>`}
      <p class="ariane-zarb-gift">✉️ Lettre <b>${esc(z.lettre)}</b> · ${esc(z.don.icone)} ${esc(z.don.nom)}</p>
      <div class="ariane-card-actions">
        <button type="button" class="ariane-play" data-card="back-door">🚁 Retour à la porte ${door?.numero ?? ''}</button>
        ${z.acces === 'proche' ? '<button type="button" class="ariane-chip" data-card="walk-back">🚶 Revenir à pied</button>' : ''}
        <button type="button" class="ariane-chip" data-card="jump">🪂 Grand saut</button>
        <button type="button" class="ariane-chip" data-card="close">Rester ici</button></div>`;
    card.style.setProperty('--stage', el.couleur || '#2f7d4f');
    card.hidden = false;
  }
  // Back to the door the hidden trail started from, where the walk resumes.
  function backToDoor(z, { walk = false } = {}) {
    closeCard();
    const door = itinerary(z.sentier); if (!door) return;
    resume = { trailId: door.id, stageId: z.porte };
    if (walk && current === z.id) { world.trails.walkTo(0); message('🚶 La troupe redescend le sentier caché…'); return; }
    if (prefs.cut) {
      cut(() => { resume = null; renderTrail(door.id, { fly: false, stage: z.porte }); setOpen(true); world.setView?.('helico'); world.trails.play(); message('🧵 La troupe reprend le Fil d’Ariane.'); syncCams(); }, `🚁 Retour à la porte ${door.numero} · ${door.titre}`);
      return;
    }
    const result = world.trails.travelToTrail?.(door.id, z.porte);
    renderTrail(door.id, { fly: false, keep: true }); setOpen(true);
    if (result === true) message(`🚁 Retour à la porte ${door.numero} : ${door.titre}.`);
    else { resume = null; renderTrail(door.id, { fly: false, stage: z.porte }); world.trails.play(); }
    syncCams();
  }

  function updateProgress() {
    if (!current) return;
    const bar = panel.querySelector('.ariane-progress span'), label = panel.querySelector('.ariane-progress small'), play = panel.querySelector('.ariane-play');
    const length = progress.length || summary(current)?.longueurM || 1;
    if (bar) bar.style.width = `${Math.min(100, progress.s / length * 100).toFixed(1)}%`;
    if (label) label.textContent = `${formatKm(progress.s)} sur ${formatKm(length)}`;
    if (play) play.textContent = progress.playing ? '⏸ Pause' : progress.s >= length - 1 ? '↺ Recommencer' : progress.s > 1 ? '▶ Reprendre' : '▶ En route !';
  }

  let pendingStage = null;
  function offerStage(stageInfo) {
    const t = itinerary(current); if (!t) return;
    const stage = t.etapes.find(st => st.id === (stageInfo?.id || stageInfo)); if (!stage) return;
    pendingStage = stage; card.hidden = true; cardStage = null;
    const theme = themes[stage.theme];
    const label = stage.type === 'depart' ? `⚑ Départ · ${stage.nom}` : stage.type === 'arrivee' ? `🏁 Arrivée · ${stage.nom}` : `${theme.emoji} Étape ${t.etapes.indexOf(stage)} · ${theme.nom}`;
    // The riddle waits in the îlet's container: a crate, or La Buse's chest at the end.
    const treasure = stage.type !== 'depart' && !doneSet(t.id).has(stage.id) && world.trails.showChest?.(stage.id);
    const action = stage.type === 'depart' ? 'Lire la fiche' : treasure ? (stage.type === 'arrivee' ? 'Ouvrir le coffre de La Buse' : 'Ouvrir la caisse') : stage.type === 'arrivee' ? 'Voir l’arrivée' : 'Ouvrir l’énigme';
    prompt.innerHTML = `<span>${treasure ? '🗝️ ' : ''}${esc(label)}</span><button type="button" data-prompt="open">${action} ▸</button><button type="button" data-prompt="close" aria-label="Plus tard">×</button>`;
    prompt.style.setProperty('--stage', THEME_COLORS[stage.theme || stage.type] || '#2f7d4f');
    prompt.hidden = false;
  }
  prompt.addEventListener('click', event => {
    const choice = event.target.closest('[data-tele-choice]');
    if (choice) { teleChoose(teleChoices.find(c => String(c.index) === choice.dataset.teleChoice)); return; }
    const b = event.target.closest('[data-prompt]'); if (!b) return;
    // The crate opens under the helicopter's eye; no crate: the card at once.
    if (b.dataset.prompt === 'open' && pendingStage && !world.trails.openChest?.()) openCard(pendingStage);
    if (b.dataset.prompt === 'skip') { world.setCameraMode('orbit'); world.resetView(); syncCams(); }
    if (b.dataset.prompt === 'jump') { startJump(); syncCams(); return; }
    if (b.dataset.prompt === 'list') { renderList(); setOpen(true); }
    if (b.dataset.prompt === 'follow' || b.dataset.prompt === 'fly') { pendingClues = []; goToZarboutan(b.dataset.zarb); return; }
    if (b.dataset.prompt === 'later') { if (!showClue()) { prompt.hidden = true; world.trails.play(); } return; }
    if (b.dataset.prompt === 'walk') { prompt.hidden = true; closeCard(); world.trails.play(); return; }
    prompt.hidden = true;
  });
  // Reaching a stage for the first time unlocks its badge, in the manner of
  // the gamebook's trophies: rays, fireworks, a big slogan and the stage's
  // emblem spinning; a touch or a few seconds and the quest is offered.
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  function fanfare() {
    try {
      const audio = fanfare.audio || (fanfare.audio = new (window.AudioContext || window.webkitAudioContext)());
      // Sound only once the visitor has touched the page (browsers' rule).
      if (audio.state !== 'running') { audio.resume?.().catch(() => {}); return; }
      const now = audio.currentTime;
      [523, 659, 784, 1046, 1318].forEach((f, i) => {
        const osc = audio.createOscillator(), gain = audio.createGain(), at = now + i * .09;
        osc.type = 'triangle'; osc.frequency.value = f; gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.12, at + .02); gain.gain.exponentialRampToValueAtTime(.001, at + .32);
        osc.connect(gain).connect(audio.destination); osc.start(at); osc.stop(at + .34);
      });
    } catch { /* No sound on this device: the picture is enough. */ }
  }
  function fireworks(canvas, lasting = 2400) {
    if (reducedMotion()) return () => {};
    const g = canvas.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    const colours = ['#FFD54A', '#FF6B6B', '#4FC3F7', '#9CCC65', '#BA68C8', '#FFFFFF', '#FFA726'];
    let parts = [], raf = 0, bursts = 0; const t0 = performance.now();
    const burst = (x, y) => {
      const c = colours[Math.floor(Math.random() * colours.length)], n = 60 + Math.floor(Math.random() * 30);
      for (let i = 0; i < n; i++) { const a = Math.PI * 2 * i / n + Math.random() * .2, v = (2 + Math.random() * 4) * dpr; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: Math.random() < .25 ? '#FFFFFF' : c, s: (1.5 + Math.random() * 1.7) * dpr }); }
    };
    const loop = now => {
      if ((now - t0) / 280 > bursts && now - t0 < lasting) { bursts++; burst((.15 + Math.random() * .7) * canvas.width, (.12 + Math.random() * .4) * canvas.height); }
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.globalCompositeOperation = 'lighter';
      parts = parts.filter(p => p.life > .02);
      for (const p of parts) { p.vx *= .985; p.vy = p.vy * .985 + .06 * dpr; p.x += p.vx; p.y += p.vy; p.life *= .968; g.globalAlpha = p.life; g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.s, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1; raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }
  function celebrate(t, stage, after) {
    const theme = themes[stage.theme] || {}, index = t.etapes.indexOf(stage);
    const door = portes[t.id];
    const slogan = stage.type === 'depart' ? 'En route !' : stage.type === 'arrivee' ? (door ? `${door.porte} franchie !` : 'Sentier réussi !') : `Étape ${index}`;
    const icon = stage.type === 'depart' ? '⚑' : stage.type === 'arrivee' ? door?.glyphe?.emoji || '🏆' : theme.emoji || '🏅';
    const name = stage.type === 'enigme' ? `${theme.nom || 'Énigme'}${stage.nom ? ` · ${stage.nom}` : ''}` : stage.type === 'arrivee' && door ? `${stage.nom} · glyphe : ${door.glyphe.nom}` : stage.nom;
    const finale = stage.type === 'arrivee', walked = data.itineraires.filter(other => other.id === t.id || doneSet(other.id).has('arrivee')).length;
    const badge = document.createElement('div'); badge.className = 'ariane-badge'; badge.setAttribute('role', 'dialog'); badge.setAttribute('aria-label', `Badge débloqué : ${slogan}, ${name}`);
    badge.style.setProperty('--stage', THEME_COLORS[stage.theme || stage.type] || '#ffd54a');
    badge.innerHTML = `<canvas class="ariane-badge-sky" aria-hidden="true"></canvas>
      <button type="button" class="ariane-badge-stage"><span class="ariane-badge-rays" aria-hidden="true"></span>
        <span class="ariane-badge-kicker">Badge débloqué</span>
        <span class="ariane-badge-slogan">${esc(slogan)}</span>
        <span class="ariane-badge-spin" aria-hidden="true"><span class="ariane-badge-icon">${esc(icon)}</span></span>
        <span class="ariane-badge-name">${esc(name)}</span>
        <span class="ariane-badge-trail">${esc(t.numero)} · ${esc(t.titre)}</span>
        ${finale ? `<span class="ariane-badge-doors">🚪 ${walked} porte${walked > 1 ? 's' : ''} sur 8 franchie${walked > 1 ? 's' : ''}</span>` : ''}</button>`;
    if (finale) badge.classList.add('is-finale');
    hud.append(badge);
    const stop = fireworks(badge.querySelector('canvas'), finale ? 5200 : 2400); fanfare(); if (finale) setTimeout(fanfare, 900);
    let closed = false;
    const close = () => { if (closed) return; closed = true; stop(); badge.classList.add('is-leaving'); setTimeout(() => badge.remove(), 450); after(); };
    badge.addEventListener('click', close); setTimeout(close, finale ? 6200 : 3600);
    badge.querySelector('button').focus({ preventScroll: true });
  }
  // The doors not yet walked through pulse on the map.
  function beckonDoors() { world.trails.beckon?.([...data.itineraires.filter(t => !doneSet(t.id).has('arrivee')).map(t => t.id), ...prefs.zarb.revealed.filter(id => !prefs.zarb.met.includes(id))]); }
  // A trail completed: the whole island, the eight doors, and an invitation
  // to the next one.
  function inviteDoors() {
    const walked = data.itineraires.filter(t => doneSet(t.id).has('arrivee')).length;
    renderList(); setOpen(true); beckonDoors();
    world.setView?.('panorama'); syncCams();
    prompt.innerHTML = walked >= data.itineraires.length
      ? `<span>🏆 Les huit portes du cirque sont franchies ! Bravo, explorateur !</span><button type="button" data-prompt="jump">🪂 Un dernier saut ▸</button><button type="button" data-prompt="close" aria-label="Fermer">×</button>`
      : `<span>🚪 Huit portes pour entrer dans le cirque · ${walked}/8 franchie${walked > 1 ? 's' : ''}. Laquelle sera la prochaine ?</span><button type="button" data-prompt="jump">🪂 Nouveau saut ▸</button><button type="button" data-prompt="list">Les itinéraires</button><button type="button" data-prompt="close" aria-label="Plus tard">×</button>`;
    prompt.style.setProperty('--stage', '#ff7a1a'); prompt.hidden = false; pendingStage = null;
  }
  // What each container holds: an object of the stage's theme (things of the
  // 18th century, like the troop's), a handful of gold; La Buse's chest at the
  // end, a piece of his cryptogram.
  // Written once, in the gamebook's sentiers.json (through the zarboutans' guide), so that the book and the
  // television find the same things in the same crates.
  const LOOT = guide?.butin || {}, CHEST = guide?.coffre || {};
  function lootFor(t, stage) {
    const index = t.etapes.indexOf(stage);
    if (stage.type === 'arrivee') return [
      ...(CHEST.name ? [{ id: `${stage.id}`, icon: CHEST.icon, name: CHEST.name, text: CHEST.text }] : []),
      { id: `${stage.id}-or`, icon: '💰', name: `Le trésor : ${CHEST.or ?? 50} pièces d’or`, text: 'De quoi remplir la bourse de toute la troupe.', gold: CHEST.or ?? 50 },
    ];
    const item = LOOT[stage.theme]; if (!item) return [];
    return [{ id: stage.id, ...item }, { id: `${stage.id}-or`, icon: '💰', name: `${index * 5} pièces d’or`, text: 'La troupe les partage équitablement.', gold: index * 5 }];
  }
  // One celebration per object, left open until it is put in the bag, then the next.
  // Returns close(): the gamebook may stow the objects itself, from its own button.
  function revealItems(t, stage, items, after, { kicker = null, colour = null } = {}) {
    const found = new Set(prefs.items[t.id] || []), queue = items.filter(item => !found.has(item.id));
    let shown = null, closed = false;
    const close = () => { closed = true; if (shown) { shown.stop(); shown.box.remove(); shown = null; } };
    if (!queue.length) { after(); return close; }
    const finale = stage.type === 'arrivee';
    const show = i => {
      if (closed) return;
      const item = queue[i];
      const box = document.createElement('div'); box.className = 'ariane-badge ariane-loot'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', `Trouvé : ${item.name}`);
      box.style.setProperty('--stage', colour || THEME_COLORS[stage.theme || stage.type] || '#ffd54a');
      box.innerHTML = `<canvas class="ariane-badge-sky" aria-hidden="true"></canvas>
        <div class="ariane-badge-stage"><span class="ariane-badge-rays" aria-hidden="true"></span>
          <span class="ariane-badge-kicker">${esc(kicker || (finale ? 'Dans le coffre de La Buse' : 'Trouvé dans la caisse'))} · ${i + 1} / ${queue.length}</span>
          <span class="ariane-badge-spin" aria-hidden="true"><span class="ariane-badge-icon">${esc(item.icon)}</span></span>
          <span class="ariane-loot-name">${esc(item.name)}</span>
          <span class="ariane-loot-text">${esc(item.text)}</span>
          <button type="button" class="ariane-loot-stow">🎒 Ranger dans le sac${i + 1 < queue.length ? ' · objet suivant' : ''}</button></div>`;
      hud.append(box);
      const stop = fireworks(box.querySelector('canvas'), 1600); fanfare();
      shown = { box, stop };
      const stow = () => {
        stop(); shown = null; found.add(item.id); prefs.items[t.id] = [...found]; save(); if (!inventory.hidden) renderInventory();
        box.classList.add('is-leaving'); setTimeout(() => box.remove(), 400);
        if (i + 1 < queue.length) setTimeout(() => show(i + 1), 250); else after();
      };
      const button = box.querySelector('button'); button.addEventListener('click', stow, { once: true }); button.focus({ preventScroll: true });
    };
    show(0);
    return close;
  }
  // Arriving at a stage: its badge the first time, then the quest.
  function arrive(stageInfo) {
    const t = itinerary(current); if (!t) return;
    const stage = t.etapes.find(st => st.id === (stageInfo?.id || stageInfo)); if (!stage) return;
    // Coming back to a door after a zarboutan: the walk simply resumes.
    if (resume && resume.trailId === t.id && resume.stageId === stage.id) { resume = null; prompt.hidden = true; message('🧵 La troupe reprend le Fil d’Ariane.'); world.trails.play(); return; }
    if (t.cache) { if (stage.type === 'arrivee') meetZarboutan(t.zarboutan); else offerHidden(t); return; }
    const won = new Set(prefs.badges[t.id] || []);
    if (won.has(stage.id)) { offerStage(stage.id); return; }
    won.add(stage.id); prefs.badges[t.id] = [...won]; save(); if (!inventory.hidden) renderInventory();
    prompt.hidden = true;
    celebrate(t, stage, () => offerStage(stage.id));
  }
  // « Le grand saut »: the opening, and its invitation to pick a trail.
  function startJump() {
    if (!world.trails.startSkydive?.()) return false;
    closeCard(); setOpen(false); current = null; titleCard.hidden = !guide;
    // Big for a few seconds, then a small banner at the top: the doors stay visible.
    titleCard.classList.remove('is-small'); clearTimeout(startJump.timer); startJump.timer = setTimeout(() => titleCard.classList.add('is-small'), 6500);
    prompt.innerHTML = `<span>🪂 Huit portes pour entrer dans le cirque : clique sur l’une d’elles pour sauter !</span><button type="button" data-prompt="skip">Passer ▸</button>`;
    prompt.style.setProperty('--stage', '#ff7a1a'); prompt.hidden = false; pendingStage = null;
    return true;
  }
  // A stage the troop already stands on offers its quest; a distant one calls the helicopter.
  function reachStage(stageId) {
    if (world.trails.isAtStage(stageId)) { offerStage(stageId); return; }
    if (prefs.cut) { closeCard(); prompt.hidden = true; cut(() => { world.trails.goToStage(stageId); world.setView?.('helico'); syncCams(); arrive(stageId); }, '🚁 L’hélicoptère dépose la troupe à l’étape.'); return; }
    if (!world.trails.travelTo(stageId)) { message('L’hélicoptère est déjà en vol.'); return; }
    closeCard(); prompt.hidden = true; message('🚁 L’hélicoptère vient chercher la troupe…'); syncCams();
  }
  function openCard(stageInfo) {
    prompt.hidden = true;
    const t = itinerary(current); if (!t) return;
    const stage = t.etapes.find(s => s.id === (stageInfo.id || stageInfo)); if (!stage) return;
    cardStage = stage; revealed = false; renderCard();
  }
  function renderCard() {
    const t = itinerary(current), stage = cardStage; if (!t || !stage) { card.hidden = true; return; }
    const finished = doneSet(t.id).has(stage.id);
    let body;
    if (t.cache) {
      const z = t.zarboutan;
      body = `<span class="terrain-eyebrow">SENTIER CACHÉ · ZARBOUTAN N° ${z.numero}</span><h3>🌿 Vers ${esc(z.ilet.nom)}</h3>
        <p class="ariane-card-lead">${esc(z.indice)}</p><p>${esc(z.sentierCache.texte)}</p>
        <div class="ariane-card-actions"><button type="button" class="ariane-play" data-card="go">▶ En route !</button><button type="button" class="ariane-chip" data-card="close">Plus tard</button></div>`;
    } else if (stage.type === 'depart') {
      body = `<span class="terrain-eyebrow">DÉPART · ${esc(stage.nom)}</span><h3>${esc(t.titre)}</h3>
        <p class="ariane-narrator">🐾 Le tangue, notre guide et conteur, ouvre la marche :</p>
        <p class="ariane-card-lead">« ${esc(t.conte.split(/(?<=[.!?])\s/)[0])} »</p>
        <p class="ariane-card-meta">${esc(t.fiche.denivele)} · ${esc(t.fiche.duree)}</p>
        <div class="ariane-card-actions"><button type="button" class="ariane-play" data-card="go">▶ En route !</button><button type="button" class="ariane-chip" data-card="close">Plus tard</button></div>`;
    } else if (stage.type === 'arrivee') {
      body = `<span class="terrain-eyebrow">ARRIVÉE · ${esc(stage.nom)}</span><h3>🏁 Bravo, la troupe est arrivée !</h3>
        <p class="ariane-narrator">🐾 ${esc(portes[t.id]?.arrivee || 'Le tangue est fier de sa troupe.')}</p>
        <p class="ariane-card-meta">${solved(t)} énigme${solved(t) > 1 ? 's' : ''} résolue${solved(t) > 1 ? 's' : ''} sur ${riddleCount(t)}.</p>
        <h4>Les mots à connaître (EN+)</h4>
        <div class="ariane-glossary">${t.enPlus.map(g => `<section><h5>${esc(g.groupe)}</h5>${g.mots.map(w => `<p><b>${esc(w.mot)}</b> : ${esc(w.definition)}</p>`).join('')}</section>`).join('')}</div>
        <div class="ariane-card-actions"><button type="button" class="ariane-play" data-card="arrived">Choisir un autre itinéraire</button><button type="button" class="ariane-chip" data-card="close">Rester ici</button></div>`;
    } else {
      const theme = themes[stage.theme], riddle = stage.enigmes[prefs.level] || Object.values(stage.enigmes)[0] || {};
      const index = t.etapes.indexOf(stage);
      body = `<span class="terrain-eyebrow" style="color:${THEME_COLORS[stage.theme]}">ÉTAPE ${index} SUR ${riddleCount(t)} · ${esc(stage.nom || 'SUR LE SENTIER')}</span>
        <h3><span aria-hidden="true">${theme.emoji}</span> ${esc(theme.nom)}</h3>
        ${levelPills()}
        <p class="ariane-narrator">🐾 Le tangue s’arrête et demande :</p>
        <p class="ariane-question">${esc(riddle.question || 'Énigme à venir.')}</p>
        ${revealed ? `<p class="ariane-answer"><b>Réponse :</b> ${esc(riddle.reponse || '—')}</p>` : `<button type="button" class="ariane-chip" data-card="reveal">Voir la réponse</button>`}
        <div class="ariane-card-actions"><button type="button" class="ariane-play" data-card="solved">${finished ? '▶ Continuer la marche' : '✓ Trouvé ! On repart'}</button><button type="button" class="ariane-chip" data-card="close">Rester ici</button></div>`;
    }
    card.innerHTML = `<button type="button" class="ariane-card-close" data-card="close" aria-label="Fermer">×</button>${body}`;
    card.style.setProperty('--stage', THEME_COLORS[stage.theme || stage.type] || '#2f7d4f');
    card.hidden = false;
  }
  function closeCard() { card.hidden = true; cardStage = null; zarbCard = null; }
  function markDone(stageId) {
    const set = doneSet(current); set.add(stageId); prefs.done[current] = [...set]; save();
    world.trails.markDone(current, stageId, true);
    summaries = summaries.map(s => s.id === current ? { ...s, done: [...set] } : s);
    const row = panel.querySelector(`[data-stage="${CSS.escape(stageId)}"]`);
    if (row) { row.classList.add('done'); row.querySelector('.ariane-stage-state').textContent = '✓'; }
    fillChapters();
  }

  // « Rejoindre un lieu » becomes the chapters of the trails: every stage of
  // every itinerary, reached by the helicopter; the island's landmarks follow.
  const destination = hud.querySelector('#terrain-destination-select');
  function chapterLabel(t, stage) {
    if (stage.type === 'depart') return `⚑ Départ · ${stage.nom}`;
    if (stage.type === 'arrivee') return `🏁 Arrivée · ${stage.nom}`;
    const theme = themes[stage.theme] || {};
    return `${theme.emoji || '•'} ${t.etapes.indexOf(stage)}. ${theme.nom || 'Énigme'}${stage.nom ? ` · ${stage.nom}` : ''}`;
  }
  // The chapters: a folding panel instead of a long list. Only the current
  // trail is open with its stages; the other trails, the waterfalls and the
  // landmarks stay folded until asked for.
  const chapters = document.createElement('div'); chapters.className = 'ariane-chapters';
  chapters.innerHTML = `<button type="button" class="ariane-chapters-toggle" aria-expanded="false" aria-haspopup="true">📖 <span>Chapitres</span> ▴</button><div class="ariane-chapters-panel" hidden></div>`;
  destination?.parentElement?.prepend(chapters);
  const chaptersToggle = chapters.querySelector('.ariane-chapters-toggle'), chaptersPanel = chapters.querySelector('.ariane-chapters-panel');
  const setChapters = open => { chaptersPanel.hidden = !open; chaptersToggle.setAttribute('aria-expanded', String(open)); if (open) fillChapters(); };
  chaptersToggle.addEventListener('click', () => setChapters(chaptersPanel.hidden));
  document.addEventListener('pointerdown', event => { if (!chaptersPanel.hidden && !event.target.closest('.ariane-chapters')) setChapters(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !chaptersPanel.hidden) setChapters(false); });
  function fillChapters() {
    const here = current ? itinerary(current) : null;
    const stages = t => { const finished = doneSet(t.id); return `<ol>${t.etapes.map(stage => `<li><button type="button" data-go="stage:${esc(t.id)}:${esc(stage.id)}" class="${finished.has(stage.id) ? 'done' : ''}">${finished.has(stage.id) ? '✓ ' : ''}${esc(chapterLabel(t, stage))}</button></li>`).join('')}</ol>`; };
    const trail = t => `<details${t === here ? ' open class="is-current"' : ''} style="--trail:${esc(t.couleur)}"><summary><span class="ariane-num">${t.numero}</span><span>${esc(t.titre)}</span><small>${solved(t)}/${riddleCount(t)}</small></summary>${stages(t)}</details>`;
    const falls = [...new Set((world.getWaterfalls?.() || []).map(f => f.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const places = destination ? [...destination.querySelectorAll('option')].filter(o => o.value && !o.value.includes(':')).map(o => ({ id: o.value, name: o.textContent })) : [];
    chaptersPanel.innerHTML = `<header>Chapitres des parcours</header>
      ${here ? trail(here) : ''}
      <p class="ariane-chapters-heading">${here ? 'Les autres sentiers' : 'Les huit sentiers'}</p>
      ${data.itineraires.filter(t => t !== here).map(trail).join('')}
      ${zarboutans.length ? `<details class="ariane-chapters-group"><summary>🧓 Zarboutans <small>${prefs.zarb.met.length}/${zarboutans.length}</small></summary><ol>${zarboutans.filter(z => known(z.id)).map(z => `<li><button type="button" data-go="zarb:${esc(z.id)}" class="${met(z.id) ? 'done' : ''}">${met(z.id) ? '✓ ' : ''}${esc(ELEMENTS[z.element]?.emoji || '🧓')} ${z.numero}. ${esc(met(z.id) ? z.nom : 'Zarboutan')} · ${esc(z.ilet.nom)}</button></li>`).join('') || '<li><small>Résous les énigmes : leurs indices ouvrent les sentiers cachés.</small></li>'}</ol></details>` : ''}
      ${falls.length ? `<details class="ariane-chapters-group"><summary>💧 Cascades <small>${falls.length}</small></summary><ol>${falls.map(name => `<li><button type="button" data-go="cascade:${esc(name)}">💧 ${esc(name)}</button></li>`).join('')}</ol></details>` : ''}
      ${places.length ? `<details class="ariane-chapters-group"><summary>📍 Repères de l’île <small>${places.length}</small></summary><ol>${places.map(place => `<li><button type="button" data-go="place:${esc(place.id)}">${esc(place.name)}</button></li>`).join('')}</ol></details>` : ''}`;
  }
  chaptersPanel.addEventListener('click', event => { const b = event.target.closest('[data-go]'); if (!b) return; setChapters(false); goTo(b.dataset.go); });
  function goTo(value) {
    if (value.startsWith('place:')) {
      // The landmarks keep their own way there (the explorer's teleport).
      destination.value = value.slice(6); destination.dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    if (value.startsWith('cascade:')) {
      if (world.visitWaterfall?.(value.slice(8))) { closeCard(); prompt.hidden = true; message(`💧 ${value.slice(8)} · cours d’eau © contributeurs OpenStreetMap`); syncCams(); }
      return;
    }
    if (value.startsWith('zarb:')) { goToZarboutan(value.slice(5)); return; }
    if (!value.startsWith('stage:')) return;
    const [, trailId, ...rest] = value.split(':'), stageId = rest.join(':');
    if (!itinerary(trailId)) return;
    if (current !== trailId) { renderTrail(trailId, { fly: false }); setOpen(true); }
    // Picked during the big jump: the helicopter takes over at once.
    if (world.getView?.().view === 'skydive') world.setView('helico');
    reachStage(stageId);
  }

  function selectLevel(level) { if (!levels.some(l => l.id === level)) return; prefs.level = level; save(); for (const b of hud.querySelectorAll('[data-level]')) { b.classList.toggle('active', b.dataset.level === level); b.setAttribute('aria-pressed', String(b.dataset.level === level)); } if (!card.hidden) { revealed = false; if (zarbCard) renderZarbCard(); else renderCard(); } }

  panel.addEventListener('click', event => {
    const el = event.target.closest('button,[data-action]'); if (!el) return;
    if (el.dataset.trail) {
      if (world.getView?.().view === 'skydive') { world.trails.chooseSkydive(el.dataset.trail); setOpen(false); return; }
      renderTrail(el.dataset.trail); return;
    }
    if (el.dataset.level) { selectLevel(el.dataset.level); return; }
    if (el.dataset.stage) { reachStage(el.dataset.stage); return; }
    if (el.dataset.zarb) { const z = zarbOf(el.dataset.zarb); if (z && met(z.id) && (current === z.id || el.classList.contains('ariane-chip'))) openZarbCard(z); else if (z) goToZarboutan(z.id); return; }
    if (el.dataset.action === 'door') { const z = zarbOf(current); if (z) backToDoor(z); else renderList(); return; }
    switch (el.dataset.action) {
      case 'close': setOpen(false); break;
      case 'list': closeCard(); renderList(); break;
      case 'play': if (progress.playing) world.trails.pause(); else { closeCard(); prompt.hidden = true; world.trails.play(); } break;
      case 'follow': follow = world.trails.setFollow(!follow); el.classList.toggle('active', follow); el.setAttribute('aria-pressed', String(follow)); break;
      case 'overview': follow = world.trails.setFollow(false); world.trails.overview(current); renderFollow(); break;
      case 'zoom': { const t = itinerary(current); lightbox.innerHTML = `<img src="./trails/${esc(t.image)}" alt="Fiche technique illustrée : ${esc(t.titre)}"><button type="button" aria-label="Fermer">×</button>`; lightbox.hidden = false; break; }
    }
  });
  panel.addEventListener('change', event => {
    const el = event.target;
    if (el.dataset.action === 'speed') { prefs.speed = el.value; world.trails.setSpeed(prefs.speed); save(); }
    if (el.dataset.action === 'stops') { prefs.stops = el.checked; world.trails.setStops(prefs.stops); save(); }
    if (el.dataset.action === 'helico') { prefs.helicoAtStages = el.checked; save(); }
    if (el.dataset.action === 'flight') { prefs.cut = !el.checked; save(); }
  });
  card.addEventListener('click', event => {
    const el = event.target.closest('button'); if (!el) return;
    if (el.dataset.level) { selectLevel(el.dataset.level); return; }
    if (zarbCard && el.dataset.card === 'reveal') { revealed = true; renderZarbCard(); return; }
    switch (el.dataset.card) {
      case 'close': closeCard(); break;
      case 'reveal': revealed = true; renderCard(); break;
      case 'go': closeCard(); world.trails.play(); break;
      case 'solved': { const stageId = cardStage.id; markDone(stageId); closeCard(); if (!cluesAt(current, stageId)) world.trails.play(); break; }
      case 'back-door': if (zarbCard) backToDoor(zarbCard); break;
      case 'walk-back': if (zarbCard) backToDoor(zarbCard, { walk: true }); break;
      case 'jump': closeCard(); startJump(); syncCams(); break;
      case 'arrived': markDone('arrivee'); closeCard(); inviteDoors(); break;
    }
  });
  lightbox.addEventListener('click', () => { lightbox.hidden = true; lightbox.innerHTML = ''; });
  toggle.addEventListener('click', () => setOpen(sidebar.hidden));
  function setMenusHidden(value) { prefs.menusHidden = !!value; hud.classList.toggle('menus-hidden', prefs.menusHidden); save(); }
  menusToggle.addEventListener('click', () => setMenusHidden(true));
  barTab.addEventListener('click', () => setMenusHidden(false));
  setMenusHidden(!!prefs.menusHidden);
  function showTab(name) {
    for (const b of tabs.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); }
    panel.hidden = name !== 'fil'; inventory.hidden = name !== 'inventaire';
    if (name === 'inventaire') renderInventory();
  }
  tabs.addEventListener('click', event => { const b = event.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  // The explorer's bag: doors walked through and badges won, trail by trail.
  function renderInventory() {
    const walked = data.itineraires.filter(t => doneSet(t.id).has('arrivee')).length;
    const total = data.itineraires.reduce((n, t) => n + (prefs.badges[t.id] || []).length, 0);
    const icon = stage => stage.type === 'depart' ? '⚑' : stage.type === 'arrivee' ? '🏆' : themes[stage.theme]?.emoji || '🏅';
    inventory.innerHTML = `<header class="ariane-head"><div><span class="terrain-eyebrow">TON SAC D’EXPLORATEUR</span><h2>Badges et trésors</h2></div><button type="button" class="terrain-icon-button ariane-close" data-action="close-sidebar" aria-label="Fermer">×</button></header>
      <p class="ariane-doors">🚪 ${walked} porte${walked > 1 ? 's' : ''} sur 8 franchie${walked > 1 ? 's' : ''} · 🏅 ${total} badge${total > 1 ? 's' : ''}</p>
      <ol class="ariane-inventory-list">${data.itineraires.map(t => {
        const won = new Set(prefs.badges[t.id] || []);
        return `<li style="--trail:${esc(t.couleur)}"><span class="ariane-num">${t.numero}</span><div><strong>${esc(t.titre)}</strong><span class="ariane-mini-badges">${t.etapes.map(stage => `<span class="ariane-mini-badge${won.has(stage.id) ? ' won' : ''}" title="${esc(stage.type === 'enigme' ? themes[stage.theme]?.nom || 'Énigme' : stage.nom)}${won.has(stage.id) ? ' · badge gagné' : ''}">${icon(stage)}</span>`).join('')}</span></div></li>`;
      }).join('')}</ol>
      ${guideHtml()}
      ${objectsHtml()}`;
  }
  // The zarboutans' guide: 32 pages, a letter on each page met, and the gifts.
  function guideHtml() {
    if (!guide) return '';
    const gifts = zarboutans.filter(z => met(z.id));
    return `<h3 class="ariane-objects-title">📖 Le guide zarboutan <span>${gifts.length} / ${zarboutans.length}</span></h3>
      <p class="ariane-zarb-message" aria-label="Message du guide">${esc(messageSoFar())}</p>
      <ol class="ariane-zarb-grid">${zarboutans.map(z => {
        const el = ELEMENTS[z.element] || {}, state = met(z.id) ? 'met' : known(z.id) ? 'known' : 'hidden';
        return `<li class="is-${state}" style="--el:${esc(el.couleur || '#999')}">${state === 'hidden' ? `<span title="Page ${z.numero} : encore blanche">${z.numero}</span>`
          : `<button type="button" data-zarb="${esc(z.id)}" title="${esc(state === 'met' ? `${z.nom} · ${z.ilet.nom}` : `À rencontrer : ${z.ilet.nom}`)}"><span>${esc(el.emoji || '🧓')}</span><b>${z.numero}</b>${state === 'met' ? `<i>${esc(z.lettre)}</i>` : ''}</button>`}</li>`;
      }).join('')}</ol>
      ${gifts.length ? `<ul class="ariane-objects">${gifts.map(z => `<li title="${esc(z.don.texte)}"><span>${esc(z.don.icone)}</span><small>${esc(z.don.nom)}<em>${esc(z.nom)}</em></small></li>`).join('')}</ul>` : '<p class="ariane-soon">Résous les énigmes du Fil d’Ariane : certaines étapes cachent l’indice d’un sentier secret.</p>'}`;
  }
  // Objects found in the containers, and the troop's gold.
  function objectsHtml() {
    const found = data.itineraires.flatMap(t => (prefs.items[t.id] || []).map(id => ({ t, item: lootFor(t, t.etapes.find(st => id === st.id || id === `${st.id}-or`) || {}).find(item => item.id === id) }))).filter(entry => entry.item);
    const gold = found.reduce((n, entry) => n + (entry.item.gold || 0), 0), things = found.filter(entry => !entry.item.gold);
    return `<h3 class="ariane-objects-title">Objets trouvés <span>💰 ${gold} pièce${gold > 1 ? 's' : ''} d’or</span></h3>
      ${things.length ? `<ul class="ariane-objects">${things.map(({ t, item }) => `<li title="${esc(item.text)}"><span>${esc(item.icon)}</span><small>${esc(item.name)}<em>${esc(t.titre)}</em></small></li>`).join('')}</ul>` : '<p class="ariane-soon">Ouvre les caisses des étapes : chacune cache un objet.</p>'}`;
  }
  inventory.addEventListener('click', event => {
    if (event.target.closest('[data-action="close-sidebar"]')) setOpen(false);
    const b = event.target.closest('[data-zarb]'); if (!b) return;
    const z = zarbOf(b.dataset.zarb); if (!z) return;
    if (met(z.id)) openZarbCard(z); else goToZarboutan(z.id);
  });
  function renderFollow() { const b = panel.querySelector('[data-action="follow"]'); if (b) { b.classList.toggle('active', follow); b.setAttribute('aria-pressed', String(follow)); } }

  container.addEventListener('trailevent', ({ detail }) => {
    if (tele) { teleEvent(detail); return; }
    switch (detail.type) {
      case 'select-request':
        if (itinerary(detail.trailId)?.cache) { goToZarboutan(detail.trailId); break; }
        setOpen(true); renderTrail(detail.trailId); offerStage('depart'); break;
      case 'stage': if (detail.trailId === current) {
        // By default the camera swings to the helicopter around the halted troop.
        if (prefs.helicoAtStages && world.getView?.().view !== 'char-free') { world.setView('helico'); syncCams(); }
        arrive(detail.stage); progress.playing = false; updateProgress();
      } break;
      case 'stage-click':
        if (detail.trailId !== current) renderTrail(detail.trailId, { fly: false });
        reachStage(detail.stageId); break;
      case 'transfer-start': syncCams(); break;
      case 'skydive-choice': {
        titleCard.hidden = true;
        renderTrail(detail.trailId, { fly: false, keep: true });
        prompt.innerHTML = `<span>🪂 Cap sur ${esc(itinerary(detail.trailId)?.titre || 'ton sentier')} !</span>`; prompt.hidden = false; syncCams(); break;
      }
      case 'skydive-end': if (detail.trailId) { if (current !== detail.trailId) renderTrail(detail.trailId, { fly: false }); arrive('depart'); } syncCams(); break;
      case 'transfer-end': if (detail.trailId === current) { arrive(detail.stage); syncCams(); } break;
      case 'chest-opened': if (detail.trailId === current) {
        // The objects come out one by one; the riddle after them.
        const t = itinerary(current), stage = t?.etapes.find(st => st.id === detail.stageId);
        if (stage) revealItems(t, stage, lootFor(t, stage), () => openCard(stage.id)); else openCard(detail.stageId);
      } break;
      case 'rivers-loaded': fillChapters(); trailMap.refresh(); break;
      // The board at a trail's entrance: read its fiche.
      case 'sign-click': renderTrail(detail.trailId, { fly: false }); setOpen(true); openCard('depart'); break;
      case 'progress': case 'halt': if (detail.trailId === current) {
        progress = { ...progress, ...detail }; if (detail.type === 'halt') progress.playing = false; updateProgress(); trailMap.setProgress(progress.s);
        // Walked back down a hidden trail: on to the door, where the walk resumes.
        if (detail.type === 'halt' && resume && itinerary(current)?.cache && detail.s < 3) {
          const back = resume; resume = null;
          renderTrail(back.trailId, { fly: false, stage: back.stageId }); message('🧵 La troupe reprend le Fil d’Ariane.'); world.trails.play();
        }
      } break;
      case 'walk-to': closeCard(); message(`La troupe part vers ce point du sentier (${formatKm(detail.s)}).`); break;
      case 'toggle-walk': if (current) { if (progress.playing) world.trails.pause(); else { closeCard(); world.trails.play(); } } break;
      case 'follow': follow = detail.follow; renderFollow(); break;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!lightbox.hidden) { lightbox.hidden = true; lightbox.innerHTML = ''; } else if (!card.hidden) closeCard();
  });

  // ---- The gamebook's television (?tele=1): the book tells, the troop walks.
  // One cue per paragraph: « ciel », « final », « sentier-3 » (the door),
  // « sentier-3:marche-2 » (on the way to stage 2), « sentier-3:etape-2 » (its
  // crate, closed), « sentier-3:caisse-2 » (opened), « sentier-3:arrivee »
  // (La Buse's chest), « z07:sentier » (the hidden trail), « z07 » (the
  // zarboutan's îlet). When the story follows on, the troop walks; when it
  // goes elsewhere, a cut; from the sky, the big jump lands at the door.
  let teleAt = null, teleGoal = null;
  function teleCue(cue) {
    const [head, part = ''] = String(cue || '').split(':');
    if (head === 'ciel') { teleGoal = null; if (world.getView?.().view !== 'skydive') cut(() => { teleAt = null; startJump(); }); return true; }
    if (head === 'final') {
      teleGoal = null;
      cut(() => { teleAt = null; current = null; world.trails.select(null, { fly: false }); world.resetView?.(); const top = world.getLandmarks?.().find(l => /Piton des Neiges/i.test(l.name)); if (top) world.focusLandmark(top.id); });
      return true;
    }
    const t = /^z\d{2}$/.test(head) ? itinerary(head) : data.itineraires.find(x => `sentier-${x.numero}` === head);
    if (!t) return false;
    const riddles = t.etapes.filter(s => s.type === 'enigme'), k = Number(part.split('-')[1]) || 0;
    const stageOf = n => (n < 1 ? 'depart' : riddles[n - 1]?.id || 'arrivee');
    const goal = t.cache ? (part === 'sentier' ? { from: 'depart', to: 'arrivee' } : { at: 'arrivee' })
      : part.startsWith('marche') ? { from: stageOf(k - 1), to: stageOf(k) }
        : part.startsWith('etape') ? { at: stageOf(k), chest: 'closed' }
          : part.startsWith('caisse') ? { at: stageOf(k), chest: 'open' }
            : part === 'arrivee' ? { at: 'arrivee', chest: 'closed' } : { at: 'depart' };
    teleGoal = { trailId: t.id, ...goal };
    const target = goal.to || goal.at;
    // Still landing from the big jump: the landing will carry on with the story.
    if (teleAt?.landing && teleAt.trailId === t.id) return true;
    // Already there, or on the way: no cut.
    if (teleAt?.trailId === t.id && teleAt.stageId === target) { if (!teleAt.walking) teleSettle(); return true; }
    if (teleAt?.trailId === t.id && goal.from && teleAt.stageId === goal.from && !teleAt.walking) { teleWalk(goal.to); return true; }
    if ((goal.from || goal.at) === 'depart' && world.getView?.().view === 'skydive' && world.trails.chooseSkydive(t.id)) {
      current = t.id; teleAt = { trailId: t.id, stageId: 'depart', walking: false, landing: true }; return true;
    }
    teleWalking(false);
    cut(() => {
      world.trails.select(t.id, { fly: false, stage: goal.from || goal.at }); current = t.id; showOnMap(t.id); world.setView?.(teleView);
      teleAt = { trailId: t.id, stageId: goal.from || goal.at, walking: false };
      if (goal.to) teleWalk(goal.to); else teleSettle();
    });
    return true;
  }
  // While the troop walks, the trail's map and profile show beside the legend (Florian, 18/10).
  const teleWalking = on => document.body.classList.toggle('tele-walking', !!on);
  function teleWalk(stageId) { teleAt = { trailId: current, stageId, walking: true }; showOnMap(current); teleWalking(true); world.trails.walkToStage(stageId); world.setView?.(teleView); }
  // Arrived where the story is: the crate, closed or opening, or nothing.
  // The television celebrates too, once per place: a stage's badge, a door walked through, a zarboutan met.
  const teleCelebrated = new Set();
  function teleCelebrate(t, stageId) {
    const key = `${t.id}:${stageId}`;
    if (teleCelebrated.has(key)) return;
    if (t.cache) { if (stageId === 'arrivee') { teleCelebrated.add(key); zarbBadge(t.zarboutan); } return; }
    const stage = t.etapes.find(st => st.id === stageId);
    if (!stage || stage.type === 'depart') return;
    teleCelebrated.add(key); celebrate(t, stage, () => {});
  }
  function teleSettle() {
    const g = teleGoal;
    if (g && g.trailId === current && teleAt?.stageId === (g.to || g.at) && !teleAt.walking) teleCelebrate(itinerary(current), teleAt.stageId);
    if (g && g.trailId === current && teleAt?.stageId === (g.to || g.at)) {
      if (!g.chest) world.trails.hideChest?.();
      else if (world.trails.showChest(teleAt.stageId) && g.chest === 'open') setTimeout(() => { if (teleGoal === g) world.trails.openChest(); }, 600);
    }
    teleRender();
  }
  // The book's buttons, in the television too: the same buttons, in sync. A button is a choice of the current
  // paragraph ({ index, text, tag, gives }) ; whichever is pressed, here or in the text, the book chooses and
  // sends the new buttons back. The tag ties a choice to a thing of the world: « coffre » (the crate or the
  // chest, clickable), « ranger » (what it holds, stowed in the bag), « marcher » (the troop), a door
  // (« sentier-3 ») or a zarboutan's trail (« z07 »). The rest: buttons in the prompt bar.
  let teleChoices = [], teleSection = null, teleLastCue = null, teleLoot = null;
  // The television's views, shown by the book in its own bar (Florian, 18/10 : hélico, papangue, loup, panorama,
  // planeur, grand saut). The camera view chosen is kept for the walks and the stages.
  let teleView = 'helico';
  const TELE_VIEWS = [
    { id: 'helico', icon: '🚁', label: 'Hélico : cercles autour de la troupe', trail: true },
    { id: 'papangue', icon: '🦅', label: 'Papangue : grands cercles au-dessus du sentier', trail: true },
    { id: 'loup', icon: '🐺', label: 'Loup : au ras du sol, autour de la troupe', trail: true },
    { id: 'panorama', icon: '🌋', label: 'Panorama : l’île qui tourne lentement' },
    { id: 'glide', icon: '🪁', label: 'Planeur : voler au-dessus de l’île (il suit le centre de l’écran)' },
    { id: 'skydive', icon: '🪂', label: 'Le grand saut' },
  ];
  function teleViewsOut() {
    const now = world.getView?.().view;
    toBook({ type: 'livre-heros:tele-views', views: TELE_VIEWS.map(v => ({ id: v.id, icon: v.icon, label: v.label,
      active: (ACTIVE_FOR[v.id] || [v.id]).includes(now), disabled: !!v.trail && !current })) });
  }
  // The big jump of the story is the book's (« Le grand saut ») when it offers it ; otherwise, just the view.
  function teleSetView(id) {
    if (id === 'skydive' && teleChoices.some(c => c.tag === 'saut')) { teleTag('saut'); return; }
    if (['helico', 'papangue', 'loup'].includes(id)) teleView = id;
    chooseView(id); teleViewsOut();
  }
  const toBook = message => { try { window.parent.postMessage(message, '*'); } catch { /* No book around. */ } };
  function teleChoose(c) { if (c) toBook({ type: 'livre-heros:tele-choice', index: c.index, tag: c.tag || null, section: teleSection }); }
  function teleTag(tag) { const c = teleChoices.find(x => x.tag === tag); if (c) teleChoose(c); else toBook({ type: 'livre-heros:tele-choice', tag, section: teleSection }); }
  let telePaused = false, teleLegend = 0;
  // The places the reader knows (the book's world map) : the hidden trails of their îlets show up, the « easter
  // eggs » to go and find, in the panorama as anywhere (Florian, 18/10). Names compared without typography.
  const placeKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`\s\u00a0\u202f-]+/g, ' ').trim().toLowerCase();
  let teleKnown = [], teleToFind = [];
  function teleUpdate({ cue = '', choices = [], section = null, paused = false, legend = 0, top = 0, places = [], visited = [] } = {}) {
    teleSection = section;
    const known = new Set(places.map(placeKey)), been = new Set(visited.map(placeKey));
    teleKnown = zarboutans.filter(z => known.has(placeKey(z.ilet.nom))).map(z => z.id);
    teleToFind = zarboutans.filter(z => known.has(placeKey(z.ilet.nom)) && !been.has(placeKey(z.ilet.nom))).map(z => z.id);
    const fresh = teleKnown.filter(id => !prefs.zarb.revealed.includes(id));
    if (fresh.length) { prefs.zarb.revealed = [...prefs.zarb.revealed, ...fresh]; world.trails.setRevealed?.(prefs.zarb.revealed); }
    // The book's legend along the bottom: the buttons, the loot and the map stand just above it ; its badge
    // at the top left: the map goes below it.
    teleLegend = Math.max(0, Number(legend) || 0);
    document.documentElement.style.setProperty('--book-legend', `${teleLegend}px`);
    document.documentElement.style.setProperty('--book-top', `${Math.max(0, Number(top) || 0)}px`);
    // A challenge open over the television: the world stops (last picture kept), and goes on afterwards.
    if (paused !== telePaused) { telePaused = paused; world.setVisible?.(!paused); }
    teleChoices = choices.filter(c => c && c.available !== false && c.text);
    if (cue && cue !== teleLastCue) { teleLastCue = cue; teleCue(cue); }
    teleRender();
  }
  // Drawn again once the troop stands where the story is (after a cut, a walk or the big jump).
  function teleRender() {
    const section = teleSection, stow = teleChoices.find(c => c.tag === 'ranger');
    // Something to take out of the crate: it opens, and its objects come out one by one.
    const lootKey = stow ? `${section}#${stow.index}` : null;
    if (teleLoot && teleLoot.key !== lootKey) { teleLoot.close(); teleLoot = null; }
    if (stow && !teleLoot && teleAt && !teleAt.walking && !teleAt.landing && teleAt.trailId === current) {
      const t = itinerary(current), stage = t?.etapes.find(st => st.id === teleAt.stageId);
      if (t && stage) {
        if (world.trails.showChest(stage.id)) world.trails.openChest();
        const items = (stow.gives || []).map((g, i) => ({ id: `${lootKey}-${i}`, icon: g.icon || '🎁', name: g.name, text: g.text || '' }));
        teleLoot = { key: lootKey, close: revealItems(t, stage, items, () => { teleLoot = null; teleChoose(stow); }) };
      }
    }
    // The trails the book offers: a hidden one shows up (so that it can be clicked), and all of them beckon.
    const offered = teleChoices.map(c => c.tag).filter(Boolean)
      .map(tag => (/^z\d{2}$/.test(tag) ? tag : data.itineraires.find(x => `sentier-${x.numero}` === tag)?.id)).filter(id => id && itinerary(id));
    const hidden = offered.filter(id => itinerary(id).cache && !prefs.zarb.revealed.includes(id));
    if (hidden.length) { prefs.zarb.revealed = [...prefs.zarb.revealed, ...hidden]; world.trails.setRevealed?.(prefs.zarb.revealed); }
    // What the book offers beckons ; otherwise the îlets found and not yet reached (their page not there).
    world.trails.beckon?.(offered.length ? offered : teleToFind.filter(id => id !== current));
    const rest = teleChoices.filter(c => c !== stow);
    prompt.innerHTML = rest.map(c => `<button type="button" data-tele-choice="${c.index}"${c.tag ? ` data-tag="${esc(c.tag)}"` : ''}>${esc(c.text)}</button>`).join('');
    prompt.style.setProperty('--stage', '#2f7d4f'); prompt.hidden = !rest.length;
    // The camera's subject in the middle of the free picture, above the legend and the buttons (Florian, 18/10).
    const onTrail = !!current && !!itinerary(current);
    document.body.classList.toggle('tele-trail', onTrail); teleViewsOut();
    // On a phone the map starts folded (its title bar only, « + » unfolds it) : the troop stays in sight.
    const anyMap = hud.querySelector('.trail-map');
    if (onTrail && anyMap && innerWidth < 700 && !teleRender.folded) {
      teleRender.folded = true; anyMap.classList.add('is-folded');
      const fold = anyMap.querySelector('.trail-map-fold'); if (fold) { fold.textContent = '+'; fold.setAttribute('aria-expanded', 'false'); }
    }
    // On a wide picture, the map on the left counts too: the subject moves right, into the free part.
    const mapBox = onTrail && innerWidth >= 900 ? anyMap : null;
    world.setViewInsets?.({ top: 0, bottom: teleLegend + (prompt.hidden ? 0 : prompt.offsetHeight + 10), left: mapBox ? mapBox.offsetWidth + 20 : 0 });
  }
  if (tele) {
    // A click in the world is one of the book's buttons, when a thing of the world stands for it.
    const tagOf = hit => {
      if (hit.type === 'chest') return 'coffre';
      if (hit.type === 'troop' || hit.type === 'sign') return 'marcher';
      const t = hit.trailId && itinerary(hit.trailId);
      if (!t) return null;
      if (t.cache) return t.id;
      return t.id === current && hit.type !== 'door' ? 'marcher' : `sentier-${t.numero}`;
    };
    // A tap on nothing in particular turns the book's legend to its next line.
    world.setPickHandler?.(hit => { if (hit.type === 'none') { toBook({ type: 'livre-heros:tele-tap' }); return true; } const tag = tagOf(hit); if (tag) teleTag(tag); return true; });
    // The wheel turns the book's subtitles, not the camera.
    container.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); toBook({ type: 'livre-heros:tele-wheel', deltaY: event.deltaY }); }, { capture: true, passive: false });
  }
  function teleEvent(detail) {
    if ((detail.type === 'progress' || detail.type === 'halt') && detail.trailId === current && Number.isFinite(detail.s)) trailMap.setProgress(detail.s);
    if (detail.type === 'skydive-end' && detail.trailId) {
      current = detail.trailId; showOnMap(detail.trailId); teleAt = { trailId: detail.trailId, stageId: 'depart', walking: false };
      if (teleGoal?.trailId === detail.trailId && teleGoal.to) teleWalk(teleGoal.to); else teleSettle();
      return;
    }
    if ((detail.type === 'stage' || detail.type === 'halt') && detail.trailId === current && teleAt?.walking) { teleAt.walking = false; teleWalking(false); teleSettle(); }
  }
  if (tele) {
    document.body.classList.add('tele-mode'); world.trails.setStops?.(true);
    // For tests and diagnosis: where the television thinks the troop is.
    window.__tele = () => ({ cue: teleLastCue, at: teleAt, goal: teleGoal, current, view: world.getView?.().view, choices: teleChoices.length });
  }

  renderList(); fillChapters(); beckonDoors();
  // Every visit opens with the big jump; « Passer » goes straight to the map.
  if (!startJump()) { if (prefs.trail && itinerary(prefs.trail)) renderTrail(prefs.trail, { fly: false }); setOpen(prefs.open); }
  // A link from the gamebook: #z07 dives to that zarboutan's hidden trail,
  // #sentier-3 to the third door.
  const linked = link?.startsWith('z') ? itinerary(link) : link ? data.itineraires.find(t => `sentier-${t.numero}` === link) : null;
  if (linked) {
    if (linked.cache && !known(linked.id)) { prefs.zarb.revealed.push(linked.id); save(); world.trails.setRevealed?.(prefs.zarb.revealed); fillChapters(); }
    if (world.getView?.().view === 'skydive' && world.trails.chooseSkydive(linked.id)) renderTrail(linked.id, { fly: false, keep: true });
  }
  return {
    open: () => setOpen(true),
    select: id => { setOpen(true); renderTrail(id); },
    tele: teleUpdate, teleView: teleSetView,
  };
}
