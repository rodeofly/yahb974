// Greffon « partage » — interface : partager une aventure par lien, QR code ou fichier ; recevoir un lien magique.
// - Fenêtre « Partager » sur chaque carte de la bibliothèque et dans la barre de l'éditeur.
// - Page #/importer/<jeton> : aperçu de l'aventure reçue, « Ajouter à ma bibliothèque », puis « Jouer ».
// - Bibliothèque : « Ouvrir un lien » (utile quand l'application installée ne s'ouvre pas depuis un message).
// - Version imprimable : QR code vers la version numérique d'une aventure publiée.
// Voir docs/plugins/partage.md.

import { html, render, useState, useEffect, useLayoutEffect, useMemo, useRef } from '../../lib/preact-htm.js';
import { Icon, Modal, toast, loadCSS } from '../../ui/common.js';
import { registerCardAction, registerEditorAction, registerLibraryAction, registerRoute, registerPrintSection } from '../../ui/registry.js';
import { loadAdventure, saveAdventure, exportAdventure, listLibrary, download } from '../../store/library.js';
import { slug } from '../../core/rules.js';
import * as S from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ---------- petites icônes propres au greffon (traits, comme celles de common.js) ---------- */
const PATHS = {
  share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.7l7.4-4.4M8.3 13.3l7.4 4.4"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  warn: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v5"/><circle cx="12" cy="17.6" r=".9" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17.5 21H21v-3.5"/>',
};
const Ico = ({ name }) => html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] }}></svg>`;

/* ---------- utilitaires ---------- */
const appBase = () => S.baseOf(location.href);
const onThisComputerOnly = () => location.protocol === 'file:' || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
const plural = (n, one, many) => `${S.frNumber(n)} ${n > 1 ? many : one}`;
let uid = 0;
const useUid = p => useMemo(() => `${p}-${++uid}`, []);

/** Copie dans le presse-papiers ; à défaut, sélectionne le champ pour une copie manuelle. */
async function copyText(text, field) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* repli ci-dessous */ }
  if (field) {
    field.focus();
    field.select();
    try { if (document.execCommand('copy')) return true; } catch { /* sélection laissée pour Ctrl+C */ }
  }
  return false;
}

/** Affiche ses enfants directement dans <body> (échappe aux barres collantes de l'éditeur). */
function Portal({ children }) {
  const host = useMemo(() => { const d = document.createElement('div'); d.className = 'share-portal'; document.body.append(d); return d; }, []);
  // Rendu synchrone (et non différé) : sinon une frappe rapide pourrait être écrasée par un rendu en retard.
  useLayoutEffect(() => { render(children, host); });
  useEffect(() => () => { render(null, host); host.remove(); }, []);
  return null;
}

/* ---------- QR code ---------- */
function QrImage({ qr, label }) {
  return html`<svg class="qr-svg" viewBox=${`0 0 ${qr.size} ${qr.size}`} shape-rendering="crispEdges" role="img" aria-label=${label}>
    <rect width=${qr.size} height=${qr.size} fill="#fff" /><path fill="#000" d=${qr.path} />
  </svg>`;
}

function qrPng(qr, scale = 12) {
  const c = document.createElement('canvas');
  c.width = c.height = qr.size * scale;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.scale(scale, scale);
  g.fillStyle = '#000'; g.fill(new Path2D(qr.path));
  return new Promise(res => c.toBlob(res, 'image/png'));
}

function BigQr({ qr, title, onClose }) {
  const ref = useRef();
  useEffect(() => {
    // Échap ferme d'abord le grand QR code, pas la fenêtre « Partager » en dessous.
    const k = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    const before = document.activeElement;
    window.addEventListener('keydown', k, true);
    ref.current?.querySelector('button')?.focus();
    return () => { window.removeEventListener('keydown', k, true); before?.focus?.(); };
  }, []);
  return html`<div class="share-big" role="dialog" aria-modal="true" aria-label=${`QR code en grand : ${title}`} ref=${ref} onClick=${onClose} lang="fr">
    <p class="share-big-title">${title}</p>
    <${QrImage} qr=${qr} label=${`QR code du lien vers « ${title} »`} />
    <p>Scannez ce code avec l'appareil photo d'un téléphone ou d'une tablette.</p>
    <button class="btn" onClick=${onClose}><${Icon} name="x" />Fermer</button>
  </div>`;
}

function QrFigure({ url, title, caption }) {
  const qr = useMemo(() => S.qrMatrix(url), [url]);
  const [big, setBig] = useState(false);
  if (!qr) return null;
  const dense = qr.modules > 73;
  const name = `${slug(title)}-qr`;
  const savePng = async () => download(await qrPng(qr), `${name}.png`);
  const saveSvg = () => download(new Blob([S.qrSvg(url, { title })], { type: 'image/svg+xml' }), `${name}.svg`);
  return html`<figure class=${'share-qr' + (dense ? ' dense' : '')}>
    <div class="qr-box"><${QrImage} qr=${qr} label=${`QR code du lien vers « ${title} »`} /></div>
    <figcaption>${caption}${dense ? html` <b>Code très dense :</b> affichez-le en grand pour le scanner.` : ''}</figcaption>
    <div class="row share-qr-actions">
      <button class="btn small" onClick=${() => setBig(true)}><${Ico} name="expand" />Afficher en grand</button>
      <button class="btn small" onClick=${savePng} aria-label="Enregistrer le QR code en image PNG"><${Icon} name="download" />PNG</button>
      <button class="btn small" onClick=${saveSvg} aria-label="Enregistrer le QR code en image SVG"><${Icon} name="download" />SVG</button>
    </div>
    ${big && html`<${BigQr} qr=${qr} title=${title} onClose=${() => setBig(false)} />`}
  </figure>`;
}

/* ---------- champ du lien + copie ---------- */
function LinkField({ url, title }) {
  const id = useUid('share-url');
  const ref = useRef();
  const [copied, setCopied] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const long = url.length > 160;
  const copy = async () => {
    if (await copyText(url, ref.current)) {
      setCopied(true);
      toast('Lien copié : collez-le dans un message.');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } else toast('Copie automatique impossible : le lien est sélectionné, copiez-le avec Ctrl+C (ou un appui long).');
  };
  const share = () => navigator.share({ title, text: `« ${title} », une aventure dont vous êtes le héros`, url }).catch(() => { /* partage annulé */ });
  const select = e => e.target.select();
  return html`<div class="stack share-linkbox">
    <label class="field" for=${id}>Lien à envoyer${long ? ` (${plural(url.length, 'caractère', 'caractères')})` : ''}
      ${long
        ? html`<textarea id=${id} class="share-url" readonly rows="4" ref=${ref} value=${url} onFocus=${select} spellcheck="false"></textarea>`
        : html`<input id=${id} class="share-url" type="text" readonly ref=${ref} value=${url} onFocus=${select} spellcheck="false" />`}
    </label>
    <div class="row">
      <button class="btn primary" onClick=${copy}>${copied ? html`<${Icon} name="check" />Lien copié` : html`<${Ico} name="copy" />Copier le lien`}</button>
      ${typeof navigator.share === 'function' && html`<button class="btn" onClick=${share}><${Ico} name="share" />Envoyer…</button>`}
    </div>
  </div>`;
}

/* ---------- parties de la fenêtre ---------- */
function SizeMeter({ length, mode }) {
  const steps = [
    ['qr', 'QR code et lien', `jusqu'à ${S.frNumber(S.QR_MAX)} caractères`],
    ['link', 'Lien seul', `jusqu'à ${S.frNumber(S.LINK_MAX)} caractères`],
    ['file', 'Fichier seulement', 'au-delà'],
  ];
  return html`<div class="share-size">
    <p>Longueur du lien : <b class="mono">${S.frNumber(length)}</b> caractères.</p>
    <ol class="share-meter" aria-label="Ce que permet la longueur du lien">
      ${steps.map(([k, label, hint]) => html`<li key=${k} aria-current=${k === mode ? 'step' : undefined}>
        <b>${label}</b><span>${hint}</span>${k === mode && html`<span class="share-here"><${Icon} name="check" />votre lien</span>`}
      </li>`)}
    </ol>
  </div>`;
}

