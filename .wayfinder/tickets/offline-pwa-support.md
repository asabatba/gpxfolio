---
type: research
title: Feasibility of offline/PWA support for route pages
status: closed
assignee: null
blocked_by: []
---

## Question

The user wants to view a route's map/stats/elevation profile on the trail
without signal. Research what this actually takes for gpxfolio's stack:

- **Service worker feasibility under SolidStart/Vinxi**: what's the supported
  path (a plugin, manual `public/sw.js`, or something else) for
  precaching/runtime-caching a visited route page's JS/CSS/data.
- **Offline map tiles**: the basemap is OpenHikingMap raster tiles from a
  third-party community server with no published usage/caching policy (see
  root `README.md`'s Basemap section) — research whether caching its tiles
  for offline use is compatible with that (or whether it pushes toward a
  self-hosted tile cache, a downloadable offline tile package, or simply
  degrading to "map unavailable offline, stats/elevation still work").
  MapLibre's own offline/tile-caching support is relevant here.
- Rough effort/complexity estimate, and what "offline" should even mean for
  gpxfolio's read path (a route needs to have been visited online once
  before it can work offline is the obvious minimum bar).

Resolve with a recommendation: worth building (and what "worth it" looks like
— full offline including tiles, or a lighter partial version), or not worth
it given the effort/value tradeoff — with enough detail to serve as one line
(or a ruled-out note) in the final shortlist.

Full findings: [`offline-pwa-support.research.md`](offline-pwa-support.research.md).

## Resolution

**Worth building, but only the lighter partial version — skip offline map
tiles.** Ship a hand-written `public/sw.js` (SolidStart's own documented
pattern, no plugin — `vite-plugin-pwa` has no official SolidStart support and
a documented SSR-shaped failure mode) that runtime-caches a visited route's
HTML navigation, its `getRoute` server-function response, and JS/CSS. Stats
and the elevation profile (both plain JSON, no third party involved) then
work offline after one prior online visit. Roughly a day or less; the map
component just needs to detect no network and show a placeholder.

**Don't build offline map tiles**, at least not now. MapLibre has no
persistent tile cache and its maintainers confirmed no plans to add one
(`addProtocol` is the sanctioned workaround). `tile.openmaps.fr` does set a
30-day `Cache-Control`, but it's still a bare, policy-less community Apache
box (as the root README already flags) — persistent local caching is a
bigger ask of it than degrading gracefully to "map unavailable offline." If
tiles are wanted later, the right shape is route-scoped bounding-box
predownload, not opportunistic caching — several days to a week+, mostly
UX/quota work, not MapLibre mechanics. Revisit if the tile source is ever
self-hosted, per the README's own existing recommendation.
