/**
 * Infers a camera clock's offset from UTC when a photo carries only a naive
 * `DateTimeOriginal` (no `OffsetTimeOriginal`, no GPS timestamp).
 *
 * A phone or camera's clock has no guaranteed relationship to the timezone a
 * GPX track was recorded in — it may be set to home time on a trip abroad, off
 * by a daylight-saving hour, or just wrong. Run once per upload batch (photos
 * uploaded together are presumably one camera/trip), comparing the batch's
 * naive timestamps against the route's own recorded UTC time span.
 *
 * The small tolerance below (guarding against photos taken just before/after
 * the GPX recording started/stopped, e.g. at the trailhead) is NOT what makes
 * an uncorrected clock harmless: a 1-hour clock error on a 6-hour hike can
 * still shift a matched trackpoint by however far was travelled in that hour.
 * This function's whole job is to find that correction; the tolerance only
 * keeps a photo taken a few minutes outside the recorded span from being
 * wrongly excluded.
 */

const RANGE_MINUTES = 14 * 60; // UTC-12 .. UTC+14, the full range of real timezones
const STEP_MINUTES = 30; // covers every real UTC offset, including the half-hour ones
const TOLERANCE_MS = 30 * 60 * 1000; // slack for photos just before/after the track's own span

export interface OffsetInference {
  /**
   * Minutes east of UTC — the same convention as `PhotoExif.offsetMinutes`
   * (EXIF's `OffsetTimeOriginal`), so callers apply one uniform formula
   * regardless of source: `trueUtcMs = naiveEpochsUtcMs - offsetMinutes * 60_000`.
   */
  offsetMinutes: number;
  /** Fraction (0..1) of the batch that landed inside the tolerant window at this offset. */
  confidence: number;
}

/**
 * `naiveEpochsUtcMs` are `Date.UTC(...)` of each photo's raw Y-M-D-H-M-S
 * components (i.e. read as if they were UTC, which they are not — that's the
 * whole problem this function solves: those components are actually local
 * wall-clock time, which runs `offsetMinutes` minutes *ahead* of true UTC, so
 * `naiveEpochsUtcMs = trueUtcMs + offsetMinutes * 60_000`). `trackStartMs`/
 * `trackEndMs` bound the route's actual recorded UTC time span.
 *
 * Brute-forces every offset in [-RANGE, +RANGE] on a 30-minute grid — cheap
 * (57 candidates) and free of the day-rollover edge cases a direct
 * median-difference shortcut would need to handle.
 *
 * Any positive tolerance means more than one candidate offset can achieve the
 * same top confidence (an offset a step or two either side of the truth still
 * keeps every photo inside the tolerant window). The true offset sits at the
 * *centre* of that tied band, not at either edge, so ties are broken by taking
 * the median of every offset that reaches the best confidence — not the one
 * closest to zero, which would systematically bias the answer toward "no
 * correction" whenever zero happened to fall inside the tied band.
 */
export function inferCameraOffsetMinutes(
  naiveEpochsUtcMs: number[],
  trackStartMs: number,
  trackEndMs: number,
): OffsetInference | null {
  if (naiveEpochsUtcMs.length === 0) return null;

  const windowStart = trackStartMs - TOLERANCE_MS;
  const windowEnd = trackEndMs + TOLERANCE_MS;

  let bestConfidence = -1;
  const bestOffsets: number[] = [];

  for (let m = -RANGE_MINUTES; m <= RANGE_MINUTES; m += STEP_MINUTES) {
    const offsetMs = m * 60_000;
    let inside = 0;
    for (const naive of naiveEpochsUtcMs) {
      const corrected = naive - offsetMs;
      if (corrected >= windowStart && corrected <= windowEnd) inside++;
    }
    const confidence = inside / naiveEpochsUtcMs.length;

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestOffsets.length = 0;
      bestOffsets.push(m);
    } else if (confidence === bestConfidence) {
      bestOffsets.push(m);
    }
  }

  const median = bestOffsets[Math.floor((bestOffsets.length - 1) / 2)];
  return { offsetMinutes: median, confidence: bestConfidence };
}
