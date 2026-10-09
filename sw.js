// Service worker : l'application fonctionne hors ligne après la première visite.
// - Fichiers de l'application : servis depuis le cache, mis à jour en arrière-plan (requête conditionnelle).
// - Paquet zefor (vendor/zefor/, mode intégré du greffon zefor) : PAS dans SHELL (≈ 600 Ko compressés que seuls les
//   défis intégrés utilisent) ; mis en cache à la première utilisation, comme tout fichier du même site.
// - Aventures publiées (adventures/) : préchargées à l'installation (adventure.json et fichiers cités) ;
//   ensuite réseau d'abord, mais au plus 2,5 s d'attente quand une copie est en cache.
// Changer VERSION à chaque mise en ligne force le rafraîchissement du cache (les fichiers sont relus sur le
// réseau en contournant le cache HTTP du navigateur).
const VERSION = 'lh-v18';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/version.js', 'js/lib/preact-htm.js', 'js/lib/cytoscape.min.js', 'js/lib/fflate.js', 'js/lib/d3.min.js', 'js/lib/dagre.min.js', 'js/lib/cytoscape-dagre.min.js',
  'js/lib/katex/katex.min.js', 'js/lib/katex/katex.min.css', 'js/lib/qrcode/qrcode.js',
  'js/core/analysis.js', 'js/core/dice.js', 'js/core/rules.js', 'js/core/combat.js', 'js/core/validate.js', 'js/core/plugins.js',
  'js/store/db.js', 'js/store/library.js',
  'js/ui/common.js', 'js/ui/library.js', 'js/ui/play.js', 'js/ui/editor.js', 'js/ui/graph.js', 'js/ui/print.js', 'js/ui/audio.js', 'js/ui/registry.js',
  // Greffons (voir docs/PLUGINS.md) : tests/sw.test.mjs vérifie que chaque fichier y figure.
  'js/plugins/index.js', 'js/plugins/core.js',
  'js/plugins/equipement/core.js', 'js/plugins/equipement/index.js', 'js/plugins/equipement/style.css',
  'js/plugins/objets/core.js', 'js/plugins/objets/index.js', 'js/plugins/objets/style.css',
  'js/plugins/compteurs/core.js', 'js/plugins/compteurs/index.js', 'js/plugins/compteurs/style.css',
  'js/plugins/compagnons/core.js', 'js/plugins/compagnons/index.js', 'js/plugins/compagnons/style.css',
  'js/plugins/campagne/core.js', 'js/plugins/campagne/index.js', 'js/plugins/campagne/style.css',
  'js/plugins/defis/core.js', 'js/plugins/defis/index.js', 'js/plugins/defis/style.css',
  'js/plugins/zefor/core.js', 'js/plugins/zefor/index.js', 'js/plugins/zefor/style.css',
  'js/plugins/modes/core.js', 'js/plugins/modes/index.js', 'js/plugins/modes/style.css',
  'js/plugins/maths/index.js', 'js/plugins/maths/parse.js', 'js/plugins/maths/render.js', 'js/plugins/maths/aide.js', 'js/plugins/maths/style.css',
  'js/plugins/carte/core.js', 'js/plugins/carte/index.js', 'js/plugins/carte/style.css',
  'js/plugins/succes/core.js', 'js/plugins/succes/index.js', 'js/plugins/succes/style.css',
  'js/plugins/echanges/core.js', 'js/plugins/echanges/index.js', 'js/plugins/echanges/style.css',
  'js/plugins/partage/core.js', 'js/plugins/partage/index.js', 'js/plugins/partage/style.css',
  'js/plugins/accessibilite/core.js', 'js/plugins/accessibilite/index.js', 'js/plugins/accessibilite/style.css',
  'js/plugins/inventaire/core.js', 'js/plugins/inventaire/index.js', 'js/plugins/inventaire/style.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'adventures/index.json',
];
// Feuilles de style dont les polices (url(….woff2)) sont mises en cache à l'installation.
// Les polices d'accessibilité (OpenDyslexic, Atkinson) ne sont mises en cache qu'au premier choix de l'une d'elles.
const FONT_SHEETS = ['css/fonts.css', 'js/lib/katex/katex.min.css'];
const NETWORK_WAIT = 2500;
const fresh = u => new Request(u, { cache: 'reload' });

/** Chemins de fichiers cités par une aventure (images/…, sons/…), où qu'ils soient dans le JSON (greffons compris). */
function assetsOf(adv) {
  const out = new Set();
  const walk = v => {
    if (typeof v === 'string') { if (/^(images|sons)\/[^\s?#]+$/.test(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(adv);
  return [...out];
}

/** Précharge les aventures publiées : chacune pour elle-même, un fichier manquant n'empêche pas l'installation. */
async function precacheAdventures(cache) {
  let list = [];
  try { list = await (await fetch(fresh('adventures/index.json'))).json(); } catch { return; }
  await Promise.all((Array.isArray(list) ? list : []).map(async entry => {
    const dir = `adventures/${encodeURIComponent(entry.id)}/`;
    try {
      const res = await fetch(fresh(dir + 'adventure.json'));
      if (!res.ok) return;
      await cache.put(dir + 'adventure.json', res.clone());
      const files = Array.isArray(entry.files) ? entry.files : assetsOf(await res.json());
      if (entry.cover && !files.includes(entry.cover)) files.push(entry.cover);
      await Promise.all(files.map(f => cache.add(fresh(dir + f)).catch(() => {})));
    } catch { /* aventure indisponible : elle restera en ligne seulement */ }
  }));
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache: 'reload' : jamais l'ancienne version gardée par le cache HTTP (max-age de GitHub Pages).
    await cache.addAll(SHELL.map(fresh));
    // Les polices sont listées dans ces feuilles : on les met en cache aussi (chemins relatifs à chaque feuille).
    const fonts = new Set();
    for (const sheet of FONT_SHEETS) {
      const base = new URL(sheet, self.registration.scope);
      const css = await (await fetch(fresh(base))).text();
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g)) fonts.add(new URL(m[1], base).href);
    }
    await cache.addAll([...fonts].map(fresh));
    await precacheAdventures(cache);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/adventures/')) { e.respondWith(networkFirst(e.request, e)); return; }
  e.respondWith(staleWhileRevalidate(e.request, e));
});

/** Réseau d'abord ; si une copie est en cache et que le réseau tarde, on la sert et le réseau met le cache à jour. */
async function networkFirst(req, event) {
  const cache = await caches.open(VERSION);
  const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  event.waitUntil(net.catch(() => null));
  const hit = await cache.match(req);
  if (!hit) {
    try { return await net; } catch { return new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' }); }
  }
  const late = new Promise(res => setTimeout(() => res(null), NETWORK_WAIT));
  try {
    const res = await Promise.race([net.then(r => r.clone()), late]);
    return res && res.ok ? res : hit;
  } catch { return hit; }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  // Requête conditionnelle (If-None-Match) : 304 quand rien n'a changé, jamais une copie périmée du cache HTTP.
  const update = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  // Hors ligne sans copie : la page d'accueil pour une navigation seulement. Un script ou une feuille absents
  // (ex. le paquet vendor/zefor/ jamais chargé) reçoivent une vraie erreur, que l'application sait afficher.
  return (await update) || (req.mode === 'navigate' && (await cache.match('index.html'))) || new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
}
