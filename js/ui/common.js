// Composants partagés : icônes, dés, notifications, fenêtres, texte mis en forme, images.

import { html, useState, useEffect, useRef } from '../lib/preact-htm.js';
import { assetUrl } from '../store/library.js';
import { sfx } from './audio.js';

export { html };

/* ---------- icônes (traits simples, pas d'émoji) ---------- */
const P = {
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="16" cy="16" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  sword: '<path d="M14.5 3H21v6.5L9 21.5 2.5 15z"/><path d="M5 18l-2 2M11 9l4 4"/>',
  clover: '<circle cx="8.5" cy="8.5" r="3.5"/><circle cx="15.5" cy="8.5" r="3.5"/><circle cx="8.5" cy="15.5" r="3.5"/><circle cx="15.5" cy="15.5" r="3.5"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h5"/>',
  bread: '<path d="M4 11a8 5 0 0 1 16 0v8H4z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  back: '<path d="M10 5l-7 7 7 7M3 12h18"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  sheet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  skull: '<path d="M5 11a7 7 0 1 1 14 0v4h-3v4H8v-4H5z"/><circle cx="9.5" cy="11" r="1.6" fill="currentColor"/><circle cx="14.5" cy="11" r="1.6" fill="currentColor"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  print: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
};
export const Icon = ({ name, title }) => html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${title ? undefined : 'true'} role=${title ? 'img' : undefined} dangerouslySetInnerHTML=${{ __html: (title ? `<title>${title}</title>` : '') + P[name] }}></svg>`;

/* ---------- dés ---------- */
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export function Die({ value, rolling }) {
  const on = PIPS[value] || [];
  return html`<span class=${'die' + (rolling ? ' rolling' : '')} role="img" aria-label=${`dé : ${value}`}>
    ${Array.from({ length: 9 }, (_, i) => html`<i style=${on.includes(i) ? 'visibility:visible' : ''}></i>`)}
  </span>`;
}
/** Affiche un résultat de dés ; l'animation rejoue quand `stamp` change. */
export function Dice({ result, stamp, showTotal = true }) {
  const [rolling, setRolling] = useState(false);
  useEffect(() => { if (!result) return; sfx.dice(); setRolling(true); const t = setTimeout(() => setRolling(false), 650); return () => clearTimeout(t); }, [stamp]);
  if (!result) return null;
  return html`<span class="dice">
    ${result.dice.map(v => html`<${Die} value=${v} rolling=${rolling} />`)}
    ${showTotal && html`<span class="dice-total" aria-live="polite">${result.mod ? `${result.dice.reduce((a, b) => a + b, 0)} ${result.mod > 0 ? '+' : '−'} ${Math.abs(result.mod)} = ` : '= '}${result.total}</span>`}
  </span>`;
}

/* ---------- notifications ---------- */
let pushToast = () => {};
export const toast = text => pushToast(text);
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => { pushToast = text => { const id = Math.random(); setItems(x => [...x, { id, text }]); setTimeout(() => setItems(x => x.filter(i => i.id !== id)), 3200); }; }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${items.map(i => html`<div class="toast" key=${i.id}>${i.text}</div>`)}</div>`;
}

/* ---------- fenêtre modale ---------- */
export function Modal({ title, onClose, children, wide }) {
  const ref = useRef();
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    ref.current?.querySelector('button, input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', k);
  }, []);
  return html`<div class="overlay" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <header><h2>${title}</h2><button class="btn ghost small" onClick=${onClose} aria-label="Fermer"><${Icon} name="x" /></button></header>
      ${children}
    </div>
  </div>`;
}

/** Remplace confirm() : renvoie une promesse. */
let askImpl = null;
export const confirmBox = (text, ok = 'Confirmer') => new Promise(res => askImpl ? askImpl({ text, ok, res }) : res(window.confirm(text)));
export function Confirm() {
  const [q, setQ] = useState(null);
  useEffect(() => { askImpl = setQ; return () => { askImpl = null; }; }, []);
  if (!q) return null;
  const done = v => { q.res(v); setQ(null); };
  return html`<${Modal} title="Confirmation" onClose=${() => done(false)}>
    <p>${q.text}</p>
    <div class="row"><button class="btn primary" onClick=${() => done(true)}>${q.ok}</button><button class="btn" onClick=${() => done(false)}>Annuler</button></div>
  <//>`;
}

/* ---------- texte : Markdown léger ---------- */
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function markdown(src = '') {
  return esc(src).split(/\n{2,}/).map(block => {
    const b = block.trim();
    if (!b) return '';
    if (b.startsWith('### ')) return `<h3>${inline(b.slice(4))}</h3>`;
    if (/^(- |\* )/.test(b)) return `<ul>${b.split('\n').map(l => `<li>${inline(l.replace(/^(- |\* )/, ''))}</li>`).join('')}</ul>`;
    if (b.startsWith('&gt; ')) return `<blockquote>${inline(b.replace(/^&gt; /gm, ''))}</blockquote>`;
    return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}
const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/_(.+?)_/g, '<em>$1</em>');
export const Prose = ({ text }) => html`<div class="prose" dangerouslySetInnerHTML=${{ __html: markdown(text) }}></div>`;

/* ---------- image d'une aventure ---------- */
export function AssetImg({ adv, source, path, alt = '', onClick, bump, eager }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { let on = true; setUrl(null); assetUrl(adv, source, path).then(u => on && setUrl(u)); return () => { on = false; }; }, [adv?.id, path, bump]);
  if (!path || !url) return null;
  return html`<img src=${url} alt=${alt} loading=${eager ? 'eager' : 'lazy'} onClick=${onClick} />`;
}

/* ---------- réglages de l'utilisateur (confort, par appareil) ---------- */
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('lh.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lh.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
export function applyPrefs() {
  const t = prefs.get('theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  document.documentElement.style.setProperty('--read-size', prefs.get('size', 19) + 'px');
  document.documentElement.style.setProperty('--align', prefs.get('justify', true) ? 'justify' : 'left');
}
