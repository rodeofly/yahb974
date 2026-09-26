// Service worker : l'application fonctionne hors ligne après la première visite.
// - Fichiers de l'application : servis depuis le cache, mis à jour en arrière-plan.
// - Aventures publiées (adventures/) : réseau d'abord, cache si hors ligne.
// Changer VERSION à chaque mise en ligne force le rafraîchissement du cache.

const VERSION = 'lh-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/lib/preact-htm.js', 'js/lib/cytoscape.min.js', 'js/lib/fflate.js', 'js/lib/d3.min.js', 'js/lib/dagre.min.js', 'js/lib/cytoscape-dagre.min.js', 'js/core/analysis.js',
  'js/core/dice.js', 'js/core/rules.js', 'js/core/combat.js', 'js/core/validate.js',
  'js/store/db.js', 'js/store/library.js',
  'js/ui/common.js', 'js/ui/library.js', 'js/ui/play.js', 'js/ui/editor.js', 'js/ui/graph.js', 'js/ui/print.js', 'js/ui/audio.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'adventures/index.json',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // Les polices sont listées dans fonts.css : on les met en cache aussi.
    const css = await (await fetch('css/fonts.css')).text();
    const fonts = [...css.matchAll(/url\(\.\.\/(fonts\/[^)]+)\)/g)].map(m => m[1]);
    await cache.addAll([...new Set(fonts)]);
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
