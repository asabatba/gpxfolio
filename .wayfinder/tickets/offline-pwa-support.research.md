---
type: research
title: Offline/PWA support for route pages — findings
status: complete
---

## Recommendation

**Worth building, but only the lighter partial version — skip offline map tiles.**

Ship a minimal offline mode: a hand-written service worker that runtime-caches a
visited route's HTML navigation, its `getRoute` server-function response, and the
static JS/CSS bundle, so stats and the elevation profile (both plain JSON/SVG,
no third party involved) work with no signal after one online visit. This is a
few hours to a day of focused work, uses only patterns SolidStart's own docs
already describe, and has no dependency on, or impact on, the third-party tile
server.

**Don't build offline map tiles**, at least not now. Not because it's
technically impossible — MapLibre's `addProtocol` and Workbox's
`runtimeCaching` both make it achievable — but because the value is marginal
(you already get the two numeric read-outs that matter on a trail: stats and
the elevation profile) against a real cost: it means silently keeping a
persistent local copy of a community server's tiles with no published terms,
for a rendering feature that's nice-to-have rather than load-bearing when
offline. If the tile source is later replaced with a self-hosted tile
server/cache (as the README already flags as the right move "for anything
beyond personal traffic"), offline tiles become a much cheaper add-on at that
point — precaching your own tiles raises none of the third-party-etiquette
question.

If offline tiles are wanted anyway, the right shape is **route-scoped
predownload** (fetch and cache just the tile set covering one route's bounding
box at the zoom levels actually used, on demand, when the user is online and
viewing that route) rather than opportunistic runtime caching of whatever
tiles happen to scroll past — bounded, predictable, and easy to reason about
in terms of how many tiles you're pulling from someone else's server.

---

## 1. Service worker feasibility under SolidStart/Vinxi

**SolidStart's own docs describe exactly one supported path, and it's manual.**
Per SolidStart's official guide
(https://docs.solidjs.com/solid-start/guides/service-workers, fetched
2026-08-03), the entire recommended setup is two steps:

1. Place the service worker file in `public/` (e.g. `public/sw.js`), which
   SolidStart serves verbatim at `/sw.js`.
2. Register it by hand in `src/entry-client.tsx`:

   ```ts
   if ("serviceWorker" in navigator && import.meta.env.PROD) {
     window.addEventListener("load", () => {
       navigator.serviceWorker.register("/sw.js");
     });
   }
   ```

That's the complete guidance — no precaching helper, no build-time manifest
injection, no mention of Workbox or a PWA plugin. SolidStart treats
`public/sw.js` like any other static asset and leaves caching strategy
entirely to you. gpxfolio already has an `entry-client.tsx` (per the `mount()`
pattern this doc shows), so wiring in registration is a small, well-defined
change.

**vite-plugin-pwa has no official SolidStart integration**, and a docs PR to
add one was explicitly closed unmerged:

- The plugin's framework list (https://vite-pwa-org.netlify.app/frameworks/solidjs,
  fetched 2026-08-03) documents **SolidJS only** — a `virtual:pwa-register/solid`
  module that exposes `needRefresh`/`offlineReady` as Solid signals via
  `useRegisterSW()`. Nothing on that page mentions SolidStart, SSR, or Vinxi.
- A 2023 feature request, "Add SolidStart support"
  (https://github.com/vite-pwa/vite-plugin-pwa/issues/465, closed as
  completed): the reporter got it working by hand — manually importing
  `useRegisterSW`/`virtual:pwa-info` into `root.tsx` rather than relying on
  the plugin's `injectRegister` auto-injection — and the maintainer
  (userquin) confirmed there's no dedicated SolidStart package, just "use the
  solidjs virtual module," explicitly conditioning even that on whether
  SSR/islands ever needed special handling. The follow-up docs PR
  (https://github.com/vite-pwa/vite-plugin-pwa/pull/468, "docs(frameworks):
  add solid start doc") was **closed without merging** — so as of today there
  is still no first-party SolidStart doc page, only this unofficial workaround
  thread.
- **Concrete gotcha reported in that same issue thread**: another user
  (yume-chan) followed the exact community recipe and hit a runtime error —
  `Uncaught (in promise) non-precached-url: non-precached-url ::
  [{"url":"index.html"}]` — and the page did not actually work offline
  afterward. This is a real symptom of `generateSW`'s precaching model
  (a build-time manifest of known static routes/`index.html`) not lining up
  with an SSR app that has no single static `index.html` and no fixed list of
  pages to precache. That mismatch is architectural, not a bug that's likely
  to get fixed — it's the wrong tool for a server-rendered, per-slug route.

  This matters directly for gpxfolio: `src/routes/r/[slug].tsx` fetches its
  data via SolidStart's `query()`/`createAsync()` (a server function, verified
  by reading the file) — the page is genuinely dynamic per route, not a
  known-ahead-of-time static asset. Nothing here can be "precached" in the
  generateSW sense; it has to be **runtime-cached** the first time a specific
  route is actually visited. That's a strong argument for the same conclusion
  SolidStart's own docs point to: skip the plugin, hand-write the caching
  logic (a `fetch` event handler with a network-first-with-cache-fallback
  strategy) directly in `public/sw.js`, matched against the navigation request
  for `/r/:slug` and its underlying server-function endpoint. You can still
  pull in `workbox-strategies`/`workbox-routing` as a library inside a
  hand-written SW (no plugin needed) if reinventing cache-fallback logic isn't
  wanted, without touching the plugin's precache-manifest machinery at all.

