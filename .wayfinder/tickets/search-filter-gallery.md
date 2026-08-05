---
type: grilling
title: Search/filter on the homepage gallery
status: closed
assignee: claude
blocked_by: []
---

## Question

The homepage gallery (`src/routes/index.tsx`) currently lists every public
route as a flat set of cards. Decide what "search/filter" should mean here as
a shortlist candidate:

- Which dimensions matter (activity type, date range, distance, free-text
  title/description search)?
- Client-side filtering of an already-loaded list, or server-side
  query/pagination — and does the current/expected route count (check
  `data/gpxfolio.db` or ask the user how many routes exist and how fast that's
  growing) make one clearly right?
- Where does it live in the UI (a filter bar above the gallery, URL-driven
  query params, etc.)?

Resolve with enough detail (dimensions + rough UI shape + rough effort) to
serve as one line in the final shortlist.

## Resolution

**Dimension**: date range only (activity type, free-text search, and
distance range were considered and declined — activityType isn't even
populated on any current route).

**Fact-check**: only 5 routes exist in `data/gpxfolio.db` today, so
client-side filtering of the already-loaded list is clearly sufficient — no
server-side query/pagination is warranted.

**Shape**: a "year" dropdown above the gallery ("All years" plus each year
the user's routes span, derived from `startedAt`), filtering the in-memory
route list client-side. Reflected in the URL as a `?year=` query param
(SolidStart `searchParams`) so a filtered view is bookmarkable/shareable and
survives a reload.

**Rough effort**: small — a dropdown component, a client-side filter over
the already-loaded list, and URL searchParam wiring. Roughly half a day.
