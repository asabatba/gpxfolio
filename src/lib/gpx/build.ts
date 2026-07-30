import { denoise } from "./denoise";
import { encodePolyline } from "./encode";
import { boundsOf, cumulativeDistances } from "./geo";
import { simplifyToBudget } from "./simplify";
import { computeStats, elevationSeries } from "./stats";
import type { BBox, GpxPoint, RouteStats, TrackSeries } from "./types";

export interface BuiltTrack {
  stats: RouteStats;
  series: TrackSeries;
  bbox: BBox;
  /** Epoch ms of the first point, when the source has timestamps. */
  startedAt: number | null;
  /** Tolerance actually applied, after any escalation to fit the point budget. */
  toleranceUsedM: number;
  /** Glitch fixes removed by {@link denoise}, surfaced in the upload summary. */
  droppedOutliers: number;
}

/**
 * Turns full-resolution points into everything we persist for one track.
 *
 * Order matters and is the whole point of this function:
 *   1. GPS glitches are filtered out
 *   2. stats and the elevation/distance series come from the FULL cleaned points
 *   3. only then is the geometry simplified
 *   4. the series are reindexed with the kept indices
 *
 * So the numbers on the page reflect every recorded point, while the geometry
 * shipped to the browser is a fraction of the size.
 */
export function buildTrack(raw: GpxPoint[]): BuiltTrack {
  const { points, dropped } = denoise(raw);

  const stats = computeStats(points);
  const fullDistances = cumulativeDistances(points);
  const fullElevations = elevationSeries(points);
  const bbox = boundsOf(points);

  const { indices, toleranceUsedM } = simplifyToBudget(points);

  const coords: Array<[number, number]> = [];
  const distances: number[] = [];
  const elevations: number[] | null = fullElevations ? [] : null;
  const timeOffsets: number[] = [];

  const startTime = points[0]?.time ?? null;
  let everyKeptPointHasTime = startTime != null;

  for (const i of indices) {
    const p = points[i];
    coords.push([p.lat, p.lon]);
    distances.push(Math.round(fullDistances[i]));
    if (elevations && fullElevations) elevations.push(Math.round(fullElevations[i]));
    if (startTime != null && p.time != null) {
      timeOffsets.push(Math.round((p.time - startTime) / 1000));
    } else {
      everyKeptPointHasTime = false;
    }
  }

  return {
    stats,
    series: {
      geometry: encodePolyline(coords),
      elevations,
      distances,
      // A partial time series would misalign the hover readout, so it's all or nothing.
      timeOffsets: everyKeptPointHasTime ? timeOffsets : null,
      // Reported against the raw file so the upload summary reflects what the
      // user actually handed us.
      pointCountOriginal: raw.length,
      pointCountStored: indices.length,
    },
    bbox,
    startedAt: startTime,
    toleranceUsedM,
    droppedOutliers: dropped,
  };
}
