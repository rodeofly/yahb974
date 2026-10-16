// Greffon « inventaire » — paquet de cartes d'un objet (`items[id].cards`), affiché dans sa fiche du sac.
// Trois vues : le plan (toutes les cartes, en tableau lignes × colonnes quand elles en ont), une à une (on fait
// glisser la carte, ou flèches et touches ← →), le carrousel (les cartes tournent autour de celle du milieu).
// Le modèle (deckOf) est dans ./core.js. Voir docs/plugins/inventaire.md.

import { html, useState, useEffect, useRef } from '../../lib/preact-htm.js';
import { prefs, Glyph, Icon, AssetImg } from '../../ui/common.js';
import * as I from './core.js';

const VIEWS = [['map', 'grid', 'Plan'], ['one', 'card', 'Une à une'], ['carousel', 'carousel', 'Carrousel']];
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const describe = c => [c.row, c.step ? `étape ${c.step}` : '', c.band, c.title, c.sub].filter(Boolean).join(', ');

/** Une carte : bandeau coloré (étape, intitulé, icône), le contenu en grand, le pied (la ligne : un élève…). */
export function Card({ c, mini = false, onClick, adv, source }) {
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class=${'dk-card' + (mini ? ' mini' : '')} style=${c.color ? `--c:${c.color}` : ''}
      onClick=${onClick} aria-label=${onClick ? `Voir la carte : ${describe(c)}` : undefined}>
    <span class="dk-band">${c.step && html`<b class="dk-step">${c.step}</b>`}<span class="dk-band-t">${c.band || ''}</span>${c.icon && html`<span class="dk-icon" aria-hidden="true"><${Glyph} adv=${adv} source=${source} icon=${c.icon} /></span>`}</span>
    <span class="dk-body">${c.image && html`<span class="dk-pic" aria-hidden="true"><${Glyph} adv=${adv} source=${source} icon=${c.image} /></span>`}<span class="dk-title">${c.title}</span>${c.sub && html`<span class="dk-sub">${c.sub}</span>`}</span>
    ${!mini && (c.row || c.foot) && html`<span class="dk-foot"><span>${c.row || ''}</span><span class="subtle">${c.foot || ''}</span></span>`}
  <//>`;
}

