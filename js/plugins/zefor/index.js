// Greffon « zefor » — interface : bloc jouable et éditable, page de retour #/zefor-retour, section des Règles,
// bilan de fin de partie, version imprimable. Le moteur (vérifications, état) est dans ./core.js.
// Voir docs/plugins/zefor.md et docs/ZEFOR.md.

import { html, useState, useEffect, useRef, useMemo } from '../../lib/preact-htm.js';
import { Icon, Prose, Modal, toast, confirmBox, loadCSS } from '../../ui/common.js';
import { registerBlockUI, registerRulesSection, registerRoute, registerPrintSection, registerEndingPanel } from '../../ui/registry.js';
import { Text, Num, Select, EffectsEditor } from '../../ui/editor.js';
import { kvGet, kvPut, kvDelete, kvList } from '../../store/db.js';
import { loadAdventure } from '../../store/library.js';
import { describeEffect } from '../../core/rules.js';
import { sfx } from '../../ui/audio.js';
import * as Z from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ------------------------------------------------------------------ */
/* Petits outils                                                       */
/* ------------------------------------------------------------------ */

const ZP = {
  zefor: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8.5 8.5h7l-7 7h7"/>',
  wait: '<path d="M7 3h10M7 21h10"/><path d="M8 3v2.5a4 4 0 0 0 1.6 3.2L12 10.5l2.4-1.8A4 4 0 0 0 16 5.5V3M8 21v-2.5a4 4 0 0 1 1.6-3.2L12 13.5l2.4 1.8a4 4 0 0 1 1.6 3.2V21"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M18.5 4.5l2 2"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  ko: '<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M19 13a10 10 0 0 0-2.4-1.7M2 9.5a15 15 0 0 1 4.5-2.8M22 9.5A15 15 0 0 0 11 5.1"/><circle cx="12" cy="20" r="1" fill="currentColor"/>',
  skip: '<path d="M5 5l8 7-8 7z"/><path d="M17 5v14"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/>',
};
/** Icônes du greffon (traits simples, pas d'émoji). */
const ZI = ({ name, cls = '' }) => html`<svg class=${'ico zf-ico ' + cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ZP[name] }}></svg>`;

const fr = n => String(n).replace('.', ',');
const isTest = () => /[?&]test=1(&|$)/.test(location.hash);
const appBase = () => location.origin + location.pathname;
/** Adresse de retour : #/zefor-retour/<aventure>/<paragraphe>.<index> (zefor y ajoute ?nonce=…&success=…). */
const returnUrl = (adv, section, index) => `${appBase()}#/${Z.ROUTE}/${encodeURIComponent(adv.id)}${section != null ? '/' + encodeURIComponent(Z.blockRef(section, index)) : ''}`;
let seq = 0;
const useUid = p => useMemo(() => `${p}-${++seq}`, []);

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copié dans le presse-papiers.'); }
  catch { toast('Copie impossible : sélectionnez le texte et copiez-le vous-même.'); }
}

/** Enregistre (sans écraser un résultat déjà arrivé) la partie qui attend un résultat : utile à la page de retour. */
async function rememberPending(nonce, info) {
  try { const rec = await kvGet(Z.KV + nonce); await kvPut(Z.KV + nonce, { ...info, ...(rec || {}) }); } catch { /* stockage indisponible */ }
}

/* ------------------------------------------------------------------ */
/* Bloc pendant la lecture                                             */
/* ------------------------------------------------------------------ */

const INTRO = {
  code: 'Ouvrez le parcours et réussissez-le : Zefor vous donnera un code de réussite à taper ici.',
  message: 'Le parcours s’ouvre dans un nouvel onglet. Réussissez-le : l’aventure se débloquera toute seule.',
  cadre: 'Le parcours s’affiche ici même. Réussissez-le : l’aventure se débloquera toute seule.',
  retour: 'Le parcours s’ouvre dans un nouvel onglet. Quand vous l’avez réussi, Zefor vous ramène au livre et la suite se débloque.',
};

/**
 * Bloc « Défi Zefor » (modes code, message, retour). `inner` : affiché DANS un défi intégré dont le paquet n'a pas pu
 * se charger (repli) — sans titre ni consigne, déjà montrés par le défi ; `lead` : message affiché en tête.
 */
