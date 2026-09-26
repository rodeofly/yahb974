// Greffon « défis » — interface : bloc jouable, formulaire de l'éditeur, feuille d'aventure, fin de partie, impression.
// Le moteur (vérification des réponses, essais, indices, chiffrement) est dans ./core.js. Voir docs/plugins/defis.md.

import { html, useState, useEffect, useRef, useMemo } from '../../lib/preact-htm.js';
import { Icon, Prose, AssetImg, markdown, confirmBox, toast, loadCSS } from '../../ui/common.js';
import { registerBlockUI, registerSheetPanel, registerEndingPanel, registerPrintSection } from '../../ui/registry.js';
import { registerBlock, ext } from '../../core/plugins.js';
import { describeEffect, statLabel, de } from '../../core/rules.js';
import { Continue } from '../../ui/play.js';
import { Text, Num, EffectsEditor, ImageSlot } from '../../ui/editor.js';
import { sfx } from '../../ui/audio.js';
import { assetUrl } from '../../store/library.js';
import * as D from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ---------- petites icônes propres au greffon (traits, comme celles de common.js) ---------- */
const PATHS = {
  quest: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1-1.3 1.9v.5"/><circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/>',
};
const Ico = ({ name }) => html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] }}></svg>`;

/** Markdown sur une ligne (propositions, éléments à ordonner) : formules comprises, sans paragraphe englobant. */
const inline = s => markdown(String(s ?? '')).replace(/^<p>([\s\S]*)<\/p>$/, '$1');
/** Formule LaTeX lue à voix haute en français : \frac{1}{2} → « 1 sur 2 », x^2 → « x au carré », - → « moins ». */
const TEX_WORDS = {
  times: 'fois', cdot: 'fois', div: 'divisé par', leq: 'inférieur ou égal à', le: 'inférieur ou égal à', geq: 'supérieur ou égal à',
  ge: 'supérieur ou égal à', neq: 'différent de', ne: 'différent de', approx: 'environ égal à', pm: 'plus ou moins', pi: 'pi',
  infty: 'infini', degree: 'degrés', circ: 'degrés', percent: 'pour cent', ldots: 'etc.', cdots: 'etc.', dots: 'etc.',
  left: '', right: '', displaystyle: '', text: '', mathrm: '', mathbf: '', quad: '', qquad: '',
};
export function texToFrench(tex) {
  let s = String(tex ?? '');
  for (let i = 0; i < 6; i++) {
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 sur $2 ').replace(/\\[dt]?frac\s*(\w)\s*(\w)/g, ' $1 sur $2 ')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' racine carrée de $1 ');
  }
  s = s.replace(/\^\s*(?:\{\s*2\s*\}|2(?!\d))/g, ' au carré ').replace(/\^\s*(?:\{\s*3\s*\}|3(?!\d))/g, ' au cube ')
    .replace(/\^\s*\{([^{}]*)\}/g, ' puissance $1 ').replace(/\^\s*(-?\w)/g, ' puissance $1 ')
    .replace(/_\s*\{([^{}]*)\}/g, ' indice $1 ').replace(/_\s*(\w)/g, ' indice $1 ')
    .replace(/\\([a-zA-Z]+)/g, (m, w) => ` ${w in TEX_WORDS ? TEX_WORDS[w] : w} `)
    .replace(/\\[,;:! ]|~/g, ' ').replace(/[{}]/g, ' ')
    .replace(/\s*=\s*/g, ' égale ').replace(/\s*\+\s*/g, ' plus ').replace(/\s*[-−]\s*/g, ' moins ')
    .replace(/\s*<\s*/g, ' inférieur à ').replace(/\s*>\s*/g, ' supérieur à ').replace(/\s*\*\s*/g, ' fois ');
  return s.replace(/\s+/g, ' ').trim();
}
/** Texte brut pour les libellés accessibles et les annonces : les formules sont dites en français. */
const plain = s => String(s ?? '').replace(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g, (m, a, b) => ` ${texToFrench(a ?? b)} `)
  .replace(/[*_`$\\]/g, '').replace(/\s+/g, ' ').trim();
/** Coût d'un indice, sans signe : « 1 pièce d’or », « 1 point de Chance » (le mot « Coût » dit déjà qu'on paie). */
function costText(e, adv) {
  const n = Math.abs(Number(e?.add));
  if (e?.op === 'gold' && Number.isFinite(n) && !e.if) return `${n} ${n > 1 ? 'pièces' : 'pièce'} d’or`;
  if (e?.op === 'provisions' && Number.isFinite(n) && !e.if) return `${n} repas`;
  if (e?.op === 'stat' && e.add !== undefined && e.set === undefined && !e.addInitial && Number.isFinite(n) && !e.if) return `${n} ${n > 1 ? 'points' : 'point'} ${de(statLabel(adv, e.stat), '’')}`;
  return describeEffect(e, adv);
}
const uidOf = p => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const KIND_HINT = {
  text: 'Écrivez votre réponse',
  number: 'Répondez par un nombre',
  qcm: 'Une seule bonne réponse',
  multi: 'Plusieurs bonnes réponses possibles',
  order: 'Remettez dans le bon ordre',
};
const KIND_OPTIONS = [
  ['text', 'Réponse à écrire (mot, phrase, expression)'],
  ['number', 'Nombre'],
  ['qcm', 'QCM : une seule bonne réponse'],
  ['multi', 'Cases à cocher : plusieurs bonnes réponses'],
  ['order', 'Remettre dans l’ordre'],
];

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

