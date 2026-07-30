/** A single trackpoint as read from the GPX, at full resolution. */
export interface GpxPoint {
  lat: number;
  lon: number;
  /** Metres above sea level, when the GPX provides `<ele>`. */
  ele?: number;
  /** Epoch milliseconds, when the GPX provides `<time>`. */
  time?: number;
  /** Heart rate in bpm from Garmin's TrackPointExtension. Stored for future charts. */
  hr?: number;
}

/** One `<trk>` from the file. Segments are concatenated: gaps show up as time jumps. */
export interface GpxTrack {
  name?: string;
  points: GpxPoint[];
}

export interface ParsedGpx {
  /** `<metadata><name>` or the first track name, when present. */
  name?: string;
  /** `<metadata><time>`, epoch ms. */
  time?: number;
  tracks: GpxTrack[];
}

/**
 * Stats derived from a set of points. Every field is computed from the
 * *full-resolution* points, before any simplification, so reducing the stored
 * geometry never changes the numbers shown to a viewer.
 */
export interface RouteStats {
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  elevationMinM: number | null;
  elevationMaxM: number | null;
  /** Wall-clock time from first to last point. */
  durationS: number | null;
  /** Time spent above the movement threshold — excludes stops. */
  movingTimeS: number | null;
  /** Average over moving time, so rest stops don't drag it down. */
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
}

/** Simplified, index-aligned series ready to be stored and shipped to the client. */
export interface TrackSeries {
  /** Encoded polyline (precision 5) of the simplified coordinates. */
  geometry: string;
  /** Metres, rounded. `null` when the source has no elevation data at all. */
  elevations: number[] | null;
  /** Cumulative metres from the start, rounded. */
  distances: number[];
  /** Seconds from the first point. `null` when the source has no timestamps. */
  timeOffsets: number[] | null;
  pointCountOriginal: number;
  pointCountStored: number;
}

/** `[west, south, east, north]` */
export type BBox = [number, number, number, number];

export class GpxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpxParseError";
  }
}
