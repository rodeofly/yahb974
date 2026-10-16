// Écran d'accueil : aventures disponibles, création, import.

import { html, useState, useEffect, useRef } from '../lib/preact-htm.js';
import { Icon, AssetImg, toast, confirmBox } from './common.js';
import { listLibrary, loadAdventure, importAdventure, exportAdventure, download, duplicateAdventure, shelvesOf } from '../store/library.js';
import { putAdventure, deleteAdventure, listSaves } from '../store/db.js';
import { newAdventure, slug } from '../core/rules.js';
import { ui, sorted } from './registry.js';
import { VERSION } from '../version.js';

/** Identifiant déjà pris à l'import : remplacer (après confirmation) ou garder les deux. */
export async function askReplace(existing, adv) {
  const where = existing.source === 'local' ? 'dans votre bibliothèque' : 'parmi les aventures publiées (votre fichier la masquerait)';
  const ok = await confirmBox(`Une aventure « ${existing.title} » porte déjà le même identifiant ${where}. Remplacer « ${existing.title} » par « ${adv.meta.title} » ? Ses parties sauvegardées seraient rattachées au nouveau contenu.`, 'Remplacer', 'Garder les deux');
  return ok ? 'replace' : 'copy';
}

function Cover({ entry }) {
  const [adv, setAdv] = useState(null);
  // Document (PDF) ou index qui donne une vignette prête : on l'affiche telle quelle.
  if (entry.coverUrl) return html`<div class="cover"><img src=${entry.coverUrl} alt="" loading="lazy" /></div>`;
  // Aventure publiée : index.json donne déjà la couverture, inutile de télécharger toute l'aventure.
  const bundled = entry.source === 'bundled';
  useEffect(() => { if (entry.cover && !bundled) loadAdventure(entry.id).then(r => setAdv(r)).catch(() => {}); }, [entry.id, entry.cover, bundled]);
  if (bundled && entry.cover) return html`<div class="cover"><${AssetImg} adv=${{ id: entry.id }} source="bundled" path=${entry.cover} alt="" /></div>`;
  return html`<div class="cover">${adv?.adventure.meta.cover
    ? html`<${AssetImg} adv=${adv.adventure} source=${adv.source} path=${adv.adventure.meta.cover} alt="" />`
    : html`<span class="ph" aria-hidden="true">${(entry.title || '?').slice(0, 1)}</span>`}</div>`;
}

