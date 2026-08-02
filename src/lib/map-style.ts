import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";

/**
 * Shared between `RouteMap` (the full route page) and `PreviewMap` (the
 * small upload preview) so both draw tracks on the same basemap and neither
 * duplicates the tile/worker setup.
 *
 * Importing this module pulls in `maplibre-gl`, which only runs client-side
 * (see the note in RouteMap.tsx) — only import it from components already
 * loaded through `clientOnly()`.
 */

/**
 * OpenHikingMap raster tiles: OSM data rendered with paths, trail waymarks and
 * contour lines, which is what a route page actually wants behind a track.
 *
 * Raster rather than vector, so there is a single rendering and no dark variant —
 * the basemap looks the same in both colour schemes, while the app chrome and the
 * map controls still follow the system theme (see app.css).
 *
 * Zoom range verified against the server: z18 is the deepest level served (z19
 * returns 404). `maxzoom: 18` makes MapLibre upscale past that rather than
 * request tiles that don't exist.
 */
export const HIKING_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    hiking: {
      type: "raster",
      tiles: ["https://tile.openmaps.fr/hiking/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &middot; tiles <a href="https://tile.openmaps.fr" target="_blank" rel="noopener">openmaps.fr</a>',
    },
  },
  layers: [{ id: "hiking", type: "raster", source: "hiking" }],
};

/**
 * Fallback used when the hiking tiles can't be reached. openmaps.fr is a
 * community server with no published uptime guarantee, so a route stays viewable
 * on standard OSM tiles rather than showing an empty grey box.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/**
 * MapLibre works out its worker's URL at runtime by rewriting its own module
 * URL. Vite can't see through that, so the worker chunk is never emitted and the
 * request lands on the SPA fallback — which returns the HTML page with a 200.
 * The worker then fails to start, and the map never fires `load`: blank map, no
 * track, and no error anywhere. Pointing MapLibre at a copy served from
 * `public/maplibre/` (see scripts/copy-maplibre-worker.mjs) avoids the guesswork
 * entirely, in dev and production alike.
 *
 * `setWorkerUrl` is a module-level call in the maplibre-gl API, safe to invoke
 * more than once (each map component's module calls it on load), so no guard
 * is needed here.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
