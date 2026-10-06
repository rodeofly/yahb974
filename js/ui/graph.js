// Graphe de l'aventure dans l'éditeur (même mécanique que la carte d'exploration) :
// - Ressorts : simulation d3-force, l'histoire s'étale de gauche à droite selon la distance au départ ;
//   on attrape un paragraphe à la souris, ses voisins suivent.
// - Frise : disposition en colonnes (dagre).
// - Regroupement par lieu ou par journée, fil principal / avec les sorts,
//   chemin le plus court, passages obligés, recherche.
// Le sens se lit sans les couleurs : forme = type de paragraphe, trait = type de renvoi.

import { html, useEffect, useRef, useState, useMemo } from '../lib/preact-htm.js';
import { analyze } from '../core/analysis.js';
import { makeRng } from '../core/dice.js';
import { targetsOf as targetsOfRaw } from '../core/rules.js'; // renvois bruts, y compris cassés
import { loadGraphLibs } from './common.js';

/** Au-delà de ce nombre de paragraphes, le graphe passe en mode économe (rendu, calcul par tranches). */
const BIG = 150;
/** Positions calculées, gardées entre deux ouvertures de l'onglet tant que la structure ne change pas. */
const layoutCache = new Map();

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const snippet = (t, n = 38) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s\S*$/, '') + '…' : s; };
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function kind(sec) {
  if (sec.ending) return sec.ending;
  const t = (sec.blocks || []).map(b => b.type);
  if (t.includes('combat')) return 'combat';
  if (t.includes('spells')) return 'magic';
  if (t.includes('test') || t.includes('roll')) return 'dice';
  if (t.includes('shop')) return 'shop';
  return 'normal';
}

