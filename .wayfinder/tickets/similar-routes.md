---
type: grilling
title: "\"Similar routes\" suggestions on the route page"
status: closed
assignee: claude
blocked_by: []
---

## Question

On a route page (`src/routes/r/[slug].tsx`), decide what "similar routes"
should mean as a shortlist candidate:

- What defines similarity — geographic proximity (bbox/start-point distance,
  already stored per route), same activity type, comparable
  distance/elevation profile, or some combination?
- Where it's shown (a sidebar/footer section) and how many suggestions.
- Whether it only needs to consider public routes, or also surfaces unlisted
  ones to the admin.

Resolve with enough detail (similarity rule + placement + rough effort) to
serve as one line in the final shortlist.

## Resolution

**Ruled out, for now.** Checked the actual corpus: only 5 routes exist
(`Volta d'Eina`, `Pics Perics`, `Cadí 2022`, `Volta a Vanoise`,
`Alta ruta de los Perdidos 2024`), spread across the Pyrenees and the French
Alps with real distance between them — bboxes barely overlap. A
geographic-proximity similarity widget would show 0-1 matches on nearly
every route page today; not worth building against a corpus this small.

**Not on the shortlist this round.** Revisit once the route count grows
enough that proximity-based (or activity-type-based, once that field is
populated) similarity would actually surface something on most route pages.