function MediaNote({ removed }) {
  const images = removed.filter(r => r.kind === 'image').length, sounds = removed.length - images;
  if (!removed.length) return html`<p class="subtle">Un lien ne transporte ni images ni sons ; cette aventure n'en a pas sur cet appareil, rien ne manquera à l'arrivée.</p>`;
  const what = [images && plural(images, 'image', 'images'), sounds && plural(sounds, 'son', 'sons')].filter(Boolean).join(' et ');
  return html`<div class="share-note" role="note">
    <${Icon} name="image" />
    <p><b>Sans les images ni les sons.</b> ${what} de cette aventure ne voyage${removed.length > 1 ? 'nt' : ''} pas dans un lien :
      la personne qui l'ouvrira aura le texte, les règles, les combats et les objets, mais pas les illustrations. Pour tout transmettre, envoyez le fichier (plus bas).</p>
  </div>`;
}

function PublishedPart({ url, title }) {
  return html`<section class="share-part" aria-label="Lien direct">
    <div class="share-grid">
      <div class="stack">
        <h3><${Ico} name="link" />Lien direct</h3>
        <p>Cette aventure est publiée avec le site : ce lien l'ouvre directement, prête à jouer, sur n'importe quel appareil.</p>
        <${LinkField} url=${url} title=${title} />
      </div>
      <${QrFigure} url=${url} title=${title} caption="Scannez ce code avec l'appareil photo d'un téléphone ou d'une tablette : l'aventure s'ouvre, prête à jouer." />
    </div>
  </section>`;
}

