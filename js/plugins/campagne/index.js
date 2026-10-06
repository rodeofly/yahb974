// Greffon « campagne » — interface : le passeport du voyageur.
//   - Création du héros : « Nouveau voyageur », un passeport retrouvé sur cet appareil, ou un code à taper.
//   - Écran de victoire : le passeport (code + QR code + copier), enregistré aussi sur cet appareil.
//   - Feuille d'Aventure : d'où vient le héros.
//   - Onglet Règles : la campagne et les listes transportées.
// Rien n'est envoyé sur Internet : les passeports restent dans ce navigateur. Voir docs/plugins/campagne.md.

import { html, useState, useEffect } from '../../lib/preact-htm.js';
import { Icon, toast, loadCSS } from '../../ui/common.js';
import { registerCreatorPanel, registerEndingPanel, registerRunHook, registerSheetPanel, registerRulesSection } from '../../ui/registry.js';
import { kvGet, kvPut } from '../../store/db.js';
import { qrMatrix } from '../partage/core.js';
import * as P from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

const KEY = id => 'campagne|' + id;
const MAX_KEPT = 12;

/** Passeports enregistrés sur cet appareil pour une campagne, du plus récent au plus ancien. */
async function savedPassports(campId) {
  const list = await kvGet(KEY(campId)).catch(() => null);
  return Array.isArray(list) ? list : [];
}

async function rememberPassport(camp, entry) {
  const list = (await savedPassports(camp.id)).filter(p => p.code !== entry.code);
  await kvPut(KEY(camp.id), [entry, ...list].slice(0, MAX_KEPT));
}

/* ------------------------------------------------------------------ */
/* Création du héros                                                   */
/* ------------------------------------------------------------------ */

function PassportPicker({ adv, choice, setChoice }) {
  const camp = P.campaignOf(adv);
  const [saved, setSaved] = useState(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { let on = true; if (camp) savedPassports(camp.id).then(l => on && setSaved(l)); return () => { on = false; }; }, [camp?.id]);
  if (!camp) return null;
  const book = Number(camp.book) || 0;
  const usable = (saved || []).map(e => ({ e, r: P.decodePassport(camp, e.code) })).filter(x => x.r.ok && x.r.pass.book < book || (x.r.ok && !book));
  const pick = (code, pass) => { setError(''); setChoice({ code, pass }); };
  const tryTyped = () => {
    const r = P.decodePassport(camp, typed);
    if (!r.ok) { setError(r.error); setChoice(null); return; }
    pick(typed.trim().toUpperCase(), r.pass);
    toast('Passeport reconnu : ' + P.describe(r.pass, adv));
  };
  const current = choice?.code || '';
  return html`<section class="panel camp-pick" lang="fr">
    <header><h3><${Icon} name="flag" />${camp.title || 'Campagne'}${book ? ` · livre ${book}` : ''}</h3></header>
    <p class="subtle" style="margin:0">Tu as déjà joué un livre précédent ? Reprends ton voyageur avec son passeport : il garde son or, ses objets,
      ses amis et sa mémoire. Sinon, pars en nouveau voyageur : l'aventure te donnera ce qu'il faut.</p>
    <div class="camp-options" role="radiogroup" aria-label="Voyageur">
      <label class=${'camp-opt' + (!current ? ' on' : '')}>
        <input type="radio" name="camp-voyageur" checked=${!current} onChange=${() => { setChoice(null); setError(''); }} />
        <span><b>Nouveau voyageur</b><span class="subtle">Commencer sans passeport.</span></span>
      </label>
      ${usable.map(({ e, r }) => html`<label class=${'camp-opt' + (current === e.code ? ' on' : '')}>
        <input type="radio" name="camp-voyageur" checked=${current === e.code} onChange=${() => pick(e.code, r.pass)} />
        <span><b>${e.hero || 'Voyageur'}</b><span class="subtle">${P.describe(r.pass, adv)}${e.date ? ' · ' + new Date(e.date).toLocaleDateString('fr-FR') : ''}</span></span>
      </label>`)}
    </div>
    <div class="row camp-code">
      <label class="stack" style="flex:1;gap:2px"><span class="subtle">Ou tape ton code de passeport</span>
        <input class="mono" value=${typed} placeholder=${`${(camp.prefix || '').toUpperCase()}${Math.max(1, book - 1)}-XXXX-XXXX-…`} autocomplete="off" spellcheck="false"
          onInput=${e => { setTyped(e.target.value); setError(''); }} onKeyDown=${e => e.key === 'Enter' && tryTyped()} aria-invalid=${!!error} />
      </label>
      <button class="btn" onClick=${tryTyped} disabled=${!typed.trim()}><${Icon} name="check" />Valider</button>
    </div>
    ${error && html`<p class="camp-error" role="alert"><${Icon} name="x" />${error}</p>`}
    ${choice?.pass && html`<p class="camp-ok"><${Icon} name="check" />Tu repars avec : ${P.describe(choice.pass, adv)}. Tes caractéristiques viennent du passeport.</p>`}
  </section>`;
}

