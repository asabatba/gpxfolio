import type { Updateable } from "kysely";
import sharp from "sharp";
import { db } from "./db";
import {
  photoValues,
  toPhoto,
  type Photo,
  type PhotosTable,
  type PositionSource,
  type Track,
} from "./db/schema";
import { decodePolyline } from "./gpx/encode";
import { generateId } from "./ids";
import { readPhotoExif, type PhotoExif } from "./photos/exif";
import {
  nearestSpatialPoint,
  routeTimeRange,
  selectTrackForCapture,
  type TimedTrack,
} from "./photos/match";
import { inferCameraOffsetMinutes, type OffsetInference } from "./photos/offset";
import { getRouteById, listRoutePhotos, ValidationError } from "./routes.server";
import { deletePhoto as deletePhotoBlob, writePhoto } from "./storage";

/**
 * Server-only data access for route photos — mirrors the conventions in
 * `routes.server.ts` (`ValidationError`, validate-then-write, roll back by
 * hand if a blob write fails after the DB commit).
 */

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 40;
export const MAX_PHOTOS_PER_ROUTE = 300;

const FULL_LONG_EDGE = 2048;
const THUMB_LONG_EDGE = 480;

/** How far a photo's own GPS fix may sit from a track before it's treated as unrelated to it. */
const SPATIAL_MATCH_MAX_M = 300;
/** How far outside a track's own recorded span a capture instant may fall and still be matched to it. */
const TIME_MATCH_TOLERANCE_MS = 3 * 60 * 60 * 1000;

const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

const EMPTY_EXIF: PhotoExif = {
  naiveDateTimeOriginal: null,
  offsetMinutes: null,
  gpsUtcMs: null,
  lat: null,
  lon: null,
};

export interface UploadedPhoto {
  filename: string;
  bytes: Buffer;
}

export type TimeSource = "gps" | "exif-offset" | "inferred" | "uncorrected" | "none";

export interface PhotoUploadSummary {
  id: string;
  timeSource: TimeSource;
}

export interface AddPhotosResult {
  photos: PhotoUploadSummary[];
  inference: OffsetInference | null;
}

function assertPhotoExtension(filename: string): void {
  if (HEIC_EXT.test(filename)) {
    throw new ValidationError(
      `${filename}: HEIC/HEIF photos aren't supported — export as JPEG when sharing from your phone, or change the camera's photo format setting.`,
    );
  }
  if (!ALLOWED_EXT.test(filename)) {
    throw new ValidationError(`${filename} is not a supported image type (JPEG, PNG, or WebP).`);
  }
}

/**
 * `.rotate()` auto-orients from the EXIF orientation tag and consumes it, so
 * the tag isn't double-applied by a viewer that also honours it. Both outputs
 * are re-encoded JPEG regardless of the source format — the original bytes
 * are not kept, unlike GPX uploads, so there is no extra "what format is this
 * blob" column to maintain.
 */
