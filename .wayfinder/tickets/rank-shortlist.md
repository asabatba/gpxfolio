---
type: grilling
title: Rank the resolved candidates into the final shortlist
status: closed
assignee: claude
blocked_by: [search-filter-gallery, similar-routes, import-from-other-services, richer-stats-dashboard, offline-pwa-support]
---

## Question

With all five candidate-area tickets resolved (search/filter, similar
routes, service import, richer stats, offline/PWA — each carrying a rough
value + effort read from its resolution), produce the destination artifact:
a ranked shortlist of the ~5-10 features worth building next, in order, each
with enough detail (drawn from its source ticket) to hand off to an
implementation session directly. Any candidate a source ticket recommended
against (e.g. import or offline turning out not worth it) is ranked out or
dropped, with the reasoning carried over from that ticket.

## Resolution

**Only 4 candidates survived to be ranked**, short of the destination's
"~5-10" target — treated as a rough ceiling, not a quota: 4 well-reasoned
items beat padding the list with weaker ones pulled back from
[Out of scope](../map.md#out-of-scope). Ranked value-first, effort as
tiebreaker.

### 1. Paste-a-URL GPX/TCX/FIT import

Highest value: removes a manual download-then-reupload step every time a
route is added, and cheapest to build.

- **Shape**: a form field + server action on the existing upload path that
  fetches the given URL server-side (timeout, size cap, SSRF hardening) and
  feeds the result into the existing `/admin/new` GPX/TCX/FIT parsing path.
  No OAuth, no tokens, no new dependency. Strava's own activity pages expose
  an "Export GPX" link this can consume directly.
- **Explicitly not**: a Strava/Garmin/Komoot OAuth integration — Strava's
  API can't return an activity's original file (only reconstructable GPS
  streams), Garmin's developer program is business-only, Komoot has no
  public API.
- **Effort**: a few hours.
- **Source**: [Feasibility of importing routes from Strava/other services](import-from-other-services.md).

### 2. Lightweight offline/PWA support

Solves a real, explicitly-stated pain point — checking a route's stats and
elevation profile on the trail without signal.

- **Shape**: a hand-written `public/sw.js` (SolidStart's documented pattern;
  no plugin — `vite-plugin-pwa` has no official SolidStart support) that
  runtime-caches a visited route's HTML navigation, its `getRoute`
  server-function response, and JS/CSS. Stats and the elevation profile work
  offline after one prior online visit; the map component detects no
  network and shows a placeholder instead.
- **Explicitly not**: offline map tiles. MapLibre has no persistent tile
  cache and its maintainers have no plans to add one; the basemap tile
  server (`tile.openmaps.fr`) is a policy-less community box not worth
  leaning on harder. Revisit if the tile source is ever self-hosted.
- **Effort**: a day or less.
- **Source**: [Feasibility of offline/PWA support for route pages](offline-pwa-support.md).

### 3. Richer personal stats dashboard

A smaller, more polish-oriented upgrade to something already viewed on every
homepage visit.

- **Shape**: three small-multiple hand-rolled SVG bar charts — distance,
  elevation gain, time — one bar per year, chronological order, replacing
  (not joining) the existing yearly table in `ArchiveStats.tsx`. Calendar
  heatmap, per-activity-type breakdown, and month-over-month comparison were
  all declined (too sparse at 5 routes / `activityType` unpopulated / not a
  natural fit for trip-based activity).
- **Data**: no new aggregation — `YearlyStats` in `archive-stats.ts` already
  has everything needed.
- **Placement**: stays in the existing homepage panel, no new `/stats`
  route.
- **Effort**: well under half a day.
- **Source**: [Richer personal stats dashboard](richer-stats-dashboard.md).

### 4. Search/filter on the homepage gallery

Lowest value today by its own resolution's admission — only 5 routes exist,
so filtering barely matters yet — but grows in value as the archive grows.

- **Shape**: a "year" dropdown above the gallery ("All years" plus each year
  spanned by the user's routes), filtering the already-loaded route list
  client-side, reflected in the URL as `?year=` (SolidStart `searchParams`)
  so a filtered view is bookmarkable and survives a reload. Activity-type,
  free-text, and distance-range filters were considered and declined.
- **Effort**: roughly half a day.
- **Source**: [Search/filter on the homepage gallery](search-filter-gallery.md).

### Not on the shortlist

- **"Similar routes" suggestions** — ruled out entirely, not just
  deprioritized: only 5 routes exist, geographically spread thin, so a
  proximity widget would show almost nothing. Revisit once the route count
  grows. See [Similar routes](similar-routes.md).

This is the map's destination artifact — the map is now complete.
