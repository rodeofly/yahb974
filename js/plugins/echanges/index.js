// Greffon « échanges » — interface.
//   Éditeur : « Exporter vers… » (Twine .twee, archive Twine .html, ink .ink, JSON brut)
//             « Fusionner… » (une autre aventure .lhz / .json / Twine, ou une aventure de la bibliothèque)
//   Bibliothèque : « Importer depuis Twine » (.twee, .tw, archive .html) → nouvelle aventure locale.
// Le travail (conversion, fusion) est fait par ./core.js, pur et testé dans Node.

import { html, useState, useEffect, useRef, useMemo } from '../../lib/preact-htm.js';
import { Icon, Modal, toast, loadCSS } from '../../ui/common.js';
import { registerEditorAction, registerLibraryAction } from '../../ui/registry.js';
import { saveAdventure, loadAdventure, listLibrary, exportAdventure, download } from '../../store/library.js';
import { putAsset, listAssets } from '../../store/db.js';
import { unzipSync, strFromU8 } from '../../lib/fflate.js';
import { normalizeAdventure, slug } from '../../core/rules.js';
import * as X from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ---------- icônes du greffon (traits simples) ---------- */
const PATHS = {
  export: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 8c0 3 4 4 10 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="1" fill="currentColor"/>',
  warn: '<path d="M12 3 22 20H2z"/><path d="M12 10v5"/><circle cx="12" cy="17.5" r="1" fill="currentColor"/>',
  rename: '<path d="M3 7h9M3 17h9"/><path d="M15 12h6M18 9l3 3-3 3"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  books: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="m16 5 3.5-1 3 15.5-3.5 1z"/>',
};
const Svg = ({ name }) => html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] }}></svg>`;

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4' };
const mimeOf = p => MIME[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream';

/** Bilan d'une aventure en une ligne. */
function Stats({ adv }) {
  const s = X.storyStats(adv);
  return html`<dl class="xch-stats">
    <div><dt>Paragraphes</dt><dd class="mono">${s.sections}</dd></div>
    <div><dt>Choix et renvois</dt><dd class="mono">${s.links}</dd></div>
    <div><dt>Victoires</dt><dd class="mono">${s.victories}</dd></div>
    <div><dt>Morts</dt><dd class="mono">${s.deaths}</dd></div>
    ${s.deadEnds > 0 && html`<div><dt>Sans issue</dt><dd class="mono">${s.deadEnds}</dd></div>`}
  </dl>`;
}

const KIND = { info: ['info', 'Info'], rename: ['rename', 'Renommé'], warning: ['warn', 'Attention'] };
/** Liste de lignes de rapport : icône + mot (jamais la couleur seule). */
function Report({ lines, label }) {
  return html`<ul class="xch-report" aria-label=${label}>${lines.map(l => {
    const [icon, word] = KIND[l.kind] || KIND.info;
    return html`<li class=${'xch-' + l.kind}><span class="xch-tag"><${Svg} name=${icon} />${word}</span><span>${l.text}</span></li>`;
  })}</ul>`;
}

/* ------------------------------------------------------------------ */
/* Exporter vers…                                                      */
/* ------------------------------------------------------------------ */

const FORMATS = [
  { id: 'twee', ext: '.twee', label: 'Twine : fichier Twee', hint: 'Texte à ouvrir avec Twine 2.6 ou plus (Bibliothèque › Importer) ou avec Tweego.', type: 'text/plain', make: X.toTwee, file: s => `${s}.twee` },
  { id: 'twine', ext: '.html', label: 'Twine : archive', hint: 'Archive de bibliothèque Twine 2, à importer par Bibliothèque › Importer.', type: 'text/html', make: X.toTwineHTML, file: s => `${s}-twine.html` },
  { id: 'ink', ext: '.ink', label: 'ink (Inky)', hint: 'Script ink à ouvrir dans l’éditeur Inky d’Inkle.', type: 'text/plain', make: X.toInk, file: s => `${s}.ink` },
  { id: 'json', ext: '.json', label: 'JSON brut', hint: 'Le fichier adventure.json seul, sans les images.', type: 'application/json', make: X.toJSON, file: s => `${s}.json` },
];

function ExportMenu({ adv }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const wrap = useRef(), btn = useRef();
  useEffect(() => {
    if (!open) return;
    // Le menu reste dans l'écran, même quand le bouton est au bord (téléphone).
    const fit = () => {
      const r = btn.current.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      const width = Math.min(360, vw - 32);
      setPlace({ top: r.bottom + 6, left: Math.max(16, Math.min(r.right - width, vw - 16 - width)), width });
    };
    fit();
    addEventListener('resize', fit);
    wrap.current?.querySelector('[role=menuitem]')?.focus();
    const outside = e => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => { removeEventListener('resize', fit); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const nav = e => {
    const items = [...wrap.current.querySelectorAll('[role=menuitem]')];
    const i = items.indexOf(document.activeElement);
    const go = k => { e.preventDefault(); items[(k + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };
  const run = f => {
    setOpen(false);
    try {
      const name = f.file(slug(adv.meta.title || 'aventure'));
      download(new Blob([f.make(adv)], { type: `${f.type};charset=utf-8` }), name);
      toast(`Fichier « ${name} » enregistré.`);
    } catch (err) { toast(`Export impossible : ${err.message}`); }
    btn.current?.focus();
  };
  return html`<div class="xch-menu-wrap" ref=${wrap}>
    <button class="btn small" ref=${btn} aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(o => !o)}>
      <${Svg} name="export" />Exporter vers…</button>
    ${open && html`<div class="xch-menu" role="menu" aria-label="Exporter vers un autre outil" onKeyDown=${nav}
        style=${place ? `top:${place.top}px;left:${place.left}px;width:${place.width}px` : ''}>
      ${FORMATS.map(f => html`<button type="button" role="menuitem" class="xch-item" data-format=${f.id} onClick=${() => run(f)}>
        <span class="xch-ext mono" aria-hidden="true">${f.ext}</span>
        <span class="xch-item-text"><b>${f.label}</b><span class="subtle">${f.hint}</span></span>
      </button>`)}
    </div>`}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Importer depuis Twine (bibliothèque)                                */