async function resizePhoto(
  bytes: Buffer,
): Promise<{ full: Buffer; thumb: Buffer; width: number; height: number }> {
  const oriented = sharp(bytes).rotate();

  const { data: full, info } = await oriented
    .clone()
    .resize(FULL_LONG_EDGE, FULL_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const thumb = await oriented
    .clone()
    .resize(THUMB_LONG_EDGE, THUMB_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();

  return { full, thumb, width: info.width, height: info.height };
}

interface TrackIndex {
  timedTracks: TimedTrack[];
  trackCoords: Map<string, Array<[number, number]>>;
  trackDistances: Map<string, number[]>;
}

/** Shared indexing of a route's tracks, for matching a capture instant/position against them. */
function buildTrackIndex(tracks: Track[]): TrackIndex {
  const timedTracks: TimedTrack[] = tracks.map((t) => ({
    id: t.id,
    startedAt: t.startedAt?.getTime() ?? null,
    timeOffsets: t.timeOffsets,
    distances: t.distances,
  }));

  const trackCoords = new Map<string, Array<[number, number]>>();
  const trackDistances = new Map<string, number[]>();
  for (const t of tracks) {
    trackCoords.set(t.id, decodePolyline(t.geometry));
    trackDistances.set(t.id, t.distances);
  }

  return { timedTracks, trackCoords, trackDistances };
}

function nearestAcrossTracks(
  trackCoords: Map<string, Array<[number, number]>>,
  lat: number,
  lon: number,
): { trackId: string; index: number; distanceM: number } | null {
  let best: { trackId: string; index: number; distanceM: number } | null = null;
  for (const [trackId, coords] of trackCoords) {
    const match = nearestSpatialPoint(coords, lat, lon);
    if (match && (best === null || match.distanceM < best.distanceM)) {
      best = { trackId, index: match.index, distanceM: match.distanceM };
    }
  }
  return best;
}

interface Placement {
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
  positionSource: PositionSource | null;
  trackId: string | null;
  distanceAlongM: number | null;
  timeSource: TimeSource;
}

/**
 * Resolves capture time and position for one photo, in priority order:
 *
 * Time: GPS timestamp (already UTC) > explicit `OffsetTimeOriginal` >
 * batch-inferred camera offset > the naive value used as-is (only possible
 * when no track in the route has time data to calibrate against, in which
 * case there is nothing to correct against anyway) > nothing.
 *
 * Position: the photo's own GPS tags win unconditionally when present — a
 * track association is still attached if a trackpoint sits within
 * {@link SPATIAL_MATCH_MAX_M}, purely for `distanceAlongM` (elevation-profile
 * placement), but the coordinates themselves are never overridden by a track
 * match. Failing that, a resolved capture instant is matched against the
 * tracks' own recorded time spans.
 */
function resolvePhotoPlacement(
  exif: PhotoExif,
  inferredOffsetMinutes: number | null,
  timedTracks: TimedTrack[],
  trackCoords: Map<string, Array<[number, number]>>,
  trackDistances: Map<string, number[]>,
): Placement {
  let captureUtcMs: number | null = null;
  let timeSource: TimeSource = "none";

  if (exif.gpsUtcMs != null) {
    captureUtcMs = exif.gpsUtcMs;
    timeSource = "gps";
  } else if (exif.naiveDateTimeOriginal != null && exif.offsetMinutes != null) {
    captureUtcMs = exif.naiveDateTimeOriginal - exif.offsetMinutes * 60_000;
    timeSource = "exif-offset";
  } else if (exif.naiveDateTimeOriginal != null && inferredOffsetMinutes != null) {
    captureUtcMs = exif.naiveDateTimeOriginal - inferredOffsetMinutes * 60_000;
    timeSource = "inferred";
  } else if (exif.naiveDateTimeOriginal != null) {
    captureUtcMs = exif.naiveDateTimeOriginal;
    timeSource = "uncorrected";
  }

  let lat = exif.lat;
  let lon = exif.lon;
  let trackId: string | null = null;
  let distanceAlongM: number | null = null;
  let positionSource: PositionSource | null = null;

  if (lat != null && lon != null) {
    positionSource = "gps";
    const nearest = nearestAcrossTracks(trackCoords, lat, lon);
    if (nearest && nearest.distanceM <= SPATIAL_MATCH_MAX_M) {
      trackId = nearest.trackId;
      distanceAlongM = trackDistances.get(nearest.trackId)?.[nearest.index] ?? null;
    }
  } else if (captureUtcMs != null) {
    const match = selectTrackForCapture(timedTracks, captureUtcMs, TIME_MATCH_TOLERANCE_MS);
    if (match) {
      trackId = match.trackId;
      const point = trackCoords.get(match.trackId)?.[match.index];
      if (point) {
        lat = point[0];
        lon = point[1];
        positionSource = "time-match";
      }
      distanceAlongM = trackDistances.get(match.trackId)?.[match.index] ?? null;
    }
  }

  return {
    takenAt: captureUtcMs != null ? new Date(captureUtcMs) : null,
    lat,
    lon,
    positionSource,
    trackId,
    distanceAlongM,
    timeSource,
  };
}

interface PreparedPhoto extends Placement {
  filename: string;
  fullBytes: Buffer;
  thumbBytes: Buffer;
  width: number;
  height: number;
}

/** Validates and processes an upload batch, without touching the database. */
export async function preparePhotos(
  tracks: Track[],
  files: UploadedPhoto[],
): Promise<{ prepared: PreparedPhoto[]; inference: OffsetInference | null }> {
  if (files.length === 0) {
    throw new ValidationError("Select at least one photo.");
  }
  if (files.length > MAX_PHOTOS_PER_UPLOAD) {
    throw new ValidationError(
      `Up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time; you selected ${files.length}.`,
    );
  }
  for (const file of files) {
    assertPhotoExtension(file.filename);
    if (file.bytes.byteLength > MAX_PHOTO_BYTES) {
      throw new ValidationError(
        `${file.filename} is larger than the ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB limit.`,
      );
    }
  }

  const { timedTracks, trackCoords, trackDistances } = buildTrackIndex(tracks);

  // Parsing/resizing every file before any DB write means a bad file at
  // position 5 doesn't leave the first four persisted.
  const extracted = await Promise.all(
    files.map(async (file) => {
      let resized: Awaited<ReturnType<typeof resizePhoto>>;
      try {
        resized = await resizePhoto(file.bytes);
      } catch {
        throw new ValidationError(`${file.filename}: couldn't be read as an image.`);
      }
      const exif = await readPhotoExif(file.bytes).catch(() => EMPTY_EXIF);
      return { filename: file.filename, resized, exif };
    }),
  );

  const range = routeTimeRange(timedTracks);
  const naiveOnly = extracted
    .filter((e) => e.exif.gpsUtcMs == null && e.exif.offsetMinutes == null && e.exif.naiveDateTimeOriginal != null)
    .map((e) => e.exif.naiveDateTimeOriginal as number);
  const inference =
    range && naiveOnly.length > 0 ? inferCameraOffsetMinutes(naiveOnly, range.startMs, range.endMs) : null;

  const prepared: PreparedPhoto[] = extracted.map((item) => ({
    filename: item.filename,
    fullBytes: item.resized.full,
    thumbBytes: item.resized.thumb,
    width: item.resized.width,
    height: item.resized.height,
    ...resolvePhotoPlacement(
      item.exif,
      inference?.offsetMinutes ?? null,
      timedTracks,
      trackCoords,
      trackDistances,
    ),
  }));

  return { prepared, inference };
}

/** Adds a batch of photos to a route, resizing/placing each and writing both blob variants. */
export async function addPhotosToRoute(
  routeId: string,
  files: UploadedPhoto[],
): Promise<AddPhotosResult> {
  const route = await getRouteById(routeId);
  if (!route) throw new ValidationError("That route no longer exists.");

  const existingPhotos = await listRoutePhotos(routeId);
  const totalPhotos = existingPhotos.length + files.length;
  if (totalPhotos > MAX_PHOTOS_PER_ROUTE) {
    throw new ValidationError(
      `A route can hold ${MAX_PHOTOS_PER_ROUTE} photos; this would make ${totalPhotos}.`,
    );
  }

  const { prepared, inference } = await preparePhotos(route.tracks, files);
  const startIndex = existingPhotos.length;

  const rows: Photo[] = prepared.map((p, index) => ({
    id: generateId(),
    routeId,
    trackId: p.trackId,
    filename: p.filename,
    caption: null,
    takenAt: p.takenAt,
    lat: p.lat,
    lon: p.lon,
    positionSource: p.positionSource,
    distanceAlongM: p.distanceAlongM,
    width: p.width,
    height: p.height,
    orderIndex: startIndex + index,
    createdAt: new Date(),
  }));

  await db.insertInto("photos").values(rows.map(photoValues)).execute();

  try {
    await Promise.all(
      rows.map((row, index) =>
        Promise.all([
          writePhoto(routeId, row.id, "full", prepared[index].fullBytes),
          writePhoto(routeId, row.id, "thumb", prepared[index].thumbBytes),
        ]),
      ),
    );
  } catch (error) {
    await db
      .deleteFrom("photos")
      .where(
        "id",
        "in",
        rows.map((row) => row.id),
      )
      .execute();
    throw error;
  }

  return {
    photos: rows.map((row, index) => ({ id: row.id, timeSource: prepared[index].timeSource })),
    inference,
  };
}

export async function getPhoto(routeId: string, photoId: string): Promise<Photo | null> {
  const row = await db
    .selectFrom("photos")
    .selectAll()
    .where("id", "=", photoId)
    .where("routeId", "=", routeId)
    .executeTakeFirst();
  return row ? toPhoto(row) : null;
}

export async function updatePhotoCaption(
  routeId: string,
  photoId: string,
  caption: string | null,
): Promise<void> {
  await db
    .updateTable("photos")
    .set({ caption: caption?.trim() || null })
    .where("id", "=", photoId)
    .where("routeId", "=", routeId)
    .execute();
}

export async function deletePhoto(routeId: string, photoId: string): Promise<void> {
  await db.deleteFrom("photos").where("id", "=", photoId).where("routeId", "=", routeId).execute();
  await deletePhotoBlob(routeId, photoId);
}

/**
 * Manual correction for a batch whose inferred (or absent) offset looks
 * wrong: shifts `takenAt` by a fixed amount.
 *
 * `positionSource` records how each photo's position was derived, so this can
 * do the right thing per photo: a `"gps"` pin came from the photo's own EXIF
 * tags and must never move from a time-based guess, so only its `takenAt`
 * shifts. A `"time-match"` pin was itself derived from the old `takenAt`, so
 * it's now stale — it's re-matched against the route's tracks using the
 * shifted time, same as at upload. A photo with no resolved position
 * (`positionSource` null) just gets its `takenAt` shifted, same as before.
 */
export async function nudgePhotoTimes(
  routeId: string,
  photoIds: string[],
  deltaMinutes: number,
): Promise<void> {
  if (photoIds.length === 0) return;

  const rows = await db
    .selectFrom("photos")
    .select(["id", "takenAt", "positionSource"])
    .where("routeId", "=", routeId)
    .where("id", "in", photoIds)
    .execute();

  const needsRematch = rows.some((row) => row.positionSource === "time-match");
  let index: TrackIndex | null = null;
  if (needsRematch) {
    const route = await getRouteById(routeId);
    if (route) index = buildTrackIndex(route.tracks);
  }

  const deltaMs = deltaMinutes * 60_000;
  await db.transaction().execute(async (tx) => {
    for (const row of rows) {
      if (row.takenAt == null) continue;
      const takenAt = row.takenAt + deltaMs;
      const patch: Updateable<PhotosTable> = { takenAt };

      if (row.positionSource === "time-match" && index) {
        const match = selectTrackForCapture(index.timedTracks, takenAt, TIME_MATCH_TOLERANCE_MS);
        const point = match ? index.trackCoords.get(match.trackId)?.[match.index] : null;
        patch.trackId = match?.trackId ?? null;
        patch.lat = point ? point[0] : null;
        patch.lon = point ? point[1] : null;
        patch.distanceAlongM = match
          ? (index.trackDistances.get(match.trackId)?.[match.index] ?? null)
          : null;
      }

      await tx.updateTable("photos").set(patch).where("id", "=", row.id).execute();
    }
  });
}
