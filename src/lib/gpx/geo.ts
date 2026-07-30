import type { BBox, GpxPoint } from "./types";

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius
const DEG_TO_RAD = Math.PI / 180;

/** Great-circle distance in metres between two lat/lon pairs. */
export function haversineM(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = (bLat - aLat) * DEG_TO_RAD;
  const dLon = (bLon - aLon) * DEG_TO_RAD;
  const lat1 = aLat * DEG_TO_RAD;
  const lat2 = bLat * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance in metres at each point, starting at 0. */
export function cumulativeDistances(points: GpxPoint[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const prev = points[i - 1];
      const curr = points[i];
      total += haversineM(prev.lat, prev.lon, curr.lat, curr.lon);
    }
    out[i] = total;
  }
  return out;
}

export function boundsOf(points: GpxPoint[]): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return [west, south, east, north];
}

export function mergeBounds(boxes: BBox[]): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [w, s, e, n] of boxes) {
    if (w < west) west = w;
    if (s < south) south = s;
    if (e > east) east = e;
    if (n > north) north = n;
  }
  return [west, south, east, north];
}
