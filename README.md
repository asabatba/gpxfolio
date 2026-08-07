# gpxfolio

A personal site for sharing recorded routes. Upload one or more GPX files, get a
polished, mobile-friendly page with a MapLibre map, statistics pulled from the
file, and an interactive elevation profile linked to the map.

- **Public by link, listed by choice.** Each route is either `unlisted`
  (reachable only via an unguessable slug) or `public` (also shown on the
  homepage gallery). Viewing never requires an account.
- **Aggressive geometry compression, unchanged numbers.** A 5,400-point file is
  stored as ~60 points — a 98.8% reduction with a worst-case deviation of 2.7 m
  from the original line, well inside GPS's own error. Statistics are computed
  from the full-resolution track *before* simplification, so nothing on the page
  gets less accurate.
- **The original file is kept.** Downloads serve the exact bytes that were
  uploaded, never a re-serialised approximation.

## Stack

SolidStart (SSR, Node preset) · TypeScript · Tailwind CSS v4 · MapLibre GL v6 ·
SQLite via Kysely · `markdown-it` · Vitest. Distances are metric throughout.

### Database

`src/lib/db/schema.ts` holds both halves of the schema. The `Database` interface
describes the tables as SQLite stores them — timestamps as epoch-millisecond
integers, arrays as JSON text, since SQLite has neither type — and is what
Kysely type-checks queries against. `Route`, `Track` and `Photo` are what the
rest of the app sees, with real `Date`s and arrays; the `to*`/`*Values`
functions in that file are the only place the two meet. Columns are camelCase in
TypeScript and snake_case in SQL, translated in both directions by Kysely's
`CamelCasePlugin`, so anything bypassing the query builder — migrations included
— has to spell out the snake_case names.

Migrations are hand-written in `migrations/`, applied by `pnpm db:migrate`, and
tracked in a `kysely_migration` table. They're plain JS so the deploy can run
them with bare `node` and no build step. There's no schema-diffing generator and
no `db:studio`; any SQLite browser opens `data/gpxfolio.db` directly.

### Basemap

OpenHikingMap raster tiles from `tile.openmaps.fr/hiking/{z}/{x}/{y}.png` — OSM
data rendered with paths, trail waymarks, contour lines and hill shading, which
is what you want behind a recorded track. No API key.

Two things to know about this choice:

- **It's a community server with no published usage policy** (its root is a
  default Apache page) and no uptime guarantee. If it becomes unreachable,
  `RouteMap.tsx` falls back to standard OSM tiles after a few failed requests so
  routes stay viewable. For anything beyond personal traffic, run your own tile
  server or switch the source.
- **Raster tiles have a single rendering, so there is no dark basemap.** The map
  looks the same in both colour schemes; the app chrome and map controls still
  follow the system theme.

Zoom 18 is the deepest level served (19 returns 404), so the source declares
`maxzoom: 18` and MapLibre upscales beyond it. Track colours in
`src/lib/routes.server.ts` are deliberately magenta/violet/blue — this basemap
uses orange and yellow for its own paths, so an orange track vanishes into the
road network.

## Getting started

```bash
pnpm install
cp .env.example .env      # then edit it — see below
pnpm db:migrate           # creates ./data/gpxfolio.db
pnpm dev                  # http://localhost:3000
```

Set these in `.env`:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | The single password used at `/login` to upload and edit. |
| `SESSION_SECRET` | Signs the session cookie. Must be ≥32 characters. |
| `DATABASE_PATH` | SQLite file location. Defaults to `./data/gpxfolio.db`. |
| `PUBLIC_SITE_URL` | Public origin, used for absolute share URLs. |
| `PUBLIC_SITE_NAME` | Site name shown in the header. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then sign in at `/login` and upload a GPX at `/admin/new`.

## Production

```bash
pnpm build
pnpm db:migrate     # apply any new migrations
pnpm start          # serves on PORT (default 3000)
```

`pnpm start` loads `.env` via Node's `--env-file-if-exists`. Real environment
variables take precedence, so a systemd unit or Docker `environment:` block
works as expected. Put the app behind a TLS-terminating reverse proxy — the
session cookie sets `Secure` when `NODE_ENV=production`, and won't be sent over
plain HTTP.

### What to back up

Everything that matters lives in one directory:

```text
data/
  gpxfolio.db                                 routes, tracks, photos, stats
  blobs/<routeId>/tracks/<trackId>.gpx.gz     original GPX uploads
  blobs/<routeId>/photos/<photoId>.jpg        resized photos (full + _thumb)
```

## Deploying to CapRover

`Dockerfile`, `.dockerignore` and `captain-definition` are set up at the repo
root — `caprover deploy` (or a connected git repo) builds and ships the app
with no extra config beyond what's below.

