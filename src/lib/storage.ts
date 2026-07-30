import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Every filesystem path used by the app is built here, so there is exactly one
 * place that knows the on-disk layout:
 *
 *   data/
 *     gpxfolio.db
 *     blobs/<routeId>/tracks/<trackId>.gpx.gz
 *     blobs/<routeId>/photos/<photoId>.<ext>     (planned)
 */

export const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/gpxfolio.db");

/** Blobs live next to the database so a single directory is all that needs backing up. */
export const dataDir = dirname(databasePath);
export const blobsDir = join(dataDir, "blobs");

/**
 * Guards against a crafted id escaping the blobs directory. Ids are generated
 * server-side, but they also arrive as route parameters, so this is checked
 * rather than assumed.
 */
function assertSafeId(id: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(id)}`);
  }
}

export function routeBlobDir(routeId: string): string {
  assertSafeId(routeId, "route id");
  return join(blobsDir, routeId);
}

export function trackGpxPath(routeId: string, trackId: string): string {
  assertSafeId(trackId, "track id");
  return join(routeBlobDir(routeId), "tracks", `${trackId}.gpx.gz`);
}

export function routePhotosDir(routeId: string): string {
  return join(routeBlobDir(routeId), "photos");
}

/**
 * Stores the original upload gzipped. GPX is verbose XML that compresses to
 * roughly a tenth of its size, and keeping the original means a viewer can
 * always download the exact file that was uploaded, not a re-serialised
 * approximation of it.
 */
export async function writeTrackGpx(
  routeId: string,
  trackId: string,
  xml: string,
): Promise<void> {
  const path = trackGpxPath(routeId, trackId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, gzipSync(Buffer.from(xml, "utf8")));
}

export async function readTrackGpx(routeId: string, trackId: string): Promise<string> {
  const compressed = await readFile(trackGpxPath(routeId, trackId));
  return gunzipSync(compressed).toString("utf8");
}

/** Removes a route's blobs. Safe to call when the directory was never created. */
export async function deleteRouteBlobs(routeId: string): Promise<void> {
  await rm(routeBlobDir(routeId), { recursive: true, force: true });
}

export async function deleteTrackGpx(routeId: string, trackId: string): Promise<void> {
  await rm(trackGpxPath(routeId, trackId), { force: true });
}

export async function ensureDataDir(): Promise<void> {
  await mkdir(blobsDir, { recursive: true });
}