/* ------------------------------------------------------------------ */

function buildDraft(text, name, story = 0) {
  const fmt = X.detectFormat(text);
  if (!['twee', 'twine2', 'twine1'].includes(fmt)) throw new Error('ce fichier ne ressemble pas à une histoire Twine (fichier .twee ou archive .html)');
  const warnings = [];
  const adv = fmt === 'twee' ? X.fromTwee(text, { warnings }) : X.fromTwineHTML(text, { warnings, story });
  return { text, name, fmt, story, stories: fmt === 'twine2' ? X.twineStories(text) : [], adv, warnings };
}

function Warnings({ list }) {
  if (!list.length) return null;
  const shown = list.slice(0, 8);
  return html`<div class="stack" style="gap:6px">
    <${Report} label="Avertissements" lines=${shown.map(text => ({ kind: 'warning', text }))} />
    ${list.length > shown.length && html`<p class="subtle" style="margin:0">… et ${plural(list.length - shown.length, 'autre avertissement', 'autres avertissements')}. L’onglet Vérifier de l’éditeur les signale aussi.</p>`}
  </div>`;
}

function TwineImport({ refresh }) {
  const ref = useRef();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const onFile = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { setDraft(buildDraft(await f.text(), f.name)); }
    catch (err) { toast(`Import impossible : ${err.message}.`); }
  };
  const create = async () => {
    setBusy(true);
    try {
      const saved = await saveAdventure(draft.adv);
      setDraft(null);
      toast(`« ${saved.meta.title} » importée depuis Twine.`);
      refresh?.();
      location.hash = `#/ecrire/${encodeURIComponent(saved.id)}`;
    } catch (err) { toast(`Import impossible : ${err.message}`); }
    finally { setBusy(false); }
  };
  return html`<button class="btn" onClick=${() => ref.current.click()}><${Icon} name="upload" />Importer depuis Twine</button>
    <input type="file" accept=".twee,.tw,.tw2,.tw3,.html,.htm,.txt,text/plain,text/html" hidden ref=${ref} onChange=${onFile} aria-label="Fichier Twine à importer" />
    ${draft && html`<${Modal} title="Importer depuis Twine" onClose=${() => setDraft(null)}>
      <div class="stack xch-dialog" lang="fr">
        <p class="subtle" style="margin:0"><${Svg} name="file" /> ${draft.name} · ${draft.fmt === 'twee' ? 'fichier Twee' : draft.fmt === 'twine1' ? 'fichier Twine 1' : 'archive Twine 2'}</p>
        ${draft.stories.length > 1 && html`<label class="field">Histoire de l’archive à importer
          <select value=${draft.story} onChange=${e => { try { setDraft(buildDraft(draft.text, draft.name, Number(e.target.value))); } catch (err) { toast(err.message); } }}>
            ${draft.stories.map(s => html`<option value=${s.index}>${s.name} (${plural(s.passages, 'passage', 'passages')})</option>`)}
          </select></label>`}
        <h3 class="xch-title">${draft.adv.meta.title}</h3>
        <${Stats} adv=${draft.adv} />
        <p class="xch-note">Chaque passage devient un paragraphe numéroté (le passage de départ devient le ${draft.adv.start}) et chaque lien devient un choix.
          Les macros Harlowe ou SugarCube sont retirées, leur texte est gardé. Les étiquettes « mort » / « death » et « victoire » / « victory » deviennent des fins.</p>
        <${Warnings} list=${draft.warnings} />
        <div class="row">
          <button class="btn primary" disabled=${busy} onClick=${create}><${Icon} name="plus" />Créer l’aventure et l’ouvrir</button>
          <button class="btn" onClick=${() => setDraft(null)}>Annuler</button>
        </div>
      </div>
    <//>`}`;
}