function MagicPart({ url, mode, removed, title }) {
  const intro = html`<h3><${Ico} name="link" />Lien magique</h3>
    <p>Cette aventure n'existe que sur cet appareil. Le lien magique la contient tout entière, compressée :
      la personne qui l'ouvre peut l'ajouter à sa bibliothèque, sans compte ni serveur.</p>`;
  return html`<section class="share-part" aria-label="Lien magique">
    ${mode === 'qr' ? html`<div class="share-grid">
        <div class="stack">${intro}<${LinkField} url=${url} title=${title} /></div>
        <${QrFigure} url=${url} title=${title} caption="Scannez ce code avec l'appareil photo d'un téléphone ou d'une tablette : l'aventure s'ouvre et peut être ajoutée à sa bibliothèque." />
      </div>`
      : html`${intro}`}
    <${MediaNote} removed=${removed} />
    <${SizeMeter} length=${url.length} mode=${mode} />
    ${mode === 'link' && html`
      <div class="share-note" role="note"><${Ico} name="qr" />
        <p><b>Pas de QR code pour ce lien.</b> Au-delà de ${S.frNumber(S.QR_MAX)} caractères, le code serait trop dense pour qu'un téléphone le lise.
          Copiez le lien et envoyez-le par message ou par courriel. Certaines messageries coupent les liens très longs : s'il arrive incomplet, envoyez plutôt le fichier.</p>
      </div>
      <${LinkField} url=${url} title=${title} />`}
    ${mode === 'file' && html`<div class="share-note" role="note"><${Ico} name="file" />
      <p><b>Lien trop long.</b> Il ferait ${S.frNumber(url.length)} caractères (au-delà de ${S.frNumber(S.LINK_MAX)}, les messageries et les navigateurs le couperaient). Envoyez plutôt le fichier de l'aventure, ci-dessous.</p>
    </div>`}
  </section>`;
}

