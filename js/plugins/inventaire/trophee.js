// Greffon « inventaire » — le moment du badge gagné (collections `board`).
// 1. Le badge surgit au milieu d'un feu d'artifice et tourne sur lui-même, comme un trophée, sur fond de rayons.
// 2. Un toucher le retourne : on lit sa carte (comment il a été gagné, sa fiche).
// 3. « Ranger dans le sac » : la carte s'envole vers les badges de la feuille (ou le bouton Sac), et s'y range.
// Plusieurs badges gagnés d'un coup passent l'un après l'autre. Sans animation si l'appareil les réduit.
// Déclenché par le crochet de partie `onUpdate` (voir index.js) ; rien en mode triche (« Tout débloquer »).

import { html, render, useState, useEffect, useRef } from '../../lib/preact-htm.js';
import { Prose, Glyph, Icon } from '../../ui/common.js';
import { sfx } from '../../ui/audio.js';
import { onStage } from '../../ui/stage.js';

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Met des badges dans la file des moments plein écran ; `items` : [{ id, icon, name, earn, description }]. */
export function celebrate(adv, source, items) {
  for (const it of items) onStage((host, done) => render(html`<${Trophy} adv=${adv} source=${source} it=${it} done=${done} />`, host));
}

/** Feu d'artifice sur un canevas : quelques gerbes, gravité, traînées qui s'effacent. */
function useFireworks(ref, on) {
  useEffect(() => {
    const cv = ref.current;
    if (!on || !cv || reduced()) return undefined;
    const g = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    size(); addEventListener('resize', size);
    const colors = ['#FFD54A', '#FF6B6B', '#4FC3F7', '#9CCC65', '#BA68C8', '#FFFFFF', '#FFA726'];
    let parts = [], raf = 0, t0 = performance.now(), bursts = 0;
    const burst = (x, y) => {
      const c = colors[Math.floor(Math.random() * colors.length)], n = 70 + Math.floor(Math.random() * 40);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2, v = (2.2 + Math.random() * 4.2) * dpr;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: Math.random() < 0.25 ? '#FFFFFF' : c, s: (1.6 + Math.random() * 1.8) * dpr });
      }
    };
    const loop = now => {
      const el = now - t0;
      // Une gerbe toutes les 260 ms pendant 2,6 s, puis de loin en loin tant que le badge tourne.
      if ((el < 2600 && el / 260 > bursts) || (el >= 2600 && Math.random() < 0.012)) {
        bursts++;
        burst((0.15 + Math.random() * 0.7) * cv.width, (0.12 + Math.random() * 0.45) * cv.height);
      }
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, 0, cv.width, cv.height);
      g.globalCompositeOperation = 'lighter';
      parts = parts.filter(p => p.life > 0.02);
      for (const p of parts) {
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.06 * dpr; p.x += p.vx; p.y += p.vy; p.life *= 0.968;
        g.globalAlpha = p.life; g.fillStyle = p.c;
        g.beginPath(); g.arc(p.x, p.y, p.s, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', size); };
  }, [on]);
}

/** Où ranger le badge : la petite grille des badges de la feuille, sinon le bouton Sac, sinon la bande du sac. */
function target() {
  const visible = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.left < innerWidth ? r : null; };
  return visible(document.querySelector('.inv-board-strip')) || visible(document.querySelector('.play-fab .sheet-toggle'))
    || visible(document.querySelector('.inv-strip')) || { left: innerWidth - 60, top: innerHeight - 60, width: 40, height: 40 };
}

function Trophy({ adv, source, it, done }) {
  const [phase, setPhase] = useState('pop'); // pop → card → stow
  const canvas = useRef(), cardRef = useRef(), btnRef = useRef();
  useFireworks(canvas, phase !== 'stow');
  useEffect(() => { sfx.trophy?.(); btnRef.current?.focus(); }, []);
  useEffect(() => { if (phase === 'card') cardRef.current?.querySelector('.trophy-stow')?.focus(); }, [phase]);

  const stow = () => {
    if (phase === 'stow') return;
    setPhase('stow');
    const el = cardRef.current;
    if (!el || reduced() || !el.animate) { done(); return; }
    const a = el.getBoundingClientRect(), b = target();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const s = Math.max(0.06, Math.min(b.width, b.height) / Math.max(a.width, a.height));
    sfx.coin?.();
    el.animate([
      { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.2 - 60}px) scale(.6) rotate(-8deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(12deg)`, opacity: 0.2 },
    ], { duration: 750, easing: 'cubic-bezier(.5,0,.6,1)', fill: 'forwards' }).finished.then(() => {
      // La case de la feuille rebondit à l'arrivée.
      document.querySelector('.inv-board-strip, .play-fab .sheet-toggle')?.animate?.(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
      done();
    }, done);
  };
  const keys = e => { if (e.key === 'Escape') { e.preventDefault(); stow(); } };

  return html`<div class=${'trophy is-' + phase} role="dialog" aria-modal="true" aria-label=${`Badge gagné : ${it.name}`} onKeyDown=${keys}>
    <canvas class="trophy-sky" ref=${canvas} aria-hidden="true"></canvas>
    ${phase === 'pop' && html`<button type="button" class="trophy-stage" ref=${btnRef} onClick=${() => setPhase('card')} aria-label=${`Badge gagné : ${it.name}. Toucher pour lire la carte.`}>
      <span class="trophy-rays" aria-hidden="true"></span>
      <span class="trophy-kicker" aria-hidden="true">Badge gagné !</span>
      <span class="trophy-spin" aria-hidden="true"><span class="trophy-icon"><${Glyph} adv=${adv} source=${source} icon=${it.icon || '🏅'} /></span></span>
      <span class="trophy-name" aria-hidden="true">${it.name}</span>
      <span class="trophy-hint" aria-hidden="true">Touche pour lire la carte</span>
    </button>`}
    ${phase !== 'pop' && html`<div class="trophy-card" ref=${cardRef}>
      <div class="trophy-card-head"><span class="trophy-card-icon" aria-hidden="true"><${Glyph} adv=${adv} source=${source} icon=${it.icon || '🏅'} /></span>
        <div><span class="eyebrow">Badge gagné</span><h2>${it.name}</h2>${it.earn && html`<p class="trophy-earn">✓ ${it.earn}</p>`}</div></div>
      ${it.description && html`<div class="trophy-card-body"><${Prose} text=${it.description} /></div>`}
      <button type="button" class="btn primary trophy-stow" onClick=${stow}><${Icon} name="bag" />Ranger dans le sac</button>
    </div>`}
  </div>`;
}
