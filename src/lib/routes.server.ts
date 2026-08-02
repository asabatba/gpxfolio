import { sql, type Updateable } from "kysely";
import { db } from "./db";
import {
  routeValues,
  toJson,
  toPhoto,
  toRoute,
  toTrack,
  trackValues,
  type Photo,
  type Route,
  type RoutesTable,
  type Track,
  type TracksTable,
  type Visibility,
} from "./db/schema";
import { buildTrack } from "./gpx/build";
import { TRACK_COLORS } from "./gpx/colors";
import { mergeBounds } from "./gpx/geo";
import { parseGpx } from "./gpx/parse";
import { aggregateStats } from "./gpx/stats";
import { GpxParseError, type BBox, type ParsedGpx, type RouteStats } from "./gpx/types";
import { buildSlug, generateId } from "./ids";
import { deleteRouteBlobs, deleteTrackGpx, writeTrackGpx } from "./storage";

/**
 * Server-only data access. Everything here touches SQLite or the filesystem, so
 * it must only be reached from `"use server"` functions — the `.server.ts`
 * suffix makes an accidental client import obvious.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_ROUTE = 10;

export interface RouteWithTracks extends Route {
  tracks: Track[];
  photos: Photo[];
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface UploadedGpx {
  filename: string;
  xml: string;
}

export interface IngestResult {
  route: Route;
  /** Per-file compression summary, surfaced to the admin after upload. */
  summary: Array<{
    filename: string;
    pointsOriginal: number;
    pointsStored: number;
    droppedOutliers: number;
  }>;
}

/** Validates one upload and turns it into rows, without touching the database. */
function prepareTracks(files: UploadedGpx[]) {
  if (files.length === 0) {
    throw new ValidationError("Select at least one GPX file.");
  }
  if (files.length > MAX_FILES_PER_ROUTE) {
    throw new ValidationError(
      `Up to ${MAX_FILES_PER_ROUTE} files per route; you selected ${files.length}.`,
    );
  }

  const prepared: Array<{
    name: string | null;
    sourceFilename: string;
    xml: string;
    built: ReturnType<typeof buildTrack>;
  }> = [];

  for (const file of files) {
    // Parsing every file before any write means a bad file at position 5
    // doesn't leave the first four persisted.
    let parsed: ParsedGpx;
    try {
      parsed = parseGpx(file.xml);
    } catch (error) {
      const detail = error instanceof GpxParseError ? error.message : "Unreadable file.";
      throw new ValidationError(`${file.filename}: ${detail}`);
    }

    // A GPX may hold several <trk> elements; each becomes its own track so it
    // gets its own colour, stats and toggle on the page.
    for (const track of parsed.tracks) {
      prepared.push({
        name: track.name ?? parsed.name ?? null,
        sourceFilename: file.filename,
        xml: file.xml,
        built: buildTrack(track.points),
      });
    }
  }

  if (prepared.length === 0) {
    throw new ValidationError("No usable tracks were found in the selected files.");
  }

  return prepared;
}

function rollupRoute(built: Array<ReturnType<typeof buildTrack>>): {
  stats: RouteStats;
  bbox: BBox;
  startedAt: Date | null;
} {
  const stats = aggregateStats(built.map((b) => b.stats));
  const bbox = mergeBounds(built.map((b) => b.bbox));
  const starts = built.map((b) => b.startedAt).filter((t): t is number => t != null);
  return {
    stats,
    bbox,
    startedAt: starts.length > 0 ? new Date(Math.min(...starts)) : null,
  };
}

export interface CreateRouteInput {
  title: string;
  description?: string | null;
  visibility: Visibility;
  activityType?: string | null;
  files: UploadedGpx[];
}

/**
 * Creates a route from one or more GPX files.
 *
 * Parsing and stats happen first, then the database rows are written in a single
 * transaction, then the original files are written to disk. If a blob write
 * fails the transaction is rolled back by hand, because SQLite cannot roll back
 * the filesystem.
 */
