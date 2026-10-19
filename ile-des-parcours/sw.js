/* L’île des parcours — anonymous, allowlisted, versioned static shell only. */
const CACHE_VERSION = "fb1fe3ed49562d3b882b";
const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = `ile-des-parcours:${encodeURIComponent(SCOPE_URL.pathname)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Kept as JSON syntax so platforms/package.py can verify and fingerprint it.
const SHELL_FILES = [
  "index.html",
  "style.css",
  "app.js",
  "sample.js",
  "graph-engine.js",
  "world.js",
  "ocean-surface.js",
  "exploration-ui.js",
  "exploration-ui.css",
  "player-controller.js",
  "frame-pacing.js",
  "glider-visual.js",
  "tenrec-avatar.js",
  "landscape-decor.js",
  "terrain-renderer.js",
  "dynamic-labels.js",
  "fil-ariane.css",
  "fil-ariane-ui.js",
  "trail-layer.js",
  "trail-math.js",
  "troop.js",
  "helicopter.js",
  "skydive.js",
  "camera-blend.js",
  "rocket-pack.js",
  "chest.js",
  "ilet.js",
  "river-layer.js",
  "trail-map-ui.js",
  "forest-types.js",
  "rivers/rivieres.json",
  "trails/fil-ariane.json",
  "trails/zarboutans.json",
  "trails/fiches/itineraire-1.webp",
  "trails/fiches/itineraire-2.webp",
  "trails/fiches/itineraire-3.webp",
  "trails/fiches/itineraire-4.webp",
  "trails/fiches/itineraire-5.webp",
  "trails/fiches/itineraire-6.webp",
  "trails/fiches/itineraire-7.webp",
  "trails/fiches/itineraire-8.webp",
  "terrain/terrain-data.js",
  "terrain/metadata.json",
  "terrain/forest-cover.js",
  "terrain/forest-metadata.json",
  "terrain/reunion-forest-50m.u8",
  "terrain/reunion-rgealti-25m-1.u16",
  "terrain/reunion-rgealti-25m-2.u16",
  "terrain/reunion-rgealti-25m-3.u16",
  "terrain/reunion-rgealti-25m-4.u16",
  "terrain/reunion-rgealti-50m-1.u16",
  "terrain/reunion-rgealti-50m-2.u16",
  "terrain/reunion-rgealti-100m.u16",
  "vendor/three.module.js",
  "vendor/three.core.js",
  "vendor/THREE-LICENSE.txt",
  "vendor/version.json",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png"
];

const SHELL_URLS = new Map(SHELL_FILES.map((path) => [new URL(path, SCOPE_URL).href, path]));

function expectedMime(path, value) {
  const mime = (value || "").split(";", 1)[0].trim().toLowerCase();
  if (path.endsWith(".html")) return mime === "text/html";
  if (path.endsWith(".js")) return /^(text|application)\/(java|ecma)script$/.test(mime);
  if (path.endsWith(".css")) return mime === "text/css";
  if (path.endsWith(".png")) return mime === "image/png";
  if (path.endsWith(".webp")) return mime === "image/webp";
  if (path.endsWith(".svg")) return mime === "image/svg+xml";
  if (path.endsWith(".webmanifest")) return ["application/manifest+json", "application/json"].includes(mime);
  if (path.endsWith(".json")) return mime === "application/json";
  if (path.endsWith(".txt")) return mime === "text/plain";
  if (path.endsWith(".u16") || path.endsWith(".u8")) return mime === "application/octet-stream";
  return false;
}

async function fetchStaticAsset(url, path) {
  // No cookies, credentials, tokens, redirects, APIs or dynamic query strings.
  // Private hosts may deny this request: in that case installation must fail
  // rather than cache a sign-in wall or promise offline access to private data.
  const response = await fetch(url, {
    credentials: "omit",
    cache: "reload",
    redirect: "error"
  });
  const control = response.headers.get("Cache-Control") || "";
  if (response.status !== 200 || response.redirected || response.type === "opaque" ||
      response.url !== url || !expectedMime(path, response.headers.get("Content-Type")) ||
      /(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(control)) {
    throw new Error(`Ressource statique non cacheable : ${path}`);
  }
  if (path === "index.html") {
    const html = await response.clone().text();
    if (!/\bdata-app=["']ile-des-parcours["']/.test(html)) {
      throw new Error("La page retournée n’est pas l’application attendue.");
    }
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Sequential writes make a failed install easy to clean up completely.
      for (const [url, path] of SHELL_URLS) {
        const response = await fetchStaticAsset(url, path);
        await cache.put(url, response);
      }
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // No skipWaiting: an ongoing learning session keeps its current version.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== SCOPE_URL.origin || url.search ||
      request.headers.has("Authorization")) return;

  // Only the root navigation and exact static filenames are handled.
  const key = request.mode === "navigate" && url.href === SCOPE_URL.href
    ? new URL("index.html", SCOPE_URL).href
    : url.href;
  if (!SHELL_URLS.has(key)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(key);
    // Runtime requests are never written to Cache Storage. Only anonymous,
    // validated assets from the install phase enter the cache.
    return saved || fetch(request);
  })());
});
