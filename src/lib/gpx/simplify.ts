import type { GpxPoint } from "./types";

/**
 * Default perpendicular tolerance. At 2.5 m the simplified line stays well
 * inside GPS's own error, so the drawn track is visually identical even at
 * max zoom, while typically removing 80-95% of points.
 */
export const DEFAULT_TOLERANCE_M = 2.5;

/**
 * Hard ceiling on stored points per track. Keeps the page payload and the
 * client-side hover maths bounded for very long tracks (multi-day tours).
 */
export const DEFAULT_MAX_POINTS = 6000;

const DEG_TO_RAD = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/**
 * RDP degrades to O(n^2) when almost every point survives — a noisy urban or
 * zigzagging track does exactly that, and a 40k-point file took ~12s in testing.
 * Running it over fixed-size windows bounds the cost to O(n * WINDOW) instead.
 *
 * This cannot break the tolerance guarantee: each window's output is within
 * tolerance of that window's input, so the concatenation is within tolerance of
 * the whole. The only effect is that window boundary vertices are always kept,
 * which makes the result marginally *more* faithful, never less.
 */
const RDP_WINDOW = 2000;

/**
 * Ramer-Douglas-Peucker returning the indices it keeps, rather than new points.
 *
 * Returning indices is the important part: elevation, cumulative distance and
 * timestamps live in parallel arrays, and the caller reindexes all of them with
 * the same list. Returning points would desynchronise the series.
 *
 * Distances are computed on a local equirectangular projection (longitude scaled
 * by cos(lat)) which is accurate to a fraction of a percent over the extent of
 * any single activity — far below the tolerance itself.
 *
 * The recursion is an explicit stack: real tracks reach hundreds of thousands of
 * points and a recursive implementation overflows on near-degenerate input.
 */
export function simplifyIndices(points: GpxPoint[], toleranceM: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);

  const meanLat = (points[0].lat + points[n - 1].lat) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(meanLat * DEG_TO_RAD);

  // Project once into metres so the inner loop is pure arithmetic.
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = points[i].lon * mPerDegLon;
    y[i] = points[i].lat * M_PER_DEG_LAT;
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const toleranceSq = toleranceM * toleranceM;

  // Seed the stack with one span per window rather than a single 0..n-1 span,
  // which is what bounds the worst-case cost (see RDP_WINDOW).
  const stack: number[] = [];
  for (let start = 0; start < n - 1; start += RDP_WINDOW) {
    const end = Math.min(start + RDP_WINDOW, n - 1);
    keep[start] = 1;
    keep[end] = 1;
    stack.push(start, end);
  }

  while (stack.length > 0) {
    const last = stack.pop() as number;
    const first = stack.pop() as number;
    if (last - first < 2) continue;

    const x1 = x[first];
    const y1 = y[first];
    const dx = x[last] - x1;
    const dy = y[last] - y1;
    const segLenSq = dx * dx + dy * dy;

    let maxDistSq = -1;
    let maxIndex = -1;

    for (let i = first + 1; i < last; i++) {
      const px = x[i] - x1;
      const py = y[i] - y1;

      let distSq: number;
      if (segLenSq === 0) {
        // Degenerate segment (a closed loop, or a stationary stretch): fall back
        // to distance from the endpoint.
        distSq = px * px + py * py;
      } else {
        // Projection parameter clamped to the segment, so points beyond an
        // endpoint measure to the endpoint rather than to the infinite line.
        let t = (px * dx + py * dy) / segLenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ox = px - t * dx;
        const oy = py - t * dy;
        distSq = ox * ox + oy * oy;
      }

      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxIndex = i;
      }
    }

    if (maxDistSq > toleranceSq && maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push(first, maxIndex, maxIndex, last);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) indices.push(i);
  return indices;
}

/** Passes spent narrowing in on the coarsest useful tolerance. */
const BUDGET_REFINEMENT_PASSES = 6;

/**
 * Simplifies at `toleranceM`, escalating only if the result exceeds `maxPoints`.
 *
 * Ordinary tracks — even a 200k-point one — fit the budget at the default
 * tolerance and return after a single pass. Escalation is the rare path for
 * enormous or very noisy files.
 *
 * When it does escalate, doubling alone overshoots badly: one step past the
 * budget took a 100k-point test track from over budget down to 529 points,
 * discarding detail we were allowed to keep. So once doubling finds a tolerance
 * that fits, we binary-search back down and keep the most detailed result that
 * still fits the budget.
 */
export function simplifyToBudget(
  points: GpxPoint[],
  toleranceM = DEFAULT_TOLERANCE_M,
  maxPoints = DEFAULT_MAX_POINTS,
): { indices: number[]; toleranceUsedM: number } {
  const initial = simplifyIndices(points, toleranceM);
  if (initial.length <= maxPoints) {
    return { indices: initial, toleranceUsedM: toleranceM };
  }

  // Phase 1: double until it fits, keeping the bracket [tooFine, fitting].
  let tooFine = toleranceM;
  let fitting = toleranceM;
  let best = initial;
  let found = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = simplifyIndices(points, tooFine * 2);
    // `<= 2` means the track has bottomed out and can't be reduced further,
    // so there is nothing to gain from escalating again.
    if (candidate.length <= maxPoints || candidate.length <= 2) {
      fitting = tooFine * 2;
      best = candidate;
      found = true;
      break;
    }
    tooFine *= 2;
  }

  if (!found) return { indices: best, toleranceUsedM: tooFine };

  // Phase 2: recover detail by hunting for the smallest tolerance that fits.
  let bestTolerance = fitting;
  for (let pass = 0; pass < BUDGET_REFINEMENT_PASSES; pass++) {
    const mid = (tooFine + bestTolerance) / 2;
    const candidate = simplifyIndices(points, mid);
    if (candidate.length <= maxPoints) {
      best = candidate;
      bestTolerance = mid;
    } else {
      tooFine = mid;
    }
  }

  return { indices: best, toleranceUsedM: bestTolerance };
}
