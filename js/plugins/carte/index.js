// Greffon « carte » — interface.
// - Bloc « Carte » : image à zones cliquables (lecture) et éditeur visuel (tracer, déplacer, redimensionner).
// - Carte du monde : bouton de la Feuille d'Aventure, onglet de l'éditeur, annexe de la version imprimable.
// - Effet « Révéler un lieu » et conditions de lieu dans les listes de l'éditeur.
// Aucune information ne repose sur la couleur : cadres en pointillés, cadenas, formes des repères et texte.

import './core.js';
import { html, useState, useEffect, useRef, useMemo } from '../../lib/preact-htm.js';
import { Icon, Modal, loadCSS } from '../../ui/common.js';
import { registerBlockUI, registerSheetPanel, registerEditorTab, registerPrintSection, registerEffectUI, registerConditionUI } from '../../ui/registry.js';
import { Text, Num, ImageSlot, ConditionEditor, EffectsEditor } from '../../ui/editor.js';
import { assetUrl } from '../../store/library.js';
import {
  TYPE, hotspotsFor, chooseHotspot, rectOf, round1, clamp, placesOf, placeName, placePos,
  worldMarkers, journeyPoints, visitedPlaces, currentPlace, knownPlaces,
} from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

const pos = r => `left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
let uid = 0;

/** URL affichable d'une image de l'aventure (la source « local » retombe sur le dossier publié). */
function useAssetUrl(adv, source, path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let on = true;
    setUrl(null);
    if (path) assetUrl(adv, source || 'local', path).then(u => on && setUrl(u)).catch(() => {});
    return () => { on = false; };
  }, [adv?.id, source, path]);
  return url;
}

/** Position en % d'un événement de pointeur dans un élément. */
function pointIn(el, e) {
  const r = el.getBoundingClientRect();
  return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
}

/* ------------------------------------------------------------------ */
/* Lecture : carte à zones cliquables                                  */
/* ------------------------------------------------------------------ */

function MapPlayer({ adv, source, state, index, block, update }) {
  const url = useAssetUrl(adv, source, block.image);
  const [broken, setBroken] = useState(false);
  const [note, setNote] = useState('');
  const spots = hotspotsFor(state, adv, block);
  const locked = spots.some(h => !h.available);
  const pick = h => {
    if (!h.available) { setNote(html`<span><b>${h.label || 'Ce passage'}</b> — fermé. ${h.reason}</span>`); return; }
    try { const r = chooseHotspot(state, adv, index, h.index); update(r.state, r.messages); } catch (e) { setNote(e.message); }
  };
  const tell = h => (h.available ? `${h.label || 'Passage'} — rendez-vous au ${h.to}` : `${h.label || 'Passage'} — fermé. ${h.reason}`);
  const withImage = !!block.image && !broken;

  // Sur un écran étroit, les zones n'affichent qu'un numéro (repris dans la légende) : les noms ne se chevauchent
  // plus et ne masquent pas les zones voisines. Les lignes de la légende sont de vrais boutons, cibles sûres au doigt.
  return html`<section class="block carte-block">
    <h3><${Icon} name="map" />${block.label || 'Carte'}</h3>
    ${withImage && html`
      <p class="subtle" style="margin:0">Touchez ou cliquez une zone encadrée de pointillés, ou une destination de la légende, pour vous y rendre${locked ? ' ; un cadenas signale un passage fermé' : ''}.</p>
      <div class="carte-frame">
        ${url && html`<img src=${url} alt=${block.alt || ''} draggable="false" onError=${() => setBroken(true)} />`}
        ${url && spots.map((h, n) => html`<button type="button" key=${h.index} class=${'carte-zone' + (h.available ? '' : ' locked')} style=${pos(rectOf(h))}
            aria-disabled=${h.available ? undefined : 'true'} aria-label=${tell(h)} title=${tell(h)} onClick=${() => pick(h)}>
          <span class="carte-tag">${!h.available && html`<${Icon} name="lock" />`}<span class="carte-num" aria-hidden="true">${n + 1}</span><span class="carte-lbl">${h.label || h.to}</span></span>
        </button>`)}
      </div>
      <ul class="carte-legend" aria-label="Destinations de la carte">${spots.map((h, n) => html`<li key=${h.index} class=${h.available ? '' : 'locked'}>
        <button type="button" class="carte-leg-btn" aria-disabled=${h.available ? undefined : 'true'} aria-label=${tell(h)} onClick=${() => pick(h)}>
          <span class="carte-leg-num" aria-hidden="true">${n + 1}</span>
          ${h.available ? html`<span class="carte-swatch" aria-hidden="true"></span><span>${h.label || 'Passage'}</span><span class="go">→ ${h.to}</span>`
            : html`<${Icon} name="lock" /><span><b>${h.label || 'Passage'}</b> — fermé. ${h.reason}</span>`}
        </button>
      </li>`)}</ul>`}
    ${!withImage && html`<nav class="choices carte-fallback" aria-label="Destinations">
      ${spots.map(h => html`<button class="choice" key=${h.index} disabled=${!h.available} onClick=${() => pick(h)}>
        <span>${h.label || 'Continuer'}</span><span class="go">${h.to}</span>
        ${!h.available && html`<span class="why"><${Icon} name="lock" />${h.reason}</span>`}
      </button>`)}
    </nav>`}
    ${note && html`<p class="carte-note" role="status"><${Icon} name="lock" />${note}</p>`}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Éditeur du bloc : tracer les zones sur l'image                      */