**How the image is built.** Two stages: the builder installs `python3 make g++`
(needed to compile `better-sqlite3`'s native binding — see below), installs with
pnpm, runs `pnpm build`, then `pnpm prune --prod` to drop devDependencies (vite,
vitest, typescript, tailwind, ...). The runtime stage copies out `.output/` (the
built server), `migrations/` and that pruned `node_modules` — so migrations run
via a plain `node scripts/migrate.mjs`, identical to how it already works
outside Docker.

That last part matters: an earlier version of this Dockerfile tried to avoid
shipping a runtime `node_modules` at all, on the theory that Nitro's
node-server preset bundles everything the server needs into
`.output/server/node_modules` already (true for the *server itself* — verified
against a real build). But Nitro's bundling is a **trace**: it only copies the
specific files it can prove are reachable from the compiled server entry point.
`scripts/migrate.mjs` is a separate script outside that trace, so what *it*
imports is invisible to the tracer. Back when migrations ran through Drizzle,
that showed up as `.output/server/node_modules/drizzle-orm/better-sqlite3/`
containing `driver.js`, `index.js` and `session.js` but not the `migrator.js`
the script needed, and every container built from that image died on startup
with `ERR_MODULE_NOT_FOUND` — the gap was baked in at build time, not something
that only appeared on a later restart. The successful traffic in the deploy log
that first surfaced this was from CapRover keeping the *previous* deployment
alive while the new (broken) one failed its startup and never went live — not
the same container working, then breaking. Nothing about that is specific to
Drizzle; `kysely/migration` and the `migrations/` files themselves sit outside
the trace in exactly the same way. A real `node_modules`, produced the ordinary
way, doesn't have the gap: `kysely` and `better-sqlite3` are both direct
dependencies in `package.json`, so `pnpm prune --prod` keeps the whole packages.

`better-sqlite3` ships prebuilt binaries for several platforms, but it has no
install/postinstall script of its own — only a `binding.gyp` — and npm/pnpm's
implicit rule for that combination is to run `node-gyp rebuild` at install time
*regardless* of whether a usable prebuild exists. Alpine's base image has
neither Python nor a compiler, so that step fails outright unless the toolchain
is installed first; that's the entire reason the builder stage carries
`python3 make g++` even though nothing else in the app needs to compile
anything. Because it compiles in the builder stage and the compiled result
travels across in the pruned `node_modules`, the runtime stage never needs that
toolchain itself.

**Before the first deploy, in the CapRover dashboard:**

1. **App Configs → Persistent Directories** — add `/app/data`. Without this,
   every redeploy starts from an empty site: routes, tracks and uploaded GPX
   files all live under that path (see `src/lib/storage.ts`), and containers
   are otherwise ephemeral.
2. **App Configs → Environmental Variables** — set:
   - `ADMIN_PASSWORD` — the upload/edit password.
   - `SESSION_SECRET` — 32+ random characters (`node -e
     "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - `PUBLIC_SITE_URL` — the app's public HTTPS URL, e.g.
     `https://routes.yourdomain.com`.
   - `PUBLIC_SITE_NAME` — optional; shown in the header.

   `DATABASE_PATH` doesn't need setting — the default (`./data/gpxfolio.db`,
   resolved against the container's `/app` working directory) already lands
   inside the persistent directory from step 1.
3. **HTTP Settings → Enable HTTPS** (and ideally **Force HTTPS**). The session
   cookie is marked `Secure` whenever `NODE_ENV=production` (set in the
   Dockerfile), so it's dropped by the browser on a plain-HTTP connection and
   `/login` will silently fail to keep you signed in until HTTPS is on.

The container listens on port 80 by default (`ENV PORT=80` in the Dockerfile),
matching CapRover's default "Container HTTP Port" — no HTTP Settings change
needed there unless you've customised it.

Docker wasn't available in the environment this was written in, so this has
been fixed twice now against real deploy evidence rather than a local `docker
build` — the `binding.gyp`/Python failure and the missing-`migrator.js` crash
were both diagnosed from actual CapRover logs, and both fixes were checked as
far as possible without running Docker (dependency reachability confirmed with
`pnpm why --prod`, the missing file confirmed present in a normal, unpruned
install). Neither issue was subtle or intermittent — each broke the same way
on every attempt — which is reassuring, but two rounds of "worked on paper,
didn't work in practice" is also a reason not to fully trust the third round
sight unseen. Watch the next deploy's build log, and confirm the app is
actually reachable afterward — CapRover will keep serving the previous
deployment if the new one fails to start, so a quiet build log isn't proof the
new container is the one actually live.

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Dev server with HMR |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm test` | Vitest suite (GPX pipeline, formatting, ids) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:migrate` | Apply pending migrations |

`dev` and `build` both first run `scripts/copy-maplibre-worker.mjs`, which copies
MapLibre's Web Worker into `public/maplibre/` (gitignored). This is not
incidental: MapLibre derives its worker URL at runtime by rewriting its own
module URL, which Vite cannot statically analyse, so the worker is never emitted
into the client build. The request then falls through to the SPA handler and gets
the HTML page back with a `200`, the worker fails to start, and the map goes
blank with no error in the console — in production only. Copying the file and
pointing `setWorkerUrl()` at it removes the guesswork. If the map ever renders
controls but no basemap, check that `/maplibre/maplibre-gl-worker.mjs` is served
as JavaScript.

## How the GPX pipeline works

`src/lib/gpx/` is plain, dependency-light TypeScript and holds the interesting
logic. Order is deliberate — see `build.ts`:

1. **`parse.ts`** reads `<trkpt>` lat/lon/ele/time plus Garmin heart rate.
   Namespace prefixes are stripped so `gpxtpx:hr`, `ns3:hr` and `hr` all work.
   Malformed individual points are skipped rather than failing the whole upload;
   files with only `<rte>` fall back to route points.
2. **`denoise.ts`** drops GPS teleport glitches — single fixes implying >216 km/h.
   This runs first because one 200 m spike corrupts three things at once: it adds
   ~400 m of phantom distance, ruins max speed, and puts a visible spike on the
   map.
3. **`stats.ts`** computes every displayed figure from the full-resolution track.
   Elevation gain uses **hysteresis against a moving reference** rather than a
   per-step threshold: a steady climb sampled at 1 Hz moves centimetres per
   sample, so a naive 3 m cutoff would report zero gain, while a naive
   `sum(max(0, delta))` inflates a flat ride by hundreds of metres. Max speed is
   measured over a 5 s window, since adjacent-sample speed turns a 10 m jump into
   36 km/h.
4. **`simplify.ts`** runs Ramer–Douglas–Peucker at a 2.5 m tolerance, returning
   the **indices** it keeps so the elevation, distance and time arrays stay
   aligned. It is iterative (a recursive version overflows on long tracks) and
   runs over 2,000-point windows, which bounds RDP's O(n²) worst case — a jagged
   100k-point track went from 12 s to 155 ms with no loss of the tolerance
   guarantee.
5. **`encode.ts`** stores coordinates as a precision-5 encoded polyline, ~4×
   smaller than a JSON array with ~1 m quantisation.

Accuracy is enforced by tests, not just intent: `pnpm test` asserts that stats
are identical before and after simplification, that no original point strays
further than tolerance + quantisation from the stored line, and that total track
length is preserved to within 0.5%.

## Photos

The admin can attach photos to a route from its edit page. Each upload is
re-encoded with `sharp` into two fixed-size JPEGs — a 2048px display size and a
480px gallery thumbnail — and the original bytes are discarded, so
`data/blobs/<routeId>/photos/<photoId>.jpg` / `<photoId>_thumb.jpg` are all
that's kept. HEIC/HEIF uploads are rejected with a message to export as JPEG
first; Alpine has no `libheif`, so this needs no Dockerfile change.

**Placement is a two-part problem: time, then position.** `exifr`
(`src/lib/photos/exif.ts`) reads each photo's `DateTimeOriginal`,
`OffsetTimeOriginal`, GPS timestamp and GPS lat/lon. GPX `<time>` always parses
to a real UTC instant, but `DateTimeOriginal` is naive local wall-clock time
with no timezone — the camera's clock has no guaranteed relationship to where
the GPX was recorded. Resolution order for the capture instant: the photo's own
GPS timestamp (already UTC) beats an explicit `OffsetTimeOriginal`, which beats
a **batch-inferred camera offset** (`src/lib/photos/offset.ts`): a bounded
search over every plausible UTC offset, picking whichever keeps the most
naive timestamps in one upload batch inside the route's own recorded time span.
Ties (more than one offset fits equally well) are broken toward the *median* of
the tied candidates, not the one closest to zero — the true offset sits at the
centre of that band, and biasing toward "no correction" would defeat the point.

For position, the photo's own GPS tags win unconditionally when present
(`src/lib/photos/match.ts` still looks up a nearby track point, within 300 m,
purely for the elevation-profile's `distanceAlongM`). Without GPS, the resolved
capture instant is matched against each track's own time span, snapping the
photo to that track's coordinate at the nearest recorded moment. An admin can
manually shift a batch's capture times (in the edit page's photo toolbar) if
the inferred offset looks wrong — this adjusts `takenAt` for gallery
ordering/display, but deliberately doesn't try to re-derive a pin's position
after the fact, since a persisted photo no longer records whether its
coordinates came from its own GPS tags (which shouldn't move) or a
time-matched track point (which should).

Photos show as a gallery on the route page and as pins on the map (hand-built
MapLibre `Marker`s, like the existing start/finish endpoints — no plugin);
clicking a pin opens the gallery to that photo.

## Trip story

A route can carry a freeform write-up plus two small structured facts —
conditions and a 1-5 "would I do this again?" rating — edited from the route's
edit page and shown as a Story section after the photo gallery on the public
page. The story is not woven into the map/elevation profile the way photos
are: it's Markdown (`src/lib/story.ts`, rendered with `markdown-it`), not
positional data, so it's just a block of text next to whatever photos already
exist, not synced to a point along the track.

`html: false` (markdown-it's default) means raw `<tag>`s typed into the field
are escaped rather than rendered — the admin is the only author, but the
output is public, so there's no reason to open an HTML-injection surface for a
feature that doesn't need one. `breaks: true` turns a single Enter into a line
break, since CommonMark's blank-line-between-paragraphs rule is a foot-gun for
someone typing prose, not Markdown. The edit page's `StoryField` renders the
same function client-side for a toggleable preview, so what you see before
saving is what visitors see after.