**Net**: this is buildable on the officially documented path with no exotic
tooling. The plugin route adds a dependency and a real, demonstrated
SSR-shaped failure mode for no compensating benefit here, since gpxfolio's
per-route data is inherently visit-triggered, not precache-able.

## 2. Offline map tiles

**MapLibre GL JS has no persistent offline cache, and the maintainers have said
there are no plans to add one.** From the GitHub discussion "Caching strategy
in MapLibre GL JS" (https://github.com/maplibre/maplibre-gl-js/discussions/6910,
fetched 2026-08-03 via the GitHub API), maintainer HarelM, answering directly:

> "There is a caching mechanism, you can check tile manager and in view tiles
> classes for tile caching. Other stuff are mostly loaded into memory and
> cached. There's also the browser cache obviously."

— i.e. in-memory + ordinary HTTP cache only — then, asked explicitly about a
persistent on-disk/IndexedDB tile cache:

> "No, there's not plans to support this. You can use `addProtocol` to
> achieve this functionality. maplibre-gl-js is mostly intended for web where
> offline is less of a concern, as opposed to maplibre-native that can handle
> this better."

The same answer — `addProtocol` is the sanctioned extension point — appears
in the older issue #662 "Offline cached raster tiles?"
(https://github.com/maplibre/maplibre-gl-js/issues/662, fetched via the
GitHub API): HarelM again points to `addProtocol`, describing his own use of
it with a local database (Dexie/IndexedDB) to intercept and serve cached
tiles. `addProtocol`'s API contract
(https://maplibre.org/maplibre-gl-js/docs/API/functions/addProtocol/) is a
plain "register a custom URL-scheme loader that returns `{ data: ArrayBuffer
}`" — straightforward to point at a cache-first fetch, but it means rewriting
the raster source's tile URL template to a custom scheme (e.g.
`gpxfolio-tile://...`) rather than something that falls out "for free."

**A plain service worker `fetch` handler is the more direct alternative** to
`addProtocol` for raster tiles specifically, since MapLibre requests raster
tiles over ordinary `http(s)://` URLs — a SW intercepts those without any
MapLibre-side change, using Workbox's `generateSW` `runtimeCaching` option
(https://vite-pwa-org.netlify.app/workbox/generate-sw.html, fetched
2026-08-03), which explicitly supports third-party/cross-origin URL patterns,
`CacheFirst` with `maxEntries`/`maxAgeSeconds` expiration, and (relevant here)
opaque cross-origin responses via `cacheableResponse: { statuses: [0, 200] }`.

**Whether caching OpenHikingMap's tiles this way is reasonable — checked
directly against the live server** (`curl -I` against
`tile.openmaps.fr/hiking/0/0/0.png`, 2026-08-03):

```
Cache-Control: max-age=2592000
Expires: <30 days out>
Access-Control-Allow-Origin: *
```

Two things follow from this, and both cut in the same direction as the
README's existing caveat:

- The server itself sets a 30-day `Cache-Control`, which is a real,
  machine-readable signal that caching a tile for up to 30 days is within
  what the operator has already told every HTTP cache (browser, CDN, service
  worker) is acceptable. A service worker that respects that TTL rather than
  re-fetching aggressively is arguably *more* polite than the app's current
  behavior, not less.