function FilePart({ file, title }) {
  const ready = file instanceof File;
  let canShare = false;
  try { canShare = ready && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }); } catch { canShare = false; }
  const send = async () => {
    if (canShare) {
      try { await navigator.share({ files: [file], title }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    download(file, file.name);
    toast(`« ${file.name} » est dans vos téléchargements.`);
  };
  return html`<section class="share-part" aria-label="Fichier de l'aventure">
    <h3><${Ico} name="file" />Fichier de l'aventure</h3>
    <p>Le fichier <b>.lhz</b> contient tout : texte, règles, images et sons. Envoyez-le par courriel, messagerie, clé USB ou ENT ;
      la personne l'ouvre avec « Importer (.lhz) » dans sa bibliothèque.</p>
    <div class="row">
      <button class="btn" disabled=${!ready} onClick=${send}><${Icon} name=${canShare ? 'upload' : 'download'} />${canShare ? 'Envoyer le fichier…' : 'Télécharger le fichier'}</button>
      <span class="subtle" role="status">${!file ? 'Préparation du fichier…' : file.error ? `Fichier indisponible : ${file.error}` : `${file.name} · ${S.frSize(file.size)}`}</span>
    </div>
  </section>`;
}

/** Fenêtre « Partager » pour une aventure publiée (source 'bundled') ou locale ('local'). */
export function ShareModal({ adv, source, onClose }) {
  const published = source === 'bundled';
  const [link, setLink] = useState(null);   // { url, mode, removed } | { error }
  const [file, setFile] = useState(null);   // File | { error }
  useEffect(() => {
    let on = true;
    // La compression peut prendre un instant sur une grande aventure : on laisse d'abord la fenêtre s'afficher.
    const t = setTimeout(() => {
      if (!on) return;
      try {
        if (published) { const url = S.playLink(appBase(), adv.id); setLink({ url, mode: 'qr', removed: [] }); return; }
        const r = S.packAdventure(adv);
        const url = S.importLink(appBase(), r.token);
        setLink({ url, mode: S.shareMode(url.length), removed: r.removed });
      } catch (e) { setLink({ error: e.message }); }
    }, 30);
    // Le fichier est préparé d'avance : navigator.share doit être appelé tout de suite après le clic.
    exportAdventure(adv, source)
      .then(b => on && setFile(new File([b], `${slug(adv.meta.title)}.lhz`, { type: 'application/zip' })))
      .catch(e => on && setFile({ error: e.message }));
    return () => { on = false; clearTimeout(t); };
  }, []);
  const title = adv.meta.title || 'Sans titre';
  return html`<${Portal}><${Modal} title=${`Partager « ${title} »`} onClose=${onClose}>
    <div class="share" lang="fr">
      ${onThisComputerOnly() && html`<div class="share-note" role="note"><${Ico} name="warn" />
        <p><b>Attention :</b> Livre-Héros est ouvert depuis cet ordinateur (${location.host || 'fichier local'}). Les liens et QR codes ci-dessous ne fonctionneront que sur cet appareil ;
          pour les partager, ouvrez l'aventure depuis le site en ligne, ou envoyez le fichier.</p></div>`}
      ${!link ? html`<p class="muted" role="status">Préparation du lien…</p>`
        : link.error ? html`<div class="share-note" role="alert"><${Ico} name="warn" /><p><b>Lien impossible à préparer :</b> ${link.error}</p></div>`
        : published ? html`<${PublishedPart} url=${link.url} title=${title} />`
        : html`<${MagicPart} url=${link.url} mode=${link.mode} removed=${link.removed} title=${title} />`}
      <${FilePart} file=${file} title=${title} />
    </div>
  <//><//>`;
}

/* ---------- bouton « Partager » : cartes de la bibliothèque et éditeur ---------- */
function CardShare({ entry }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try { setData(await loadAdventure(entry.id)); } catch (e) { toast(`Partage impossible : ${e.message}`); }
    setBusy(false);
  };
  return html`<button class="btn small" onClick=${open} aria-busy=${busy ? 'true' : undefined} aria-label=${`Partager « ${entry.title} »`} title="Partager : lien, QR code ou fichier"><${Ico} name="share" />Partager</button>
    ${data && html`<${ShareModal} adv=${data.adventure} source=${data.source} onClose=${() => setData(null)} />`}`;
}
registerCardAction({ id: 'partage', order: 10, Action: CardShare });

function EditorShare({ adv }) {
  const [open, setOpen] = useState(false);
  return html`<button class="btn small" onClick=${() => setOpen(true)} title="Partager : lien magique, QR code ou fichier"><${Ico} name="share" />Partager</button>
    ${open && html`<${ShareModal} adv=${adv} source="local" onClose=${() => setOpen(false)} />`}`;
}
registerEditorAction({ id: 'partage', order: 10, Action: EditorShare });

/* ---------- bibliothèque : « Ouvrir un lien » ---------- */
/** Contenu de la fenêtre « Ouvrir un lien » : l'état vit ici, sous le portail, pour que la saisie reste fluide. */
function OpenLinkForm({ onDone }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const id = useUid('share-paste');
  // La fenêtre donne le focus à son bouton Fermer : on le place ensuite sur le champ à remplir.
  useEffect(() => { const t = setTimeout(() => document.getElementById(id)?.focus(), 60); return () => clearTimeout(t); }, []);
  const go = e => {
    e?.preventDefault();
    const r = S.parseSharedLink(text);
    if (!r) { setError('Ce texte ne ressemble pas à un lien Livre-Héros. Un lien magique contient « #/importer/ », un lien direct « #/jouer/ ».'); return; }
    onDone();
    location.hash = r.kind === 'import' ? `#/importer/${r.token}` : `#/jouer/${encodeURIComponent(r.id)}`;
  };
  return html`<form class="stack share" lang="fr" onSubmit=${go}>
    <label class="field" for=${id}>Lien magique ou lien direct
      <textarea id=${id} rows="4" class="share-url" spellcheck="false" placeholder="https://…/#/importer/…" value=${text}
        onInput=${e => { setText(e.target.value); setError(''); }} aria-describedby=${error ? id + '-err' : undefined}></textarea></label>
    ${error && html`<div class="share-note" role="alert" id=${id + '-err'}><${Ico} name="warn" /><p>${error}</p></div>`}
    <p class="subtle">Collez ici le lien qu'on vous a envoyé. C'est utile quand l'application installée sur l'appareil ne s'ouvre pas toute seule depuis un message.</p>
    <div class="row"><button class="btn primary" type="submit" disabled=${!text.trim()}>Ouvrir</button></div>
  </form>`;
}

function OpenLink() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return html`<button class="btn" onClick=${() => setOpen(true)}><${Ico} name="link" />Ouvrir un lien</button>
    ${open && html`<${Portal}><${Modal} title="Ouvrir un lien reçu" onClose=${close}><${OpenLinkForm} onDone=${close} /><//><//>`}`;
}
registerLibraryAction({ id: 'partage', order: 10, Action: OpenLink });

