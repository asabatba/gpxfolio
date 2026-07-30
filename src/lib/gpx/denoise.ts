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
 * If this many points in a row look implausible, the *reference* is what's wrong
 * (e.g. the very first fix landed in the wrong country). Resynchronise onto the
 * run rather than deleting the real track.
 */
const MAX_CONSECUTIVE_DROPS = 3;

/**
 * Removes GPS teleport glitches: single fixes that land hundreds of metres away
 * and then come back.
 *
 * This runs before stats *and* before simplification because a glitch corrupts
 * more than one number — a 200 m spike adds ~400 m of phantom distance, wrecks
 * max speed, and puts a visible spike in the drawn line. Filtering once at the
 * source fixes all three.
 *
 * Each candidate is measured against the last *accepted* point, so a run of bad
 * fixes can't drag the reference along with it.
 */
export function denoise(points: GpxPoint[]): { points: GpxPoint[]; dropped: number } {
  if (points.length < 3) return { points, dropped: 0 };

  const kept: GpxPoint[] = [points[0]];
  let reference = points[0];
  let consecutiveDrops = 0;
  let dropped = 0;

  for (let i = 1; i < points.length; i++) {
    const candidate = points[i];

    // Always keep the final point: it defines the end of the route.
    const isLast = i === points.length - 1;

    let implausible = false;
    if (!isLast && reference.time != null && candidate.time != null) {
      const dt = (candidate.time - reference.time) / 1000;
      const step = haversineM(reference.lat, reference.lon, candidate.lat, candidate.lon);
      if (dt > 0 && step >= MIN_GLITCH_DISTANCE_M && step / dt > MAX_PLAUSIBLE_SPEED_MPS) {
        implausible = true;
      }
    }

    if (implausible && consecutiveDrops < MAX_CONSECUTIVE_DROPS) {
      consecutiveDrops++;
      dropped++;
      continue;
    }

    kept.push(candidate);
    reference = candidate;
    consecutiveDrops = 0;
  }

  return { points: kept, dropped };
}