- `robots.txt` on that host is `Disallow: /` — a signal aimed at crawlers
  indexing content, not really applicable to legitimate tile-serving traffic
  from a map client (which is the server's whole purpose), but one more data
  point that this is a bare, unmanaged Apache/nginx box (its root is still
  the stock "Apache2 Debian Default Page," matching the README's description)
  with no API terms, no rate-limit documentation, and no contact point — i.e.
  still exactly the "no published usage policy, no uptime guarantee" server
  the README already warns about. Building persistent, growing local storage
  against it — beyond what a normal browsing session would already pull — is
  a bigger ask of that server's goodwill than the current best-effort/fallback
  behavior.

**Practical alternatives, in order of how much they lean on the third party:**

1. **Degrade gracefully (recommended default)**: cache stats + elevation
   only; show "map unavailable offline" when there's no cached tile data.
   Zero tile-serving load added, zero new caching-policy question. Stats and
   elevation are exactly the numbers useful mid-trail; the map is the nice-to-have.
2. **Route-scoped predownload**: an explicit "make available offline" action
   on a route page that, while online, fetches and caches only the tiles
   covering that route's bounding box at the zoom levels the map actually
   uses (README already documents `maxzoom: 18`). Bounded, user-initiated,
   easy to reason about as "a normal viewing session, just batched" rather
   than open-ended scraping.
3. **Self-host a tile cache/proxy**: the README already recommends this path
   "for anything beyond personal traffic." Once tiles are served from
   infrastructure gpxfolio controls, both the offline-caching question and
   the third-party-etiquette question disappear — this is the natural
   long-term fix if offline map viewing becomes a priority.
4. **Opportunistic runtime caching of whatever tiles get viewed** (plain
   Workbox `runtimeCaching` against `tile.openmaps.fr`): technically the
   least code, but the least bounded — cache growth tracks browsing behavior
   rather than a route's actual footprint, and offers the weakest offline
   guarantee (only tiles you happened to scroll over are there, not
   necessarily contiguous coverage of the whole route).

## 3. Rough effort estimate

**Minimal (stats + elevation, no map) — small, roughly a day or less:**

- `public/sw.js` + registration in `entry-client.tsx`, per SolidStart's own
  documented pattern (no new dependency needed, though `workbox-strategies`/
  `workbox-routing` as libraries — not the Vite plugin — are a reasonable
  time-saver for the network-first-with-cache-fallback logic).
- Two things need caching per visited route: the navigation HTML for
  `/r/[slug]` and the `getRoute` server-function response `[slug].tsx` calls
  via `query()`/`createAsync()` on client-side navigation, plus the hashed
  JS/CSS chunks (safe to cache-first since they're content-hashed).
- An "offline" / "cached for offline" UI affordance so it's discoverable.
- No MapLibre/tile work at all — the map component would just need to
  detect it has no network and render a placeholder instead of a blank/broken
  map.
- Main source of risk is edge cases in the caching strategy (stale data,
  cache eviction, multiple tracks/photos on a route), not unknowns in the
  underlying APIs — everything used here is the officially documented
  SolidStart pattern.

**Full (including offline map tiles) — medium-to-large, roughly several days
to a week+, and mostly not about MapLibre:**

- Everything above, plus either an `addProtocol`-based custom tile loader
  backed by IndexedDB, or a SW `runtimeCaching` rule scoped to
  `tile.openmaps.fr` (and the OSM fallback host, since `RouteMap.tsx` already
  falls back to it) — this part is genuinely a day or two of MapLibre/Workbox
  work.
- The bulk of the added effort is product/UX, not tile-fetching mechanics:
  a "download this route for offline" flow, bounding-box tile enumeration at
  the used zoom range, storage-quota handling (`navigator.storage.estimate`,
  eviction policy), a way to see/manage what's been downloaded, and — per the
  etiquette concern above — being deliberate about not silently growing an
  unbounded cache against a server with no stated tolerance for it.
- This is the piece the recommendation says to defer.

## Sources

- SolidStart, "Service workers" — https://docs.solidjs.com/solid-start/guides/service-workers (fetched 2026-08-03)
- vite-plugin-pwa, SolidJS framework guide — https://vite-pwa-org.netlify.app/frameworks/solidjs (fetched 2026-08-03)
- vite-plugin-pwa, "Register Service Worker" guide — https://vite-pwa-org.netlify.app/guide/register-service-worker (fetched 2026-08-03)
- vite-plugin-pwa, `generateSW` / runtime caching guide — https://vite-pwa-org.netlify.app/workbox/generate-sw.html (fetched 2026-08-03)
- vite-plugin-pwa GitHub issue #465, "Feature request: Add SolidStart support" — https://github.com/vite-pwa/vite-plugin-pwa/issues/465 (fetched via GitHub API 2026-08-03)
- vite-plugin-pwa GitHub PR #468, "docs(frameworks): add solid start doc" (closed unmerged) — https://github.com/vite-pwa/vite-plugin-pwa/pull/468 (fetched via GitHub API 2026-08-03)
- MapLibre GL JS GitHub discussion #6910, "Caching strategy in MapLibre GL JS" — https://github.com/maplibre/maplibre-gl-js/discussions/6910 (fetched via GitHub API 2026-08-03)
- MapLibre GL JS GitHub issue #662, "Offline cached raster tiles?" — https://github.com/maplibre/maplibre-gl-js/issues/662 (fetched via GitHub API 2026-08-03)
- MapLibre GL JS API docs, `addProtocol` — https://maplibre.org/maplibre-gl-js/docs/API/functions/addProtocol/ (fetched 2026-08-03)
- `tile.openmaps.fr` response headers and root page — checked directly via `curl` 2026-08-03
- This repo's `README.md`, "Basemap" section (existing internal source on the tile server's caveats)
- This repo's `src/routes/r/[slug].tsx` (confirms `query()`/`createAsync()` server-function data loading, read directly)