function ZeforPlayer({ adv, state, index, block, update, inner = false, lead = null }) {
  const b = block;
  const st = state.blocks[index] || {};
  const mode = Z.modeOf(b), display = Z.displayOf(b);
  const test = isTest();
  const uid = useUid('zf');
  const stateRef = useRef(state);
  stateRef.current = state;
  const handled = useRef(new Set());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [frameOn, setFrameOn] = useState(false);
  const [big, setBig] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const title = b.title || 'Défi Zefor';
  const min = Z.minScoreOf(b);
  const validUrl = !!Z.buildUrl(b, { nonce: 'x' });

  useEffect(() => {
    const on = () => setOnline(navigator.onLine !== false);
    addEventListener('online', on); addEventListener('offline', on);
    return () => { removeEventListener('online', on); removeEventListener('offline', on); };
  }, []);
  useEffect(() => {
    if (!big) return;
    const k = e => e.key === 'Escape' && setBig(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [big]);

  /** Un résultat arrive (message, onglet de retour, magasin local) : on le vérifie puis on l'applique. */
  const receive = async (result, via, origin) => {
    const cur = stateRef.current.blocks[index];
    if (!cur?.nonce || cur.status !== 'pending' || result.nonce !== cur.nonce) return;
    const tag = `${result.nonce}|${result.success}|${result.scoreText}|${result.signature}`;
    if (handled.current.has(tag)) return;
    handled.current.add(tag);
    let chk;
    try { chk = await Z.checkResult(result, { adv, block: b, nonce: cur.nonce, origin, channel: via }); }
    catch (e) { handled.current.delete(tag); setNotice(e.message); return; }
    if (!chk.ok) { setNotice(`Résultat refusé : ${Z.REASONS[chk.reason] || chk.reason}${chk.reason === 'origin' ? ` (${origin})` : ''}.`); return; }
    const latest = stateRef.current;
    if (latest.blocks[index]?.status !== 'pending' || latest.blocks[index]?.nonce !== result.nonce) return;
    const r = Z.recordResult(latest, adv, index, { success: chk.success, score: result.score, via, exercise: result.exercise, scoreOk: chk.scoreOk });
    sfx.luck(chk.success);
    setNotice(null);
    setFrameOn(false); setBig(false);
    update(r.state, r.messages);
    kvDelete(Z.KV + result.nonce).catch(() => {});
  };

  // Écoute des résultats tant qu'un parcours est ouvert.
  const pending = st.status === 'pending' ? st.nonce : null;
  useEffect(() => {
    if (!pending) return;
    const offs = [];
    if (mode === 'message') {
      const onMsg = e => {
        const d = e.data;
        if (d && typeof d === 'object' && d.type === 'm974:ready') {
          // Protocole m974 de Maths974 : on répond au « prêt » de l'activité par son lancement.
          if (Z.allowedOrigins(adv, b).includes(e.origin)) {
            try { e.source?.postMessage({ type: 'm974:launch', version: 1, session: pending, payload: { activity: b.exercise || undefined, kind: 'graded', locale: 'fr', session: pending } }, e.origin); } catch { /* fenêtre fermée */ }
          }
          return;
        }
        const r = Z.parseMessage(d);
        if (r) receive(r, 'message', e.origin);
      };
      addEventListener('message', onMsg);
      offs.push(() => removeEventListener('message', onMsg));
    }
    // L'onglet de retour et le magasin local ne servent qu'au mode « retour » : en mode « code », seul un code débloque.
    if (mode !== 'retour') return () => offs.forEach(f => f());
    if (typeof BroadcastChannel === 'function') {
      const ch = new BroadcastChannel(Z.CHANNEL);
      ch.onmessage = e => { const r = Z.parseMessage(e.data); if (r) receive(r, 'retour'); };
      offs.push(() => ch.close());
    }
    const poll = () => kvGet(Z.KV + pending).then(rec => { if (rec?.result) receive(rec.result, 'retour'); }).catch(() => {});
    poll();
    const onVis = () => { if (document.visibilityState !== 'hidden') poll(); };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('focus', onVis);
    offs.push(() => { document.removeEventListener('visibilitychange', onVis); removeEventListener('focus', onVis); });
    return () => offs.forEach(f => f());
  }, [pending]);

  const open = () => {
    setNotice(null);
    const r = Z.openChallenge(stateRef.current, adv, index, Z.newNonce());
    const url = Z.buildUrl(b, { nonce: r.nonce, returnUrl: returnUrl(adv, state.section, index), origin: location.origin });
    if (!url) { toast('L’adresse du parcours Zefor est invalide : prévenez l’auteur de l’aventure.'); return; }
    if (display === 'cadre') setFrameOn(true);
    else if (mode === 'message') {
      const w = window.open(url, 'zefor-' + r.nonce);
      if (!w) setNotice('Votre navigateur a bloqué l’ouverture de Zefor. Autorisez les fenêtres pour ce site, puis cliquez de nouveau.');
    } else window.open(url, '_blank', 'noopener');
    update(r.state, []);
    rememberPending(r.nonce, { adventureId: adv.id, title: adv.meta.title, section: state.section, index, block: b.title || '', test, created: Date.now() });
  };

  const submit = async e => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true); setNotice(null);
    try {
      const kind = await Z.checkCode(adv, b, code, stateRef.current.blocks[index]?.nonce);
      const latest = stateRef.current;
      if (latest.blocks[index]?.status === 'success') return;
      if (kind) {
        const r = Z.recordResult(latest, adv, index, { success: true, via: kind === 'personal' ? 'personal' : 'code' });
        sfx.luck(true); setCode(''); setFrameOn(false);
        update(r.state, r.messages);
      } else { sfx.luck(false); update(Z.wrongCode(latest, index).state, []); }
    } catch (err) { setNotice(err.message); }
    finally { setBusy(false); }
  };

  const act = fn => { try { const r = fn(stateRef.current, adv, index); update(r.state, r.messages); } catch (e) { toast(e.message); } };
  const simulate = ok => {
    const opened = Z.openChallenge(stateRef.current, adv, index, Z.newNonce()).state;
    const r = Z.recordResult(opened, adv, index, { success: ok, via: 'simulation' });
    sfx.luck(ok); setFrameOn(false);
    update(r.state, r.messages);
  };
  const skipFx = (b.skipEffects || []).map(e => describeEffect(e, adv)).filter(Boolean).join(', ');
  const skip = async () => { if (await confirmBox(`Continuer sans relever le défi${skipFx ? ` (${skipFx})` : ''} ?`, 'Continuer sans le défi')) act(Z.skipChallenge); };
  const giveUp = async () => { if (await confirmBox('Abandonner ce défi ? Vous irez au paragraphe prévu en cas d’échec.', 'Abandonner')) act(Z.failChallenge); };

  const status = st.status;
  const res = st.result;
  const frameUrl = display === 'cadre' && status === 'pending' && st.nonce ? Z.buildUrl(b, { nonce: st.nonce, returnUrl: returnUrl(adv, state.section, index), origin: location.origin }) : null;

  const codeForm = html`<form class="zf-code" onSubmit=${submit}>
      <label class="field" for=${uid + '-c'}>Code de réussite donné par Zefor
        <input id=${uid + '-c'} type="text" class="zf-code-input" value=${code} onInput=${e => setCode(e.target.value)}
          autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" aria-describedby=${st.wrong ? uid + '-w' : undefined} /></label>
      <button class=${'btn' + (mode === 'code' && status === 'pending' ? ' primary' : '')} type="submit" disabled=${!code.trim() || busy}><${ZI} name="key" />Valider le code</button>
    </form>
    ${st.wrong && html`<p class="zf-note ko" id=${uid + '-w'} role="alert"><${ZI} name="ko" />Ce code n’est pas le bon${st.tries > 1 ? ` (${st.tries} essais)` : ''}. Vérifiez chaque caractère et réessayez.</p>`}`;

  const scoreLine = res?.score != null && html`<span>Score : <b class="mono">${fr(res.score)}</b>${min != null ? (res.scoreOk === false ? ` — il fallait au moins ${fr(min)}` : ` (minimum demandé : ${fr(min)})`) : ''}</span>`;

  const body = html`${lead}
    ${status === 'success' ? html`
      <div class="zf-result ok" role="status"><${ZI} name="ok" />
        <div><b class="zf-big">Défi réussi !</b>${scoreLine}<span class="subtle">Validé par ${Z.viaLabel(res?.via)}.</span></div></div>
      <div><button class="btn primary" onClick=${() => act(Z.continueChallenge)}>Continuer<span class="mono">→ ${b.success}</span></button></div>`
    : html`
      <p class="subtle zf-intro">${INTRO[display === 'cadre' ? 'cadre' : mode]}${min != null ? ` Score minimum : ${fr(min)}.` : ''}</p>
      ${!online && html`<p class="zf-note"><${ZI} name="offline" />Vous semblez hors ligne : le parcours Zefor a besoin d’Internet.${b.allowSkip ? ' Vous pouvez aussi continuer sans le défi.' : ''}</p>`}
      ${status === 'failure' && html`<div class="zf-result ko" role="status"><${ZI} name="ko" />
        <div><b class="zf-big">Parcours non réussi</b>${scoreLine}<span class="subtle">Vous pouvez réessayer${b.failure ? ' ou accepter votre échec' : ''}.</span></div></div>`}
      ${status === 'pending' && mode !== 'code' && html`<div class="zf-wait" role="status"><${ZI} name="wait" cls="zf-spin" />
        <div><b>En attente du résultat…</b><span class="subtle">${display === 'cadre' ? 'Faites le parcours ci-dessous.' : 'Faites le parcours dans l’onglet Zefor, puis revenez ici : la suite se débloquera.'}</span></div></div>`}
      <div class="row">
        ${!(frameUrl && frameOn) && html`<button class=${'btn' + (mode === 'code' && status === 'pending' ? '' : ' primary')} onClick=${open} disabled=${!validUrl}>
          <${ZI} name="open" />${status === 'failure' ? 'Réessayer le parcours' : status === 'pending' ? (display === 'cadre' ? 'Reprendre le parcours' : 'Rouvrir le parcours Zefor') : 'Ouvrir le parcours Zefor'}</button>`}
        ${status === 'failure' && b.failure && html`<button class="btn" onClick=${() => act(Z.failChallenge)}>Accepter l’échec<span class="mono">→ ${b.failure}</span></button>`}
      </div>
      ${!validUrl && html`<p class="zf-note ko"><${ZI} name="ko" />L’adresse de ce parcours est manquante ou invalide.</p>`}
      ${frameUrl && frameOn && html`<div class=${'zf-frame' + (big ? ' big' : '')}>
        <div class="zf-frame-bar"><span class="subtle">${title} — zefor974</span>
          <span class="row" style="gap:6px">
            <button class="btn small" onClick=${() => setBig(x => !x)} aria-pressed=${big}><${ZI} name=${big ? 'shrink' : 'expand'} />${big ? 'Réduire' : 'Agrandir'}</button>
            <a class="btn small" href=${frameUrl} target="_blank" rel="noopener"><${ZI} name="open" />Onglet</a></span></div>
        <iframe src=${frameUrl} title=${`Parcours Zefor : ${title}`} allow="fullscreen"></iframe>
      </div>`}
      ${mode === 'code' ? codeForm : Z.hasCodes(adv, b) && html`<details class="zf-more" open=${!!st.wrong}><summary>Zefor vous a donné un code ? Tapez-le ici</summary>${codeForm}</details>`}
      ${notice && html`<p class="zf-note ko" role="alert"><${ZI} name="ko" />${notice}</p>`}
      ${(b.allowSkip || (b.failure && status !== 'failure')) && html`<div class="row zf-alt">
        ${b.failure && status !== 'failure' && html`<button class="btn" onClick=${giveUp}><${Icon} name="x" /><span class="zf-lbl">J’abandonne le défi</span><span class="mono">→ ${b.failure}</span></button>`}
        ${b.allowSkip && html`<button class="btn" onClick=${skip}><${ZI} name="skip" /><span class="zf-lbl">${b.skipLabel || 'Continuer sans le défi'}${skipFx && html` <span class="zf-cost">(${skipFx})</span>`}</span><span class="mono">→ ${b.skipTo || b.success}</span></button>`}
      </div>`}
      ${test && html`<div class="zf-tools" role="group" aria-label="Outils de l’auteur (mode test)">
        <span class="eyebrow">Mode test</span>
        <button class="btn small" onClick=${() => simulate(true)}><${ZI} name="ok" />Simuler une réussite</button>
        <button class="btn small" onClick=${() => simulate(false)}><${ZI} name="ko" />Simuler un échec</button>
      </div>`}`}`;
  if (inner) return html`<div class=${'zf zf-fallback zf-' + (status || 'idle')}>${body}</div>`;
  return html`<section class=${'block zf zf-' + (status || 'idle')} aria-labelledby=${uid + '-t'} lang="fr">
    <h3 id=${uid + '-t'}><${ZI} name="zefor" />${title}<span class="badge zf-badge">Zefor</span></h3>
    ${b.description && html`<${Prose} text=${b.description} />`}
    ${body}
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Mode intégré : l'activité zefor jouée dans le paragraphe            */
/* ------------------------------------------------------------------ */

/** Dossier du paquet zefor (vendor/zefor/ à la racine du site), construit hors du dépôt (zefor-paquet/construire.mjs). */
const VENDOR_URL = new URL('../../../' + Z.VENDOR_DIR, import.meta.url);
const packages = new Map();
let attempt = 0;

/** Feuille de style chargée une fois ; la promesse se résout quand elle est appliquée (ou en erreur : le jeu reste jouable). */
function loadSheet(href) {
  const url = String(href);
  const old = document.querySelector(`link[data-lh="${url}"]`);
  if (old) return old._lhReady || Promise.resolve();
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = url; l.dataset.lh = url;
  l._lhReady = new Promise(res => { l.onload = res; l.onerror = res; });
  document.head.append(l);
  return l._lhReady;
}

/**
 * Charge l'activité `kind` du paquet (import() dynamique + sa feuille de style). Mis en cache par page ;
 * un échec n'est pas gardé (« Réessayer » refait la demande, avec une adresse neuve : un module en échec
 * reste en échec pour la même adresse).
 */
function loadActivity(kind) {
  if (!packages.has(kind)) {
    const k = Z.KINDS[kind];
    const n = attempt;
    const p = (async () => {
      const url = new URL(k.module, VENDOR_URL);
      if (n) url.searchParams.set('essai', n);
      const mod = await import(url.href);
      const act = mod[k.export] || mod.default;
      if (!act || typeof act.mount !== 'function') throw new Error('paquet zefor incomplet');
      if (k.css) await loadSheet(new URL(k.css, VENDOR_URL));
      return act;
    })();
    p.catch(() => { if (packages.get(kind) === p) packages.delete(kind); attempt++; });
    packages.set(kind, p);
  }
  return packages.get(kind);
}

/**
 * Monte l'activité dans un conteneur à fond clair (la carte zefor n'existe qu'en clair) et la démonte proprement.
 * Rappels : onPass(r) (réussite, avec ses étoiles), onMiss() (un essai raté), onError(message), onReady().
 * Pour les tests : window.__zeforIntegre = { kind, api, host, level } tant que l'activité est montée.
 */
function ActivityStage({ kind, level, onPass, onMiss, onError, onReady, label }) {
  const host = useRef();
  const cb = useRef({});
  cb.current = { onPass, onMiss, onError, onReady };
  useEffect(() => {
    let alive = true, api = null;
    const el = host.current;
    const expose = a => { window.__zeforIntegre = { kind, api: a, host: el, level }; };
    loadActivity(kind).then(async act => {
      if (!alive) return;
      const ctx = {
        config: { level: Z.levelForMount(kind, level) }, mode: 'play',
        onPass: r => { if (alive) cb.current.onPass?.(r); },
      };
      // Un essai raté : onFail pour Blokaly (qui appelle aussi onEssai), onEssai pour la brume.
      if (kind === 'maze') ctx.onFail = () => { if (alive) cb.current.onMiss?.(); };
      if (kind === 'brume') ctx.onEssai = e => { if (alive && e && e.passed === false) cb.current.onMiss?.(); };
      // La brume se donne le focus en se montant : à l'arrivée sur le paragraphe, la page sauterait jusqu'à l'activité
      // (texte à lire sauté, image paresseuse jamais chargée, lecteur d'écran déplacé). On garde la position et le focus,
      // sauf si le joueur agissait déjà dans le défi (Recommencer, Réessayer de charger) ou dans l'aperçu de l'éditeur.
      const sx = scrollX, sy = scrollY;
      const acting = !!el.closest('.zf-integre, .modal')?.contains(document.activeElement);
      const a = await act.mount(el, ctx);
      if (!acting && el.contains(document.activeElement)) {
        document.activeElement.blur();
        if (scrollX !== sx || scrollY !== sy) scrollTo(sx, sy);
      }
      if (!alive) { try { a?.destroy?.(); } catch { /* déjà démonté */ } return; }
      api = a; expose(a);
      cb.current.onReady?.();
    }).catch(e => { if (alive) cb.current.onError?.(e); });
    return () => {
      alive = false;
      try { api?.destroy?.(); } catch { /* l'activité a déjà disparu */ }
      if (window.__zeforIntegre?.host === el) delete window.__zeforIntegre;
      el.innerHTML = '';
    };
  }, []);
  // Le conteneur intérieur appartient à zefor (qui remplace sa classe et son contenu) : Preact n'y touche jamais
  // (ni classe ni enfant déclarés) ; l'enveloppe .zf-stage garde le fond clair et la taille.
  return html`<div class="zf-stage" data-kind=${kind} role="group" aria-label=${label} lang="fr"><div ref=${host}></div></div>`;
}

/** Pourquoi le paquet ne s'est pas chargé, en clair. */
const loadReason = () => (navigator.onLine === false
  ? 'vous êtes hors ligne et cette activité n’a pas encore été enregistrée sur cet appareil'
  : 'le paquet zefor est absent de ce site (dossier vendor/zefor/)');

const Stars = ({ n, max }) => html`<span class="zf-stars" aria-label=${Z.starsText(n, max)}><span aria-hidden="true">${'★'.repeat(n)}${'☆'.repeat(Math.max(0, max - n))}</span> <span class="subtle">(${Z.starsText(n, max)})</span></span>`;

function needText(b) {
  const { minScore, minStars } = Z.passOf(b);
  if (Z.kindOf(b) === 'pezali' || !Z.KINDS[Z.kindOf(b)]?.stars) return '';
  if (minStars != null) return `au moins ${Z.starsText(minStars)}`;
  if (minScore != null && minScore > 0) {
    const n = Math.ceil(minScore * Z.MAX_STARS - 1e-9);
    return n >= 1 ? `au moins ${Z.starsText(n)}` : '';
  }
  return '';
}

function IntegrePlayer({ adv, state, index, block, update }) {
  const b = block;
  const st = state.blocks[index] || {};
  const kind = Z.kindOf(b), level = Z.levelOf(b);
  const test = isTest();
  const uid = useUid('zfi');
  const stateRef = useRef(state);
  stateRef.current = state;
  const problems = useMemo(() => Z.checkLevel(kind, level).filter(p => p.level === 'error'), [b]);
  const [phase, setPhase] = useState(problems.length ? 'broken' : 'loading');
  const [run, setRun] = useState(0);
  const [big, setBig] = useState(false);
  // Une partie reprise après la réussite n'a plus besoin de l'activité : on ne la monte que si elle a servi ici.
  const [shown] = useState(() => st.status !== 'success');
  const title = b.title || 'Défi Zefor';
  const fb = Z.fallbackBlock(b);
  const need = needText(b);
  // La brume n'affiche pas la consigne du niveau (le labyrinthe et la balance, si) : le livre la montre au-dessus.
  const consigne = Z.levelText(level);
  const status = st.status;
  const res = st.result;

  useEffect(() => {
    if (!big) return;
    const k = e => e.key === 'Escape' && setBig(false);
    document.addEventListener('keydown', k);
    // Blockly et Pezali se recalent sur l'événement resize de la fenêtre.
    const t = setTimeout(() => dispatchEvent(new Event('resize')), 60);
    return () => { document.removeEventListener('keydown', k); clearTimeout(t); setTimeout(() => dispatchEvent(new Event('resize')), 60); };
  }, [big]);

  const onPass = r => {
    const cur = stateRef.current;
    if (cur.blocks[index]?.status === 'success') return;
    const v = Z.judgeIntegre(b, r);
    const out = Z.recordResult(cur, adv, index, { success: v.success, score: v.score, via: 'integre', exercise: kind, scoreOk: v.scoreOk, stars: v.stars ?? null, maxStars: v.maxStars ?? null });
    sfx.luck(v.success);
    setBig(false);
    update(out.state, out.messages);
  };
  const onMiss = () => {
    const cur = stateRef.current;
    if (cur.blocks[index]?.status === 'success') return;
    update(Z.missIntegre(cur, index).state, []);
  };
  const retry = () => { update(Z.startIntegre(stateRef.current, index).state, []); setRun(n => n + 1); };
  const reload = () => { setPhase('loading'); setRun(n => n + 1); };
  const act = fn => { try { const r = fn(stateRef.current, adv, index); update(r.state, r.messages); } catch (e) { toast(e.message); } };
  const simulate = ok => {
    const r = Z.recordResult(stateRef.current, adv, index, ok
      ? { success: true, via: 'simulation', score: 1, ...(Z.KINDS[kind]?.stars ? { stars: Z.MAX_STARS, maxStars: Z.MAX_STARS } : {}) }
      : { success: false, via: 'simulation', score: 0 });
    sfx.luck(ok); update(r.state, r.messages);
  };
  const skipFx = (b.skipEffects || []).map(e => describeEffect(e, adv)).filter(Boolean).join(', ');
  const skip = async () => { if (await confirmBox(`Continuer sans relever le défi${skipFx ? ` (${skipFx})` : ''} ?`, 'Continuer sans le défi')) act(Z.skipChallenge); };
  const giveUp = async () => { if (await confirmBox('Abandonner ce défi ? Vous irez au paragraphe prévu en cas d’échec.', 'Abandonner')) act(Z.failChallenge); };

  const failed = phase === 'error' || phase === 'broken';
  const head = html`<h3 id=${uid + '-t'}><${ZI} name="zefor" />${title}<span class="badge zf-badge">Zefor</span></h3>
    ${b.description && html`<${Prose} text=${b.description} />`}`;

  // Le paquet ne s'est pas chargé (ou le défi est mal écrit) : message clair, puis le repli ou « continuer sans le défi ».
  if (failed && status !== 'success') {
    const why = phase === 'broken'
      ? `Ce défi est mal configuré (${problems.map(p => p.text).join(' ; ')}).`
      : `L’activité zefor n’a pas pu se charger : ${loadReason()}.`;
    const then = fb ? ' Faites plutôt le parcours de secours ci-dessous.' : b.allowSkip ? ' Vous pouvez continuer sans le défi.' : phase === 'error' ? ' Reconnectez-vous à Internet, puis réessayez.' : ' Prévenez l’auteur de l’aventure.';
    const lead = html`<p class="zf-note ko zf-load-error" role="alert"><${ZI} name="offline" /><span>${why}${then}</span></p>
      ${phase === 'error' && html`<div class="row"><button class="btn" onClick=${reload}><${ZI} name="retry" />Réessayer de charger l’activité</button></div>`}`;
    if (fb) return html`<section class=${'block zf zf-integre zf-' + (status || 'idle')} aria-labelledby=${uid + '-t'} lang="fr">${head}
      <${ZeforPlayer} adv=${adv} state=${state} index=${index} block=${fb} update=${update} inner lead=${lead} /></section>`;
    return html`<section class=${'block zf zf-integre zf-' + (status || 'idle')} aria-labelledby=${uid + '-t'} lang="fr">${head}${lead}
      ${(b.allowSkip || b.failure) && html`<div class="row zf-alt">
        ${b.failure && html`<button class="btn" onClick=${giveUp}><${Icon} name="x" /><span class="zf-lbl">J’abandonne le défi</span><span class="mono">→ ${b.failure}</span></button>`}
        ${b.allowSkip && html`<button class="btn" onClick=${skip}><${ZI} name="skip" /><span class="zf-lbl">${b.skipLabel || 'Continuer sans le défi'}${skipFx && html` <span class="zf-cost">(${skipFx})</span>`}</span><span class="mono">→ ${b.skipTo || b.success}</span></button>`}
      </div>`}
      ${test && html`<div class="zf-tools" role="group" aria-label="Outils de l’auteur (mode test)"><span class="eyebrow">Mode test</span>
        <button class="btn small" onClick=${() => simulate(true)}><${ZI} name="ok" />Simuler une réussite</button></div>`}
    </section>`;
  }

  const starsLine = res?.stars != null && html`<${Stars} n=${res.stars} max=${res.maxStars || Z.MAX_STARS} />`;
  return html`<section class=${'block zf zf-integre zf-' + (status || 'idle')} aria-labelledby=${uid + '-t'} lang="fr">
    ${head}
    ${status !== 'success' && html`<p class="subtle zf-intro">${Z.KINDS[kind].label} : l’activité se joue ici même.${need ? ` Pour réussir le défi, il faut ${need}.` : ''}</p>`}
    ${shown && html`<div class=${'zf-stage-wrap' + (big ? ' big' : '')}>
      <div class="zf-frame-bar"><span class="subtle">${title} — ${Z.KINDS[kind].short}</span>
        <span class="row" style="gap:6px">
          ${status !== 'success' && phase === 'ready' && html`<button class="btn small" onClick=${retry}><${ZI} name="retry" />Recommencer</button>`}
          <button class="btn small" onClick=${() => setBig(x => !x)} aria-pressed=${big}><${ZI} name=${big ? 'shrink' : 'expand'} />${big ? 'Réduire' : 'Agrandir'}</button></span></div>
      ${kind === 'brume' && consigne && html`<p class="zf-consigne">${consigne}</p>`}
      ${phase === 'loading' && html`<p class="zf-loading" role="status"><${ZI} name="wait" cls="zf-spin" />Chargement de l’activité…</p>`}
      <${ActivityStage} key=${run} kind=${kind} level=${level} label=${`Activité : ${title}`}
        onPass=${onPass} onMiss=${onMiss} onReady=${() => setPhase('ready')} onError=${() => setPhase('error')} />
    </div>`}
    ${status === 'success' ? html`
      <div class="zf-result ok" role="status"><${ZI} name="ok" />
        <div><b class="zf-big">Défi réussi !</b>${starsLine}<span class="subtle">Validé par ${Z.viaLabel(res?.via)}.</span></div></div>
      <div><button class="btn primary" onClick=${() => act(Z.continueChallenge)}>Continuer<span class="mono">→ ${b.success}</span></button></div>`
    : html`
      ${status === 'failure' && html`<div class="zf-result ko" role="status"><${ZI} name="ko" />
        <div><b class="zf-big">Défi pas encore réussi</b>${starsLine}${need && html`<span>Il faut ${need}.</span>`}
          <span class="subtle">Recommencez l’activité${b.failure ? ' ou acceptez votre échec' : ''}.</span></div></div>
        <div class="row"><button class="btn primary" onClick=${retry}><${ZI} name="retry" />Recommencer l’activité</button>
          ${b.failure && html`<button class="btn" onClick=${() => act(Z.failChallenge)}>Accepter l’échec<span class="mono">→ ${b.failure}</span></button>`}</div>`}
      ${status !== 'failure' && st.tries > 0 && html`<p class="zf-note zf-tries" role="status"><${ZI} name="retry" />${st.tries} essai${st.tries > 1 ? 's' : ''} sans réussir : observez, corrigez, et recommencez${b.failure ? ', ou abandonnez le défi' : ''}.</p>`}
      ${(b.allowSkip || (b.failure && status !== 'failure')) && html`<div class="row zf-alt">
        ${b.failure && status !== 'failure' && html`<button class="btn" onClick=${giveUp}><${Icon} name="x" /><span class="zf-lbl">J’abandonne le défi</span><span class="mono">→ ${b.failure}</span></button>`}
        ${b.allowSkip && html`<button class="btn" onClick=${skip}><${ZI} name="skip" /><span class="zf-lbl">${b.skipLabel || 'Continuer sans le défi'}${skipFx && html` <span class="zf-cost">(${skipFx})</span>`}</span><span class="mono">→ ${b.skipTo || b.success}</span></button>`}
      </div>`}
      ${test && html`<div class="zf-tools" role="group" aria-label="Outils de l’auteur (mode test)">
        <span class="eyebrow">Mode test</span>
        <button class="btn small" onClick=${() => simulate(true)}><${ZI} name="ok" />Simuler une réussite</button>
        <button class="btn small" onClick=${() => simulate(false)}><${ZI} name="ko" />Simuler un échec</button>
      </div>`}`}
  </section>`;
}

/** Choisit l'interface du bloc selon son mode (le composant ne change jamais de mode pendant sa vie). */
const BlockPlayer = props => (Z.isIntegre(props.block) ? html`<${IntegrePlayer} ...${props} />` : html`<${ZeforPlayer} ...${props} />`);

/* ---------- éditeur du mode intégré ---------- */

const PASS_OPTIONS = [['', 'Il suffit de réussir'], ['0.5', 'Au moins 2 étoiles sur 4'], ['0.75', 'Au moins 3 étoiles sur 4'], ['1', '4 étoiles sur 4']];
const LEVEL_HELP = {
  maze: 'grid : lignes de cases (1 chemin, 2 départ, 3 arrivée, 4 mur, 5 danger) ; startPos : { x, y, dir } (colonne et ligne comptées depuis 0, dir 0 = est, 1 = sud, 2 = ouest, 3 = nord) ; allowedBlocks ; maxBlocks ; decor : { danger, but } (noms : ' + Z.MAZE_DECOR.danger.join(', ') + ' / ' + Z.MAZE_DECOR.but.join(', ') + ', ou un pictogramme) ; instruction : { fr }.',
  brume: 'total ; points : [{ x (0 à 100), y (0 à 70), sous : numéro de la brume qui le cache }] ; brumes : [{ teinte : A, B ou C, x, y, r }] ; caches : { A : nombre caché } ; instruction : { fr }.',
  pezali: 'equationMode : "fixe" ; gauche et droite : "3x + 2" et "11" ; operations : parmi add, sub, mul, div ; consigne : { fr }.',
};

function LevelEditor({ kind, level, onChange }) {
  const uid = useUid('zfl');
  const [draft, setDraft] = useState(() => Z.prettyLevel(level));
  const [syntax, setSyntax] = useState(null);
  const last = useRef(level);
  // Le niveau change hors de ce champ (autre activité, niveau d'exemple) : on le réaffiche.
  useEffect(() => { if (level !== last.current) { last.current = level; setDraft(Z.prettyLevel(level)); setSyntax(null); } }, [level]);
  const problems = syntax ? [] : Z.checkLevel(kind, level);
  const onInput = text => {
    setDraft(text);
    let v;
    try { v = JSON.parse(text); } catch (e) { setSyntax(e.message.replace(/^JSON\.parse: /, '')); return; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { setSyntax('le niveau doit être un objet { … }'); return; }
    setSyntax(null); last.current = v; onChange(v);
  };
  const errors = problems.filter(p => p.level === 'error');
  return html`<div class="stack zf-level" style="gap:6px">
    <label class="field" for=${uid}>Niveau (JSON)
      <textarea id=${uid} rows="12" class="zf-mono" spellcheck="false" value=${draft} onInput=${e => onInput(e.target.value)} aria-describedby=${uid + '-h'} aria-invalid=${syntax || errors.length ? 'true' : 'false'}></textarea></label>
    <span class="subtle zf-help" id=${uid + '-h'}>${LEVEL_HELP[kind]}</span>
    ${syntax
      ? html`<p class="zf-note ko" role="alert"><${ZI} name="ko" />JSON illisible : ${syntax}. Le dernier niveau valide est conservé.</p>`
      : problems.length
        ? html`<ul class="zf-problems" aria-label="Vérification du niveau">${problems.map(p => html`<li class=${'zf-note ' + (p.level === 'error' ? 'ko' : '')}><${ZI} name=${p.level === 'error' ? 'ko' : 'info'} /><span><b>${p.level === 'error' ? 'Erreur' : p.level === 'warning' ? 'Attention' : 'À savoir'}</b> : ${p.text}</span></li>`)}</ul>`
        : html`<p class="zf-note ok" role="status"><${ZI} name="ok" />Niveau vérifié : rien à signaler.</p>`}
  </div>`;
}

/** Aperçu « Essayer l'activité » : l'activité montée dans une fenêtre, avec le verdict qu'aurait le défi. */
function TryActivity({ block, onClose }) {
  const kind = Z.kindOf(block), level = Z.levelOf(block);
  const [out, setOut] = useState(null);
  const [misses, setMisses] = useState(0);
  const [err, setErr] = useState(false);
  const [run, setRun] = useState(0);
  const v = out && Z.judgeIntegre(block, out);
  return html`<${Modal} title=${`Essayer l’activité : ${Z.kindLabel(kind)}`} onClose=${onClose} wide>
    <div class="zf-stage-wrap"><${ActivityStage} key=${run} kind=${kind} level=${level} label="Aperçu de l’activité"
      onPass=${r => setOut(r)} onMiss=${() => setMisses(n => n + 1)} onError=${() => setErr(true)} /></div>
    ${err && html`<p class="zf-note ko" role="alert"><${ZI} name="offline" />L’activité ne se charge pas : ${loadReason()}. Construisez le paquet (zefor-paquet/construire.mjs).</p>`}
    ${v ? html`<div class=${'zf-result ' + (v.success ? 'ok' : 'ko')} role="status"><${ZI} name=${v.success ? 'ok' : 'ko'} />
        <div><b>${v.success ? 'Le défi serait réussi' : 'Le défi ne serait pas encore réussi'}</b>
          ${v.stars != null && html`<${Stars} n=${v.stars} max=${v.maxStars} />`}<span class="subtle">Score normalisé : ${fr(v.score)}</span></div></div>`
      : html`<p class="subtle" style="margin:0" role="status">${misses ? `${misses} essai${misses > 1 ? 's' : ''} sans réussir.` : 'Jouez l’activité comme le ferait un lecteur : le verdict du défi s’affichera ici.'}</p>`}
    <div class="row"><button class="btn" onClick=${() => { setOut(null); setMisses(0); setRun(n => n + 1); }}><${ZI} name="retry" />Recommencer</button>
      <button class="btn primary" onClick=${onClose}>Fermer</button></div>
  <//>`;
}

