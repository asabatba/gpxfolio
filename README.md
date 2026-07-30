# gpx-share

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
SQLite via Drizzle ORM · Vitest. Distances are metric throughout.

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
pnpm db:migrate           # creates ./data/gpx-share.db
pnpm dev                  # http://localhost:3000
```

Set these in `.env`:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | The single password used at `/login` to upload and edit. |
| `SESSION_SECRET` | Signs the session cookie. Must be ≥32 characters. |
| `DATABASE_PATH` | SQLite file location. Defaults to `./data/gpx-share.db`. |
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
  gpx-share.db                              routes, tracks, stats
  blobs/<routeId>/tracks/<trackId>.gpx.gz   original uploads
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Dev server with HMR |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm test` | Vitest suite (GPX pipeline, formatting, ids) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Generate a migration after editing the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the database |

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

## Planned: photos

The `photos` table and the `data/blobs/<routeId>/photos/` path already exist and
are documented in `src/lib/db/schema.ts`, so the feature needs no migration. The
intended flow is to read EXIF `DateTimeOriginal` from an upload and match it
against `tracks.timeOffsets` to place the photo along the route, preferring the
image's own GPS tags when present. Nothing reads the table yet.