function styles(big = false) {
  const c = css;
  const list = [
    { selector: 'node', style: { width: 24, height: 24, shape: 'ellipse', 'background-color': c('--normal'), label: 'data(lbl)', color: '#fff', 'font-family': 'JetBrains Mono, monospace', 'font-size': 8, 'font-weight': 700, 'text-valign': 'center', 'text-halign': 'center', 'border-width': 1, 'border-color': c('--surface'), 'overlay-opacity': 0 } },
    { selector: 'node.combat', style: { shape: 'hexagon', width: 30, height: 27, 'background-color': c('--combat') } },
    { selector: 'node.dice', style: { shape: 'triangle', width: 28, height: 26, 'background-color': c('--spell'), 'text-margin-y': 3 } },
    { selector: 'node.magic', style: { shape: 'star', width: 32, height: 30, 'background-color': c('--spell') } },
    { selector: 'node.shop', style: { shape: 'barrel', width: 30, height: 24, 'background-color': c('--accent'), color: c('--accent-ink') } },
    { selector: 'node.death', style: { shape: 'rectangle', width: 22, height: 22, 'background-color': c('--death'), color: c('--death-ink') } },
    { selector: 'node.victory', style: { shape: 'diamond', width: 44, height: 44, 'font-size': 11, 'background-color': c('--gold'), color: '#1E1E1E', 'border-width': 3, 'border-color': c('--ink') } },
    { selector: 'node.spellOut', style: { 'border-width': 1.5, 'border-style': 'dashed', 'border-color': c('--spell') } },
    { selector: 'node.hasSpell', style: { 'border-width': 2.5, 'border-style': 'dashed', 'border-color': c('--spell') } },
    { selector: 'node.landmark', style: { width: 44, height: 44, 'font-size': 12, 'border-width': 6, 'border-style': 'double', 'border-color': c('--ink'),
      label: 'data(cap)', 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 5, 'text-wrap': 'wrap', 'text-max-width': 110,
      'font-family': 'Alegreya Sans, sans-serif', color: c('--ink'), 'text-background-color': c('--ground'), 'text-background-opacity': 0.9, 'text-background-padding': 3, 'text-background-shape': 'round-rectangle', 'z-index': 6 } },
    { selector: 'node.landmark.combat', style: { width: 52, height: 46 } },
    { selector: 'node.landmark.victory', style: { width: 56, height: 56 } },
    { selector: 'node.missing', style: { 'background-color': c('--surface'), color: c('--loss'), 'border-width': 2, 'border-style': 'dashed', 'border-color': c('--loss') } },
    { selector: 'edge', style: { width: 1.2, 'line-color': c('--muted'), 'target-arrow-color': c('--muted'), 'target-arrow-shape': 'triangle', 'arrow-scale': 1, 'curve-style': 'bezier', opacity: 0.55 } },
    { selector: 'edge.test, edge.roll', style: { 'line-style': 'dashed' } },
    { selector: 'edge.combat', style: { width: 2.4 } },
    { selector: 'edge.secret', style: { 'line-style': 'dotted', 'line-dash-pattern': [2, 4], 'line-color': c('--accent'), 'target-arrow-color': c('--accent'), opacity: 0.9 } },
    { selector: 'edge.spell', style: { 'line-color': c('--spell'), 'target-arrow-color': c('--spell'), 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
    { selector: 'edge.broken', style: { 'line-color': c('--loss'), 'target-arrow-color': c('--loss'), 'line-style': 'dotted', width: 2, opacity: 1 } },
    { selector: '.dim', style: { opacity: 0.1 } },
    { selector: 'node.hit', style: { 'underlay-color': c('--accent'), 'underlay-opacity': 0.35, 'underlay-padding': 7, 'underlay-shape': 'ellipse' } },
    { selector: 'edge.pathOn', style: { 'line-color': c('--ink'), 'target-arrow-color': c('--ink'), width: 3.5, opacity: 1, 'z-index': 5 } },
    { selector: 'edge.out', style: { 'line-color': c('--accent'), 'target-arrow-color': c('--accent'), width: 3.2, 'arrow-scale': 1.4, 'line-style': 'solid', opacity: 1, 'z-index': 9 } },
    { selector: 'edge.inc', style: { 'line-color': c('--ink'), 'target-arrow-color': c('--ink'), width: 1.8, 'line-style': 'dashed', 'line-dash-pattern': [3, 3], opacity: 0.75, 'z-index': 8 } },
    { selector: 'node.pinned', style: { 'outline-width': 2, 'outline-style': 'dotted', 'outline-color': c('--ink'), 'outline-offset': 3 } },
    { selector: 'node.grp', style: { shape: 'round-rectangle', 'background-color': c('--accent'), 'background-opacity': 0.07, 'border-width': 1.5, 'border-color': c('--line'), label: 'data(label)', 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -8, 'font-family': 'Alegreya SC, Georgia, serif', 'font-size': 30, 'font-weight': 700, color: c('--ink'), padding: 28, events: 'no', 'text-background-opacity': 0 } },
    { selector: 'node.sel', style: { 'underlay-color': c('--ink'), 'underlay-opacity': 0.22, 'underlay-padding': 10, 'underlay-shape': 'ellipse', 'border-width': 4, 'border-style': 'solid', 'border-color': c('--accent'), 'z-index': 10 } },
  ];
  // Grand graphe : les étiquettes ne sont dessinées qu'à un zoom où elles sont lisibles.
  if (big) list.push({ selector: 'node', style: { 'min-zoomed-font-size': 7 } }, { selector: 'edge', style: { 'min-zoomed-font-size': 7 } });
  // Paragraphes repérés : plus gros, bordure accentuée, et leur badge reste lisible même dézoomé (règle placée après celle des grands graphes : Cytoscape applique les règles dans l'ordre).
  list.push({ selector: 'node.marked', style: { width: 34, height: 34, 'font-size': 12, 'border-width': 3, 'border-color': c('--accent'), 'z-index': 5, 'min-zoomed-font-size': 0 } });
  return list;
}

const SHAPES = {
  normal: '<circle cx="9" cy="9" r="6.5" fill="var(--normal)"/>',
  landmark: '<circle cx="9" cy="9" r="8" fill="var(--normal)" stroke="var(--ink)" stroke-width="1.2"/><circle cx="9" cy="9" r="5.6" fill="none" stroke="var(--ink)" stroke-width="1.2"/>',
  combat: '<polygon points="4,2.5 14,2.5 18,9 14,15.5 4,15.5 0,9" fill="var(--combat)"/>',
  dice: '<polygon points="9,1.5 17,16 1,16" fill="var(--spell)"/>',
  magic: '<polygon points="9,1 11.2,6.5 17,7 12.5,10.8 14,16.5 9,13.4 4,16.5 5.5,10.8 1,7 6.8,6.5" fill="var(--spell)"/>',
  death: '<rect x="2.5" y="2.5" width="13" height="13" fill="var(--death)"/>',
  victory: '<polygon points="9,0.5 17.5,9 9,17.5 0.5,9" fill="var(--gold)" stroke="var(--ink)" stroke-width="1.5"/>',
  hasSpell: '<circle cx="9" cy="9" r="7" fill="var(--normal)" stroke="var(--spell)" stroke-width="2" stroke-dasharray="3 2"/>',
};
const Shape = ({ k }) => html`<svg viewBox="0 0 18 18" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: SHAPES[k] }}></svg>`;

/* Les groupes sont posés en serpentin, dans l'ordre du voyage. */
function groupCenters(counts) {
  const r = counts.map(c => 24 * Math.sqrt(c) + 50), maxW = 2800, gap = 170, centers = [];
  const rows = [[]]; let w = 0;
  r.forEach((ri, i) => { if (w + 2 * ri > maxW && rows[rows.length - 1].length) { rows.push([]); w = 0; } rows[rows.length - 1].push(i); w += 2 * ri + gap; });
  let y = 0;
  rows.forEach((row, k) => {
    const h = Math.max(...row.map(i => r[i]));
    let x = 0;
    (k % 2 ? [...row].reverse() : row).forEach(i => { centers[i] = { x: x + r[i], y: y + h }; x += 2 * r[i] + gap; });
    y += 2 * h + gap;
  });
  return centers;
}

export function GraphTab({ adv, change, open, current }) {
  const ref = useRef();
  const [libs, setLibs] = useState(() => !!(window.cytoscape && window.d3 && window.cytoscapeDagre));
  useEffect(() => { if (!libs) loadGraphLibs().then(() => setLibs(true)).catch(() => {}); }, []);
  const cyRef = useRef(null);
  const simRef = useRef(null);
  // Fil principal (sans les sorts) d'office, sauf si la magie porte l'essentiel du livre (Sorcellerie!…) : tout afficher.
  const [view, setView] = useState(() => { const A0 = analyze(adv); return A0.main.size < 0.6 * A0.depth.size ? 'all' : 'main'; });
  const [shown, setShown] = useState(0);
  const [layout, setLayout] = useState('spring');
  const big0 = Object.keys(adv.sections).length > BIG;
  const [group, setGroup] = useState(big0 ? 'stage' : 'none');   // grand livre : regroupé par étape d'emblée
  const [radius, setRadius] = useState(0);                          // 0 = tout le livre, sinon voisinage du paragraphe ouvert
  const [hideDeaths, setHideDeaths] = useState(false);
  const [marker, setMarker] = useState('');
  const [showPath, setShowPath] = useState(false);
  const [showDom, setShowDom] = useState(false);
  const [pin, setPin] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);

  // La structure (paragraphes, renvois, lieux, titres) : on ne reconstruit le graphe que si elle change.
  const structureKey = useMemo(() => JSON.stringify(Object.entries(adv.sections).map(([id, s]) => [id, s.title, s.place, s.ending, (s.blocks || []).map(b => b.type), (s.choices || []).map(c => c.to), (s.blocks || []).map(b => [b.success, b.failure, b.win, b.flee, b.lose, (b.table || []).map(t => t.to), (b.options || []).map(o => o.to)]), (s.onEnter || []).some(e => e.op === 'newDay')])), [adv]);
  const A = useMemo(() => analyze(adv), [structureKey]);
  const hasSpells = useMemo(() => [...A.out.values()].some(l => l.some(t => t.kind === 'spell')), [A]);
  const places = useMemo(() => {
    const first = new Map();
    for (const id of A.ids) { const p = adv.sections[id].place || 'Sans lieu'; const d = A.depth.get(id) ?? 1e9; if (!first.has(p) || d < first.get(p)) first.set(p, d); }
    return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
  }, [structureKey]);
  const days = useMemo(() => [...new Set([...A.day.values()])].sort((a, b) => a - b), [A]);
  // Étapes : tranches de distance au départ, environ douze groupes.
  const stage = useMemo(() => {
    const max = Math.max(0, ...[...A.depth.values()].filter(Number.isFinite));
    const size = Math.max(1, Math.ceil((max + 1) / 12));
    const of = id => { const d = A.depth.get(id); return Number.isFinite(d) ? Math.floor(d / size) : Math.floor(max / size) + 1; };
    const count = Math.floor(max / size) + 2;
    const labels = Array.from({ length: count }, (_, i) => (i === count - 1 ? 'Hors du fil (numéros à trouver)' : `Étape ${i + 1} · ${i * size}–${(i + 1) * size - 1} pas`));
    return { of, labels };
  }, [A]);
  const markers = useMemo(() => (adv.meta?.markers || []).filter(m => m && m.label && Array.isArray(m.sections)), [adv]);
  const markerOf = useMemo(() => { const m = new Map(); markers.forEach(k => k.sections.forEach(id => { const l = m.get(String(id)) || []; l.push(k); m.set(String(id), l); })); return m; }, [markers]);
  // Voisinage : paragraphes à moins de `radius` renvois (dans les deux sens) du paragraphe ouvert.
  const hood = useMemo(() => {
    if (!radius) return null;
    const adj = new Map();
    const link = (a, b) => { (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); (adj.get(b) || adj.set(b, new Set()).get(b)).add(a); };
    for (const id of A.ids) targetsOfRaw(adv.sections[id]).forEach(t => { if (adv.sections[t.to]) link(id, String(t.to)); });
    const seen = new Set([String(current)]); let front = [String(current)];
    for (let r = 0; r < radius && front.length; r++) { const next = []; front.forEach(id => (adj.get(id) || []).forEach(n => { if (!seen.has(n)) { seen.add(n); next.push(n); } })); front = next; }
    return seen;
  }, [A, current, radius]);

  const groupOf = id => group === 'place' ? places.indexOf(adv.sections[id].place || 'Sans lieu') : group === 'day' ? days.indexOf(A.day.get(id) ?? days[days.length - 1]) : group === 'stage' ? stage.of(id) : -1;
  const groupLabels = group === 'place' ? places : group === 'day' ? days.map(d => `Jour ${d}`) : group === 'stage' ? stage.labels : null;

  /* ---------- construction ---------- */
  useEffect(() => {
    if (!libs || !window.cytoscape || !ref.current) return;
    if (window.cytoscapeDagre && !window.__lhDagre) { window.cytoscape.use(window.cytoscapeDagre); window.__lhDagre = true; }
    let keep = new Set(view === 'main' && hasSpells ? [...A.main] : A.ids);
    if (hood) keep = new Set([...keep].filter(id => hood.has(id)));
    if (hideDeaths) keep = new Set([...keep].filter(id => adv.sections[id].ending !== 'death' || id === String(current)));
    const landmarks = new Set([String(adv.start), ...A.dominators, ...A.victories]);
    const hasSpell = new Set(A.ids.filter(id => (A.out.get(id) || []).some(t => t.kind === 'spell')));
    const spellOnly = new Set(A.ids.filter(id => !A.main.has(id)));
    const els = [];
    if (groupLabels) groupLabels.forEach((label, i) => { if ([...keep].some(id => groupOf(id) === i)) els.push({ data: { id: 'g' + i, label }, classes: 'grp' }); });
    keep.forEach(id => {
      const s = adv.sections[id];
      const cl = ['p', kind(s)];
      if (landmarks.has(id)) cl.push('landmark');
      if (view === 'main' && hasSpell.has(id)) cl.push('hasSpell');
      if (view === 'all' && spellOnly.has(id)) cl.push('spellOut');
      if (s.pos && layout === 'spring') cl.push('pinned');
      const mk = markerOf.get(id);
      const data = { id, cap: `${id} · ${snippet(s.title || s.text, 34)}`, lbl: mk ? `${[...new Set(mk.map(m => m.icon || '●'))].join('')}${id}` : id };
      if (mk) cl.push('marked');
      if (groupLabels) data.parent = 'g' + groupOf(id);
      els.push({ data, classes: cl.join(' ') });
    });
    const missing = new Set();
    keep.forEach(id => {
      const all = targetsOfRaw(adv.sections[id]);
      all.forEach((t, i) => {
        if (view === 'main' && hasSpells && t.kind === 'spell') return;
        const exists = !!adv.sections[t.to];
        if (exists && !keep.has(t.to)) return;
        if (!exists) missing.add(t.to);
        const on = A.path.indexOf(t.to) === A.path.indexOf(id) + 1 && A.path.includes(id);
        els.push({ data: { id: `${id}>${i}`, source: id, target: t.to }, classes: t.kind + (exists ? '' : ' broken') + (on ? ' pathEdge' : '') });
      });
    });
    missing.forEach(id => els.push({ data: { id, cap: id }, classes: 'p missing' }));
    setShown(keep.size);

    const big = keep.size > BIG;
    // Grand livre : rendu économe pendant le zoom et le déplacement de la vue.
    const cy = window.cytoscape({ container: ref.current, elements: els, style: styles(big), minZoom: 0.03, maxZoom: 3, boxSelectionEnabled: false,
      ...(big ? { textureOnViewport: true, hideEdgesOnViewport: true, pixelRatio: 1 } : {}) });
    cyRef.current = cy;
    cy.nodes('.grp').ungrabify();
    const cacheKey = `${adv.id}|${structureKey}|${view}|${layout}|${group}`;
    const cached = layoutCache.get(cacheKey);
    if (layout === 'frise' && window.cytoscapeDagre) {
      if (cached) cy.batch(() => cy.nodes('.p').forEach(n => { const p = cached[n.id()]; if (p) n.position(p); }));
      else {
        cy.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 14, rankSep: 80, edgeSep: 4, ranker: 'network-simplex', animate: false }).run();
        const pos = {}; cy.nodes('.p').forEach(n => { pos[n.id()] = { ...n.position() }; });
        layoutCache.set(cacheKey, pos);
      }
    } else startSpring(cy, { big, cached, save: pos => layoutCache.set(cacheKey, pos) });
    cy.on('tap', 'node.p', e => { if (!e.target.hasClass('missing')) open(e.target.id()); });
    cy.on('grab', 'node.p', e => { const d = simNode(e.target.id()); if (!d) return; const p = e.target.position(); d.fx = p.x; d.fy = p.y; simRef.current.alphaTarget(0.25).restart(); });
    cy.on('drag', 'node.p', e => { const d = simNode(e.target.id()); if (!d) return; const p = e.target.position(); d.fx = p.x; d.fy = p.y; });
    cy.on('free', 'node.p', e => {
      const d = simNode(e.target.id()); const id = e.target.id();
      if (!d) return;
      simRef.current.alphaTarget(0);
      if (pinRef.current) {
        e.target.addClass('pinned');
        change(a => { if (a.sections[id]) a.sections[id].pos = { x: Math.round(d.fx), y: Math.round(d.fy) }; return a; });
      } else if (!e.target.hasClass('pinned')) { d.fx = null; d.fy = null; }
    });
    overlays();
    const n = cy.getElementById(String(current));
    if (layout === 'frise' && n.length) { cy.zoom(0.9); cy.center(n); } else cy.fit(undefined, 30);
    return () => { simRef.current?.stop(); simRef.current = null; cy.destroy(); cyRef.current = null; };
  }, [structureKey, view, layout, group, libs, hood, hideDeaths, markers]);

  const pinRef = useRef(pin);
  pinRef.current = pin;
  const simNode = id => simRef.current?.nodes().find(d => d.id === id);

  function startSpring(cy, { big = false, cached = null, save = () => {} } = {}) {
    if (!window.d3) return;
    const paras = cy.nodes('.p');
    const counts = groupLabels ? groupLabels.map((_, i) => paras.filter(n => groupOf(n.id()) === i).length) : null;
    const centers = counts ? groupCenters(counts) : null;
    const rng = makeRng(7);
    const SN = paras.map(n => {
      const id = n.id(), sec = adv.sections[id];
      const g = groupLabels ? groupOf(id) : 0;
      const tx = centers ? centers[g].x : (A.depth.get(id) ?? 20) * 34, ty = centers ? centers[g].y : 0;
      const d = { id, n, tx, ty, x: tx + (rng() - 0.5) * 60, y: ty + (rng() - 0.5) * (centers ? 120 : 400) };
      if (cached?.[id]) { d.x = cached[id].x; d.y = cached[id].y; }
      if (sec?.pos) { d.x = d.fx = sec.pos.x; d.y = d.fy = sec.pos.y; }
      return d;
    });
    const idx = new Map(SN.map(d => [d.id, d]));
    const links = cy.edges().map(e => ({ source: idx.get(e.source().id()), target: idx.get(e.target().id()), spell: e.hasClass('spell') })).filter(l => l.source && l.target && l.source !== l.target);
    const sim = window.d3.forceSimulation(SN)
      .force('link', window.d3.forceLink(links).distance(l => (l.spell ? 24 : 36)))
      .force('charge', window.d3.forceManyBody().strength(-80).distanceMax(280))
      .force('collide', window.d3.forceCollide(15))
      .force('x', window.d3.forceX(d => d.tx).strength(centers ? 0.28 : 0.05))
      .force('y', window.d3.forceY(d => d.ty).strength(centers ? 0.28 : 0.025))
      .alphaDecay(0.028)
      .stop();
    const paint = () => cy.batch(() => sim.nodes().forEach(d => { if (!d.n.grabbed()) d.n.position({ x: d.x, y: d.y }); }));
    const remember = () => { const pos = {}; sim.nodes().forEach(d => { pos[d.id] = { x: d.x, y: d.y }; }); save(pos); };
    // Pendant un glisser, un grand graphe n'est repeint qu'une image sur deux.
    let tickNo = 0;
    const onTick = () => { if (!big || (++tickNo & 1)) paint(); };
    simRef.current = sim;
    if (cached) { sim.alpha(0); paint(); sim.on('tick', onTick); return; }
    if (!big) { sim.tick(260); paint(); remember(); sim.on('tick', onTick); return; }
    // Grand graphe : 260 pas calculés par tranches, affichés au fur et à mesure (l'onglet ne se fige pas).
    paint();
    let done = 0;
    const step = () => {
      if (simRef.current !== sim) return;
      const n = Math.min(26, 260 - done);
      sim.tick(n); done += n; paint();
      if (done < 260) requestAnimationFrame(step);
      else { remember(); sim.on('tick', onTick); cy.fit(undefined, 30); }
    };
    requestAnimationFrame(step);
  }

  /* ---------- surcouches : sélection, chemin, passages obligés, recherche ---------- */
  function overlays() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('dim hit pathOn sel out inc');
    const paras = cy.nodes('.p');
    if (showPath) {
      const P = new Set(A.path);
      paras.forEach(n => { if (!P.has(n.id())) n.addClass('dim'); });
      cy.edges('.pathEdge').addClass('pathOn');
      cy.edges().not('.pathEdge').addClass('dim');
    } else if (showDom) {
      const keep = new Set([String(adv.start), ...A.dominators, ...A.victories]);
      paras.forEach(n => { if (!keep.has(n.id())) n.addClass('dim'); });
      cy.edges().forEach(e => { if (!keep.has(e.source().id()) || !keep.has(e.target().id())) e.addClass('dim'); });
    }
    if (marker) {
      const list = marker === '__items' ? markers.filter(k => k.kind === 'item') : markers.filter(k => (k.id || k.label) === marker);
      const ids = new Set(list.flatMap(k => k.sections.map(String)));
      paras.forEach(n => { if (ids.has(n.id())) n.addClass('hit').removeClass('dim'); else n.addClass('dim'); });
      cy.edges().addClass('dim');
    }
    const t = q.trim();
    if (t && !/^\d+$/.test(t)) {
      const rx = norm(t);
      let h = 0;
      paras.forEach(n => {
        const s = adv.sections[n.id()];
        if (s && norm(`${s.title} ${s.text} ${s.place}`).includes(rx)) { n.addClass('hit').removeClass('dim'); h++; } else n.addClass('dim');
      });
      if (!showPath && !showDom) cy.edges().addClass('dim');
      setHits(h);
    } else setHits(null);
    const n = cy.getElementById(String(current));
    if (n.length) { n.addClass('sel'); n.outgoers('edge').addClass('out'); n.incomers('edge').addClass('inc'); }
  }
  useEffect(overlays, [showPath, showDom, q, current, structureKey, marker, hood, hideDeaths]);

  const home = () => { const cy = cyRef.current; const n = cy?.getElementById(String(adv.start)); if (n?.length) { cy.zoom(1); cy.center(n); } };
  const shake = () => { const sim = simRef.current; if (!sim) return; sim.nodes().forEach(d => { if (!adv.sections[d.id]?.pos) { d.fx = null; d.fy = null; } }); sim.alpha(0.9).restart(); };
  const unpinAll = () => {
    change(a => { Object.values(a.sections).forEach(s => { delete s.pos; }); return a; });
    cyRef.current?.nodes().removeClass('pinned');
    const sim = simRef.current;
    if (sim) { sim.nodes().forEach(d => { d.fx = null; d.fy = null; }); sim.alpha(0.6).restart(); }
  };
  const onSearch = e => {
    e.preventDefault();
    const t = q.trim();
    if (/^\d+$/.test(t) && adv.sections[t]) { open(t); setQ(''); return; }
    const cy = cyRef.current; const h = cy?.nodes('.hit');
    if (h?.length) cy.animate({ fit: { eles: h, padding: 60 } }, { duration: 300 });
  };
  const pinnedCount = Object.values(adv.sections).filter(s => s.pos).length;
  const press = (v, cur) => ({ 'aria-pressed': String(v === cur) });

  return html`<div class="graph-wrap">
    <div class="graph-tools">
      ${hasSpells && html`<div class="seg" role="group" aria-label="Vue">
        <button ...${press('main', view)} onClick=${() => setView('main')}>Fil principal</button>
        <button ...${press('all', view)} onClick=${() => setView('all')}>Avec les sorts</button></div>`}
      <div class="seg" role="group" aria-label="Disposition">
        <button ...${press('spring', layout)} onClick=${() => setLayout('spring')}>Ressorts</button>
        <button ...${press('frise', layout)} onClick=${() => { setLayout('frise'); setGroup('none'); }}>Frise</button></div>
      <div class="seg" role="group" aria-label="Regrouper">
        <button ...${press('none', group)} onClick=${() => setGroup('none')}>Sans groupe</button>
        <button ...${press('place', group)} onClick=${() => { setGroup('place'); setLayout('spring'); }}>Par lieu</button>
        <button ...${press('day', group)} onClick=${() => { setGroup('day'); setLayout('spring'); }}>Par jour</button>
        <button ...${press('stage', group)} onClick=${() => { setGroup('stage'); setLayout('spring'); }} title="Tranches de distance au départ : lisible même pour un très grand livre">Par étape</button></div>
      <label class="chk" title="N'afficher que les paragraphes proches du paragraphe ouvert">Voisinage
        <select value=${radius} onChange=${e => setRadius(Number(e.target.value))} aria-label="Rayon du voisinage" style="min-height:0;padding:2px 4px">
          <option value="0">tout</option><option value="1">1 renvoi</option><option value="2">2 renvois</option><option value="3">3 renvois</option><option value="5">5 renvois</option></select></label>
      <label class="chk"><input type="checkbox" checked=${hideDeaths} onChange=${e => setHideDeaths(e.target.checked)} /> Masquer les morts</label>
      ${markers.length > 0 && html`<label class="chk" title="Paragraphes repérés dans ce livre">Repères
        <select value=${marker} onChange=${e => setMarker(e.target.value)} aria-label="Repère à mettre en avant" style="min-height:0;padding:2px 4px">
          <option value="">aucun</option>
          ${markers.some(m => m.kind === 'item') && html`<option value="__items">🎒 Tous les objets</option>`}
          ${markers.map(m => html`<option value=${m.id || m.label}>${m.icon || ''} ${m.label} (${m.sections.length})</option>`)}</select></label>`}
      <label class="chk"><input type="checkbox" checked=${showPath} onChange=${e => { setShowPath(e.target.checked); if (e.target.checked) setShowDom(false); }} /> Chemin le plus court</label>
      <label class="chk"><input type="checkbox" checked=${showDom} onChange=${e => { setShowDom(e.target.checked); if (e.target.checked) setShowPath(false); }} /> Passages obligés</label>
      <label class="chk" title="Un paragraphe lâché reste à sa place (enregistré avec l'aventure)"><input type="checkbox" checked=${pin} onChange=${e => setPin(e.target.checked)} /> Épingler</label>
      <form class="row" style="gap:6px" onSubmit=${onSearch} role="search">
        <input type="search" value=${q} onInput=${e => setQ(e.target.value)} placeholder="N° ou mot…" aria-label="Chercher dans le graphe" style="width:160px;min-height:34px" />
        ${hits !== null && html`<span class="pill">${hits}</span>`}
      </form>
      <span class="pill" title="Paragraphes affichés / paragraphes du livre">${shown} / ${A.ids.length}</span>
    </div>
    <div id="graph" ref=${ref} aria-label="Graphe de l'aventure. Cliquez sur un paragraphe pour l'ouvrir, glissez-le pour le déplacer."></div>
    <div class="legend">
      <span><${Shape} k="landmark" />Passage obligé</span><span><${Shape} k="normal" />Récit</span><span><${Shape} k="combat" />Combat</span>
      <span><${Shape} k="dice" />Dés</span><span><${Shape} k="magic" />Formules</span><span><${Shape} k="death" />Mort</span><span><${Shape} k="victory" />Victoire</span>
      ${view === 'main' && hasSpells && html`<span><${Shape} k="hasSpell" />Sorts masqués</span>`}
      <span>- - - dés / sorts</span><span style="color:var(--accent)">···· numéro à trouver</span><span style="color:var(--loss)">··· renvoi cassé</span>
    </div>
    <div class="graph-actions">
      ${pinnedCount > 0 && html`<button class="btn small" onClick=${unpinAll}>Libérer ${pinnedCount} épinglé${pinnedCount > 1 ? 's' : ''}</button>`}
      ${layout === 'spring' && html`<button class="btn small" onClick=${shake}>Relancer</button>`}
      <button class="btn small" onClick=${home}>Début</button>
      <button class="btn small" onClick=${() => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 30 } }, { duration: 300 })}>Tout voir</button>
    </div>
  </div>`;
}