function IntegreFields({ adv, block: b, set }) {
  const kind = Z.kindOf(b) || 'maze';
  const level = Z.levelOf(b);
  const [trying, setTrying] = useState(false);
  const setLevel = v => set({ activity: { kind, level: v } });
  const setKind = async k => {
    if (k === kind) return;
    const keep = !level || !Object.keys(level).length || await confirmBox('Changer d’activité remplace le niveau par un exemple de la nouvelle activité.', 'Changer d’activité');
    if (keep) set({ activity: { kind: k, level: Z.sampleLevel(k) } });
  };
  const pass = Z.passOf(b);
  const passVal = pass.minScore == null ? '' : String(pass.minScore);
  const opts = PASS_OPTIONS.some(o => o[0] === passVal) ? PASS_OPTIONS : [...PASS_OPTIONS, [passVal, `Score d’au moins ${fr(passVal)}`]];
  const fb = b.fallback && typeof b.fallback === 'object' ? b.fallback : null;
  const setFb = patch => set({ fallback: { mode: 'code', ...(fb || {}), ...patch } });
  return html`<div class="stack zf-integre-ed">
    <div class="grid2">
      <${Select} label="Activité jouée dans le livre" value=${kind} onChange=${setKind} options=${Object.entries(Z.KINDS).map(([k, v]) => [k, v.label])} />
      ${Z.KINDS[kind].stars
        ? html`<${Select} label="Réussite exigée" value=${passVal} onChange=${v => set({ pass: v === '' ? undefined : { ...(b.pass || {}), minScore: Number(v) } })} options=${opts} />`
        : html`<p class="subtle zf-help">La balance Pezali ne donne pas d’étoiles : isoler x suffit à réussir.</p>`}
    </div>
    <${LevelEditor} kind=${kind} level=${level} onChange=${setLevel} />
    <div class="row">
      <button type="button" class="btn" onClick=${() => setTrying(true)} disabled=${Z.checkLevel(kind, level).some(p => p.level === 'error')}><${Icon} name="play" />Essayer l’activité</button>
      <button type="button" class="btn small" onClick=${async () => { if (await confirmBox('Remplacer le niveau par l’exemple ?', 'Remplacer')) setLevel(Z.sampleLevel(kind)); }}>Niveau d’exemple</button>
    </div>
    <p class="subtle zf-help">L’activité vient du paquet zefor (vendor/zefor/), construit à part : il n’est pas dans le dépôt public de Livre-Héros. Sans lui (ou hors ligne avant la première partie), le lecteur voit le repli ci-dessous, ou le bouton « Continuer sans le défi ».</p>
    <fieldset class="zf-codes">
      <legend>Repli si l’activité ne se charge pas <span class="subtle">(recommandé)</span></legend>
      <label class="row"><input type="checkbox" checked=${!!fb} onChange=${e => set({ fallback: e.target.checked ? { mode: 'code', url: '', codeHashes: [] } : undefined })} /> Proposer le parcours zefor974 et un code de secours</label>
      ${fb && html`<${Text} label="Adresse du parcours de secours sur zefor974 (facultatif)" value=${fb.url} onChange=${v => setFb({ url: v.trim() })} placeholder="https://zefor.maths974.fr/…" />
        <${CodesFieldset} adv=${adv} b=${fb} set=${setFb} required />`}
    </fieldset>
    ${trying && html`<${TryActivity} block=${b} onClose=${() => setTrying(false)} />`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Bloc dans l'éditeur                                                 */
/* ------------------------------------------------------------------ */

const MODE_HELP = {
  code: 'Zefor affiche un code quand l’élève réussit ; l’élève le tape dans le livre. Marche partout, même si le parcours est fait sur un autre appareil. Un code peut circuler entre élèves, sauf si vous activez les codes personnels (Règles › Zefor).',
  message: 'Zefor, ouvert par le livre, lui envoie le résultat (postMessage). Aucun code à taper. Il faut indiquer l’origine de Zefor dans Règles › Zefor (sinon celle de l’adresse ci-dessus est utilisée).',
  retour: 'Zefor renvoie l’élève à l’adresse de retour du livre avec son résultat. Aucun code à taper ; pratique sur téléphone. Le résultat passe à l’onglet de l’aventure, ou attend que l’élève reprenne sa partie.',
};

function ZeforEditor({ adv, block: b, set, tgt }) {
  const mode = Z.modeOf(b);
  const integre = mode === 'integre';
  const onMode = v => {
    if (v === 'integre' && !Z.kindOf(b)) set({ mode: v, activity: { kind: 'maze', level: Z.sampleLevel('maze') } });
    else set({ mode: v });
  };
  return html`<div class="stack zf-ed">
    <div class="grid2">
      <${Text} label="Titre du défi" value=${b.title} onChange=${v => set({ title: v })} placeholder="L’épreuve de la balance" />
      ${!integre && html`<${Text} label="Identifiant de l’exercice (facultatif)" value=${b.exercise} onChange=${v => set({ exercise: v.trim() || undefined })} placeholder="pezali:niveau-3" />`}
    </div>
    <${Text} area rows="3" label="Consigne pour le joueur — **gras**, *italique*" value=${b.description} onChange=${v => set({ description: v })} placeholder="Pour franchir le pont, équilibrez la balance du passeur." />
    <${Select} label="Où se joue le défi, et comment le livre apprend la réussite" value=${mode} onChange=${onMode}
      options=${[['integre', 'Dans le livre : activité zefor intégrée (labyrinthe, brume, balance)'], ['code', 'Sur zefor974 : code de réussite tapé par le joueur'], ['message', 'Sur zefor974 : message automatique'], ['retour', 'Sur zefor974 : retour automatique vers le livre']]} />
    ${integre ? html`<${IntegreFields} adv=${adv} block=${b} set=${set} />` : html`<${RemoteFields} adv=${adv} block=${b} set=${set} />`}

    <div class="grid2">
      ${tgt(b.success, v => set({ success: v }), 'Si le défi est réussi, aller au')}
      ${tgt(b.failure, v => set({ failure: v || undefined }), 'Si le défi est raté, aller au (facultatif)')}
    </div>
    <label class="row"><input type="checkbox" checked=${!!b.allowSkip} onChange=${e => set({ allowSkip: e.target.checked })} /> Permettre de continuer sans le défi, contre un prix (utile hors ligne)</label>
    ${b.allowSkip && html`<div class="panel" style="background:var(--surface)">
      <div class="grid2">
        <${Text} label="Texte du bouton" value=${b.skipLabel} placeholder="Continuer sans le défi" onChange=${v => set({ skipLabel: v || undefined })} />
        ${tgt(b.skipTo, v => set({ skipTo: v || undefined }), 'Sans le défi, aller au (vide = comme la réussite)')}
      </div>
      <${EffectsEditor} adv=${adv} value=${b.skipEffects || []} onChange=${v => set({ skipEffects: v })} title="Prix à payer (ex. −1 Chance)" />
    </div>`}
    <details class="panel zf-fx" style="background:var(--surface)"><summary><b>Effets</b> <span class="subtle">— en cas de réussite ou d’échec (facultatif)</span></summary>
      <${EffectsEditor} adv=${adv} value=${b.successEffects || []} onChange=${v => set({ successEffects: v })} title="Effets en cas de réussite (ex. donner un objet)" />
      <${EffectsEditor} adv=${adv} value=${b.failureEffects || []} onChange=${v => set({ failureEffects: v })} title="Effets en cas d’échec" />
    </details>
  </div>`;
}

/** Champs des modes code, message et retour (parcours joué sur zefor974). */
function RemoteFields({ adv, block: b, set }) {
  const mode = Z.modeOf(b);
  const origin = Z.urlOrigin(b.url);
  const preview = Z.buildUrl(b, { nonce: 'NONCE', returnUrl: returnUrl(adv, '<paragraphe>', 0), origin: location.origin });
  return html`
    <${Text} label="Adresse du parcours Zefor" value=${b.url} onChange=${v => set({ url: v.trim() })} placeholder="https://zefor.maths974.fr/…" />
    ${b.url && (origin
      ? html`<span class="subtle">Site : <b>${origin}</b> · <a href=${b.url} target="_blank" rel="noopener">ouvrir l’adresse pour vérifier</a></span>`
      : html`<p class="zf-note ko"><${ZI} name="ko" />Adresse invalide : elle doit commencer par https://</p>`)}
    <div class="grid2">
      ${mode === 'message' && html`<${Select} label="Où s’affiche le parcours" value=${Z.displayOf(b)} onChange=${v => set({ display: v })}
        options=${[['fenetre', 'Dans un nouvel onglet'], ['cadre', 'Dans le paragraphe (cadre, protocole m974)']]} />`}
      <${Num} label="Score minimum (vide = il suffit de réussir)" value=${b.minScore} onChange=${v => set({ minScore: v })} />
    </div>
    <p class="subtle zf-help">${MODE_HELP[mode]}</p>
    <${CodesFieldset} adv=${adv} b=${b} set=${set} required=${mode === 'code'} />
    ${preview && html`<details class="zf-preview"><summary class="subtle">Adresse ouverte pour le joueur (exemple)</summary><code class="zf-mono zf-wrap">${preview}</code></details>`}`;
}

/** Codes de réussite (empreintes) d'un bloc ou d'un repli : `set` fusionne { codeHashes, codeSalt }. */
function CodesFieldset({ adv, b, set, required }) {
  const hashes = Z.hashesOf(b);
  const uid = useUid('zfc');
  const [newCode, setNewCode] = useState('');
  const [probe, setProbe] = useState('');
  const [probeRes, setProbeRes] = useState(null);
  const norm = Z.normalizeCode(newCode);
  const add = async () => {
    if (!norm) return;
    const salt = Z.saltOf(adv, b);
    try {
      const h = await Z.codeHash(salt, norm);
      if (hashes.includes(h)) toast('Ce code est déjà enregistré.');
      else { set({ codeHashes: [...hashes, h], codeSalt: salt }); toast(`Code « ${norm} » enregistré : seule son empreinte est gardée. Notez-le pour Zefor.`); }
      setNewCode('');
    } catch (e) { toast(e.message); }
  };
  const tryCode = async () => {
    try { setProbeRes((await Z.checkCode(adv, b, probe)) ? 'ok' : 'ko'); } catch (e) { toast(e.message); }
  };
  return html`<fieldset class="zf-codes">
      <legend>Codes de réussite ${required ? html`<span class="badge">obligatoire</span>` : html`<span class="subtle">(secours si le résultat n’arrive pas)</span>`}</legend>
      <p class="subtle" style="margin:0">Tapez le code que Zefor affichera à l’élève. Il est aussitôt transformé en empreinte : le code lui-même n’est jamais enregistré dans l’aventure. Notez-le pour le donner à Zefor. Majuscules, espaces et tirets ne comptent pas.</p>
      <div class="row" style="align-items:end">
        <label class="field" for=${uid + '-n'}>Nouveau code<input id=${uid + '-n'} type="text" class="zf-mono" value=${newCode} onInput=${e => setNewCode(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} autocomplete="off" spellcheck="false" placeholder="BRUME-4821" /></label>
        <button type="button" class="btn" disabled=${!norm} onClick=${add}><${ZI} name="key" />Ajouter un code de réussite</button>
      </div>
      ${norm && norm.length < 6 && html`<span class="subtle">Conseil : au moins 6 caractères, pour qu’on ne le devine pas en essayant.</span>`}
      ${hashes.length ? html`<ul class="zf-hashes" aria-label="Codes enregistrés">${hashes.map((h, i) => html`<li key=${h}>
          <${ZI} name="key" /><b>Code n° ${i + 1}</b><span class="mono subtle">empreinte ${h.slice(0, 12)}…</span>
          <button type="button" class="btn small danger" aria-label=${`Supprimer le code n° ${i + 1}`} onClick=${() => set({ codeHashes: hashes.filter(x => x !== h) })}><${Icon} name="trash" /></button>
        </li>`)}</ul>` : html`<span class="subtle">Aucun code enregistré.</span>`}
      ${Z.rulesOf(adv).codeKey && html`<span class="subtle"><${ZI} name="key" /> Les codes personnels sont activés (Règles › Zefor) : ils sont acceptés en plus de ces codes.</span>`}
      ${hashes.length > 0 && html`<div class="row" style="align-items:end">
        <label class="field" for=${uid + '-p'}>Vérifier un code<input id=${uid + '-p'} type="text" class="zf-mono" value=${probe} onInput=${e => { setProbe(e.target.value); setProbeRes(null); }} autocomplete="off" spellcheck="false" /></label>
        <button type="button" class="btn small" disabled=${!probe.trim()} onClick=${tryCode}>Vérifier</button>
        ${probeRes && html`<span class=${'zf-note ' + probeRes} role="status"><${ZI} name=${probeRes} />${probeRes === 'ok' ? 'Ce code est accepté.' : 'Ce code n’est pas enregistré.'}</span>`}
      </div>`}
    </fieldset>`;
}

/* ------------------------------------------------------------------ */
/* Onglet Règles : origine, clé publique, codes personnels             */
/* ------------------------------------------------------------------ */

function ZeforRules({ adv, set }) {
  const z = Z.rulesOf(adv);
  const upd = patch => set({ zefor: { ...z, ...patch } });
  const uid = useUid('zfr');
  const [draft, setDraft] = useState(() => (z.publicKeyJwk ? JSON.stringify(z.publicKeyJwk, null, 2) : ''));
  const [keyMsg, setKeyMsg] = useState(null);
  const [priv, setPriv] = useState(null);
  const count = Object.values(adv.sections).reduce((n, s) => n + (s.blocks || []).filter(b => b.type === Z.TYPE).length, 0);
  const parsed = draft.trim() ? Z.parseJwk(draft) : null;
  const onKey = text => {
    setDraft(text); setKeyMsg(null);
    if (!text.trim()) { upd({ publicKeyJwk: null }); return; }
    const p = Z.parseJwk(text);
    if (p.jwk) {
      upd({ publicKeyJwk: p.jwk });
      if (p.private) setKeyMsg('C’était la clé privée : seule sa partie publique a été gardée. Ne la collez jamais dans une aventure.');
    }
  };
  const gen = async () => {
    try {
      const { publicJwk, privateJwk } = await Z.generateKeyPair();
      upd({ publicKeyJwk: publicJwk });
      setDraft(JSON.stringify(publicJwk, null, 2)); setKeyMsg(null);
      setPriv(JSON.stringify(privateJwk, null, 2));
    } catch (e) { toast(e.message); }
  };
  const back = `${appBase()}#/${Z.ROUTE}/${adv.id}`;
  return html`<details class="panel zf-rules" open=${count > 0}>
    <summary><b>Zefor</b> <span class="subtle">— défis sur zefor974 · ${count ? `${count} défi${count > 1 ? 's' : ''} dans cette aventure` : 'aucun défi pour l’instant'}</span></summary>
    <p class="subtle" style="margin:0">Relie l’aventure à zefor974 : un parcours réussi (exercice, Blokaly, Pezali…) débloque la suite. Ajoutez un bloc « Défi Zefor » dans un paragraphe.</p>
    <${Text} label="Origine autorisée de Zefor (mode message) — une ou plusieurs, séparées par des espaces" value=${z.origin} onChange=${v => upd({ origin: v })} placeholder="https://zefor.maths974.fr" />
    <span class="subtle">Seuls les messages venant de ces adresses sont acceptés. Vide : l’origine de l’adresse de chaque défi.</span>

    <fieldset class="zf-codes">
      <legend>Résultats signés <span class="subtle">(facultatif, modes message et retour)</span></legend>
      <label class="field" for=${uid + '-k'}>Clé publique de Zefor (JWK, ECDSA P-256)
        <textarea id=${uid + '-k'} rows="4" class="zf-mono" value=${draft} onInput=${e => onKey(e.target.value)} placeholder='{"kty":"EC","crv":"P-256","x":"…","y":"…"}' spellcheck="false"></textarea></label>
      ${parsed?.error && parsed.error !== 'vide' && html`<p class="zf-note ko" role="alert"><${ZI} name="ko" />${parsed.error} La clé précédente est conservée.</p>`}
      ${parsed?.jwk && html`<p class="zf-note ok"><${ZI} name="ok" />Clé valide : tout résultat non signé par Zefor sera refusé.</p>`}
      ${keyMsg && html`<p class="zf-note"><${ZI} name="key" />${keyMsg}</p>`}
      <div class="row">
        <button type="button" class="btn small" onClick=${gen}><${ZI} name="key" />Générer une paire de clés de test</button>
        ${z.publicKeyJwk && html`<button type="button" class="btn small danger" onClick=${() => { setDraft(''); upd({ publicKeyJwk: null }); }}>Retirer la clé</button>`}
      </div>
    </fieldset>

    <fieldset class="zf-codes">
      <legend>Codes personnels <span class="subtle">(mode code)</span></legend>
      <label class="row"><input type="checkbox" checked=${!!z.codeKey} onChange=${e => upd({ codeKey: e.target.checked ? Z.newCodeKey() : '' })} /> Chaque partie reçoit son propre code (impossible de se le passer entre élèves)</label>
      ${z.codeKey && html`<div class="stack" style="gap:6px">
        <span class="subtle">Clé secrète à donner à Zefor : il calcule le code de chaque élève à partir du paramètre lh_nonce (voir docs/ZEFOR.md).</span>
        <code class="zf-mono zf-wrap">${z.codeKey}</code>
        <div class="row"><button type="button" class="btn small" onClick=${() => copy(z.codeKey)}><${ZI} name="copy" />Copier la clé</button>
          <button type="button" class="btn small" onClick=${async () => { if (await confirmBox('Changer la clé ? Zefor devra recevoir la nouvelle.', 'Changer la clé')) upd({ codeKey: Z.newCodeKey() }); }}>Nouvelle clé</button></div>
      </div>`}
    </fieldset>

    <div class="stack" style="gap:4px"><span class="subtle">Adresse de retour de cette aventure (Zefor la reçoit dans le paramètre lh_return) :</span>
      <code class="zf-mono zf-wrap">${back}</code></div>
    ${priv && html`<${Modal} title="Clé privée de test pour Zefor" onClose=${() => setPriv(null)}>
      <p style="margin:0">La clé <b>publique</b> est enregistrée dans l’aventure. Voici la clé <b>privée</b> : donnez-la à Zefor pour qu’il signe ses résultats. Livre-Héros ne la garde pas : copiez-la maintenant.</p>
      <label class="field">Clé privée (JWK)<textarea readonly rows="8" class="zf-mono" value=${priv}></textarea></label>
      <p class="subtle" style="margin:0">Ne la mettez jamais dans une aventure ni dans du code envoyé aux élèves : quiconque la possède peut fabriquer des résultats. L’idéal : qu’elle reste sur le serveur de Zefor.</p>
      <div class="row"><button class="btn primary" onClick=${() => copy(priv)}><${ZI} name="copy" />Copier la clé privée</button><button class="btn" onClick=${() => setPriv(null)}>J’ai copié la clé</button></div>
    <//>`}
  </details>`;
}

/* ------------------------------------------------------------------ */
/* Page #/zefor-retour/<aventure>?nonce=…&success=1&score=…&sig=…       */
/* ------------------------------------------------------------------ */

async function pruneOld() {
  try {
    const all = await kvList(Z.KV);
    const limit = Date.now() - 30 * 864e5;
    for (const [k, v] of Object.entries(all)) if ((v?.receivedAt || v?.created || 0) < limit) await kvDelete(k);
  } catch { /* rien à nettoyer */ }
}

async function handleReturn(id, sub, query) {
  // Les paramètres sont normalement après le # ; on accepte aussi ceux placés avant (URL.searchParams côté zefor).
  const params = { ...Object.fromEntries(new URLSearchParams(location.search)), ...(query || {}) };
  const result = Z.parseReturn(params);
  if (!result) return { phase: 'empty' };
  const key = Z.KV + result.nonce;
  let rec = null;
  try { rec = await kvGet(key); } catch { /* stockage indisponible */ }
  const advId = id || rec?.adventureId || '';
  let adv = null;
  if (advId) { try { adv = (await loadAdventure(advId)).adventure; } catch { /* aventure absente de ce navigateur */ } }
  const jwk = adv ? Z.parseJwk(Z.rulesOf(adv).publicKeyJwk || '').jwk : null;
  if (adv && Z.rulesOf(adv).publicKeyJwk) {
    const good = !!result.signature && !!jwk && await Z.verifySignature(jwk, result);
    if (!good) return { phase: 'refused', reason: result.signature ? 'signature' : 'unsigned', result, advId, adv };
  }
  try { await kvPut(key, { ...(rec || {}), adventureId: advId || null, result, receivedAt: Date.now() }); } catch { /* l'onglet ouvert recevra quand même le message */ }
  try { const ch = new BroadcastChannel(Z.CHANNEL); ch.postMessage(Z.toMessage(result)); ch.close(); } catch { /* navigateur sans BroadcastChannel */ }
  pruneOld();
  // Aucune partie de ce navigateur n'attend ce résultat : code de transfert à taper dans la partie (si l'aventure le permet).
  const code = !rec && adv ? await Z.transferCode(adv, sub, result).catch(() => null) : null;
  return { phase: 'done', result, advId, adv, known: !!rec, code };
}

function ReturnPage({ id, sub, query }) {
  const [view, setView] = useState({ phase: 'work' });
  useEffect(() => {
    let alive = true;
    handleReturn(id, sub, query).then(v => alive && setView(v)).catch(e => alive && setView({ phase: 'error', text: e.message }));
    return () => { alive = false; };
  }, []);
  const close = () => { window.close(); setTimeout(() => { if (!window.closed) toast('Fermez cet onglet vous-même, puis revenez à votre aventure.'); }, 300); };
  const r = view.result;
  const playHref = view.advId ? `#/jouer/${encodeURIComponent(view.advId)}` : '#/';
  const outcome = r && html`<div class=${'zf-result ' + (r.success ? 'ok' : 'ko')} role="status"><${ZI} name=${r.success ? 'ok' : 'ko'} />
    <div><b class="zf-big">${r.success ? 'Parcours réussi' : 'Parcours non réussi'}</b>
      ${r.score != null && html`<span>Score : <b class="mono">${fr(r.score)}</b></span>`}
      ${r.exercise && html`<span class="subtle">Exercice : ${r.exercise}</span>`}</div></div>`;
  let body;
  if (view.phase === 'work') body = html`<p class="muted" role="status">Transmission du résultat…</p>`;
  else if (view.phase === 'empty') body = html`<h1>Aucun résultat à transmettre</h1>
    <p>Cette page reçoit les résultats de Zefor, mais son adresse ne contient pas de résultat lisible (paramètre « nonce » manquant).</p>
    <div class="row"><a class="btn primary" href="#/">Bibliothèque</a></div>`;
  else if (view.phase === 'error') body = html`<h1>Transmission impossible</h1><p>${view.text}</p><div class="row"><a class="btn primary" href="#/">Bibliothèque</a></div>`;
  else if (view.phase === 'refused') body = html`<h1>Résultat refusé</h1>${outcome}
    <p class="zf-note ko" role="alert"><${ZI} name="ko" />${Z.REASONS[view.reason]}. Ce résultat n’a pas été transmis à l’aventure.</p>
    <p>Recommencez le parcours depuis votre aventure. Si le problème continue, prévenez votre professeur.</p>
    <div class="row"><a class="btn primary" href=${playHref}>Retourner à l’aventure</a></div>`;
  else body = html`<h1>Résultat transmis, retournez à votre aventure</h1>${outcome}
    ${view.known && html`<p>${view.adv ? `Votre aventure « ${view.adv.meta.title} » a reçu ce résultat. ` : 'Le résultat a été enregistré dans ce navigateur. '}${'Si elle est ouverte dans un autre onglet, revenez-y : la suite se débloque toute seule. Sinon, reprenez votre partie.'}</p>`}
    ${!view.known && (view.code
      ? html`<div class="zf-transfer" role="status"><span>Votre aventure${view.adv ? ` « ${view.adv.meta.title} »` : ''} est ouverte dans une autre application ou un autre navigateur : dans le défi, ouvrez « Zefor vous a donné un code ? » et tapez ce code de transfert :</span>
          <b class="zf-transfer-code mono" aria-label=${'Code de transfert : ' + view.code.split('').join(' ')}>${Z.formatPersonal(view.code)}</b></div>`
      : html`<p class="zf-note"><${ZI} name="wait" />Aucune partie de ce navigateur n’attendait ce résultat. Si votre aventure est ouverte sur un autre appareil, il ne peut pas lui parvenir : demandez plutôt un code de réussite.</p>`)}
    <div class="row"><a class="btn primary" href=${playHref}><${Icon} name="play" />${view.advId ? 'Retourner à l’aventure' : 'Bibliothèque'}</a>
      <button class="btn" onClick=${close}><${Icon} name="x" />Fermer cet onglet</button></div>`;
  return html`<main class="page zf-return" lang="fr"><div class="zf-return-card">
    <span class="eyebrow"><${ZI} name="zefor" /> Zefor → Livre-Héros</span>
    ${body}
  </div></main>`;
}

/* ------------------------------------------------------------------ */
/* Fin de partie et version imprimable                                 */
/* ------------------------------------------------------------------ */

function ZeforSummary({ state }) {
  const { list, ok, total } = Z.summary(state);
  if (!total) return null;
  return html`<div class="zf-summary" lang="fr">
    <h3><${ZI} name="zefor" />Défis Zefor : ${ok} réussi${ok > 1 ? 's' : ''} sur ${total}</h3>
    <ul>${list.map(d => html`<li class=${d.ok ? 'ok' : 'ko'}><${ZI} name=${d.ok ? 'ok' : 'ko'} />
      <span>${d.title || `Défi du paragraphe ${d.section}`} — ${d.ok ? 'réussi' : d.via}${d.score != null ? ` (score ${fr(d.score)})` : ''}</span></li>`)}</ul>
  </div>`;
}

const zeforBlocks = adv => Object.entries(adv.sections).flatMap(([id, s]) => (s.blocks || []).filter(b => b.type === Z.TYPE).map(b => ({ id, b })));

registerBlockUI(Z.TYPE, {
  label: 'Défi Zefor',
  icon: 'zefor',
  order: 40,
  create: () => ({ title: '', description: '', url: '', mode: 'code', codeHashes: [], success: '', failure: '' }),
  Player: BlockPlayer,
  Editor: ZeforEditor,
});
registerRulesSection({ id: 'zefor', order: 40, Section: ZeforRules });
registerRoute(Z.ROUTE, ReturnPage);
registerEndingPanel({ id: 'zefor', order: 40, Panel: ZeforSummary });
registerPrintSection({ where: 'rules', order: 40, Section: ({ adv }) => {
  const list = zeforBlocks(adv);
  if (!list.length) return null;
  const inApp = list.some(({ b }) => Z.isIntegre(b));
  return html`<h3>Les défis Zefor</h3>
  <p>Certains passages de ce livre vous demandent de relever un défi sur zefor974, la plateforme d’exercices de Maths974 : calcul, énigme de logique, programme Blokaly, balance Pezali… Ouvrez l’adresse indiquée, réussissez le parcours, notez le code obtenu dans la case « Codes des défis Zefor » de votre Feuille d’Aventure, puis rendez-vous au paragraphe indiqué.</p>
  ${inApp && html`<p>D’autres défis se jouent directement dans l’application Livre-Héros. Sur papier, suivez les indications du paragraphe : parcours de secours et code, ou renoncement au défi.</p>`}`;
} });
registerPrintSection({ where: 'sheet', order: 40, Section: ({ adv }) => {
  // Un défi intégré n'a de code à noter que s'il a un repli.
  const list = zeforBlocks(adv).filter(({ b }) => !Z.isIntegre(b) || Z.fallbackBlock(b));
  return list.length ? html`<div class="pr-box pr-wide zf-pr-codes"><b>CODES DES DÉFIS ZEFOR</b>
    ${list.map(({ id, b }) => html`<div class="zf-pr-line"><span>Paragraphe ${id}${b.title ? ` — ${b.title}` : ''} :</span><span class="zf-pr-blank"></span></div>`)}</div>` : null;
} });
