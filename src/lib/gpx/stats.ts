import { cumulativeDistances, haversineM } from "./geo";
import type { GpxPoint, RouteStats } from "./types";

/**
 * Consumer GPS elevation is noisy by several metres even when stationary, so
 * naive `sum(max(0, delta))` inflates gain badly (a flat ride can "climb" 300 m).
 * We smooth first, then accumulate with hysteresis — see `elevationGainLoss`.
 */
const ELEVATION_SMOOTHING_WINDOW = 5;
const ELEVATION_HYSTERESIS_M = 3;

/** Below this we treat the athlete as stopped, so stops don't count as moving time. */
const MOVING_SPEED_THRESHOLD_MPS = 0.5;

/**
 * Samples further apart than this are a recording gap (paused watch, tunnel),
 * not a slow stretch, so they're excluded from moving time.
 */
const MAX_SAMPLE_GAP_S = 60;

/** Max speed is measured over a window this long to reject single-sample GPS spikes. */
const MAX_SPEED_WINDOW_S = 5;

const EMPTY_STATS: RouteStats = {
  distanceM: 0,
  elevationGainM: 0,
  elevationLossM: 0,
  elevationMinM: null,
  elevationMaxM: null,
  durationS: null,
  movingTimeS: null,
  avgSpeedMps: null,
  maxSpeedMps: null,
};

/**
 * Median filter. Median rather than mean because barometric/GPS elevation error
 * is spiky, and a mean smears a single bad sample across its whole neighbourhood.
 */
function rollingMedian(values: number[], window: number): number[] {
  if (values.length === 0) return [];
  const half = Math.floor(window / 2);
  const out = new Array<number>(values.length);
  const buffer: number[] = [];
  for (let i = 0; i < values.length; i++) {
    buffer.length = 0;
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    for (let j = from; j <= to; j++) buffer.push(values[j]);
    buffer.sort((a, b) => a - b);
    out[i] = buffer[Math.floor(buffer.length / 2)];
  }
  return out;
}

/**
 * Loop rather than `Math.min(...values)`: spreading a 100k-point track exceeds
 * the JS argument limit and throws a RangeError.
 */