function Tries({ max, used }) {
  const left = Math.max(0, max - used);
  return html`<span class="defi-tries">
    ${max <= 10 && html`<span class="defi-pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => html`<i class=${i < used ? 'used' : ''}></i>`)}</span>`}
    ${plural(left, 'essai restant', 'essais restants')}
  </span>`;
}

function ChallengePlayer({ adv, source, state, index, block: b, update, go }) {
  const kind = D.kindOf(b);
  const bs = D.blockState(state, adv, index);
  const done = D.isFinished(bs);
  const uid = useMemo(() => uidOf('defi'), []);
  const items = kind === 'order' ? D.orderItems(b) : [];
  const opts = kind === 'qcm' || kind === 'multi' ? D.options(b) : [];
  const lastIn = bs.last?.input;
  const [text, setText] = useState(() => (done && (kind === 'text' || kind === 'number') ? String(lastIn ?? '') : ''));
  const [choice, setChoice] = useState(() => (kind === 'qcm' && lastIn != null && lastIn !== '' ? Number(lastIn) : null));
  const [picked, setPicked] = useState(() => (kind === 'multi' && Array.isArray(lastIn) ? lastIn.map(Number) : []));
  const [order, setOrder] = useState(() => {
    if (kind !== 'order') return [];
    if (Array.isArray(lastIn) && lastIn.length === items.length) return lastIn.map(Number);
    return bs.order?.length === items.length ? bs.order : items.map((_, i) => i);
  });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [focusReq, setFocusReq] = useState(null);
  const alive = useRef(true);
  const inputRef = useRef();
  const listRef = useRef();
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!focusReq || !listRef.current) return;
    const li = listRef.current.querySelector(`li[data-pos="${focusReq.pos}"]`);
    let btn = li?.querySelector(`button[data-dir="${focusReq.dir}"]`);
    if (!btn || btn.disabled) btn = li?.querySelector('button:not([disabled])');
    btn?.focus();
  }, [focusReq]);

  const input = kind === 'qcm' ? choice : kind === 'multi' ? picked : kind === 'order' ? order : text;
  const ready = kind === 'qcm' ? choice !== null : kind === 'multi' ? picked.length > 0 : kind === 'order' ? order.length > 1 : text.trim() !== '';
  const edit = fn => (...a) => { setNotice(''); fn(...a); };

  const send = async e => {
    e?.preventDefault?.();
    if (busy || done || !ready) return;
    setBusy(true);
    try {
      const r = await D.submitAsync(state, adv, index, input);
      if (!alive.current) return;
      if (!r.counted) { setNotice(r.feedback); return; }
      setNotice('');
      sfx.luck(r.correct);
      update(r.state, r.messages.filter(m => !m.verdict));
      if (!r.correct && !r.finished && inputRef.current) { inputRef.current.focus(); inputRef.current.select?.(); }
    } catch (err) { toast(err.message); } finally { if (alive.current) setBusy(false); }
  };

  const hint = D.nextHint(state, adv, index);
  const hintWhy = hint ? D.cannotAfford(state, adv, hint.cost || []) : null;
  const askHint = async () => {
    if (!hint || hintWhy) return;
    if (D.isFatal(state, adv, hint.cost || []) && !(await confirmBox('Payer cet indice vous coûterait la vie. Le demander quand même ?', 'Lire l’indice'))) return;
    const r = D.useHint(state, adv, index);
    sfx.page();
    update(r.state, r.messages.filter(m => !m.verdict));
  };
  const abandon = async () => {
    if (!(await confirmBox(b.failure ? `Renoncer à ce défi ? Vous irez au paragraphe ${b.failure}.` : 'Renoncer à ce défi ?', 'Renoncer'))) return;
    const r = D.giveUp(state, adv, index);
    sfx.luck(false);
    update(r.state, r.messages.filter(m => !m.verdict));
  };
  const move = (pos, d) => {
    const to = pos + d;
    if (done || to < 0 || to >= order.length) return;
    const next = [...order];
    [next[pos], next[to]] = [next[to], next[pos]];
    setOrder(next); setNotice('');
    setFocusReq({ pos: to, dir: d < 0 ? 'up' : 'down', t: Date.now() });
    setAnnounce(`« ${plain(items[next[to]])} » est maintenant en position ${to + 1} sur ${next.length}.`);
  };

  const max = D.maxAttempts(b);
  const v = notice ? { tone: 'info', text: notice } : D.verdict(b, bs);
  const dest = done ? (bs.solved ? b.success : b.failure) : null;
  const hasChoices = (adv.sections[state.section]?.choices || []).length > 0;
  const reveal = done && !bs.solved && !!b.revealAnswer && !D.isHashed(b);
  const hints = b.hints || [];
  const tried = kind === 'qcm' ? new Set(bs.wrong || []) : new Set();

  // Marques affichées sur les propositions (coche / croix + texte : jamais la couleur seule).
  const mark = (i, chosen) => {
    const good = opts[i]?.correct;
    if (done && bs.solved && chosen) return { cls: 'good', icon: 'check', text: 'bonne réponse' };
    if (reveal && good) return { cls: 'good', icon: 'check', text: 'bonne réponse' };
    if (done && !bs.solved && chosen && (reveal || kind === 'qcm')) return { cls: 'bad', icon: 'x', text: kind === 'multi' ? 'à ne pas cocher' : 'votre choix' };
    if (!done && kind === 'qcm' && tried.has(String(i))) return { cls: 'bad', icon: 'x', text: 'déjà essayé' };
    return null;
  };

  let field = null;
  if (kind === 'text') field = html`<label class="field" for=${uid + '-in'}>Votre réponse
    <input ref=${inputRef} type="text" id=${uid + '-in'} class="defi-input" value=${text} disabled=${done}
      autocomplete="off" autocapitalize="off" spellcheck=${false} onInput=${edit(e => setText(e.target.value))} /></label>`;
  if (kind === 'number') field = html`<div class="field">
    <label for=${uid + '-in'}>Votre réponse</label>
    <div class="row defi-numrow">
      <input ref=${inputRef} type="text" inputmode="decimal" id=${uid + '-in'} class="defi-input defi-num" value=${text} disabled=${done}
        autocomplete="off" aria-describedby=${uid + '-nh'} onInput=${edit(e => setText(e.target.value))} />
      ${b.unit && html`<span class="defi-unit">${b.unit}</span>`}
      ${!done && html`<button type="button" class="btn small" aria-label="Changer le signe (plus ou moins)" title="Changer le signe"
        onClick=${edit(() => setText(t => (t.trim().startsWith('-') || t.trim().startsWith('−') ? t.trim().slice(1) : '-' + t.trim())))}>±</button>`}
    </div>
    <span class="subtle" id=${uid + '-nh'}>Virgule ou point pour les décimales (3,5 ou 3.5).</span>
  </div>`;
  if (kind === 'qcm' || kind === 'multi') field = html`<fieldset class="defi-opts" disabled=${done}>
    <legend class="defi-sr">${kind === 'qcm' ? 'Choisissez une seule réponse' : 'Cochez toutes les bonnes réponses'}</legend>
    ${opts.map((o, i) => {
      const chosen = kind === 'qcm' ? choice === i : picked.includes(i);
      const m = mark(i, chosen);
      return html`<label class=${'defi-opt' + (m ? ' ' + m.cls : '')} key=${i}>
        ${kind === 'qcm'
          ? html`<input type="radio" name=${uid} value=${i} checked=${chosen} onChange=${edit(() => setChoice(i))} />`
          : html`<input type="checkbox" value=${i} checked=${chosen} onChange=${edit(e => setPicked(p => (e.target.checked ? [...new Set([...p, i])] : p.filter(x => x !== i))))} />`}
        <span class="defi-letter" aria-hidden="true">${D.letter(i)}</span>
        <span class="defi-otext" dangerouslySetInnerHTML=${{ __html: inline(o.text) }}></span>
        ${m ? html`<span class=${'defi-mark ' + m.cls}><${Icon} name=${m.icon} />${m.text}</span>` : html`<span></span>`}
      </label>`;
    })}
  </fieldset>`;
  if (kind === 'order') field = html`<div class="stack" style="gap:6px">
    ${!done && html`<p class="subtle" id=${uid + '-oh'} style="margin:0">Du premier (en haut) au dernier (en bas) : déplacez les éléments avec les boutons fléchés ↑ (monter) et ↓ (descendre).</p>`}
    <ol class="defi-order" ref=${listRef} aria-label="Éléments à remettre dans l’ordre">
      ${order.map((k, pos) => html`<li key=${k} data-pos=${pos}>
        <span class="defi-pos" aria-hidden="true">${pos + 1}</span>
        <span class="defi-otext" dangerouslySetInnerHTML=${{ __html: inline(items[k]) }}></span>
        ${!done ? html`<span class="defi-moves">
          <button type="button" class="btn small" data-dir="up" disabled=${pos === 0} aria-label=${`Monter « ${plain(items[k])} » (position ${pos + 1})`} onClick=${() => move(pos, -1)}><${Icon} name="up" /><span class="defi-lbl">Monter</span></button>
          <button type="button" class="btn small" data-dir="down" disabled=${pos === order.length - 1} aria-label=${`Descendre « ${plain(items[k])} » (position ${pos + 1})`} onClick=${() => move(pos, 1)}><${Icon} name="down" /><span class="defi-lbl">Descendre</span></button>
        </span>` : html`<span></span>`}
      </li>`)}
    </ol>
    <p class="defi-sr" aria-live="polite">${announce}</p>
  </div>`;

  return html`<section class="block defi" aria-labelledby=${uid + '-t'}>
    <h3 id=${uid + '-t'}><${Ico} name="quest" />${b.title || 'Défi'}</h3>
    <p class="defi-kind subtle">${KIND_HINT[kind]} · ${max ? plural(max, 'essai', 'essais') : 'essais illimités'}${hints.length ? ` · ${plural(hints.length, 'indice', 'indices')}` : ''}</p>
    ${b.image && html`<figure class="illus defi-fig"><${AssetImg} adv=${adv} source=${source} path=${b.image} alt=${b.title ? `Figure : ${b.title}` : 'Figure du défi'} /></figure>`}
    ${String(b.question || '').trim() && html`<${Prose} text=${b.question} />`}
    <form class="defi-form" onSubmit=${send}>
      ${field}
      ${!done && html`<div class="row">
        <button type="submit" class="btn primary" disabled=${!ready || busy}><${Icon} name="check" />${busy ? 'Vérification…' : 'Valider'}</button>
        ${max > 0 && html`<${Tries} max=${max} used=${bs.tries} />`}
      </div>`}
    </form>
    <div class=${'defi-feedback' + (v ? ' ' + v.tone : '')} role="status" aria-live="polite">
      ${v && html`<${v.tone === 'info' ? Ico : Icon} name=${v.tone === 'ok' ? 'check' : v.tone === 'ko' ? 'x' : 'info'} /><span>${v.text}</span>`}
    </div>
    ${hints.length > 0 && (bs.hints.length > 0 || hint) && html`<div class="defi-hints">
      ${bs.hints.map(k => html`<div class="defi-hint" key=${k}><${Ico} name="bulb" />
        <div><b>Indice ${k + 1}</b><div class="defi-hint-text" dangerouslySetInnerHTML=${{ __html: markdown(hints[k]?.text || '') }}></div></div></div>`)}
      ${hint && html`<div class="row">
        <button type="button" class="btn small" disabled=${!!hintWhy} onClick=${askHint}><${Ico} name="bulb" />${bs.hints.length ? 'Un autre indice' : 'Demander un indice'} (${hint.index + 1} sur ${hints.length})</button>
        <span class="subtle">${(hint.cost || []).length ? `Coût : ${hint.cost.map(e => costText(e, adv)).join(', ')}` : 'Gratuit'}</span>
        ${hintWhy && html`<span class="subtle row" style="gap:4px"><${Icon} name="lock" />${hintWhy}</span>`}
      </div>`}
    </div>`}
    ${!done && b.allowGiveUp && html`<div><button type="button" class="btn small ghost defi-giveup" onClick=${abandon}>Renoncer à ce défi</button></div>`}
    ${reveal && html`<${Reveal} b=${b} kind=${kind} items=${items} />`}
    ${done && String(b.explanation || '').trim() && html`<div class="defi-explain"><span class="eyebrow">Explication</span><${Prose} text=${b.explanation} /></div>`}
    ${done && !state.ended && (dest ? html`<div><${Continue} to=${dest} go=${go} /></div>` : hasChoices ? html`<p class="subtle" style="margin:0">Poursuivez avec les choix ci-dessous.</p>` : null)}
  </section>`;
}

/** Bonne réponse montrée après un échec (si l'auteur l'a demandé). */
function Reveal({ b, kind, items }) {
  if (kind === 'order') return html`<div class="defi-reveal"><span class="eyebrow">Le bon ordre</span>
    <ol>${items.map(t => html`<li dangerouslySetInnerHTML=${{ __html: inline(t) }}></li>`)}</ol></div>`;
  if (kind === 'qcm' || kind === 'multi') return html`<p class="defi-reveal subtle" style="margin:0"><${Icon} name="check" /> Les bonnes réponses sont marquées « bonne réponse ».</p>`;
  return html`<div class="defi-reveal"><span class="eyebrow">Réponse attendue</span><span>${D.solutionText(b)}</span></div>`;
}

/* ------------------------------------------------------------------ */
/* Éditeur                                                             */
/* ------------------------------------------------------------------ */

const Preview = ({ text, label }) => html`<div class="defi-preview" role="group" aria-label=${label}>
  <span class="eyebrow">Aperçu</span><${Prose} text=${text} /></div>`;

/** Champ décimal qui accepte la virgule (3,5) ; transmet un nombre dès que la saisie est lisible. */
function DecimalField({ label, value, onChange }) {
  const id = useMemo(() => uidOf('dec'), []);
  const [raw, setRaw] = useState(value == null ? '' : D.frNumber(value));
  useEffect(() => { if (D.parseNumber(raw) !== Number(value)) setRaw(value == null ? '' : D.frNumber(value)); }, [value]);
  const bad = raw.trim() !== '' && !Number.isFinite(D.parseNumber(raw));
  return html`<label class="field" for=${id}>${label}
    <input type="text" inputmode="decimal" id=${id} class="mono" value=${raw} aria-invalid=${bad ? 'true' : undefined}
      onInput=${e => { const t = e.target.value; setRaw(t); const n = D.parseNumber(t); if (Number.isFinite(n)) onChange(n); }} />
    ${bad && html`<span class="defi-warn"><${Icon} name="x" />nombre illisible</span>`}</label>`;
}

/** Boutons Monter / Descendre / Retirer d'une ligne de liste. */
function LineTools({ list, j, setList, what, min = 0 }) {
  const mv = d => { const k = j + d; if (k < 0 || k >= list.length) return; const n = [...list]; [n[j], n[k]] = [n[k], n[j]]; setList(n); };
  return html`<span class="row defi-linetools" style="gap:4px">
    <button type="button" class="btn small" disabled=${j === 0} aria-label=${`Monter ${what}`} onClick=${() => mv(-1)}><${Icon} name="up" /></button>
    <button type="button" class="btn small" disabled=${j === list.length - 1} aria-label=${`Descendre ${what}`} onClick=${() => mv(1)}><${Icon} name="down" /></button>
    <button type="button" class="btn small danger" disabled=${list.length <= min} aria-label=${`Retirer ${what}`} onClick=${() => setList(list.filter((_, k) => k !== j))}><${Icon} name="x" /></button>
  </span>`;
}

function TextAnswers({ b, set }) {
  const list = D.textAnswers(b);
  const setList = l => set({ answers: l });
  return html`<p class="subtle" style="margin:0">Le joueur doit écrire l'une de ces réponses. Majuscules, accents, espaces en trop et ponctuation finale ne comptent pas.</p>
    ${list.map((a, j) => html`<div class="rowline defi-ed-line" key=${j}>
      <${Text} label=${`Réponse acceptée ${j + 1}`} value=${a} onChange=${v => setList(list.map((x, k) => (k === j ? v : x)))} />
      <span class="subtle defi-norm">${a.trim() ? `comparée sous la forme « ${D.normalizeText(a, b)} »` : ''}</span>
      <${LineTools} list=${list} j=${j} setList=${setList} what=${`la réponse ${j + 1}`} min=${1} />
    </div>`)}
    <div><button type="button" class="btn small" onClick=${() => setList([...list, ''])}><${Icon} name="plus" />Autre réponse acceptée</button></div>
    <label class="row subtle"><input type="checkbox" checked=${!!b.ignoreSpaces} onChange=${e => set({ ignoreSpaces: e.target.checked })} /> Ignorer toutes les espaces (pour une expression : « 2x + 3 » = « 2x+3 »)</label>`;
}

function NumberAnswers({ b, set }) {
  const list = D.numberAnswers(b);
  const rows = list.length ? list : [{ value: 0, tolerance: 0 }];
  const setRows = r => set({ answers: r.length === 1 ? r[0] : r });
  return html`<p class="subtle" style="margin:0">Le joueur peut écrire 3,5 ou 3.5, avec des espaces (1 000). Une tolérance accepte les valeurs approchées.</p>
    ${rows.map((x, j) => html`<div class="rowline defi-ed-line defi-ed-num" key=${j}>
      <${DecimalField} label=${rows.length > 1 ? `Valeur acceptée ${j + 1}` : 'Valeur attendue'} value=${x.value} onChange=${v => setRows(rows.map((y, k) => (k === j ? { ...y, value: v } : y)))} />
      <${DecimalField} label="Tolérance (0 = exacte)" value=${x.tolerance} onChange=${v => setRows(rows.map((y, k) => (k === j ? { ...y, tolerance: Math.abs(v) } : y)))} />
      <span class="subtle defi-norm">${x.tolerance ? `Accepté de ${D.frNumber(+(x.value - x.tolerance).toPrecision(12))} à ${D.frNumber(+(x.value + x.tolerance).toPrecision(12))}.` : 'Valeur exacte.'}</span>
      <${LineTools} list=${rows} j=${j} setList=${setRows} what=${`la valeur ${j + 1}`} min=${1} />
    </div>`)}
    <div><button type="button" class="btn small" onClick=${() => setRows([...rows, { value: 0, tolerance: 0 }])}><${Icon} name="plus" />Autre valeur acceptée</button></div>`;
}

function OptionAnswers({ b, set, kind }) {
  const list = D.options(b);
  const name = useMemo(() => uidOf('good'), []);
  const setList = l => set({ answers: l });
  return html`<p class="subtle" style="margin:0">${kind === 'qcm' ? 'Cochez la seule bonne réponse.' : 'Cochez toutes les bonnes réponses : le joueur doit cocher exactement celles-là.'} Le joueur voit les propositions dans cet ordre, repérées par A, B, C…</p>
    ${list.map((o, j) => html`<div class="rowline defi-ed-line defi-ed-opt" key=${j}>
      <span class="defi-letter" aria-hidden="true">${D.letter(j)}</span>
      <${Text} label=${`Proposition ${D.letter(j)}`} value=${o.text} onChange=${v => setList(list.map((x, k) => (k === j ? { ...x, text: v } : x)))} />
      <label class="chk"><input type=${kind === 'qcm' ? 'radio' : 'checkbox'} name=${name} checked=${o.correct}
        onChange=${e => setList(list.map((x, k) => (kind === 'qcm' ? { ...x, correct: k === j } : k === j ? { ...x, correct: e.target.checked } : x)))} /> Bonne réponse</label>
      <${LineTools} list=${list} j=${j} setList=${setList} what=${`la proposition ${D.letter(j)}`} min=${2} />
    </div>`)}
    <div><button type="button" class="btn small" onClick=${() => setList([...list, { text: '', correct: false }])}><${Icon} name="plus" />Proposition</button></div>`;
}

function OrderAnswers({ b, set }) {
  const list = D.orderItems(b);
  const setList = l => set({ answers: l });
  return html`<p class="subtle" style="margin:0">Écrivez les éléments dans le <b>bon</b> ordre, du premier au dernier : ils seront mélangés pour le joueur (différemment à chaque partie).</p>
    ${list.map((t, j) => html`<div class="rowline defi-ed-line defi-ed-opt" key=${j}>
      <span class="defi-pos" aria-hidden="true">${j + 1}</span>
      <${Text} label=${`Élément ${j + 1}`} value=${t} onChange=${v => setList(list.map((x, k) => (k === j ? v : x)))} />
      <span></span>
      <${LineTools} list=${list} j=${j} setList=${setList} what=${`l'élément ${j + 1}`} min=${2} />
    </div>`)}
    <div><button type="button" class="btn small" onClick=${() => setList([...list, ''])}><${Icon} name="plus" />Élément</button></div>`;
}

/** Réponses chiffrées : illisibles ; on peut en retirer ou en ajouter (chiffrées dès la saisie). */
function HashedAnswers({ adv, b, set, kind }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useMemo(() => uidOf('hash'), []);
  const list = D.hashList(b);
  const add = async e => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const h = await D.hashOne(b, adv, draft);
      if (!h) { toast(kind === 'number' ? 'Écrivez un nombre lisible (par exemple 3,5).' : 'Écrivez une réponse.'); return; }
      if (list.includes(h)) toast('Cette réponse est déjà acceptée.');
      else { set({ answers: [...list, h] }); toast('Réponse chiffrée et ajoutée.'); }
      setDraft('');
    } finally { setBusy(false); }
  };
  return html`<div class="defi-locked">
    <p class="row" style="margin:0;gap:6px"><${Icon} name="lock" /><b>${plural(list.length, 'réponse chiffrée', 'réponses chiffrées')}</b></p>
    <p class="subtle" style="margin:0">Elles ne sont plus lisibles, ni dans le fichier ni ici : l'application compare l'empreinte de la réponse du joueur à celles-ci.</p>
    <ul class="defi-hashes">${list.map((h, j) => html`<li key=${h}>
      <span class="mono" title=${h}>${h.slice(0, 10)}…${h.slice(-4)}</span>
      <button type="button" class="btn small danger" aria-label=${`Retirer la réponse chiffrée n° ${j + 1}`} disabled=${list.length < 2} onClick=${() => set({ answers: list.filter((_, k) => k !== j) })}><${Icon} name="x" /></button>
    </li>`)}</ul>
    <form class="row defi-addhash" onSubmit=${add}>
      <label class="field" for=${id}>Ajouter une réponse acceptée (chiffrée dès la saisie)
        <input type="text" id=${id} inputmode=${kind === 'number' ? 'decimal' : undefined} autocomplete="off" value=${draft} onInput=${e => setDraft(e.target.value)} /></label>
      <button class="btn small" disabled=${!draft.trim() || busy}><${Icon} name="lock" />Chiffrer et ajouter</button>
    </form>
  </div>`;
}