export async function createRoute(input: CreateRouteInput): Promise<IngestResult> {
  const title = input.title.trim();
  if (!title) throw new ValidationError("Give the route a title.");

  const prepared = prepareTracks(input.files);
  const routeId = generateId();
  const rollup = rollupRoute(prepared.map((p) => p.built));

  const trackRows: Track[] = prepared.map((p, index) => ({
    id: generateId(),
    routeId,
    name: p.name,
    sourceFilename: p.sourceFilename,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    orderIndex: index,
    geometry: p.built.series.geometry,
    elevations: p.built.series.elevations,
    distances: p.built.series.distances,
    timeOffsets: p.built.series.timeOffsets,
    pointCountOriginal: p.built.series.pointCountOriginal,
    pointCountStored: p.built.series.pointCountStored,
    bbox: p.built.bbox,
    startedAt: p.built.startedAt != null ? new Date(p.built.startedAt) : null,
    ...p.built.stats,
  }));

  const now = new Date();
  const route = await db.transaction().execute(async (tx) => {
    const inserted = await tx
      .insertInto("routes")
      .values(
        routeValues({
          id: routeId,
          slug: buildSlug(title),
          title,
          description: input.description?.trim() || null,
          visibility: input.visibility,
          activityType: input.activityType?.trim() || null,
          bbox: rollup.bbox,
          startedAt: rollup.startedAt,
          createdAt: now,
          updatedAt: now,
          ...rollup.stats,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await tx.insertInto("tracks").values(trackRows.map(trackValues)).execute();
    return toRoute(inserted);
  });

  try {
    // One file can contain several tracks; they share the same original XML.
    await Promise.all(
      trackRows.map((row, index) => writeTrackGpx(routeId, row.id, prepared[index].xml)),
    );
  } catch (error) {
    await db.deleteFrom("routes").where("id", "=", routeId).execute();
    await deleteRouteBlobs(routeId);
    throw error;
  }

  return {
    route,
    summary: prepared.map((p) => ({
      filename: p.sourceFilename,
      pointsOriginal: p.built.series.pointCountOriginal,
      pointsStored: p.built.series.pointCountStored,
      droppedOutliers: p.built.droppedOutliers,
    })),
  };
}

/** Adds more GPX files to an existing route and recomputes its aggregates. */
export async function addTracksToRoute(
  routeId: string,
  files: UploadedGpx[],
): Promise<IngestResult> {
  const existing = await getRouteById(routeId);
  if (!existing) throw new ValidationError("That route no longer exists.");

  const totalFiles = existing.tracks.length + files.length;
  if (totalFiles > MAX_FILES_PER_ROUTE) {
    throw new ValidationError(
      `A route can hold ${MAX_FILES_PER_ROUTE} tracks; this would make ${totalFiles}.`,
    );
  }

  const prepared = prepareTracks(files);
  const startIndex = existing.tracks.length;

  const trackRows: Track[] = prepared.map((p, index) => ({
    id: generateId(),
    routeId,
    name: p.name,
    sourceFilename: p.sourceFilename,
    color: TRACK_COLORS[(startIndex + index) % TRACK_COLORS.length],
    orderIndex: startIndex + index,
    geometry: p.built.series.geometry,
    elevations: p.built.series.elevations,
    distances: p.built.series.distances,
    timeOffsets: p.built.series.timeOffsets,
    pointCountOriginal: p.built.series.pointCountOriginal,
    pointCountStored: p.built.series.pointCountStored,
    bbox: p.built.bbox,
    startedAt: p.built.startedAt != null ? new Date(p.built.startedAt) : null,
    ...p.built.stats,
  }));

  await db.insertInto("tracks").values(trackRows.map(trackValues)).execute();

  try {
    await Promise.all(
      trackRows.map((row, index) => writeTrackGpx(routeId, row.id, prepared[index].xml)),
    );
  } catch (error) {
    await db
      .deleteFrom("tracks")
      .where(
        "id",
        "in",
        trackRows.map((row) => row.id),
      )
      .execute();
    throw error;
  }

  await recomputeRouteAggregates(routeId);
  const route = await getRouteById(routeId);

  return {
    route: route as Route,
    summary: prepared.map((p) => ({
      filename: p.sourceFilename,
      pointsOriginal: p.built.series.pointCountOriginal,
      pointsStored: p.built.series.pointCountStored,
      droppedOutliers: p.built.droppedOutliers,
    })),
  };
}

/**
 * Recalculates a route's aggregate stats and bbox from its remaining tracks.
 * Called after any change to the track list.
 */
export async function recomputeRouteAggregates(routeId: string): Promise<void> {
  const rows = (
    await db.selectFrom("tracks").selectAll().where("routeId", "=", routeId).execute()
  ).map(toTrack);

  if (rows.length === 0) {
    await db
      .updateTable("routes")
      .set({
        distanceM: 0,
        elevationGainM: 0,
        elevationLossM: 0,
        elevationMinM: null,
        elevationMaxM: null,
        durationS: null,
        movingTimeS: null,
        avgSpeedMps: null,
        maxSpeedMps: null,
        bbox: null,
        startedAt: null,
        updatedAt: Date.now(),
      })
      .where("id", "=", routeId)
      .execute();
    return;
  }

  const stats = aggregateStats(rows);
  const boxes = rows.map((r) => r.bbox).filter((b): b is BBox => b != null);
  const starts = rows
    .map((r) => r.startedAt?.getTime())
    .filter((t): t is number => t != null);

  await db
    .updateTable("routes")
    .set({
      ...stats,
      bbox: boxes.length > 0 ? toJson(mergeBounds(boxes)) : null,
      startedAt: starts.length > 0 ? Math.min(...starts) : null,
      updatedAt: Date.now(),
    })
    .where("id", "=", routeId)
    .execute();
}

export interface UpdateRouteInput {
  title?: string;
  description?: string | null;
  visibility?: Visibility;
  activityType?: string | null;
}

/**
 * Updates route metadata. The slug is deliberately left alone: it may already
 * have been shared, and changing it would break every existing link.
 */
export async function updateRoute(routeId: string, input: UpdateRouteInput): Promise<void> {
  const patch: Updateable<RoutesTable> = { updatedAt: Date.now() };

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ValidationError("The title cannot be empty.");
    patch.title = title;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.activityType !== undefined) patch.activityType = input.activityType?.trim() || null;

  await db.updateTable("routes").set(patch).where("id", "=", routeId).execute();
}

export async function deleteRoute(routeId: string): Promise<void> {
  // Tracks and photos cascade via the schema's foreign keys.
  await db.deleteFrom("routes").where("id", "=", routeId).execute();
  await deleteRouteBlobs(routeId);
}

export async function deleteTrack(routeId: string, trackId: string): Promise<void> {
  // distanceAlongM is only meaningful relative to this track's own distance
  // series, so it goes stale the moment the track is gone — clear it before
  // the delete, since the FK's ON DELETE SET NULL will already have nulled
  // photos.trackId by the time we could otherwise select on it. lat/lon are
  // untouched: they're still a valid point in space either way.
  await db
    .updateTable("photos")
    .set({ distanceAlongM: null })
    .where("routeId", "=", routeId)
    .where("trackId", "=", trackId)
    .execute();

  await db
    .deleteFrom("tracks")
    .where("id", "=", trackId)
    .where("routeId", "=", routeId)
    .execute();
  await deleteTrackGpx(routeId, trackId);
  await recomputeRouteAggregates(routeId);
}

/** Swaps a track with its neighbour in the route's order. A no-op at either end of the list. */
export async function moveTrack(
  routeId: string,
  trackId: string,
  direction: "up" | "down",
): Promise<void> {
  const rows = await db
    .selectFrom("tracks")
    .select(["id", "orderIndex"])
    .where("routeId", "=", routeId)
    .orderBy("orderIndex", "asc")
    .execute();

  const index = rows.findIndex((row) => row.id === trackId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= rows.length) return;

  const a = rows[index];
  const b = rows[swapWith];
  await db.transaction().execute(async (tx) => {
    await tx.updateTable("tracks").set({ orderIndex: b.orderIndex }).where("id", "=", a.id).execute();
    await tx.updateTable("tracks").set({ orderIndex: a.orderIndex }).where("id", "=", b.id).execute();
  });
}

export interface UpdateTrackInput {
  name?: string | null;
}

/**
 * Renames a track. Colour is deliberately not editable here — it's assigned
 * automatically from `TRACK_COLORS` at upload time so tracks on a multi-day
 * route stay visually distinct without an admin having to manage that.
 */
export async function updateTrack(
  routeId: string,
  trackId: string,
  input: UpdateTrackInput,
): Promise<void> {
  const patch: Updateable<TracksTable> = {};
  if (input.name !== undefined) patch.name = input.name?.trim() || null;
  if (Object.keys(patch).length === 0) return;

  await db
    .updateTable("tracks")
    .set(patch)
    .where("id", "=", trackId)
    .where("routeId", "=", routeId)
    .execute();
}

/** Gallery/pin order: earliest capture first, undated photos last, then upload order. */
export async function listRoutePhotos(routeId: string): Promise<Photo[]> {
  const rows = await db
    .selectFrom("photos")
    .selectAll()
    .where("routeId", "=", routeId)
    .orderBy(sql`taken_at is null`)
    .orderBy("takenAt", "asc")
    .orderBy("orderIndex", "asc")
    .execute();
  return rows.map(toPhoto);
}

async function withTracks(route: Route | undefined): Promise<RouteWithTracks | null> {
  if (!route) return null;
  const [tracks, photos] = await Promise.all([
    db
      .selectFrom("tracks")
      .selectAll()
      .where("routeId", "=", route.id)
      .orderBy("orderIndex", "asc")
      .execute(),
    listRoutePhotos(route.id),
  ]);
  return { ...route, tracks: tracks.map(toTrack), photos };
}

export async function getRouteBySlug(slug: string): Promise<RouteWithTracks | null> {
  const route = await db
    .selectFrom("routes")
    .selectAll()
    .where("slug", "=", slug)
    .executeTakeFirst();
  return withTracks(route && toRoute(route));
}

export async function getRouteById(id: string): Promise<RouteWithTracks | null> {
  const route = await db
    .selectFrom("routes")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return withTracks(route && toRoute(route));
}

/** Homepage gallery: public routes only, newest activity first. */
export async function listPublicRoutes(): Promise<Route[]> {
  const rows = await db
    .selectFrom("routes")
    .selectAll()
    .where("visibility", "=", "public")
    .orderBy("startedAt", "desc")
    .orderBy("createdAt", "desc")
    .execute();
  return rows.map(toRoute);
}

/** Admin list: everything, including unlisted routes. */
export async function listAllRoutes(): Promise<Route[]> {
  const rows = await db
    .selectFrom("routes")
    .selectAll()
    .orderBy("startedAt", "desc")
    .orderBy("createdAt", "desc")
    .execute();
  return rows.map(toRoute);
}

/** Lightweight geometry for gallery thumbnails, without the full series arrays. */
export async function listRouteThumbnails(
  routeIds: string[],
): Promise<Map<string, Array<{ geometry: string; color: string }>>> {
  const result = new Map<string, Array<{ geometry: string; color: string }>>();
  if (routeIds.length === 0) return result;

  const rows = await db
    .selectFrom("tracks")
    .select(["routeId", "geometry", "color"])
    .where("routeId", "in", routeIds)
    .orderBy("orderIndex", "asc")
    .execute();

  for (const row of rows) {
    const list = result.get(row.routeId) ?? [];
    list.push({ geometry: row.geometry, color: row.color });
    result.set(row.routeId, list);
  }
  return result;
}
