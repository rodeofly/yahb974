// Bibliothèque : aventures publiées avec le site (dossier adventures/) + aventures locales (IndexedDB).
// Import / export d'une aventure en fichier .lhz (zip : adventure.json + images/).

import { zipSync, unzipSync, strToU8, strFromU8 } from '../lib/fflate.js';
import * as db from './db.js';
import { normalizeAdventure, slug } from '../core/rules.js';

const BUNDLED = 'adventures/';

/** Liste : [{ id, title, author, description, cover, source: 'bundled'|'local', updated, sections }] */
export async function listLibrary() {
  const out = [];
  try {
    const idx = await fetch(BUNDLED + 'index.json').then(r => (r.ok ? r.json() : []));
    for (const e of idx) out.push({ ...e, source: 'bundled' });
  } catch { /* hors ligne sans cache : on continue avec les aventures locales */ }
  for (const rec of await db.listAdventures()) {
    const a = rec.adventure;
    out.push({ id: a.id, title: a.meta.title, author: a.meta.author, description: a.meta.description, cover: a.meta.cover, source: 'local', updated: a.meta.updated, sections: Object.keys(a.sections).length });
  }
  return out;
}

/** Charge une aventure. Les aventures locales ont priorité sur celles du site. */
export async function loadAdventure(id) {
  const local = await db.getAdventure(id);
  if (local) return { adventure: normalizeAdventure(local), source: 'local' };
  const res = await fetch(`${BUNDLED}${encodeURIComponent(id)}/adventure.json`);
  if (!res.ok) throw new Error(`Aventure introuvable : ${id}`);
  return { adventure: normalizeAdventure(await res.json()), source: 'bundled' };
}

export const saveAdventure = adv => db.putAdventure(adv);

/* ---------- Images ---------- */
const urlCache = new Map();

/** URL affichable pour une image référencée par l'aventure ("images/1.webp"). */
export async function assetUrl(adv, source, path) {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const key = `${adv.id}|${path}`;
  if (urlCache.has(key)) return urlCache.get(key);
  let url = null;
  if (source === 'local') {
    const blob = await db.getAsset(adv.id, path);
    if (blob) url = URL.createObjectURL(blob);
  }
  if (!url) url = `${BUNDLED}${encodeURIComponent(adv.id)}/${path}`;
  urlCache.set(key, url);
  return url;
}

export function forgetAssetUrl(adv, path) {
  const key = `${adv.id}|${path}`;
  const url = urlCache.get(key);
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  urlCache.delete(key);
}

/** Réduit et compresse une image dans le navigateur (WebP, 1600 px max). */
export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  return blob.size < file.size ? blob : file;
}

/** Enregistre une image pour une aventure locale et renvoie son chemin. */
export async function addImage(adv, file, name) {
  const blob = await compressImage(file);
  const ext = blob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `images/${slug(name || file.name.replace(/\.[^.]+$/, ''))}-${Date.now().toString(36)}.${ext}`;
  await db.putAsset(adv.id, path, blob);
  return path;
}

/** Enregistre un fichier audio (ambiance) pour une aventure locale et renvoie son chemin. */
export async function addAudio(adv, file, name) {
  if (file.size > 15 * 1024 * 1024) throw new Error('fichier trop lourd (15 Mo maximum)');
  const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
  const path = `sons/${slug(name || file.name.replace(/\.[^.]+$/, ''))}-${Date.now().toString(36)}.${ext}`;
  await db.putAsset(adv.id, path, file);
  return path;
}

/* ---------- Import / export .lhz ---------- */

function imagePaths(adv) {
  const paths = new Set();
  if (adv.meta.cover) paths.add(adv.meta.cover);
  if (adv.meta.sound) paths.add(adv.meta.sound);
  Object.values(adv.sections).forEach(s => {
    if (s.image) paths.add(s.image);
    if (s.sound) paths.add(s.sound);
    (s.blocks || []).forEach(b => (b.enemies || []).forEach(e => e.image && paths.add(e.image)));
  });
  Object.values(adv.items).forEach(i => i.image && paths.add(i.image));
  Object.values(adv.companions || {}).forEach(c => c?.image && paths.add(c.image)); // portraits (greffon compagnons)
  return [...paths].filter(p => !/^(https?:|data:|blob:)/.test(p));
}

/** Construit le fichier .lhz d'une aventure (locale ou publiée). */
export async function exportAdventure(adv, source) {
  const files = { 'adventure.json': strToU8(JSON.stringify(adv, null, 2)) };
  for (const p of imagePaths(adv)) {
    let blob = source === 'local' ? await db.getAsset(adv.id, p) : null;
    if (!blob) { try { const r = await fetch(`${BUNDLED}${encodeURIComponent(adv.id)}/${p}`); if (r.ok) blob = await r.blob(); } catch { /* image absente */ } }
    if (blob) files[p] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };

/** Importe un .lhz (ou un adventure.json seul). Renvoie l'aventure enregistrée localement. */
export async function importAdventure(file, { asCopy = false } = {}) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let adv, files = {};
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    files = unzipSync(buf);
    const json = files['adventure.json'] || Object.entries(files).find(([k]) => k.endsWith('adventure.json'))?.[1];
    if (!json) throw new Error('Ce fichier ne contient pas de adventure.json.');
    adv = JSON.parse(strFromU8(json));
  } else {
    adv = JSON.parse(new TextDecoder().decode(buf));
  }
  adv = normalizeAdventure(adv);
  if (asCopy || !adv.id) adv.id = slug(adv.meta.title) + '-' + Math.random().toString(36).slice(2, 6);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.endsWith('adventure.json')) continue;
    const ext = name.split('.').pop().toLowerCase();
    await db.putAsset(adv.id, name.replace(/^[^/]*\/(?=(images|sons)\/)/, ''), new Blob([data], { type: MIME[ext] || 'application/octet-stream' }));
  }
  return db.putAdventure(adv);
}

/** Copie une aventure publiée (ou locale) pour la modifier. */
export async function duplicateAdventure(adv, source, title) {
  const blob = await exportAdventure(adv, source);
  const copy = await importAdventure(new File([blob], 'copie.lhz'), { asCopy: true });
  copy.meta.title = title || `${adv.meta.title} (copie)`;
  return db.putAdventure(copy);
}

/** Déclenche le téléchargement d'un Blob. */
export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