function Crypt({ adv, b, onChange, kind }) {
  const [busy, setBusy] = useState(false);
  const hashed = D.isHashed(b);
  const can = D.HASHABLE.has(kind);
  const tol = kind === 'number' && !hashed && D.numberAnswers(b).some(x => x.tolerance);
  const toggle = async on => {
    if (on) {
      if (!(await confirmBox('Chiffrer les réponses de ce défi ? C’est irréversible : elles seront remplacées par des empreintes que personne ne peut relire, pas même vous (notez-les ailleurs si besoin). Vous pourrez toujours ajouter de nouvelles réponses acceptées.', 'Chiffrer'))) return;
      setBusy(true);
      try {
        const hs = await D.hashAnswers(b, adv);
        if (!hs.length) { toast('Écrivez d’abord au moins une réponse.'); return; }
        onChange({ ...b, hashed: true, salt: adv.id, answers: hs, revealAnswer: false });
        toast(`${plural(hs.length, 'réponse chiffrée', 'réponses chiffrées')}.`);
      } catch (err) { toast(err.message); } finally { setBusy(false); }
    } else {
      if (!(await confirmBox('Retirer le chiffrement efface les réponses chiffrées (elles ne peuvent pas être déchiffrées) : il faudra saisir de nouveau les réponses acceptées. Continuer ?', 'Effacer les réponses'))) return;
      const { salt, ...rest } = b;
      onChange({ ...rest, hashed: false, answers: D.defaultAnswers(kind) });
    }
  };
  return html`<div class="defi-crypt">
    <label class="row"><input type="checkbox" checked=${hashed} disabled=${!can || tol || busy}
      onChange=${e => { const on = e.target.checked; e.target.checked = hashed; toggle(on); }} /> Chiffrer les réponses (le joueur ne peut pas les lire dans le fichier)</label>
    <p class="subtle" style="margin:0">${!can ? 'Le chiffrement ne concerne que les réponses écrites ou numériques : pour un QCM, il suffirait d’essayer chaque proposition.'
      : tol ? 'Seule une valeur exacte peut être chiffrée : mettez la tolérance à 0.'
      : hashed ? 'Sur papier, la solution indiquera « réponse chiffrée : à vérifier dans l’application ».'
      : 'Irréversible : les réponses sont remplacées par des empreintes que personne ne peut relire. Un nombre reste devinable par un élève patient qui essaierait toutes les valeurs.'}</p>
  </div>`;
}

