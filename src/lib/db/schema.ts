import type { Generated, Insertable, Selectable } from "kysely";
import type { BBox, RouteStats } from "../gpx/types";

/**
 * The database schema, in two layers.
 *
 * `Database` describes the tables as SQLite actually stores them, which is what
 * Kysely type-checks queries against. SQLite has no date or JSON type, so
 * timestamps are epoch-millisecond integers and arrays are JSON text there.
 *
 * `Route`/`Track`/`Photo` are what the rest of the app works with: `Date`s and
 * real arrays. The `to*`/`*Values` functions below are the only place the two
 * meet, so no caller has to remember which side of the boundary it is on.
 *
 * Column names are camelCase here and snake_case in SQL — `CamelCasePlugin`
 * (see `./index.ts`) rewrites them in both directions. Anything that bypasses
 * the query builder, migrations included, must use the snake_case names.
 *
 * Distances/elevations are metres, times seconds, speeds metres per second —
 * unit conversion is a presentation concern, handled in `src/lib/format.ts`.
 */

export type Visibility = "public" | "unlisted";

/** Stats columns shared by `routes` (aggregate) and `tracks` (per file). */
interface StatsColumns {
  distanceM: Generated<number>;
  elevationGainM: Generated<number>;
  elevationLossM: Generated<number>;
  elevationMinM: number | null;
  elevationMaxM: number | null;
  durationS: number | null;
  movingTimeS: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
}

/** One shareable page. */
export interface RoutesTable extends StatsColumns {
  id: string;
  /** Unguessable, URL-safe. Unlisted routes rely on this for privacy. */
  slug: string;
  title: string;
  description: string | null;
  /**
   * `public` routes appear on the homepage gallery; `unlisted` ones are
   * reachable only by their slug. Both are readable without logging in.
   */
  visibility: Generated<Visibility>;
  /** Free-text ("Ride", "Hike"), shown as a badge. */
  activityType: string | null;
  /** JSON `[west, south, east, north]` covering all tracks. */
  bbox: string | null;
  /** Earliest track start, for sorting the gallery chronologically. */
  startedAt: number | null;
  createdAt: Generated<number>;
  updatedAt: Generated<number>;
}

/** One uploaded GPX file within a route. A route may combine several. */
export interface TracksTable extends StatsColumns {
  id: string;
  routeId: string;
  name: string | null;
  sourceFilename: string;
  /** Hex colour for this track's line on the map. */
  color: string;
  orderIndex: Generated<number>;

  /** Encoded polyline (precision 5) of the simplified coordinates. */
  geometry: string;
  /**
   * Index-aligned with `geometry`. Stored as JSON arrays rather than a blob:
   * SQLite compresses poorly either way, and JSON keeps the rows readable and
   * trivially serialisable to the client.
   */
  elevations: string | null;
  distances: string;
  timeOffsets: string | null;

  pointCountOriginal: number;
  pointCountStored: number;
  bbox: string | null;
  startedAt: number | null;
}

/**
 * Photos attached to a route, matched to a position along the track.
 *
 * Defined ahead of the feature so the schema is already in place: the planned
 * flow is to read EXIF `DateTimeOriginal` from an upload, find the trackpoint
 * closest in time via `tracks.timeOffsets`, and store both the resolved
 * coordinates and the distance along the route. `lat`/`lon` are kept separately
 * because a photo may carry its own GPS tags, which take precedence over a
 * time-based match. Nothing reads this table yet.
 */
export interface PhotosTable {
  id: string;
  routeId: string;
  /** Which track the photo was matched against, when known. */
  trackId: string | null;
  filename: string;
  caption: string | null;
  /** EXIF capture time, the key used to place the photo along the track. */
  takenAt: number | null;
  lat: number | null;
  lon: number | null;
  /**
   * How `lat`/`lon` was derived. `"gps"` photos carry their own EXIF
   * coordinates and are never moved by a time correction; `"time-match"`
   * photos were placed by matching `takenAt` against a track, so their
   * position is re-derived whenever `takenAt` changes. Null when no position
   * was resolved at all.
   */
  positionSource: PositionSource | null;
  /** Metres from the track start, for placing a marker on the elevation profile. */
  distanceAlongM: number | null;
  width: number | null;
  height: number | null;
  orderIndex: Generated<number>;
  createdAt: Generated<number>;
}

export type PositionSource = "gps" | "time-match";

export interface Database {
  routes: RoutesTable;
  tracks: TracksTable;
  photos: PhotosTable;
}

/* -------------------------------------------------------------------------- */
/* Domain rows                                                                 */
/* -------------------------------------------------------------------------- */

export interface Route extends RouteStats {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  visibility: Visibility;
  activityType: string | null;
  bbox: BBox | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Track extends RouteStats {
  id: string;
  routeId: string;
  name: string | null;
  sourceFilename: string;
  color: string;
  orderIndex: number;
  geometry: string;
  elevations: number[] | null;
  distances: number[];
  timeOffsets: number[] | null;
  pointCountOriginal: number;
  pointCountStored: number;
  bbox: BBox | null;
  startedAt: Date | null;
}

export interface Photo {
  id: string;
  routeId: string;
  trackId: string | null;
  filename: string;
  caption: string | null;
  takenAt: Date | null;
  lat: number | null;
  lon: number | null;
  positionSource: PositionSource | null;
  distanceAlongM: number | null;
  width: number | null;
  height: number | null;
  orderIndex: number;
  createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Conversions                                                                 */
/* -------------------------------------------------------------------------- */

function parseJson<T>(value: string | null): T | null {
  return value == null ? null : (JSON.parse(value) as T);
}

/** JSON for a column that is nullable in SQL, so `null` round-trips as `null`. */
export function toJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function toEpoch(value: Date | null): number | null {
  return value == null ? null : value.getTime();
}

function toDate(value: number | null): Date | null {
  return value == null ? null : new Date(value);
}

export function toRoute(row: Selectable<RoutesTable>): Route {
  return {
    ...row,
    bbox: parseJson<BBox>(row.bbox),
    startedAt: toDate(row.startedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function toTrack(row: Selectable<TracksTable>): Track {
  return {
    ...row,
    elevations: parseJson<number[]>(row.elevations),
    // `distances` is NOT NULL, so this always parses to an array.
    distances: JSON.parse(row.distances) as number[],
    timeOffsets: parseJson<number[]>(row.timeOffsets),
    bbox: parseJson<BBox>(row.bbox),
    startedAt: toDate(row.startedAt),
  };
}

export function routeValues(route: Route): Insertable<RoutesTable> {
  return {
    ...route,
    bbox: toJson(route.bbox),
    startedAt: toEpoch(route.startedAt),
    createdAt: route.createdAt.getTime(),
    updatedAt: route.updatedAt.getTime(),
  };
}

export function trackValues(track: Track): Insertable<TracksTable> {
  return {
    ...track,
    elevations: toJson(track.elevations),
    distances: JSON.stringify(track.distances),
    timeOffsets: toJson(track.timeOffsets),
    bbox: toJson(track.bbox),
    startedAt: toEpoch(track.startedAt),
  };
}

export function toPhoto(row: Selectable<PhotosTable>): Photo {
  return {
    ...row,
    takenAt: toDate(row.takenAt),
    createdAt: new Date(row.createdAt),
  };
}

export function photoValues(photo: Photo): Insertable<PhotosTable> {
  return {
    ...photo,
    takenAt: toEpoch(photo.takenAt),
    createdAt: photo.createdAt.getTime(),
  };
}
