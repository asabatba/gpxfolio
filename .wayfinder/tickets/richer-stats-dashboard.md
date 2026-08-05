---
type: grilling
title: Richer personal stats dashboard
status: closed
assignee: claude
blocked_by: []
---

## Question

`src/lib/archive-stats.ts` currently powers a yearly-totals + records panel
on the homepage. Decide what "richer" should mean as a shortlist candidate:

- What new views are actually wanted — a calendar heatmap (à la GitHub's
  contribution graph, keyed to ride/hike days), distance-over-time trend
  lines, per-activity-type breakdowns, month-over-month comparisons?
- Where it lives — expand the existing homepage panel, or a dedicated
  `/stats` page?
- Whether it's computed from the existing per-track `StatsColumns` data
  already stored (likely yes) or needs new aggregation.

Resolve with enough detail (which views + rough placement + rough effort) to
serve as one line in the final shortlist.

## Resolution

**One new view: a yearly trend chart, replacing the yearly table.** Calendar
heatmap, per-activity-type breakdown, and month-over-month comparison were
all considered and declined for this round:

- **Calendar heatmap** — declined. With only 5 routes across a handful of
  years, most of the day grid would sit empty; same sparsity reasoning that
  ruled out "Similar routes" ([tickets/similar-routes.md](similar-routes.md)).
- **Per-activity-type breakdown** — declined. `activityType` is a real
  column (`src/lib/db/schema.ts`) but isn't populated on any of the 5
  current routes (confirmed during
  [the gallery search/filter ticket](search-filter-gallery.md) too) — it'd
  show one "unlabeled" bucket until routes are retroactively tagged.
- **Month-over-month comparison** — declined. Activity here is sparse,
  seasonal, trip-based, not routine logging; month-over-month deltas aren't
  a natural fit. Year-over-year is.

**Shape**: three small-multiple hand-rolled SVG bar charts — distance,
elevation gain, time — one bar per year, in chronological order. Replaces
(doesn't sit alongside) the existing yearly table in
[`src/components/ArchiveStats.tsx`](../../src/components/ArchiveStats.tsx)
so the same numbers aren't shown twice.

**Placement**: stays in the existing homepage panel (`ArchiveStats.tsx`,
embedded in `src/routes/index.tsx`) — no new `/stats` route. Revisit a
dedicated page if/when more view types get added later.

**Data**: no new aggregation needed. `YearlyStats`
([`src/lib/archive-stats.ts`](../../src/lib/archive-stats.ts)) already
carries exactly `year`, `distanceM`, `elevationGainM`, `timeS` per year.

**Tech**: hand-rolled inline SVG, consistent with
[`ElevationProfile.tsx`](../../src/components/ElevationProfile.tsx)'s
existing no-charting-library rationale — and simpler than that component,
since a static per-year bar chart needs no pointer-sync logic.

**Rough effort**: small, well under half a day. Three small bar-chart SVGs
sharing one layout helper, fed directly off data already computed, replacing
the current table markup.
