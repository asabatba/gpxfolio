---
type: map
title: Best next improvements and features for gpxfolio
status: closed
---

## Destination

A prioritized shortlist of ~5-10 concrete features/improvements to build next
in gpxfolio, ranked, each with enough detail to hand off to an implementation
session. Optimized for the user as the app's own primary user (not a wider
audience of self-hosters), scoped to user-facing features only (not
infra/perf/tech-debt unless one blocks a feature), open to new free or
self-hosted dependencies but not paid services.

## Notes

- Domain: SolidStart/TypeScript/Tailwind/MapLibre/SQLite+Kysely GPX-sharing
  site. Single admin password, no multi-user accounts. See root `README.md`
  for the current architecture and `src/lib/gpx/`, `src/lib/photos/`,
  `src/lib/planning.ts`, `src/lib/weather.server.ts` for the built feature
  surface this map is extending.
- Skills every session should consult: `/grilling` for scope/UX decisions,
  `/research` for external-API and technical-feasibility questions.
- Candidate areas were surfaced via a breadth-first fan-out (2026-08-03)
  across four groups: discovery/browsing, route page/sharing, personal
  stats/data, trip/map/UX. See "Out of scope" for what wasn't selected.

## Decisions so far

- [Feasibility of importing routes from Strava/other services](tickets/import-from-other-services.md) — not worth a Strava/Garmin/Komoot OAuth integration (Strava's API can't return an Activity's original GPX; Garmin's program is business-only; Komoot has no public API); build a "paste a GPX/TCX/FIT URL and fetch it server-side" import instead.
- [Feasibility of offline/PWA support for route pages](tickets/offline-pwa-support.md) — worth a lightweight version only: a hand-written service worker caching stats/elevation-profile per visited route (~a day); skip offline map tiles (MapLibre has no persistent cache, and the tile server has no caching policy to lean on).
- [Search/filter on the homepage gallery](tickets/search-filter-gallery.md) — a "year" dropdown (URL-driven `?year=`) filtering the already-loaded route list client-side; only 5 routes exist today so no server-side query is warranted. Activity/text/distance filters declined.
- ["Similar routes" suggestions on the route page](tickets/similar-routes.md) — ruled out for now: only 5 routes exist, geographically spread thin, so a proximity-based widget would show almost nothing. Revisit once the route count grows.
- [Richer personal stats dashboard](tickets/richer-stats-dashboard.md) — a yearly trend chart (distance/elevation/time small-multiple SVG bars, hand-rolled like the elevation profile) replacing the homepage panel's yearly table; calendar heatmap, activity-type breakdown, and month-over-month comparison all declined as premature. Small effort, well under half a day.
- [Rank the resolved candidates into the final shortlist](tickets/rank-shortlist.md) — **the destination artifact.** Final order: (1) paste-a-URL GPX/TCX/FIT import, (2) lightweight offline/PWA support, (3) richer stats dashboard, (4) search/filter gallery. Only 4 candidates survived (short of the "~5-10" target) — shipped as-is rather than padded with weaker ideas.

## Not yet specified

_Empty — the map is complete. See [Rank the resolved candidates into the final shortlist](tickets/rank-shortlist.md)
for the destination artifact._

## Out of scope

- **Difficulty/effort rating on route cards** — surfaced in the initial
  discovery fan-out, not selected.
- **Shareable export (PDF / social-card image)** — surfaced in the initial
  route-page fan-out, not selected.
- **Privacy redaction of start/end coordinates** — surfaced in the initial
  route-page fan-out, not selected.
- **Historical weather on the route page** (as opposed to future-plan
  forecasts, already built) — surfaced in the initial stats/data fan-out,
  not selected.
- **Gear tracking** (shoe/bike mileage) — surfaced in the initial stats/data
  fan-out, not selected.
- **Alternate/satellite basemap toggle** — surfaced in the initial
  trip/map/UX fan-out, not selected.
- **First-class multi-route trips** (grouping separate routes into one trip,
  beyond today's one-route-many-tracks model) — surfaced in the initial
  trip/map/UX fan-out, not selected.
