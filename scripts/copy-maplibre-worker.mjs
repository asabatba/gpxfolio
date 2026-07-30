/*
 * Copies MapLibre's Web Worker into public/maplibre/ so it can be served as a
 * static file.
 *
 * Why this is necessary: MapLibre derives its worker URL at runtime by string
 * manipulation of its own module URL. That is invisible to Vite's static
 * analysis, so the worker chunk is never emitted into the client build. The
 * request then falls through to the SPA handler, which answers with the HTML
 * page — a 200 response containing HTML, so nothing reports an error. The worker
 * silently fails to start and the map never fires `load`: no basemap, no track,
 * no console error. It only shows up in production, because the dev server
 * resolves the worker straight out of node_modules.
 *
 * Copying from node_modules on every build means the served worker can never
 * drift from the installed maplibre-gl version. RouteMap points MapLibre at it
 * with setWorkerUrl().
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const targetDir = resolve("./public/maplibre");

mkdirSync(targetDir, { recursive: true });

// The worker imports "./maplibre-gl-shared.mjs" relatively, so both files must
// sit in the same served directory.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(distDir, file), join(targetDir, file));
  console.log(`copied ${file} -> public/maplibre/`);
}
