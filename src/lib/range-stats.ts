import type { TrackView } from "./track-view";

/**
 * A user-dragged distance span along one track's elevation profile — always
 * within a single track (a multi-day route's profile is drawn as one
 * continuous line, but a drag stops at that track's own boundary rather than
 * bridging into the next day, where elapsed time would include the
 * overnight/rest gap between them).
 *
 * `startIndex`/`endIndex` index into that track's own point arrays
 * (`coordinates`/`elevations`/`distances`/`timeOffsets`), same as
 * `HoverPoint.index`. Always `startIndex <= endIndex` — callers normalise a
 * right-to-left drag before constructing one, so nothing downstream (stats,
 * map highlight, chart band) has to re-check direction.
 */
export interface RangeSelection {
  trackId: string;
  startIndex: number;
  endIndex: number;
}

export interface RangeStats {
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  /** End timestamp minus start timestamp. Null when the track has no time data. */
  elapsedS: number | null;
  /** Null when there's no elapsed time to divide by (untimed track, or a zero-length range). */
  avgSpeedMps: number | null;
}

/**
 * Approximate on purpose: sums elevation deltas between the already-simplified
 * (RDP) points a range spans, rather than re-running the full-resolution
 * hysteresis pass `gpx/stats.ts` uses for the headline ascent/descent figures.
 * Good enough for "roughly how much did this stretch climb" without a server
 * round-trip or new precomputed columns — see the range-select feature's
 * design notes for why that tradeoff was made.
 *
 * Likewise `elapsedS` is wall-clock (end time minus start time), not moving
 * time — there's no per-range moving-vs-stopped classification here.
 */
export function computeRangeStats(track: TrackView, range: RangeSelection): RangeStats {
  const { startIndex: lo, endIndex: hi } = range;
  const distanceM = track.distances[hi] - track.distances[lo];

  let elevationGainM = 0;
  let elevationLossM = 0;
  if (track.elevations) {
    for (let i = lo + 1; i <= hi; i++) {
      const delta = track.elevations[i] - track.elevations[i - 1];
      if (delta > 0) elevationGainM += delta;
      else elevationLossM -= delta;
    }
  }

  const elapsedS = track.timeOffsets ? track.timeOffsets[hi] - track.timeOffsets[lo] : null;
  const avgSpeedMps = elapsedS != null && elapsedS > 0 ? distanceM / elapsedS : null;

  return { distanceM, elevationGainM, elevationLossM, elapsedS, avgSpeedMps };
}