function ChallengeEditor({ adv, block: b, set, onChange, tgt }) {
  const kind = D.kindOf(b);
  const hashed = D.isHashed(b);
  const kindId = useMemo(() => uidOf('kind'), []);
  const hints = b.hints || [];
  const setHints = l => set({ hints: l });
  const changeKind = async (e) => {
    const k = e.target.value;
    e.target.value = kind;
    if (k === kind) return;
    if (hashed && !(await confirmBox('Changer de type efface les réponses chiffrées. Continuer ?', 'Changer de type'))) return;
    const { salt, ...rest } = b;
    onChange({ ...rest, kind: k, answers: D.convertAnswers(b, k), hashed: false });
  };
  const luck = adv.rules.combat?.luck || adv.rules.stats[0]?.id;
  return html`<div class="defi-ed">
    <div class="grid2">
      <label class="field" for=${kindId}>Type de défi
        <select id=${kindId} value=${kind} onChange=${changeKind}>${KIND_OPTIONS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></label>
      <${Text} label="Titre (facultatif)" value=${b.title} onChange=${v => set({ title: v })} placeholder="L’énigme du passeur" />
    </div>
    <${Text} area rows="4" label="Question — Markdown : **gras**, *italique*, formules entre $…$" value=${b.question} onChange=${v => set({ question: v })} />
    ${String(b.question || '').trim() && html`<${Preview} text=${b.question} label="Aperçu de la question" />`}
    <${ImageSlot} adv=${adv} path=${b.image} name="defi" label="Figure ou illustration du défi (facultatif)" onChange=${p => set({ image: p || undefined })} />

    <fieldset class="defi-ed-box"><legend>Réponses</legend>
      ${hashed ? html`<${HashedAnswers} adv=${adv} b=${b} set=${set} kind=${kind} />`
        : kind === 'text' ? html`<${TextAnswers} b=${b} set=${set} />`
        : kind === 'number' ? html`<${NumberAnswers} b=${b} set=${set} />`
        : kind === 'order' ? html`<${OrderAnswers} b=${b} set=${set} />`
        : html`<${OptionAnswers} b=${b} set=${set} kind=${kind} />`}
      ${kind === 'number' && html`<div class="grid2"><${Text} label="Unité affichée après le champ (facultatif)" value=${b.unit} onChange=${v => set({ unit: v || undefined })} placeholder="cm, €, km/h…" /></div>`}
      <${Crypt} adv=${adv} b=${b} onChange=${onChange} kind=${kind} />
    </fieldset>

    <fieldset class="defi-ed-box"><legend>Essais</legend>
      <div class="grid2"><${Num} label="Nombre d'essais (0 = illimité)" value=${b.attempts ?? 0} min="0" onChange=${v => set({ attempts: Math.max(0, Math.floor(v || 0)) })} /></div>
      <label class="row subtle"><input type="checkbox" checked=${!!b.allowGiveUp} onChange=${e => set({ allowGiveUp: e.target.checked })} /> Le joueur peut renoncer (il va alors au paragraphe d'échec)</label>
      <label class="row subtle"><input type="checkbox" checked=${!!b.revealAnswer && !hashed} disabled=${hashed} onChange=${e => set({ revealAnswer: e.target.checked })} /> Montrer la bonne réponse après un échec${hashed ? ' (impossible : réponses chiffrées)' : ''}</label>
      <p class="subtle" style="margin:0">Une réponse fausse déjà proposée, vide ou illisible ne coûte pas d'essai.</p>
    </fieldset>

    <fieldset class="defi-ed-box"><legend>Indices</legend>
      <p class="subtle" style="margin:0">Révélés un par un, dans cet ordre, à la demande du joueur ; chacun peut avoir un coût (laissez vide pour un indice gratuit).</p>
      ${hints.map((h, j) => html`<div class="panel defi-ed-hint" key=${j}>
        <${Text} area rows="2" label=${`Indice ${j + 1}`} value=${h.text} onChange=${v => setHints(hints.map((x, k) => (k === j ? { ...x, text: v } : x)))} />
        <${EffectsEditor} adv=${adv} value=${h.cost || []} onChange=${v => setHints(hints.map((x, k) => (k === j ? { ...x, cost: v } : x)))} title="Coût de l'indice" />
        <${LineTools} list=${hints} j=${j} setList=${setHints} what=${`l'indice ${j + 1}`} />
      </div>`)}
      <div><button type="button" class="btn small" onClick=${() => setHints([...hints, { text: '', cost: luck ? [{ op: 'stat', stat: luck, add: -1 }] : [] }])}><${Icon} name="plus" />Indice</button></div>
    </fieldset>

    <fieldset class="defi-ed-box"><legend>Suite de l'aventure</legend>
      <div class="grid2">${tgt(b.success, v => set({ success: v }), 'Si bonne réponse, aller au')}${tgt(b.failure, v => set({ failure: v }), 'Si échec, aller au')}</div>
      <p class="subtle" style="margin:0">Destination vide : le joueur continue avec les choix du paragraphe (par exemple pour un défi facultatif qui rapporte un objet).</p>
      <${EffectsEditor} adv=${adv} value=${b.successEffects || []} onChange=${v => set({ successEffects: v })} title="Effets en cas de bonne réponse" />
      <${EffectsEditor} adv=${adv} value=${b.failureEffects || []} onChange=${v => set({ failureEffects: v })} title="Effets en cas d'échec ou de renoncement" />
    </fieldset>

    <${Text} area rows="3" label="Explication montrée à la fin du défi (Markdown, facultatif)" value=${b.explanation} onChange=${v => set({ explanation: v })} />
    ${String(b.explanation || '').trim() && html`<${Preview} text=${b.explanation} label="Aperçu de l'explication" />`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Enregistrements                                                     */
/* ------------------------------------------------------------------ */

registerBlockUI(D.TYPE, {
  label: 'Défi', icon: 'question', order: 20,
  create: () => ({ kind: 'text', title: '', question: '', answers: [''], attempts: 3, hints: [], success: '', failure: '', allowGiveUp: false, successEffects: [], failureEffects: [], explanation: '', hashed: false }),
  Player: ChallengePlayer,
  Editor: ChallengeEditor,
});

// Impression : même texte que le moteur, mais avec le vrai Markdown (et donc les formules du greffon maths).
registerBlock(D.TYPE, { ...ext.blocks.get(D.TYPE), print: (b, adv, h) => D.printChallenge(b, adv, h, markdown) });

registerSheetPanel({
  id: 'defis', order: 40,
  Panel: ({ adv, state }) => {
    const s = D.summary(state, adv);
    if (!s.total) return null;
    return html`<div class="stack defi-sheet" style="gap:6px"><span class="eyebrow">Défis</span>
      <div class="row" style="gap:14px">
        <span class="row" style="gap:6px"><${Icon} name="check" /><b class="mono">${s.solved}</b> ${s.solved > 1 ? 'réussis' : 'réussi'}</span>
        <span class="row" style="gap:6px"><${Icon} name="x" /><b class="mono">${s.failed}</b> ${s.failed > 1 ? 'manqués' : 'manqué'}</span>
        ${s.hints > 0 && html`<span class="row" style="gap:6px"><${Ico} name="bulb" /><b class="mono">${s.hints}</b> ${s.hints > 1 ? 'indices' : 'indice'}</span>`}
      </div></div>`;
  },
});

registerEndingPanel({
  id: 'defis', order: 40,
  Panel: ({ adv, state }) => {
    const s = D.summary(state, adv);
    if (!s.total || !(s.solved + s.failed)) return null;
    return html`<p class="defi-end"><${Ico} name="quest" /> Défis relevés : <b>${s.solved}</b> sur ${s.solved + s.failed} rencontré${s.solved + s.failed > 1 ? 's' : ''}${s.hints ? ` · ${plural(s.hints, 'indice utilisé', 'indices utilisés')}` : ''}.</p>`;
  },
});

registerPrintSection({
  where: 'rules', order: 40,
  Section: ({ adv }) => {
    if (!D.hasChallenges(adv)) return null;
    const hints = Object.values(adv.sections).some(s => (s.blocks || []).some(b => b?.type === D.TYPE && (b.hints || []).length));
    return html`<h3>Les défis</h3>
      <p>Certains paragraphes vous posent une énigme ou un exercice. Notez votre réponse, puis vérifiez-la dans les <b>Solutions des défis</b>, à la fin du livre : elles sont classées par numéro de paragraphe. Ne lisez que celle du défi en cours !${hints ? ' Les indices sont imprimés à l’envers : ne les lisez que si vous acceptez d’en payer le prix.' : ''}</p>`;
  },
});

/** Annexe « Solutions des défis ». Charge aussi les figures des défis dans la version imprimable. */
function Solutions({ adv }) {
  useEffect(() => {
    document.querySelectorAll('.print-book img[data-defi-src]').forEach(async img => {
      if (img.getAttribute('src')) return;
      try { const u = await assetUrl(adv, 'local', img.dataset.defiSrc); if (u) img.src = u; } catch { /* image absente */ }
    });
  });
  const list = D.solutionsOf(adv);
  if (!list.length) return html`<span class="defi-none" hidden></span>`;
  return html`<div class="pr-defi-solutions">
    <h2>Solutions des défis</h2>
    <p class="pr-small pr-defi-center">Classées par numéro de paragraphe. Ne lisez que celle du défi en cours.</p>
    <dl class="pr-defi-sol">${list.map(s => html`<div class="pr-defi-sol-item">
      <dt>${s.label}</dt>
      <dd>${s.title && html`<b>${s.title} : </b>`}${s.hashed ? html`<i>${s.solution}</i>` : html`<span dangerouslySetInnerHTML=${{ __html: inline(s.solution) }}></span>`}.
        ${s.explanation.trim() && html`<div class="pr-small pr-defi-explain" dangerouslySetInnerHTML=${{ __html: markdown(s.explanation) }}></div>`}</dd>
    </div>`)}</dl>
  </div>`;
}
registerPrintSection({ where: 'appendix', order: 40, Section: Solutions });