/* ------------------------------------------------------------------ */
/* Fusionner une autre aventure (éditeur)                              */
/* ------------------------------------------------------------------ */

/** Lit un .lhz (zip : adventure.json + images/ + sons/), comme importAdventure mais sans rien enregistrer. */
function readZip(bytes, label) {
  const files = unzipSync(bytes);
  const key = files['adventure.json'] ? 'adventure.json' : Object.keys(files).find(k => k.endsWith('adventure.json'));
  if (!key) throw new Error('ce fichier ne contient pas de adventure.json');
  const adventure = normalizeAdventure(JSON.parse(strFromU8(files[key])));
  const assets = {};
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.endsWith('adventure.json')) continue;
    assets[name.replace(/^[^/]*\/(?=(images|sons)\/)/, '')] = data;
  }
  return { adventure, files: assets, label, warnings: [] };
}

async function readOtherFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readZip(bytes, file.name);
  const warnings = [];
  const adventure = X.parseStory(new TextDecoder().decode(bytes), { warnings });
  return { adventure, files: {}, label: file.name, warnings };
}

async function readOtherFromLibrary(id) {
  const { adventure, source } = await loadAdventure(id);
  const blob = await exportAdventure(adventure, source);
  return readZip(new Uint8Array(await blob.arrayBuffer()), `Bibliothèque : ${adventure.meta.title}`);
}

const nextNumber = adv => Math.max(0, ...Object.keys(adv.sections).map(Number).filter(n => Number.isInteger(n) && n > 0)) + 1;

