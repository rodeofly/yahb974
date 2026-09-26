// Service worker : l'application fonctionne hors ligne après la première visite.
// - Fichiers de l'application : servis depuis le cache, mis à jour en arrière-plan.
// - Aventures publiées (adventures/) : réseau d'abord, cache si hors ligne.
// Changer VERSION à chaque mise en ligne force le rafraîchissement du cache.

const VERSION = 'lh-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/lib/preact-htm.js', 'js/lib/cytoscape.min.js', 'js/lib/fflate.js', 'js/lib/d3.min.js', 'js/lib/dagre.min.js', 'js/lib/cytoscape-dagre.min.js',
  'js/lib/katex/katex.min.js', 'js/lib/katex/katex.min.css', 'js/lib/qrcode/qrcode.js',
  'js/core/analysis.js', 'js/core/dice.js', 'js/core/rules.js', 'js/core/combat.js', 'js/core/validate.js', 'js/core/plugins.js',
  'js/store/db.js', 'js/store/library.js',
  'js/ui/common.js', 'js/ui/library.js', 'js/ui/play.js', 'js/ui/editor.js', 'js/ui/graph.js', 'js/ui/print.js', 'js/ui/audio.js', 'js/ui/registry.js',
  // Greffons (voir docs/PLUGINS.md) : tests/sw.test.mjs vérifie que chaque fichier y figure.
  'js/plugins/index.js', 'js/plugins/core.js',
  'js/plugins/equipement/core.js', 'js/plugins/equipement/index.js', 'js/plugins/equipement/style.css',
  'js/plugins/compteurs/core.js', 'js/plugins/compteurs/index.js', 'js/plugins/compteurs/style.css',
  'js/plugins/compagnons/core.js', 'js/plugins/compagnons/index.js', 'js/plugins/compagnons/style.css',
  'js/plugins/defis/core.js', 'js/plugins/defis/index.js', 'js/plugins/defis/style.css',
  'js/plugins/zefor/core.js', 'js/plugins/zefor/index.js', 'js/plugins/zefor/style.css',
  'js/plugins/maths/index.js', 'js/plugins/maths/parse.js', 'js/plugins/maths/render.js', 'js/plugins/maths/aide.js', 'js/plugins/maths/style.css',
  'js/plugins/carte/core.js', 'js/plugins/carte/index.js', 'js/plugins/carte/style.css',
  'js/plugins/succes/core.js', 'js/plugins/succes/index.js', 'js/plugins/succes/style.css',
  'js/plugins/echanges/core.js', 'js/plugins/echanges/index.js', 'js/plugins/echanges/style.css',
  'js/plugins/partage/core.js', 'js/plugins/partage/index.js', 'js/plugins/partage/style.css',
  'js/plugins/accessibilite/core.js', 'js/plugins/accessibilite/index.js', 'js/plugins/accessibilite/style.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'adventures/index.json',
];
// Feuilles de style dont les polices (url(….woff2)) sont mises en cache à l'installation.
const FONT_SHEETS = ['css/fonts.css', 'js/lib/katex/katex.min.css', 'js/plugins/accessibilite/style.css'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // Les polices sont listées dans ces feuilles : on les met en cache aussi (chemins relatifs à chaque feuille).
    const fonts = new Set();
    for (const sheet of FONT_SHEETS) {
      const base = new URL(sheet, self.registration.scope);
      const css = await (await fetch(base)).text();
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g)) fonts.add(new URL(m[1], base).href);
    }
    await cache.addAll([...fonts]);
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
  if (url.pathname.includes('/adventures/')) { e.respondWith(networkFirst(e.request)); return; }
  e.respondWith(staleWhileRevalidate(e.request, e));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || new Response('Hors ligne', { status: 503 });
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  return (await update) || (await cache.match('index.html')) || new Response('Hors ligne', { status: 503 });
}
