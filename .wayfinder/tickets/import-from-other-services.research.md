# Research: importing routes from Strava/other services

## Recommendation

**Not worth building against Strava, and not worth building against Garmin Connect or Komoot either.** Build the "paste a GPX/TCX/FIT URL and fetch it server-side" fallback instead (plus a slightly nicer manual-export UX) — it captures most of the value for a few hours of work, versus days of OAuth plumbing for a payoff that turns out to be smaller than it looks.

The reason a full Strava integration isn't worth it isn't the OAuth complexity (that part is genuinely easy — "Single Player Mode" lets a solo developer authenticate only their own account with zero app review, see Q1). It's that **Strava's API does not expose the original GPX/TCX/FIT file for *activities*** (recorded rides/runs) at all — only reconstructed GPS streams (lat/lng, altitude, time arrays) via `GET /activities/{id}/streams`. Rebuilding a GPX-equivalent from those streams is doable but means writing a stream→GPX synthesizer and accepting some fidelity loss (e.g. no original device metadata), for a use case (uploading a handful of routes to a personal site) that doesn't recur often enough to amortize that cost. GPX/TCX export *does* exist in the API, but only for Strava "Routes" (planned courses), not recorded Activities — which is the opposite of what gpxfolio's admin actually needs.

Garmin Connect's official developer program is flatly closed to personal/solo use (business-entity-only, and currently not accepting new applicants at all — see Q2). Komoot has no public developer API (only an unofficial B2B partner integration and reverse-engineered endpoints — see Q2). Neither is viable without resorting to unofficial/reverse-engineered access, which is a maintenance and ToS-risk liability disproportionate to gpxfolio's scale.

**Effort estimate if built anyway (Strava, stream-reconstruction path):** roughly 1–2 days — OAuth app registration + single-player auth flow (no backend session infra needed beyond storing one refresh token), a stream→GPX converter, token refresh handling, and hitting the (fairly generous, single-player) rate limits of 200 req/15 min / 2,000 req/day. This is a real, boundable project — it's just not a good one, because the fallback below gets ~80% of the value in a fraction of that time.

**Effort estimate for the fallback (URL-paste import):** a few hours. A form field for a URL, a server action that fetches it (with size/timeout/content-type limits) and pipes it into the existing GPX-upload/parsing code path already used by `/admin/new`. No auth, no tokens, no new dependencies, no new attack surface beyond "validate what a fetched file contains" (which the existing upload path already has to do for user-supplied GPX).

---

## 1. Strava API

### Auth model
- OAuth 2.0. Authorization endpoints: `GET https://www.strava.com/oauth/authorize` (web) / `GET https://www.strava.com/oauth/mobile/authorize` (mobile); token exchange at `POST https://www.strava.com/api/v3/oauth/token`.
  Source: https://developers.strava.com/docs/authentication/
- **App registration**: requires an active Strava subscription to create an app. Every app is assigned an "Authorization Callback Domain" — redirect URIs must fall within that domain. `localhost` and `127.0.0.1` are whitelisted for development.
  Source: https://developers.strava.com/docs/getting-started/ and https://developers.strava.com/docs/authentication/
- **"Single Player Mode"**: every new app starts in this state, where *only the developer's own Strava account* can authenticate against it. This is explicitly designed to let a solo developer "build and test your integration against your own data" — i.e., a personal, single-user integration is a first-class, supported, zero-review scenario.
  Source: https://developers.strava.com/docs/getting-started/
- **App review**: only required once an app wants to scale past **10 connected athletes** ("Once your app reaches 10 connected athletes and you're ready to scale further, please submit your app for review"). Review also requires demonstrating compliance with Strava's brand guidelines (e.g. showing the "Connect with Strava" button, screenshots of where Strava data appears). None of this applies to a single-player personal app.
  Source: https://developers.strava.com/docs/getting-started/ and https://developers.strava.com/docs/rate-limits/
- **Conclusion for gpxfolio**: a personal integration where the admin authorizes only their own account never needs to leave Single Player Mode and never triggers review.
- **Scopes**: `read`, `read_all`, `profile:read_all`, `profile:write`, `activity:read`, `activity:read_all`, `activity:write`. Importing the admin's own (possibly private) activities would need `activity:read_all`.
  Source: https://developers.strava.com/docs/authentication/
- **Token lifecycle**: access tokens expire 6 hours after issuance; a refresh token is used to mint new ones (grant_type=refresh_token), and Strava rotates the refresh token on each refresh. Deauthorization endpoint is moving from `POST /oauth/deauthorize` to `POST /oauth/revoke` (documented effective June 1, 2026).
  Source: https://developers.strava.com/docs/authentication/

