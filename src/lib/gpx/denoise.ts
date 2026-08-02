import { haversineM } from "./geo";
import type { GpxPoint } from "./types";

/**
 * ~216 km/h. Above this the sample is a GPS glitch rather than movement, for
 * any activity this site is meant to show (walk, run, ride, ski, drive).
 */
const MAX_PLAUSIBLE_SPEED_MPS = 60;

/**
 * A jump must be at least this far to be considered a glitch, so short samples
 * with a tiny `dt` (which produce huge implied speeds from noise alone) survive.
 */
const MIN_GLITCH_DISTANCE_M = 50;

/**
 * If this many points in a row blow the *absolute* ceiling, the reference itself
 * is what's wrong (e.g. the very first fix landed in the wrong country) — resync
 * onto the run rather than deleting the real track. An outright physical
 * impossibility this consistent is strong evidence of that, so a short leash
 * is enough.
 */
const MAX_CONSECUTIVE_DROPS = 3;

/**
 * Below this, any pace is plausible on foot or by bike, so the relative check
 * (below) never fires — without a floor, resuming a normal walking pace after a
 * genuine rest stop (where recent pace is near zero) would itself look like an
 * infinite-ratio outlier.
 */
const RELATIVE_SPEED_FLOOR_MPS = 7; // ~25 km/h

/**
 * A candidate whose implied speed is more than this many times the track's
 * *recent* pace is treated as noise. Scales with the activity automatically —
 * unlike a fixed ceiling, it doesn't need to know whether the track is a hike
 * or a descent on a bike.
 */
const RELATIVE_SPEED_MULTIPLIER = 5;

/**
 * Minimum step duration before the relative check trusts an implied speed at
 * all — a tiny `dt` inflates even ordinary GPS jitter into a big number.
 * Deliberately *not* `MIN_GLITCH_DISTANCE_M`: a sustained-drift step can cover
 * just 20 m in a 1 s sample, which is nowhere near that distance floor but is
 * still a huge multiple of a resting hiker's pace.
 */
const MIN_RELATIVE_CHECK_DT_S = 1;

/** Window of recently *accepted* points used to estimate the track's current pace. */
const BASELINE_WINDOW_S = 20;

/**
 * Wall-clock budget for a run of purely-relative rejects before resyncing.
 * Unlike `MAX_CONSECUTIVE_DROPS`, this is time rather than a point count:
 * real sample intervals are wildly irregular (sub-second to tens of seconds
 * in the same file, e.g. around a GPS-degraded rest stop), so a fixed number
 * of samples doesn't correspond to a fixed duration of bad data.
 */
const MAX_DRIFT_S = 20;

/**
 * Median speed among recently accepted points, or null when there isn't
 * enough recent history to judge a "normal" pace (e.g. the start of the
 * track). Median, not mean, so one already-elevated step doesn't skew the
 * baseline it's partly responsible for.
 */
function recentBaselineSpeedMps(recent: GpxPoint[], asOf: number): number | null {
  while (recent.length > 1 && asOf - Number(recent[0].time) > BASELINE_WINDOW_S * 1000) {
    recent.shift();
  }
  if (recent.length < 2) return null;
  const stepSpeeds: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const dt = (Number(recent[i].time) - Number(recent[i - 1].time)) / 1000;
    if (dt <= 0) continue;
    stepSpeeds.push(haversineM(recent[i - 1].lat, recent[i - 1].lon, recent[i].lat, recent[i].lon) / dt);
  }
  if (stepSpeeds.length === 0) return null;
  stepSpeeds.sort((a, b) => a - b);
  return stepSpeeds[Math.floor(stepSpeeds.length / 2)];
}

/**
 * Removes GPS glitches: single teleport-and-back fixes, and sustained runs of
 * noise (multipath in trees/mountain terrain, or a device "catching up" with
 * a burst of fixes after reacquiring signal) that read as a plausible speed
 * one step at a time but are absurd relative to how the track has actually
 * been moving — e.g. a 25 km/h burst mid-hike.
 *
 * This runs before stats *and* before simplification because a glitch corrupts
 * more than one number — a spike adds phantom distance, wrecks max speed, and
 * puts a visible spike in the drawn line. Filtering once at the source fixes
 * all three.
 *
 * Each candidate is measured against the last *accepted* point, so a run of bad
 * fixes can't drag the reference along with it. Two independent escape valves
 * exist because the two kinds of reject warrant different confidence: an
 * absolute physical impossibility is strong evidence the *reference* is the
 * bad one (short leash), while a merely-implausible-for-this-track speed needs
 * longer to distinguish real sustained noise from a real pace change.
 */
export function denoise(points: GpxPoint[]): { points: GpxPoint[]; dropped: number } {
  if (points.length < 3) return { points, dropped: 0 };

  const kept: GpxPoint[] = [points[0]];
  // Only timed points are useful for a pace estimate; an untimed one stuck at
  // the front would never age out (its "time" compares as NaN forever).
  const recent: GpxPoint[] = points[0].time != null ? [points[0]] : [];
  let reference = points[0];
  let consecutiveAbsoluteDrops = 0;
  let driftStart: GpxPoint | null = null;
  let dropped = 0;

  for (let i = 1; i < points.length; i++) {
    const candidate = points[i];

    // Always keep the final point: it defines the end of the route.
    const isLast = i === points.length - 1;

    let reason: "absolute" | "relative" | null = null;
    if (!isLast && reference.time != null && candidate.time != null) {
      const dt = (candidate.time - reference.time) / 1000;
      if (dt > 0) {
        const step = haversineM(reference.lat, reference.lon, candidate.lat, candidate.lon);
        const speed = step / dt;
        if (step >= MIN_GLITCH_DISTANCE_M && speed > MAX_PLAUSIBLE_SPEED_MPS) {
          reason = "absolute";
        } else if (dt >= MIN_RELATIVE_CHECK_DT_S && speed > RELATIVE_SPEED_FLOOR_MPS) {
          // Gated on dt, not distance: a sustained-drift step can be a "small"
          // 20 m in one second — tiny by MIN_GLITCH_DISTANCE_M's standard, but
          // still 5x a resting hiker's pace. Distance alone can't tell that
          // apart from real GPS jitter; only pace-versus-recent-pace can.
          const baseline = recentBaselineSpeedMps(recent, candidate.time);
          if (baseline != null && speed > baseline * RELATIVE_SPEED_MULTIPLIER) reason = "relative";
        }
      }
    }

    if (reason === "absolute") {
      driftStart = null;
      if (consecutiveAbsoluteDrops < MAX_CONSECUTIVE_DROPS) {
        consecutiveAbsoluteDrops++;
        dropped++;
        continue;
      }
    } else if (reason === "relative") {
      consecutiveAbsoluteDrops = 0;
      if (driftStart == null) driftStart = candidate;
      const driftS = (Number(candidate.time) - Number(driftStart.time)) / 1000;
      if (driftS <= MAX_DRIFT_S) {
        dropped++;
        continue;
      }
    } else {
      consecutiveAbsoluteDrops = 0;
      driftStart = null;
    }

    kept.push(candidate);
    reference = candidate;
    if (candidate.time != null) recent.push(candidate);
  }

  return { points: kept, dropped };
}