/* ---------- page #/importer/<jeton> ---------- */
function ImportPage({ id }) {
  const result = useMemo(() => {
    try { return S.unpackAdventure(id || ''); } catch (e) { return { error: e }; }
  }, [id]);
  const [lib, setLib] = useState(null);
  const [added, setAdded] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!result.error) listLibrary().then(setLib).catch(() => setLib([])); }, [id]);

  if (result.error) {
    const e = result.error;
    const title = e.title || 'Ce lien magique est abîmé';
    return html`<main class="page share-import" lang="fr">
      <span class="eyebrow">Lien magique</span>
      <div class="share-alert" role="alert">
        <${Ico} name="warn" />
        <div class="stack" style="gap:6px"><h1>${title}</h1><p>${e.message}</p></div>
      </div>
      <p>${e.code === 'version' ? 'Si le problème persiste, demandez à la personne de vous envoyer le fichier .lhz de l’aventure.'
        : 'Demandez à la personne de vous renvoyer le lien en entier (avec le bouton « Copier le lien » de la fenêtre Partager), ou de vous envoyer le fichier .lhz de l’aventure.'}</p>
      <div class="row"><a class="btn primary" href="#/"><${Icon} name="back" />Retour à la bibliothèque</a></div>
    </main>`;
  }

  const adv = result.adventure;
  const same = lib?.find(e => e.id === adv.id) || null;
  const sections = Object.keys(adv.sections).length;
  const items = Object.keys(adv.items || {}).length;
  const endings = Object.values(adv.sections).filter(s => s.ending === 'victory').length;
  const add = async () => {
    setBusy(true);
    try {
      const copy = structuredClone(adv);
      const taken = new Set((await listLibrary()).map(e => e.id));
      if (taken.has(copy.id)) copy.id = S.uniqueId(copy.meta.title, taken);
      const saved = await saveAdventure(copy);
      setAdded(saved);
      toast(`« ${saved.meta.title} » a rejoint votre bibliothèque.`);
    } catch (e) { toast(`Ajout impossible : ${e.message}`); }
    setBusy(false);
  };
  return html`<main class="page share-import" lang="fr">
    <span class="eyebrow">Lien magique · aventure reçue</span>
    <article class="share-preview" aria-labelledby="share-import-title">
      <h1 id="share-import-title">${adv.meta.title}</h1>
      ${adv.meta.author && html`<p class="muted share-author">par ${adv.meta.author}</p>`}
      ${adv.meta.description && html`<div class="prose"><p>${adv.meta.description}</p></div>`}
      <ul class="share-facts" aria-label="Contenu de l'aventure">
        <li><b>${S.frNumber(sections)}</b> paragraphe${sections > 1 ? 's' : ''}</li>
        ${items > 0 && html`<li><b>${S.frNumber(items)}</b> objet${items > 1 ? 's' : ''}</li>`}
        ${endings > 0 && html`<li><b>${S.frNumber(endings)}</b> fin${endings > 1 ? 's' : ''} victorieuse${endings > 1 ? 's' : ''}</li>`}
      </ul>
      ${result.missingMedia > 0 && html`<div class="share-note" role="note"><${Icon} name="image" />
        <p><b>Version sans images.</b> ${plural(result.missingMedia, 'image ou son n’a', 'images ou sons n’ont')} pas pu voyager dans le lien. Pour les avoir, demandez le fichier .lhz de l’aventure.</p></div>`}
    </article>
    ${!added && same && html`<div class="share-note" role="note"><${Ico} name="info" />
      <p>Vous avez déjà « ${same.title} » ${same.source === 'local' ? 'sur cet appareil' : 'parmi les aventures publiées'}. Elle ne sera pas remplacée : l'aventure reçue sera ajoutée à côté, comme une nouvelle aventure.</p></div>`}
    ${added ? html`
      <p class="share-done" role="status"><${Icon} name="check" />« ${added.meta.title} » est maintenant dans votre bibliothèque.</p>
      <div class="row">
        <a class="btn primary" href=${`#/jouer/${encodeURIComponent(added.id)}`}><${Icon} name="play" />Jouer</a>
        <a class="btn" href=${`#/ecrire/${encodeURIComponent(added.id)}`}><${Icon} name="edit" />Modifier</a>
        <a class="btn" href="#/"><${Icon} name="book" />Bibliothèque</a>
      </div>`
    : html`<div class="row">
        <button class="btn primary" onClick=${add} disabled=${busy || lib === null}><${Icon} name="plus" />Ajouter à ma bibliothèque</button>
        ${same && html`<a class="btn" href=${`#/jouer/${encodeURIComponent(same.id)}`}><${Icon} name="play" />Jouer à celle que j'ai déjà</a>`}
        <a class="btn ghost" href="#/">Annuler</a>
      </div>`}
  </main>`;
}
registerRoute('importer', ImportPage);

/* ---------- version imprimable : QR code vers la version numérique (aventures publiées) ---------- */
function PrintQr({ adv }) {
  const [source, setSource] = useState(null);
  useEffect(() => { let on = true; loadAdventure(adv.id).then(r => on && setSource(r.source)).catch(() => {}); return () => { on = false; }; }, [adv.id]);
  const url = S.playLink(appBase(), adv.id);
  const qr = useMemo(() => S.qrMatrix(url), [url]);
  if (source !== 'bundled' || !qr) return null;
  return html`<div class="share-print">
    <${QrImage} qr=${qr} label=${`QR code : jouer à « ${adv.meta.title} » sur écran`} />
    <p><b>Version numérique.</b> Scannez ce code pour jouer à ce livre sur téléphone, tablette ou ordinateur :
      les dés, les combats et la Feuille d'Aventure y sont tenus pour vous.<br /><span class="share-print-url">${url}</span></p>
  </div>`;
}
registerPrintSection({ where: 'rules', order: 90, Section: PrintQr });
