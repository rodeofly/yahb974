// Greffon « accessibilite » : confort de lecture (police, portée, interlignage, espacement des lettres),
// thème très contrasté, animations réduites et guide de lecture. Préférences par appareil (prefs de common.js,
// clé « a11y »), appliquées dès le chargement puis à chaque changement, sans rechargement.
// Voir docs/plugins/accessibilite.md.

import { html, useState } from '../../lib/preact-htm.js';
import { registerSettings } from '../../ui/registry.js';
import { prefs, loadCSS } from '../../ui/common.js';
import { DEFAULTS, DYSLEXIA, FONTS, CHOICES, normalizePrefs, isDefault, a11yAttributes, contrastCss, lineBand, rulerMasks } from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ---------- préférences ---------- */
export const readA11y = () => normalizePrefs(prefs.get('a11y', {}));

/** Pose les attributs data-a11y-* sur <html>, injecte les palettes et règle le guide de lecture. */
export function applyA11y(p = readA11y()) {
  const root = document.documentElement;
  if (!document.getElementById('a11y-palettes')) {
    const st = document.createElement('style');
    st.id = 'a11y-palettes';
    st.textContent = contrastCss();
    document.head.append(st);
  }
  for (const [k, v] of Object.entries(a11yAttributes(p))) { if (v === null) root.removeAttribute(k); else root.setAttribute(k, v); }
  guide.mode(p.guide);
  if (p.font !== 'alegreya') warmFont(p.font);
}

/* Hors ligne : le navigateur ne télécharge que les graisses affichées. Dès qu'une police est choisie,
   on demande toutes ses variantes (gras, italique) pour que le service worker les garde en cache. */
const FILES = {
  atkinson: ['400', '400i', '700', '700i'].flatMap(w => [`AtkinsonHyperlegible-${w}-latin.woff2`, `AtkinsonHyperlegible-${w}-latin-ext.woff2`]),
  opendyslexic: ['400', '400i', '700', '700i'].map(w => `OpenDyslexic-${w}-latin.woff2`),
};
const warmed = new Set();
function warmFont(id) {
  if (warmed.has(id) || !FILES[id] || !navigator.serviceWorker?.controller) return;
  warmed.add(id);
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
  idle(() => FILES[id].forEach(f => fetch(new URL(`../../../fonts/accessibilite/${f}`, import.meta.url)).catch(() => {})));
}

/* ---------- guide de lecture : ligne survolée ou règle de lecture ---------- */
const guide = (() => {
  let current = 'off', els = null, last = null, frame = 0, bound = false;
  const make = cls => { const d = document.createElement('div'); d.className = `a11y-guide ${cls}`; d.setAttribute('aria-hidden', 'true'); document.body.append(d); return d; };
  const hide = () => { if (els) for (const e of Object.values(els)) e.classList.remove('on'); };
  const put = (el, box) => { Object.assign(el.style, Object.fromEntries(Object.entries(box).map(([k, v]) => [k, `${v}px`]))); el.classList.add('on'); };

  /** Boîte du caractère sous le pointeur (ou le plus proche sur la même ligne), dans un texte de lecture. */
  function glyphAt(x, y, prose) {
    let node = null, offset = 0;
    if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); node = c?.offsetNode; offset = c?.offset ?? 0; }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); node = r?.startContainer; offset = r?.startOffset ?? 0; }
    if (!node || node.nodeType !== Node.TEXT_NODE || !prose.contains(node) || !node.length) return null;
    const range = document.createRange();
    let best = null;
    for (const i of [offset, offset - 1]) {
      if (i < 0 || i >= node.length) continue;
      range.setStart(node, i); range.setEnd(node, i + 1);
      for (const r of range.getClientRects()) {
        if (!r.height) continue;
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (!best || d < best.d) best = { d, top: r.top, bottom: r.bottom, el: node.parentElement };
      }
    }
    if (!best) return null;
    const cs = getComputedStyle(best.el);
    const lh = parseFloat(cs.lineHeight) || (best.bottom - best.top) * 1.2;
    return best.d > lh ? null : { top: best.top, bottom: best.bottom, lineHeight: lh };
  }

  function draw() {
    frame = 0;
    if (current === 'off' || !last) { hide(); return; }
    const hit = document.elementFromPoint(last.x, last.y);
    const prose = hit?.closest?.('.prose');
    if (!prose) { hide(); return; }
    const g = glyphAt(last.x, last.y, prose);
    if (!g) { hide(); return; }
    if (!els) els = { line: make('a11y-line'), above: make('a11y-mask'), below: make('a11y-mask'), win: make('a11y-window') };
    const band = lineBand(g, g.lineHeight);
    hide();
    if (current === 'line') {
      const r = prose.getBoundingClientRect();
      put(els.line, { top: band.top, height: band.height, left: r.left - 12, width: r.width + 24 });
    } else {
      const m = rulerMasks(band, window.innerHeight);
      put(els.above, m.above); put(els.below, m.below); put(els.win, m.window);
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const onMove = e => { if (current === 'off' || e.pointerType === 'touch') return; last = { x: e.clientX, y: e.clientY }; schedule(); };
  const onDown = e => { if (current === 'off' || e.pointerType !== 'touch') return; last = { x: e.clientX, y: e.clientY, touch: true }; schedule(); };
  // La règle reste immobile quand le texte défile dessous (comme une règle posée sur la page) ; au doigt, on la retire.
  const onScroll = () => { if (current === 'off' || !last) return; if (last.touch) { last = null; hide(); } else schedule(); };
  const onLeave = () => { last = null; hide(); };

  return {
    mode(m) {
      current = m || 'off';
      if (current === 'off') { last = null; hide(); return; }
      if (bound) { schedule(); return; }
      bound = true;
      document.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerdown', onDown, { passive: true });
      document.documentElement.addEventListener('mouseleave', onLeave);
      addEventListener('scroll', onScroll, { passive: true, capture: true });
      addEventListener('resize', schedule, { passive: true });
      addEventListener('hashchange', onLeave);
    },
  };
})();

