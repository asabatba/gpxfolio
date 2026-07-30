import { decodePolyline } from "./gpx/encode";
import type { Track } from "./db/schema";
import type { BBox } from "./gpx/types";

/**
 * The shape the client actually needs to draw a route.
 *
 * Route pages send this instead of the raw database rows: it drops the columns
 * the map and chart never read, and decodes the polyline once so the map, the
 * elevation profile and the hover marker all share one coordinate array.
 */
export interface TrackView {
  id: string;
  name: string | null;
  color: string;
  /** `[lon, lat]` pairs, the order MapLibre expects. */
  coordinates: Array<[number, number]>;
  /** Cumulative metres, index-aligned with `coordinates`. */
  distances: number[];
  /** Metres, index-aligned. Null when the GPX had no elevation data. */
  elevations: number[] | null;
  /** Seconds from this track's start, index-aligned. Null when untimed. */
  timeOffsets: number[] | null;
  distanceM: number;
  elevationGainM: number;
  startedAt: number | null;
}

export function toTrackView(track: Track): TrackView {
  return {
    id: track.id,
    name: track.name,
    color: track.color,
    coordinates: decodePolyline(track.geometry).map(([lat, lon]) => [lon, lat]),
    distances: track.distances,
    elevations: track.elevations ?? null,
    timeOffsets: track.timeOffsets ?? null,
    distanceM: track.distanceM,
    elevationGainM: track.elevationGainM,
    startedAt: track.startedAt?.getTime() ?? null,
  };
}

/**
 * A point on the route currently being pointed at, shared between the elevation
 * profile and the map marker.
 */
export interface HoverPoint {
  trackId: string;
  index: number;
  lon: number;
  lat: number;
  distanceM: number;
  elevationM: number | null;
  timeOffsetS: number | null;
}

/** Falls back to a small box around the first coordinate for a bbox-less route. */
export function bboxOrFallback(bbox: BBox | null, tracks: TrackView[]): BBox | null {
  if (bbox) return bbox;
  const first = tracks[0]?.coordinates[0];
  if (!first) return null;
  const [lon, lat] = first;
  return [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01];
}