### Rate limits
- Default (new, single-athlete-capacity) app: **200 requests / 15 min, 2,000 requests / day** overall, with a stricter **non-upload** sub-limit of **100 requests / 15 min, 1,000 requests / day** covering everything except activity/upload creation and media uploads.
- If manually upgraded to 10-athlete capacity: 200/2,000 read and 400/4,000 overall (this upgrade isn't needed for a single-player app).
  Source: https://developers.strava.com/docs/rate-limits/
- For a personal import tool triggered manually a few times a month, these limits are a non-issue either way.

### GPX/GPS-stream export availability
- There is **no endpoint that returns the original uploaded GPX/TCX/FIT file for an Activity**. `GET /activities/{id}` returns only summary/detail fields plus a `map` object with `polyline`/`summary_polyline` (encoded polylines, not full-fidelity GPX).
  Source: https://developers.strava.com/docs/reference/
- The actual GPS data comes from `GET /activities/{id}/streams` (also available for `routes/{id}/streams`, `segments/{id}/streams`, `segment_efforts/{id}/streams`), returning parallel arrays (`time`, `latlng`, `altitude`, `distance`, `heartrate`, `cadence`, `watts`, `moving`, etc.) — i.e. reconstructable-but-not-original GPS data, requiring a converter to synthesize a GPX file.
  Source: https://developers.strava.com/docs/reference/
- Strava's API *does* offer **GPX/TCX export for Routes** (`Export Route GPX` / `Export Route TCX`), but "Routes" in Strava's data model are planned/drawn courses, not recorded activities — not what an admin uploading their own recorded rides/hikes needs.
  Source: https://developers.strava.com/docs/reference/

---

## 2. Alternatives: Garmin Connect and Komoot

### Garmin Connect
- The **Garmin Connect Developer Program** does provide an Activity API with access to activity files (FIT/GPX/TCX) and rich per-second data — on paper, closer to what gpxfolio wants than Strava's stream-only model.
  Source: https://developer.garmin.com/gc-developer-program/activity-api/
- However, the program's own FAQ states it is **"available for enterprise use"** and **"only for business use"** — applicants must apply as a legal entity/company (not an individual), typically with a company-domain email. There is no personal/hobbyist access tier.
  Source: https://developer.garmin.com/gc-developer-program/program-faq/
- Independently corroborated: community reports (Garmin developer forums) describe the program as currently not accepting new individual/personal applications, with existing accounts grandfathered but new signups effectively closed to non-business applicants.
  Source: search result summary of https://forums.garmin.com/developer/connect-iq/f/discussion/320300/garmin-connect-developer-program-api-access-request (community report, not primary — flagged as such)
- **Conclusion**: not viable for a solo self-hosted app without misrepresenting it as a business. Ruled out.

### Komoot
- Komoot has **no general-purpose public developer API**. What exists is an unofficial/legacy internal API (`static.komoot.de/doc/external-api/...`) that the Komoot web frontend itself uses, undocumented and unsupported for third parties, plus a B2B partner integration path that requires a partnership agreement, not self-serve registration.
  Source: search results referencing https://support.komoot.com/hc/en-us/articles/10331570510618-komoot-API (page returned HTTP 403 to automated fetch — could not verify Komoot's own wording directly; content described in secondary summaries only) and https://github.com/komoot (no public API repo)
- **Caveat**: I was not able to load Komoot's own support article directly (it 403'd the fetch tool), so this section leans more on secondary sources than the Strava/Garmin sections above. The absence of any official, discoverable Komoot developer-docs site (no `developers.komoot.com` equivalent to Strava's or Garmin's) is itself a strong signal there's nothing to integrate against on the free tier.
- **Conclusion**: not viable as a supported integration. Ruled out.

---

## 3. Simpler fallback: URL-paste import / streamlined manual export

- **"Paste a GPX/TCX/FIT URL, fetch it server-side"**: works for any service that exposes a direct-download/export link for an activity (Strava's own activity page has an "Export GPX" link on the activity detail page's UI for the file *the owner recorded*, separate from the API; Garmin Connect's web UI likewise offers "Export to GPX/TCX/FIT" from an activity's settings menu). If the admin can get a shareable/direct URL to that export, gpxfolio just needs a server action that fetches the URL (with a timeout, size cap, and content-type/extension check) and feeds the bytes into the exact same parsing/validation path `/admin/new`'s file upload already uses.
- This sidesteps essentially all of the complexity that made Strava/Garmin/Komoot unattractive: no OAuth client registration, no token storage/refresh, no per-service rate-limit accounting, no dependency on an API staying stable or available (URL-paste degrades gracefully to "doesn't work for this link" rather than "integration breaks on an API change"), and zero new attack surface beyond the SSRF-style hardening any server-side URL fetch needs (block private/internal IP ranges, cap response size, set a fetch timeout) — the same category of hardening a "paste an image URL" feature would need.
- Given gpxfolio has **no existing OAuth infrastructure of any kind** (single shared admin password, no session/user model beyond that, no background job runner for token refresh), this fallback is a much better fit for the codebase's current shape than adding the first-ever third-party auth integration for a benefit (skipping one manual download+upload step) that a URL-paste already delivers.
- **Recommendation**: implement the URL-paste fallback. If the admin later finds the manual "open Strava app, tap export, copy link" step is still too much friction, the appropriately-scoped next step would specifically be a **stream-reconstruction Strava integration in Single Player Mode** — not Garmin or Komoot — since Strava is the only one of the three with (a) real personal-use API access and (b) no review gate for that use case, at the ~1-2 day estimate given in the Recommendation.

---

## Sources

- Strava — Getting Started: https://developers.strava.com/docs/getting-started/
- Strava — Authentication: https://developers.strava.com/docs/authentication/
- Strava — Rate Limits: https://developers.strava.com/docs/rate-limits/
- Strava — API Reference: https://developers.strava.com/docs/reference/
- Garmin — Connect Developer Program Overview: https://developer.garmin.com/gc-developer-program/overview/
- Garmin — Connect Developer Program Program FAQ: https://developer.garmin.com/gc-developer-program/program-faq/
- Garmin — Activity API: https://developer.garmin.com/gc-developer-program/activity-api/
- Komoot — API support article (could not be fetched directly; HTTP 403 on automated access): https://support.komoot.com/hc/en-us/articles/10331570510618-komoot-API