registerCreatorPanel({
  id: 'campagne', order: 6, place: 'top', Panel: PassportPicker,
  beforeStart: (state, choice, adv) => {
    if (!P.campaignOf(adv)) return;
    if (choice?.pass) P.applyPassport(state, adv, choice.pass, choice.code);
    else P.applyNewcomer(state, adv);
  },
});

/* ------------------------------------------------------------------ */
/* Victoire : le passeport                                             */
/* ------------------------------------------------------------------ */

function QrSvg({ text }) {
  const qr = qrMatrix(text, 'M');
  if (!qr) return null;
  return html`<svg class="camp-qr" viewBox=${`0 0 ${qr.size} ${qr.size}`} shape-rendering="crispEdges" role="img" aria-label="QR code du passeport">
    <rect width=${qr.size} height=${qr.size} fill="#fff" /><path fill="#000" d=${qr.path} /></svg>`;
}

function PassportEnding({ adv, state }) {
  if (!P.showsPassport(state, adv)) return null;
  const camp = P.campaignOf(adv);
  const code = P.encodePassport(camp, P.passportOf(state, adv));
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast('Passeport copié.'); } catch { toast('Copie impossible : recopie le code à la main.'); }
  };
  return html`<section class="panel camp-pass" lang="fr">
    <header><h3><${Icon} name="flag" />Ton passeport de voyageur</h3></header>
    <p style="margin:0">Garde-le précieusement : avec lui, tu continueras <b>${camp.title || 'la campagne'}</b> au livre ${(Number(camp.book) || 0) + 1}
      avec ton or, tes objets, tes amis et ta mémoire. Sur cet appareil, il est déjà enregistré.</p>
    <div class="camp-pass-body">
      <${QrSvg} text=${code} />
      <div class="stack">
        <code class="camp-code-big" aria-label=${'Code du passeport : ' + code.split('').join(' ')}>${code}</code>
        <button class="btn" onClick=${copy}><${Icon} name="save" />Copier le code</button>
        <span class="subtle">${P.describe(P.passportOf(state, adv), adv)}</span>
      </div>
    </div>
  </section>`;
}

registerEndingPanel({ id: 'campagne', order: 5, Panel: PassportEnding });

registerRunHook({
  onEnd: (adv, state, ctx) => {
    if (ctx?.test || !P.showsPassport(state, adv)) return;
    const camp = P.campaignOf(adv);
    const code = P.encodePassport(camp, P.passportOf(state, adv));
    rememberPassport(camp, { code, hero: state.hero?.name || '', book: Number(camp.book) || 0, adventureId: adv.id, date: new Date().toISOString() })
      .catch(e => console.warn('[greffon campagne]', e));
  },
});

/* ------------------------------------------------------------------ */
/* Feuille d'Aventure                                                  */
/* ------------------------------------------------------------------ */

