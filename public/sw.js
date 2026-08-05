/**
 * Hand-written service worker — no build plugin. SolidStart's own docs
 * describe exactly this path (a plain `public/sw.js`, registered by hand);
 * `vite-plugin-pwa` has no official SolidStart support and its
 * precache-manifest model doesn't fit a server-rendered, per-slug route
 * like `/r/[slug]` anyway (there's no fixed list of pages to precache — see
 * `.wayfinder/tickets/offline-pwa-support.research.md` for the full
 * writeup).
 *
 * Scope: make a *visited* route page's stats and elevation profile readable
 * with no signal. That's it — no offline map tiles (MapLibre has no
 * persistent tile cache, and the third-party basemap server has no
 * published caching policy to lean on harder than its own 30-day
 * `Cache-Control`; see `RouteMap.tsx`'s offline handling), and nothing from
 * `/admin/*` (caching authenticated state is a foot-gun for no offline
 * benefit — an admin editing routes has a connection). See
 * `isRouteServerQuery` below for how that admin exclusion is actually
 * enforced — the URL alone can't do it.
 *
 * Bump CACHE_NAME on any change to what/how this worker caches, so
 * `activate` clears out the old version instead of serving stale entries
 * forever under a name nothing writes to anymore.
 */
const CACHE_NAME = "gpxfolio-offline-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** A route page's own HTML shell. */
function isRouteNavigation(request, url) {
  return request.mode === "navigate" && url.pathname.startsWith("/r/");
}

/**
 * Every `query()`-wrapped server function — `getRoute`, weather lookups, but
 * also the admin dashboard's own listing/edit queries — is called over GET at
 * this *one shared* endpoint, so the URL alone can't tell a route page's read
 * from an admin one. `request.referrer` (the page that issued the fetch) is
 * what actually scopes this to route pages: caching admin's authenticated
 * queries would be a foot-gun (stale listings, no offline benefit — an admin
 * editing routes has a connection) for zero benefit, so anything referred
 * from elsewhere is left untouched. `action()` mutations (admin edits) use
 * POST and never reach here regardless.
 */
function isRouteServerQuery(request, url) {
  if (request.method !== "GET" || url.pathname !== "/_server") return false;
  if (!request.referrer) return false;
  return new URL(request.referrer).pathname.startsWith("/r/");
}

/** Vite/Vinxi's content-hashed client bundle — a given URL's body never changes. */
function isBuildAsset(url) {
  return url.pathname.startsWith("/_build/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isBuildAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isRouteNavigation(request, url) || isRouteServerQuery(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/**
 * Always prefers the network when it's reachable — a cached response is only
 * ever a fallback for offline viewing, never a way to dodge fresher data.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}