/* ------------------------------------------------------------------ */

const rnd = r => ({ x: round1(r.x), y: round1(r.y), w: round1(r.w), h: round1(r.h) });

function ZoneCanvas({ url, alt, zones, sel, onSelect, onCreate, onMove }) {
  const frame = useRef();
  const drag = useRef(null);
  const [draft, setDraft] = useState(null);
  const down = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = pointIn(frame.current, e);
    const zone = e.target.closest('[data-zone]');
    const handle = e.target.closest('[data-handle]');
    const i = zone ? Number(zone.dataset.zone) : -1;
    drag.current = handle ? { mode: 'resize', i, p, o: rectOf(zones[i]) } : zone ? { mode: 'move', i, p, o: rectOf(zones[i]) } : { mode: 'draw', p };
    if (zone) onSelect(i);
    try { frame.current.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    e.preventDefault();
  };
  const move = e => {
    const d = drag.current;
    if (!d) return;
    const p = pointIn(frame.current, e), dx = p.x - d.p.x, dy = p.y - d.p.y;
    if (d.mode === 'draw') d.rect = { x: Math.min(d.p.x, p.x), y: Math.min(d.p.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
    else if (d.mode === 'move') d.rect = { ...d.o, x: clamp(d.o.x + dx, 0, 100 - d.o.w), y: clamp(d.o.y + dy, 0, 100 - d.o.h) };
    else d.rect = { ...d.o, w: clamp(d.o.w + dx, 2, 100 - d.o.x), h: clamp(d.o.h + dy, 2, 100 - d.o.y) };
    setDraft({ i: d.mode === 'draw' ? null : d.i, rect: d.rect });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (!d) return;
    if (d.mode === 'draw') {
      if (d.rect && d.rect.w >= 2 && d.rect.h >= 2) onCreate(rnd(d.rect));
      else if (!d.rect || (d.rect.w < 1 && d.rect.h < 1)) onSelect(-1);
    } else if (d.rect) onMove(d.i, rnd(d.rect));
  };
  const cancel = () => { drag.current = null; setDraft(null); };
  return html`<div class="carte-ed-canvas" ref=${frame} role="group" aria-label="Image de la carte : tracez les zones à la souris ou au doigt"
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${cancel}>
    <img src=${url} alt=${alt || ''} draggable="false" />
    ${zones.map((z, i) => html`<div key=${i} class=${'carte-ed-zone' + (i === sel ? ' sel' : '')} data-zone=${i} style=${pos(draft && draft.i === i ? draft.rect : rectOf(z))}>
      <span class="carte-ed-num">${i + 1}</span>${z.label && html`<span class="carte-ed-label">${z.label}</span>`}
      ${i === sel && html`<span class="carte-handle" data-handle="1" title="Redimensionner"></span>`}
    </div>`)}
    ${draft && draft.i === null && html`<div class="carte-ed-zone draft" style=${pos(draft.rect)}></div>`}
  </div>`;
}

function MapEditor({ adv, block, set, tgt }) {
  const b = block;
  const hs = b.hotspots || [];
  const [sel, setSel] = useState(hs.length ? 0 : -1);
  const url = useAssetUrl(adv, 'local', b.image);
  const setZone = (i, patch) => set({ hotspots: hs.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const addZone = rect => { set({ hotspots: [...hs, { ...rect, label: `Zone ${hs.length + 1}`, to: '' }] }); setSel(hs.length); };
  const removeZone = i => { set({ hotspots: hs.filter((_, j) => j !== i) }); setSel(-1); };
  const num = (i, k) => v => setZone(i, { [k]: round1(clamp(v ?? 0)) });
  return html`<div class="stack carte-ed">
    <${Text} label="Titre du bloc (facultatif)" value=${b.label} onChange=${v => set({ label: v })} placeholder="Où voulez-vous aller ?" />
    <${ImageSlot} adv=${adv} path=${b.image} name="carte" label="Image de la carte" onChange=${p => set({ image: p })} />
    <${Text} label="Description de l'image (lue par les lecteurs d'écran)" value=${b.alt} onChange=${v => set({ alt: v })} placeholder="Carte de la vallée : le village au nord, le marais au sud…" />
    ${url ? html`<p class="subtle" style="margin:0">Faites glisser la souris ou le doigt sur l'image pour tracer une zone. Glissez une zone pour la déplacer, et son coin carré pour la redimensionner. Les champs numériques permettent un réglage précis.</p>
      <${ZoneCanvas} url=${url} alt=${b.alt} zones=${hs} sel=${sel} onSelect=${setSel} onCreate=${addZone} onMove=${(i, r) => setZone(i, r)} />`
      : html`<p class="subtle" style="margin:0">Ajoutez une image pour tracer les zones dessus. Sans image, le joueur voit les destinations sous forme de liste.</p>`}
    <div class="row"><button type="button" class="btn small" onClick=${() => addZone({ x: 40, y: 40, w: 20, h: 20 })}><${Icon} name="plus" />Zone au centre</button>
      <span class="subtle">${plural(hs.length, 'zone', 'zones')}</span></div>
    <ol class="carte-ed-list">${hs.map((h, i) => html`<li key=${i} class=${'carte-ed-item' + (i === sel ? ' sel' : '')}>
      <div class="carte-ed-head">
        <button type="button" class="carte-ed-pick" aria-pressed=${i === sel} aria-label=${`Zone ${i + 1} : ${i === sel ? 'sélectionnée' : 'sélectionner'}`} onClick=${() => setSel(i === sel ? -1 : i)}>${i + 1}</button>
        <${Text} label="Étiquette visible sur la carte" value=${h.label} onChange=${v => setZone(i, { label: v })} placeholder="La tour du mage" />
        ${tgt(h.to, v => setZone(i, { to: v }), 'Rendez-vous au')}
        <button type="button" class="btn small danger rm" aria-label=${`Retirer la zone ${i + 1}`} onClick=${() => removeZone(i)}><${Icon} name="x" /></button>
      </div>
      ${i === sel && html`
        <div class="grid2">
          <${Num} label="Gauche (%)" value=${h.x} min="0" max="100" onChange=${num(i, 'x')} />
          <${Num} label="Haut (%)" value=${h.y} min="0" max="100" onChange=${num(i, 'y')} />
          <${Num} label="Largeur (%)" value=${h.w} min="0" max="100" onChange=${num(i, 'w')} />
          <${Num} label="Hauteur (%)" value=${h.h} min="0" max="100" onChange=${num(i, 'h')} />
        </div>
        <${ConditionEditor} adv=${adv} value=${h.if} onChange=${v => setZone(i, { if: v })} />
        ${h.if && html`<label class="row subtle"><input type="checkbox" checked=${!!h.hideIfUnavailable} onChange=${e => setZone(i, { hideIfUnavailable: e.target.checked })} /> Cacher cette zone si la condition n'est pas remplie (sinon elle est marquée d'un cadenas avec la raison)</label>`}
        <${EffectsEditor} adv=${adv} value=${h.effects || []} onChange=${v => setZone(i, { effects: v.length ? v : undefined })} title="Effets en empruntant ce passage" />`}
    </li>`)}</ol>
  </div>`;
}

registerBlockUI(TYPE, {
  label: 'Carte',
  icon: 'map',
  order: 40,
  create: () => ({ image: null, alt: '', label: '', hotspots: [] }),
  Player: MapPlayer,
  Editor: MapEditor,
});

/* ------------------------------------------------------------------ */
/* Carte du monde                                                      */
/* ------------------------------------------------------------------ */

const STATUS_TEXT = { here: 'Vous êtes ici', visited: 'lieu visité', known: 'lieu connu, pas encore visité', unknown: 'lieu inconnu', plain: 'lieu', sel: 'lieu sélectionné' };

function Pin({ m }) {
  const edge = [m.x > 78 ? 'edge-r' : m.x < 22 ? 'edge-l' : '', m.y > 86 ? 'edge-b' : ''].join(' ');
  return html`<span class=${`carte-pin ${m.status} ${edge}`} style=${`left:${m.x}%;top:${m.y}%`}>
    <span class="carte-dot" aria-hidden="true">${m.status === 'unknown' ? '?' : ''}</span>
    ${m.status === 'unknown' ? html`<span class="sr-only">Lieu inconnu</span>`
      : html`<span class="carte-name">${m.name}${m.status === 'here' && html`<small>${m.approx ? 'Dernier lieu connu' : 'Vous êtes ici'}</small>`}</span>`}
  </span>`;
}

function WorldMap({ adv, source, markers, points = [], onPick, label }) {
  const wm = adv.meta.worldMap || {};
  const url = useAssetUrl(adv, source, wm.image);
  const frame = useRef();
  const pick = e => { if (onPick && frame.current) onPick(pointIn(frame.current, e)); };
  const line = points.map(p => `${p.x},${p.y}`).join(' ');
  return html`<div class=${'carte-frame carte-world' + (onPick ? ' picking' : '')} ref=${frame} onClick=${pick} role=${label ? 'group' : undefined} aria-label=${label}>
    ${url && html`<img src=${url} alt=${wm.alt || 'Carte du monde'} draggable="false" />`}
    ${url && points.length > 1 && html`<svg class="carte-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="halo" points=${line} /><polyline points=${line} /></svg>`}
    ${url && markers.map(m => html`<${Pin} key=${m.name} m=${m} />`)}
  </div>`;
}

function Keys({ statuses, path }) {
  return html`<ul class="carte-keys" aria-label="Légende">
    ${statuses.map(s => html`<li><span class=${'carte-pin static ' + s}><span class="carte-dot" aria-hidden="true">${s === 'unknown' ? '?' : ''}</span></span>${STATUS_TEXT[s]}</li>`)}
    ${path && html`<li><svg class="carte-key-path" viewBox="0 0 40 10" aria-hidden="true"><line x1="3" y1="5" x2="37" y2="5" /></svg>chemin parcouru</li>`}
  </ul>`;
}

function WorldModal({ adv, source, state, onClose }) {
  const wm = adv.meta.worldMap;
  const markers = worldMarkers(state, adv);
  const points = wm.showPath !== false ? journeyPoints(state, adv) : [];
  const here = currentPlace(state, adv);
  const visited = visitedPlaces(state, adv);
  const known = knownPlaces(state).map(placeName).filter(p => !visited.includes(p));
  const statuses = ['here', 'visited', 'known', 'unknown'].filter(s => markers.some(m => m.status === s));
  return html`<${Modal} title="Carte du monde" onClose=${onClose} wide>
    <${WorldMap} adv=${adv} source=${source} markers=${markers} points=${points} />
    ${!markers.length && html`<p class="subtle" style="margin:0">Aucun lieu de votre voyage n'est encore marqué sur cette carte.</p>`}
    <${Keys} statuses=${statuses} path=${points.length > 1} />
    <p class="carte-summary" lang="fr">
      ${here && html`<b>${here.exact ? 'Vous êtes ici' : 'Dernier lieu connu'} : ${here.name}.</b> `}
      Lieux visités : ${visited.length ? visited.join(', ') : 'aucun'}.
      ${known.length > 0 && ` Lieux connus, pas encore visités : ${known.join(', ')}.`}
    </p>
  <//>`;
}

registerSheetPanel({
  id: 'carte-monde',
  order: 30,
  Panel({ adv, source, state }) {
    const [open, setOpen] = useState(false);
    if (!adv.meta.worldMap?.image) return null;
    const n = visitedPlaces(state, adv).length;
    return html`<div class="row carte-sheet">
      <button class="btn small" onClick=${() => setOpen(true)}><${Icon} name="map" />Carte du monde</button>
      <span class="subtle">${plural(n, 'lieu visité', 'lieux visités')}</span>
      ${open && html`<${WorldModal} adv=${adv} source=${source} state=${state} onClose=${() => setOpen(false)} />`}
    </div>`;
  },
});

/* ---------- onglet de l'éditeur ---------- */

function WorldTab({ adv, change, open }) {
  const wm = adv.meta.worldMap || null;
  const places = placesOf(adv);
  const placed = new Set(Object.keys(wm?.places || {}).map(placeName));
  const [sel, setSel] = useState(() => (places.find(p => !placed.has(p.name)) || places[0])?.name || null);
  const setWm = patch => change(a => { a.meta.worldMap = { image: null, revealUnvisited: false, places: {}, ...(a.meta.worldMap || {}), ...patch }; return a; });
  const setPlace = (name, xy) => change(a => {
    const w = (a.meta.worldMap ||= { image: null, revealUnvisited: false, places: {} });
    w.places = { ...(w.places || {}) };
    for (const k of Object.keys(w.places)) if (placeName(k) === name) delete w.places[k];
    if (xy) w.places[name] = { x: round1(clamp(xy.x)), y: round1(clamp(xy.y)) };
    return a;
  });
  const onPick = xy => {
    if (!sel) return;
    const first = !placed.has(sel);
    setPlace(sel, xy);
    if (first) { const next = places.find(p => p.name !== sel && !placed.has(p.name)); if (next) setSel(next.name); }
  };
  const orphans = [...placed].filter(n => !places.some(p => p.name === n));
  const markers = [...placed].map(name => ({ name, ...placePos(adv, name), status: name === sel ? 'sel' : 'plain' })).filter(m => Number.isFinite(m.x));
  const cur = places.find(p => p.name === sel);
  const curPos = sel ? placePos(adv, sel) : null;

  return html`<div class="ed-form carte-world-tab">
    <p class="muted" style="margin:0">La carte du monde s'ouvre depuis la Feuille d'Aventure du joueur. Elle montre les lieux déjà visités, le lieu actuel (double cercle) et, si vous le souhaitez, les lieux inconnus sous forme de « ? ». Les lieux viennent du champ « Lieu » des paragraphes.</p>
    <${ImageSlot} adv=${adv} path=${wm?.image} name="carte-du-monde" label="Image de la carte du monde" onChange=${p => setWm({ image: p })} />
    ${wm?.image && html`
      <${Text} label="Description de la carte (lue par les lecteurs d'écran)" value=${wm.alt} onChange=${v => setWm({ alt: v })} placeholder="La vallée de Brumeval et ses environs" />
      <label class="row"><input type="checkbox" checked=${!!wm.revealUnvisited} onChange=${e => setWm({ revealUnvisited: e.target.checked })} /> Montrer les lieux pas encore visités sous forme de « ? » (sinon ils restent cachés)</label>
      <label class="row"><input type="checkbox" checked=${wm.showPath !== false} onChange=${e => setWm({ showPath: e.target.checked })} /> Tracer le chemin parcouru par le héros (pointillés)</label>`}
    <div class="carte-world-ed">
      <div class="stack" style="gap:8px">
        ${wm?.image ? html`
          <p class="carte-instr" aria-live="polite"><${Icon} name="map" />${sel ? html`<span>Cliquez sur la carte pour ${placed.has(sel) ? 'déplacer' : 'placer'} le lieu : <b>${sel}</b></span>` : 'Choisissez un lieu dans la liste, puis cliquez sur la carte.'}</p>
          <${WorldMap} adv=${adv} source="local" markers=${markers} onPick=${onPick} label="Carte du monde : cliquez pour placer le lieu choisi" />`
          : html`<p class="subtle">Ajoutez d'abord l'image de la carte du monde.</p>`}
      </div>
      <div class="stack" style="gap:8px">
        <h3>Lieux des paragraphes (${places.length})</h3>
        ${!places.length && html`<p class="subtle" style="margin:0">Aucun paragraphe n'a de lieu : remplissez le champ « Lieu » dans l'onglet Paragraphe (par exemple « Brumeval »).</p>`}
        <ul class="carte-places">${places.map(p => { const on = placed.has(p.name); return html`<li key=${p.name}>
          <button type="button" class="carte-place" aria-pressed=${p.name === sel} onClick=${() => setSel(p.name)}>
            <span class=${'shape ' + (on ? 'on' : 'off')} aria-hidden="true"></span>
            <span>${p.name}</span>
            <span class="subtle">${on ? 'placé' : 'à placer'}</span>
          </button></li>`; })}</ul>
        ${cur && html`<section class="panel carte-sel">
          <header><h3>${cur.name}</h3>${curPos && html`<button type="button" class="btn small danger" onClick=${() => setPlace(cur.name, null)}>Retirer de la carte</button>`}</header>
          <div class="row" style="gap:4px"><span class="subtle">${cur.sections.length > 1 ? 'Paragraphes' : 'Paragraphe'} :</span>
            ${cur.sections.map(id => html`<button type="button" class="btn small mono" onClick=${() => open(id)}>${id}</button>`)}</div>
          ${wm?.image && html`<div class="grid2">
            <${Num} label="Horizontal (%)" value=${curPos?.x} min="0" max="100" onChange=${v => setPlace(cur.name, { x: v ?? 0, y: curPos?.y ?? 50 })} />
            <${Num} label="Vertical (%)" value=${curPos?.y} min="0" max="100" onChange=${v => setPlace(cur.name, { x: curPos?.x ?? 50, y: v ?? 0 })} />
          </div>`}
        </section>`}
        ${orphans.length > 0 && html`<div class="stack" style="gap:6px">
          <span class="subtle">Lieux placés qui ne sont plus cités par aucun paragraphe :</span>
          ${orphans.map(n => html`<div class="row" key=${n}><span>${n}</span><button type="button" class="btn small danger" onClick=${() => setPlace(n, null)}>Retirer</button></div>`)}
        </div>`}
      </div>
    </div>
  </div>`;
}

registerEditorTab({ id: 'carte-monde', order: 40, label: () => 'Carte du monde', Tab: WorldTab });

/* ------------------------------------------------------------------ */
/* Version imprimable                                                  */
/* ------------------------------------------------------------------ */

registerPrintSection({
  where: 'appendix',
  order: 70,
  Section({ adv }) {
    const wm = adv.meta.worldMap;
    if (!wm?.image) return null;
    const markers = Object.keys(wm.places || {}).map(n => ({ name: placeName(n), ...placePos(adv, n), status: 'plain' })).filter(m => m.name && Number.isFinite(m.x)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return html`<div class="carte-pr-world">
      <h2>Carte du monde</h2>
      <${WorldMap} adv=${adv} source="local" markers=${markers} />
      <p class="pr-small">Cochez chaque lieu dès que vous y arrivez.</p>
      <ul class="carte-pr-places">${markers.map(m => html`<li><i aria-hidden="true"></i>${m.name}</li>`)}</ul>
    </div>`;
  },
});

// Image d'un bloc « carte » dans la version imprimable (le HTML imprimé est une chaîne : l'image est résolue ici).
if (typeof customElements !== 'undefined' && !customElements.get('lh-carte-img')) {
  customElements.define('lh-carte-img', class extends HTMLElement {
    connectedCallback() {
      if (this.firstChild) return;
      const img = document.createElement('img');
      img.alt = this.dataset.alt || '';
      img.draggable = false;
      this.append(img);
      assetUrl({ id: this.dataset.adv }, 'local', this.dataset.path).then(u => { if (u) img.src = u; }).catch(() => {});
    }
  });
}

/* ------------------------------------------------------------------ */
/* Effet et conditions de lieu                                         */
/* ------------------------------------------------------------------ */

function PlaceField({ label = 'Lieu', value, onChange, adv }) {
  const id = useMemo(() => `carte-lieu-${++uid}`, []);
  const places = placesOf(adv);
  return html`<label class="field" for=${id}>${label}
    <input type="text" id=${id} list=${id + '-l'} value=${value || ''} onInput=${e => onChange(e.target.value)} placeholder=${places[0]?.name || 'Tour noire'} />
    <datalist id=${id + '-l'}>${places.map(p => html`<option value=${p.name} />`)}</datalist></label>`;
}

registerEffectUI('revealPlace', {
  label: 'Révéler un lieu (carte du monde)',
  order: 60,
  blank: adv => ({ op: 'revealPlace', place: placesOf(adv)[0]?.name || '' }),
  Fields: ({ e, upd, adv }) => html`<${PlaceField} value=${e.place} onChange=${v => upd({ place: v })} adv=${adv} />`,
});

[['placeVisited', 'est déjà allé à (lieu)'], ['placeNotVisited', 'n’est jamais allé à (lieu)'], ['placeKnown', 'connaît l’emplacement de (lieu)']].forEach(([key, label], i) => registerConditionUI({
  t: key,
  label,
  order: 60 + i,
  match: c => (c && typeof c === 'object' && key in c ? { v: c[key] } : null),
  toCond: r => ({ [key]: r.v || '' }),
  blank: adv => ({ v: placesOf(adv)[0]?.name || '' }),
  Fields: ({ row, upd, adv }) => html`<${PlaceField} value=${row.v} onChange=${v => upd({ v })} adv=${adv} />`,
}));
