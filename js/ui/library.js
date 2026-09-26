// Écran d'accueil : aventures disponibles, création, import.

import { html, useState, useEffect, useRef } from '../lib/preact-htm.js';
import { Icon, AssetImg, toast, confirmBox } from './common.js';
import { listLibrary, loadAdventure, importAdventure, exportAdventure, download, duplicateAdventure } from '../store/library.js';
import { putAdventure, deleteAdventure, listSaves } from '../store/db.js';
import { newAdventure, slug } from '../core/rules.js';
import { ui, sorted } from './registry.js';

function Cover({ entry }) {
  const [adv, setAdv] = useState(null);
  useEffect(() => { if (entry.cover) loadAdventure(entry.id).then(r => setAdv(r)).catch(() => {}); }, [entry.id, entry.cover]);
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
    try { const adv = await importAdventure(f); toast(`« ${adv.meta.title} » importée.`); refresh(); }
    catch (err) { toast(`Import impossible : ${err.message}`); }
  };
  const doExport = async entry => {
    const { adventure, source } = await loadAdventure(entry.id);
    download(await exportAdventure(adventure, source), `${slug(adventure.meta.title)}.lhz`);
  };
  const edit = async entry => {
    if (entry.source === 'local') { location.hash = `#/ecrire/${encodeURIComponent(entry.id)}`; return; }
    const { adventure, source } = await loadAdventure(entry.id);
    const copy = await duplicateAdventure(adventure, source, adventure.meta.title);
    toast('Une copie modifiable a été créée.');
    location.hash = `#/ecrire/${encodeURIComponent(copy.id)}`;
  };
  const remove = async entry => {
    if (!(await confirmBox(`Supprimer « ${entry.title} », ses images et ses parties sauvegardées de ce navigateur ?`, 'Supprimer'))) return;
    await deleteAdventure(entry.id);
    refresh();
  };

  return html`<main class="page">
    <div class="lib-head">
      <div class="stack" style="gap:6px">
        <span class="eyebrow">Bibliothèque</span>
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
    ${items === null ? html`<p class="muted">Chargement…</p>` : !items.length ? html`<p class="muted">Aucune aventure pour l'instant.</p>` : html`
    <div class="cards">
      ${items.map(e => html`<article class="card" key=${e.source + e.id}>
        <${Cover} entry=${e} />
        <div class="body">
          <span class="badge">${e.source === 'local' ? 'Sur cet appareil' : 'Publiée'}</span>
          <h2 style="font-size:21px">${e.title}</h2>
          ${e.author && html`<span class="muted">par ${e.author}</span>`}
          ${e.description && html`<p class="muted" style="margin:0;font-size:15px">${e.description}</p>`}
          <span class="subtle">${e.sections ? `${e.sections} paragraphes` : ''}${saves[e.id] ? ` · ${saves[e.id]} partie${saves[e.id] > 1 ? 's' : ''} en cours` : ''}</span>
          ${sorted(ui.libraryExtras).map(x => html`<${x.Extra} entry=${e} />`)}
        </div>
        <div class="foot">
          <a class="btn primary small" href=${`#/jouer/${encodeURIComponent(e.id)}`}><${Icon} name="play" />${saves[e.id] ? 'Continuer' : 'Jouer'}</a>
          <button class="btn small" onClick=${() => edit(e)}><${Icon} name="edit" />${e.source === 'local' ? 'Modifier' : 'Copier pour modifier'}</button>
          <button class="btn small" onClick=${() => doExport(e)} aria-label="Exporter"><${Icon} name="download" /></button>
          <a class="btn small" href=${`#/imprimer/${encodeURIComponent(e.id)}`} aria-label="Version imprimable"><${Icon} name="print" /></a>
          ${sorted(ui.cardActions).map(a => html`<${a.Action} entry=${e} refresh=${refresh} />`)}
          ${e.source === 'local' && html`<button class="btn small danger" onClick=${() => remove(e)} aria-label="Supprimer"><${Icon} name="trash" /></button>`}
        </div>
      </article>`)}
    </div>`}
  </main>`;
}
