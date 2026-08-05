# Wayfinder — local-markdown tracker

This repo has no external issue tracker wired up, so wayfinder maps here use
a local-markdown tracker: the map and its tickets are plain files under
`.wayfinder/`, standing in for what would otherwise be issues on a tracker.

## Layout

```
.wayfinder/
  README.md              this file
  map.md                 the map (one per active effort — see below)
  tickets/
    <slug>.md             one file per ticket, child of the map
```

If more than one map is ever active at once, prefix files with a map slug
(`<map-slug>.map.md`, `tickets/<map-slug>--<ticket-slug>.md`). With a single
map, the flat layout above is enough.

## Frontmatter schema

Map (`map.md`):

```yaml
---
type: map
title: <name>
status: open | closed
---
```

Ticket (`tickets/<slug>.md`):

```yaml
---
type: research | prototype | grilling | task
title: <name>
status: open | closed
assignee: null | <name>
blocked_by: [<slug>, ...]
---
```

## Wayfinding operations

- **Child issues of the map** = every file in `tickets/`.
- **Claiming** a ticket = setting `assignee` in its frontmatter before starting work.
- **Blocking** = the `blocked_by` list. No native dependency graph here, so this
  is the body-convention fallback the skill describes for trackers without one.
- **Unblocked** = every slug in `blocked_by` points at a ticket with `status: closed`.
- **Frontier** = tickets with `status: open`, `assignee: null`, and unblocked.
- **Closing** a ticket = `status: closed` plus a `## Resolution` section appended
  to its body recording the answer.
- **Decisions so far / Not yet specified / Out of scope** live directly in
  `map.md`, exactly as the skill's template describes.

No git branches are created for research findings (there's no PR-per-ticket
flow here); a research ticket's findings are written directly into its
`## Resolution` section, with any longer write-up saved alongside it as
`tickets/<slug>.research.md` and linked.