/* ---------- fenêtre Réglages ---------- */
function Choice({ label, k, p, set }) {
  const id = `a11y-${k}`;
  return html`<label class="field" for=${id}>${label}
    <select id=${id} value=${p[k]} onChange=${e => set({ [k]: e.target.value })}>
      ${CHOICES[k].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
    </select></label>`;
}

/* `app` et `setApp` sont les préférences de la fenêtre Réglages (thème, taille, texte justifié…). */
function A11yPanel({ prefs: app, set: setApp }) {
  const [p, setP] = useState(readA11y);
  const set = patch => { const n = normalizePrefs({ ...p, ...patch }); prefs.set('a11y', n); applyA11y(n); setP(n); };
  const dyslexia = Object.entries(DYSLEXIA).every(([k, v]) => p[k] === v) && app?.justify === false;
  return html`<section class="a11y-panel" aria-labelledby="a11y-title">
    <h3 id="a11y-title">Confort de lecture</h3>
    <fieldset>
      <legend>Police de lecture</legend>
      <div class="a11y-fonts">${FONTS.map(f => html`<label class="a11y-font-opt" key=${f.id}>
        <input type="radio" name="a11y-font" value=${f.id} checked=${p.font === f.id} onChange=${() => set({ font: f.id })} />
        <b>${f.label}</b>
        <span class="a11y-sample" style=${`font-family:${f.family}`} aria-hidden="true">Aa Il1 O0 bdpq</span>
        <span class="subtle">${f.hint}</span>
      </label>`)}</div>
    </fieldset>
    <div class="grid2">
      <${Choice} label="Appliquer à" k="scope" p=${p} set=${set} />
      <${Choice} label="Interlignage" k="leading" p=${p} set=${set} />
      <${Choice} label="Espacement des lettres" k="spacing" p=${p} set=${set} />
      <${Choice} label="Très contrasté" k="contrast" p=${p} set=${set} />
      <${Choice} label="Guide de lecture" k="guide" p=${p} set=${set} />
    </div>
    <label class="a11y-check"><input type="checkbox" id="a11y-motion" checked=${p.motion} onChange=${e => set({ motion: e.target.checked })} /><span>Réduire les animations (dés, feuille d’aventure, transitions), même si l’appareil ne le demande pas</span></label>
    <label class="a11y-check"><input type="checkbox" id="a11y-print" checked=${p.print} onChange=${e => set({ print: e.target.checked })} /><span>Utiliser aussi cette police et ces espacements dans la version imprimable</span></label>
    <div class="a11y-preview">
      <span class="eyebrow">Aperçu</span>
      <div class="prose" lang="fr"><p>Le pont de lianes grince sous vos pas. En contrebas, la rivière gronde entre les rochers noirs. Si vous possédez une corde, rendez-vous au <b>128</b>. Sinon, <em>tentez votre Chance</em> : si vous êtes Chanceux, rendez-vous au <b>42</b> ; si vous êtes Malchanceux, rendez-vous au <b>305</b>.</p></div>
    </div>
    ${p.contrast !== 'off' && html`<p class="subtle" style="margin:0">Le mode très contrasté remplace le thème clair ou sombre choisi plus haut.</p>`}
    ${p.guide !== 'off' && html`<p class="subtle" style="margin:0">Le guide suit la souris sur le texte des paragraphes ; sur un écran tactile, touchez la ligne que vous lisez.</p>`}
    <p class="subtle" style="margin:0">Pour les lecteurs dyslexiques : OpenDyslexic (ou Atkinson Hyperlegible), un interlignage aéré, des lettres espacées et un texte aligné à gauche. Le bouton ci-dessous règle tout cela d’un coup, y compris « Texte justifié » plus haut.</p>
    <div class="row">
      <button class="btn small" disabled=${dyslexia} onClick=${() => { set(DYSLEXIA); setApp?.({ justify: false }); }}>Réglage conseillé pour la dyslexie</button>
      <button class="btn small" disabled=${isDefault(p) && app?.justify !== false} onClick=${() => { set(DEFAULTS); setApp?.({ justify: true }); }}>Rétablir la lecture d’origine</button>
    </div>
  </section>`;
}

registerSettings({ id: 'accessibilite', order: 10, Panel: A11yPanel });

// Au chargement : les préférences de l'appareil s'appliquent avant le premier affichage.
applyA11y();