export function Library() {
  const [items, setItems] = useState(null);
  const [saves, setSaves] = useState({});
  const fileRef = useRef();
  const refresh = async () => {
    const list = await listLibrary();
    setItems(list);
    const s = {};
    for (const e of list) s[e.id] = (await listSaves(e.id)).filter(x => !x.state?.ended).length;
    setSaves(s);
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const adv = newAdventure('Nouvelle aventure');
    await putAdventure(adv);
    location.hash = `#/ecrire/${encodeURIComponent(adv.id)}`;
  };
  const onImport = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const adv = await importAdventure(f, { onConflict: askReplace });
      toast(`« ${adv.meta.title} » importée.`); refresh();
    }
    catch (err) { toast(`Import impossible : ${err.message}`); }
  };
  const doExport = async entry => {
    try {
      const { adventure, source } = await loadAdventure(entry.id);
      const blob = await exportAdventure(adventure, source);
      download(blob, `${slug(adventure.meta.title)}.lhz`);
      if (blob.missing?.length) toast(`Attention : ${blob.missing.length} fichier(s) n’ont pas pu être ajoutés (hors ligne ?) : ${blob.missing.slice(0, 3).join(', ')}${blob.missing.length > 3 ? '…' : ''}`);
    } catch (err) { toast(`Export impossible : ${err.message}`); }
  };
  const edit = async entry => {
    if (entry.source === 'local') { location.hash = `#/ecrire/${encodeURIComponent(entry.id)}`; return; }
    try {
      const { adventure, source } = await loadAdventure(entry.id);
      const copy = await duplicateAdventure(adventure, source, adventure.meta.title);
      toast('Une copie modifiable a été créée.');
      location.hash = `#/ecrire/${encodeURIComponent(copy.id)}`;
    } catch (err) { toast(`Copie impossible : ${err.message}`); }
  };
  const remove = async entry => {
    if (!(await confirmBox(`Supprimer « ${entry.title} », ses images et ses parties sauvegardées de ce navigateur ?`, 'Supprimer'))) return;
    await deleteAdventure(entry.id);
    refresh();
  };

  return html`<main class="page">
    <div class="lib-head">
      <div class="stack" style="gap:6px">
        <span class="eyebrow">Bibliothèque <span class="subtle" style="font-weight:400;letter-spacing:0;text-transform:none" title="Version de l’application chargée (identique au cache hors ligne)">· version ${VERSION}</span></span>
        <h1>Choisissez votre aventure</h1>
        <p class="muted" style="margin:0;max-width:60ch">Jouez une aventure, ou écrivez la vôtre avec ses illustrations, ses combats et ses jets de dés.</p>
      </div>
      <div class="row">
        <button class="btn primary" onClick=${create}><${Icon} name="plus" />Écrire une aventure</button>
        <button class="btn" onClick=${() => fileRef.current.click()}><${Icon} name="upload" />Importer (.lhz)</button>
        <input type="file" accept=".lhz,.zip,.json,application/zip,application/json" hidden ref=${fileRef} onChange=${onImport} />
        ${sorted(ui.libraryActions).map(a => html`<${a.Action} refresh=${refresh} />`)}
      </div>
    </div>
    ${items === null ? html`<p class="muted">Chargement…</p>` : !items.length ? html`<p class="muted">Aucune aventure pour l'instant.</p>` : (() => {
      // Rayons (séries) quand l'index en déclare ; sinon une seule grille, comme avant.
      const shelves = shelvesOf(items);
      const titled = shelves.length > 1 || !!shelves[0]?.title;
      const shortTitle = (e, s) => (s.title && e.title?.startsWith(s.title) ? e.title.slice(s.title.length).replace(/^\s*[·:–—-]\s*/, '') || e.title : e.title);
      const card = (e, s) => html`<article class=${'card' + (e.kind === 'document' ? ' doc' : '')} key=${e.source + e.id}>
        <${Cover} entry=${e} />
        <div class="body">
          <span class="badge">${e.kind === 'document' ? 'À lire (PDF)' : e.source === 'local' ? (e.replaces ? 'Copie importée' : 'Sur cet appareil') : 'Publiée'}</span>
          <h2 style="font-size:21px">${shortTitle(e, s)}</h2>
          ${e.author && html`<span class="muted">par ${e.author}</span>`}
          ${e.description && html`<p class="muted" style="margin:0;font-size:15px">${e.description}</p>`}
          <span class="subtle">${e.sections ? `${e.sections} paragraphes` : ''}${saves[e.id] ? ` · ${saves[e.id]} partie${saves[e.id] > 1 ? 's' : ''} en cours` : ''}</span>
          ${sorted(ui.libraryExtras).map(x => html`<${x.Extra} entry=${e} />`)}
        </div>
        ${e.kind === 'document' ? html`<div class="foot">
          <a class="btn primary small" href=${e.href} target="_blank" rel="noopener"><${Icon} name="book" />Lire</a>
        </div>` : html`<div class="foot">
          <a class="btn primary small" href=${`#/jouer/${encodeURIComponent(e.id)}`}><${Icon} name="play" />${saves[e.id] ? 'Continuer' : 'Jouer'}</a>
          ${e.pdf && html`<a class="btn small" href=${e.pdf} target="_blank" rel="noopener" title="Le livre d'origine, en PDF"><${Icon} name="book" />PDF</a>`}
          <button class="btn small" onClick=${() => edit(e)}><${Icon} name="edit" />${e.source === 'local' ? 'Modifier' : 'Copier pour modifier'}</button>
          <button class="btn small" onClick=${() => doExport(e)} aria-label="Exporter"><${Icon} name="download" /></button>
          <a class="btn small" href=${`#/imprimer/${encodeURIComponent(e.id)}`} aria-label="Version imprimable"><${Icon} name="print" /></a>
          ${sorted(ui.cardActions).map(a => html`<${a.Action} entry=${e} refresh=${refresh} />`)}
          ${e.source === 'local' && html`<button class="btn small danger" onClick=${() => remove(e)} aria-label="Supprimer"><${Icon} name="trash" /></button>`}
        </div>`}
      </article>`;
      if (!titled) return html`<div class="cards">${items.map(e => card(e, { title: '' }))}</div>`;
      const anchor = (s, i) => `rayon-${i}`;
      return html`
        ${shelves.length > 2 && html`<nav class="shelf-nav" aria-label="Rayons de la bibliothèque">${shelves.map((s, i) => html`<a class="shelf-chip" href=${'#' + anchor(s, i)}
          onClick=${ev => { ev.preventDefault(); document.getElementById(anchor(s, i))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>${s.title}<span class="mono">${s.items.length}</span></a>`)}</nav>`}
        ${shelves.map((s, i) => html`<section class=${'shelf' + (s.items.every(e => e.kind === 'document') ? ' docs' : '')} id=${anchor(s, i)} aria-labelledby=${anchor(s, i) + '-t'}>
          <header class="shelf-head"><h2 id=${anchor(s, i) + '-t'}>${s.title}</h2><span class="subtle">${s.items.length} livre${s.items.length > 1 ? 's' : ''}</span></header>
          ${s.note && html`<p class="muted shelf-note">${s.note}</p>`}
          <div class="cards">${s.items.map(e => card(e, s))}</div>
        </section>`)}`;
    })()}
  </main>`;
}
