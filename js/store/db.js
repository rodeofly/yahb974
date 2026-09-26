// Stockage local (IndexedDB) : aucune base de données serveur.
// Magasins : adventures (JSON), assets (Blob des images), saves (parties).

const DB_NAME = 'livre-heros';
const VERSION = 2;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('adventures')) db.createObjectStore('adventures', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
      // v2 : magasin clé-valeur réservé aux greffons (statistiques, succès…).
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(r => { out = r; });
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* Aventures */
export const listAdventures = () => tx('adventures', 'readonly', s => req(s.getAll()));
export const getAdventure = id => tx('adventures', 'readonly', s => req(s.get(id))).then(r => r?.adventure || null);
export function putAdventure(adventure) {
  const rec = { id: adventure.id, adventure: { ...adventure, meta: { ...adventure.meta, updated: new Date().toISOString() } } };
  return tx('adventures', 'readwrite', s => s.put(rec)).then(() => rec.adventure);
}
export async function deleteAdventure(id) {
  await tx('adventures', 'readwrite', s => s.delete(id));
  const keys = await tx('assets', 'readonly', s => req(s.getAllKeys()));
  await tx('assets', 'readwrite', s => keys.filter(k => k.startsWith(id + '|')).forEach(k => s.delete(k)));
  const saves = await tx('saves', 'readonly', s => req(s.getAllKeys()));
  await tx('saves', 'readwrite', s => saves.filter(k => k.startsWith(id + '|')).forEach(k => s.delete(k)));
}

/* Images et autres fichiers d'une aventure */
export const putAsset = (advId, path, blob) => tx('assets', 'readwrite', s => s.put(blob, `${advId}|${path}`));
export const getAsset = (advId, path) => tx('assets', 'readonly', s => req(s.get(`${advId}|${path}`)));
export const deleteAsset = (advId, path) => tx('assets', 'readwrite', s => s.delete(`${advId}|${path}`));
export async function listAssets(advId) {
  const keys = await tx('assets', 'readonly', s => req(s.getAllKeys()));
  return keys.filter(k => k.startsWith(advId + '|')).map(k => k.slice(advId.length + 1));
}

/* Parties sauvegardées */
export const putSave = (advId, slot, data) => tx('saves', 'readwrite', s => s.put({ ...data, slot, savedAt: new Date().toISOString() }, `${advId}|${slot}`));
export const getSave = (advId, slot) => tx('saves', 'readonly', s => req(s.get(`${advId}|${slot}`)));
export const deleteSave = (advId, slot) => tx('saves', 'readwrite', s => s.delete(`${advId}|${slot}`));
export async function listSaves(advId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out = [];
    const r = db.transaction('saves').objectStore('saves').openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve(out.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
      if (String(c.key).startsWith(advId + '|')) out.push(c.value);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  });
}

/* Magasin clé-valeur des greffons : préfixez vos clés par le nom du greffon (ex. « stats|<aventure> »). */
export const kvGet = key => tx('kv', 'readonly', s => req(s.get(key)));
export const kvPut = (key, value) => tx('kv', 'readwrite', s => s.put(value, key));
export const kvDelete = key => tx('kv', 'readwrite', s => s.delete(key));
export async function kvList(prefix) {
  const keys = await tx('kv', 'readonly', s => req(s.getAllKeys()));
  const out = {};
  for (const k of keys.filter(k => String(k).startsWith(prefix))) out[k] = await kvGet(k);
  return out;
}

/** Demande au navigateur de ne pas effacer les données (utile sur mobile). */
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
