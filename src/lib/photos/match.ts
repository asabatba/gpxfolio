import { haversineM } from "../gpx/geo";

/**
 * The slice of `Track` this module actually needs, decoupled from the full
 * `db/schema.ts` type (and its `Date`-typed `startedAt`) so these functions
 * stay pure and easy to unit test. `photos.server.ts` maps real `Track` rows
 * onto this shape.
 */
export interface TimedTrack {
  id: string;
  /** Epoch ms of the first point, or null if the track carries no timestamps. */
  startedAt: number | null;
  /** Seconds from `startedAt`, monotonically increasing, index-aligned with `distances`. */
  timeOffsets: number[] | null;
  /** Cumulative metres from the start, index-aligned with `timeOffsets`/the track's coordinates. */
  distances: number[];
}

/** The union of every timed track's `[startedAt, startedAt + lastOffset]` span. */
export function routeTimeRange(tracks: TimedTrack[]): { startMs: number; endMs: number } | null {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const track of tracks) {
    if (track.startedAt == null || !track.timeOffsets || track.timeOffsets.length === 0) continue;
    const last = track.timeOffsets[track.timeOffsets.length - 1];
    startMs = Math.min(startMs, track.startedAt);
    endMs = Math.max(endMs, track.startedAt + last * 1000);
  }
  return Number.isFinite(startMs) ? { startMs, endMs } : null;
}

/**
 * Index of the closest value in a sorted (ascending) array, clamped to the
 * array's bounds. Binary search since `timeOffsets` is monotonic and can hold
 * thousands of entries.
 */
export function nearestTimeIndex(timeOffsetsS: number[], targetS: number): number {
  let lo = 0;
  let hi = timeOffsetsS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeOffsetsS[mid] < targetS) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(timeOffsetsS[lo - 1] - targetS) < Math.abs(timeOffsetsS[lo] - targetS)) {
    return lo - 1;
  }
  return lo;
}

export interface CaptureMatch {
  trackId: string;
  index: number;
}

/**
 * Picks which track a photo's capture instant belongs to, and where along it.
 *
 * For each timed track, the capture instant is clamped into that track's own
 * `[startedAt, startedAt + duration]` span; the clamp distance (0 if the
 * instant already falls inside) is how far outside that track the photo was
 * taken. The track with the smallest clamp distance wins; if even that best
 * distance exceeds `toleranceMs`, there's no good match and this returns
 * `null` rather than guessing.
 */
export function selectTrackForCapture(
  tracks: TimedTrack[],
  captureUtcMs: number,
  toleranceMs: number,
): CaptureMatch | null {
  let best: (CaptureMatch & { distanceMs: number }) | null = null;

  for (const track of tracks) {
    if (track.startedAt == null || !track.timeOffsets || track.timeOffsets.length === 0) continue;

    const startMs = track.startedAt;
    const endMs = startMs + track.timeOffsets[track.timeOffsets.length - 1] * 1000;
    const distanceMs =
      captureUtcMs < startMs ? startMs - captureUtcMs : captureUtcMs > endMs ? captureUtcMs - endMs : 0;

    if (best === null || distanceMs < best.distanceMs) {
      const targetS = Math.min(Math.max((captureUtcMs - startMs) / 1000, 0), (endMs - startMs) / 1000);
      best = { trackId: track.id, index: nearestTimeIndex(track.timeOffsets, targetS), distanceMs };
    }
  }

  if (best === null || best.distanceMs > toleranceMs) return null;
  return { trackId: best.trackId, index: best.index };
}

export interface SpatialMatch {
  index: number;
  distanceM: number;
}

/** Nearest point on a (small, already-simplified) coordinate list — no spatial index needed at this scale. */
export function nearestSpatialPoint(
  coordinates: Array<[number, number]>,
  lat: number,
  lon: number,
): SpatialMatch | null {
  let best: SpatialMatch | null = null;
  for (let i = 0; i < coordinates.length; i++) {
    const [pLat, pLon] = coordinates[i];
    const distanceM = haversineM(lat, lon, pLat, pLon);
    if (best === null || distanceM < best.distanceM) best = { index: i, distanceM };
  }
  return best;
}