function minMax(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Extracts an elevation series, or `null` when the file has too little to be useful.
 * Sparse gaps are filled by carrying the previous value forward, which is closer
 * to the truth than dropping the point and skewing the distance alignment.
 */
export function elevationSeries(points: GpxPoint[]): number[] | null {
  let withEle = 0;
  for (const p of points) if (p.ele != null) withEle++;
  // Some exporters emit a stray <ele> on one point; that isn't an elevation profile.
  if (withEle < points.length / 2) return null;

  const raw = new Array<number>(points.length);
  let last = points.find((p) => p.ele != null)?.ele ?? 0;
  for (let i = 0; i < points.length; i++) {
    const ele = points[i].ele;
    if (ele != null) last = ele;
    raw[i] = last;
  }
  return rollingMedian(raw, ELEVATION_SMOOTHING_WINDOW);
}

/**
 * Accumulates gain/loss with hysteresis against a moving reference elevation.
 *
 * A plain per-step threshold ("ignore deltas under 3 m") would discard a steady
 * climb sampled every second, where each step is a few centimetres. Tracking a
 * reference point instead means gradual climbs accumulate in threshold-sized
 * chunks while jitter around a stable value never accumulates at all.
 */
export function elevationGainLoss(smoothed: number[]): { gain: number; loss: number } {
  if (smoothed.length < 2) return { gain: 0, loss: 0 };
  let gain = 0;
  let loss = 0;
  let reference = smoothed[0];
  for (let i = 1; i < smoothed.length; i++) {
    const delta = smoothed[i] - reference;
    if (delta >= ELEVATION_HYSTERESIS_M) {
      gain += delta;
      reference = smoothed[i];
    } else if (delta <= -ELEVATION_HYSTERESIS_M) {
      loss -= delta;
      reference = smoothed[i];
    }
  }
  return { gain, loss };
}

/**
 * Peak speed over a ~5 s window. Point-to-point speed is unusable: a 10 m GPS
 * jump between two 1 s samples reads as 36 km/h and becomes the "max speed".
 */
function maxWindowSpeed(points: GpxPoint[], distances: number[]): number | null {
  let max: number | null = null;
  let start = 0;

  for (let end = 1; end < points.length; end++) {
    const endTime = points[end].time;
    if (endTime == null) continue;

    // Advance `start` to the oldest sample still inside the window.
    while (start < end) {
      const startTime = points[start].time;
      if (startTime == null || (endTime - startTime) / 1000 > MAX_SPEED_WINDOW_S) start++;
      else break;
    }
    if (start >= end) continue;

    const startTime = points[start].time;
    if (startTime == null) continue;

    const dt = (endTime - startTime) / 1000;
    // Require most of the window: a shorter span is spike-prone again.
    if (dt < MAX_SPEED_WINDOW_S * 0.6 || dt > MAX_SAMPLE_GAP_S) continue;

    const speed = (distances[end] - distances[start]) / dt;
    if (max == null || speed > max) max = speed;
  }

  return max;
}

/**
 * Computes every displayed statistic from full-resolution points.
 *
 * Always call this *before* simplifying geometry: simplification removes points
 * that carry real distance and elevation, so stats derived from simplified data
 * read low. This ordering is what lets us compress geometry aggressively
 * without the numbers on the page changing.
 */
export function computeStats(points: GpxPoint[]): RouteStats {
  if (points.length < 2) return { ...EMPTY_STATS };

  const distances = cumulativeDistances(points);
  const distanceM = distances[distances.length - 1];

  const smoothed = elevationSeries(points);
  const { gain, loss } = smoothed ? elevationGainLoss(smoothed) : { gain: 0, loss: 0 };
  const extent = smoothed ? minMax(smoothed) : null;

  const firstTime = points[0].time;
  const lastTime = points[points.length - 1].time;
  const hasTime = firstTime != null && lastTime != null;
  const durationS = hasTime ? Math.max(0, (lastTime - firstTime) / 1000) : null;

  let movingTimeS: number | null = null;
  if (hasTime) {
    movingTimeS = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev.time == null || curr.time == null) continue;
      const dt = (curr.time - prev.time) / 1000;
      if (dt <= 0 || dt > MAX_SAMPLE_GAP_S) continue;
      const step = haversineM(prev.lat, prev.lon, curr.lat, curr.lon);
      if (step / dt >= MOVING_SPEED_THRESHOLD_MPS) movingTimeS += dt;
    }
  }

  // Average over moving time, matching what Strava/Garmin report, so a long
  // lunch stop doesn't halve the reported pace.
  const avgSpeedMps = movingTimeS != null && movingTimeS > 0 ? distanceM / movingTimeS : null;

  return {
    distanceM,
    elevationGainM: gain,
    elevationLossM: loss,
    elevationMinM: extent ? extent.min : null,
    elevationMaxM: extent ? extent.max : null,
    durationS,
    movingTimeS,
    avgSpeedMps,
    maxSpeedMps: hasTime ? maxWindowSpeed(points, distances) : null,
  };
}

/** Combines per-track stats into the aggregate shown on a multi-track route page. */
export function aggregateStats(all: RouteStats[]): RouteStats {
  if (all.length === 0) return { ...EMPTY_STATS };

  let distanceM = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  let elevationMinM: number | null = null;
  let elevationMaxM: number | null = null;
  let durationS: number | null = null;
  let movingTimeS: number | null = null;
  let maxSpeedMps: number | null = null;

  for (const s of all) {
    distanceM += s.distanceM;
    elevationGainM += s.elevationGainM;
    elevationLossM += s.elevationLossM;
    if (s.elevationMinM != null) {
      elevationMinM =
        elevationMinM == null ? s.elevationMinM : Math.min(elevationMinM, s.elevationMinM);
    }
    if (s.elevationMaxM != null) {
      elevationMaxM =
        elevationMaxM == null ? s.elevationMaxM : Math.max(elevationMaxM, s.elevationMaxM);
    }
    if (s.durationS != null) durationS = (durationS ?? 0) + s.durationS;
    if (s.movingTimeS != null) movingTimeS = (movingTimeS ?? 0) + s.movingTimeS;
    if (s.maxSpeedMps != null) {
      maxSpeedMps = maxSpeedMps == null ? s.maxSpeedMps : Math.max(maxSpeedMps, s.maxSpeedMps);
    }
  }

  return {
    distanceM,
    elevationGainM,
    elevationLossM,
    elevationMinM,
    elevationMaxM,
    durationS,
    movingTimeS,
    // Recomputed from the totals rather than averaged, so tracks of very
    // different lengths are weighted correctly.
    avgSpeedMps: movingTimeS != null && movingTimeS > 0 ? distanceM / movingTimeS : null,
    maxSpeedMps,
  };
}