/** Le paquet de cartes, avec ses trois vues. */
export function Deck({ deck, id = '', adv, source }) {
  // La vue choisie est gardée par paquet (les cartes des élèves en plan, les jokers en carrousel…).
  const key = 'deck.view.' + id;
  const [view, setView] = useState(() => { const v = prefs.get(key, deck.view); return VIEWS.some(x => x[0] === v) ? v : deck.view; });
  const [row, setRow] = useState(null);
  const [cur, setCur] = useState(0);
  const list = row ? deck.list.filter(c => c.row === row) : deck.list;
  const n = list.length;
  const at = ((cur % n) + n) % n;
  const go = d => setCur(i => i + d);
  const pick = v => { setView(v); prefs.set(key, v); };
  const open = c => { setRow(null); setCur(deck.list.indexOf(c)); pick('one'); };
  useEffect(() => { setCur(0); }, [row]);

  // Glisser : on suit le doigt (ou la souris), puis on passe à la carte voisine au-delà d'un seuil.
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const dragged = useRef(false); // un glisser n'est pas un clic sur la carte voisine
  const down = e => { drag.current = { x: e.clientX, id: e.pointerId }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = e => { if (drag.current) setDx(e.clientX - drag.current.x); };
  const up = () => {
    if (!drag.current) return;
    const step = view === 'carousel' ? Math.round(-dx / 110) : Math.abs(dx) > 60 ? (dx < 0 ? 1 : -1) : 0;
    drag.current = null; dragged.current = Math.abs(dx) > 5; setDx(0);
    if (step) go(step);
  };
  const keys = e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } };

  // Carrousel : il tourne seul si on le demande (jamais quand l'appareil réduit les animations).
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    if (!spin || view !== 'carousel' || reduced()) return undefined;
    const t = setInterval(() => setCur(i => i + 1), 2200);
    return () => clearInterval(t);
  }, [spin, view]);

  const rows = deck.rows.length > 1 && view !== 'map' && html`<div class="dk-filter" role="group" aria-label="Montrer les cartes de">
    <button type="button" class="dice-chip" aria-pressed=${row === null ? 'true' : 'false'} onClick=${() => setRow(null)}>Toutes</button>
    ${deck.rows.map(r => html`<button type="button" class="dice-chip" aria-pressed=${row === r ? 'true' : 'false'} onClick=${() => setRow(r)}>${r}</button>`)}
  </div>`;
  const nav = html`<div class="dk-nav">
    <button type="button" class="btn small" onClick=${() => go(-1)} aria-label="Carte précédente">‹</button>
    <span class="mono" aria-live="polite">${at + 1} / ${n}</span>
    <button type="button" class="btn small" onClick=${() => go(1)} aria-label="Carte suivante">›</button>
    ${view === 'carousel' && !reduced() && html`<button type="button" class="btn small" aria-pressed=${spin ? 'true' : 'false'} onClick=${() => setSpin(s => !s)}><${Icon} name=${spin ? 'stop' : 'play'} />${spin ? 'Arrêter' : 'Faire tourner'}</button>`}
  </div>`;

  return html`<div class="dk">
    <div class="dk-views" role="group" aria-label="Vue des cartes">
      ${VIEWS.map(([v, icon, label]) => html`<button type="button" class="dk-view" aria-pressed=${view === v ? 'true' : 'false'} onClick=${() => pick(v)}><${Icon} name=${icon} />${label}</button>`)}
    </div>

    ${view === 'map' && (deck.matrix
      ? html`<div class="dk-map" style=${`--cols:${deck.cols.length}`} role="table" aria-label="Plan des cartes">
          <span role="row" class="dk-map-row">
            <span role="columnheader" class="dk-corner"></span>
            ${deck.cols.map(k => { const c0 = deck.list.find(c => c.col === k); return html`<span role="columnheader" class="dk-colhead" style=${c0?.color ? `--c:${c0.color}` : ''}>${c0?.step && html`<b>${c0.step}</b>`}${k}</span>`; })}
          </span>
          ${deck.rows.map(r => html`<span role="row" class="dk-map-row">
            <span role="rowheader" class="dk-rowhead">${r}</span>
            ${deck.cols.map(k => { const c = deck.cell(r, k); return html`<span role="cell">${c ? html`<${Card} adv=${adv} source=${source} c=${c} mini onClick=${() => open(c)} />` : null}</span>`; })}
          </span>`)}
        </div>`
      : html`<div class="dk-grid">${deck.list.map(c => html`<${Card} adv=${adv} source=${source} c=${c} mini onClick=${() => open(c)} />`)}</div>`)}

    ${view === 'one' && n > 0 && html`${rows}
      <div class="dk-one" tabindex="0" role="region" aria-roledescription="carrousel" aria-label=${`Carte ${at + 1} sur ${n} : ${describe(list[at])}`}
        onKeyDown=${keys} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
        <div class=${'dk-one-card' + (dx ? ' dragging' : '')} key=${at + '-' + (row || '')} style=${`transform:translateX(${dx}px) rotate(${dx / 40}deg)`}>
          <${Card} adv=${adv} source=${source} c=${list[at]} />
        </div>
      </div>
      ${nav}`}

    ${view === 'carousel' && n > 0 && html`${rows}
      <div class="dk-carousel" tabindex="0" role="region" aria-roledescription="carrousel" aria-label=${`Carte ${at + 1} sur ${n} : ${describe(list[at])}`}
        onKeyDown=${keys} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
        ${list.map((c, i) => {
          let d = i - at - dx / 110;
          if (d > n / 2) d -= n; else if (d < -n / 2) d += n;
          const a = Math.abs(d);
          if (a > 3.2) return null;
          return html`<div class=${'dk-slot' + (Math.round(d) === 0 ? ' front' : '')} key=${i} aria-hidden=${Math.round(d) === 0 ? null : 'true'}
            style=${`transform:translateX(calc(${d} * 58%)) translateZ(${-a * 70}px) rotateY(${-d * 24}deg) scale(${1 - Math.min(a, 3) * 0.08});z-index:${10 - Math.round(a)};opacity:${a > 2.6 ? 0.35 : 1}`}
            onClick=${() => { if (dragged.current) { dragged.current = false; return; } if (Math.round(d) !== 0) go(Math.round(d)); }}>
            <${Card} adv=${adv} source=${source} c=${c} />
          </div>`;
        })}
      </div>
      ${nav}`}
  </div>`;
}

/**
 * Version imprimable : les paquets marqués `print` (items[id].cards.print), à découper. Cartes de 58 × 82 mm, traits de
 * coupe en pointillés, couleurs conservées à l'impression ; `print: 3` imprime chaque carte trois fois (un jeu par élève).
 * Sur papier, la carte est pour le joueur : le pied ne garde que la ligne (le prénom), pas les indications de l'adulte.
 */
export function PrintDecks({ adv, source, images = true }) {
  const decks = Object.entries(adv.items || {}).map(([id, it]) => ({ id, it, deck: I.deckOf(it) })).filter(x => x.deck?.copies > 0);
  if (!decks.length) return null;
  return html`<div class="dk-print">
    <h2>À découper</h2>
    <p class="pr-small">Imprimer en couleur, sans mise à l'échelle ; découper le long des pointillés. Plastifier si possible.</p>
    ${decks.map(({ id, it, deck }) => html`<div class="dk-print-deck" key=${id}>
      <h3>${it.name}${deck.copies > 1 ? html` <span class="pr-small">(${deck.copies} exemplaires de chaque)</span>` : null}</h3>
      <div class="dk-print-grid">${deck.list.flatMap((c, k) => Array.from({ length: deck.copies }, (_, n) => html`<div class="dk-print-card" key=${k + '-' + n} style=${c.color ? `--c:${c.color}` : ''}>
        <div class="dk-band">${c.step && html`<b class="dk-step">${c.step}</b>`}<span class="dk-band-t">${c.band || ''}</span></div>
        <div class="dk-body">${images && c.image && html`<span class="dk-print-pic"><${AssetImg} adv=${adv} source=${source} path=${c.image} alt="" eager /></span>`}
          <span class="dk-title">${c.title}</span>${c.sub && html`<span class="dk-sub">${c.sub}</span>`}</div>
        ${c.row && html`<div class="dk-foot"><span>${c.row}</span></div>`}
      </div>`))}</div>
    </div>`)}
  </div>`;
}
