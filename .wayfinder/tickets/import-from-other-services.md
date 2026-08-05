---
type: research
title: Feasibility of importing routes from Strava/other services
status: closed
assignee: null
blocked_by: []
---

## Question

The user wants to avoid manually exporting a GPX file and re-uploading it for
routes already recorded on Strava (or similar services). Research what
importing directly would actually take for a solo, self-hosted,
single-admin-password app like gpxfolio:

- **Strava API**: auth model (OAuth app registration, required redirect URLs,
  token refresh), rate limits, whether a personal/single-user integration is
  viable without Strava's stricter "multi-user app" review process, and
  whether GPX/GPS-stream export via the API is actually available on free
  tier.
- Whether comparable APIs exist for other likely sources (Garmin Connect,
  Komoot) and how their auth/rate-limit stories compare — or whether a
  simpler generic "paste a GPX URL" fallback covers most of the value with
  far less integration surface.
- Rough effort/complexity estimate given gpxfolio's current stack (no queue
  worker, no OAuth of any kind exists in the app today — auth is a single
  shared admin password).

Resolve with a recommendation: worth building (and against which service), or
not worth it given the effort/value tradeoff — with enough detail to serve as
one line (or a ruled-out note) in the final shortlist.

Full findings: [`import-from-other-services.research.md`](import-from-other-services.research.md).

## Resolution

**Not** a Strava/Garmin/Komoot integration. Strava's OAuth is easy for solo
use ("Single Player Mode" needs no app review), but its API has no endpoint
for an Activity's original GPX/TCX/FIT — only reconstructable GPS streams,
which would need a stream→GPX synthesizer for a use case too infrequent to
justify it. Garmin Connect's developer program is business/enterprise-only
(no personal tier). Komoot has no public developer API at all.

**Shortlist candidate instead**: a "paste a GPX/TCX/FIT URL, fetch it
server-side" import — a form field + server action that fetches the URL
(with timeout/size-cap/SSRF hardening) and feeds it into the existing
`/admin/new` parsing path. No OAuth, no tokens, no new dependencies. Rough
effort: a few hours. Strava's own activity pages expose an "Export GPX" link
this can consume directly.

If that later proves too much friction, the specifically-scoped fallback
would be a Strava stream-reconstruction integration in Single Player Mode
(~1-2 days) — not Garmin or Komoot, both ruled out above.