function SheetCampaign({ adv, state }) {
  const camp = P.campaignOf(adv);
  if (!camp) return null;
  return html`<div class="camp-sheet"><${Icon} name="flag" />
    <span class="stack" style="gap:0"><span class="eyebrow">${camp.title || 'Campagne'}</span>
      <b>Livre ${camp.book || '?'}</b>
      <span class="subtle">${state.campaign ? `Venu du livre ${state.campaign.from} avec son passeport` : 'Nouveau voyageur'}</span></span>
  </div>`;
}

registerSheetPanel({ id: 'campagne', order: 2, Panel: SheetCampaign });

/* ------------------------------------------------------------------ */
/* Onglet Règles                                                       */
/* ------------------------------------------------------------------ */

const LISTS = [
  ['stats', 'Caractéristiques transportées (valeur de départ)'],
  ['counters', 'Compteurs transportés'],
  ['items', 'Objets transportés'],
  ['flags', 'Marques transportées'],
  ['companions', 'Compagnons transportés'],
];

function RulesSection({ adv, change }) {
  const camp = P.campaignOf(adv);
  const set = patch => change(a => { a.rules.campaign = { ...(a.rules.campaign || {}), ...patch }; return a; });
  const setField = (k, v) => change(a => { const c = a.rules.campaign || {}; a.rules.campaign = { ...c, fields: { ...(c.fields || {}), [k]: v } }; return a; });
  const splitIds = v => v.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
  if (!camp) return html`<section class="panel"><header><h3>Campagne</h3>
      <button class="btn small" onClick=${() => set({ id: adv.id, title: adv.meta?.title || '', book: 1, prefix: '', fields: { stats: (adv.rules.stats || []).map(s => s.id), gold: true } })}><${Icon} name="plus" />Faire de cette aventure un livre de campagne</button></header>
    <p class="subtle" style="margin:0">Une campagne enchaîne plusieurs aventures : à la fin d'un livre, le joueur reçoit un passeport (un code) qui
      transporte son héros dans le livre suivant.</p></section>`;
  return html`<section class="panel camp-rules"><header><h3>Campagne</h3>
      <button class="btn small" onClick=${() => change(a => { delete a.rules.campaign; return a; })}><${Icon} name="trash" />Retirer</button></header>
    <p class="subtle" style="margin:0">Même identifiant et mêmes listes dans tous les livres de la campagne. On peut <b>ajouter</b> à la fin d'une
      liste d'un livre à l'autre, jamais retirer ni réordonner : les anciens passeports resteraient faux.</p>
    <div class="grid2">
      <label class="stack"><span>Identifiant de la campagne</span><input value=${camp.id || ''} onChange=${e => set({ id: e.target.value.trim() })} /></label>
      <label class="stack"><span>Titre</span><input value=${camp.title || ''} onChange=${e => set({ title: e.target.value })} /></label>
      <label class="stack"><span>Numéro de ce livre</span><input type="number" min="1" max="31" value=${camp.book || 1} onChange=${e => set({ book: Number(e.target.value) || 1 })} /></label>
      <label class="stack"><span>Préfixe du code (lettres)</span><input value=${camp.prefix || ''} maxlength="4" onChange=${e => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></label>
    </div>
    <label class="row"><input type="checkbox" checked=${P.fieldsOf(camp).gold} onChange=${e => setField('gold', e.target.checked)} /> Transporter l'or</label>
    ${LISTS.map(([k, label]) => html`<label class="stack"><span>${label}</span>
      <textarea class="mono" rows="2" value=${(camp.fields?.[k] || []).join(', ')} onChange=${e => setField(k, splitIds(e.target.value))}></textarea></label>`)}
    <label class="stack"><span>Modes, dans l'ordre (identifiants communs à tous les livres)</span>
      <input class="mono" value=${(camp.modes || []).join(', ')} onChange=${e => set({ modes: splitIds(e.target.value) })} /></label>
  </section>`;
}

registerRulesSection({ id: 'campagne', order: 40, Section: RulesSection });
