// Greffon « carte » — voyage sur le plateau, entre deux étapes (worldMap.travel + worldMap.path).
// Quand le lieu change, le plateau s'affiche en grand et le pion avance de case en case, à la manière d'un jeu de
// plateau : il saute, se pose, et repart ; à l'arrivée il rebondit, puis le plateau s'efface. Un toucher (ou Échap)
// passe le voyage. Sans animation si l'appareil les réduit : le pion est posé sur sa case d'arrivée, un instant.
// Passe par la scène commune (ui/stage.js) : jamais en même temps qu'un badge gagné.

import { html, render, useState, useEffect, useRef } from '../../lib/preact-htm.js';
import { sfx } from '../../ui/audio.js';
import { onStage } from '../../ui/stage.js';
import { assetUrl } from '../../store/library.js';
import * as K from './core.js';

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'translate(-50%, -82%)';

/** Lance le voyage : `hops` = indices des cases (K.travelHops), `place` = lieu d'arrivée, `sec` = paragraphe d'arrivée. */
export function travel(adv, source, hops, place, sec) {
  onStage((host, done) => render(html`<${Voyage} adv=${adv} source=${source} hops=${hops} place=${place} sec=${sec} done=${done} />`, host));
}

function Voyage({ adv, source, hops, place, sec, done }) {
  const wm = adv.meta.worldMap;
  const path = K.pathOf(adv);
  const token = wm.travel?.token || '●';
  const [img, setImg] = useState(null);
  const [tok, setTok] = useState(null);
  const [out, setOut] = useState(false);
  const pawn = useRef(), root = useRef(), skip = useRef(false), closed = useRef(false);
  const at = i => ({ left: `${path[hops[i]].x}%`, top: `${path[hops[i]].y}%` });

  const finish = () => {
    if (closed.current) return;
    closed.current = true; setOut(true);
    setTimeout(done, reduced() ? 0 : 380);
  };
  useEffect(() => {
    root.current?.focus();
    assetUrl(adv, source, wm.image).then(u => (u ? setImg(u) : finish()), finish);
    if (K.isImagePath(token)) assetUrl(adv, source, token).then(setTok, () => {});
  }, []);

  // Le trajet : une case après l'autre, en arc, avec un petit son à chaque saut.
  useEffect(() => {
    if (!img) return undefined;
    let gone = false;
    (async () => {
      const el = pawn.current;
      if (!el) return;
      Object.assign(el.style, at(0));
      if (reduced() || !el.animate) { Object.assign(el.style, at(hops.length - 1)); await wait(1100); if (!gone) finish(); return; }
      await wait(450);
      for (let i = 1; i < hops.length && !skip.current && !gone; i++) {
        const a = at(i - 1), b = at(i);
        const mid = { left: `calc((${a.left} + ${b.left}) / 2)`, top: `calc((${a.top} + ${b.top}) / 2)` };
        sfx.hop?.();
        await el.animate([
          { ...a, transform: `${BASE} scale(1)` },
          { ...mid, transform: `${BASE} translateY(-45%) scale(1.14)`, offset: 0.5 },
          { ...b, transform: `${BASE} scale(1)` },
        ], { duration: 380, easing: 'ease-in-out' }).finished.catch(() => {});
        Object.assign(el.style, b);
        await wait(70);
      }
      Object.assign(el.style, at(hops.length - 1));
      if (gone) return;
      sfx.arrive?.();
      el.animate([{ transform: `${BASE} scale(1.28, .78)` }, { transform: `${BASE} scale(.94, 1.08)` }, { transform: `${BASE} scale(1)` }], { duration: 360, easing: 'ease-out' });
      await wait(skip.current ? 0 : 1000);
      if (!gone) finish();
    })();
    return () => { gone = true; };
  }, [img]);

  const total = Number(adv.rules?.steps) || 0;
  const pass = () => { skip.current = true; finish(); };
  return html`<div class=${'voyage' + (out ? ' is-out' : '')} ref=${root} tabindex="-1" role="dialog" aria-modal="true"
      aria-label=${`En route : ${place}`} onClick=${pass} onKeyDown=${e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pass(); } }}>
    <div class="voyage-head">
      <span class="voyage-kicker">En route</span>
      <h2>${place}</h2>
      ${sec?.step != null && sec.step !== '' && html`<span class="voyage-step">Étape ${sec.step}${total ? ` sur ${total}` : ''}</span>`}
    </div>
    <div class="voyage-board">
      ${img && html`<img class="voyage-img" src=${img} alt=${wm.alt || ''} draggable="false" />`}
      ${img && html`<span class="voyage-pawn" ref=${pawn} aria-hidden="true" style=${`left:${at(0).left};top:${at(0).top}`}>
        ${tok ? html`<img src=${tok} alt="" draggable="false" />` : html`<span class="voyage-glyph">${K.isImagePath(token) ? '' : token}</span>`}
      </span>`}
    </div>
    <p class="voyage-hint">Touche pour passer</p>
  </div>`;
}