function MergeDialog({ adv, change, onClose }) {
  const [step, setStep] = useState('pick');
  const [other, setOther] = useState(null);
  const [lib, setLib] = useState(null);
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState([]);
  const [opts, setOpts] = useState({ prefix: '', share: true, startAt: '', linkFrom: '', linkText: '' });
  const [result, setResult] = useState(null);
  const fileRef = useRef();
  useEffect(() => {
    listLibrary().then(l => { const list = l.filter(e => e.id !== adv.id); setLib(list); setPickId(list[0]?.id || ''); }).catch(() => setLib([]));
    listAssets(adv.id).then(setTaken).catch(() => {});
  }, []);
  const set = patch => setOpts(o => ({ ...o, ...patch }));
  const options = () => ({
    prefix: opts.prefix.trim() || undefined,
    shareIdentical: opts.share,
    startAt: Number(opts.startAt) || undefined,
    link: opts.linkFrom.trim() ? { from: opts.linkFrom.trim(), text: opts.linkText } : undefined,
    takenAssets: taken,
  });
  const preview = useMemo(() => {
    if (!other) return null;
    try { return X.mergeAdventures(adv, other.adventure, options()); } catch (e) { return { error: e.message }; }
  }, [other, opts, taken, adv]);

  const load = async fn => {
    setBusy(true);
    try {
      const o = await fn();
      setOther(o);
      set({ prefix: '', startAt: '', linkFrom: '', linkText: `Continuer vers « ${o.adventure.meta.title} »` });
      setStep('review');
    } catch (err) { toast(`Lecture impossible : ${err.message}.`); }
    finally { setBusy(false); }
  };
  const onFile = e => { const f = e.target.files[0]; e.target.value = ''; if (f) load(() => readOtherFile(f)); };

  const apply = async () => {
    setBusy(true);
    try {
      const r = X.mergeAdventures(adv, other.adventure, options());
      let missing = 0;
      for (const [from, to] of Object.entries(r.assetMap)) {
        const data = other.files[from];
        if (data) await putAsset(adv.id, to, new Blob([data], { type: mimeOf(to) }));
        else missing++;
      }
      if (missing) r.report.lines.push({ kind: 'warning', text: `${plural(missing, 'image ou son cité par l’autre aventure est absent', 'images ou sons cités par l’autre aventure sont absents')} du fichier : ajoutez-les dans l’éditeur.` });
      change(() => r.adventure);
      setResult(r);
      setStep('done');
      toast(`Fusion terminée : ${plural(r.report.sections.count, 'paragraphe ajouté', 'paragraphes ajoutés')}.`);
    } catch (err) { toast(`Fusion impossible : ${err.message}`); }
    finally { setBusy(false); }
  };

  const baseIds = Object.keys(adv.sections);
  let body;
  if (step === 'pick') body = html`
    <p class="xch-note">Ajoutez à « ${adv.meta.title} » les paragraphes d’une autre aventure, par exemple la partie écrite par un·e co-auteur·e.
      Ils sont renumérotés à la suite des vôtres ; rien n’est modifié avant votre confirmation.</p>
    <div class="xch-sources">
      <section class="xch-source" aria-labelledby="xch-src-file">
        <h3 id="xch-src-file"><${Svg} name="file" />Un fichier</h3>
        <p class="subtle">Aventure exportée (.lhz ou .json), fichier Twee (.twee) ou archive Twine (.html).</p>
        <div><button class="btn" disabled=${busy} onClick=${() => fileRef.current.click()}>Choisir un fichier…</button></div>
        <input type="file" hidden ref=${fileRef} accept=".lhz,.zip,.json,.twee,.tw,.html,.htm,.txt,application/zip,application/json,text/plain,text/html" onChange=${onFile} aria-label="Fichier de l’aventure à fusionner" />
      </section>
      <section class="xch-source" aria-labelledby="xch-src-lib">
        <h3 id="xch-src-lib"><${Svg} name="books" />Une aventure de la bibliothèque</h3>
        ${lib === null ? html`<p class="subtle">Chargement…</p>` : !lib.length ? html`<p class="subtle">Aucune autre aventure dans la bibliothèque.</p>` : html`
          <label class="field">Aventure<select value=${pickId} onChange=${e => setPickId(e.target.value)}>
            ${lib.map(e => html`<option value=${e.id}>${e.title}${e.source === 'local' ? ' (sur cet appareil)' : ' (publiée)'}</option>`)}</select></label>
          <div><button class="btn" disabled=${busy || !pickId} onClick=${() => load(() => readOtherFromLibrary(pickId))}>Choisir cette aventure</button></div>`}
      </section>
    </div>`;
  else if (step === 'review') body = html`
    <div class="xch-head"><${Svg} name="file" /><span><b>${other.adventure.meta.title}</b> <span class="subtle">— ${other.label}</span></span></div>
    <${Stats} adv=${other.adventure} />
    <${Warnings} list=${other.warnings} />
    <fieldset class="xch-options">
      <legend>Réglages de la fusion</legend>
      <div class="grid2">
        <label class="field">Numéroter à partir de
          <input type="number" min="1" value=${opts.startAt} placeholder=${String(nextNumber(adv))} onInput=${e => set({ startAt: e.target.value })} /></label>
        <label class="field">Préfixe des identifiants en double
          <input type="text" value=${opts.prefix} placeholder=${X.defaultPrefix(other.adventure)} onInput=${e => set({ prefix: e.target.value })} /></label>
      </div>
      <label class="xch-check"><input type="checkbox" checked=${opts.share} onChange=${e => set({ share: e.target.checked })} /><span>Garder une seule fois les objets, compagnons et compteurs identiques dans les deux aventures</span></label>
      <div class="grid2">
        <label class="field">Relier : ajouter un choix au paragraphe (facultatif)
          <input type="text" list="xch-sections" value=${opts.linkFrom} placeholder=${`ex. ${adv.start}`} onInput=${e => set({ linkFrom: e.target.value })} style="font-family:var(--mono)" /></label>
        <label class="field">Texte de ce choix
          <input type="text" value=${opts.linkText} disabled=${!opts.linkFrom.trim()} onInput=${e => set({ linkText: e.target.value })} /></label>
      </div>
      <datalist id="xch-sections">${baseIds.map(i => html`<option value=${i}>${(adv.sections[i].title || adv.sections[i].text || '').slice(0, 50)}</option>`)}</datalist>
    </fieldset>
    <h3 class="xch-sub">Ce qui va se passer</h3>
    ${preview?.error ? html`<${Report} label="Problème" lines=${[{ kind: 'warning', text: preview.error }]} />` : preview && html`<${Report} label="Aperçu de la fusion" lines=${preview.report.lines} />`}
    <div class="row">
      <button class="btn primary" disabled=${busy || !preview || preview.error} onClick=${apply}><${Svg} name="merge" />Fusionner</button>
      <button class="btn" disabled=${busy} onClick=${() => { setOther(null); setStep('pick'); }}>Choisir une autre aventure</button>
      <button class="btn" onClick=${onClose}>Annuler</button>
    </div>`;
  else body = html`
    <p class="outcome ok">Fusion terminée : ${plural(result.report.sections.count, 'paragraphe ajouté', 'paragraphes ajoutés')}.</p>
    <${Report} label="Rapport de la fusion" lines=${result.report.lines} />
    <div class="row">
      ${result.report.sections.start && html`<button class="btn primary" onClick=${() => { onClose(); location.hash = `#/ecrire/${encodeURIComponent(adv.id)}/${encodeURIComponent(result.report.sections.start)}`; }}>Ouvrir le paragraphe ${result.report.sections.start}</button>`}
      <button class="btn" onClick=${onClose}>Fermer</button>
    </div>`;
  return html`<${Modal} title=${step === 'done' ? 'Rapport de la fusion' : 'Fusionner une autre aventure'} onClose=${onClose} wide=${step !== 'pick'}>
    <div class="stack xch-dialog" lang="fr">${body}</div>
  <//>`;
}

function MergeAction({ adv, change }) {
  const [open, setOpen] = useState(false);
  return html`<button class="btn small xch-btn" aria-label="Fusionner une autre aventure…" title="Fusionner une autre aventure…" onClick=${() => setOpen(true)}><${Svg} name="merge" />Fusionner…</button>
    ${open && html`<${MergeDialog} adv=${adv} change=${change} onClose=${() => setOpen(false)} />`}`;
}

registerEditorAction({ id: 'echanges-export', order: 40, Action: ExportMenu });
registerEditorAction({ id: 'echanges-fusion', order: 41, Action: MergeAction });
registerLibraryAction({ id: 'echanges-twine', order: 40, Action: TwineImport });
